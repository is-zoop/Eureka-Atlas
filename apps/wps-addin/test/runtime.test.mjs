import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAtlasServer, validateOrigin } from '../runtime/server.mjs';

test('origin is a root URL, HTTPS remotely, no credentials or arbitrary HTTP', () => {
  assert.equal(validateOrigin('https://atlas.example/'), 'https://atlas.example');
  assert.equal(validateOrigin('http://127.0.0.1:3001'), 'http://127.0.0.1:3001');
  for (const value of ['http://atlas.example', 'https://u:p@atlas.example', 'https://atlas.example/api', 'https://atlas.example/?x=1', 'file:///tmp']) assert.throws(() => validateOrigin(value));
});

test('installed bridge isolates cookies, rejects cross-site writes and preserves sessions on 503', async context => {
  const root = await mkdtemp(join(tmpdir(), 'atlas-runtime-'));
  await writeFile(join(root, 'index.html'), '<html>Atlas</html>');
  const token = 'a'.repeat(43); let mode = 'ok'; const observed = [];
  const remote = http.createServer((req, res) => {
    observed.push({ url: req.url, origin: req.headers.origin, cookie: req.headers.cookie, authorization: req.headers.authorization });
    req.resume();
    if (req.url === '/api/auth/login') { res.setHeader('Set-Cookie', `eureka_atlas_session=${token}; Max-Age=3600; Path=/; HttpOnly; Secure; SameSite=Lax`); res.end('{"member_no":"A"}'); }
    else if (mode === 'timeout') { /* intentionally no response */ }
    else if (mode === 'redirect') { res.writeHead(302, { Location: 'https://elsewhere.example/' }); res.end(); }
    else { res.writeHead(mode === '503' ? 503 : mode === '401' ? 401 : 200); res.end('{"member_no":"A"}'); }
  });
  await new Promise(resolve => remote.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${remote.address().port}`;
  const bridge = createAtlasServer({ origin, root, port: 0, timeout: 80 });
  await new Promise(resolve => bridge.listen(0, '127.0.0.1', resolve));
  const port = bridge.address().port;
  // Use the dynamically assigned test port in guard; production remains fixed 3891.
  bridge.closeAllConnections(); await new Promise(resolve => bridge.close(resolve));
  const service = createAtlasServer({ origin, root, port, timeout: 80 });
  await new Promise(resolve => service.listen(port, '127.0.0.1', resolve));
  context.after(async () => { service.closeAllConnections(); remote.closeAllConnections(); await Promise.all([new Promise(r => service.close(r)), new Promise(r => remote.close(r))]); await rm(root, { recursive: true }); });
  const local = `http://127.0.0.1:${port}`;
  const request = (path, options = {}) => fetch(local + path, { ...options, redirect: 'manual' });
  assert.equal((await request('/api/auth/me')).status, 401);
  const attempts = observed.length;
  assert.equal((await request('/api/auth/login', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal(observed.length, attempts);
  const logged = await request('/api/auth/login', { method: 'POST', headers: { Origin: local, 'Content-Type': 'application/json' }, body: '{"phone":"13800000000","password":"secret"}' });
  assert.equal(logged.status, 200);
  const cookie = logged.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly; SameSite=Strict/);
  assert.ok(!cookie.includes(token)); assert.ok(!cookie.includes('eureka_atlas_session'));
  assert.ok(!(await logged.text()).includes(token));
  const headers = { Cookie: cookie.split(';')[0], Authorization: 'should-not-forward' };
  assert.equal((await request('/api/auth/me', { headers })).status, 200);
  assert.equal(observed.at(-1).cookie, `eureka_atlas_session=${token}`);
  assert.equal(observed.at(-1).origin, origin); assert.equal(observed.at(-1).authorization, undefined);
  mode = '503'; const unavailable = await request('/api/auth/me', { headers }); assert.equal(unavailable.status, 503); assert.equal(unavailable.headers.get('set-cookie'), null);
  mode = 'ok'; assert.equal((await request('/api/auth/me', { headers })).status, 200);
  mode = 'timeout'; assert.equal((await request('/api/auth/me', { headers })).status, 503);
  mode = 'redirect'; assert.equal((await request('/api/auth/me', { headers })).status, 503);
  mode = 'ok'; assert.equal((await request('/api/auth/me', { headers })).status, 200);
  assert.equal((await request('/api/admin', { headers })).status, 404);
  const foreignHostStatus = await new Promise((resolve, reject) => {
    const req = http.get(local + '/api/auth/me', { headers: { ...headers, Host: `localhost:${port}` } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
  });
  assert.equal(foreignHostStatus, 403);
  assert.equal((await request('/api/auth/me', { headers: { ...headers, 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await request('/')).status, 200);
  assert.equal((await request('/%2e%2e%2fserver.mjs')).status, 404);
  mode = '401'; const revoked = await request('/api/auth/me', { headers }); assert.equal(revoked.status, 401); assert.match(revoked.headers.get('set-cookie'), /Max-Age=0/);
  mode = 'ok'; assert.equal((await request('/api/auth/me', { headers })).status, 401);
});

test('separate local identities forward only their own remote sessions; logout does not revoke another session', async context => {
  let counter = 0; const cookies = [];
  const remote = http.createServer((req, res) => {
    req.resume(); cookies.push(req.headers.cookie);
    if (req.url === '/api/auth/login') res.setHeader('Set-Cookie', `eureka_atlas_session=${(++counter === 1 ? 'a' : 'b').repeat(43)}; Max-Age=3600; Secure; HttpOnly`);
    res.end('{}');
  });
  await new Promise(r => remote.listen(0, '127.0.0.1', r));
  const reserve = http.createServer(); await new Promise(r => reserve.listen(0, '127.0.0.1', r)); const port = reserve.address().port; await new Promise(r => reserve.close(r));
  const bridge = createAtlasServer({ origin: `http://127.0.0.1:${remote.address().port}`, root: tmpdir(), port }); await new Promise(r => bridge.listen(port, '127.0.0.1', r));
  context.after(async () => { bridge.closeAllConnections(); remote.closeAllConnections(); await Promise.all([new Promise(r => bridge.close(r)), new Promise(r => remote.close(r))]); });
  const local = `http://127.0.0.1:${port}`;
  const login = async () => (await fetch(local + '/api/auth/login', { method: 'POST', headers: { Origin: local, 'Content-Type': 'application/json' }, body: '{}' })).headers.get('set-cookie').split(';')[0];
  const a = await login(); const b = await login();
  await fetch(local + '/api/auth/me', { headers: { Cookie: a } }); assert.equal(cookies.at(-1), `eureka_atlas_session=${'a'.repeat(43)}`);
  await fetch(local + '/api/auth/me', { headers: { Cookie: b } }); assert.equal(cookies.at(-1), `eureka_atlas_session=${'b'.repeat(43)}`);
  await fetch(local + '/api/auth/logout', { method: 'POST', headers: { Cookie: a, Origin: local } });
  assert.equal((await fetch(local + '/api/auth/me', { headers: { Cookie: a } })).status, 401);
  assert.equal((await fetch(local + '/api/auth/me', { headers: { Cookie: b } })).status, 200);
});
