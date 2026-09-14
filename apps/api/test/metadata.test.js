const assert = require("node:assert/strict");
const test = require("node:test");
const { createHmac } = require("node:crypto");

process.env.DATA_SOURCE_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

const { CredentialCryptoService } = require("../dist/datasource/credential-crypto.service");
const { MaxComputeClient } = require("../dist/metadata/maxcompute.client");
const { normalizeType } = require("../dist/metadata/datasource-adapter");
const { MetadataSyncService } = require("../dist/metadata/metadata-sync.service");
const { prisma } = require("@eureka-atlas/database");

test("encrypts credentials and detects modified ciphertext", () => {
  const crypto = new CredentialCryptoService();
  const ciphertext = crypto.encrypt("secret-value");
  assert.notEqual(ciphertext, "secret-value");
  assert.equal(crypto.decrypt(ciphertext), "secret-value");
  const modified = Buffer.from(ciphertext, "base64");
  modified[modified.length - 1] ^= 1;
  assert.throws(() => crypto.decrypt(modified.toString("base64")));
});

test("normalizes common relational database types", () => {
  assert.equal(normalizeType("varchar(255)"), "STRING");
  assert.equal(normalizeType("NUMBER(18,2)"), "DECIMAL");
  assert.equal(normalizeType("timestamp with time zone"), "DATETIME");
  assert.equal(normalizeType("bytea"), "BINARY");
});

test("parses table columns and partition keys without reading data", async () => {
  const client = new MaxComputeClient({ endpoint: "http://example.test/api", defaultProject: "paiwo_smart", accessKey: "ak", secretKey: "sk" });
  client.request = async () => ({ Table: { Name: "orders", Type: "TABLE", Comment: "orders", LastModifiedTime: "1735689600000", Schema: { Columns: { Column: [{ Name: "id", Type: "BIGINT", Comment: "identifier" }] }, PartitionKeys: { Column: { Name: "ds", Type: "STRING", Comment: "date" } } } } });
  const table = await client.getTable("orders");
  assert.deepEqual(table.columns.map((column) => [column.name, column.isPartition]), [["id", false], ["ds", true]]);
  assert.equal(table.comment, "orders");
});

test("parses MaxCompute schema XML nested inside a table response", async () => {
  const client = new MaxComputeClient({ endpoint: "http://example.test/api", defaultProject: "paiwo_smart", accessKey: "ak", secretKey: "sk" });
  client.request = async () => ({ Table: { Name: "orders", Schema: { "#text": "<Schema><Columns><Column><Name>id</Name><Type>BIGINT</Type></Column></Columns><PartitionKeys><Column><Name>ds</Name><Type>STRING</Type></Column></PartitionKeys></Schema>" } } });
  const table = await client.getTable("orders");
  assert.deepEqual(table.columns.map((column) => [column.name, column.dataType, column.isPartition]), [["id", "BIGINT", false], ["ds", "STRING", true]]);
});

test("parses MaxCompute schema JSON nested inside a table response", async () => {
  const client = new MaxComputeClient({ endpoint: "http://example.test/api", defaultProject: "paiwo_smart", accessKey: "ak", secretKey: "sk" });
  client.request = async () => ({ Table: { Name: "orders", Schema: { "@_format": "Json", "#text": JSON.stringify({ columns: [{ name: "id", type: "BIGINT", comment: "identifier" }], partitionKeys: [{ name: "ds", type: "STRING" }] }) } } });
  const table = await client.getTable("orders");
  assert.deepEqual(table.columns.map((column) => [column.name, column.dataType, column.isPartition]), [["id", "BIGINT", false], ["ds", "STRING", true]]);
});

test("signs the complete MaxCompute /api resource path", async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async (url, options) => {
      assert.equal(String(url), "https://example.test/api/projects/paiwo_smart?curr_project=paiwo_smart");
      const date = options.headers.Date;
      const expected = createHmac("sha1", "sk").update(`GET\n\n\n${date}\n/projects/paiwo_smart?curr_project=paiwo_smart`).digest("base64");
      assert.equal(options.headers.Authorization, `ODPS ak:${expected}`);
      return { ok: true, status: 200, text: async () => "<Project><Name>paiwo_smart</Name></Project>" };
    };
    const client = new MaxComputeClient({ endpoint: "https://example.test/api", defaultProject: "paiwo_smart", accessKey: "ak", secretKey: "sk" });
    assert.equal((await client.getProject()).name, "paiwo_smart");
  } finally {
    global.fetch = originalFetch;
  }
});

