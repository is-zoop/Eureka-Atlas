import test from 'node:test';
import assert from 'node:assert/strict';
import type { DataQueryExecution, DataQueryResultPage } from '@eureka-atlas/types';
import { ApiError, type Api } from '../src/lib/api.ts';
import { requestUpdateAll, consumeUpdateAll, setOverwrite, overwriteEnabled } from '../src/lib/ribbon-state.ts';
import { beginImport, appendPage, captureTarget, finishImport, loadedQueries, type Application, type Worksheet, type Workbook, type Range } from '../src/lib/workbook.ts';
import { refreshAll } from '../src/lib/import-query.ts';

function fixture() {
  const sheets: Worksheet[] = []; const properties: { Name: string; Value: unknown }[] = [];
  const values = new Map<Worksheet, unknown>();
  const workbook: Workbook = { Name: '测试.xlsx', FullName: 'E:/测试.xlsx', ReadOnly: false, ProtectStructure: false,
    Worksheets: { get Count() { return sheets.length; }, Item(index) { const sheet = typeof index === 'number' ? sheets[index - 1] : sheets.find(s => s.Name === index); if (!sheet) throw new Error('工作表已删除'); return sheet; }, Add() {
      const sheet: Worksheet = { Name: '新表', ProtectContents: false, Activate() {}, Delete() { sheets.splice(sheets.indexOf(sheet), 1); }, Range() {
        const range: Range = { get Value2() { return values.get(sheet); }, set Value2(value) { values.set(sheet, value); }, NumberFormat: '@', MergeCells: false, HasArray: false, Copy(to) { to.Value2 = range.Value2; }, ClearContents() {} }; return range;
      } }; sheets.push(sheet); return sheet;
    } },
    CustomDocumentProperties: { get Count() { return properties.length; }, Item(index) { return typeof index === 'number' ? properties[index - 1] : properties.find(p => p.Name === index)!; }, Add(Name, _link, _type, Value) { const prop = { Name, Value }; properties.push(prop); return prop; } },
  };
  const storage = new Map<string, string | boolean>();
  const app: Application = { ActiveWorkbook: workbook, DisplayAlerts: true, CreateTaskPane: () => ({ Visible: false, Width: 360, DockPosition: 2 }), PluginStorage: { getItem: key => storage.get(key), setItem: (key, value) => { storage.set(key, value); }, removeItem: key => { storage.delete(key); } } };
  const item = (id: string): DataQueryExecution => ({ id, status: 'SUCCEEDED', row_count: 1, columns: [{ id: 'field', name: '金额', type: 'decimal', unit: null }], expires_at: new Date(Date.now() + 100000).toISOString() } as DataQueryExecution);
  function bind(member: string, id: string) { const execution = item(id); const stage = beginImport(app, captureTarget(app, member, id), execution); appendPage(app, stage, { columns: execution.columns, rows: [['旧数据']] } as DataQueryResultPage, 0); return finishImport(app, stage, id); }
  const calls: string[] = []; let member = 'A';
  const request: Api = async <T>(path: string, options?: RequestInit) => {
    calls.push(path);
    if (path === '/auth/me') return { member_no: member } as T;
    if (path.startsWith('/saved-data-queries/')) { const id = path.split('/').at(-1)!; return { name: `新名称-${id}`, validation_errors: [], config: { table_id: id, field_ids: ['field'], mode: 'DETAIL' } } as T; }
    if (path === '/data-queries') return item(JSON.parse(String(options?.body)).table_id) as T;
    const id = path.split('/')[2];
    if (path.includes('/result?')) return { page: 1, page_size: 500, total: 1, columns: item(id).columns, rows: [['新数据']] } as T;
    return item(id) as T;
  };
  return { app, workbook, bind, item, values, request, calls, changeMember: (value: string) => { member = value; } };
}

