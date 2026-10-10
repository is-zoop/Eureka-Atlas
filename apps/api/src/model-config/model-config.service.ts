import { BadGatewayException, BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@eureka-atlas/database";
import { PiCatalogService } from "./pi-catalog.service";
import { SubscriptionAuthService } from "./subscription-auth.service";
import { CredentialCryptoService } from "../datasource/credential-crypto.service";

const activeModelKey = "active_ai_model_id";
const customProtocols = new Set(["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"]);
const loadEsm = (specifier: string): Promise<any> => new Function("specifier", "return import(specifier)")(specifier) as Promise<any>;
const apiForProtocol: Record<string, () => Promise<unknown>> = {
  "openai-completions": async () => (await loadEsm("@earendil-works/pi-ai/api/openai-completions.lazy")).openAICompletionsApi(),
  "openai-responses": async () => (await loadEsm("@earendil-works/pi-ai/api/openai-responses.lazy")).openAIResponsesApi(),
  "anthropic-messages": async () => (await loadEsm("@earendil-works/pi-ai/api/anthropic-messages.lazy")).anthropicMessagesApi(),
  "google-generative-ai": async () => (await loadEsm("@earendil-works/pi-ai/api/google-generative-ai.lazy")).googleGenerativeAIApi(),
};
type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const positiveInt = (value: unknown, fallback: number) => { const parsed = Number.parseInt(String(value ?? ""), 10); return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback; };
const object = (value: unknown, label: string) => { if (value === undefined || value === null) return {}; if (!isObject(value)) throw new BadRequestException(`${label} must be an object`); return value; };
const stringMap = (value: unknown, label: string): Record<string, string> => Object.fromEntries(Object.entries(object(value, label)).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[0].trim().length > 0));
const publicHeaders = (value: unknown) => Object.fromEntries(Object.entries(stringMap(value, "Headers")).filter(([name]) => !/(authorization|api[-_]?key|token|secret|password)/i.test(name)));

function httpsUrl(value: unknown, required: boolean) {
  const raw = text(value);
  if (!raw && !required) return null;
  try { const url = new URL(raw); if (url.protocol !== "https:" || !url.hostname) throw new Error(); return url.toString().replace(/\/$/, ""); } catch { throw new BadRequestException("Base URL must be a public HTTPS URL"); }
}

function discoveryUrl(baseUrl: string, protocol: string) {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/+$/, "");
  if (!/\/models$/i.test(path)) {
    let next = path;
    if (protocol === "anthropic-messages" && !/\/v\d+(?:beta)?$/i.test(next)) next += "/v1";
    if (protocol === "google-generative-ai" && !/\/v\d+(?:beta)?$/i.test(next)) next += "/v1beta";
    url.pathname = `${next}/models`.replace(/\/+/g, "/");
  }
  if (protocol === "anthropic-messages") url.searchParams.set("limit", "1000");
  if (protocol === "google-generative-ai") url.searchParams.set("pageSize", "1000");
  return url;
}

