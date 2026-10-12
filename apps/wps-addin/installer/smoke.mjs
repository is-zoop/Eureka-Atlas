import { mkdtemp, mkdir, copyFile, cp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const payload = resolve(process.argv[2]);
const fixture = await mkdtemp(join(tmpdir(), 'atlas-packaged-runtime-'));
let child;
try {
  await mkdir(join(fixture, 'runtime'));
  await copyFile(join(payload, 'runtime/server.mjs'), join(fixture, 'runtime/server.mjs'));
  await copyFile(join(payload, 'runtime/session-store.mjs'), join(fixture, 'runtime/session-store.mjs'));
  await copyFile(join(payload, 'SessionVault.exe'), join(fixture, 'SessionVault.exe'));
  await cp(join(payload, 'web'), join(fixture, 'web'), { recursive: true });
  await writeFile(join(fixture, 'atlas-origin.txt'), 'http://127.0.0.1:3001');
  child = spawn(join(payload, 'node.exe'), [join(fixture, 'runtime/server.mjs')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const stopped = new Promise(resolve => child.once('exit', code => resolve(code)));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Packaged runtime startup timed out')), 10_000);
    child.once('error', reject);
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Packaged runtime exited ${code}`)); });
    child.stdout.on('data', data => { if (data.toString().includes('ATLAS_READY')) { clearTimeout(timer); resolve(); } });
    child.stderr.resume();
  });
  for (const path of ['/', '/taskpane.html', '/ribbon.xml', '/images/atlas.png', '/images/refresh-cw.png', '/images/info.png']) assert.equal((await fetch('http://127.0.0.1:3891' + path)).status, 200);
  assert.equal((await fetch('http://127.0.0.1:3891/api/auth/me')).status, 401);
  assert.equal((await fetch('http://127.0.0.1:3891/api/auth/login', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await fetch('http://127.0.0.1:3891/publish.html')).status, 404);
  child.stdin.end(); assert.equal(await stopped, 0);
  console.log('PASS packaged Node + static assets + auth guard + clean shutdown (no browser, WPS or real login)');
} finally {
  if (child && child.exitCode === null) { child.kill(); await new Promise(resolve => child.once('exit', resolve)); }
  await rm(fixture, { recursive: true });
}
