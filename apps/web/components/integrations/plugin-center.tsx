"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Download,
  Copy,
  Plug,
  Database,
  ChevronDown,
  CircleHelp,
  ExternalLink,
} from "lucide-react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { IntegrationsTabs } from "./integrations-tabs";
import { PluginToolList, type PluginTool } from "./plugin-tool-list";
import { PluginSetup } from "./plugin-setup";
type PluginInfo = {
  version: string;
  rules_version: string;
  customized: boolean;
  mcp_url: string;
  tools: PluginTool[];
  downloads: Array<{
    client: "codex" | "claude" | "eureka";
    label: string;
    download_url: string;
  }>;
};
export function PluginCenter() {
  const [info, setInfo] = useState<PluginInfo | null>(null),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0),
    [message, setMessage] = useState(""),
    [helpOpen, setHelpOpen] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setMessage("");
    setInfo(null);
    void api<PluginInfo>("/integrations/plugins", { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) {
          if (!Array.isArray(value.tools))
            throw new Error("工具信息缺失，请更新并重启 API 服务后重试。");
          setInfo(value);
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause.message);
      });
    return () => controller.abort();
  }, [retry]);
  const copy = (value: string, success: string) => {
    void navigator.clipboard.writeText(value).then(
      () => setMessage(success),
      () => setError("复制失败，请手动复制内容。"),
    );
  };
  return (
    <main className="flex min-h-0 flex-col lg:h-[calc(100dvh-105px)]">
      <IntegrationsTabs
        help={
          <TooltipProvider delayDuration={150}>
            <Tooltip open={helpOpen} onOpenChange={setHelpOpen}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Agent 插件介绍"
                  onClick={() => setHelpOpen((v) => !v)}
                  className="size-6 text-slate-400 hover:text-slate-700"
                >
                  <CircleHelp className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                align="start"
                className="shadcn-scrollbar max-h-[70dvh] w-[min(34rem,calc(100vw-2rem))] overflow-y-auto p-4 text-xs font-normal leading-6"
              >
                <div className="space-y-3">
                  <p className="font-semibold">
                    把 Atlas 的业务数据查询能力交给 AI
                  </p>
                  <p>
                    插件让 AI
                    按正式的业务口径查找数据表、确认指标含义、查询数据并读取结果，不用人工拼写查询语句。
                  </p>
                  <p>
                    OpenAI Codex 和 Claude Code 提供独立插件包；另提供 Eureka
                    专用包，供管理员上传 Haze 插件市场后，在已支持组织插件功能的
                    Eureka 中安装。尚未完成真实安装与查询联调。各端连接同一个
                    Atlas 服务。其他支持远程 MCP
                    的桌面或命令行软件也可连接工具服务，但不会自动获得插件中的问数规则。
                  </p>
                  <p>
                    数据范围按每次对话独立保存；任务和结果只允许本人在对应对话中读取。默认范围为全部已发布可查询表，不提供任意
                    SQL 或系统管理功能。
                  </p>
                  <p>
                    四种有效用户角色均可使用本人凭证访问
                    MCP，插件管理与下载仅管理员可用。插件包含当前问数规则的快照，已安装版本不会自动同步规则变化。
                  </p>
                  {info && (
                    <div className="space-y-1 border-t border-slate-600 pt-3 text-slate-300">
                      <p>插件版本：{info.version}</p>
                      <p>
                        规则来源：
                        {info.customized
                          ? "管理员设置及系统基本要求"
                          : "系统默认规则"}
                      </p>
                      <p className="break-all">
                        规则编号：{info.rules_version}
                      </p>
                    </div>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        }
        actions={
          <>
            <Button asChild size="sm" variant="outline">
              <Link
                href="/integrations/plugins/data-selector"
                target="_blank"
                rel="noreferrer"
              >
                <Database className="size-3.5" />
                数据集选择页面
                <ExternalLink className="size-3.5" />
              </Link>
            </Button>
            {info && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline">
                    <Download className="size-4" />
                    下载插件
                    <ChevronDown className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {info.downloads.map((item) => (
                    <DropdownMenuItem key={item.client} asChild>
                      <a href={item.download_url} download>
                        <Download className="size-4" />
                        下载 {item.label} 插件
                      </a>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      >
        <section
          aria-label="Agent 插件详情"
          className="flex min-h-0 flex-1 flex-col gap-4 pb-1"
        >
          {error && (
            <Alert variant="destructive" className="shrink-0">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {!info && !error && (
            <p role="status" className="shrink-0 text-sm text-slate-500">
              正在读取插件信息…
            </p>
          )}
          <div className="grid min-h-0 min-w-0 flex-1 gap-4 lg:grid-cols-2 lg:grid-rows-[minmax(0,1fr)]">
            <PluginSetup
              refreshing={!info && !error}
              onRefresh={() => setRetry((v) => v + 1)}
            />
            <Card
              role="region"
              aria-label="MCP 服务与工具"
              className="flex max-h-[75dvh] min-h-0 min-w-0 flex-col rounded-xl shadow-none lg:max-h-none"
            >
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <Plug className="size-4" />
                  MCP 服务与工具
                </h2>
                <Badge className="bg-slate-100 text-slate-600">
                  HTTP · Streamable HTTP
                </Badge>
              </div>
              <CardContent
                aria-label="MCP 服务与工具内容"
                tabIndex={0}
                className="shadcn-scrollbar min-h-0 space-y-4 overflow-y-auto overscroll-contain p-4"
              >
                <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="min-w-0">
                    <p className="mb-1 text-[11px] text-slate-500">
                      MCP 服务器地址
                    </p>
                    {info ? (
                      <code className="break-all text-xs text-slate-900">
                        {info.mcp_url}
                      </code>
                    ) : (
                      <span className="text-xs text-slate-400">
                        等待插件信息
                      </span>
                    )}
                  </div>
                  <div role="group" aria-label="插件连接操作">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!info}
                      onClick={() => {
                        if (info) copy(info.mcp_url, "连接地址已复制");
                      }}
                    >
                      <Copy className="size-3.5" />
                      复制 MCP 地址
                    </Button>
                  </div>
                </div>
                {message && (
                  <p role="status" className="text-xs text-emerald-700">
                    {message}
                  </p>
                )}
                <PluginToolList tools={info ? info.tools : null} />
              </CardContent>
            </Card>
          </div>
        </section>
      </IntegrationsTabs>
    </main>
  );
}
