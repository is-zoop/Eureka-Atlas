"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  Database,
  Eye,
  EyeOff,
  Info,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Table, TableCell, TableHead } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/lib/api";

type Type =
  | "MAXCOMPUTE"
  | "MYSQL"
  | "POSTGRESQL"
  | "SQLSERVER"
  | "ORACLE"
  | "MARIADB"
  | "SQLITE";
type Source = {
  id: string;
  name: string;
  type: Type;
  description: string | null;
  username: string | null;
  connectionConfig: Record<string, string>;
  status: "UNTESTED" | "ACTIVE" | "FAILED";
  lastTestedAt: string | null;
  lastSyncedAt: string | null;
  syncStatus: "IDLE" | "RUNNING" | "SUCCEEDED" | "PARTIAL_FAILED" | "FAILED";
  syncTotalTables: number;
  syncProcessedTables: number;
  syncSyncedTables: number;
  syncSkippedTables: number;
  syncFailedTables: number;
  syncError: string | null;
  selectedSpaces: SyncSpace[];
};
type SyncSpace = {
  id: string;
  catalog: string;
  schema: string;
  name: string;
  description: string | null;
  selected: boolean;
  syncStatus: Source["syncStatus"];
  syncTotalTables: number;
  syncProcessedTables: number;
  syncSyncedTables: number;
  syncSkippedTables: number;
  syncFailedTables: number;
  syncError: string | null;
};
type Form = {
  name: string;
  type: Type | null;
  description: string;
  host: string;
  port: string;
  project: string;
  serviceName: string;
  filePath: string;
  region: string;
  endpoint: string;
  username: string;
  password: string;
  accessKey: string;
  secretKey: string;
};
type PageMessage = { text: string; tone: "success" | "info" | "error" };
const info: Record<Type, { label: string; detail: string; color: string }> = {
  MAXCOMPUTE: {
    label: "MaxCompute",
    detail: "阿里云数据仓库",
    color: "bg-sky-500",
  },
  MYSQL: { label: "MySQL", detail: "关系型业务数据库", color: "bg-cyan-500" },
  POSTGRESQL: {
    label: "PostgreSQL",
    detail: "开源关系型数据库",
    color: "bg-blue-600",
  },
  SQLSERVER: {
    label: "SQL Server",
    detail: "微软关系型数据库",
    color: "bg-rose-500",
  },
  ORACLE: {
    label: "Oracle",
    detail: "企业级关系型数据库",
    color: "bg-red-600",
  },
  MARIADB: {
    label: "MariaDB",
    detail: "MySQL 兼容数据库",
    color: "bg-amber-600",
  },
  SQLITE: {
    label: "SQLite",
    detail: "服务端本地数据库文件",
    color: "bg-teal-500",
  },
};
const initial = (): Form => ({
  name: "",
  type: null,
  description: "",
  host: "",
  port: "",
  project: "",
  serviceName: "",
  filePath: "",
  region: "",
  endpoint: "",
  username: "",
  password: "",
  accessKey: "",
  secretKey: "",
});
const connection = (form: Form) => ({
  host: form.host,
  port: form.port,
  project: form.project,
  serviceName: form.serviceName,
  filePath: form.filePath,
  region: form.region,
  endpoint: form.endpoint,
});
const connectionSignature = (form: Form) =>
  JSON.stringify({
    type: form.type,
    connection: connection(form),
    username: form.username,
    password: form.password,
    accessKey: form.accessKey,
    secretKey: form.secretKey,
  });
const displayConnection = (source: Source) => {
  const c = source.connectionConfig;
  return source.type === "SQLITE"
    ? c.filePath || "-"
    : source.type === "MAXCOMPUTE"
      ? c.endpoint || "-"
      : [c.host, c.port].filter(Boolean).join(":") || "-";
};
const displaySpace = (source: Source) =>
  source.selectedSpaces.length
    ? `${source.selectedSpaces.slice(0, 2).map((space) => space.name).join("、")}${source.selectedSpaces.length > 2 ? ` 等 ${source.selectedSpaces.length} 个` : ""}`
    : "未选择";

