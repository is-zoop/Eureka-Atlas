import type { Api, Model, ModelsStoreEntry } from "@earendil-works/pi-ai" with { "resolution-mode": "import" };

// Adapted from Eureka / Pi's remote-catalog-provider: preserve SDK baselines,
// overlay newer official entries, and revalidate a cached body using ETag.
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export function parsePiCatalog(providerId: string, value: unknown, supportedApis: ReadonlySet<string>): Model<Api>[] {
  const entries = Array.isArray(value) ? value : record(value) && Array.isArray(value.models) ? value.models : record(value) ? Object.values(value) : null;
  if (!entries) throw new Error("Invalid Pi catalog");
  const seen = new Set<string>();
  return entries.flatMap((entry) => {
    if (!record(entry) || entry.type === "image") return [];
    if (typeof entry.id !== "string" || !entry.id.trim() || typeof entry.name !== "string" ||
        typeof entry.api !== "string" || typeof entry.baseUrl !== "string" || !entry.baseUrl ||
        typeof entry.reasoning !== "boolean" || !Array.isArray(entry.input) || !entry.input.length ||
        !entry.input.every((type) => type === "text" || type === "image") ||
        typeof entry.contextWindow !== "number" || entry.contextWindow <= 0 ||
        typeof entry.maxTokens !== "number" || entry.maxTokens <= 0 || !record(entry.cost) ||
        !["input", "output", "cacheRead", "cacheWrite"].every((key) => typeof (entry.cost as Record<string, unknown>)[key] === "number" && Number.isFinite((entry.cost as Record<string, number>)[key]) && (entry.cost as Record<string, number>)[key] >= 0)) throw new Error("Invalid Pi model");
    if (!supportedApis.has(entry.api) || seen.has(entry.id)) return [];
    seen.add(entry.id);
    return [{ ...entry, provider: providerId } as unknown as Model<Api>];
  });
}
export function piCatalogOverlay(entry: ModelsStoreEntry | undefined, localGeneratedAt?: number): readonly Model<Api>[] {
  if (!entry || (localGeneratedAt !== undefined && (entry.lastModified === undefined || entry.lastModified <= localGeneratedAt))) return [];
  return entry.models;
}
export function mergePiModels(baseline: readonly Model<Api>[], overlay: readonly Model<Api>[]): Model<Api>[] {
  const models = new Map(baseline.map((model) => [model.id, model]));
  for (const model of overlay) models.set(model.id, model);
  return [...models.values()];
}
