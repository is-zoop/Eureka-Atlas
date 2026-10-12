import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getApplication, type WpsApplication } from "../src/lib/host.ts";
import { createPaneController } from "../src/lib/taskpane.ts";
import { addonConfig, manageAddon, type AddonManager, type SdkResult } from "../src/lib/installer.ts";

test("ordinary browser cannot obtain a fake WPS application", () => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  try { assert.throws(getApplication, /未连接 WPS/); }
  finally { Reflect.deleteProperty(globalThis, "window"); }
});

test("compact pane removes prose and dark borders, with help next to the external query action", () => {
  const code = readFileSync(new URL("../src/ui/atlas-panel.tsx", import.meta.url), "utf8");
  assert.ok(!code.includes("我的查询 · 手动刷新"));
  assert.ok(!code.includes("使用 Haze 手机号和密码。密码不保存"));
  assert.ok(!code.includes("border-primary"));
  assert.ok(code.includes('<Compass className="size-8'));
  assert.ok(code.includes("'/auth/restore'"));
  assert.ok(!code.includes("执行时读取最新配置；"));
  assert.ok(!code.includes("继续读取上次任务</Button>"));
  assert.ok(!code.includes("停止本地读取（不取消任务）</Button>"));
  const actions = code.slice(code.indexOf('<div className="space-y-3">'));
  assert.ok(actions.indexOf("查询／刷新工作表</Button>") < actions.indexOf('<TooltipProvider'));
  assert.ok(actions.includes('aria-label="查询与刷新说明"'));
  assert.ok(actions.indexOf("首次导入新建专用结果表") < actions.indexOf("</TooltipContent>"));
  assert.ok(actions.includes('"取消查询"'));
});
test("pane uses same-origin deployment path and is reused after hiding", () => {
  const created = { Visible: false, DockPosition: 0, Width: 0 };
  const urls: string[] = [];
  const app: WpsApplication = { ActiveWorkbook: null, CreateTaskPane: url => { urls.push(url); return created; } };
  const show = createPaneController();
  show(app, "https://atlas.example/wps/");
  assert.deepEqual(urls, ["https://atlas.example/wps/taskpane.html"]);
  assert.equal(created.Visible, true); assert.equal(created.DockPosition, 2); assert.equal(created.Width, 360);
  created.Visible = false; show(app, "https://atlas.example/wps/");
  assert.equal(urls.length, 1); assert.equal(created.Visible, true);
});

function mockManager(failure?: "getAllConfig" | "verifyStatus" | "enable" | "disable") {
  const calls: string[] = [];
  const manager: AddonManager = {
    getAllConfig(callback) { calls.push("getAllConfig"); callback(failure === "getAllConfig" ? { status: 4, message: "当前客户端不支持" } : { status: 0, response: "[]" }); },
    verifyStatus(addon, callback) { calls.push(`verifyStatus:${addon.name}`); callback(failure === "verifyStatus" ? { status: 1, msg: "ribbon.xml 无效" } : { status: 0, msg: "OK" }); },
    enable(addon, callback) { calls.push(`enable:${addon.name}`); callback(failure === "enable" ? { status: 1, message: "请允许浏览器打开WPS Office" } : { status: 0, response: "OK" }); },
    disable(addon, callback) { calls.push(`disable:${addon.name}`); callback(failure === "disable" ? { status: 1, message: "卸载失败" } : { status: 0, response: "OK" }); },
  };
  return { manager, calls };
}

test("install targets only Atlas ET using its exact hosting directory", async () => {
  const config = addonConfig("https://atlas.example/tools/wps/publish.html");
  assert.deepEqual(config, { name: "AtlasWpsProbe", addonType: "et", online: "true", version: "0.4.1", url: "https://atlas.example/tools/wps/" });
  const mock = mockManager();
  await manageAddon(mock.manager, config, "install");
  assert.deepEqual(mock.calls, ["getAllConfig", "verifyStatus:AtlasWpsProbe", "enable:AtlasWpsProbe"]);
});

