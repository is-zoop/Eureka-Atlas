"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Bot, Cable, ChevronRight, LoaderCircle, Plus, RefreshCw, RotateCcw, Save, Search, Trash2 } from "lucide-react";
import { SubscriptionSettings, type SubscriptionModel } from "@/components/models/subscription-settings";
import { PiCatalogSync } from "@/components/models/pi-catalog-sync";
import { ProviderIcon } from "@/components/models/provider-icon";
import { AskPromptSettings } from "@/components/models/ask-prompt-settings";
import { FloatingAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type Model = { id: string; modelId: string; displayName: string | null; protocol: string; contextWindow: number; maxTokens: number; reasoning: boolean; lastTestStatus: "UNTESTED" | "SUCCEEDED" | "FAILED"; lastTestLatencyMs: number | null };
type Provider = { id: string; name: string; kind: "BUILTIN" | "CUSTOM"; builtinId: string | null; protocol: string; baseUrl: string | null; hasApiKey: boolean; authMode: "API_KEY" | "OAUTH"; hasSubscription: boolean; models: Model[] };
type CatalogModel = { id: string; name: string; api: string; contextWindow: number; maxTokens: number; reasoning: boolean };
type CatalogProvider = { id: string; name: string; oauthName: string | null; hasApiKey: boolean; models: CatalogModel[] };
type ProviderDraft = { authMode: "API_KEY" | "OAUTH"; name: string; kind: "BUILTIN" | "CUSTOM"; builtinId: string; protocol: string; baseUrl: string; apiKey: string };
type ModelDraft = { modelId: string; displayName: string; protocol: string; contextWindow: string; maxTokens: string; reasoning: boolean };
type PromptSetting = { prompt: string; defaultPrompt: string; customized: boolean };
type AvailableModel = { id: string; modelId: string; displayName: string; providerName: string; testStatus: string };
type ActiveModel = { activeModelId: string | null; activeModel: AvailableModel | null };

const protocols = ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"];
const mask = "••••••••";
const blankProvider = (): ProviderDraft => ({ authMode: "API_KEY", name: "", kind: "CUSTOM", builtinId: "", protocol: protocols[0], baseUrl: "", apiKey: "" });
const blankModel = (protocol = protocols[0]): ModelDraft => ({ modelId: "", displayName: "", protocol, contextWindow: "128000", maxTokens: "16384", reasoning: false });

const loadModelConfiguration = () => Promise.all([api<Provider[]>("/models"), api<CatalogProvider[]>("/models/builtin-catalog")]);

export default function ModelsPage() {
  const [tab, setTab] = useState("models");
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [catalog, setCatalog] = useState<CatalogProvider[]>([]);
  const [providerId, setProviderId] = useState<string | undefined>();
  const [subscriptionCatalog, setSubscriptionCatalog] = useState<SubscriptionModel[]>([]);
  const [modelId, setModelId] = useState<string | undefined>();
  const [providerDraft, setProviderDraft] = useState<ProviderDraft>(blankProvider());
  const [modelDraft, setModelDraft] = useState<ModelDraft>(blankModel());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [working, setWorking] = useState(false);
  const [testingModelId, setTestingModelId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const provider = providers.find((item) => item.id === providerId);
  const model = provider?.models.find((item) => item.id === modelId);
  const builtin = catalog.find((item) => item.id === providerDraft.builtinId);
  const matches = useMemo(() => catalog.filter((item) => (item.id + " " + item.name + " " + item.oauthName).toLowerCase().includes(query.trim().toLowerCase())), [catalog, query]);

  const load = async () => {

    try { const [nextProviders, nextCatalog] = await loadModelConfiguration(); setProviders(nextProviders); setCatalog(nextCatalog); }
    catch (error) { setMessage({ error: true, text: error instanceof Error ? error.message : "无法加载模型配置" }); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    let disposed = false;
    void loadModelConfiguration()
      .then(([nextProviders, nextCatalog]) => { if (!disposed) { setProviders(nextProviders); setCatalog(nextCatalog); } })
      .catch((error: Error) => { if (!disposed) setMessage({ error: true, text: error.message }); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, []);
  const selectProvider = (item: Provider) => { setSubscriptionCatalog([]); setProviderDraft({ authMode: item.authMode, name: item.name, kind: item.kind, builtinId: item.builtinId ?? "", protocol: item.protocol, baseUrl: item.baseUrl ?? "", apiKey: item.hasApiKey ? mask : "" }); setProviderId(item.id); setModelId(undefined); };
  const selectModel = (item: Model) => { if (modelId === item.id) { setModelId(undefined); return; } setModelDraft({ modelId: item.modelId, displayName: item.displayName ?? "", protocol: item.protocol, contextWindow: String(item.contextWindow), maxTokens: String(item.maxTokens), reasoning: item.reasoning }); setModelId(item.id); };
  const saveProvider = async (event: FormEvent) => {
    event.preventDefault(); setWorking(true);
    try {
      const body = { ...providerDraft, apiKey: providerDraft.apiKey === mask ? undefined : providerDraft.apiKey, protocol: providerDraft.kind === "BUILTIN" ? builtin?.models[0]?.api ?? providerDraft.protocol : providerDraft.protocol, headers: {}, compat: {} };
      const saved = await api<Provider>(provider ? "/models/providers/" + provider.id : "/models/providers", { method: provider ? "PATCH" : "POST", body: JSON.stringify(body) });
      await load(); setProviderId(saved.id); setModelId(undefined); setProviderDraft({ authMode: saved.authMode, name: saved.name, kind: saved.kind, builtinId: saved.builtinId ?? "", protocol: saved.protocol, baseUrl: saved.baseUrl ?? "", apiKey: saved.hasApiKey ? mask : "" }); setMessage({ error: false, text: "模型供应商已保存。" });
    } catch (error) { setMessage({ error: true, text: error instanceof Error ? error.message : "保存失败" }); } finally { setWorking(false); }
  };
  const saveModel = async (event: FormEvent) => {
    event.preventDefault(); if (!provider) return; const editing = Boolean(model); setWorking(true);
    try {
      const body = JSON.stringify({ ...modelDraft, contextWindow: Number(modelDraft.contextWindow), maxTokens: Number(modelDraft.maxTokens), headers: {}, compat: {}, cost: {} });
      const saved = await api<Model>(editing ? "/models/model-configs/" + model!.id : "/models/providers/" + provider.id + "/models", { method: editing ? "PATCH" : "POST", body });
      await load(); setModelId(saved.id); setModelDialogOpen(false); setMessage({ error: false, text: "模型已保存。" });
    } catch (error) { setMessage({ error: true, text: error instanceof Error ? error.message : "保存失败" }); } finally { setWorking(false); }
  };
  const deleteProvider = async () => { if (!provider || !confirm("删除“" + provider.name + "”及其所有模型？")) return; try { await api("/models/providers/" + provider.id, { method: "DELETE" }); await load(); setProviderId(undefined); setModelId(undefined); setMessage({ error: false, text: "模型供应商已删除。" }); } catch (error) { setMessage({ error: true, text: error instanceof Error ? error.message : "删除失败" }); } };
  const deleteModel = async () => { if (!model || !confirm("删除模型“" + (model.displayName || model.modelId) + "”？")) return; try { await api("/models/model-configs/" + model.id, { method: "DELETE" }); await load(); setModelId(undefined); setMessage({ error: false, text: "模型已删除。" }); } catch (error) { setMessage({ error: true, text: error instanceof Error ? error.message : "删除失败" }); } };
  const testModel = async () => { if (!model) return; setWorking(true); setTestingModelId(model.id); try { const result = await api<{ ok: boolean; latencyMs: number; error?: string }>("/models/model-configs/" + model.id + "/test", { method: "POST" }); await load(); setMessage({ error: !result.ok, text: result.ok ? "连接成功，耗时 " + result.latencyMs + " ms。" : result.error ?? "连接测试失败" }); } catch (error) { setMessage({ error: true, text: error instanceof Error ? error.message : "连接测试失败" }); } finally { setTestingModelId(null); setWorking(false); } };
  const discover = async () => { if (!provider) return; setWorking(true); try { const result = await api<{ models: Array<{ id: string; name?: string }> }>("/models/providers/" + provider.id + "/discover", { method: "POST" }); const additions = result.models.filter((item) => !provider.models.some((saved) => saved.modelId === item.id)); if (!additions.length || !confirm("发现 " + additions.length + " 个新模型，确认全部添加？")) return; await Promise.all(additions.map((item) => api("/models/providers/" + provider.id + "/models", { method: "POST", body: JSON.stringify({ modelId: item.id, displayName: item.name ?? item.id, protocol: provider.protocol, contextWindow: 128000, maxTokens: 16384, reasoning: false, headers: {}, compat: {}, cost: {} }) }))); await load(); setMessage({ error: false, text: "已添加 " + additions.length + " 个模型。" }); } catch (error) { setMessage({ error: true, text: error instanceof Error ? error.message : "模型发现失败" }); } finally { setWorking(false); } };
  const chooseBuiltin = (item: CatalogProvider) => { setProviderDraft({ ...blankProvider(), name: item.name, kind: "BUILTIN", builtinId: item.id, protocol: item.models[0]?.api ?? protocols[0] }); setProviderId(""); setModelId(undefined); setPickerOpen(false); };
  const chooseSubscription = (item: CatalogProvider) => { setProviderDraft({ ...blankProvider(), name: item.oauthName + " · 订阅", kind: "BUILTIN", authMode: "OAUTH", builtinId: item.id, protocol: item.models[0]?.api ?? protocols[0] }); setSubscriptionCatalog([]); setProviderId(""); setModelId(undefined); setPickerOpen(false); };
  const chooseCustom = () => { setProviderDraft(blankProvider()); setProviderId(""); setModelId(undefined); setPickerOpen(false); };
  const chooseCatalogModel = (value: string) => { const source = (provider?.authMode === "OAUTH" ? subscriptionCatalog : catalog.find((item) => item.id === provider?.builtinId)?.models ?? []).find((item) => item.id === value); if (source) setModelDraft({ modelId: source.id, displayName: source.name, protocol: source.api, contextWindow: String(source.contextWindow), maxTokens: String(source.maxTokens), reasoning: source.reasoning }); };

  return <Tabs value={tab} onValueChange={setTab} className="-mx-4 -my-5 flex h-[calc(100vh-64px)] min-h-[620px] flex-col bg-white sm:-mx-6 lg:-mx-8"><header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-3"><TabsList><TabsTrigger value="models">模型配置</TabsTrigger><TabsTrigger value="prompt">AI 提示词</TabsTrigger></TabsList>{tab === "models" && <PiCatalogSync onUpdated={async () => { await load(); setCatalogRevision((value) => value + 1); }} />}</header><TabsContent value="models" className="mt-0 flex-1 overflow-hidden"><main className="flex h-full min-h-0 overflow-hidden border-b border-slate-200 bg-white">
    <aside className="flex w-64 shrink-0 flex-col border-r border-slate-200 bg-slate-50/40"><div className="border-b border-slate-200 p-3"><Button className="w-full" variant="outline" onClick={() => { setQuery(""); setPickerOpen(true); }}><Plus className="size-4" />添加供应商</Button></div><ScrollArea className="min-h-0 flex-1 p-2"><p className="px-2 py-2 text-[11px] font-medium text-slate-400">已配置的模型</p>{loading ? <LoaderCircle className="mx-auto mt-8 size-4 animate-spin text-slate-400" /> : providers.map((item) => <button key={item.id} onClick={() => selectProvider(item)} className={cn("mb-1 flex w-full min-w-0 items-center gap-2 rounded-md px-3 py-2 text-left text-sm", providerId === item.id ? "bg-slate-200" : "hover:bg-slate-100")}><ProviderIcon id={item.builtinId} name={item.name} size={20} /><span className="min-w-0 flex-1 truncate font-medium">{item.name}{item.authMode === "OAUTH" && <small className="ml-1 text-slate-400">订阅</small>}</span><span className="text-xs text-slate-400">{item.models.length}</span></button>)}</ScrollArea></aside>
    <section className="min-w-0 flex-1 overflow-y-auto p-8">
      {message && <FloatingAlert key={message.text} type={message.error ? "error" : "success"}>{message.text}</FloatingAlert>}
      {providerId === undefined && <div className="flex h-full flex-col items-center justify-center text-center"><Bot className="mb-3 size-8 text-slate-300" /><b>选择 Provider 或模型</b><p className="mt-2 text-sm text-slate-500">从左侧选择已有配置，或添加供应商。</p></div>}
      {providerId !== undefined && <form className="mx-auto max-w-3xl space-y-6" onSubmit={saveProvider}>
        <header className="flex items-start justify-between border-b border-slate-200 pb-5"><div><h1 className="text-lg font-semibold">{provider?.name || "配置模型供应商"}</h1>{!provider && <p className="mt-1 text-sm text-slate-500">保存后即可添加模型。</p>}</div><div className="flex gap-2"><Button disabled={working}><Save className="size-4" />保存</Button>{provider && <Button type="button" variant="outline" onClick={deleteProvider}><Trash2 className="size-4" />删除</Button>}</div></header>
        <FieldGroup className="sm:grid-cols-2"><Field><FieldLabel>供应商名称</FieldLabel><Input required value={providerDraft.name} onChange={(event) => setProviderDraft({ ...providerDraft, name: event.target.value })} /></Field>{providerDraft.kind === "CUSTOM" ? <Field><FieldLabel>API 协议</FieldLabel><select className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" value={providerDraft.protocol} onChange={(event) => setProviderDraft({ ...providerDraft, protocol: event.target.value })}>{protocols.map((item) => <option key={item}>{item}</option>)}</select></Field> : <Field><FieldLabel>内置供应商</FieldLabel><div className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm"><ProviderIcon id={providerDraft.builtinId} name={providerDraft.name} size={20} />{providerDraft.name}</div></Field>}</FieldGroup>
        {providerDraft.kind === "CUSTOM" && <Field><FieldLabel>Base URL</FieldLabel><Input type="url" required placeholder="https://api.example.com/v1" value={providerDraft.baseUrl} onChange={(event) => setProviderDraft({ ...providerDraft, baseUrl: event.target.value })} /><FieldDescription>仅允许公网 HTTPS 地址。</FieldDescription></Field>}
        {providerDraft.authMode === "OAUTH" ? provider ? <SubscriptionSettings key={provider.id} providerId={provider.id} catalogRevision={catalogRevision} connected={provider.hasSubscription} onChanged={load} onCatalog={setSubscriptionCatalog} /> : <p className="text-sm text-slate-500">保存供应商后，使用订阅账号登录并添加模型。</p> : <Field><FieldLabel>API Key</FieldLabel><Input type="password" required={!provider?.hasApiKey} placeholder={provider?.hasApiKey ? mask : "输入 API Key"} value={providerDraft.apiKey} onChange={(event) => setProviderDraft({ ...providerDraft, apiKey: event.target.value })} /></Field>}
        {provider && <section className="border-t border-slate-200 pt-6"><div className="mb-3 flex justify-between"><b className="text-sm">已配置模型</b><div className="flex gap-2">{provider.kind === "CUSTOM" && <Button type="button" size="sm" variant="outline" disabled={working} onClick={discover}><Search className="size-3.5" />发现模型</Button>}<Button type="button" size="sm" variant="outline" onClick={() => { setModelDraft(blankModel(provider.protocol)); setModelId(undefined); setModelDialogOpen(true); }}><Plus className="size-3.5" />添加模型</Button></div></div><div className="overflow-hidden rounded-lg border border-slate-200">{provider.models.map((item, index) => <div key={item.id} className={index ? "border-t border-slate-200" : ""}><button type="button" onClick={() => selectModel(item)} className="flex w-full justify-between px-4 py-3 text-left hover:bg-slate-50"><span><b className="block text-sm">{item.displayName || item.modelId}</b><small className="text-slate-500">{item.modelId}{item.lastTestStatus === "SUCCEEDED" && " · 测试成功 " + (item.lastTestLatencyMs ?? 0) + " ms"}{item.lastTestStatus === "FAILED" && " · 测试失败"}</small></span><ChevronRight className={cn("size-4 text-slate-400 transition-transform", modelId === item.id && "rotate-90")} /></button>{modelId === item.id && model && <div className="border-t border-slate-200 bg-slate-50 p-4"><div className="mb-3 flex items-center justify-between"><b className="text-sm">模型配置：{model.displayName || model.modelId}</b><div className="flex gap-2"><Button type="button" size="sm" variant="outline" disabled={working} onClick={testModel}><RefreshCw className={cn("size-3.5", testingModelId === model.id && "animate-spin")} />测试</Button><Button type="button" size="sm" variant="outline" onClick={deleteModel}><Trash2 className="size-3.5" />删除</Button></div></div><ModelFields draft={modelDraft} setDraft={setModelDraft} /><div className="mt-3 flex justify-end"><Button type="button" size="sm" disabled={working} onClick={() => void saveModel({ preventDefault: () => undefined } as FormEvent)}><Save className="size-3.5" />保存模型</Button></div></div>}</div>)}</div></section>}
      </form>}
    </section>
    <Dialog open={pickerOpen} onOpenChange={setPickerOpen}><DialogContent className="flex h-[min(680px,82vh)] max-w-4xl flex-col overflow-hidden border border-slate-200 bg-white p-0"><DialogHeader className="shrink-0 border-b border-slate-100 px-5 py-4"><DialogTitle>添加供应商</DialogTitle></DialogHeader><div className="shrink-0 border-b border-slate-100 p-4"><div className="relative"><Search className="absolute left-3 top-3 size-4 text-slate-400" /><Input className="pl-9" autoFocus placeholder="搜索 Provider…" value={query} onChange={(event) => setQuery(event.target.value)} /></div></div><ScrollArea className="min-h-0 flex-1"><div className="p-4"><p className="mb-2 text-xs font-semibold text-slate-600">自定义</p><button onClick={chooseCustom} className="mb-5 flex h-[68px] w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 text-left hover:bg-slate-50"><span className="flex items-center gap-3"><Cable className="size-6 text-slate-500" /><span><b className="block text-sm">OpenAI / Anthropic compatible</b><small className="text-slate-500">自定义端点格式</small></span></span><Plus className="size-4 text-slate-400" /></button><p className="mb-2 text-xs font-semibold text-slate-600">订阅服务</p><div className="mb-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{matches.filter((item) => item.oauthName).map((item) => <button key={item.id} onClick={() => chooseSubscription(item)} className="flex h-[68px] items-center justify-between rounded-lg border border-slate-200 bg-white px-3 text-left transition hover:bg-slate-50"><span><b className="block text-sm">{item.oauthName}</b><small className="block text-slate-500">OAuth</small></span><ProviderIcon id={item.id} name={item.name} size={28} /></button>)}</div><p className="mb-2 text-xs font-semibold text-slate-600">API Key</p><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{matches.filter((item) => item.hasApiKey && item.models.length).map((item) => <button key={item.id} onClick={() => chooseBuiltin(item)} className="flex h-[68px] items-center justify-between rounded-lg border border-slate-200 bg-white px-3 text-left transition hover:bg-slate-50"><span><b className="block text-sm">{item.name}</b><small className="block text-slate-500">{item.models.length} 个模型</small></span><ProviderIcon id={item.id} name={item.name} size={28} /></button>)}</div></div></ScrollArea></DialogContent></Dialog>
    <Dialog open={modelDialogOpen} onOpenChange={setModelDialogOpen}><DialogContent className="max-w-xl border border-slate-200 bg-white"><DialogHeader><DialogTitle>添加模型</DialogTitle></DialogHeader><form className="space-y-4" onSubmit={saveModel}>{provider?.kind === "BUILTIN" && <Field><FieldLabel>内置模型</FieldLabel><Combobox value={modelDraft.modelId} placeholder="请选择模型" options={(provider.authMode === "OAUTH" ? subscriptionCatalog : catalog.find((item) => item.id === provider.builtinId)?.models ?? []).map((item) => ({ value: item.id, label: item.name }))} onValueChange={chooseCatalogModel} /></Field>}<ModelFields draft={modelDraft} setDraft={setModelDraft} /><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setModelDialogOpen(false)}>取消</Button><Button disabled={working}><Save className="size-4" />保存模型</Button></div></form></DialogContent></Dialog>
  </main></TabsContent><TabsContent value="prompt" className="mt-0 flex-1 overflow-y-auto"><PromptSettings /></TabsContent></Tabs>;
}

function ModelFields({ draft, setDraft }: { draft: ModelDraft; setDraft: (value: ModelDraft) => void }) {
  return <><FieldGroup className="sm:grid-cols-2"><Field><FieldLabel>模型 ID</FieldLabel><Input required value={draft.modelId} onChange={(event) => setDraft({ ...draft, modelId: event.target.value })} /></Field><Field><FieldLabel>显示名称</FieldLabel><Input value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} /></Field><Field><FieldLabel>上下文窗口</FieldLabel><Input type="number" min="1" value={draft.contextWindow} onChange={(event) => setDraft({ ...draft, contextWindow: event.target.value })} /></Field><Field><FieldLabel>最大输出 tokens</FieldLabel><Input type="number" min="1" value={draft.maxTokens} onChange={(event) => setDraft({ ...draft, maxTokens: event.target.value })} /></Field></FieldGroup><Field className="mt-3"><label className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm"><input type="checkbox" checked={draft.reasoning} onChange={(event) => setDraft({ ...draft, reasoning: event.target.checked })} />支持推理</label></Field></>;
}

function PromptSettings() {
  return <Tabs defaultValue="governance">
    <div className="mx-auto w-full max-w-5xl px-8 pt-6"><TabsList aria-label="提示词类型"><TabsTrigger value="governance">智能治理</TabsTrigger><TabsTrigger value="ask">智能问数</TabsTrigger></TabsList></div>
    <TabsContent value="governance" forceMount className="mt-0 data-[state=inactive]:hidden"><GovernancePromptSettings /></TabsContent>
    <TabsContent value="ask" forceMount className="mt-0 data-[state=inactive]:hidden"><AskPromptSettings /></TabsContent>
  </Tabs>;
}

function GovernancePromptSettings() {
  const [setting, setSetting] = useState<PromptSetting | null>(null);
  const [prompt, setPrompt] = useState("");
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [activeModelId, setActiveModelId] = useState("");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  useEffect(() => {
    void Promise.all([api<PromptSetting>("/settings/ai-prompt"), api<AvailableModel[]>("/models/available"), api<ActiveModel>("/settings/active-ai-model")])
      .then(([nextSetting, nextModels, active]) => { setSetting(nextSetting); setPrompt(nextSetting.prompt); setModels(nextModels); setActiveModelId(active.activeModelId ?? ""); })
      .catch((error: Error) => setMessage({ error: true, text: error.message }));
  }, []);
  const savePrompt = async () => {
    setWorking(true);
    try { const saved = await api<PromptSetting>("/settings/ai-prompt", { method: "PUT", body: JSON.stringify({ prompt }) }); setSetting(saved); setPrompt(saved.prompt); setMessage({ error: false, text: "AI 系统提示词已保存。" }); }
    catch (error) { setMessage({ error: true, text: error instanceof Error ? error.message : "保存失败" }); }
    finally { setWorking(false); }
  };
  const resetPrompt = async () => {
    setWorking(true);
    try { const saved = await api<PromptSetting>("/settings/ai-prompt", { method: "DELETE" }); setSetting(saved); setPrompt(saved.prompt); setMessage({ error: false, text: "已恢复默认 AI 系统提示词。" }); }
    catch (error) { setMessage({ error: true, text: error instanceof Error ? error.message : "恢复失败" }); }
    finally { setWorking(false); }
  };
  const selectActiveModel = async (value: string) => {
    setWorking(true);
    try { const saved = await api<ActiveModel>("/settings/active-ai-model", { method: "PUT", body: JSON.stringify({ modelId: value || null }) }); setActiveModelId(saved.activeModelId ?? ""); setMessage({ error: false, text: saved.activeModelId ? "当前 AI 建议模型已更新。" : "已清除当前 AI 建议模型。" }); }
    catch (error) { setMessage({ error: true, text: error instanceof Error ? error.message : "保存失败" }); }
    finally { setWorking(false); }
  };
  const modelGroups = models.reduce<Array<{ label: string; options: Array<{ value: string; label: string }> }>>((groups, item) => { const group = groups.find((entry) => entry.label === item.providerName); const option = { value: item.id, label: item.displayName }; if (group) group.options.push(option); else groups.push({ label: item.providerName, options: [option] }); return groups; }, []);
  return <div className="mx-auto w-full max-w-5xl p-8">{message && <FloatingAlert key={message.text} type={message.error ? "error" : "success"}>{message.text}</FloatingAlert>}<section className="mb-6 border-b border-slate-200 pb-6"><Field><FieldLabel>当前 AI 建议模型</FieldLabel><Combobox value={activeModelId} placeholder={models.length ? "请选择当前模型" : "暂无已配置凭据的模型"} options={models.map((item) => ({ value: item.id, label: item.displayName }))} groups={modelGroups} onValueChange={(value) => void selectActiveModel(value)} disabled={working || !models.length} /></Field></section><section><div className="mb-4 flex items-start justify-between"><div><h2 className="text-lg font-semibold">AI 系统提示词</h2><p className="mt-1 text-sm text-slate-500">用于下一次 AI 建议生成；JSON、字段范围与公式安全校验仍由后端强制执行。</p></div><div className="flex gap-2"><Button size="sm" type="button" variant="outline" disabled={working || !setting?.customized} onClick={() => void resetPrompt()}><RotateCcw className="size-4" />恢复默认</Button><Button size="sm" type="button" disabled={working || !prompt.trim()} onClick={() => void savePrompt()}><Save className="size-4" />保存提示词</Button></div></div><Textarea className="min-h-[28rem] text-sm leading-6" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="正在加载系统提示词…" disabled={!setting || working} /></section></div>;
}
