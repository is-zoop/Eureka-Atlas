const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function setup() {
  let top = 0;
  let writes = 0;
  const listeners = new Map();
  const viewport = {
    scrollHeight: 1000, clientHeight: 400,
    get scrollTop() { return top; },
    set scrollTop(value) { top = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight)); writes++; },
    addEventListener(kind, callback) { listeners.set(kind, callback); },
    removeEventListener(kind, callback) { if (listeners.get(kind) === callback) listeners.delete(kind); },
  };
  const content = {};
  const frames = new Map();
  let frameId = 0;
  let observer;
  class ResizeObserver {
    constructor(callback) { this.callback = callback; this.elements = []; observer = this; }
    observe(element) { this.elements.push(element); }
    disconnect() { this.disconnected = true; }
  }
  const code = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, "../components/ask/use-conversation-scroll.ts"), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", "ResizeObserver", "requestAnimationFrame", "cancelAnimationFrame", code)(
    require, mod, mod.exports, ResizeObserver,
    (callback) => { frames.set(++frameId, callback); return frameId; },
    (id) => frames.delete(id),
  );
  const controller = mod.exports.attachConversationScroll(viewport, content);
  return {
    viewport, content, controller, observer,
    get writes() { return writes; },
    get pendingFrames() { return frames.size; },
    get listenerCount() { return listeners.size; },
    flush() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback()); },
    scrollTo(value) { viewport.scrollTop = value; listeners.get("scroll")?.(); },
    resize(height) { viewport.scrollHeight = height; observer.callback(); },
    emitScroll() { listeners.get("scroll")?.(); },
  };
}

test("conversation starts at the latest content and follows streamed growth and viewport resizing", () => {
  const view = setup();
  assert.deepEqual(view.observer.elements, [view.content, view.viewport]);
  view.flush();
  assert.equal(view.viewport.scrollTop, 600);
  view.resize(1200);
  view.emitScroll(); // Growth may fire scroll before ResizeObserver's queued frame.
  view.flush();
  assert.equal(view.viewport.scrollTop, 800);
  view.resize(1600); // Processing details, final tables or charts become taller.
  view.flush();
  assert.equal(view.viewport.scrollTop, 1200);
  view.viewport.clientHeight = 300;
  view.resize(1600);
  view.flush();
  assert.equal(view.viewport.scrollTop, 1300);
});

test("reading earlier messages pauses following and returning to the bottom resumes it", () => {
  const view = setup();
  view.flush();
  view.scrollTo(200);
  view.resize(1400);
  view.flush();
  assert.equal(view.viewport.scrollTop, 200);
  view.scrollTo(1000);
  view.resize(1700);
  view.flush();
  assert.equal(view.viewport.scrollTop, 1300);
});

test("manual upward scroll also cancels a pending automatic follow", () => {
  const view = setup();
  view.flush();
  view.resize(1400);
  view.scrollTo(300);
  view.flush();
  assert.equal(view.viewport.scrollTop, 300);
});

test("sending a new question explicitly resumes following after reading history", () => {
  const view = setup();
  view.flush();
  view.scrollTo(100);
  view.controller.followLatest();
  view.resize(1500);
  view.flush();
  assert.equal(view.viewport.scrollTop, 1100);
});

test("resize events share one animation frame and cleanup cancels all scroll work", () => {
  const view = setup();
  view.resize(1200);
  view.resize(1600);
  assert.equal(view.pendingFrames, 1);
  view.flush();
  assert.equal(view.writes, 1);
  view.resize(1800);
  view.controller.dispose();
  assert.equal(view.pendingFrames, 0);
  assert.equal(view.listenerCount, 0);
  assert.equal(view.observer.disconnected, true);
  view.flush();
  assert.equal(view.viewport.scrollTop, 1200);
  const nextSession = setup();
  nextSession.flush();
  assert.equal(nextSession.viewport.scrollTop, 600);
});
