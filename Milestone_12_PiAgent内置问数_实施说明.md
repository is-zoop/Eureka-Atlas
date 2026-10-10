# Milestone 12：Pi Agent 内置问数实施说明

## 已交付

- 新增“智能问数”页面 `/query/ask`，用户可在每一轮自由选择数据域或具体表、选择模型并用自然语言提问。
- 使用 `@earendil-works/pi-agent-core@0.84.1` 的 `Agent` 和 `pi-ai` 既有模型运行时；问数模型独立选择，不会修改治理建议的当前模型。
- 新增可信的本轮表集合校验。搜索、读取 Package、候选值与查询都只能访问提交时已勾选的有效表；空选择、失效表和范围外表会被拒绝。
- 注册 `search_semantic_assets`、`get_semantic_package`、`get_dimension_values`、`query_data` 与 `request_clarification` 五个 Pi 工具，并以顺序方式执行。
- 增加问数运行、事件、消息和查询关联记录，支持幂等提交、SSE 进度续接、停止和澄清后继续。服务重启不会重放模型调用；未完成运行标为中断。
- 页面展示回答流、澄清卡片、查询结果、中文 SQL、语义版本和实际快照日期。SQL 与表格取自 M11 执行服务。
- M11 同步修正：结果严格按请求行数返回；全量快照通过 MaxCompute 分区列表选择可解析的最新默认统计日期分区，不再生成 `MAX(...)` 子查询。

## 接口

| 接口 | 用途 |
| --- | --- |
| `POST /api/ask/runs` | 提交问题、表 ID、模型和幂等标识 |
| `GET /api/ask/runs/:runId` | 查询运行状态、澄清、回答和关联查询 |
| `GET /api/ask/runs/:runId/events?after=n` | SSE 进度和回答文本，支持事件序号续接 |
| `POST /api/ask/runs/:runId/clarifications` | 提交澄清答案并继续原运行 |
| `POST /api/ask/runs/:runId/cancel` | 停止 Pi loop 并取消关联查询 |
| `GET /api/ask/runs/:runId/queries/:queryId/result` | 读取属于该运行的查询结果 |

## 阶段边界

M12 只处理一次问题及其澄清后的继续。历史运行列表、命名、刷新恢复、自由追问、下载和可持续会话留给 M13；MCP 与外部 Agent 接入留给 M14。

## 验证

- `pnpm db:push`：数据库 schema 已同步。
- `pnpm --filter @eureka-atlas/api build`：通过。
- `pnpm --filter @eureka-atlas/web build`：通过。
- `pnpm --filter @eureka-atlas/api test:unit`：41 项通过。
- 已验证正在运行的 API 可读取模型和可查询表。该进程启动在本次新增路由前，需重启后再做浏览器和真实模型/MaxCompute 问数验收。