test("uninstall affects only Atlas, even when its service is no longer accessible", async () => {
  const mock = mockManager("verifyStatus");
  await manageAddon(mock.manager, addonConfig("http://127.0.0.1:3889/publish.html"), "uninstall");
  assert.deepEqual(mock.calls, ["getAllConfig", "disable:AtlasWpsProbe"]);
});

for (const failure of ["getAllConfig", "verifyStatus", "enable", "disable"] as const) {
  test(`native ${failure} error is not reported as installation success`, async () => {
    const mock = mockManager(failure);
    await assert.rejects(manageAddon(mock.manager, addonConfig("http://127.0.0.1:3889/publish.html"), failure === "disable" ? "uninstall" : "install"));
    if (failure === "getAllConfig") assert.equal(mock.calls.length, 1);
    if (failure === "verifyStatus") assert.equal(mock.calls.length, 2);
  });
}

test("transport success without native OK is not considered confirmed", async () => {
  const mock = mockManager();
  mock.manager.enable = (_addon, callback) => callback({ status: 0, response: "FAILED" });
  await assert.rejects(manageAddon(mock.manager, addonConfig("http://127.0.0.1:3889/publish.html"), "install"), /未确认配置成功/);
});

test("unanswered native call times out with an explicit unknown-outcome warning", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const mock = mockManager();
  mock.manager.getAllConfig = () => {};
  const waiting = manageAddon(mock.manager, addonConfig("http://127.0.0.1:3889/publish.html"), "install");
  const assertion = assert.rejects(waiting, /先重启 WPS 确认是否生效/);
  context.mock.timers.tick(30_001);
  await assertion;
});

test("late native callback after timeout cannot proceed to install", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const mock = mockManager();
  let nativeCallback: ((result: SdkResult) => void) | undefined;
  mock.manager.getAllConfig = (callback) => { nativeCallback = callback; };
  const waiting = manageAddon(mock.manager, addonConfig("http://127.0.0.1:3889/publish.html"), "install");
  const assertion = assert.rejects(waiting);
  context.mock.timers.tick(30_001);
  await assertion;
  nativeCallback?.({ status: 0, response: "[]" });
  assert.deepEqual(mock.calls, []);
});

test("every Ribbon XML callback is registered globally, with Lucide icons", () => {
  const ribbon = readFileSync(new URL("../public/ribbon.xml", import.meta.url), "utf8");
  const code = readFileSync(new URL("../src/ribbon.ts", import.meta.url), "utf8");
  for (const match of ribbon.matchAll(/(?:onLoad|onAction|getImage|getPressed)="([^"]+)"/g)) assert.ok(code.includes(`window.${match[1]} =`));
  assert.ok(ribbon.startsWith("<customUI"));
  assert.ok(ribbon.includes('label="Atlas"'));
  assert.ok(code.includes("images/atlas.png")); assert.ok(code.includes('images/refresh-cw.png')); assert.ok(code.includes('images/info.png'));
  assert.ok(ribbon.indexOf('id="AtlasUpdateAll"') > ribbon.indexOf('id="AtlasOpenPane"'));
  assert.ok(ribbon.includes('label="刷新覆盖"')); assert.ok(!ribbon.includes('JS调试器'));
  const registration = readFileSync(new URL('../installer/Registration.cs', import.meta.url), 'utf8');
  assert.ok(!registration.includes('new XAttribute("debug"'));
});

test("installer imports native SDK only inside manual action, without automatic mount hooks", () => {
  const code = readFileSync(new URL("../src/publish.tsx", import.meta.url), "utf8");
  assert.ok(code.indexOf('await import("wpsjs-rpc-sdk-new")') > code.indexOf("async function manage("));
  assert.ok(!code.includes("useEffect"));
  assert.ok(!code.includes("disableall"));
});
