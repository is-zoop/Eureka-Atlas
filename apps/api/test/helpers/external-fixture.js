const { Test } = require("@nestjs/testing"), { APP_GUARD, APP_FILTER } = require("@nestjs/core");
const { createHash } = require("node:crypto");
const { prisma } = require("@eureka-atlas/database");
const { AuthService } = require("../../dist/auth/auth.service"), { AuthGuard } = require("../../dist/auth/auth.guard"), { HazeAuthService } = require("../../dist/auth/haze-auth.service");
const { CredentialCryptoService } = require("../../dist/datasource/credential-crypto.service");
const { ExternalApiController } = require("../../dist/external-api/external-api.controller"), { ExternalDataService } = require("../../dist/external-api/external-data.service"), { ExternalContractService } = require("../../dist/external-api/external-contract.service");
const { ExternalLimitsService, ExternalLimitsGuard } = require("../../dist/external-api/external-limits");
const { ExternalExceptionFilter, ExternalResponseInterceptor } = require("../../dist/external-api/external-http");
const { SemanticScopeService } = require("../../dist/semantic/semantic-scope.service");
const { QueryExecutionService } = require("../../dist/query/query-execution.service"), { QueryCompilerService } = require("../../dist/query/query-compiler.service");
const { ApiCenterController } = require("../../dist/api-center/api-center.controller");
const { ApiCenterService } = require("../../dist/api-center/api-center.service");
const nativeFetch = global.fetch;
const field = (id, name, type, normalized_type, extra = {}) => ({ id, name, column: id, type, normalized_type, data_type: normalized_type, is_partition: false, aggregation: null, unit: null, groupable: true, candidate_value_queryable: true, label_description: null, catalog: null, ...extra });
const basePackage = () => ({ schema_version: 1, content_version: "v1", updated_at: "2026-10-01T00:00:00Z", source: { id: "source", name: "示例数据源", type: "MAXCOMPUTE", project: "dw", catalog: "dw", schema: "" }, table: { id: "table", name: "sales", business_name: "订单", data_domain: "销售管理", description: "店铺订单", grain: ["shop"], query_config: { storage: "DATE_INCREMENTAL", default_stat_date: { field_id: "day", format: "yyyyMMdd" } } }, fields: [field("day", "日期", "PARTITION", "STRING", { is_partition: true, candidate_value_queryable: false }), field("shop", "店铺", "DIMENSION", "STRING"), field("amount", "GMV去内购", "METRIC", "DECIMAL", { groupable: false, candidate_value_queryable: false, aggregation: "SUM", unit: "元", catalog: { id: "catalog", name: "GMV去内购", aliases: ["销售额"], description: "销售金额", usage_notes: null } })], metrics: [], completeness: { status: "COMPLETE", issues: [] } });
const queryBody = (key = "request-1") => ({ table_id: "table", content_version: "v1", idempotency_key: key, metric_ids: ["amount"], dimension_ids: ["shop"], date_range: { start: "2026-10-01", end: "2026-10-15" }, limit: 200 });

