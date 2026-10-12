import { spawn } from 'node:child_process';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export function protect(helper, mode, value) {
  return new Promise((resolve, reject) => {
    const child = spawn(helper, [mode], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    const output = []; let length = 0;
    const timer = setTimeout(() => child.kill(), 5000);
    child.stdout.on('data', chunk => { length += chunk.length; if (length > 256 * 1024) child.kill(); else output.push(chunk); });
    child.stdin.on('error', () => {});
    child.on('error', () => { clearTimeout(timer); reject(new Error('Windows 登录态加密服务不可用')); });
    child.on('close', code => { clearTimeout(timer); if (code !== 0) reject(new Error('Windows 登录态加密校验失败')); else resolve(Buffer.concat(output).toString('utf8')); });
    child.stdin.end(value);
  });
}

// DPAPI CurrentUser: never persist a plaintext credential or expose it in arguments/logs.
export function createSessionStore(file, helper) {
  let queue = Promise.resolve();
  return {
    async load() {
      try { return JSON.parse(await protect(helper, 'decrypt', await readFile(file, 'utf8'))); }
      catch (error) { if (error.code === 'ENOENT') return null; throw new Error('保存的登录态无法解密，请重新登录'); }
    },
    save(value) {
      const snapshot = JSON.stringify(value);
      const operation = queue.catch(() => {}).then(async () => {
        const encrypted = await protect(helper, 'encrypt', snapshot);
        const temp = `${file}.${randomUUID()}.tmp`;
        try { await writeFile(temp, encrypted, { mode: 0o600 }); await rename(temp, file); }
        finally { await unlink(temp).catch(() => {}); }
      });
      queue = operation; return operation;
    },
  };
}