test('menu communication is workbook-scoped, consumed once, and overwrite defaults off', () => {
  const f = fixture(); assert.equal(overwriteEnabled(f.app), false); setOverwrite(f.app, true); assert.equal(overwriteEnabled(f.app), true);
  requestUpdateAll(f.app); f.app.ActiveWorkbook = { Name: '其他.xlsx', FullName: 'E:/其他.xlsx', ReadOnly: false }; assert.equal(consumeUpdateAll(f.app), false);
  f.app.ActiveWorkbook = f.workbook; assert.equal(consumeUpdateAll(f.app), true); assert.equal(consumeUpdateAll(f.app), false);
  setOverwrite(f.app, false); assert.equal(overwriteEnabled(f.app), false);
});
test('native checkbox callbacks share explicit string state with pane and suppress actual batch confirmations', async () => {
  const f = fixture(); f.bind('A', 'one');
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const alerts: string[] = [];
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { Application: f.app, alert: (text: string) => alerts.push(text), location: { href: 'http://127.0.0.1:3891/' } } });
  try {
    await import('../src/ribbon.ts');
    assert.equal(window.AtlasGetOverwrite(), false);
    // Native WPS passes pressed before control, unlike the Office signature.
    assert.equal(Reflect.apply(window.AtlasSetOverwrite, window, [true, { Id: 'AtlasOverwrite' }]), true);
    assert.equal(f.app.PluginStorage!.getItem('atlas:overwrite'), 'true');
    assert.equal(window.AtlasGetOverwrite(), true);
    const paneApp = { ...f.app }; let prompts = 0;
    const report = await refreshAll(paneApp, f.request, 'A', new AbortController().signal, { overwrite: () => overwriteEnabled(paneApp), confirm: async () => { prompts++; return true; }, onTask() {}, onProgress() {}, onSuccess() {} });
    assert.equal(prompts, 0); assert.equal(report[0].success, true);
    Reflect.apply(window.AtlasSetOverwrite, window, [false, { Id: 'AtlasOverwrite' }]);
    assert.equal(f.app.PluginStorage!.getItem('atlas:overwrite'), 'false'); assert.equal(window.AtlasGetOverwrite(), false);
    await refreshAll(paneApp, f.request, 'A', new AbortController().signal, { overwrite: () => overwriteEnabled(paneApp), confirm: async () => { prompts++; return true; }, onTask() {}, onProgress() {}, onSuccess() {} });
    assert.equal(prompts, 1); assert.deepEqual(alerts, []);
  } finally { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window'); }
});
test('an unavailable preference store is reported instead of silently treating overwrite as unchecked', () => {
  const f = fixture(); f.app.PluginStorage = undefined;
  assert.throws(() => overwriteEnabled(f.app), /菜单通信/);
});
test('loaded queries belong to the current account, not all saved queries', () => {
  const f = fixture(); f.bind('A', 'one'); f.bind('B', 'other'); assert.deepEqual(loadedQueries(f.app, 'A'), [{ savedId: 'one', sheet: 'one' }]);
});
test('all update serially reads latest configs, refreshes only own bindings and skips prompts when opted in', async () => {
  const f = fixture(); f.bind('A', 'one'); f.bind('A', 'two'); f.bind('B', 'other'); let prompts = 0;
  const report = await refreshAll(f.app, f.request, 'A', new AbortController().signal, { overwrite: () => true, confirm: async () => { prompts++; return true; }, onTask() {}, onProgress() {}, onSuccess() {} });
  assert.equal(prompts, 0); assert.equal(report.filter(r => r.success).length, 2); assert.ok(!f.calls.some(c => c.includes('other')));
  assert.ok(f.calls.indexOf('/saved-data-queries/two') > f.calls.indexOf('/data-queries/one/result?page=1&pageSize=500'));
  assert.equal(f.workbook.Worksheets.Item('other').Name, 'other'); assert.equal(f.workbook.Worksheets.Count, 3);
  assert.deepEqual(loadedQueries(f.app, 'A').map(q => q.sheet), ['新名称-one', '新名称-two']);
});
test('declining one confirmation leaves original data intact and continues the next query', async () => {
  const f = fixture(); f.bind('A', 'one'); f.bind('A', 'two'); let prompts = 0;
  const report = await refreshAll(f.app, f.request, 'A', new AbortController().signal, { overwrite: () => false, confirm: async () => ++prompts !== 1, onTask() {}, onProgress() {}, onSuccess() {} });
  assert.equal(prompts, 2); assert.equal(report[0].success, false); assert.equal(report[1].success, true);
  assert.deepEqual(f.values.get(f.workbook.Worksheets.Item('one')), [['旧数据']]); assert.equal(f.workbook.Worksheets.Count, 2);
});
test('protected or deleted sheets do not submit cloud tasks, other eligible queries still refresh', async () => {
  const f = fixture(); f.bind('A', 'one'); f.bind('A', 'two'); f.workbook.Worksheets.Item('one').ProtectContents = true;
  const report = await refreshAll(f.app, f.request, 'A', new AbortController().signal, { overwrite: () => true, confirm: async () => true, onTask() {}, onProgress() {}, onSuccess() {} });
  assert.equal(report[0].success, false); assert.equal(report[1].success, true); assert.ok(!f.calls.includes('/saved-data-queries/one'));
});
test('a completed failed cloud task does not block later queries or overwrite its result sheet', async () => {
  const f = fixture(); f.bind('A', 'one'); f.bind('A', 'two');
  const request: Api = async <T>(path: string, options?: RequestInit) => path === '/data-queries/one' ? { ...f.item('one'), status: 'FAILED', error: '模拟云端查询失败' } as T : f.request<T>(path, options);
  const report = await refreshAll(f.app, request, 'A', new AbortController().signal, { overwrite: () => true, confirm: async () => true, onTask() {}, onProgress() {}, onSuccess() {} });
  assert.equal(report[0].success, false); assert.equal(report[1].success, true);
  assert.deepEqual(f.values.get(f.workbook.Worksheets.Item('one')), [['旧数据']]);
});
test('switching workbooks while waiting for confirmation stops subsequent work and preserves both books', async () => {
  const f = fixture(); f.bind('A', 'one'); f.bind('A', 'two');
  await assert.rejects(refreshAll(f.app, f.request, 'A', new AbortController().signal, { overwrite: () => false, confirm: async () => { f.app.ActiveWorkbook = { Name: '其他.xlsx', FullName: 'E:/其他.xlsx', ReadOnly: false }; return true; }, onTask() {}, onProgress() {}, onSuccess() {} }), /工作簿已切换/);
  assert.deepEqual(f.values.get(f.workbook.Worksheets.Item('one')), [['旧数据']]); assert.equal(f.workbook.Worksheets.Count, 2); assert.ok(!f.calls.includes('/saved-data-queries/two'));
});
test('account changes, incomplete results and outages never overwrite old results or start later queries', async () => {
  for (const kind of ['account', 'incomplete', '503', 'abort'] as const) {
    const f = fixture(); f.bind('A', 'one'); f.bind('A', 'two'); const abort = new AbortController();
    const request: Api = async <T>(path: string, options?: RequestInit) => {
      if (path.includes('/result?')) {
        if (kind === '503') throw new ApiError(503, '不可用');
        if (kind === 'abort') abort.abort();
        if (kind === 'incomplete') return { page: 1, page_size: 500, total: 1, columns: f.item('one').columns, rows: [] } as T;
        if (kind === 'account') f.changeMember('B');
      }
      return f.request<T>(path, options);
    };
    await assert.rejects(refreshAll(f.app, request, 'A', abort.signal, { overwrite: () => true, confirm: async () => true, onTask() {}, onProgress() {}, onSuccess() {} }));
    assert.deepEqual(f.values.get(f.workbook.Worksheets.Item('one')), [['旧数据']]); assert.equal(f.workbook.Worksheets.Count, 2); assert.ok(!f.calls.includes('/saved-data-queries/two'));
  }
});