function discoveredModels(payload: unknown) {
  const root = isObject(payload) ? payload : {};
  const list = Array.isArray(payload) ? payload : [root.data, root.models, root.results, root.items].find(Array.isArray) ?? [];
  const seen = new Set<string>();
  return list.flatMap((item) => {
    const raw = typeof item === "string" ? item : isObject(item) ? text(item.id ?? item.model ?? item.name) : "";
    const id = raw.replace(/^models\//, "");
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const name = isObject(item) ? text(item.display_name ?? item.displayName ?? (item.id || item.model ? item.name : "")) : "";
    return [{ id, ...(name && name !== id ? { name } : {}) }];
  }).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

@Injectable()
export class ModelConfigService {
  constructor(private readonly crypto: CredentialCryptoService, private readonly subscriptions: SubscriptionAuthService, private readonly piCatalog: PiCatalogService) {}

  async list() { return (await prisma.modelProvider.findMany({ include: { models: { orderBy: { displayName: "asc" } } }, orderBy: { name: "asc" } })).map((provider) => this.publicProvider(provider)); }
  async available() {
    const pi = await loadEsm("@earendil-works/pi-ai");
    const models = await prisma.modelConfig.findMany({ include: { provider: true }, orderBy: [{ provider: { name: "asc" } }, { displayName: "asc" }] });
    const subscriptionIds = [...new Set(models.filter((model) => model.provider.authMode === "OAUTH" && model.provider.oauthEncrypted).map((model) => model.providerId))];
    const subscriptionModels = new Map(await Promise.all(subscriptionIds.map(async (id) => [id, new Set((await this.subscriptions.catalog(id)).map((model) => model.id))] as const)));
    return Promise.all(models.filter((model) => model.provider.authMode === "OAUTH" ? subscriptionModels.get(model.providerId)?.has(model.modelId) : Boolean(model.provider.apiKeyEncrypted)).map(async (model) => {
      const runtimeModel = await this.runtimeModel(model);
      return {
        id: model.id,
        modelId: model.modelId,
        displayName: model.displayName || model.modelId,
        providerName: model.provider.name,
        testStatus: model.lastTestStatus,
        reasoning: model.reasoning,
        thinkingLevels: pi.getSupportedThinkingLevels(runtimeModel.value),
      };
    }));
  }
  async builtinCatalog() {
    const { builtinModels } = await loadEsm("@earendil-works/pi-ai/providers/all"); const runtime = await this.piCatalog.apply(builtinModels());
    return runtime.getProviders().map((provider: any) => ({ id: provider.id, name: provider.name, oauthName: provider.auth.oauth?.name ?? null, hasApiKey: Boolean(provider.auth.apiKey), models: runtime.getModels(provider.id).map((model: any) => ({ id: model.id, name: model.name, api: model.api, contextWindow: model.contextWindow, maxTokens: model.maxTokens, reasoning: model.reasoning })) })).filter((provider: any) => provider.models.length || provider.oauthName);
  }

  async createProvider(input: unknown) {
    const data = object(input, "Provider"); const name = text(data.name); const kind = text(data.kind);
    if (!name || !["BUILTIN", "CUSTOM"].includes(kind)) throw new BadRequestException("Provider name and type are required");
    const builtinId = kind === "BUILTIN" ? text(data.builtinId) : "";
    const protocol = text(data.protocol);
    const authMode = text(data.authMode) || "API_KEY";
    if (!["API_KEY", "OAUTH"].includes(authMode) || (authMode === "OAUTH" && kind !== "BUILTIN")) throw new BadRequestException("Invalid authentication mode");
    if (authMode === "OAUTH") { const catalog = await this.builtinCatalog(); if (!catalog.some((provider: { id: string; oauthName: string | null }) => provider.id === builtinId && provider.oauthName)) throw new BadRequestException("Unsupported OAuth provider"); }
    if (kind === "BUILTIN" && (!builtinId || !protocol)) throw new BadRequestException("Builtin provider ID and protocol are required");
    if (kind === "CUSTOM" && !customProtocols.has(protocol)) throw new BadRequestException("Unsupported custom provider protocol");
    try { const created = await prisma.modelProvider.create({ data: { name, kind: kind as "BUILTIN" | "CUSTOM", builtinId: builtinId || null, authMode, protocol, baseUrl: httpsUrl(data.baseUrl, kind === "CUSTOM"), apiKeyEncrypted: authMode === "API_KEY" && text(data.apiKey) ? this.crypto.encrypt(text(data.apiKey)) : null, headers: stringMap(data.headers, "Headers") as any, compat: object(data.compat, "Compatibility") as any }, include: { models: true } }); return this.publicProvider(created); } catch (error) { if (String(error).includes("Unique constraint")) throw new ConflictException("Provider name or builtin provider is already configured"); throw error; }
  }

  async updateProvider(id: string, input: unknown) {
    const existing = await this.provider(id); const data = object(input, "Provider"); const name = text(data.name) || existing.name;
    const baseUrl = data.baseUrl === undefined ? existing.baseUrl : httpsUrl(data.baseUrl, existing.kind === "CUSTOM");
    const apiKey = existing.authMode === "OAUTH" ? null : data.apiKey === undefined ? existing.apiKeyEncrypted : text(data.apiKey) ? this.crypto.encrypt(text(data.apiKey)) : null;
    try { const updated = await prisma.modelProvider.update({ where: { id }, data: { name, baseUrl, apiKeyEncrypted: apiKey, headers: data.headers === undefined ? undefined : { ...stringMap(existing.headers, "Headers"), ...stringMap(data.headers, "Headers") } as any, compat: data.compat === undefined ? undefined : object(data.compat, "Compatibility") as any }, include: { models: true } }); return this.publicProvider(updated); } catch (error) { if (String(error).includes("Unique constraint")) throw new ConflictException("Provider name is already configured"); throw error; }
  }

  async removeProvider(id: string) { const provider = await this.provider(id); const active = await this.activeId(); if (active && provider.models.some((model) => model.id === active)) throw new BadRequestException("Select a different current AI model before deleting this provider"); if (provider.authMode === "OAUTH") await this.subscriptions.logout(id); await prisma.modelProvider.delete({ where: { id } }); return { success: true }; }

  async createModel(providerId: string, input: unknown) {
    const provider = await this.provider(providerId); const data = object(input, "Model"); const modelId = text(data.modelId);
    if (!modelId) throw new BadRequestException("Model ID is required"); const protocol = text(data.protocol) || provider.protocol;
    if (provider.kind === "CUSTOM" && !customProtocols.has(protocol)) throw new BadRequestException("Unsupported custom model protocol");
    try { return await prisma.modelConfig.create({ data: { providerId, modelId, displayName: text(data.displayName) || null, protocol, contextWindow: positiveInt(data.contextWindow, 128000), maxTokens: positiveInt(data.maxTokens, 16384), reasoning: Boolean(data.reasoning), headers: stringMap(data.headers, "Headers") as any, compat: object(data.compat, "Compatibility") as any, cost: object(data.cost, "Cost") as any } }); } catch (error) { if (String(error).includes("Unique constraint")) throw new ConflictException("This model is already configured for the provider"); throw error; }
  }

  async updateModel(id: string, input: unknown) { const current = await this.model(id); const data = object(input, "Model"); return prisma.modelConfig.update({ where: { id }, data: { modelId: data.modelId === undefined ? undefined : text(data.modelId) || current.modelId, protocol: data.protocol === undefined ? undefined : text(data.protocol) || current.protocol, displayName: data.displayName === undefined ? undefined : text(data.displayName) || null, contextWindow: data.contextWindow === undefined ? undefined : positiveInt(data.contextWindow, current.contextWindow), maxTokens: data.maxTokens === undefined ? undefined : positiveInt(data.maxTokens, current.maxTokens), reasoning: data.reasoning === undefined ? undefined : Boolean(data.reasoning), headers: data.headers === undefined ? undefined : { ...stringMap(current.headers, "Headers"), ...stringMap(data.headers, "Headers") } as any, compat: data.compat === undefined ? undefined : object(data.compat, "Compatibility") as any, cost: data.cost === undefined ? undefined : object(data.cost, "Cost") as any } }); }
  async removeModel(id: string) { if (await this.activeId() === id) throw new BadRequestException("Select a different current AI model before deleting it"); await this.model(id); await prisma.modelConfig.delete({ where: { id } }); return { success: true }; }

  async discover(providerId: string) {
    const provider = await this.provider(providerId); if (provider.kind !== "CUSTOM" || !provider.baseUrl) throw new BadRequestException("Only custom providers can discover models");
    const headers = new Headers(stringMap(provider.headers, "Headers")); const key = provider.apiKeyEncrypted ? this.crypto.decrypt(provider.apiKeyEncrypted) : "";
    if (key && !headers.has("authorization")) { if (provider.protocol === "anthropic-messages") { headers.set("x-api-key", key); headers.set("anthropic-version", "2023-06-01"); } else if (provider.protocol === "google-generative-ai") headers.set("x-goog-api-key", key); else headers.set("Authorization", `Bearer ${key}`); }
    let response: Response; try { response = await fetch(discoveryUrl(provider.baseUrl, provider.protocol), { headers, signal: AbortSignal.timeout(20_000) }); } catch { throw new BadGatewayException("Model discovery request failed or timed out"); }
    const body = await response.text(); if (!response.ok) throw new BadGatewayException(`Model discovery failed (HTTP ${response.status})`);
    try { const models = discoveredModels(JSON.parse(body)); if (!models.length) throw new BadGatewayException("The provider returned no discoverable models"); return { models, endpoint: discoveryUrl(provider.baseUrl, provider.protocol).toString() }; } catch (error) { if (error instanceof BadGatewayException) throw error; throw new BadGatewayException("The provider returned an invalid model list"); }
  }

  async test(id: string) { const model = await this.model(id, true); const startedAt = Date.now(); try { const text = await this.complete(model, "You are a connection test.", "Reply with OK only.", AbortSignal.timeout(20_000), 16); const latencyMs = Date.now() - startedAt; await prisma.modelConfig.update({ where: { id: model.id }, data: { lastTestStatus: "SUCCEEDED", lastTestedAt: new Date(), lastTestLatencyMs: latencyMs, lastTestError: null } }); return { ok: true, latencyMs, responseText: text.slice(0, 300) }; } catch (error) { const latencyMs = Date.now() - startedAt; const message = this.safeError(error); await prisma.modelConfig.update({ where: { id: model.id }, data: { lastTestStatus: "FAILED", lastTestedAt: new Date(), lastTestLatencyMs: latencyMs, lastTestError: message } }); return { ok: false, latencyMs, error: message }; } }

  async completeActive(system: string, user: string, signal?: AbortSignal) { const id = await this.activeId(); if (!id) throw new BadRequestException("Configure and select a current AI suggestion model first"); return this.complete(await this.model(id, true), system, user, signal); }

  /** Runtime data remains inside the API process and is only consumed by Pi Agent. */
  async agentRuntime(requestedModelId?: string) {
    const id = requestedModelId || await this.activeId();
    if (!id) throw new BadRequestException("Configure and select a current AI model first");
    const config = await this.model(id, true);
    if (!this.hasCredential(config.provider)) throw new BadRequestException("请配置 API Key 或登录订阅账号");
    const runtimeModel = await this.runtimeModel(config);
    const pi = await loadEsm("@earendil-works/pi-ai");
    return {
      modelConfigId: config.id,
      displayName: config.displayName || config.modelId,
      providerName: config.provider.name,
      runtime: runtimeModel.runtime,
      model: runtimeModel.value,
      apiKey: config.provider.authMode === "OAUTH" ? undefined : this.crypto.decrypt(config.provider.apiKeyEncrypted),
      headers: { ...stringMap(config.provider.headers, "Headers"), ...stringMap(config.headers, "Headers") },
      maxTokens: config.maxTokens,
      reasoning: config.reasoning,
      thinkingLevels: pi.getSupportedThinkingLevels(runtimeModel.value),
      // Match Pi Agent's initial level, adjusted by the model's supported-level map.
      defaultThinkingLevel: pi.clampThinkingLevel(runtimeModel.value, "off"),
    };
  }

  async setActive(id: unknown) { const modelId = text(id); if (!modelId) { await prisma.systemSetting.deleteMany({ where: { key: activeModelKey } }); return this.current(); } const model = await this.model(modelId, true); if (!this.hasCredential(model.provider)) throw new BadRequestException("请配置 API Key 或登录订阅账号"); await prisma.systemSetting.upsert({ where: { key: activeModelKey }, create: { key: activeModelKey, value: model.id }, update: { value: model.id } }); return this.current(); }
  async current() { const id = await this.activeId(); if (!id) return { activeModelId: null, activeModel: null }; const model = await prisma.modelConfig.findUnique({ where: { id }, include: { provider: true } }); return { activeModelId: model?.id ?? null, activeModel: model ? { id: model.id, displayName: model.displayName || model.modelId, modelId: model.modelId, providerName: model.provider.name, testStatus: model.lastTestStatus } : null }; }

  private async complete(config: any, system: string, user: string, signal?: AbortSignal, overrideMaxTokens?: number) {
    if (!this.hasCredential(config.provider)) throw new BadRequestException("请配置 API Key 或登录订阅账号");
    const apiKey = config.provider.authMode === "OAUTH" ? undefined : this.crypto.decrypt(config.provider.apiKeyEncrypted);
    const headers = { ...stringMap(config.provider.headers, "Headers"), ...stringMap(config.headers, "Headers") };
    const model = await this.runtimeModel(config);
    const message = await model.runtime.completeSimple(model.value, { systemPrompt: system, messages: [{ role: "user", content: user, timestamp: Date.now() }] }, { apiKey, headers, maxTokens: overrideMaxTokens ?? config.maxTokens, timeoutMs: 60_000, maxRetries: 0, cacheRetention: "none", signal });
    if (message.stopReason === "error" || message.stopReason === "aborted") throw new BadGatewayException(message.errorMessage || "Model request failed"); const result = message.content.filter((content: any) => content.type === "text").map((content: any) => content.text).join(""); if (!result.trim()) throw new BadGatewayException("Model response does not contain text"); return result;
  }

  private async runtimeModel(config: any) {
    const pi = await loadEsm("@earendil-works/pi-ai");
    if (config.provider.kind === "BUILTIN") { const { builtinModels } = await loadEsm("@earendil-works/pi-ai/providers/all"); const runtime = config.provider.authMode === "OAUTH" ? (await this.subscriptions.runtime(config.provider.id)).runtime : await this.piCatalog.apply(builtinModels()); const source = config.provider.authMode === "OAUTH" ? (await runtime.getAvailable(config.provider.builtinId)).find((model: { id: string }) => model.id === config.modelId) : runtime.getModel(config.provider.builtinId || "", config.modelId); if (!source) throw new BadRequestException("The builtin model is no longer available in the installed pi-ai catalog"); return { runtime, value: { ...source, name: config.displayName || source.name, headers: { ...(source.headers ?? {}), ...stringMap(config.provider.headers, "Headers"), ...stringMap(config.headers, "Headers") }, maxTokens: config.maxTokens, contextWindow: config.contextWindow, reasoning: config.reasoning, compat: { ...source.compat, ...object(config.compat, "Compatibility") } } }; }
    const api = apiForProtocol[config.protocol]; if (!api || !config.provider.baseUrl) throw new BadRequestException("Invalid custom model configuration"); const runtime = pi.createModels(); const providerId = `atlas-${config.provider.id}`; const model = { id: config.modelId, name: config.displayName || config.modelId, provider: providerId, api: config.protocol, baseUrl: config.provider.baseUrl, reasoning: config.reasoning, input: ["text"] as ("text" | "image")[], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: config.contextWindow, maxTokens: config.maxTokens, headers: stringMap(config.headers, "Headers"), compat: object(config.compat, "Compatibility") };
    runtime.setProvider(pi.createProvider({ id: providerId, name: config.provider.name, baseUrl: config.provider.baseUrl, headers: stringMap(config.provider.headers, "Headers"), auth: { apiKey: { name: config.provider.name, resolve: async () => ({ auth: {} }) } }, models: [model], api: await api() as any })); return { runtime, value: model };
  }

  private async provider(id: string) { const provider = await prisma.modelProvider.findUnique({ where: { id }, include: { models: true } }); if (!provider) throw new NotFoundException("Model provider not found"); return provider; }
  private async model(id: string, includeProvider = false): Promise<any> { const model = await prisma.modelConfig.findUnique({ where: { id }, include: { provider: includeProvider } }); if (!model) throw new NotFoundException("Model configuration not found"); return model; }
  private async activeId() { return (await prisma.systemSetting.findUnique({ where: { key: activeModelKey } }))?.value ?? null; }
  private publicProvider(provider: any) { const { apiKeyEncrypted, oauthEncrypted, headers, compat, models, ...safe } = provider; return { ...safe, headers: publicHeaders(headers), compat: object(compat, "Compatibility"), hasApiKey: Boolean(apiKeyEncrypted), hasSubscription: Boolean(oauthEncrypted), models: models.map(({ headers: modelHeaders, compat: modelCompat, cost, ...model }: any) => ({ ...model, headers: publicHeaders(modelHeaders), compat: object(modelCompat, "Compatibility"), cost: object(cost, "Cost") })) }; }
  private hasCredential(provider: { authMode: string; oauthEncrypted: string | null; apiKeyEncrypted: string | null }) { return provider.authMode === "OAUTH" ? Boolean(provider.oauthEncrypted) : Boolean(provider.apiKeyEncrypted); }
  private safeError(error: unknown) { const message = error instanceof Error ? error.message : String(error); return message.replace(/Bearer\s+[^\s,]+/gi, "Bearer [REDACTED]").slice(0, 500); }
}
