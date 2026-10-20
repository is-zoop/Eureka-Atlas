# Atlas 开放数据 API v1

## 范围与身份

本期只开放语义资产搜索、正式语义 Package、候选值、指标查询和任务状态／结果／取消。不是自然语言问数或 MCP 服务，不接受任意 SQL，不开放用户／数据源管理。

- 入口：部署的 HTTPS 域名下 `/api/external/v1`。
- 每次调用均携带 `Authorization: Bearer <HAZE_PERSONAL_CREDENTIAL>`，不携带 Cookie。
- 个人凭证从个人中心复制；Atlas 每次实时调用 Haze `/api/auth/personal-credential/me`，以返回的 `member_no` 和当前角色为准。
- 仅 ADMIN／SYSTEM_ADMIN 可调用；普通使用者、开发者及未知角色返回 403。网页 API 中心和文档也仅管理员及以上可访问。
- 使用全部已发布可查询表；任务属于 Haze 用户编号，不属于某个凭证字符串。重置后新凭证仍可读取本人的历史任务，其他用户即使知道 ID 也返回 404。
- 个人凭证与网页登录 Token 独立。退出登录或修改密码不会自动撤销个人凭证；重置凭证或停用账号后，后续调用立即失效。不提供登录续期。
- 默认支持服务端调用和 Atlas 同源调试，不向任意第三方网页开放跨域。外部接口不能用 Cookie 回退认证；个人凭证也不能访问原有网页管理接口。

## 接口目录

权威 Schema、说明、输入输出示例及错误码来自运行中的 API 中心，路径由实际控制器生成：

- 网页：集成中心的开放 API 子页 `/integrations/api`；Agent 插件页为 `/integrations/plugins`。
- 文档目录（网页登录认证）：`/api/api-center`。
- OpenAPI 3.1（网页登录认证）：`/api/api-center/openapi`。

| 方法 | 相对 `/api/external/v1` 的路径 | 用途 |
| --- | --- | --- |
| POST | `/semantic/search` | 按业务名称、别名、说明搜索，支持分页 |
| GET | `/semantic/packages/:tableId` | 获取字段 ID、指标 ID、正式口径、日期规则及版本 |
| POST | `/queries/dimension-values` | 提交候选值查询，返回 202 异步任务 |
| POST | `/queries` | 提交聚合、分组、趋势／排行查询，返回 202 异步任务 |
| GET | `/queries/:queryId` | 读取本人任务状态，不含结果行 |
| GET | `/queries/:queryId/result` | 读取本人成功任务的实际保存结果 |
| POST | `/queries/:queryId/cancel` | 请求取消本人任务，随后确认最终状态 |

## 推荐调用流程

1. 搜索业务资产。`keywords` 为必填数组，可为空，但 keywords／metrics／dimensions 至少提供一个非空业务词；所有名称均可使用别名。
2. 用返回的 table_id 读取 Package，确认完整性、字段／指标 ID、候选值开关、分组开关和日期规则。
3. 必要时查询维度真实取值；不要把候选值失败视为“没有数据”。
4. 查询提交必须提供 `content_version`、`idempotency_key`、表 ID 和对应字段／指标 ID。使用 Package 的真实版本，不能提交物理字段名或 SQL。
5. 202 仅表示提交返回了任务，需检查状态；任务也可能立即处于 FAILED。建议每 3 秒读取一次状态，直到 SUCCEEDED／FAILED／CANCELLED／TIMED_OUT。
6. SUCCEEDED 后读取结果。返回的是已保存行，不是模型的 100 行摘要。检查 `result.truncated`，保留字符串形式的大整数／小数精度和 JSON null。
7. 停止客户端等待不会取消后台任务。如需停止查询，显式调用 cancel，并确认最终状态。

同一用户、同一幂等标识、同一请求重试返回原任务，即使 Package 之后变化也不重新执行。不同参数／版本重复使用该标识返回 409；新业务查询应生成新标识。查询默认 100 行、候选值默认 50 条，显式默认值与省略值使用同一规范化请求。

