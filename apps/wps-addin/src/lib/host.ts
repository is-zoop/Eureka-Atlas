// Narrow desktop ET API surface, not WebOffice.
export interface WpsWorkbook { Name: string; FullName: string; ReadOnly: boolean }
export interface WpsTaskPane { Visible: boolean; DockPosition: number; Width: number }
export interface WpsApplication {
  ActiveWorkbook: WpsWorkbook | null;
  CreateTaskPane(url: string): WpsTaskPane;
  PluginStorage?: { getItem(key: string): unknown; setItem(key: string, value: string | boolean): void; removeItem(key: string): void };
}
export function getApplication(): WpsApplication {
  const app = window.Application;
  if (!app || typeof app.CreateTaskPane !== "function") {
    throw new Error("未连接 WPS。请从 WPS 表格的 Atlas 菜单打开助手，浏览器预览不能操作工作簿。");
  }
  return app;
}
