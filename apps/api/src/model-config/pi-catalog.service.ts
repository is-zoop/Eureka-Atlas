import { BadRequestException, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { prisma } from "@eureka-atlas/database";
import type { Models, ModelsStoreEntry, Provider } from "@earendil-works/pi-ai" with { "resolution-mode": "import" };
import { mergePiModels, parsePiCatalog, piCatalogOverlay } from "./pi-model-catalog";

const enabledKey = "pi_catalog_enabled";
const statusKey = "pi_catalog_status";
const catalogKey = (id: string) => "pi_model_catalog:" + id;
const checkInterval = 15 * 60_000;
const freshnessWindow = 4 * 60 * 60_000;
const builtin = (): Promise<typeof import("@earendil-works/pi-ai/providers/all", { with: { "resolution-mode": "import" } })> =>
  new Function("return import('@earendil-works/pi-ai/providers/all')")() as Promise<typeof import("@earendil-works/pi-ai/providers/all", { with: { "resolution-mode": "import" } })>;
type CheckStatus = { lastSuccessAt?: number; error?: boolean };

@Injectable()
export class PiCatalogService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private active?: { task: Promise<void>; abort: AbortController };
  private destroyed = false;
  private readonly baselines = new WeakMap<Models, Map<string, Provider["getModels"]>>();
  onModuleInit() {
    this.timer = setInterval(() => { void this.refresh(false).catch(() => undefined); }, checkInterval);
    this.timer.unref();
    void this.refresh(false).catch(() => undefined);
  }
  onModuleDestroy() { this.destroyed = true; if (this.timer) clearInterval(this.timer); this.active?.abort.abort(); }
  async status() {
    const rows = await prisma.systemSetting.findMany({ where: { key: { in: [enabledKey, statusKey] } } });
    const state = rows.find((row) => row.key === statusKey);
    const status = state ? JSON.parse(state.value) as CheckStatus : {};
    return { enabled: rows.find((row) => row.key === enabledKey)?.value === "true", ...status,
      offline: process.env.PI_OFFLINE !== undefined, refreshing: !!this.active };
  }
  async update(input: unknown) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new BadRequestException("无效的模型目录设置");
    const body = input as { enabled?: unknown; refresh?: unknown };
    if ((body.enabled !== undefined && typeof body.enabled !== "boolean") ||
        (body.refresh !== undefined && typeof body.refresh !== "boolean")) throw new BadRequestException("模型目录开关必须为布尔值");
    if (body.enabled !== undefined) {
      await this.save(enabledKey, String(body.enabled));
      if (!body.enabled) {
        this.active?.abort.abort();
        const state = await this.status();
        await this.save(statusKey, JSON.stringify({ lastSuccessAt: state.lastSuccessAt, error: false }));
      }
    }
    if (body.refresh === true) await this.refresh(true);
    else if (body.enabled === true) void this.refresh(false).catch(() => undefined);
    return this.status();
  }
  async refresh(force: boolean) {
    const state = await this.status();
    if (!state.enabled || state.offline || this.destroyed) return;
    // Recheck after the DB await so simultaneous callers share one request batch.
    if (this.active) return this.active.task;
    const abort = new AbortController();
    const task = this.check(force, abort.signal);
    this.active = { task, abort };
    try { await task; } finally { if (this.active?.task === task) this.active = undefined; }
  }
  private async check(force: boolean, cancellation: AbortSignal) {
    const state = await this.status();
    try {
      const { builtinModels } = await builtin();
      const runtime = builtinModels();
      const selected = await prisma.modelProvider.findMany({ where: { kind: "BUILTIN", builtinId: { not: null } }, select: { builtinId: true } });
      const ids = [...new Set(selected.map((row) => row.builtinId).filter((id): id is string => !!id && id !== "radius" && !!runtime.getProvider(id)))];
      if (!ids.length) return;
      const signal = AbortSignal.any([cancellation, AbortSignal.timeout(15_000)]);
      const results = await Promise.allSettled(ids.map((id) => this.checkProvider(id, runtime.getProvider(id)!, force, signal)));
      cancellation.throwIfAborted();
      if (results.some((result) => result.status === "rejected")) throw new Error("Pi catalog request failed");
      await this.save(statusKey, JSON.stringify({ lastSuccessAt: Date.now(), error: false }));
    } catch {
      if (!cancellation.aborted) await this.save(statusKey, JSON.stringify({ lastSuccessAt: state.lastSuccessAt, error: true }));
    }
  }
  private async checkProvider(id: string, provider: Provider, force: boolean, signal: AbortSignal) {
    const saved = await prisma.systemSetting.findUnique({ where: { key: catalogKey(id) } });
    const stored = saved ? JSON.parse(saved.value) as ModelsStoreEntry : undefined;
    if (!force && stored?.checkedAt && Date.now() - stored.checkedAt < freshnessWindow) return;
    const headers: Record<string, string> = { accept: "application/json", "User-Agent": "Eureka-Atlas/pi-ai" };
    if (stored?.models.length && stored.etag) headers["if-none-match"] = stored.etag;
    const response = await fetch("https://pi.dev/api/models/providers/" + encodeURIComponent(id), { headers, signal });
    signal.throwIfAborted();
    const checkedAt = Date.now();
    let entry: ModelsStoreEntry;
    if (response.status === 304 && stored) entry = { ...stored, checkedAt };
    else if (response.status === 404 || response.status === 501) entry = { ...(stored ?? { models: [] }), checkedAt, lastModified: 0, etag: undefined };
    else {
      if (!response.ok) throw new Error("Pi catalog HTTP error");
      const models = parsePiCatalog(id, await response.json(), new Set(provider.getModels().map((model) => model.api)));
      const modified = Date.parse(response.headers.get("last-modified") ?? "");
      entry = { models, checkedAt, lastModified: Number.isNaN(modified) ? 0 : modified, etag: response.headers.get("etag") ?? undefined };
    }
    signal.throwIfAborted();
    await this.save(catalogKey(id), JSON.stringify(entry));
  }
  /** Apply the same persisted official metadata to catalog selection and actual requests. */
  async apply(runtime: Models) {
    const ids = runtime.getProviders().filter((provider) => provider.id !== "radius").map((provider) => provider.id);
    const rows = await prisma.systemSetting.findMany({ where: { key: { in: ids.map(catalogKey) } } });
    const entries = new Map(rows.map((row) => [row.key, JSON.parse(row.value) as ModelsStoreEntry]));
    const generatedAt = (await builtin()).getBuiltinModelDataGeneratedAt();
    let baselines = this.baselines.get(runtime);
    if (!baselines) { baselines = new Map(runtime.getProviders().map((provider) => [provider.id, provider.getModels.bind(provider)])); this.baselines.set(runtime, baselines); }
    for (const id of ids) {
      const baseline = baselines.get(id)!;
      const provider = runtime.getProvider(id)!;
      const overlay = piCatalogOverlay(entries.get(catalogKey(id)), generatedAt).filter((model) => model.provider === id);
      provider.getModels = () => mergePiModels(baseline(), overlay);
    }
    return runtime;
  }
  private save(key: string, value: string) {
    return prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
}
