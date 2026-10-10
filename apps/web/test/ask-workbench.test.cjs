/* eslint-disable @typescript-eslint/no-require-imports -- Node tests transpile the component without a browser. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const emptySession = (id, title = "新对话") => ({
  id, title, model_id: "model", table_ids: [], thinking_level: "off",
  configuration_version: 1, active_run: null,
});
const runningRun = (id, sessionId) => ({
  id, session_id: sessionId, status: "RUNNING", event_cursor: 0, queries: [],
  result_summaries: [], processing: { steps: [], message_count: 0, tool_count: 0 },
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const flush = () => new Promise((resolve) => setImmediate(resolve));

// Exercise the component's handlers and effects without a DOM or live model.
// UI children stay opaque; their actual markup is covered in ask-answer.test.cjs.
function mountWorkbench(api, { initialSessionId, memberNo = "test-member", savedSession = null } = {}) {
  const slots = [];
  let cursor = 0;
  let pendingEffects = [];
  const react = {
    useState(initial) {
      const index = cursor++;
      slots[index] ??= { value: initial };
      return [slots[index].value, (value) => {
        slots[index].value = typeof value === "function" ? value(slots[index].value) : value;
      }];
    },
    useRef(initial) {
      const index = cursor++;
      slots[index] ??= { current: initial };
      return slots[index];
    },
    useEffect(effect, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        pendingEffects.push(() => {
          previous?.cleanup?.();
          slots[index] = { deps, cleanup: effect() };
        });
      }
    },
  };
  const streams = [];
  class EventSource {
    constructor() { streams.push(this); this.listeners = new Map(); }
    addEventListener(kind, callback) { this.listeners.set(kind, callback); }
    close() { this.closed = true; }
    emit(event) { this.listeners.get(event.type)?.({ data: JSON.stringify(event) }); }
  }
  const mod = { exports: {} };
  const source = fs.readFileSync(path.resolve(__dirname, "../components/ask/ask-workbench.tsx"), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const localRequire = (name) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "@/lib/api") return { api, AUTH_ACCOUNT_CHANGED_EVENT: "changed", AUTH_UNAUTHORIZED_EVENT: "unauthorized" };
    if (name === "@/lib/auth") return { useAuth: () => ({ user: { member_no: memberNo } }), refreshAuth: async () => {} };
    if (name === "./use-conversation-scroll") return { useConversationScroll: () => ({
      scrollRef: { current: null }, contentRef: { current: null }, followLatest() {},
    }) };
    return new Proxy({}, { get: (_, key) => key });
  };
  const storageKeys = [];
  const storageWrites = [];
  new Function("require", "module", "exports", "window", "localStorage", "EventSource", code)(
    localRequire, mod, mod.exports, Object.assign(new EventTarget(), { history: { replaceState() {} } }),
    { getItem(key) { storageKeys.push(key); return savedSession; }, setItem(key) { storageKeys.push(key); storageWrites.push(key); }, removeItem(key) { storageKeys.push(key); } }, EventSource,
  );
  const render = () => {
    cursor = 0;
    const tree = mod.exports.AskWorkbench({ initialSessionId });
    const effects = pendingEffects;
    pendingEffects = [];
    effects.forEach((effect) => effect());
    return tree;
  };
  render();
  return { render, streams, storageKeys, storageWrites, unmount() { slots.forEach(slot => slot?.cleanup?.()); } };
}

function find(tree, predicate) {
  if (!tree || typeof tree !== "object") return undefined;
  if (Array.isArray(tree)) {
    for (const child of tree) { const match = find(child, predicate); if (match) return match; }
    return undefined;
  }
  if (predicate(tree)) return tree;
  return find(tree.props?.children, predicate);
}
const sessionItem = (tree, id) => find(tree, (item) => item.type === "SessionListItem" && item.props.session.id === id);
const header = (tree) => find(tree, (item) => item.type === "h1").props.children;
const sendButton = (tree) => find(tree, (item) => item.type === "Button" && item.props.children?.includes("发送"));

function fixture({ sessionRefresh } = {}) {
  const sessions = [emptySession("first"), emptySession("second", "其他会话")];
  let accepted = false;
  let finished = false;
  const calls = [];
  const run = runningRun("run", "first");
  const api = async (url, options = {}) => {
    calls.push([url, options.method ?? "GET"]);
    if (url === "/semantic/queryable-tables") return { items: [] };
    if (url === "/models/available") return [{ id: "model", displayName: "模型", thinkingLevels: ["off"] }];
    if (url === "/ask/sessions") return { items: sessions };
    if (url === "/ask/sessions/first/runs" && options.method === "POST") {
      accepted = true;
      return run;
    }
    if (url.endsWith("/runs")) return { items: [] };
    if (url === "/ask/runs/run") return { ...run, status: finished ? "SUCCEEDED" : "RUNNING", event_cursor: finished ? 2 : 0 };
    if (url === "/ask/sessions/first" && accepted) {
      if (sessionRefresh) return sessionRefresh.promise;
      return { ...sessions[0], title: "查询店铺销售趋势", active_run: finished ? null : { id: "run", status: "RUNNING" } };
    }
    if (url === "/ask/sessions/first") return sessions[0];
    if (url === "/ask/sessions/second") return sessions[1];
    throw new Error("Unexpected API request: " + url);
  };
  return { api, calls, finish() { finished = true; } };
}

async function enterQuestion(view) {
  await flush();
  const tree = view.render();
  find(tree, (item) => item.type === "InputGroupTextarea").props.onChange({ target: { value: "查询店铺销售趋势" } });
  return view.render();
}

test("accepted first question updates sidebar and header titles before the run finishes", async () => {
  const data = fixture();
  const view = mountWorkbench(data.api);
  const tree = await enterQuestion(view);
  assert.equal(header(tree), "新对话");
  await sendButton(tree).props.onClick();
  await flush();
  const updated = view.render();
  assert.equal(header(updated), "查询店铺销售趋势");
  assert.equal(sessionItem(updated, "first").props.session.title, "查询店铺销售趋势");
  assert.equal(sessionItem(updated, "first").props.busy, true);
  assert.ok(data.calls.some(([url, method]) => url === "/ask/sessions/first/runs" && method === "POST"));
  assert.ok(data.calls.filter(([url]) => url === "/ask/sessions/first").length >= 2);
});

test("late title refresh cannot replace the newly selected conversation", async () => {
  const sessionRefresh = deferred();
  const view = mountWorkbench(fixture({ sessionRefresh }).api);
  const tree = await enterQuestion(view);
  sendButton(tree).props.onClick();
  await flush();
  sessionItem(view.render(), "second").props.onSelect();
  await flush();
  assert.equal(header(view.render()), "其他会话");
  sessionRefresh.resolve({ ...emptySession("first"), title: "查询店铺销售趋势" });
  await flush();
  assert.equal(header(view.render()), "其他会话");
});

test("terminal run refresh clears sidebar busy metadata as well as the running icon", async () => {
  const data = fixture();
  const view = mountWorkbench(data.api);
  const tree = await enterQuestion(view);
  sendButton(tree).props.onClick();
  await flush();
  view.render();
  data.finish();
  view.streams[0].emit({ sequence: 2, type: "status", payload: { status: "SUCCEEDED" } });
  await flush();
  const completed = view.render();
  assert.equal(sessionItem(completed, "first").props.busy, false);
  assert.equal(sessionItem(completed, "first").props.session.active_run, null);
});

test("clarification keys survive SSE refresh, change on a new question/session, and late replies cannot overwrite another session", async () => {
  let current = { ...runningRun("run", "first"), status: "WAITING_CLARIFICATION", clarification: { id: "c1", question: "选择", selection_mode: "single", options: [{ id: "A", summary: "收入", description: "收入范围" }], response: null, answer: null } };
  const pending = deferred();
  let body;
  const api = async (url, options = {}) => {
    if (url === "/semantic/queryable-tables") return { items: [] };
    if (url === "/models/available") return [{ id: "model", displayName: "模型", thinkingLevels: ["off"] }];
    if (url === "/ask/sessions") return { items: [emptySession("first"), emptySession("second")] };
    if (url === "/ask/sessions/first") return emptySession("first");
    if (url === "/ask/sessions/second") return emptySession("second");
    if (url.endsWith("/runs")) return { items: [{ ...current, session_id: url.includes("second") ? "second" : "first" }] };
    if (url === "/ask/runs/run") return current;
    if (url === "/ask/runs/run/clarifications") { body = JSON.parse(options.body); return pending.promise; }
    throw new Error("Unexpected request: " + url);
  };
  const view = mountWorkbench(api);
  await flush();
  const card1 = find(view.render(), item => item.type === "ClarificationCard");
  assert.equal(card1.key, "first:run:c1");
  view.streams.at(-1).emit({ sequence: 1, type: "processing", payload: { step: { status: "SUCCEEDED" } } });
  await flush();
  assert.equal(find(view.render(), item => item.type === "ClarificationCard").key, card1.key);
  current = { ...current, clarification: { ...current.clarification, id: "c2" }, event_cursor: 2 };
  view.streams.at(-1).emit({ sequence: 2, type: "clarification", payload: {} });
  await flush();
  const card2 = find(view.render(), item => item.type === "ClarificationCard");
  assert.equal(card2.key, "first:run:c2");
  const response = { clarification_id: "c2", selected_option_ids: ["A"], custom_text: "2026 年 8 月" };
  const submitted = card2.props.onSubmit(response);
  assert.deepEqual(body, response);
  await sessionItem(view.render(), "second").props.onSelect(); await flush();
  assert.equal(find(view.render(), item => item.type === "ClarificationCard").key, "second:run:c2");
  pending.resolve({ ...current, status: "RUNNING", session_id: "first" });
  await submitted;
  assert.equal(find(view.render(), item => item.type === "ClarificationCard").key, "second:run:c2");
});

test("old pending clarification is explicit and cannot render the new selection cards", async () => {
  const run = { ...runningRun("old", "first"), status: "WAITING_CLARIFICATION", clarification: null };
  const api = async url => {
    if (url === "/semantic/queryable-tables") return { items: [] };
    if (url === "/models/available") return [];
    if (url === "/ask/sessions") return { items: [emptySession("first")] };
    if (url === "/ask/sessions/first") return emptySession("first");
    if (url.endsWith("/runs")) return { items: [run] };
    throw new Error(url);
  };
  const view = mountWorkbench(api); await flush();
  const tree = view.render();
  assert.equal(find(tree, item => item.type === "ClarificationCard"), undefined);
  assert.match(find(tree, item => item.props?.role === "alert").props.children, /停止本轮后重新提问/);
});
test("a late clarification POST response cannot replace newer SSE run details", async () => {
  const pending = deferred();
  let run = { ...runningRun("run", "first"), status: "WAITING_CLARIFICATION", clarification: { id: "c", question: "请选择", selection_mode: "multiple", options: [] } };
  const api = async (url, options = {}) => {
    if (url === "/semantic/queryable-tables") return { items: [] };
    if (url === "/models/available") return [];
    if (url === "/ask/sessions") return { items: [emptySession("first")] };
    if (url === "/ask/sessions/first") return emptySession("first");
    if (url.endsWith("/runs")) return { items: [run] };
    if (url === "/ask/runs/run/clarifications" && options.method === "POST") return pending.promise;
    if (url === "/ask/runs/run") return run;
    throw new Error(url);
  };
  const view = mountWorkbench(api); await flush();
  const tree = view.render();
  const waiting = { ...run };
  const submit = find(tree, item => item.type === "ClarificationCard").props.onSubmit({ clarification_id: "c", selected_option_ids: [], custom_text: "自己的范围" });
  run = { ...run, status: "SUCCEEDED", event_cursor: 3 };
  view.streams.at(-1).emit({ sequence: 3, type: "status", payload: { status: "SUCCEEDED" } });
  await flush();
  pending.resolve({ ...waiting, status: "RUNNING", event_cursor: 1 });
  await submit;
  const finished = view.render();
  assert.equal(find(finished, item => item.type === "RunAnswer").props.run.status, "SUCCEEDED");
  assert.equal(find(finished, item => item.type === "ClarificationCard"), undefined);
});
test("native EventSource connection errors do not parse undefined, fail the run, or block reconnection", async () => {
  const data = fixture();
  const view = mountWorkbench(data.api);
  await sendButton(await enterQuestion(view)).props.onClick(); await flush();
  view.render();
  const stream = view.streams.at(-1);
  const handleError = stream.listeners.get("error");
  assert.doesNotThrow(() => handleError(new Event("error")));
  assert.equal(find(view.render(), item => item.type === "RunAnswer").props.run.status, "RUNNING");
  // The browser reopens the same stream; onopen reloads any missed persisted updates.
  data.finish();
  stream.onopen();
  await flush();
  assert.equal(find(view.render(), item => item.type === "RunAnswer").props.run.status, "SUCCEEDED");
});

test("business error messages still refresh run details while empty and malformed SSE data never crash", async () => {
  const data = fixture();
  const view = mountWorkbench(data.api);
  await sendButton(await enterQuestion(view)).props.onClick(); await flush();
  view.render();
  const stream = view.streams.at(-1);
  const handleError = stream.listeners.get("error");
  const refreshes = () => data.calls.filter(([url]) => url === "/ask/runs/run").length;
  const before = refreshes();
  for (const data of [undefined, "", " \n "]) assert.doesNotThrow(() => handleError({ type: "error", data }));
  assert.equal(refreshes(), before);
  for (const data of ["undefined", "{broken", "null", "{}", '{"sequence":1,"type":"error","payload":null}']) {
    assert.doesNotThrow(() => stream.onmessage({ data }));
  }
  const alert = find(view.render(), item => item.type === "FloatingAlert");
  assert.match(alert.props.children ?? alert.props.message ?? "", /实时事件/);
  data.finish();
  handleError({ type: "error", data: JSON.stringify({ sequence: 1, type: "error", payload: { message: "模型调用失败" } }) });
  await flush();
  assert.ok(refreshes() > before);
  assert.equal(find(view.render(), item => item.type === "RunAnswer").props.run.status, "SUCCEEDED");
});

test("SSE message validation cannot report a late error into another conversation", async () => {
  const data = fixture();
  const view = mountWorkbench(data.api);
  await sendButton(await enterQuestion(view)).props.onClick(); await flush();
  view.render();
  const oldStream = view.streams.at(-1);
  await sessionItem(view.render(), "second").props.onSelect(); await flush();
  assert.doesNotThrow(() => oldStream.onmessage({ data: "{broken" }));
  assert.equal(header(view.render()), "其他会话");
  const alert = find(view.render(), item => item.type === "FloatingAlert");
  assert.equal(alert, undefined);
});

test("explicit conversation links load even outside the first history page", async () => {
  const calls = [];
  const api = async url => {
    calls.push(url);
    if (url === "/semantic/queryable-tables") return { items: [] };
    if (url === "/models/available") return [];
    if (url === "/ask/sessions") return { items: [emptySession("first")] };
    if (url === "/ask/sessions/older") return emptySession("older", "旧的个人会话");
    if (url === "/ask/sessions/older/runs") return { items: [] };
    throw new Error(url);
  };
  const view = mountWorkbench(api, { initialSessionId: "older", memberNo: "A" }); await flush();
  assert.equal(header(view.render()), "旧的个人会话");
  assert.ok(sessionItem(view.render(), "older"));
  assert.deepEqual(view.storageKeys, ["atlas.ask.last-session:A"]);
  assert.equal(calls.includes("/ask/sessions/first"), false);
});

test("inaccessible explicit links show an error and never silently open another conversation", async () => {
  const calls = [];
  const api = async url => {
    calls.push(url);
    if (url === "/semantic/queryable-tables") return { items: [] };
    if (url === "/models/available") return [];
    if (url === "/ask/sessions") return { items: [emptySession("own")] };
    if (url.startsWith("/ask/sessions/foreign")) throw Object.assign(new Error("not found"), { status: 404 });
    throw new Error(url);
  };
  const view = mountWorkbench(api, { initialSessionId: "foreign" }); await flush();
  const tree = view.render();
  assert.equal(find(tree, item => item.props?.role === "alert").props.children, "会话不存在或无法访问");
  assert.equal(find(tree, item => item.props?.href === "/query/ask").props.children, "返回我的问数列表");
  assert.equal(calls.includes("/ask/sessions/own"), false);
  assert.equal(calls.includes("/auth/logout"), false);
});

test("last-session memory is namespaced and unmount closes streams and discards late loads", async () => {
  const data = fixture();
  const view = mountWorkbench(data.api, { memberNo: "B" }); await flush();
  await sendButton(await enterQuestion(view)).props.onClick(); await flush(); view.render();
  assert.ok(view.storageKeys.every(key => key === "atlas.ask.last-session:B"));
  view.unmount();
  assert.ok(view.streams.every(stream => stream.closed));

  const pending = deferred();
  const api = async url => {
    if (url === "/semantic/queryable-tables") return { items: [] };
    if (url === "/models/available") return [];
    if (url === "/ask/sessions") return { items: [emptySession("first")] };
    if (url === "/ask/sessions/first") return pending.promise;
    if (url.endsWith("/runs")) return { items: [] };
    throw new Error(url);
  };
  const lateView = mountWorkbench(api); await flush();
  lateView.unmount();
  pending.resolve(emptySession("first")); await flush();
  assert.deepEqual(lateView.storageWrites, []);
});
