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

const user = { member_no: "test-member", name: "测试用户", phone: "13800000000", email: null, avatar_url: null, department: "测试部门", role_code: "USER", role_name: "使用者", status: "active" };
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
    const requireModule = id => id.startsWith("./") ? load(id.slice(2)) : require(id);
    new Function("module", "exports", "require", "window", "fetch", "BroadcastChannel", source)(mod, mod.exports, requireModule, browser, fetch, MockBroadcastChannel);
    cache[name] = mod.exports;
    return mod.exports;
  };
  const auth = load("auth"); const api = load("api"); const listViews = load("list-view-state");
  browser.addEventListener(api.AUTH_UNAUTHORIZED_EVENT, auth.clearAuth);
  browser.addEventListener(api.AUTH_REVALIDATE_EVENT, () => { void auth.refreshAuth(); });
  return { auth, api, listViews, profile: load("profile"), browser, requests, setReply(fn) { reply = fn; } };
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

test("401 on a business request revalidates the session; bad password does not emit expiry", async () => {
  const f = fixture(); let events = 0;
  f.browser.addEventListener(f.api.AUTH_UNAUTHORIZED_EVENT, () => events++);
  await f.auth.login(user.phone, "test-password");
  f.setReply(() => Response.json({ message: "密码错误" }, { status: 401 }));
  await assert.rejects(f.auth.login(user.phone, "incorrect"), /密码错误/);
  assert.equal(events, 0);
  await assert.rejects(f.api.api("/queries"), error => error.status === 401);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.requests.at(-1).url, "/api/auth/me");
  assert.equal(events, 1); assert.equal(f.auth.getAuthSnapshot().user, null);
});

test("business 401 preserves a valid session and reports the business error", async () => {
  const f = fixture(); let expired = 0;
  await f.auth.login(user.phone, "test-password");
  f.browser.addEventListener(f.api.AUTH_UNAUTHORIZED_EVENT, () => expired++);
  f.setReply(url => url.endsWith("/auth/me") ? Response.json(user) : Response.json({ message: "上游凭据被拒绝" }, { status: 401 }));
  await assert.rejects(f.api.api("/datasources/test-connection", { method: "POST", body: "{}" }), error => error.status === 401 && error.message === "上游凭据被拒绝");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.requests.at(-1).url, "/api/auth/me");
  assert.equal(expired, 0);
  assert.equal(f.auth.getAuthSnapshot().status, "authenticated");
  assert.deepEqual(f.auth.getAuthSnapshot().user, user);
});