function SourceIcon({ type }: { type: Type }) {
  return (
    <img
      src={`/icons/data-sources/${type.toLowerCase()}.svg`}
      alt={`${info[type].label} 图标`}
      className="h-9 w-9 shrink-0 rounded-lg"
    />
  );
}

function SecretField({
  id,
  label,
  value,
  placeholder,
  visible,
  onVisibleChange,
  onChange,
  required = false,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  visible: boolean;
  onVisibleChange: (value: boolean) => void;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="relative">
        <Input
          id={id}
          required={required}
          value={value}
          type={visible ? "text" : "password"}
          placeholder={placeholder}
          className="pr-10"
          onChange={(event) => onChange(event.target.value)}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute right-1 top-1/2 -translate-y-1/2 text-slate-500"
          onClick={() => onVisibleChange(!visible)}
          aria-label={visible ? `隐藏${label}` : `显示${label}`}
        >
          {visible ? (
            <EyeOff className="h-4 w-4" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
        </Button>
      </div>
    </Field>
  );
}

export default function SourcesPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Source | null>(null);
  const [form, setForm] = useState<Form>(initial);
  const [message, setMessage] = useState<PageMessage | null>(null);
  const [working, setWorking] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testedSignature, setTestedSignature] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showAccessKey, setShowAccessKey] = useState(false);
  const [showSecretKey, setShowSecretKey] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncSource, setSyncSource] = useState<Source | null>(null);
  const [syncSpaces, setSyncSpaces] = useState<SyncSpace[]>([]);
  const [refreshingSpaces, setRefreshingSpaces] = useState(false);
  const [startingSync, setStartingSync] = useState(false);
  const [deletingSource, setDeletingSource] = useState<Source | null>(null);
  const [deleting, setDeleting] = useState(false);
  const lastSyncStates = useRef(new Map<string, Source["syncStatus"]>());
  const load = async () => {
    try {
      const next = await api<Source[]>("/datasources");
      for (const source of next) {
        const previous = lastSyncStates.current.get(source.id);
        if (previous === "RUNNING" && source.syncStatus !== "RUNNING") {
          setMessage({
            text:
              source.syncStatus === "SUCCEEDED"
                ? `“${source.name}”同步完成：同步 ${source.syncSyncedTables} 张，跳过 ${source.syncSkippedTables} 张。`
                : source.syncStatus === "PARTIAL_FAILED"
                  ? `“${source.name}”同步部分完成：失败 ${source.syncFailedTables} 张，请查看行内错误摘要。`
                  : `“${source.name}”同步失败：${source.syncError ?? "请检查连接配置后重试。"}`,
            tone:
              source.syncStatus === "SUCCEEDED"
                ? "success"
                : source.syncStatus === "PARTIAL_FAILED"
                  ? "info"
                  : "error",
          });
        }
        lastSyncStates.current.set(source.id, source.syncStatus);
      }
      setSources(next);
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : "无法加载数据源",
        tone: "error",
      });
    }
  };
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!sources.some((source) => source.syncStatus === "RUNNING")) return;
    const timer = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(timer);
  }, [sources]);
  useEffect(() => {
    if (!syncSource) return;
    const latest = sources.find((source) => source.id === syncSource.id);
    if (latest && latest.syncStatus !== syncSource.syncStatus)
      setSyncSource(latest);
  }, [sources, syncSource]);
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 3000);
    return () => window.clearTimeout(timer);
  }, [message]);
  const openCreate = () => {
    setEditing(null);
    setForm(initial());
    setTestedSignature(null);
    setShowPassword(false);
    setShowAccessKey(false);
    setShowSecretKey(false);
    setMessage(null);
    setOpen(true);
  };
  const openEdit = (source: Source) => {
    const c = source.connectionConfig;
    setEditing(source);
    setForm({
      ...initial(),
      name: source.name,
      type: source.type,
      description: source.description ?? "",
      host: c.host ?? "",
      port: c.port ?? "",
      project: c.project ?? "",
      serviceName: c.serviceName ?? "",
      filePath: c.filePath ?? "",
      region: c.region ?? "",
      endpoint: c.endpoint ?? "",
      username: source.username ?? "",
    });
    setTestedSignature(null);
    setShowPassword(false);
    setShowAccessKey(false);
    setShowSecretKey(false);
    setMessage(null);
    setOpen(true);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.type) return;
    if (testedSignature !== connectionSignature(form)) {
      setMessage({
        text: "请先使用当前配置测试连接成功后再保存。",
        tone: "error",
      });
      return;
    }
    setWorking(true);
    setMessage(null);
    try {
      const rawCredentials =
        form.type === "MAXCOMPUTE"
          ? { accessKey: form.accessKey, secretKey: form.secretKey }
          : { username: form.username, password: form.password };
      const credentials = editing
        ? Object.fromEntries(
            Object.entries(rawCredentials).filter(([, value]) => value),
          )
        : rawCredentials;
      const body = {
        name: form.name,
        type: form.type,
        description: form.description,
        connectionConfig: connection(form),
        credentials,
      };
      await api(editing ? `/datasources/${editing.id}` : "/datasources", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });
      setOpen(false);
      await load();
      setMessage({
        text: editing ? "数据源已更新。" : "数据源已添加，请先测试连接。",
        tone: "success",
      });
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : "保存失败",
        tone: "error",
      });
    } finally {
      setWorking(false);
    }
  };
  const testConnection = async () => {
    if (!form.type) return;
    setTesting(true);
    try {
      const rawCredentials =
        form.type === "MAXCOMPUTE"
          ? { accessKey: form.accessKey, secretKey: form.secretKey }
          : { username: form.username, password: form.password };
      const credentials = editing
        ? Object.fromEntries(
            Object.entries(rawCredentials).filter(([, value]) => value),
          )
        : rawCredentials;
      await api("/datasources/test-connection", {
        method: "POST",
        body: JSON.stringify({
          id: editing?.id,
          type: form.type,
          connectionConfig: connection(form),
          credentials,
        }),
      });
      setTestedSignature(connectionSignature(form));
      setMessage({
        text: "连接测试成功，现在可以保存数据源。",
        tone: "success",
      });
    } catch (error) {
      setTestedSignature(null);
      setMessage({
        text: error instanceof Error ? error.message : "连接失败，请检查配置。",
        tone: "error",
      });
    } finally {
      setTesting(false);
    }
  };
  const refreshSpaces = async (id: string) => {
    setRefreshingSpaces(true);
    setMessage(null);
    try {
      setSyncSpaces(
        await api<SyncSpace[]>(`/datasources/${id}/spaces/refresh`, {
          method: "POST",
        }),
      );
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : "无法读取数据空间",
        tone: "error",
      });
    } finally {
      setRefreshingSpaces(false);
    }
  };
  const openSync = (source: Source) => {
    setSyncSource(source);
    setSyncSpaces(source.selectedSpaces);
    setSyncOpen(true);
    void refreshSpaces(source.id);
  };
  const runSync = async () => {
    if (!syncSource) return;
    const selected = syncSpaces.filter((space) => space.selected);
    if (!selected.length) {
      setMessage({ text: "请至少选择一个数据空间。", tone: "error" });
      return;
    }
    setStartingSync(true);
    try {
      const result = await api<{ status?: "STARTED" | "RUNNING" }>(
        "/metadata/sync",
        {
          method: "POST",
          body: JSON.stringify({
            dataSourceId: syncSource.id,
            spaces: selected.map(({ catalog, schema }) => ({ catalog, schema })),
          }),
        },
      );
      setMessage({
        text:
          result.status === "RUNNING"
            ? "该数据源正在同步，正在持续刷新进度。"
            : "已开始后台同步，可关闭窗口并继续使用系统。",
        tone: "info",
      });
      setSyncSource((current) =>
        current ? { ...current, syncStatus: "RUNNING" } : current,
      );
      setSyncSpaces(await api<SyncSpace[]>(`/datasources/${syncSource.id}/spaces`));
      await load();
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "同步失败", tone: "error" });
    } finally {
      setStartingSync(false);
    }
  };
  const removeSource = async () => {
    if (!deletingSource) return;
    setDeleting(true);
    try {
      await api(`/datasources/${deletingSource.id}`, { method: "DELETE" });
      setDeletingSource(null);
      await load();
      setMessage({ text: `“${deletingSource.name}”已删除。`, tone: "success" });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "删除失败", tone: "error" });
    } finally {
      setDeleting(false);
    }
  };
  useEffect(() => {
    if (!syncOpen || !syncSource || syncSource.syncStatus !== "RUNNING") return;
    const timer = window.setInterval(async () => {
      setSyncSpaces(await api<SyncSpace[]>(`/datasources/${syncSource.id}/spaces`));
    }, 2000);
    return () => window.clearInterval(timer);
  }, [syncOpen, syncSource]);
  const type = form.type;
  return (
    <main className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">数据源</h1>
          <p className="mt-1 text-sm text-slate-500">
            配置连接并将数据空间、表和字段同步至数据资产。
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" />
          添加数据源
        </Button>
      </div>
      {message &&
        (() => {
          const Icon =
            message.tone === "error"
              ? CircleAlert
              : message.tone === "success"
                ? CheckCircle2
                : Info;
          return (
            <Alert
              variant={message.tone === "error" ? "destructive" : "default"}
              className={
                message.tone === "success"
                  ? "fixed left-1/2 top-6 z-[100] w-[min(calc(100vw-2rem),42rem)] -translate-x-1/2 border-emerald-200 bg-emerald-50 pr-10 text-emerald-800 shadow-lg"
                  : "fixed left-1/2 top-6 z-[100] w-[min(calc(100vw-2rem),42rem)] -translate-x-1/2 pr-10 shadow-lg"
              }
            >
              <Icon
                className={
                  message.tone === "error"
                    ? "text-rose-600"
                    : message.tone === "success"
                      ? "text-emerald-600"
                      : "text-slate-600"
                }
              />
              <AlertTitle>
                {message.tone === "error"
                  ? "操作失败"
                  : message.tone === "success"
                    ? "操作成功"
                    : "同步提示"}
              </AlertTitle>
              <AlertDescription>{message.text}</AlertDescription>
              <button
                type="button"
                className="absolute right-3 top-3 rounded-sm text-current/60 transition-colors hover:text-current"
                aria-label="关闭提示"
                onClick={() => setMessage(null)}
              >
                <X className="h-4 w-4" />
              </button>
            </Alert>
          );
        })()}
      <Table freezeLastColumn>
        <thead>
          <tr>
            <TableHead>数据源</TableHead>
            <TableHead>类型</TableHead>
            <TableHead>数据空间</TableHead>
            <TableHead>连接地址</TableHead>
            <TableHead>状态</TableHead>
            <TableHead>最近同步</TableHead>
            <TableHead>同步进度</TableHead>
            <TableHead>操作</TableHead>
          </tr>
        </thead>
        <tbody>
          {sources.length === 0 ? (
            <tr>
              <TableCell
                colSpan={8}
                className="py-16 text-center text-slate-500"
              >
                <Database className="mx-auto mb-2 h-7 w-7" />
                暂无数据源
              </TableCell>
            </tr>
          ) : (
            sources.map((source) => (
              <tr key={source.id}>
                <TableCell>
                  <p className="font-medium">{source.name}</p>
                  {source.description && (
                    <p className="mt-1 text-xs text-slate-400">
                      {source.description}
                    </p>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <SourceIcon type={source.type} />
                    {info[source.type].label}
                  </div>
                </TableCell>
                <TableCell>{displaySpace(source)}</TableCell>
                <TableCell
                  className="max-w-56 truncate"
                  title={displayConnection(source)}
                >
                  {displayConnection(source)}
                </TableCell>
                <TableCell>
                  <StatusBadge status={source.status} />
                </TableCell>
                <TableCell className="text-xs text-slate-500">
                  {source.lastSyncedAt
                    ? new Date(source.lastSyncedAt).toLocaleString()
                    : "未同步"}
                </TableCell>
                <TableCell className="min-w-52">
                  {source.syncStatus === "RUNNING" ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs text-slate-600">
                        <span>
                          {source.syncTotalTables
                            ? "正在同步"
                            : "正在读取表清单"}
                        </span>
                        <span>
                          {source.syncTotalTables
                            ? `${Math.round((source.syncProcessedTables / source.syncTotalTables) * 100)}%`
                            : "..."}
                        </span>
                      </div>
                      <Progress
                        value={
                          source.syncTotalTables
                            ? (source.syncProcessedTables /
                                source.syncTotalTables) *
                              100
                            : 8
                        }
                      />
                      <p className="text-xs text-slate-500">
                        已处理 {source.syncProcessedTables} /{" "}
                        {source.syncTotalTables || "-"}
                      </p>
                    </div>
                  ) : source.syncStatus === "IDLE" ? (
                    <span className="text-sm text-slate-400">未同步</span>
                  ) : (
                    <div className="space-y-1 text-xs">
                      <p
                        className={
                          source.syncStatus === "SUCCEEDED"
                            ? "text-emerald-700"
                            : source.syncStatus === "PARTIAL_FAILED"
                              ? "text-amber-700"
                              : "text-rose-700"
                        }
                      >
                        {source.syncStatus === "SUCCEEDED"
                          ? "同步完成"
                          : source.syncStatus === "PARTIAL_FAILED"
                            ? "部分完成"
                            : "同步失败"}
                      </p>
                      <p className="text-slate-500">
                        同步 {source.syncSyncedTables}，跳过{" "}
                        {source.syncSkippedTables}，失败{" "}
                        {source.syncFailedTables}
                      </p>
                      {source.syncError && (
                        <p
                          className="line-clamp-2 text-rose-600"
                          title={source.syncError}
                        >
                          {source.syncError}
                        </p>
                      )}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEdit(source)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      编辑
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => openSync(source)}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      同步
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={source.syncStatus === "RUNNING"}
                      className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                      onClick={() => setDeletingSource(source)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      删除
                    </Button>
                  </div>
                </TableCell>
              </tr>
            ))
          )}
        </tbody>
      </Table>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100vh-2rem)] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "编辑数据源" : "添加数据源"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "更新连接信息后建议重新测试。"
                : "先选择数据库类型，再填写对应连接配置。"}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-5" onSubmit={submit}>
            {!editing && (
              <div>
                <p className="mb-3 text-sm font-medium">数据库类型</p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {(Object.keys(info) as Type[]).map((item) => (
                    <button
                      type="button"
                      key={item}
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          type: item,
                          port: "",
                        }))
                      }
                      className={`flex items-center gap-3 rounded-lg border !border-slate-200 p-3 text-left !outline-none transition-shadow focus:!border-slate-200 focus:!outline-none focus-visible:!border-slate-200 focus-visible:!outline-none focus-visible:!ring-0 ${type === item ? "bg-slate-50 shadow-md" : "hover:shadow-sm"}`}
                    >
                      <SourceIcon type={item} />
                      <span>
                        <b className="block text-sm">{info[item].label}</b>
                        <span className="text-xs text-slate-500">
                          {info[item].detail}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {type && (
              <>
                <FieldGroup className="sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="source-name">数据源名称</FieldLabel>
                    <Input
                      id="source-name"
                      required
                      value={form.name}
                      placeholder="例如：电商生产 MySQL"
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="source-description">
                      描述{" "}
                      <span className="font-normal text-slate-400">
                        （可选）
                      </span>
                    </FieldLabel>
                    <Input
                      id="source-description"
                      value={form.description}
                      placeholder="说明该数据源的用途"
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          description: event.target.value,
                        }))
                      }
                    />
                  </Field>
                </FieldGroup>
                {type === "SQLITE" ? (
                  <Field>
                    <FieldLabel htmlFor="source-file">
                      SQLite 文件路径
                    </FieldLabel>
                    <Input
                      id="source-file"
                      required
                      value={form.filePath}
                      placeholder="服务端绝对路径，例如 D:\\data\\demo.db"
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          filePath: event.target.value,
                        }))
                      }
                    />
                    <FieldDescription>
                      仅允许服务端配置目录内的 .db 或 .sqlite 文件。
                    </FieldDescription>
                  </Field>
                ) : type === "MAXCOMPUTE" ? (
                  <FieldGroup className="sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="source-region">Region</FieldLabel>
                      <Input
                        id="source-region"
                        required
                        value={form.region}
                        placeholder="例如 cn-hangzhou"
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            region: event.target.value,
                          }))
                        }
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="source-project">Project</FieldLabel>
                      <Input
                        id="source-project"
                        required
                        value={form.project}
                        placeholder="MaxCompute Project 名称"
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            project: event.target.value,
                          }))
                        }
                      />
                    </Field>
                    <Field className="sm:col-span-2">
                      <FieldLabel htmlFor="source-endpoint">
                        Endpoint
                      </FieldLabel>
                      <Input
                        id="source-endpoint"
                        required
                        value={form.endpoint}
                        placeholder="https://service.cn-hangzhou.maxcompute.aliyun.com/api"
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            endpoint: event.target.value,
                          }))
                        }
                      />
                    </Field>
                    <SecretField
                      id="source-access-key"
                      label="AccessKey"
                      required={!editing}
                      value={form.accessKey}
                      placeholder={
                        editing ? "••••••••" : "输入 AccessKey"
                      }
                      visible={showAccessKey}
                      onVisibleChange={setShowAccessKey}
                      onChange={(value) =>
                        setForm((current) => ({ ...current, accessKey: value }))
                      }
                    />
                    <SecretField
                      id="source-secret-key"
                      label="SecretKey"
                      required={!editing}
                      value={form.secretKey}
                      placeholder={
                        editing ? "••••••••" : "输入 SecretKey"
                      }
                      visible={showSecretKey}
                      onVisibleChange={setShowSecretKey}
                      onChange={(value) =>
                        setForm((current) => ({ ...current, secretKey: value }))
                      }
                    />
                  </FieldGroup>
                ) : (
                  <FieldGroup className="sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="source-host">Host</FieldLabel>
                      <Input
                        id="source-host"
                        required
                        value={form.host}
                        placeholder="数据库主机地址"
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            host: event.target.value,
                          }))
                        }
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="source-port">
                        端口{" "}
                        <span className="font-normal text-slate-400">
                          （可选）
                        </span>
                      </FieldLabel>
                      <Input
                        id="source-port"
                        value={form.port}
                        placeholder={`默认 ${type === "POSTGRESQL" ? 5432 : type === "SQLSERVER" ? 1433 : type === "ORACLE" ? 1521 : 3306}`}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            port: event.target.value,
                          }))
                        }
                      />
                    </Field>
                    {type === "ORACLE" && (
                      <Field>
                        <FieldLabel htmlFor="source-service-name">
                          Service Name
                        </FieldLabel>
                        <Input
                          id="source-service-name"
                          required
                          value={form.serviceName}
                          placeholder="Oracle Service Name"
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              serviceName: event.target.value,
                            }))
                          }
                        />
                      </Field>
                    )}
                    <Field>
                      <FieldLabel htmlFor="source-username">用户名</FieldLabel>
                      <Input
                        id="source-username"
                        required
                        value={form.username}
                        placeholder="数据库登录用户名"
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            username: event.target.value,
                          }))
                        }
                      />
                    </Field>
                    <SecretField
                      id="source-password"
                      label="密码"
                      required={!editing}
                      value={form.password}
                      placeholder={
                        editing ? "••••••••" : "输入数据库密码"
                      }
                      visible={showPassword}
                      onVisibleChange={setShowPassword}
                      onChange={(value) =>
                        setForm((current) => ({ ...current, password: value }))
                      }
                    />
                  </FieldGroup>
                )}
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setOpen(false)}
                  >
                    取消
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={testing}
                    onClick={() => void testConnection()}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {testing ? "测试中…" : "测试连接"}
                  </Button>
                  <Button
                    disabled={
                      working || testedSignature !== connectionSignature(form)
                    }
                    type="submit"
                  >
                    <Save className="h-4 w-4" />
                    {working ? "保存中…" : "保存数据源"}
                  </Button>
                </DialogFooter>
              </>
            )}
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={syncOpen} onOpenChange={setSyncOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>同步数据空间</DialogTitle>
            <DialogDescription>
              {syncSource
                ? `选择“${syncSource.name}”中需要同步至数据资产的数据空间。`
                : "选择需要同步的数据空间。"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">数据空间</p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={refreshingSpaces || !syncSource}
                  onClick={() => syncSource && void refreshSpaces(syncSource.id)}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${refreshingSpaces ? "animate-spin" : ""}`} />
                  {refreshingSpaces ? "刷新中…" : "刷新"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={refreshingSpaces || syncSource?.syncStatus === "RUNNING"}
                  onClick={() =>
                    setSyncSpaces((items) =>
                      items.map((item) => ({ ...item, selected: !items.every((space) => space.selected) })),
                    )
                  }
                >
                  {syncSpaces.length && syncSpaces.every((space) => space.selected)
                    ? "取消全选"
                    : "全选"}
                </Button>
              </div>
            </div>
            <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200">
              {refreshingSpaces && !syncSpaces.length ? (
                <p className="p-5 text-sm text-slate-500">正在测试连接并读取数据空间…</p>
              ) : syncSpaces.length ? (
                syncSpaces.map((space) => {
                  const running = space.syncStatus === "RUNNING";
                  const progress = space.syncTotalTables
                    ? (space.syncProcessedTables / space.syncTotalTables) * 100
                    : running
                      ? 8
                      : 0;
                  return (
                    <label key={space.id || `${space.catalog}:${space.schema}`} className="flex cursor-pointer items-start gap-3 border-b border-slate-200/80 p-3 last:border-b-0 hover:bg-slate-50">
                      <Checkbox
                        checked={space.selected}
                        disabled={syncSource?.syncStatus === "RUNNING"}
                        onCheckedChange={(checked) =>
                          setSyncSpaces((items) =>
                            items.map((item) => item.id === space.id ? { ...item, selected: checked === true } : item),
                          )
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
                          <Database className="h-4 w-4 shrink-0 text-slate-400" />
                          <span className="truncate">{space.name}</span>
                        </span>
                        {space.description && <span className="block text-xs text-slate-500">{space.description}</span>}
                        {(running || space.syncStatus !== "IDLE") && (
                          <span className="mt-2 block space-y-1">
                            <span className="flex justify-between text-xs text-slate-500">
                              <span>{running ? "正在同步" : space.syncStatus === "SUCCEEDED" ? "同步完成" : space.syncStatus === "PARTIAL_FAILED" ? "部分完成" : "同步失败"}</span>
                              <span>{space.syncProcessedTables} / {space.syncTotalTables || "-"}</span>
                            </span>
                            <Progress value={progress} />
                            {space.syncError && <span className="block text-xs text-rose-600">{space.syncError}</span>}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })
              ) : (
                <p className="p-5 text-sm text-slate-500">暂无可访问的数据空间。</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSyncOpen(false)}>关闭</Button>
            <Button
              type="button"
              disabled={startingSync || refreshingSpaces || syncSource?.syncStatus === "RUNNING"}
              onClick={() => void runSync()}
            >
              <RefreshCw className={`h-4 w-4 ${startingSync ? "animate-spin" : ""}`} />
              {startingSync ? "启动中…" : "同步已选数据空间"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(deletingSource)} onOpenChange={(open) => !open && !deleting && setDeletingSource(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>删除数据源</DialogTitle>
            <DialogDescription>
              删除“{deletingSource?.name}”后，其数据空间、已同步资产、字段与治理关联将一并删除，且无法恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={deleting} onClick={() => setDeletingSource(null)}>
              取消
            </Button>
            <Button type="button" disabled={deleting} className="bg-rose-600 hover:bg-rose-700" onClick={() => void removeSource()}>
              <Trash2 className="h-4 w-4" />
              {deleting ? "删除中…" : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
