# Milestone 11：MaxCompute 查询执行闭环

## 已实现内容

- 查询调试页面 `/query/debug` 复用可查询表选择器，按正式 Package 选择指标、维度、日期、筛选和结果上限。
- `POST /api/queries` 提交聚合查询；`GET /api/queries/:queryId` 查询状态；`GET /api/queries/:queryId/result` 读取结果；`POST /api/queries/:queryId/cancel` 请求取消。
- `POST /api/queries/dimension-values` 预留真实候选值读取能力。
- 查询只接受资产 ID 和结构化条件。后端按已发布语义生成单表 MaxCompute SQL，不接受客户端 SQL、表名或连接信息。
- 查询任务记录使用的语义版本、生成 SQL、远端实例 ID、状态、结果及实际快照日期；不保存凭据。
- MaxCompute 使用现有数据源 Endpoint、区域、项目和加密凭据，采用 REST 实例提交、状态检查、结果读取和取消。

## 支持范围

- 数据源：MaxCompute。
- 查询：单表汇总、分组、排行、日期范围和 AND 筛选。
- 原子指标：SUM、COUNT、COUNT_DISTINCT、AVG、MIN、MAX。
- 派生指标：使用已发布公式，并以 Hive AST 校验表达式、函数和字段引用。
- 日期增量表必须填写日期范围；全量快照表自动固定到默认统计日期字段的最新分区。

## 阶段边界

- 不支持逐行明细、跨表 JOIN、跨数据源查询、用户自由 SQL 或问数 Agent。
- M12 负责把本服务绑定到可信问数会话中的已选表集合。
- 执行服务拒绝无法明确解释的自定义默认日期格式；需要在治理中改为受支持格式或原生日期字段后再执行。

## 验收记录

- 已完成 Prisma schema 同步、API 构建、38 项 API 单元测试和前端生产构建。
- 已在 `dwd_fl_item_flow_source_di` 上提交只读“访客数”汇总：正式 Package、结构化请求、签名、MaxCompute 实例创建和状态轮询均已验证。
- 该数据源当前凭据缺少读取任务结果/相关元数据的权限，结果读取返回明确失败，因此真实结果、分组、派生指标、候选值和快照表的最终验收待补足 MaxCompute 权限后完成。