DATE_INCREMENTAL 的两种查询均必须提供日期范围；支持真实的 YYYY-MM-DD 或 YYYYMMDD 日历日期，包含结束日期。FULL_SNAPSHOT 不提供 date_range，由服务选择最新快照；其他历史业务日期使用对应字段筛选。当前仅 MaxCompute 支持执行。

## 响应和失败

成功响应包含 `data` 和 `request_id`；任务／结果读取以 `data.id` 为查询标识。错误响应包含 `error.code`、中文 `error.message` 和 `request_id`。响应头提供 `X-Request-Id`，均禁止缓存。

- 400 INVALID_REQUEST：参数、类型、枚举、额外字段、日期或语义配置不符合要求。
- 401 INVALID_CREDENTIAL：缺少／错误／已重置凭证，或账号已停用。
- 403 FORBIDDEN：角色不允许。
- 404 NOT_FOUND：资源不可查询、不存在或不属于当前用户，不暴露其他用户任务是否存在。
- 409 SEMANTIC_VERSION_CHANGED：重新读取 Package，确认新口径并使用新幂等标识。
- 409 CONFLICT：同幂等标识用于不同请求。
- 409 QUERY_NOT_SUCCEEDED：先读状态，不能把尚未完成视为空结果。
- 410 RESULT_EXPIRED：超出结果保留期，重新查询。
- 413 PAYLOAD_TOO_LARGE：请求体过大。
- 429 RATE_LIMITED／QUERY_LIMIT_REACHED：参考 Retry-After，等待或取消未结束任务。
- 502／503／504：数据源或 Haze 上游异常；不要因此删除个人凭证或重置网页登录。
- 500 INTERNAL_ERROR：凭 request_id 联系管理员，不返回内部堆栈或原始鉴权异常。

## 限制与部署

每个用户每分钟 60 次请求，最多 3 个未结束语义查询（PENDING／RUNNING／CANCELLING，包括本人网页问数任务）。请求 JSON 上限 64 KiB，指标结果最多 5000 行，候选值最多 200 条，结果大小上限 5 MiB，执行超时 10 分钟，结果保留 24 小时。上游单次 HTTP 请求限定 10 秒；调试面板单次 HTTP 最多等待 20 秒。

限流返回 RateLimit-Limit／RateLimit-Remaining／RateLimit-Reset，429 同时返回 Retry-After。准入检查按用户串行，防止并发请求同时越过计数。当前与项目后台任务调度一样只部署一个 API 实例；未引入跨副本限流或调度系统，不要横向扩容。

不修改 Haze，不新增数据库表或迁移。部署时上传新增源码、重新构建 API／Web，再等待或停止活动任务后替换容器。只刷新浏览器或重启旧镜像不能加载新增接口。使用同一 HTTPS 入口反向代理 `/api`，不要记录 Authorization 请求头，不缓存数据接口。

## 调试安全

集成中心的开放 API 调试需要显式输入个人凭证，不自动获取。调试请求直接走实际外部地址，省略 Cookie；401／403 仅显示调用失败，不注销当前网页。凭证仅在当前页面内存及密码输入框中存在，离开页面清空，不持久化请求历史；复制调用示例仅包含占位凭证。调试响应中与输入凭证相同的字符串会被遮蔽。

调试面板会执行真实查询，可能产生 MaxCompute 费用。不要使用生产账号做未确认的改密／凭证重置验收；不在工单、截图、聊天或日志中发送真实凭证。结果预览可能为保护页面性能而截断，页面会明确提示，这与服务器 result.truncated 是不同限制。

## 部署环境验收

使用管理员授权的测试账号与测试表，分别验证真实 Haze 鉴权、别名检索、Package、日期查询、结果、取消；使用另外一个测试账号确认不能访问前者任务。通过个人中心重置测试凭证，确认旧凭证 401、新凭证仍可访问本人任务；角色降级确认 403，停用账号确认 401。请使用专用测试账号，避免影响真实客户端。

本地自动化回归使用模拟 Haze 和 MaxCompute，只验证业务协议及隔离，不等同于真实服务器验收。真实验收需要部署地址、授权测试凭证和允许查询的测试表；未提供这些信息时，不得将线上联调标为完成。
