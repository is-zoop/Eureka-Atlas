"use client";
import Link from "next/link";
import { RefreshCw, Settings2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function PluginSetup({
  refreshing,
  onRefresh,
}: {
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const claudeExample =
    '$env:ATLAS_PERSONAL_CREDENTIAL = "<你的个人凭证>"\nclaude --plugin-dir "<Claude 插件解压目录>"';
  return (
    <Card
      role="region"
      aria-label="插件配置方法"
      className="flex max-h-[75dvh] min-h-0 min-w-0 flex-col rounded-xl shadow-none lg:max-h-none"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Settings2 className="size-4" />
          插件配置方法
        </h2>
        <Button
          size="sm"
          variant="outline"
          disabled={refreshing}
          onClick={onRefresh}
        >
          <RefreshCw className="size-3.5" />
          刷新插件信息
        </Button>
      </div>
      <CardContent
        aria-label="插件配置内容"
        tabIndex={0}
        className="shadcn-scrollbar min-h-0 space-y-5 overflow-y-auto overscroll-contain p-4"
      >
        <p className="text-xs leading-6 text-slate-500">
          按你使用的软件安装对应插件。插件包已包含服务器连接配置，无需再手动新建
          MCP 服务；右侧地址用于核对。Codex 使用独立选数窗口；Claude Desktop
          Code 模式使用原生面板。Eureka
          包适用于已支持组织插件功能的版本，尚未完成真实安装与查询联调。
        </p>
        <ol className="space-y-5">
          <li className="flex gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
              1
            </span>
            <div className="min-w-0 space-y-1">
              <h3 className="text-xs font-semibold">下载并解压插件</h3>
              <p className="text-xs leading-6 text-slate-600">
                在右上角“下载插件”中选择 OpenAI Codex、Claude Code 或
                Eureka。前两者解压后保留整个目录，不要只复制 Skill；Eureka
                包保留完整 ZIP，由管理员上传 Haze 插件市场。
              </p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
              2
            </span>
            <div className="min-w-0 flex-1 space-y-3">
              <h3 className="text-xs font-semibold">安装到对应的软件</h3>
              <div className="space-y-1 rounded-lg border border-slate-200 p-3">
                <h4 className="text-xs font-semibold">OpenAI Codex</h4>
                <p className="text-xs leading-6 text-slate-600">
                  使用支持 Agent Plugins 1.0 的 Codex CLI
                  或桌面端，按当前版本的插件导入或市场安装流程加载{" "}
                  <code>atlas-ask-codex</code> 解压根目录。IDE
                  插件界面不在支持范围内。
                </p>
                <p className="text-xs leading-6 text-slate-500">
                  若客户端要求团队市场登记，请管理员按包内 README
                  协助安装，不要把 ZIP 当作市场清单。
                </p>
              </div>
              <div className="space-y-1 rounded-lg border border-slate-200 p-3">
                <h4 className="text-xs font-semibold">Eureka（组织插件）</h4>
                <p className="text-xs leading-6 text-slate-600">
                  管理员上传 Haze 插件市场后，用户在已支持组织插件功能的 Eureka
                  中安装， 检查并确认 MCP 服务地址。包通过 com.eureka
                  声明认证需求；
                  新会话加载已安装插件，已有会话需在空闲时重载。开发测试包仅用于对应测试环境，
                  localhost 指向 Eureka 服务端所在环境。仅用通用 Pi
                  加载技能不会自动注册 MCP，不能作为组织安装验收。
                </p>
              </div>
              <div className="space-y-1 rounded-lg border border-slate-200 p-3">
                <h4 className="text-xs font-semibold">Claude Code</h4>
                <p className="text-xs leading-6 text-slate-600">
                  Claude Desktop Code 模式要求内置 Claude Code 2.1.303
                  或以上、非 WSL 会话，并允许
                  Mods。按本地插件加载或团队安装流程选择{" "}
                  <code>atlas-ask-claude</code>{" "}
                  解压根目录。命令行本地加载示例见下一步。
                </p>
              </div>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
              3
            </span>
            <div className="min-w-0 flex-1 space-y-3">
              <h3 className="text-xs font-semibold">确认客户端认证</h3>
              <p className="text-xs leading-6 text-slate-600">
                在{" "}
                <Link
                  href="/profile"
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  个人中心
                </Link>{" "}
                复制自己的个人凭证（不是登录密码），用于 Codex 或 Claude Code
                的本机连接配置。
              </p>
              <p className="text-xs leading-6 text-slate-600">
                <strong className="font-semibold">Codex：</strong>
                在插件连接设置中选择 API-key /
                Bearer，填写本人凭证，保存后开启新对话。
              </p>
              <p className="text-xs leading-6 text-slate-600">
                <strong className="font-semibold">Eureka：</strong>
                由宿主使用当前登录用户在来源 Haze 的个人凭证，在可信连接层注入
                Bearer； 宿主必须校验目标 Atlas
                地址与凭证授权关系，不能只信任包内声明。
                插件不读取或保存凭证，也不要将凭证粘贴给 AI。Atlas MCP
                未加载或认证失败时停止调用， 不自行读取密钥或构造凭证。
              </p>
              <div className="space-y-2">
                <p className="text-xs leading-6 text-slate-600">
                  <strong className="font-semibold">Claude Code：</strong>
                  在启动客户端前设置本机环境变量{" "}
                  <code className="break-all">ATLAS_PERSONAL_CREDENTIAL</code>
                  ，再启动或重新连接插件。
                </p>
                <p className="text-[11px] leading-5 text-slate-500">
                  桌面端请在本机用户环境中设置该变量，并完全退出、重开 Claude
                  Desktop。以下 PowerShell
                  示例仅用于命令行本地验证，不能让已运行的桌面应用继承临时变量：
                </p>
                <pre className="whitespace-pre-wrap break-all rounded-lg bg-slate-50 p-3 font-mono text-[11px] leading-6">
                  {claudeExample}
                </pre>
              </div>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
              4
            </span>
            <div className="min-w-0 space-y-1">
              <h3 className="text-xs font-semibold">
                开启新对话，直接向 AI 提问
              </h3>
              <p className="text-xs leading-6 text-slate-600">
                例如“上周各店铺的销售额是多少？”插件会使用右侧列出的工具查找数据、确认口径并查询。
              </p>
              <p className="text-xs leading-6 text-slate-600">
                需要限制数据范围时，Claude Desktop 运行 /atlas_menu
                打开原生面板；Codex 从技能列表选择“Atlas数据目录”（支持时输入
                $atlas-menu），打开独立窗口；选择“Atlas数据助手”或输入
                $atlas-ask 可显式调用问数技能。支持本包的 Eureka 使用已有
                open_selection_menu
                独立窗口流程，按宿主实际能力打开链接，不承诺快捷命令或原生侧栏。
                选数流程不要求 Atlas
                网页登录。顶部“数据集选择页面”是人工管理入口，与插件免登录入口分开。
              </p>
            </div>
          </li>
        </ol>
        <p className="rounded-lg bg-slate-50 p-3 text-xs leading-6 text-slate-600">
          默认使用全部已发布可查询表；清空并确认会恢复全部。范围不再按七天清理；凭证失效或主动断开授权后需从
          Agent
          重新打开。修改不取消已有任务。管理员修改规则后需更新插件，旧安装不会自动同步。
        </p>
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs leading-6 text-amber-800">
          <ShieldCheck className="mt-1 size-3.5 shrink-0" />
          <p>
            不熟悉安装时可请管理员协助，个人凭证只在可信客户端连接层处理，不要发给
            AI、其他人或写进共享文件。实际数据查询可能产生费用。
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
