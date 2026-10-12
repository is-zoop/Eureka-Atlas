import http from 'node:http';
import https from 'node:https';
import { randomBytes, createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSessionStore } from './session-store.mjs';

export const PORT = 3891;
const COOKIE = 'atlas_wps_session';
const UPSTREAM_COOKIE = 'eureka_atlas_session';
const digest = value => createHash('sha256').update(value).digest('hex');
export function validateOrigin(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
    throw new Error('Atlas 地址必须为 HTTPS 服务根地址，或本机 HTTP 地址');
  }
  return url.origin;
}
function permitted(method, path) {
  if (path === '/api/auth/me') return method === 'GET';
  if (path === '/api/auth/restore') return method === 'POST';
  if (['/api/auth/login', '/api/auth/logout', '/api/data-queries'].includes(path)) return method === 'POST';
  if (path === '/api/saved-data-queries') return method === 'GET';
  if (/^\/api\/saved-data-queries\/[a-zA-Z0-9_-]+$/.test(path)) return method === 'GET';
  if (/^\/api\/data-queries\/[a-zA-Z0-9_-]+(?:\/result)?$/.test(path)) return method === 'GET';
  return /^\/api\/data-queries\/[a-zA-Z0-9_-]+\/cancel$/.test(path) && method === 'POST';
}
function json(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ message }));
}
async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 256 * 1024) throw new Error('请求过大');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export function createAtlasServer({ origin, root, port = PORT, timeout = 12_000, sessionStore }) {
  origin = validateOrigin(origin);
  const sessions = new Map();
  let remembered;
  const ready = (async () => {
    const stored = await sessionStore?.load().catch(() => null);
    if (stored?.origin !== origin || !Array.isArray(stored.sessions)) return;
    for (const entry of stored.sessions.slice(0, 100)) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [key, value] = entry;
      if (/^[a-f0-9]{64}$/.test(key) && /^[a-zA-Z0-9_-]{43}$/.test(value?.token) && Number.isFinite(value.expires) && value.expires > Date.now()) sessions.set(key, value);
    }
    if (sessions.has(stored.remembered)) remembered = stored.remembered;
  })();
  const persist = () => sessionStore?.save({ origin, remembered, sessions: [...sessions] });
  const revoke = token => { for (const [key, value] of sessions) if (value.token === token) { sessions.delete(key); if (remembered === key) remembered = undefined; } };
  root = resolve(root);
  const clearCookie = res => res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  const server = http.createServer(async (req, res) => {
    const host = req.headers.host;
    if (host !== `127.0.0.1:${port}` || req.headers['sec-fetch-site'] === 'cross-site' ||
        (req.headers.origin && req.headers.origin !== `http://${host}`)) {
      json(res, 403, '不允许跨站访问 Atlas 本地助手'); return;
    }
    try {
      const url = new URL(req.url, `http://${host}`);
      if (url.pathname.startsWith('/api/')) {
        if (!permitted(req.method, url.pathname)) { json(res, 404, '接口不存在'); return; }
        if (req.method === 'POST' && req.headers.origin !== `http://${host}`) { json(res, 403, '请求来源无效'); return; }
        if (req.method === 'POST' && !/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '') && url.pathname !== '/api/auth/logout') {
          json(res, 415, '请使用 JSON 请求'); return;
        }
        await ready;
        for (const [key, session] of sessions) if (session.expires <= Date.now()) { sessions.delete(key); if (remembered === key) remembered = undefined; }
        const raw = (req.headers.cookie ?? '').split(';').map(x => x.trim()).find(x => x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
        const key = raw && /^[a-zA-Z0-9_-]{43}$/.test(raw) ? digest(raw) : undefined;
        const login = url.pathname === '/api/auth/login';
        const logout = url.pathname === '/api/auth/logout';
        const restore = url.pathname === '/api/auth/restore';
        const session = (key && sessions.get(key)) || ((restore || logout) && sessions.get(remembered));
        if (!login && !logout && !session) { clearCookie(res); json(res, 401, '请先登录 Atlas'); return; }
        const payload = req.method === 'POST' ? await body(req) : undefined;
        const upstreamUrl = new URL(restore ? '/api/auth/me' : url.pathname + url.search, origin);
        const transport = upstreamUrl.protocol === 'https:' ? https : http;
        const headers = { Origin: origin, Accept: 'application/json' };
        if (payload && !restore) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = payload.length; }
        if (session) headers.Cookie = `${UPSTREAM_COOKIE}=${session.token}`;
        const upstream = transport.request(upstreamUrl, { method: restore ? 'GET' : req.method, headers }, response => {
          const chunks = []; let size = 0;
          response.on('data', chunk => {
            size += chunk.length;
            if (size > 16 * 1024 * 1024) { upstream.destroy(new Error('response limit')); return; }
            chunks.push(chunk);
          });
          response.on('error', () => { if (!res.writableEnded) json(res, 503, 'Atlas 响应中断，请重试'); });
          response.on('end', () => { void (async () => {
            if (res.writableEnded) return;
            const status = response.statusCode ?? 503;
            if (status >= 300 && status < 400) { json(res, 503, 'Atlas 地址发生重定向，请配置正确的服务根地址'); return; }
            if (login && status >= 200 && status < 300) {
              const remote = (response.headers['set-cookie'] ?? []).find(x => x.startsWith(`${UPSTREAM_COOKIE}=`));
              const token = remote?.split(';')[0].slice(UPSTREAM_COOKIE.length + 1);
              const age = Number(remote?.match(/(?:^|;)\s*Max-Age=(\d+)/i)?.[1]);
              const expires = age > 0 ? Date.now() + age * 1000 : Date.parse(remote?.match(/(?:^|;)\s*Expires=([^;]+)/i)?.[1] ?? '');
              if (!token || !/^[a-zA-Z0-9_-]{43}$/.test(token) || !Number.isFinite(expires) || expires <= Date.now()) {
                json(res, 503, 'Atlas 未返回有效登录会话'); return;
              }
              if (sessions.size >= 100 && !session) { json(res, 503, '本地会话过多，请重启助手'); return; }
              const local = randomBytes(32).toString('base64url');
              if (key) sessions.delete(key);
              remembered = digest(local);
              sessions.set(remembered, { token, expires });
              await persist();
              res.setHeader('Set-Cookie', `${COOKIE}=${local}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor((expires - Date.now()) / 1000)}`);
            }
            if (restore && status >= 200 && status < 300 && !(key && sessions.has(key))) {
              // Only explicit same-origin restore can recover a Windows user's cached login.
              if (!sessions.has(remembered) || sessions.get(remembered).token !== session.token) { json(res, 401, '账号已变化，请重新打开助手'); return; }
              const local = randomBytes(32).toString('base64url');
              if (sessions.size >= 100) sessions.delete(sessions.keys().next().value);
              remembered = digest(local); sessions.set(remembered, session); await persist();
              res.setHeader('Set-Cookie', `${COOKIE}=${local}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.max(0, Math.floor((session.expires - Date.now()) / 1000))}`);
            }
            if (status === 401 || (logout && status >= 200 && status < 300)) {
              if (session) revoke(session.token);
              await persist();
              clearCookie(res);
            }
            res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
            res.end(Buffer.concat(chunks));
          })().catch(() => { if (!res.writableEnded) json(res, 503, '登录态保存失败，请重试'); }); });
        });
        const deadline = setTimeout(() => upstream.destroy(new Error('timeout')), timeout);
        upstream.on('close', () => clearTimeout(deadline));
        upstream.on('error', () => { if (!res.writableEnded) json(res, 503, '无法连接 Atlas 服务，请检查服务地址或稍后重试'); });
        res.on('close', () => { if (!res.writableEnded) upstream.destroy(); });
        upstream.end(restore ? undefined : payload);
        return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) { json(res, 405, '不支持此操作'); return; }
      const decoded = decodeURIComponent(url.pathname);
      const target = resolve(root, `.${decoded === '/' ? '/index.html' : decoded}`);
      if (!target.startsWith(root + sep) || decoded.includes('\\')) { json(res, 404, '文件不存在'); return; }
      const info = await stat(target).catch(() => null);
      if (!info?.isFile()) { json(res, 404, '文件不存在'); return; }
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
      res.writeHead(200, { 'Content-Type': types[extname(target)] ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
      res.end(req.method === 'HEAD' ? undefined : await readFile(target));
    } catch { if (!res.writableEnded) json(res, 400, '请求无效或文件读取失败'); }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.on('close', () => sessions.clear());
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const base = resolve(fileURLToPath(new URL('../', import.meta.url)));
    const origin = (await readFile(resolve(base, 'atlas-origin.txt'), 'utf8')).trim();
    const server = createAtlasServer({ origin, root: resolve(base, 'web'), sessionStore: createSessionStore(resolve(base, 'session.dat'), resolve(base, 'SessionVault.exe')) });
    server.once('error', () => { console.error('Atlas 本地助手启动失败，端口可能已被占用'); process.exit(1); });
    server.listen(PORT, '127.0.0.1', () => console.log('ATLAS_READY'));
    // The launcher owns stdin. Durable sessions remain encrypted until logout/expiry.
    process.stdin.resume();
    process.stdin.on('end', () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
  } catch { console.error('Atlas 服务地址配置无效'); process.exit(1); }
}
