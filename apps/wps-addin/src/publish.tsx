import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CircleAlert, Download, Loader2, PanelRight, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { addonConfig, manageAddon } from "./lib/installer.ts";
import "./styles.css";

function InstallPage() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const config = addonConfig(window.location.href);

  async function manage(action: "install" | "uninstall") {
    if (action === "uninstall" && !window.confirm("只卸载 Atlas WPS 验证加载项，其他加载项不受影响。继续吗？")) return;
    setBusy(true);
    setFailed(false);
    setMessage("");
    try {
      // Only a user click loads the native SDK; opening this page is inert.
      const { default: sdk } = await import("wpsjs-rpc-sdk-new");
      await manageAddon(sdk.WpsAddonMgr, config, action);
      setMessage(action === "install" ? "安装配置已写入。请保存打开的文件，完全退出并重启 WPS 表格，在 Atlas 菜单点击“打开助手”。" : "已卸载 Atlas 验证加载项。完全退出并重启 WPS 后生效。");
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : "安装失败，请检查 WPS 启动授权与 JS 加载项支持。");
    } finally { setBusy(false); }
  }

  return <main className="mx-auto max-w-xl space-y-5 px-5 py-10">
    <header className="space-y-2"><h1 className="text-2xl font-semibold">Atlas WPS 数据助手</h1><p className="text-sm text-muted-foreground">Windows WPS 表格 · 登录 Atlas · 我的查询 · 手动刷新</p></header>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><PanelRight className="size-4" />菜单 → 右侧面板 → 查询数据</CardTitle></CardHeader><CardContent className="space-y-4">
      <p className="text-sm leading-6">首次点击安装时，请允许浏览器打开 WPS Office／访问本地网络。此页面只管理 <span className="font-medium">AtlasWpsProbe</span>，不修改 WPS 安装目录或其他加载项。</p>
      <p className="break-all rounded-lg bg-secondary p-3 text-xs">加载地址：{config.url}</p>
      <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => void manage("install")}>{busy ? <Loader2 className="animate-spin" /> : <Download />}安装／更新 Atlas</Button><Button variant="outline" disabled={busy} onClick={() => void manage("uninstall")}><Trash2 />卸载 Atlas</Button></div>
      {message ? <p role={failed ? "alert" : "status"} className={failed ? "text-sm leading-6 text-destructive" : "text-sm leading-6 text-emerald-700"}>{message}</p> : null}
    </CardContent></Card>
    <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900"><CircleAlert className="mt-1 size-4 shrink-0" /><p>本地使用时保持 Atlas API 和加载项服务运行。已登记本地开发加载项的用户不需重复安装，重启 WPS 后打开助手即可。真实数据写入前请先用测试工作簿验收，写入后手动保存文件。</p></div>
    <p className="text-xs leading-5 text-muted-foreground">如果安装成功但菜单未出现，先确认 WPS 已完全退出并重开，以及安装包支持 JS 加载项。不要修改 oem.ini、关闭安全软件或卸载其他加载项。</p>
  </main>;
}

createRoot(document.getElementById("root")!).render(<InstallPage />);
