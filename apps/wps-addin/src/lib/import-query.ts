import type { AuthUser, DataQueryExecution } from '@eureka-atlas/types';
import { ApiError, type Api } from './api.ts';
import { submitSaved, waitForResult, readResultPages } from './queries.ts';
import { beginImport, appendPage, captureTarget, discardImport, finishImport, loadedQueries, rectangle, type Application, type Binding, type StagedImport } from './workbook.ts';

type Hooks = { onTask(item: DataQueryExecution, savedId: string): void; onProgress(text: string): void };
export async function prepareImport(app: Application, request: Api, member: string, savedId: string, signal: AbortSignal, hooks: Hooks, queryId?: string) {
  const target = captureTarget(app, member, savedId);
  if (target.binding) {
    const sheet = target.workbook.Worksheets.Item(target.binding.s);
    const area = sheet.Range(rectangle(target.binding.r, target.binding.c));
    if (sheet.ProtectContents || area.MergeCells !== false || area.HasArray !== false) throw new Error('结果表受保护或包含合并区域／数组公式，未执行查询');
  }
  let name: string | undefined;
  let stage: StagedImport | undefined;
  try {
    if (!queryId) {
      const item = await submitSaved(request, savedId, signal, saved => { name = saved.name; });
      signal.throwIfAborted(); queryId = item.id; hooks.onTask(item, savedId);
    }
    const item = await waitForResult(request, queryId, signal, next => { hooks.onTask(next, savedId); hooks.onProgress(`查询 ${next.status} · 已耗时 ${Math.round((next.elapsed_ms ?? 0) / 1000)} 秒`); });
    signal.throwIfAborted(); stage = beginImport(app, target, item);
    await readResultPages(request, item, signal, (page, offset) => { appendPage(app, stage!, page, offset); hooks.onProgress(`正在暂存 ${offset + page.rows.length}/${item.row_count} 行…`); });
    await verifyAccount(request, member, signal);
    return { stage, name };
  } catch (cause) { if (stage) discardImport(app, stage); throw cause; }
}
export async function verifyAccount(request: Api, member: string, signal: AbortSignal) {
  const current = await request<AuthUser>('/auth/me', { signal }); signal.throwIfAborted();
  if (current.member_no !== member) throw new Error('账号已变化，未更新原表');
}
export async function refreshAll(app: Application, request: Api, member: string, signal: AbortSignal, options: Hooks & {
  overwrite(): boolean; confirm(stage: StagedImport, name?: string): Promise<boolean>;
  onSuccess(binding: Binding, item: DataQueryExecution): void;
}) {
  const book = app.ActiveWorkbook;
  const queries = loadedQueries(app, member);
  if (!queries.length) throw new Error('当前工作簿没有属于此账号的已加载查询');
  const report: { sheet: string; success: boolean; error?: string }[] = [];
  for (const query of queries) {
    signal.throwIfAborted();
    if (app.ActiveWorkbook?.FullName !== book?.FullName || app.ActiveWorkbook?.Name !== book?.Name) throw new Error('当前工作簿已切换，全部更新已停止');
    let stage: StagedImport | undefined;
    let lastTask: DataQueryExecution | undefined;
    options.onProgress(`全部更新 ${report.length + 1}/${queries.length}：${query.sheet}`);
    try {
      const result = await prepareImport(app, request, member, query.savedId, signal, {
        onTask(item, id) { lastTask = item; options.onTask(item, id); },
        onProgress(text) { options.onProgress(`全部更新 ${report.length + 1}/${queries.length} · ${query.sheet}：${text}`); },
      });
      stage = result.stage;
      if (!options.overwrite() && !await options.confirm(stage, result.name)) { report.push({ sheet: query.sheet, success: false, error: '已取消写入' }); continue; }
      await verifyAccount(request, member, signal);
      const binding = finishImport(app, stage, result.name);
      options.onSuccess(binding, stage.item); report.push({ sheet: binding.s, success: true });
    } catch (cause) {
      if (signal.aborted || (cause instanceof ApiError && [401, 503].includes(cause.status)) || (lastTask && !['FAILED', 'CANCELLED', 'TIMED_OUT'].includes(lastTask.status))) throw cause;
      report.push({ sheet: query.sheet, success: false, error: cause instanceof Error ? cause.message : '更新失败' });
    } finally { if (stage && !stage.finished) discardImport(app, stage); }
  }
  return report;
}
