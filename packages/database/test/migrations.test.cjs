const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { cpSync, existsSync, mkdtempSync, readdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { rm } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { test } = require('node:test');
const { PrismaClient } = require('@prisma/client');

const root = resolve(__dirname, '..');
const migrations = join(root, 'prisma/migrations');
const cli = require.resolve('prisma/build/index.js');
const foundation = '20260929120000_ask_and_query_execution';
const failedMigration = '20261009070000_account_owned_queries';
const adminUrl = process.env.MIGRATION_TEST_DATABASE_URL;

function runPrisma(fixture, url, args, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: fixture,
    env: { ...process.env, DATABASE_URL: url },
    encoding: 'utf8',
    timeout: 120000,
    windowsHide: true,
  });
  assert.ifError(result.error);
  assert.equal(result.status, expectedStatus, result.stdout + result.stderr);
  return result.stdout + result.stderr;
}

function copyFixture(fixture, filter = () => true) {
  cpSync(join(root, 'prisma/schema.prisma'), join(fixture, 'prisma/schema.prisma'));
  for (const entry of readdirSync(migrations, { withFileTypes: true })) {
    if (entry.isFile() || filter(entry.name)) {
      cpSync(join(migrations, entry.name), join(fixture, 'prisma/migrations', entry.name), { recursive: true });
    }
  }
}

test('every migration directory contains migration.sql', () => {
  for (const entry of readdirSync(migrations, { withFileTypes: true })) {
    if (entry.isDirectory()) assert.ok(existsSync(join(migrations, entry.name, 'migration.sql')), entry.name);
  }
});

