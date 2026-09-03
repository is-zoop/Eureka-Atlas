"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  CheckCircle2,
  Clipboard,
  Download,
  FileJson,
  RefreshCw,
} from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api";

type SemanticPackage = {
  table: {
    name: string;
    business_name: string;
    description: string;
    grain: string;
    permission_field: string | null;
  };
  fields: Array<{
    column: string;
    name: string;
    type: string;
    aggregation: string | null;
    unit: string | null;
  }>;
  updatedAt: string;
};

export default function SemanticPackagePage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<SemanticPackage | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const load = async () => {
    const result = await api<SemanticPackage>(`/packages/${id}`);
    setData(result);
    setMissing(false);
  };
  useEffect(() => {
    let cancelled = false;
    void api<SemanticPackage>(`/packages/${id}`)
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setMissing(false);
        }
      })
      .catch((cause: Error) => {
        if (cancelled) return;
        if (cause.message.includes("Semantic package not found"))
          setMissing(true);
        else setError(cause.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);
  const json = useMemo(
    () =>
      data
        ? JSON.stringify({ table: data.table, fields: data.fields }, null, 2)
        : "",
    [data],
  );
  const generate = async () => {
    setWorking(true);
    setError("");
    setNotice("");
    try {
      await api<SemanticPackage>(`/packages/generate/${id}`, {
        method: "POST",
      });
      await load();
      setNotice("Semantic Package 已生成");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "生成 Semantic Package 失败",
      );
    } finally {
      setWorking(false);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setNotice("JSON 已复制到剪贴板");
    } catch {
      setError("无法复制 JSON，请检查浏览器权限");
    }
  };
  const download = () => {
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${data?.table.name ?? "semantic-package"}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <main>
      <PageHeader
        title="Semantic Package"
        description="面向未来 Agent 消费的已发布数据语义 JSON。"
        backHref={`/assets/tables/${id}`}
        actions={
          data ? (
            <>
              <Button variant="outline" onClick={() => void copy()}>
                <Clipboard className="mr-2 h-4 w-4" />
                复制 JSON
              </Button>
              <Button variant="outline" onClick={download}>
                <Download className="mr-2 h-4 w-4" />
                下载 JSON
              </Button>
              <Button disabled={working} onClick={() => void generate()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                重新生成
              </Button>
            </>
          ) : undefined
        }
      />
      {error && (
        <p className="mb-5 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </p>
      )}
      {notice && (
        <p className="mb-5 flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4" />
          {notice}
        </p>
      )}
      {missing ? (
        <Card>
          <CardContent className="py-14 text-center">
            <FileJson className="mx-auto mb-3 h-9 w-9 text-slate-400" />
            <h2 className="font-semibold">尚未生成 Semantic Package</h2>
            <p className="mt-2 text-sm text-slate-500">
              该表需要先具备已发布的表语义和至少一个字段语义。
            </p>
            <Button
              className="mt-5"
              disabled={working}
              onClick={() => void generate()}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              生成 Package
            </Button>
          </CardContent>
        </Card>
      ) : data ? (
        <>
          <Card className="mb-5">
            <CardContent className="grid gap-4 text-sm md:grid-cols-4">
              <div>
                <p className="text-slate-500">物理表</p>
                <p className="mt-1 font-medium">{data.table.name}</p>
              </div>
              <div>
                <p className="text-slate-500">业务名称</p>
                <p className="mt-1 font-medium">{data.table.business_name}</p>
              </div>
              <div>
                <p className="text-slate-500">字段数</p>
                <p className="mt-1 font-medium">{data.fields.length} 个</p>
              </div>
              <div>
                <p className="text-slate-500">更新时间</p>
                <p className="mt-1 font-medium">
                  {new Date(data.updatedAt).toLocaleString()}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <pre className="max-h-[70vh] overflow-auto rounded-lg bg-slate-950 p-5 text-xs leading-6 text-slate-100">
                {json}
              </pre>
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardContent className="py-14 text-center text-slate-500">
            正在加载 Package…
          </CardContent>
        </Card>
      )}
    </main>
  );
}