test("business 401 followed by an auth-service outage retains the user instead of logging out", async () => {
  const f = fixture(); let expired = 0;
  await f.auth.login(user.phone, "test-password");
  f.browser.addEventListener(f.api.AUTH_UNAUTHORIZED_EVENT, () => expired++);
  f.setReply(url => url.endsWith("/auth/me") ? Response.json({ message: "Haze 暂时不可用" }, { status: 503 }) : Response.json({ message: "业务鉴权失败" }, { status: 401 }));
  await assert.rejects(f.api.api("/queries"), error => error.status === 401);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(expired, 0);
  assert.equal(f.auth.getAuthSnapshot().status, "unavailable");
  assert.deepEqual(f.auth.getAuthSnapshot().user, user);
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

test("same-account role changes invalidate in-flight work and publish the new authorization state", async () => {
  const f = fixture();
  await f.auth.login(user.phone, "test-password");
  let changes = 0;
  f.browser.addEventListener(f.api.AUTH_ACCOUNT_CHANGED_EVENT, () => changes++);
  for (const role_code of ["ADMIN", "SYSTEM_ADMIN", "USER"]) {
    let finish;
    const next = { ...user, role_code };
    f.setReply(url => url.endsWith("/me") ? Response.json(next) : new Promise(resolve => { finish = resolve; }));
    const work = f.api.api("/semantic/metrics");
    const stale = assert.rejects(work, error => error.name === "AbortError");
    await f.auth.refreshAuth();
    finish(Response.json({ message: "late old-role response" }, { status: 403 }));
    await stale;
    assert.deepEqual(f.auth.getAuthSnapshot().user, next);
    assert.equal(f.auth.getAuthSnapshot().status, "authenticated");
  }
  assert.equal(changes, 3);
});

test("403 permission denials preserve an authenticated session rather than behaving like 401", async () => {
  const f = fixture();
  await f.auth.login(user.phone, "test-password");
  let expired = 0;
  f.browser.addEventListener(f.api.AUTH_UNAUTHORIZED_EVENT, () => expired++);
  f.setReply(() => Response.json({ message: "没有权限" }, { status: 403 }));
  await assert.rejects(f.api.api("/models"), error => error.status === 403);
  assert.equal(expired, 0);
  assert.deepEqual(f.auth.getAuthSnapshot().user, user);
  assert.equal(f.auth.getAuthSnapshot().status, "authenticated");
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

function selectListViews(f) {
  for (const key of ["assets", "metrics", "dimensions"]) {
    f.listViews.setListView(key, state => ({ ...state, search: "订单", query: "q=订单&page=3", field: "dataSource", expanded: new Set(["row"]) }));
  }
}
function assertListViewsReset(f) {
  for (const key of ["assets", "metrics", "dimensions"]) {
    assert.equal(f.listViews.getListView(key), f.listViews.getDefaultListView(key));
  }
}

test("list selections survive same-user revalidation and outages but clear after successful same-user login and logout", async () => {
  const f = fixture();
  await f.auth.login(user.phone, "test-password");
  selectListViews(f);
  const selected = f.listViews.getListView("assets");
  await f.auth.refreshAuth();
  assert.equal(f.listViews.getListView("assets"), selected);
  f.setReply(() => Response.json({ message: "temporary outage" }, { status: 503 }));
  await f.auth.refreshAuth();
  assert.equal(f.listViews.getListView("assets"), selected);
  f.setReply(() => Response.json(user));
  await f.auth.refreshAuth();
  assert.equal(f.listViews.getListView("assets"), selected);
  await f.auth.login(user.phone, "test-password");
  assertListViewsReset(f);
  selectListViews(f);
  await f.auth.logout();
  assertListViewsReset(f);
});

test("failed login and logout preserve list selections while expiry and account changes clear all lists", async () => {
  const f = fixture();
  await f.auth.login(user.phone, "test-password");
  selectListViews(f);
  const selected = f.listViews.getListView("assets");
  f.setReply(() => Response.json({ message: "bad password" }, { status: 401 }));
  await assert.rejects(f.auth.login(user.phone, "incorrect"));
  assert.equal(f.listViews.getListView("assets"), selected);
  f.setReply(() => { throw new TypeError("network failure"); });
  await assert.rejects(f.auth.logout());
  assert.equal(f.listViews.getListView("assets"), selected);
  f.auth.notifySessionExpired();
  assertListViewsReset(f);
  f.setReply(() => Response.json(user));
  await f.auth.refreshAuth();
  selectListViews(f);
  f.setReply(() => Response.json({ ...user, member_no: "B" }));
  await f.auth.refreshAuth();
  assertListViewsReset(f);
});

test("another tab re-login clears list selections even if the account is unchanged", async () => {
  const first = fixture(), second = fixture();
  await first.auth.login(user.phone, "test-password");
  await second.auth.refreshAuth();
  selectListViews(second);
  const stopFirst = first.auth.watchAuthChanges(), stopSecond = second.auth.watchAuthChanges();
  try {
    await first.auth.login(user.phone, "test-password");
    await new Promise(resolve => setImmediate(resolve));
    assertListViewsReset(second);
  } finally { stopFirst(); stopSecond(); }
});

test("API errors show Chinese messages while retaining status and diagnostic metadata", async () => {
  const f = fixture();
  f.setReply(() => Response.json({ message: "Bad Request", code: "BAD_INPUT" }, { status: 400 }));
  await assert.rejects(f.api.api("/governance/workspaces"), error => {
    assert.equal(error.status, 400);
    assert.equal(error.code, "BAD_INPUT");
    assert.match(error.message, /提交的信息不符合要求/);
    return true;
  });
  f.setReply(() => Response.json({ message: ["默认统计日期无效", "请选择当前表字段"] }, { status: 400 }));
  await assert.rejects(f.api.api("/governance/workspaces"), error => error.message === "默认统计日期无效；请选择当前表字段");
  f.setReply(() => Response.json({}, { status: 500 }));
  await assert.rejects(f.api.api("/governance/workspaces"), /请求失败（HTTP 500）/);
});

test("avatar updates refresh current and peer user state without clearing list selections or live requests", async () => {
  const first = fixture(), second = fixture();
  await first.auth.login(user.phone, "test-password"); await second.auth.refreshAuth();
  selectListViews(first); selectListViews(second);
  const firstSelection = first.listViews.getListView("assets"), secondSelection = second.listViews.getListView("assets");
  const stopFirst = first.auth.watchAuthChanges(), stopSecond = second.auth.watchAuthChanges();
  try {
    const updated = { ...user, avatar_url: "data:image/jpeg;base64,abcd" };
    let finish;
    first.setReply(() => new Promise(resolve => { finish = resolve; }));
    const work = first.api.api("/queries");
    second.setReply(() => Response.json(updated));
    first.auth.updateAuthUser(updated);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(first.auth.getAuthSnapshot().user, updated);
    assert.deepEqual(second.auth.getAuthSnapshot().user, updated);
    assert.equal(first.listViews.getListView("assets"), firstSelection);
    assert.equal(second.listViews.getListView("assets"), secondSelection);
    finish(Response.json({ ok: true })); assert.deepEqual(await work, { ok: true });
    first.auth.updateAuthUser({ ...updated, member_no: "another-account" });
    assert.deepEqual(first.auth.getAuthSnapshot().user, updated);
    assert.equal(notifications.at(-1), "profile-updated");
  } finally { stopFirst(); stopSecond(); }
});

test("successful password reset clears local auth without a second logout request; a wrong password does not", async () => {
  const f = fixture(); await f.auth.login(user.phone, "test-password");
  f.setReply(() => Response.json({ message: "当前密码不正确" }, { status: 400 }));
  await assert.rejects(f.profile.resetOwnPassword("incorrect", "new-password"), /当前密码不正确/);
  assert.equal(f.auth.getAuthSnapshot().status, "authenticated");
  f.setReply(() => Response.json({ reset: true }));
  await f.profile.resetOwnPassword("test-password", "new-password");
  assert.equal(f.auth.getAuthSnapshot().status, "unauthenticated");
  assert.equal(f.requests.some(request => request.url.endsWith("/auth/logout")), false);
  const request = f.requests.at(-1);
  assert.equal(request.url, "/api/auth/me/reset-password");
  assert.deepEqual(JSON.parse(request.options.body), { current_password: "test-password", new_password: "new-password" });
});

test("profile client requests metadata by GET and full credentials only by explicit POST", async () => {
  const f = fixture();
  f.setReply(() => Response.json({ id: 1, masked_key: "haze_********", key: "explicit-secret" }));
  await f.profile.getPersonalCredential();
  assert.equal(f.requests.at(-1).url, "/api/auth/me/mcp-credential");
  assert.equal(f.requests.at(-1).options.method, undefined);
  await f.profile.revealPersonalCredential();
  assert.equal(f.requests.at(-1).url, "/api/auth/me/mcp-credential/reveal");
  assert.equal(f.requests.at(-1).options.method, "POST");
  await f.profile.resetPersonalCredential();
  assert.equal(f.requests.at(-1).url, "/api/auth/me/mcp-credential/reset");
  assert.equal(f.requests.at(-1).options.method, "POST");
});