test('PostgreSQL migration deployment and recovery', { skip: !adminUrl, timeout: 600000 }, async (t) => {
  // Never migrate the configured database: it is used only to create/drop our
  // own randomized disposable databases. Existing application data is untouched.
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  t.after(() => admin.$disconnect());

  async function isolated(t, body) {
    const name = 'atlas_migration_test_' + randomUUID().replaceAll('-', '');
    const fixture = mkdtempSync(join(tmpdir(), 'atlas-migrations-'));
    const url = new URL(adminUrl);
    url.pathname = '/' + name;
    url.searchParams.set('schema', 'public');
    let created = false;
    let db;
    try {
      assert.match(name, /^atlas_migration_test_[a-f0-9]{32}$/);
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      created = true;
      db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
      await body(fixture, url.toString(), db);
    } finally {
      if (db) await db.$disconnect();
      if (created) await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
      // Yield so Prisma's Windows filesystem handles can close before retrying.
      await rm(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  }

  function assertSchema(fixture, url) {
    runPrisma(fixture, url, ['migrate', 'diff', '--from-schema-datasource', 'prisma/schema.prisma',
      '--to-schema-datamodel', join(root, 'prisma/schema.prisma'), '--exit-code']);
  }

  await t.test('fresh database deploys to the exact current schema; redeploy is a no-op', async (t) => {
    await isolated(t, async (fixture, url, db) => {
      copyFixture(fixture);
      runPrisma(fixture, url, ['migrate', 'deploy', '--schema', 'prisma/schema.prisma']);
      assertSchema(fixture, url);
      assert.match(runPrisma(fixture, url, ['migrate', 'deploy', '--schema', 'prisma/schema.prisma']), /No pending migrations/);
      const rows = await db.$queryRawUnsafe('SELECT COUNT(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL');
      assert.equal(rows[0].count, readdirSync(migrations, { withFileTypes: true }).filter(e => e.isDirectory()).length);
    });
  });

  await t.test('reproduces missing ask_session, rolls back only its failed record, and resumes without data loss', async (t) => {
    await isolated(t, async (fixture, url, db) => {
      copyFixture(fixture, name => name <= failedMigration && name !== foundation);
      assert.match(runPrisma(fixture, url, ['migrate', 'deploy', '--schema', 'prisma/schema.prisma'], 1), /ask_session.*does not exist/);
      await db.$executeRawUnsafe(`INSERT INTO "system_setting" ("id", "key", "value", "updatedAt") VALUES ('sentinel', 'migration_recovery_sentinel', 'preserve', CURRENT_TIMESTAMP)`);
      const before = await db.$queryRawUnsafe('SELECT migration_name, checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name');
      copyFixture(fixture);
      runPrisma(fixture, url, ['migrate', 'resolve', '--rolled-back', failedMigration, '--schema', 'prisma/schema.prisma']);
      runPrisma(fixture, url, ['migrate', 'deploy', '--schema', 'prisma/schema.prisma']);
      assertSchema(fixture, url);
      const after = await db.$queryRawUnsafe('SELECT migration_name, checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name');
      for (const row of before) assert.deepEqual(after.find(x => x.migration_name === row.migration_name), row);
      assert.equal((await db.$queryRawUnsafe(`SELECT "value" FROM "system_setting" WHERE "key" = 'migration_recovery_sentinel'`))[0].value, 'preserve');
      const records = await db.$queryRawUnsafe(`SELECT finished_at, rolled_back_at FROM "_prisma_migrations" WHERE migration_name = '${failedMigration}'`);
      assert.equal(records.filter(x => x.rolled_back_at).length, 1);
      assert.equal(records.filter(x => x.finished_at && !x.rolled_back_at).length, 1);
    });
  });

  await t.test('preserves pre-ownership history and provider credentials while adding missing schema changes', async (t) => {
    await isolated(t, async (fixture, url, db) => {
      copyFixture(fixture, name => name < failedMigration);
      runPrisma(fixture, url, ['migrate', 'deploy', '--schema', 'prisma/schema.prisma']);
      await db.$executeRawUnsafe(`INSERT INTO "data_source" ("id", "name", "updatedAt") VALUES ('source', 'legacy source', CURRENT_TIMESTAMP)`);
      await db.$executeRawUnsafe(`INSERT INTO "meta_project" ("id", "dataSourceId", "name", "region", "updatedAt") VALUES ('project', 'source', 'project', '', CURRENT_TIMESTAMP)`);
      await db.$executeRawUnsafe(`INSERT INTO "meta_table" ("id", "metaProjectId", "name", "type", "updatedAt") VALUES ('table', 'project', 'table', 'TABLE', CURRENT_TIMESTAMP)`);
      await db.$executeRawUnsafe(`INSERT INTO "query_execution" ("id", "metaTableId", "dataSourceId", "request", "sql", "contentVersion", "expiresAt") VALUES ('query', 'table', 'source', '{}', 'SELECT 1', 'version', CURRENT_TIMESTAMP)`);
      await db.$executeRawUnsafe(`INSERT INTO "ask_session" ("id", "title", "modelConfigId", "updatedAt") VALUES ('session', 'legacy conversation', 'model', CURRENT_TIMESTAMP)`);
      await db.$executeRawUnsafe(`INSERT INTO "ask_run" ("id", "askSessionId", "idempotencyKey", "question", "modelConfigId", "tableIds", "updatedAt") VALUES ('run', 'session', 'request', 'keep question', 'model', '[]', CURRENT_TIMESTAMP)`);
      await db.$executeRawUnsafe(`INSERT INTO "ask_run_message" ("id", "askRunId", "sequence", "role", "content") VALUES ('message', 'run', 0, 'USER', '{"text":"keep message"}')`);
      await db.$executeRawUnsafe(`INSERT INTO "model_provider" ("id", "name", "kind", "builtinId", "protocol", "apiKeyEncrypted", "updatedAt") VALUES ('provider', 'legacy provider', 'BUILTIN', 'openai', 'openai-completions', 'encrypted-value-sentinel', CURRENT_TIMESTAMP)`);
      copyFixture(fixture);
      runPrisma(fixture, url, ['migrate', 'deploy', '--schema', 'prisma/schema.prisma']);
      assertSchema(fixture, url);
      assert.equal((await db.$queryRawUnsafe(`SELECT "ownerMemberNo" FROM "ask_session" WHERE "id"='session'`))[0].ownerMemberNo, null);
      const query = (await db.$queryRawUnsafe(`SELECT "ownerMemberNo", "sql", "kind" FROM "query_execution" WHERE "id"='query'`))[0];
      assert.deepEqual(query, { ownerMemberNo: null, sql: 'SELECT 1', kind: 'SEMANTIC_QUERY' });
      assert.deepEqual((await db.$queryRawUnsafe(`SELECT "content" FROM "ask_run_message" WHERE "id"='message'`))[0].content, { text: 'keep message' });
      const provider = (await db.$queryRawUnsafe(`SELECT "authMode", "oauthEncrypted", "apiKeyEncrypted" FROM "model_provider" WHERE "id"='provider'`))[0];
      assert.deepEqual(provider, { authMode: 'API_KEY', oauthEncrypted: null, apiKeyEncrypted: 'encrypted-value-sentinel' });
      assert.equal((await db.$queryRawUnsafe(`SELECT "status" FROM "data_source" WHERE "id"='source'`))[0].status, 'ACTIVE');
      await db.$executeRawUnsafe(`INSERT INTO "data_source" ("id", "name", "updatedAt") VALUES ('new_source', 'new source', CURRENT_TIMESTAMP)`);
      assert.equal((await db.$queryRawUnsafe(`SELECT "status" FROM "data_source" WHERE "id"='new_source'`))[0].status, 'UNTESTED');
    });
  });
});