test("paginates active tables and applies keyword, data space, and type filters", async () => {
  const originals = { metaTable: prisma.metaTable, metaProject: prisma.metaProject, dataSource: prisma.dataSource };
  const calls = [];
  prisma.metaTable = {
    count: async ({ where }) => { calls.push({ kind: "count", where }); return 25; },
    findMany: async (query) => {
      if (query.select?.type) return [{ type: "MANAGED_TABLE" }, { type: "VIEW" }];
      calls.push({ kind: "items", query });
      return [{ id: "table-25", name: "shop_sales", type: "MANAGED_TABLE", comment: "daily sales", sourceUpdatedAt: null, updatedAt: new Date("2026-09-02"), metaProject: { name: "paiwo_smart", dataSourceId: "source-1" }, governanceTasks: [], _count: { columns: 8 } }];
    },
  };
  prisma.metaProject = { findMany: async () => [{ name: "paiwo_smart" }, { name: "other_project" }] };
  prisma.dataSource = { findMany: async () => [{ id: "source-1", name: "MaxCompute" }] };
  try {
    const service = new MetadataSyncService({});
    const result = await service.listTables({ q: "sales", space: "paiwo_smart", type: "MANAGED_TABLE", page: "99", pageSize: "999" });
    assert.equal(result.pageSize, 100); assert.equal(result.page, 1); assert.equal(result.totalPages, 1);
    assert.deepEqual(result.filters, { spaces: ["paiwo_smart", "other_project"], sources: [{ id: "source-1", name: "MaxCompute" }], types: ["MANAGED_TABLE", "VIEW"] });
    assert.equal(calls[0].where.metaProject.name, "paiwo_smart"); assert.equal(calls[0].where.type, "MANAGED_TABLE"); assert.equal(calls[0].where.OR[0].name.contains, "sales");
    assert.equal(calls.find((call) => call.kind === "items").query.skip, 0);
    assert.equal(result.items[0].governanceStatus, "UNGOVERNED");
  } finally { Object.assign(prisma, originals); }
});

test("returns an empty first page for a query with no matching tables", async () => {
  const originals = { metaTable: prisma.metaTable, metaProject: prisma.metaProject, dataSource: prisma.dataSource };
  prisma.metaTable = { count: async () => 0, findMany: async (query) => query.select?.type ? [] : [] };
  prisma.metaProject = { findMany: async () => [] };
  prisma.dataSource = { findMany: async () => [] };
  try {
    const result = await new MetadataSyncService({}).listTables({ page: "-2", pageSize: "0" });
    assert.equal(result.page, 1); assert.equal(result.pageSize, 20); assert.equal(result.totalPages, 1); assert.deepEqual(result.items, []);
  } finally { Object.assign(prisma, originals); }
});

test("marks an unpublished table with an active governance task as a draft", async () => {
  const originals = { metaTable: prisma.metaTable, metaProject: prisma.metaProject, dataSource: prisma.dataSource };
  prisma.metaTable = {
    count: async () => 1,
    findMany: async (query) => query.select?.type ? [{ type: "MANAGED_TABLE" }] : [{ id: "table-draft", name: "shop_sales", type: "MANAGED_TABLE", comment: null, sourceUpdatedAt: null, updatedAt: new Date("2026-09-02"), metaProject: { name: "paiwo_smart", dataSourceId: "source-1" }, semantic: null, semanticPackage: null, governanceTasks: [{ id: "task-draft" }], _count: { columns: 2 } }],
  };
  prisma.metaProject = { findMany: async () => [{ name: "paiwo_smart" }] };
  prisma.dataSource = { findMany: async () => [{ id: "source-1", name: "MaxCompute" }] };
  try {
    const result = await new MetadataSyncService({}).listTables({ governanceStatus: "DRAFT" });
    assert.equal(result.items[0].governanceStatus, "DRAFT");
  } finally { Object.assign(prisma, originals); }
});
