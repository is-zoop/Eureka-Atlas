"use client";
import { useEffect, useRef, useState } from "react";
import type { SemanticSelectableTable } from "@eureka-atlas/types";
import { agentSelectionRequest } from "@/lib/agent-selection";
import { SemanticTableSelector } from "@/components/semantic/semantic-table-selector";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
type Selection = {
  view_id: string;
  member_no: string;
  session: {
    session_id: string;
    scope_mode: string;
    scope_revision: number;
    selected_table_ids: string[];
    invalid_table_ids: string[];
    scope_valid: boolean;
    available_tables: SemanticSelectableTable[];
  };
};
export function AgentSelection({ viewId }: { viewId: string }) {
  const [data, setData] = useState<Selection | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [confirm, setConfirm] = useState(false),
    [revoked, setRevoked] = useState(false);
  const initial = useRef<Promise<Selection> | null>(null),
    inFlight = useRef(false);
  const accept = (value: Selection) => {
    setData(value);
    setSelected(value.session.selected_table_ids);
  };
  useEffect(() => {
    let active = true;
    // A fresh explicit launch into an already-open window is a new authorization,
    // not a harmless anchor jump. Reinitialize rather than reuse a rejected Cookie.
    const relaunch = () => {
      if (new URLSearchParams(window.location.hash.slice(1)).has("launch"))
        window.location.reload();
    };
    window.addEventListener("hashchange", relaunch);
    // Keep the one-time exchange promise across React Strict Mode's effect replay.
    if (!initial.current) {
      const url = new URL(window.location.href),
        launch = new URLSearchParams(url.hash.slice(1)).get("launch");
      window.history.replaceState(null, "", url.pathname);
      initial.current = launch
        ? agentSelectionRequest<Selection>(viewId, "/exchange", {
            method: "POST",
            body: JSON.stringify({ launch }),
          })
        : agentSelectionRequest<Selection>(viewId);
    }
    void initial.current
      .then((value) => {
        if (active) accept(value);
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
      window.removeEventListener("hashchange", relaunch);
    };
  }, [viewId]);
  const save = async () => {
    if (!data || inFlight.current) return;
    inFlight.current = true;
    setConfirm(false);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      accept(
        await agentSelectionRequest<Selection>(viewId, "", {
          method: "PATCH",
          body: JSON.stringify({
            scope_mode: selected.length ? "SELECTED" : "ALL",
            selected_table_ids: selected,
            expected_revision: data.session.scope_revision,
          }),
        }),
      );
      setMessage(
        "范围已保存。回到 Agent 后可继续当前对话，AI 会读取最新范围。",
      );
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const disconnect = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await agentSelectionRequest(viewId, "", { method: "DELETE" });
      setRevoked(true);
      setData(null);
      setSelected([]);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <main aria-label="Atlas数据目录" className="space-y-4">
      {busy && !data && (
        <p role="status" className="text-sm text-slate-500">
          正在确认当前对话的选数授权…
        </p>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {revoked ? (
        <Alert>
          <AlertDescription>
            已断开此对话的浏览器选数授权，已保存范围和后台查询均保留。需要时请让
            Agent 重新打开。
          </AlertDescription>
        </Alert>
      ) : (
        <>
          {data && (
            <>
              {!data.session.scope_valid && (
                <Alert variant="destructive">
                  <AlertDescription>
                    当前已保存范围包含失效表或无效记录，新查询已阻止，不会自动扩大范围。
                    {data.session.invalid_table_ids.length > 0 && (
                      <p className="break-all">
                        失效表：{data.session.invalid_table_ids.join("、")}
                      </p>
                    )}
                  </AlertDescription>
                </Alert>
              )}
              <SemanticTableSelector
                tables={data.session.available_tables}
                value={selected}
                onValueChange={setSelected}
                disabled={busy}
                showSourceDetails={false}
                fullHeight
                className="h-[min(32rem,55dvh)] rounded-xl border border-slate-200"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  disabled={busy}
                  onClick={() => {
                    if (
                      !selected.length &&
                      (data.session.scope_mode !== "ALL" ||
                        !data.session.scope_valid)
                    )
                      setConfirm(true);
                    else void save();
                  }}
                >
                  保存当前对话范围
                </Button>
                <Button
                  variant="destructive"
                  disabled={busy}
                  onClick={() => void disconnect()}
                >
                  断开授权
                </Button>
              </div>
            </>
          )}
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
              保存后会使用全部已发布可查询表，未来新增表也会进入范围，不代表禁止查询。
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
