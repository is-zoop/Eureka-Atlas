const { prisma } = require("@eureka-atlas/database");
const { PiCatalogService } = require("../dist/model-config/pi-catalog.service");
(async () => {
  const { builtinModels } = await import("@earendil-works/pi-ai/providers/all");
  const saved = new Map();
  const read = prisma.systemSetting.findUnique;
  const list = prisma.systemSetting.findMany;
  const catalog = new PiCatalogService();
  // Read-only acceptance: keep official response caches in memory; no user settings are changed.
  prisma.systemSetting.findUnique = async ({ where }) => saved.has(where.key) ? { key: where.key, value: saved.get(where.key) } : null;
  prisma.systemSetting.findMany = async ({ where }) => [...saved].filter(([key]) => where.key.in.includes(key)).map(([key, value]) => ({ key, value }));
  catalog.save = async (key, value) => { saved.set(key, value); };
  try {
    const runtime = builtinModels();
    for (const id of ["deepseek", "openai-codex"]) {
      await catalog.checkProvider(id, runtime.getProvider(id), true, AbortSignal.timeout(15000));
      const entry = JSON.parse(saved.get("pi_model_catalog:" + id));
      if (!entry.models.length) throw new Error("Official catalog was empty");
      await catalog.apply(runtime);
      const first = entry.models[0];
      if (runtime.getModel(id, first.id).name !== first.name) throw new Error("Official metadata not applied");
      await catalog.checkProvider(id, runtime.getProvider(id), true, AbortSignal.timeout(15000));
      console.log(JSON.stringify({ provider: id, models: entry.models.length, sample: first.name, etagRevalidation: true }));
    }
  } finally {
    catalog.onModuleDestroy();
    prisma.systemSetting.findUnique = read;
    prisma.systemSetting.findMany = list;
    await prisma.$disconnect();
  }
})().catch((error) => { console.error(error.name + ": " + error.message); process.exitCode = 1; });
