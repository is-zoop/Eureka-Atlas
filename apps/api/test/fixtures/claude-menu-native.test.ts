// Run with the official `claude plugin test` inside an extracted generated plugin.
import { expect, mock, test } from 'claude-code/testing'
const PANE = { plugin: 'atlas-ask', component: 'Pane', requestId: 'atlas-menu', surface: 'desktop', viewport: { columns: 130, rows: 40 }, props: { title: 'Atlas 数据集选择', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } } as const
const selection = { member_no: 'A', session: { session_id: 'native-session', scope_mode: 'ALL', scope_revision: 0, selected_table_ids: [], invalid_table_ids: [], scope_valid: true, available_tables: [{ id: 'table', business_name: '测试表', physical_name: 'sales', data_domain: '销售' }] } }

test('desktop command opens a valid native pane, and a table press redraws the real native tree', async ($, on) => {
  mock.env(on, { ATLAS_PERSONAL_CREDENTIAL: 'haze_offline_fixture_not_real' })
  on('session.id', () => ({ value: 'desktop-thread' }))
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify(selection) } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run({ command: 'atlas_menu', args: '' })
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ key: 'table-table' })).toBeDefined()
  await ui.press({ key: 'table-table' })
  expect(await ui.find({ type: 'Text', text: '待保存：仅 1 张表。' })).toBeDefined()
  expect(await ui.find({ key: 'save' })).toBeDefined()
  await ui.unmount()
})

test('native tool calls cannot replace the desktop conversation scope', async ($, on) => {
  mock.env(on, { ATLAS_PERSONAL_CREDENTIAL: 'haze_offline_fixture_not_real' })
  on('session.id', () => ({ value: 'desktop-thread' }))
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify(selection) } }))
  const created = await $.tool.call({ tool: 'mcp__plugin_atlas-ask_atlas__create_query_session' })
  expect(JSON.parse(created.result as string).data.session_id).toBe('native-session')
  const denied = await $.tool.call({ tool: 'mcp__plugin_atlas-ask_atlas__query_data', session_id: 'another-conversation' })
  expect(denied.deny).toBeDefined()
})
