import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSessionStore, protect } from '../runtime/session-store.mjs';
import { createAtlasServer } from '../runtime/server.mjs';

test('Windows DPAPI persists encrypted logins across helper restarts and cookie loss without extending expiry', { skip: process.platform !== 'win32' }, async context => {
  const folder = await mkdtemp(join(tmpdir(), 'atlas-vault-test-')); const helper = join(folder, 'SessionVault.exe');
  const compilation = spawnSync(join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), ['/nologo', '/target:exe', '/reference:System.Security.dll', `/out:${helper}`, fileURLToPath(new URL('../installer/SessionVault.cs', import.meta.url))], { windowsHide: true, encoding: 'utf8' });
  assert.equal(compilation.status, 0, compilation.stdout + compilation.stderr);
  const store = createSessionStore(join(folder, 'session.dat'), helper);
  const secret = { text: '中文', token: 'a'.repeat(43) };
  await store.save(secret); assert.deepEqual(await store.load(), secret);
  const cipher = await readFile(join(folder, 'session.dat'), 'utf8'); assert.ok(!cipher.includes(secret.token)); assert.ok(!cipher.includes('中文'));
  await assert.rejects(protect(helper, 'decrypt', 'invalid ciphertext'));
  await writeFile(join(folder, 'session.dat'), 'corrupted'); await assert.rejects(store.load());
  await store.save(null);
  let mode = 'ok'; const observed = [];
  const remote = http.createServer((req, res) => {
    observed.push({ url: req.url, cookie: req.headers.cookie }); req.resume();
    if (req.url === '/api/auth/login') { res.setHeader('Set-Cookie', `eureka_atlas_session=${secret.token}; Max-Age=3600; HttpOnly; Secure`); res.end('{"member_no":"A"}'); }
    else { res.writeHead(mode === 'revoked' ? 401 : mode === '503' ? 503 : 200); res.end('{"member_no":"A"}'); }
  });
  await new Promise(r => remote.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${remote.address().port}`;
  const reserve = http.createServer(); await new Promise(r => reserve.listen(0, '127.0.0.1', r)); const port = reserve.address().port; await new Promise(r => reserve.close(r));
  let bridge;
  const open = async serviceOrigin => { bridge = createAtlasServer({ origin: serviceOrigin ?? origin, root: folder, port, sessionStore: createSessionStore(join(folder, 'session.dat'), helper) }); await new Promise(r => bridge.listen(port, '127.0.0.1', r)); };
  const close = async () => { bridge.closeAllConnections(); await new Promise(r => bridge.close(r)); };
  context.after(async () => { if (bridge?.listening) await close(); remote.closeAllConnections(); await new Promise(r => remote.close(r)); await rm(folder, { recursive: true }); });
  const local = `http://127.0.0.1:${port}`;
  const post = (path, cookie) => fetch(local + path, { method: 'POST', headers: { Connection: 'close', Origin: local, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: '{}' });
  await open(); const login = await post('/api/auth/login'); assert.equal(login.status, 200); const cookie = login.headers.get('set-cookie').split(';')[0]; const first = await store.load();
  assert.ok(!JSON.stringify(await login.json()).includes(secret.token)); await close();
  await open(); assert.equal((await fetch(local + '/api/auth/me', { headers: { Connection: 'close', Cookie: cookie } })).status, 200);
  assert.equal((await fetch(local + '/api/auth/me', { headers: { Connection: 'close' } })).status, 401); // No implicit login for arbitrary unauthenticated reads.
  const restore = await post('/api/auth/restore'); assert.equal(restore.status, 200); assert.ok(!restore.headers.get('set-cookie').includes(secret.token));
  assert.equal(observed.at(-1).url, '/api/auth/me'); assert.equal(observed.at(-1).cookie, `eureka_atlas_session=${secret.token}`);
  const restored = await store.load(); assert.equal(restored.sessions.find(([key]) => key === restored.remembered)[1].expires, first.sessions[0][1].expires);
  const protectedBefore = await readFile(join(folder, 'session.dat'), 'utf8');
  mode = '503'; assert.equal((await post('/api/auth/restore')).status, 503); assert.equal(await readFile(join(folder, 'session.dat'), 'utf8'), protectedBefore);
  mode = 'ok'; assert.equal((await post('/api/auth/restore')).status, 200);
  assert.equal((await fetch(local + '/api/auth/restore', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await fetch(local + '/api/auth/restore', { method: 'POST' })).status, 403);
  mode = 'revoked'; assert.equal((await post('/api/auth/restore')).status, 401); assert.equal((await store.load()).sessions.length, 0);
  await close(); mode = 'ok'; await open(); assert.equal((await post('/api/auth/restore')).status, 401);
  await post('/api/auth/login'); assert.equal((await post('/api/auth/logout')).status, 200); await close(); await open(); assert.equal((await post('/api/auth/restore')).status, 401);
  await post('/api/auth/login'); await close(); await open('http://127.0.0.1:1'); assert.equal((await post('/api/auth/restore')).status, 401); await close();
  await store.save({ ...first, sessions: first.sessions.map(([key, session]) => [key, { ...session, expires: Date.now() - 1 }]) }); await open(); assert.equal((await post('/api/auth/restore')).status, 401);
});
