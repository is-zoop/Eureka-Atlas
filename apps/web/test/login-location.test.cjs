const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/login-location.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const mod = { exports: {} }; new Function('module', 'exports', code)(mod, mod.exports);
const { loginLocation, loginDestination } = mod.exports;

test('login recovery preserves only the selector session or data-query task, not unrelated parameters', () => {
 for(const [pathname,key] of [['/integrations/plugins/data-selector','session_id'],['/query/data','queryId']]) {
  const original = new URL('https://atlas.example'+pathname+'?'+key+'=owned-session&credential=discard');
  const login = loginLocation(original), restored = loginDestination(new URL(login, original.origin));
  assert.equal(restored,pathname+'?'+key+'=owned-session'); assert.equal(login.includes('credential'),false);
  assert.equal(loginDestination(new URL('/login?returnTo='+encodeURIComponent(pathname),original.origin)),pathname);
 }
 assert.equal(loginLocation(new URL('https://atlas.example/integrations/plugins?session_id=drop')),'/login');
});

test('login recovery never opens external URLs, other management pages or forged selector prefixes', () => {
 for(const value of ['//','/\n/','https://evil.example','//evil.example/integrations/plugins/data-selector','/\\evil.example/query/data','/models','/integrations/plugins','/integrations/plugins/data-selector-fake?session_id=x','/integrations/plugins/data-selector/child','/query/data-fake']) {
  assert.equal(loginDestination(new URL('https://atlas.example/login?returnTo='+encodeURIComponent(value))), '/', value);
 }
 assert.equal(loginDestination(new URL('https://atlas.example/login')), '/');
});
