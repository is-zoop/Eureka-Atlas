import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleDestroy } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { AuthEvent, AuthPrompt, Models } from "@earendil-works/pi-ai" with { "resolution-mode": "import" };
import { prisma } from "@eureka-atlas/database";
import { CredentialCryptoService } from "../datasource/credential-crypto.service";
import { PiCatalogService } from "./pi-catalog.service";
import { SubscriptionModelsStore } from "./subscription-models-store";
import { OAuthCredentialStore } from "./oauth-credential-store";

const load = (): Promise<typeof import("@earendil-works/pi-ai/providers/all", { with: { "resolution-mode": "import" } })> =>
  new Function("return import('@earendil-works/pi-ai/providers/all')")() as Promise<typeof import("@earendil-works/pi-ai/providers/all", { with: { "resolution-mode": "import" } })>;
type Prompt = { id: string; type: AuthPrompt["type"]; message: string; placeholder?: string; options?: readonly { id: string; label: string }[] };
type Login = {
  id: string; providerId: string; abort: AbortController; timer: ReturnType<typeof setTimeout>;
  status: "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED"; events: AuthEvent[]; error?: string; prompt?: Prompt;
  pending?: { resolve(value: string): void; reject(error: Error): void };
};

@Injectable()
export class SubscriptionAuthService implements OnModuleDestroy {
  constructor(private readonly crypto: CredentialCryptoService, private readonly piCatalog: PiCatalogService) {}
  private readonly logins = new Map<string, Login>();
  private readonly runtimes = new Map<string, Promise<Models>>();
  onModuleDestroy() { for (const login of this.logins.values()) login.abort.abort(); }
  async runtime(id: string) {
    const row = await prisma.modelProvider.findUniqueOrThrow({ where: { id } });
    if (row.authMode !== "OAUTH" || !row.builtinId) throw new BadRequestException("请选择订阅供应商");
    let pending = this.runtimes.get(id);
    if (!pending) {
      const builtinId = row.builtinId;
      pending = (async () => {
        const runtime = (await load()).builtinModels({ credentials: new OAuthCredentialStore(id, builtinId, this.crypto),
          modelsStore: new SubscriptionModelsStore(id, builtinId, this.crypto),
          authContext: { env: async () => undefined, fileExists: async () => false } });
        const oauth = runtime.getProvider(builtinId)?.auth.oauth;
        if (!oauth) throw new BadRequestException("当前 Pi 版本不支持此供应商的 OAuth 登录");
        const refresh = oauth.refresh.bind(oauth);
        oauth.refresh = async (credential, signal) => {
          try { return await refresh(credential, signal); }
          catch { throw new Error("订阅凭据刷新失败，请重新登录"); }
        };
        const restored = await runtime.refresh({ providers: [builtinId], allowNetwork: false });
        if (restored.errors.size) throw new BadRequestException("订阅模型目录读取失败，请重新登录并刷新模型");
        return runtime;
      })();
      this.runtimes.set(id, pending);
      pending.catch(() => { if (this.runtimes.get(id) === pending) this.runtimes.delete(id); });
    }
    return { runtime: await this.piCatalog.apply(await pending), builtinId: row.builtinId };
  }
  async start(id: string) {
    if ([...this.logins.values()].some((entry) => entry.providerId === id && entry.status === "RUNNING")) throw new ConflictException("此供应商正在登录");
    // Reserve synchronously before awaiting, so two tabs cannot initiate two flows.
    const abort = new AbortController();
    const login: Login = { id: randomUUID(), providerId: id, abort, timer: setTimeout(() => abort.abort(), 10 * 60_000), status: "RUNNING", events: [] };
    login.timer.unref();
    this.logins.set(login.id, login);
    try {
      const { runtime, builtinId } = await this.runtime(id);
      void this.execute(login, runtime, builtinId);
      return this.publicLogin(login);
    } catch (error) { clearTimeout(login.timer); this.logins.delete(login.id); throw error; }
  }
  private async execute(login: Login, runtime: Models, builtinId: string) {
    const cancel = () => { login.pending?.reject(new Error("Login cancelled")); login.pending = undefined; login.prompt = undefined; };
    login.abort.signal.addEventListener("abort", cancel, { once: true });
    try {
      await runtime.login(builtinId, "oauth", {
        signal: login.abort.signal,
        notify: (event) => { login.events.push(event); if (login.events.length > 30) login.events.shift(); },
        prompt: (prompt) => new Promise<string>((resolve, reject) => {
          if (prompt.signal?.aborted || login.abort.signal.aborted) { reject(new Error("Login cancelled")); return; }
          const promptId = randomUUID();
          login.prompt = { id: promptId, type: prompt.type, message: prompt.message,
            ...("placeholder" in prompt ? { placeholder: prompt.placeholder } : {}),
            ...(prompt.type === "select" ? { options: prompt.options } : {}) };
          const cleanup = () => { prompt.signal?.removeEventListener("abort", onAbort); if (login.prompt?.id === promptId) { login.prompt = undefined; login.pending = undefined; } };
          const onAbort = () => { cleanup(); reject(new Error("Prompt cancelled")); };
          prompt.signal?.addEventListener("abort", onAbort, { once: true });
          login.pending = { resolve: (value) => { cleanup(); resolve(value); }, reject: (error) => { cleanup(); reject(error); } };
        }),
      });
      login.abort.signal.throwIfAborted();

      // Catalog refresh errors don't erase a successful login; explicit refresh can retry.
      await runtime.refresh({ providers: [builtinId], signal: AbortSignal.any([login.abort.signal, AbortSignal.timeout(30_000)]) });
      login.abort.signal.throwIfAborted();
      login.status = "SUCCEEDED";
    } catch {
      login.status = login.abort.signal.aborted ? "CANCELLED" : "FAILED";
      if (login.status === "FAILED") login.error = "订阅登录失败，请检查授权是否完成、网络连接和账号订阅后重试。";
    } finally {
      clearTimeout(login.timer); cancel(); login.abort.signal.removeEventListener("abort", cancel);
      const cleanup = setTimeout(() => this.logins.delete(login.id), 10 * 60_000); cleanup.unref();
    }
  }
  status(id: string, loginId: string) { return this.publicLogin(this.login(id, loginId)); }
  answer(id: string, loginId: string, input: unknown) {
    const login = this.login(id, loginId);
    const body = input as { promptId?: string; value?: string };
    if (!body || typeof body.value !== "string" || !body.value.trim() || body.value.length > 16_384) throw new BadRequestException("请输入授权码或选择答案");
    if (login.status !== "RUNNING" || !login.pending || !login.prompt || login.prompt.id !== body.promptId) throw new ConflictException("此授权步骤已结束，请读取最新登录状态");
    if (login.prompt.options && !login.prompt.options.some((option) => option.id === body.value)) throw new BadRequestException("无效的授权选项");
    login.pending.resolve(body.value.trim());
    return { success: true };
  }
  cancel(id: string, loginId: string) { this.login(id, loginId).abort.abort(); return { success: true }; }
  async logout(id: string) {
    for (const login of this.logins.values()) if (login.providerId === id) login.abort.abort();
    const { runtime, builtinId } = await this.runtime(id);
    await runtime.logout(builtinId);
    await new SubscriptionModelsStore(id, builtinId, this.crypto).delete(builtinId);
    this.runtimes.delete(id);
    return { success: true };
  }
  async refresh(id: string) {
    const { runtime, builtinId } = await this.runtime(id);
    const result = await runtime.refresh({ providers: [builtinId], force: true, signal: AbortSignal.timeout(30_000) });
    if (result.aborted || result.errors.size) throw new BadRequestException("模型目录刷新失败，请检查订阅授权及网络后重试");
    return this.catalog(id);
  }
  async catalog(id: string) {
    const { runtime, builtinId } = await this.runtime(id);
    const available = await runtime.getAvailable(builtinId);
    return available.map((model) => ({ id: model.id, name: model.name, api: model.api, contextWindow: model.contextWindow, maxTokens: model.maxTokens, reasoning: model.reasoning }));
  }
  private login(id: string, loginId: string) {
    const login = this.logins.get(loginId);
    if (!login || login.providerId !== id) throw new NotFoundException("登录操作已结束或服务已重启，请重新登录");
    return login;
  }
  private publicLogin(login: Login) {
    return { id: login.id, status: login.status, events: login.events, prompt: login.prompt ?? null, error: login.error ?? null };
  }
}
