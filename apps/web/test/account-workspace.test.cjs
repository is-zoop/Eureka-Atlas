/* eslint-disable @typescript-eslint/no-require-imports -- Node unit tests transpile client boundaries without a browser. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

test("auth gate remounts by member and role and hides workspaces during revalidation or outage", () => {
  let state = { status: "authenticated", user: { member_no: "A", role_code: "USER" } };
  const source = fs.readFileSync(path.join(__dirname, "../components/auth/auth-gate.tsx"), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const mod = { exports: {} };
  const localRequire = name => {
    if (name === "@eureka-atlas/types") return require(name);
    if (name === "react") return { useEffect() {} };
    if (name === "react/jsx-runtime") return require(name);
    if (name === "next/navigation") return { usePathname: () => "/query/ask", useRouter: () => ({ replace() {} }) };
    if (name === "@/lib/auth") return { useAuth: () => state };
    if (name === "@/components/layout/app-shell") return { AppShell: "AppShell" };
    if (name === "@/components/ui/button") return { Button: "Button" };
    return {};
  };
  new Function("module", "exports", "require", code)(mod, mod.exports, localRequire);
  const render = () => mod.exports.AuthGate({ children: "private-workspace" });
  assert.equal(render().key, "A:USER");
  state = { status: "authenticated", user: { member_no: "A", role_code: "ADMIN" } };
  assert.equal(render().key, "A:ADMIN");
  state = { status: "authenticated", user: { member_no: "B", role_code: "USER" } };
  assert.equal(render().key, "B:USER"); assert.equal(render().props.children, "private-workspace");
  state = { status: "loading", user: null };
  assert.notEqual(render().type, "AppShell");
  state = { status: "unavailable", user: { member_no: "A" }, error: "服务不可用" };
  assert.notEqual(render().type, "AppShell"); assert.equal(render().props.role, "alert");
});
