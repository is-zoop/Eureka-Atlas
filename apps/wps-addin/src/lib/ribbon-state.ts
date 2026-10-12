import type { WpsApplication } from './host.ts';

const OVERWRITE = 'atlas:overwrite';
const UPDATE = 'atlas:update-all';
function storage(app: WpsApplication) {
  if (!app.PluginStorage) throw new Error('当前 WPS 不支持加载项菜单通信，请确认客户端支持 PluginStorage');
  return app.PluginStorage;
}
export function overwriteEnabled(app: WpsApplication) { return storage(app).getItem(OVERWRITE) === 'true'; }
export function setOverwrite(app: WpsApplication, pressed: boolean) {
  const ps = storage(app);
  ps.setItem(OVERWRITE, pressed ? 'true' : 'false');
  if (overwriteEnabled(app) !== pressed) throw new Error('刷新覆盖设置未能同步，请重新打开助手后重试');
}
export function toggleOverwrite(app: WpsApplication) { setOverwrite(app, !overwriteEnabled(app)); }
export function requestUpdateAll(app: WpsApplication) {
  const book = app.ActiveWorkbook;
  if (!book) throw new Error('请先打开要更新的工作簿');
  storage(app).setItem(UPDATE, JSON.stringify({ path: book.FullName, name: book.Name, time: Date.now() }));
}
export function consumeUpdateAll(app: WpsApplication): boolean {
  const raw = app.PluginStorage?.getItem(UPDATE);
  if (typeof raw !== 'string') return false;
  const ps = storage(app);
  let command: { path: string; name: string; time: number };
  try { command = JSON.parse(raw); } catch { ps.removeItem(UPDATE); return false; }
  if (!Number.isFinite(command.time) || Date.now() - command.time > 5 * 60 * 1000) { ps.removeItem(UPDATE); return false; }
  if (app.ActiveWorkbook?.FullName !== command.path || app.ActiveWorkbook.Name !== command.name) return false;
  ps.removeItem(UPDATE); return true;
}
