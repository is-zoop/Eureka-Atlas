/* eslint-disable @typescript-eslint/no-require-imports -- Node test runner and TypeScript transpilation. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const channels = new Set();
const notifications = [];
class MockBroadcastChannel {
  constructor(name) { this.name = name; channels.add(this); }
  postMessage(data) {
    notifications.push(data);
    for (const peer of channels) if (peer !== this && peer.name === this.name) queueMicrotask(() => peer.onmessage?.({ data }));
  }
  close() { channels.delete(this); }
}

const user = { member_no: "test-member", name: "测试用户", phone: "13800000000", email: null, avatar_url: null, department: "测试部门", status: "active" };
function fixture() {
  const browser = new EventTarget();
  const requests = [];
  let reply = () => Response.json(user);
  const cache = {};
  const fetch = async (url, options) => { requests.push({ url, options }); return reply(url, options); };
  const load = name => {
    if (cache[name]) return cache[name];
    const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, `../lib/${name}.ts`), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const mod = { exports: {} };
    const requireModule = id => id === "./api" ? load("api") : require(id);
    new Function("module", "exports", "require", "window", "fetch", "BroadcastChannel", source)(mod, mod.exports, requireModule, browser, fetch, MockBroadcastChannel);
    cache[name] = mod.exports;
    return mod.exports;
  };
  const auth = load("auth"); const api = load("api");
  browser.addEventListener(api.AUTH_UNAUTHORIZED_EVENT, auth.clearAuth);
  return { auth, api, browser, requests, setReply(fn) { reply = fn; } };
}

test("login uses phone/password and same-origin cookies; logout clears user state", async () => {
  const f = fixture();
  await f.auth.login(" 13800000000 ", "test-password");
  assert.equal(f.auth.getAuthSnapshot().status, "authenticated");
  assert.deepEqual(f.auth.getAuthSnapshot().user, user);
  assert.equal(f.requests[0].url, "/api/auth/login");
  assert.equal(f.requests[0].options.credentials, "same-origin");
  assert.deepEqual(JSON.parse(f.requests[0].options.body), { phone: user.phone, password: "test-password" });
  assert.equal(f.requests[0].options.headers.has("Authorization"), false);
  await f.auth.logout();
  assert.equal(f.requests[1].url, "/api/auth/logout");
  assert.equal(f.auth.getAuthSnapshot().status, "unauthenticated");
});

test("refresh reads server session, deduplicates requests and reports outage without forgetting the user", async () => {
  const f = fixture();
  await Promise.all([f.auth.refreshAuth(), f.auth.refreshAuth()]);
  assert.equal(f.requests.length, 1);
  assert.equal(f.auth.getAuthSnapshot().status, "authenticated");
  f.setReply(() => Response.json({ message: "Haze 暂时不可用" }, { status: 503 }));
  await f.auth.refreshAuth();
  assert.equal(f.auth.getAuthSnapshot().status, "unavailable");
  assert.deepEqual(f.auth.getAuthSnapshot().user, user);
  f.setReply(() => Response.json(user));
  await f.auth.refreshAuth();
  assert.equal(f.auth.getAuthSnapshot().status, "authenticated");
});

test("401 on a business request immediately expires auth; bad password does not emit expiry", async () => {
  const f = fixture(); let events = 0;
  f.browser.addEventListener(f.api.AUTH_UNAUTHORIZED_EVENT, () => events++);
  await f.auth.login(user.phone, "test-password");
  f.setReply(() => Response.json({ message: "密码错误" }, { status: 401 }));
  await assert.rejects(f.auth.login(user.phone, "incorrect"), /密码错误/);
  assert.equal(events, 0);
  await assert.rejects(f.api.api("/queries"), error => error.status === 401);
  assert.equal(events, 1); assert.equal(f.auth.getAuthSnapshot().user, null);
});

test("failed logout preserves login; successful retry expires it", async () => {
  const f = fixture();
  await f.auth.login(user.phone, "test-password");
  f.setReply(() => { throw new TypeError("network failure"); });
  await assert.rejects(f.auth.logout());
  assert.equal(f.auth.getAuthSnapshot().status, "authenticated");
  f.setReply(() => Response.json({ logged_out: true }));
  await f.auth.logout();
  assert.equal(f.auth.getAuthSnapshot().status, "unauthenticated");
});

test("a late successful refresh cannot resurrect an expired session", async () => {
  const f = fixture(); let finish;
  f.setReply(() => new Promise(resolve => { finish = resolve; }));
  const refresh = f.auth.refreshAuth();
  f.auth.notifySessionExpired();
  finish(Response.json(user)); await refresh;
  assert.equal(f.auth.getAuthSnapshot().status, "unauthenticated");
});

test("focus refresh during login waits for login and a stale 401 cannot clear the new user", async () => {
  const f = fixture(); let finishRefresh; let finishLogin;
  f.setReply(url => new Promise(resolve => { if (url.endsWith("/me")) finishRefresh = resolve; else finishLogin = resolve; }));
  const oldRefresh = f.auth.refreshAuth();
  const login = f.auth.login(user.phone, "test-password");
  const focused = f.auth.refreshAuth();
  assert.equal(f.requests.length, 2);
  finishLogin(Response.json(user)); await login; await focused;
  finishRefresh(Response.json({ message: "old session" }, { status: 401 })); await oldRefresh;
  assert.equal(f.auth.getAuthSnapshot().status, "authenticated");
  assert.deepEqual(f.auth.getAuthSnapshot().user, user);
});

test("late business responses and stale 401s cannot contaminate a new account", async () => {
  const f = fixture();
  await f.auth.login(user.phone, "test-password");
  let finish;
  f.setReply(() => new Promise(resolve => { finish = resolve; }));
  const old = f.api.api("/ask/sessions");
  const stale = assert.rejects(old, error => error.name === "AbortError");
  const nextUser = { ...user, member_no: "another-member", name: "另一个账号" };
  f.setReply(() => Response.json(nextUser));
  await f.auth.login(nextUser.phone, "test-password");
  finish(Response.json({ message: "old account expired" }, { status: 401 }));
  await stale;
  assert.deepEqual(f.auth.getAuthSnapshot().user, nextUser);
  assert.equal(f.auth.getAuthSnapshot().status, "authenticated");
});

test("same-account refresh leaves in-flight work alone; identity change invalidates it", async () => {
  const f = fixture();
  await f.auth.login(user.phone, "test-password");
  let finish;
  f.setReply(url => url.endsWith("/me") ? Response.json(user) : new Promise(resolve => { finish = resolve; }));
  const work = f.api.api("/queries");
  await f.auth.refreshAuth();
  finish(Response.json({ id: "own-query" }));
  assert.deepEqual(await work, { id: "own-query" });
  f.setReply(url => url.endsWith("/me") ? Response.json({ ...user, member_no: "B" }) : new Promise(resolve => { finish = resolve; }));
  const old = f.api.api("/queries");
  const stale = assert.rejects(old, error => error.name === "AbortError");
  await f.auth.refreshAuth();
  finish(Response.json({ id: "old-query" })); await stale;
  assert.equal(f.auth.getAuthSnapshot().user.member_no, "B");
});

test("login/logout notify other tabs without tokens or self-refresh loops, and cleanup closes channels", async () => {
  const first = fixture(), second = fixture();
  await first.auth.login(user.phone, "test-password"); await second.auth.refreshAuth();
  const stopFirst = first.auth.watchAuthChanges(), stopSecond = second.auth.watchAuthChanges();
  try {
    const nextUser = { ...user, member_no: "B" };
    first.setReply(() => Response.json(nextUser)); second.setReply(() => Response.json(nextUser));
    const firstRequestCount = first.requests.length;
    await first.auth.login(nextUser.phone, "test-password");
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(first.requests.length, firstRequestCount + 1);
    assert.deepEqual(second.auth.getAuthSnapshot().user, nextUser);
    first.setReply(() => Response.json({ logged_out: true }));
    second.setReply(() => Response.json({ message: "not logged in" }, { status: 401 }));
    await first.auth.logout(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(second.auth.getAuthSnapshot().status, "unauthenticated");
    assert.ok(notifications.every(message => message === "changed"));
  } finally { stopFirst(); stopSecond(); }
  assert.equal(channels.size, 0);
});
