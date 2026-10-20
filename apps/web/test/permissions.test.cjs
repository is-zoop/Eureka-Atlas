/* eslint-disable @typescript-eslint/no-require-imports -- Test client components without browser automation. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function load(relative, { role = "USER", status = "authenticated", pathname = "/", effects = [], replace = () => {}, states = [] } = {}) {
  let stateIndex = 0;
  const source = fs.readFileSync(path.join(__dirname, relative), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const localRequire = name => {
    if (name === "@eureka-atlas/types") return require(name);
    if (name === "react") return { Suspense: "Suspense", useEffect: fn => effects.push(fn), useCallback: fn => fn, useMemo: fn => fn(), useState: initial => [stateIndex in states ? states[stateIndex++] : (stateIndex++, initial), () => {}] };
    if (name === "react/jsx-runtime") return require(name);
    if (name === "next/link") return { __esModule: true, default: "Link" };
    if (name === "next/navigation") return { usePathname: () => pathname, useRouter: () => ({ replace }), useSearchParams: () => new URLSearchParams() };
    if (name === "@/lib/auth") return { useAuth: () => ({ status, user: status === 'authenticated' ? { member_no: "A", role_code: role } : null }) };
    if (name === "@/lib/utils") return { cn: (...parts) => parts.filter(Boolean).join(" ") };
    if (name === "@/lib/use-list-view") return { useListView: () => ({ search: "", query: "", params: new URLSearchParams(), field: "space", setSearch() {}, setField() {}, update() {}, reset() {}, canReset: false }) };
    if (name === "@/lib/login-location") return require("../lib/login-location.ts");
    return new Proxy({}, { get: (_, property) => property === "__esModule" ? false : String(property) });
  };
  const mod = { exports: {} };
  new Function("module", "exports", "require", code)(mod, mod.exports, localRequire);
  return mod.exports;
}
function flatten(node) {
  if (Array.isArray(node)) return node.flatMap(flatten);
  if (!node || typeof node !== "object") return [];
  return [node, ...flatten(node.props?.children)];
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join("");
  if (node == null || typeof node === "boolean") return "";
  return typeof node === "object" ? text(node.props?.children) : String(node);
}

for (const role of ["SYSTEM_ADMIN", "ADMIN", "DEVELOPER", "USER"]) {
  test(`${role} sees only authorized sidebar and home shortcuts`, () => {
    const { AppShell } = load("../components/layout/app-shell.tsx", { role });
    const menu = flatten(AppShell({ user: { role_code: role }, children: "workspace" })).filter(node => node.type === "Link").map(node => node.props.href);
    for (const href of ["/", "/assets/tables", "/semantic/metrics", "/semantic/dimensions", "/query/ask", "/query/data"]) assert.ok(menu.includes(href));
    assert.equal(menu.includes("/integrations/api"), ["SYSTEM_ADMIN", "ADMIN"].includes(role));
    assert.equal(menu.includes("/governance/tasks"), ["SYSTEM_ADMIN", "ADMIN"].includes(role));
    for (const href of ["/assets/sources", "/models", "/settings"]) assert.equal(menu.includes(href), role === "SYSTEM_ADMIN");
    const { default: Home } = load("../app/page.tsx", { role });
    const shortcuts = flatten(Home()).filter(node => node.type === "Link").map(node => node.props.href);
    assert.equal(shortcuts.includes("/assets/sources"), role === "SYSTEM_ADMIN");
    assert.equal(shortcuts.includes("/governance/tasks"), ["SYSTEM_ADMIN", "ADMIN"].includes(role));
    assert.ok(shortcuts.includes("/assets/tables"));
  });
}

test("direct restricted URLs never mount their child page, while allowed asset and query pages do", () => {
  for (const role of ["SYSTEM_ADMIN", "ADMIN", "DEVELOPER", "USER"]) {
    for (const pathname of ["/integrations/api", "/integrations/plugins", "/integrations/plugins/data-selector", "/profile", "/models", "/settings", "/assets/sources", "/governance/tasks", "/governance/tables/T", "/assets/tables/T", "/semantic/metrics/M", "/semantic/dimensions/D", "/query/ask/S", "/query/data"]) {
      const { AuthGate } = load("../components/auth/auth-gate.tsx", { role, pathname });
      const privateChild = { type: "PrivatePage", props: {} };
      const tree = AuthGate({ children: privateChild });
      const allowed = require("@eureka-atlas/types").canAccessPage(role, pathname);
      if(pathname === '/integrations/plugins/data-selector') assert.equal(allowed,true);
      if(pathname === '/integrations/plugins') assert.equal(allowed,['SYSTEM_ADMIN','ADMIN'].includes(role));
      assert.equal(flatten(tree).includes(privateChild), allowed, `${role} ${pathname}`);
      if (!allowed) assert.ok(text(tree).includes("无权访问此页面"));
    }
  }
});

test("asset list keeps inspection links and package access while hiding governance from read-only roles", () => {
  const response = { items: [{ id: "T", name: "table", businessDescription: "业务描述", type: "MANAGED_TABLE", space: "dw", columnCount: 1, updatedAt: "2026-10-09", governanceStatus: "COMPLETED", hasPackage: true }], total: 1, page: 1, totalPages: 1, filters: { spaces: [], sources: [], types: [] } };
  for (const role of ["SYSTEM_ADMIN", "ADMIN", "DEVELOPER", "USER"]) {
    const { default: Assets } = load("../app/assets/tables/page.tsx", { role, states: [response, ""] });
    const component = Assets().props.children;
    const nodes = flatten(component.type(component.props));
    assert.ok(nodes.some(node => node.type === "Link" && node.props.href.startsWith("/assets/tables/T")));
    assert.ok(nodes.some(node => node.type === "SemanticPackageDialog"));
    assert.equal(nodes.some(node => node.type === "Link" && node.props.href.startsWith("/governance/")), ["SYSTEM_ADMIN", "ADMIN"].includes(role));
  }
});

test("metric and dimension detail controls are read-only for ordinary members while preserving source links", () => {
  const detail = { name: "销售额", type: "METRIC", unit: "元", sources: [{ table: { id: "T", name: "table", project: "dw" }, field: "amount", unit: "元" }] };
  const form = { description: "完整说明", aliases: "别名", category: "分类", owner: "负责人", usageNotes: "使用说明" };
  for (const role of ["SYSTEM_ADMIN", "ADMIN", "DEVELOPER", "USER"]) {
    for (const kind of ["metrics", "dimensions"]) {
      const { CatalogDetail } = load("../components/semantic/catalog-detail.tsx", { role, states: [detail, form, "", false] });
      const tree = CatalogDetail({ kind, id: "C" });
      const nodes = flatten(tree);
      const canEdit = ["SYSTEM_ADMIN", "ADMIN"].includes(role);
      assert.equal(nodes.some(node => node.type === "Button" && text(node) === "保存维护信息"), canEdit);
      const controls = nodes.filter(node => ["Input", "Textarea"].includes(node.type));
      assert.equal(controls.length, 5);
      assert.ok(controls.every(node => node.props.readOnly === !canEdit));
      assert.equal(controls[0].props.value, "完整说明");
      assert.ok(nodes.some(node => node.type === "Link" && node.props.href === "/assets/tables/T"));
    }
  }
});

test('selector remains authenticated and role-checked but renders without AppShell navigation', () => {
 for(const role of ['SYSTEM_ADMIN','ADMIN','DEVELOPER','USER','OWNER']) {
 const {AuthGate}=load('../components/auth/auth-gate.tsx',{role,pathname:'/integrations/plugins/data-selector'});
 const child={type:'PrivateSelector',props:{}};const tree=AuthGate({children:child});
 assert.equal(flatten(tree).some(n=>n.type==='AppShell'),false);
 assert.equal(flatten(tree).includes(child),role!=='OWNER');assert.equal(tree.key,'A:'+role);
 }
 const previous=global.window;try {
 const effects=[],redirects=[];global.window={location:new URL('https://atlas.example/integrations/plugins/data-selector?session_id=owned&ignore=drop')};
 const {AuthGate}=load('../components/auth/auth-gate.tsx',{status:'unauthenticated',pathname:'/integrations/plugins/data-selector',effects,replace:v=>redirects.push(v)});
 const child={type:'PrivateSelector',props:{}};assert.equal(flatten(AuthGate({children:child})).includes(child),false);effects[1]();
 assert.deepEqual(redirects,['/login?returnTo='+encodeURIComponent('/integrations/plugins/data-selector?session_id=owned')]);
 } finally {global.window=previous;}
});

test('all valid roles return to the original selector session after login',()=>{const previous=global.window;try{for(const role of ['SYSTEM_ADMIN','ADMIN','DEVELOPER','USER','OWNER']){const effects=[],redirects=[];global.window={location:new URL('https://atlas.example/login?returnTo='+encodeURIComponent('/integrations/plugins/data-selector?session_id=owned'))};const{AuthGate}=load('../components/auth/auth-gate.tsx',{role,pathname:'/login',effects,replace:v=>redirects.push(v)});AuthGate({children:'login'});effects[1]();assert.deepEqual(redirects,[role==='OWNER'?'/':'/integrations/plugins/data-selector?session_id=owned']);}}finally{global.window=previous;}});

test('Agent selection renders only its unprivileged shell without consulting or altering workbench login',()=>{for(const status of ['loading','unauthenticated','unavailable','authenticated']){const effects=[],redirects=[];const{AuthGate}=load('../components/auth/auth-gate.tsx',{status,pathname:'/integrations/plugins/agent-selector/11111111-1111-4111-8111-111111111111',effects,replace:v=>redirects.push(v)});const shell={type:'UnprivilegedSelectionShell',props:{}};const tree=AuthGate({children:shell});assert.ok(flatten(tree).includes(shell));assert.equal(flatten(tree).some(n=>n.type==='AppShell'),false);assert.equal(effects[0](),undefined);effects[1]();assert.deepEqual(redirects,[]);}});

test("login return URLs are checked against the current role", () => {
  const previous = global.window;
  try {
    for (const role of ["SYSTEM_ADMIN", "ADMIN", "USER"]) {
      const effects = [], redirects = [];
      global.window = { location: new URL("http://localhost:3000/login?returnTo=%2Fmodels") };
      const { AuthGate } = load("../components/auth/auth-gate.tsx", { role, pathname: "/login", effects, replace: value => redirects.push(value) });
      AuthGate({ children: "login" });
      effects[1]();
      // Login recovery restores only the explicitly allowed business workflows.
      assert.deepEqual(redirects, ["/"]);
    }
    for (const role of ["SYSTEM_ADMIN", "ADMIN", "DEVELOPER", "USER", "OWNER"]) {
      const effects = [], redirects = [];
      global.window = { location: new URL("http://localhost:3000/login?returnTo=%2Fquery%2Fdata%3FqueryId%3DQ") };
      const { AuthGate } = load("../components/auth/auth-gate.tsx", { role, pathname: "/login", effects, replace: value => redirects.push(value) });
      AuthGate({ children: "login" });
      effects[1]();
      assert.deepEqual(redirects, [role === "OWNER" ? "/" : "/query/data?queryId=Q"]);
    }
  } finally { global.window = previous; }
});