async function createExternalFixture() {
  const originals = { fetch: global.fetch, queryExecution: prisma.queryExecution, authSession: prisma.authSession };
  const env = { HAZE_API_ORIGIN: process.env.HAZE_API_ORIGIN, DATA_SOURCE_ENCRYPTION_KEY: process.env.DATA_SOURCE_ENCRYPTION_KEY };
  process.env.HAZE_API_ORIGIN = "https://haze-external.invalid"; process.env.DATA_SOURCE_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  const profile = (member_no, role_code) => ({ member_no, role_code, role_name: "角色", name: "用户" + member_no, phone: "13800000000", email: null, department: "研发", status: "active" });
  const keys = new Map([["haze_A_key", profile("A", "ADMIN")], ["haze_B_key", profile("B", "SYSTEM_ADMIN")], ["haze_user_key", profile("U", "USER")], ["haze_dev_key", profile("D", "DEVELOPER")]]);
  const rows = new Map(), calls = [], pkg = basePackage(); let sequence = 0, submissions = 0;
  const state = { webRole: "ADMIN", published: true, hazeOutage: false, hazeMalformed: false, remoteStatus: "RUNNING", resultRows: 150, largeValue: "", returnNull: false, remoteError: false, scopeReads: 0 };
  const crypto = new CredentialCryptoService(); const cookieSecret = "a".repeat(43), cookieId = createHash("sha256").update(cookieSecret).digest("hex");
  prisma.authSession = { findUnique: async ({ where }) => where.id === cookieId ? { memberNo: "W", tokenEncrypted: crypto.encrypt("web-session"), expiresAt: new Date(Date.now() + 3600000) } : null, deleteMany: async () => ({ count: 0 }) };
  global.fetch = async (url, options) => {
    if (!String(url).startsWith("https://haze-external.invalid/api/auth/")) throw new Error("Unexpected external request");
    calls.push({ url, options });
    if (state.hazeOutage) throw new Error("do-not-leak haze_A_key");
    if (state.hazeMalformed) return new Response("not JSON");
    const key = options.headers.Authorization?.slice(7);
    const user = String(url).endsWith("/personal-credential/me") ? keys.get(key) : key === "web-session" ? profile("W", state.webRole) : undefined;
    return user ? Response.json({ code: 0, data: user }) : Response.json({ code: 4013 }, { status: 401 });
  };
  prisma.queryExecution = {
    findUnique: async ({ where }) => where.id ? rows.get(where.id) || null : [...rows.values()].find(row => row.ownerMemberNo === where.ownerMemberNo_idempotencyKey.ownerMemberNo && row.idempotencyKey === where.ownerMemberNo_idempotencyKey.idempotencyKey) || null,
    create: async ({ data }) => { const row = { ...data, id: "q" + ++sequence, submittedAt: new Date(), startedAt: null, completedAt: null, error: null, result: null, status: "PENDING" }; rows.set(row.id, row); return row; },
    update: async ({ where, data }) => Object.assign(rows.get(where.id), data),
    count: async ({ where }) => [...rows.values()].filter(row => row.ownerMemberNo === where.ownerMemberNo && (!where.status || where.status.in.includes(row.status)) && (!where.kind || where.kind === row.kind)).length,
  };
  const queries = new QueryExecutionService({}, {}, new QueryCompilerService());
  queries.onModuleInit = () => {}; // Tests advance the remote task by explicit status requests.
  queries.clientFor = async () => ({ submitSql: async () => { submissions++; if (state.remoteError) throw new Error("secret_access_key credential data"); return "r" + submissions; }, getInstance: async () => ({ status: state.remoteStatus }), cancelInstance: async () => { state.remoteStatus = "CANCELLED"; }, listPartitions: async () => ["day=20261001"], getInstanceResult: async remoteId => {
    const row = [...rows.values()].find(row => row.remoteInstanceId === remoteId), columns = row.resultColumns;
    return [columns.map(col => col.name).join("\t"), ...Array.from({ length: state.resultRows }, (_, index) => columns.map(col => col.id === "shop" ? state.largeValue || "店铺" + index : state.returnNull && index === 0 ? "\\N" : "12345678901234567890.12").join("\t"))].join("\n");
  } });
  queries.projectFor = async () => "dw";
  const scope = new SemanticScopeService({ list: async () => { state.scopeReads++; return { items: state.published ? [{ id: "table" }] : [] }; } }, { get: async () => pkg });
  const module = await Test.createTestingModule({ controllers: [ExternalApiController, ApiCenterController], providers: [AuthService, HazeAuthService, CredentialCryptoService, ApiCenterService, ExternalLimitsService, ExternalLimitsGuard, ExternalContractService, ExternalResponseInterceptor, { provide: SemanticScopeService, useValue: scope }, { provide: QueryExecutionService, useValue: queries }, ExternalDataService, { provide: APP_GUARD, useClass: AuthGuard }, { provide: APP_FILTER, useClass: ExternalExceptionFilter }] }).compile();
  const app = module.createNestApplication({ logger: false }); app.setGlobalPrefix("api"); await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  const request = async (route, { method = "GET", body, key = "haze_A_key", cookie, headers = {} } = {}) => {
    const response = await nativeFetch(base + "/api/external/v1" + route, { method, headers: { "Content-Type": "application/json", ...(key ? { Authorization: "Bearer " + key } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { response, body: await response.json() };
  };
  return { app, request, rows, calls, keys, state, pkg, base, cookie: "eureka_atlas_session=" + cookieSecret, contracts: app.get(ExternalContractService), queries, submissions: () => submissions,
    async close() { await app.close(); Object.assign(prisma, { queryExecution: originals.queryExecution, authSession: originals.authSession }); global.fetch = originals.fetch; for (const [name, value] of Object.entries(env)) if (value === undefined) delete process.env[name]; else process.env[name] = value; },
  };
}
module.exports = { createExternalFixture, queryBody, basePackage, nativeFetch };
