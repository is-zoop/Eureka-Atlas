"use client";
import { useEffect, useRef, useState } from "react";
import type { SemanticSelectableTable } from "@eureka-atlas/types";
import { PageHeader } from "@/components/common/page-header";
import { SemanticTableSelector } from "@/components/semantic/semantic-table-selector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";

type Session = {
  session_id: string;
  scope_mode: string;
  scope_revision: number;
  selected_table_ids: string[];
  invalid_table_ids: string[];
  scope_valid: boolean;
  available_tables: SemanticSelectableTable[];
};
export function DataSelector() {
  const [session, setSession] = useState<Session | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [id, setId] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [confirm, setConfirm] = useState(false);
  const scope = useRef<AbortController | null>(null),
    inFlight = useRef(false);
  const accept = (value: Session) => {
    setSession(value);
    setSelected(value.selected_table_ids);
    setId(value.session_id);
    const url = new URL(window.location.href);
    url.searchParams.set("session_id", value.session_id);
    window.history.replaceState(null, "", url);
  };
  const load = async (target: string, create = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    scope.current?.abort();
    const controller = new AbortController();
    scope.current = controller;
    setBusy(true);
    setError("");
    setMessage("");
    setSession(null);
    setSelected([]);
    try {
      const value = await api<Session>(
        "/integrations/agent-sessions" +
          (create ? "" : "/" + encodeURIComponent(target)),
        { method: create ? "POST" : "GET", signal: controller.signal },
      );
      if (!controller.signal.aborted) accept(value);
    } catch (cause) {
      if (!controller.signal.aborted) setError((cause as Error).message);
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false);
        inFlight.current = false;
      }
    }
  };
  useEffect(() => {
    const target = new URL(window.location.href).searchParams.get("session_id");
    if (target) {
      setId(target);
      void load(target);
    }
    return () => {
      scope.current?.abort();
      inFlight.current = false;
    };
  }, []);
  const save = async () => {
    if (!session || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    setConfirm(false);
    const controller = new AbortController();
    scope.current = controller;
    try {
      const value = await api<Session>(
        "/integrations/agent-sessions/" +
          encodeURIComponent(session.session_id),
        {
          method: "PATCH",
          signal: controller.signal,
          body: JSON.stringify({
            scope_mode: selected.length ? "SELECTED" : "ALL",
            selected_table_ids: selected,
            expected_revision: session.scope_revision,
          }),
        },
      );
      if (!controller.signal.aborted) {
        accept(value);
        setMessage("已保存。回到 Agent 后，请让它读取当前会话范围再继续查询。");
      }
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          (cause as Error).message + " 请重新读取会话，确认最新范围后再保存。",
        );
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false);
        inFlight.current = false;
      }
    }
  };
  return (
    <main className="space-y-4">
      <PageHeader
        title="选择要查询的数据"
        description="这里的选择只影响当前这次对话。请使用与 AI 软件中个人凭证相同的账号登录。"
      />
      <p className="text-sm text-slate-600">
        新会话默认使用全部已发布可查询表。未勾选不是禁止查询；要缩小范围，请选择部分表并保存。
      </p>
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label="业务会话 ID"
          value={id}
          onChange={(event) => setId(event.target.value)}
          placeholder="粘贴 Agent 返回的 session_id"
          className="max-w-lg"
          disabled={busy}
        />
        <Button
          variant="outline"
          disabled={busy || !id.trim()}
          onClick={() => void load(id.trim())}
        >
          读取会话
        </Button>
        <Button disabled={busy} onClick={() => void load("", true)}>
          创建新会话
        </Button>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {session && (
        <>
          <Alert>
            <AlertDescription>
              {selected.length
                ? `待保存范围：仅 ${selected.length} 张已选表。`
                : `待保存范围：使用全部已发布可查询表（动态范围，未来新增表也会进入）。未勾选不代表禁止查询。`}
              <p className="mt-1">
                已保存范围：
                {session.scope_mode === "ALL"
                  ? "全部已发布可查询表"
                  : `${session.selected_table_ids.length} 张指定表`}{" "}
                · 版本 {session.scope_revision}
              </p>
            </AlertDescription>
          </Alert>
          {!session.scope_valid && (
            <Alert variant="destructive">
              <AlertDescription>
                已保存范围存在失效表或无效记录；新查询已阻止，不会自动扩大范围。请重新选择并确认保存。
                {session.invalid_table_ids.length > 0 && (
                  <p className="mt-1 break-all">
                    失效表：{session.invalid_table_ids.join("、")}
                  </p>
                )}
              </AlertDescription>
            </Alert>
          )}
          <SemanticTableSelector
            tables={session.available_tables}
            value={selected}
            onValueChange={setSelected}
            disabled={busy}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              disabled={busy}
              onClick={() => {
                if (
                  !selected.length &&
                  (session.scope_mode !== "ALL" || !session.scope_valid)
                )
                  setConfirm(true);
                else void save();
              }}
            >
              保存范围
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void navigator.clipboard.writeText(session.session_id).then(
                  () => setMessage("会话标识已复制，请交给当前 Agent。"),
                  () => setError("无法复制，请手动复制上方会话标识。"),
                )
              }
            >
              复制会话标识
            </Button>
            <p className="text-xs text-slate-500">
              修改仅影响后续新查询，不取消已有任务。范围跟随对话保存，不按七天清理；查询结果仍为24小时可读。
            </p>
          </div>
          {message && (
            <p role="status" className="text-sm text-emerald-700">
              {message}
            </p>
          )}
        </>
      )}
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>恢复全部数据范围？</DialogTitle>
            <DialogDescription>
              已清空勾选。保存后将从部分表扩大为全部已发布可查询表，而不是禁止查询。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              返回检查
            </Button>
            <Button onClick={() => void save()}>确认使用全部表</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
