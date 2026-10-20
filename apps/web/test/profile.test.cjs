/* eslint-disable @typescript-eslint/no-require-imports -- Node tests render actual client components with deterministic hooks. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const user = { member_no: "A", name: "测试用户", phone: "13800000000", email: null, avatar_url: null, department: "研发", role_code: "USER", role_name: "使用者", status: "active" };
const credential = { id: 1, name: "Personal Service Access Credential", masked_key: "haze_********last", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z" };
const secret = "haze_explicit_secret_for_copy";
function flatten(node) { if (Array.isArray(node)) return node.flatMap(flatten); if (!node || typeof node !== "object") return []; return [node, ...flatten(node.props?.children)]; }
function text(node) { if (Array.isArray(node)) return node.map(text).join(""); if (node == null || typeof node === "boolean") return ""; return typeof node === "object" ? text(node.props?.children) : String(node); }
function fixture(relative, component, props = {}, overrides = {}) {
  const slots = [], deps = [], cleanups = [], pending = [], calls = [], copied = [], updated = [];
  let cursor = 0, effectIndex = 0;
  const profile = Object.fromEntries(["getPersonalCredential", "revealPersonalCredential", "resetPersonalCredential", "updateProfileAvatar", "resetOwnPassword"].map(name => [name, async (...args) => {
    calls.push({ name, args });
    if (overrides[name]) return overrides[name](...args);
    if (name === "updateProfileAvatar") return { ...user, avatar_url: args[0] };
    if (name === "getPersonalCredential") return credential;
    return { ...credential, key: secret };
  }]));
  const react = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect(fn, next) { const index = effectIndex++; if (!deps[index] || next.some((value, i) => value !== deps[index][i])) { deps[index] = next; pending.push(() => { cleanups[index]?.(); cleanups[index] = fn(); }); } },
  };
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, relative), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  const requireModule = name => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "next/link") return { __esModule: true, default: "Link" };
    if (name === "next/navigation") return { useRouter: () => ({ replace() {} }) };
    if (name === "@/lib/profile") return profile;
    if (name === "@/lib/profile-avatar") return { normalizeAvatar: async () => "data:image/jpeg;base64,YWJjZA==" };
    if (name === "@/lib/auth") return { updateAuthUser: value => updated.push(value) };
    return new Proxy({}, { get: (_, property) => property === "__esModule" ? false : String(property) });
  };
  new Function("module", "exports", "require", "navigator", code)(mod, mod.exports, requireModule, { clipboard: { writeText: async value => { if (overrides.clipboardError) throw new Error("denied"); copied.push(value); } } });
  return { calls, copied, updated, slots,
    render() { cursor = 0; effectIndex = 0; return mod.exports[component](props); },
    async flush() { for (const run of pending.splice(0)) run(); await new Promise(resolve => setImmediate(resolve)); },
    unmount() { cleanups.forEach(fn => fn?.()); },
  };
}
const button = (tree, label) => flatten(tree).find(node => node.type === "Button" && text(node) === label);

test("personal center loads no credential panel until selected and removes it on leaving the tab", () => {
  const f = fixture("../components/profile/personal-center.tsx", "PersonalCenter", { user });
  let tree = f.render();
  assert.ok(flatten(tree).some(node => node.type === "PersonalSettings"));
  assert.equal(flatten(tree).some(node => node.type === "PersonalCredentialPanel"), false);
  flatten(tree).find(node => node.type === "Tabs").props.onValueChange("credentials"); tree = f.render();
  assert.ok(flatten(tree).some(node => node.type === "PersonalCredentialPanel" && node.key === "A"));
  flatten(tree).find(node => node.type === "Tabs").props.onValueChange("settings"); tree = f.render();
  assert.equal(flatten(tree).some(node => node.type === "PersonalCredentialPanel"), false);
});

test("user menu exposes the personal center without exposing unrelated Haze management", () => {
  const f = fixture("../components/layout/user-menu.tsx", "UserMenu", { user });
  const nodes = flatten(f.render());
  const menu = nodes.find(node => node.type === "DropdownMenuContent");
  assert.equal(menu.props.side, "top");
  assert.equal(menu.props.align, "start");
  assert.equal(menu.props.sideOffset, 8);
  assert.equal(menu.props.collisionPadding, 12);
  assert.ok(nodes.some(node => node.type === "Link" && node.props.href === "/profile" && text(node).includes("个人中心")));
  assert.equal(nodes.some(node => node.type === "Link" && String(node.props.href).includes("Haze")), false);
});

test("personal settings display six read-only Haze fields and save a processed avatar into auth state", async () => {
  const f = fixture("../components/profile/personal-settings.tsx", "PersonalSettings", { user });
  let tree = f.render(); await f.flush();
  assert.deepEqual(flatten(tree).filter(node => node.type === "ProfileInfo").map(node => node.props.label), ["姓名", "工号", "手机号", "邮箱", "部门", "角色"]);
  assert.equal(button(tree, "保存头像").props.disabled, true);
  const input = flatten(tree).find(node => node.type === "input");
  input.props.onChange({ target: { value: "file.jpg", files: [{}] } }); await f.flush(); tree = f.render();
  assert.equal(button(tree, "保存头像").props.disabled, false);
  button(tree, "保存头像").props.onClick(); await f.flush(); tree = f.render();
  assert.equal(f.calls.at(-1).name, "updateProfileAvatar");
  assert.equal(f.updated[0].avatar_url, "data:image/jpeg;base64,YWJjZA==");
  assert.ok(text(tree).includes("头像已同步到 Haze"));
});

test("a late avatar response cannot update user state after the profile unmounts", async () => {
  let finish;
  const f = fixture("../components/profile/personal-settings.tsx", "PersonalSettings", { user }, { updateProfileAvatar: () => new Promise(resolve => { finish = resolve; }) });
  let tree = f.render(); await f.flush();
  flatten(tree).find(node => node.type === "input").props.onChange({ target: { value: "", files: [{}] } }); await f.flush(); tree = f.render();
  button(tree, "保存头像").props.onClick();
  f.unmount(); finish({ ...user, avatar_url: "late" }); await f.flush();
  assert.equal(f.calls.at(-1).args[1].aborted, true); assert.deepEqual(f.updated, []);
});

test("password dialog validates confirmation and retains current input after an actionable error", async () => {
  const f = fixture("../components/profile/password-dialog.tsx", "PasswordDialog", { open: true, onOpenChange() {} }, { resetOwnPassword: async () => { throw new Error("当前密码不正确，请重试。"); } });
  let tree = f.render(); await f.flush();
  const set = (key, value) => { flatten(tree).find(node => node.type === "Input" && node.props.id.endsWith(key)).props.onChange({ target: { value } }); tree = f.render(); };
  const submit = () => flatten(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  set("current", "test-password"); set("next", "new-password"); set("confirm", "mismatch");
  submit(); await f.flush(); tree = f.render(); assert.equal(f.calls.length, 0); assert.ok(text(tree).includes("两次输入的新密码不一致"));
  set("confirm", "new-password"); submit(); await f.flush(); tree = f.render();
  assert.equal(f.calls.at(-1).name, "resetOwnPassword"); assert.ok(text(tree).includes("当前密码不正确"));
  assert.equal(flatten(tree).find(node => node.type === "Input" && node.props.id.endsWith("current")).props.value, "test-password");
});

test("credential panel fetches metadata only, and copying gets a secret without keeping it in component state", async () => {
  const f = fixture("../components/profile/personal-credential.tsx", "PersonalCredentialPanel");
  f.render(); await f.flush(); let tree = f.render();
  assert.deepEqual(f.calls.map(call => call.name), ["getPersonalCredential"]); assert.ok(text(tree).includes(credential.masked_key));
  assert.equal(JSON.stringify(f.slots).includes(secret), false);
  button(tree, "复制凭证").props.onClick(); await f.flush(); tree = f.render();
  assert.equal(f.calls.at(-1).name, "revealPersonalCredential"); assert.deepEqual(f.copied, [secret]);
  assert.equal(JSON.stringify(f.slots).includes(secret), false); assert.equal(text(tree).includes(secret), false); assert.ok(button(tree, "已复制"));
  f.unmount();
});

test("credential reset needs explicit confirmation, can hide the new key, and aborts requests on unmount", async () => {
  const f = fixture("../components/profile/personal-credential.tsx", "PersonalCredentialPanel");
  f.render(); await f.flush(); let tree = f.render();
  button(tree, "重置凭证").props.onClick(); tree = f.render();
  assert.equal(flatten(tree).find(node => node.type === "Dialog").props.open, true);
  assert.equal(f.calls.filter(call => call.name === "resetPersonalCredential").length, 0);
  button(tree, "确认重置").props.onClick(); await f.flush(); tree = f.render();
  assert.equal(f.calls.at(-1).name, "resetPersonalCredential"); assert.ok(text(tree).includes(secret));
  button(tree, "隐藏").props.onClick(); tree = f.render(); assert.equal(text(tree).includes(secret), false);
  f.unmount();
  const next = fixture("../components/profile/personal-credential.tsx", "PersonalCredentialPanel");
  next.render(); await next.flush(); assert.equal(text(next.render()).includes(secret), false); next.unmount();
  let finish;
  const late = fixture("../components/profile/personal-credential.tsx", "PersonalCredentialPanel", {}, { getPersonalCredential: () => new Promise(resolve => { finish = resolve; }) });
  late.render(); await late.flush(); late.unmount();
  assert.equal(late.calls[0].args[0].aborted, true); finish(credential); await late.flush();
  assert.equal(late.slots.some(value => value === credential), false);
});

test("credential failures offer retry instead of pretending a key is being generated; clipboard rejection is actionable", async () => {
  let fail = true;
  const f = fixture("../components/profile/personal-credential.tsx", "PersonalCredentialPanel", {}, { getPersonalCredential: async () => { if (fail) throw new Error("Haze 暂时不可用"); return credential; }, clipboardError: true });
  f.render(); await f.flush(); let tree = f.render();
  assert.ok(text(tree).includes("Haze 暂时不可用")); assert.ok(button(tree, "重新读取"));
  fail = false; button(tree, "重新读取").props.onClick(); f.render(); await f.flush(); tree = f.render();
  button(tree, "复制凭证").props.onClick(); await f.flush(); tree = f.render();
  assert.ok(text(tree).includes("复制失败")); assert.equal(JSON.stringify(f.slots).includes(secret), false); f.unmount();
});
