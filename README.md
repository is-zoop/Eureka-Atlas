# Eureka Atlas

Enterprise data semantic governance platform. This repository currently contains Milestone 1: the runnable monorepo foundation only.

## Prerequisites

Linux 容器部署请使用根目录 `docker-compose.yaml`；首次启动、HTTPS 反代、密钥与数据库迁移说明见 [deploy/README.md](deploy/README.md)。WPS 安装包仍在 Windows 客户端使用。

- Node.js 24+
- pnpm 11+
- PostgreSQL running at `127.0.0.1:5432`

## Setup

1. Copy `.env.example` to `.env` and replace `<PASSWORD>` with the password for the local `postgres` account.
2. Install dependencies: `pnpm install`
3. Validate the Prisma configuration: `pnpm db:validate`
4. Initialize a new database with the checked-in migrations: `pnpm --filter @eureka-atlas/database run deploy`. Do not use `db:push` to initialize deployment databases; it does not record migration history. Inspect and reconcile existing databases before deploying.

## Run

- Compile the API once before the first start: `pnpm build:api`
- Start web and API together: `pnpm dev`. The web keeps Next.js hot reload; the API runs compiled JavaScript without file watching or automatic compilation/restarts.
- After changing API code, finish or stop active tasks, stop the API process, run `pnpm build:api`, and start it again. If using the combined `pnpm dev`, stop that command with Ctrl+C, compile the API, then run `pnpm dev` again.
- To restart the API independently without stopping the web, use two terminals: `pnpm dev:web` and `pnpm dev:api`. In the API terminal, use Ctrl+C, run `pnpm build:api`, then `pnpm dev:api`.
- An existing `nest start --watch` process must be stopped once before using these commands; changing the scripts does not disable watching in an already-running process.
- API compilation does not regenerate Prisma Client or update the database. Schema changes still require the appropriate database commands separately.
- Web: `http://localhost:3000`
- API health check: `http://localhost:3001/api/health`

## Haze login

- Sign in with an active Haze phone number and password. Test `admin/admin` login has been removed.
- Set `HAZE_API_ORIGIN` explicitly in `.env` to the Haze API origin (for example `https://skill.paiwo188.com`, without `/api`). There is no default; missing or empty configuration returns 503 without calling Haze. No Haze database or JWT signing key is needed.
- Sessions are persisted in PostgreSQL with encrypted Haze tokens using the existing `DATA_SOURCE_ENCRYPTION_KEY`. Browsers receive only an HttpOnly session cookie. Session expiry follows Haze and requires another login; there is no automatic extension.
- Data assets, semantic definitions and model configurations remain shared; ask conversations and all query execution records are private to the Haze member number. Roles come from Haze; no local role or user-management screens are added. Logging out revokes only the current Eureka session, not Haze sessions, and does not stop background ask tasks.
- Business APIs, SSE, and Excel downloads require a valid session. Health and API documentation remain public. Haze downtime returns 503 without revoking the session; account disablement, token expiry, password changes and Haze logout invalidate it.
- Add the exact Eureka web origin to `WEB_ORIGIN` for LAN or deployed access. Production requires HTTPS because session cookies are Secure. Browser requests continue through same-origin `/api`.
- Apply the checked-in migration with `pnpm --filter @eureka-atlas/database run deploy`, regenerate with `pnpm db:generate`, build database/API with `pnpm --filter @eureka-atlas/database build` and `pnpm build:api`, then restart the API. Never reset existing databases to add authentication.
- If old migrations are pending while their SQL changes already exist, do not blindly deploy them. Inspect the database and apply only the new authentication migration, then record `20261009043000_haze_auth_session` with Prisma `migrate resolve --applied`. The local database used for this integration has this migration applied; pre-existing migration-history discrepancies were left untouched.
- Focused tests: build the API, then run `pnpm --filter @eureka-atlas/api exec node --test test/auth.test.js` and `pnpm --filter @eureka-atlas/web exec node --test test/auth.test.cjs`. Real Haze account login, expiry, logout, and page appearance are checked manually; no browser automation is required.

## 个人中心

- 用户菜单的“个人中心”进入 `/profile`，四种已授权角色均可使用。复制并适配 Haze 的个人中心界面，资料由 Haze 统一维护，不新增 Atlas 用户资料／凭证表，也不修改 Haze。
- 个人设置显示姓名、工号、手机号、邮箱、部门和角色；只允许修改头像及本人密码。头像支持 JPG／PNG／WebP、最大 5 MB、128–4096 像素，前端居中裁剪为 256×256 JPEG 并限制编码长度为 65000 字符。保存后更新当前页面、侧栏及其他标签页的头像，不清空查询工作区。
- Atlas 后端通过当前会话的加密 Haze Token 调用 `/api/auth/me/profile`、`/api/auth/me/reset-password` 和 `/api/auth/me/mcp-credential` 系列接口；不向浏览器返回登录 Token。当前密码错误映射为 400，不注销有效会话；改密成功后清除当前 Atlas 会话，Haze 原有登录令牌也会失效，需要重新登录。
- 打开“个人凭证”页签才读取本人凭证，默认接口只返回掩码及时间信息。复制时通过受保护的 POST `/api/auth/me/mcp-credential/reveal` 按需读取明文；重置需确认，并使旧 Haze 个人凭证立即失效。临时明文只在当前页签保存，离开页签或刷新即清除，不写入浏览器持久存储或日志；相关响应均为 `no-store`。
- 此凭证由 Haze 统一签发，可用于 Haze 个人服务、所有有效角色获授权的 Atlas MCP，以及管理员／系统管理员获授权的 Atlas REST 开放 API，不改变现有网页登录有效期，也不提供登录续期。退出登录或修改密码不等于撤销个人凭证；需重置凭证或停用账号。
- 本功能无需数据库迁移。部署需重新构建并重启 API／Web；新增路由不会随 Next 前端热更新而自动加载进已运行的 API。

## 集成中心与外部数据接口

- 菜单“管理 → 集成中心”（`/integrations/api`），通过 Tab 切换开放 API 与 Agent 插件（`/integrations/plugins`）。
- Atlas数据助手插件按端下载（Codex/Claude 2.3.1，Eureka 2.4.2）：Codex 的“Atlas数据目录”（`$atlas-menu`）打开免网页登录的独立窗口，“Atlas数据助手”（`$atlas-ask`）显式调用问数技能；插件及技能入口统一配置 Atlas 指南针图标；Claude Desktop Code 模式通过 Mods 原生 `/atlas_menu` 面板选数，最低测试版本为内置 Claude Code 2.1.303，非 WSL 会话。复用已配置个人凭证，范围按对话持久保存，不再七天清理；Codex 启动链接为五分钟一次性引导码，已打开窗口继续实时校验个人凭证，不按引导码过期退出。原 `/integrations/plugins/data-selector` 仅保留为人工管理入口，非插件认证兜底。安装、迁移、凭证加密存储与真实验收边界见 [Agent 插件部署与使用](deploy/agent-plugin.md)。
- Eureka 独立声明 `extensions.com.eureka.capabilities.requestUserInput=true`，仅为该端 `atlas-ask` 适配宿主问题澄清：先读业务上下文，仅在歧义明显影响结果时提问，成功后等待宿主继续，跳过不算确认，回答后复用原业务会话及选数；无工具时退回普通文字。`atlas-menu` 不变，不新增 Atlas MCP、JS 或 hooks；该宿主澄清能力不添加到 Codex/Claude。Haze 发布版本须同步填写2.4.2，更新安装后活动会话空闲时显式重载。真实“入口调用→澄清→原会话查询”尚待验收，本次未上传发布。
- Eureka 包走“Atlas ZIP → 管理员上传 Haze 插件市场 → Eureka 组织扩展安装”链路，包含 Pi 技能发现清单及 Eureka 专属 `com.eureka` 认证声明，不含凭证读取代码或 `pi.mcp`。用户可在已支持组织插件功能和本契约版本的 Eureka 中安装，确认 MCP 地址后由连接层处理个人凭证；新会话加载插件，已有会话在空闲时重载并复用原业务会话。本次未上传或发布，尚未完成真实安装与查询联调。宿主必须验证来源 Haze 与 Atlas 地址的凭证授权关系，不能仅凭包内声明向任意地址发送个人凭证。结构与安全契约见 [插件格式](docs/agent-plugin-format.md)；本地导出脚本为 `apps/api/scripts/export-eureka-plugin.cjs`，默认输出 `artifacts/agent-plugins/`，另附 ZIP SHA-256，不能将业务规则修订当作 ZIP 校验和。本次不新增数据库迁移、历史包管理、回滚、自动更新或原生 Eureka 面板。
- Eureka 2.4.2 在 `plugin.json` 声明 `extensions.com.eureka.composer.selectionMode=persistent`：用户选中后标签常驻当前对话输入框、后续消息持续使用，直到用户移除；不自动启用插件，不授予额外权限。`once` 则仅本条消息使用、发送后清空。Codex/Claude版本及共享业务规则不变。
- 本轮按用户约定统一结果展示：仅按已有单位（%乘100、万元除10000、亿元除100000000），小数默认两位，原值及SQL不变；移除新增的精度/尺度控件和正式配置字段，不再要求额外维护或重新发布。迁移 `20261021100000_unit_driven_display` 清理上一版额外列。多业务来源先选择、MCP有界等待及轻量目录优化保留。构建共享 `@eureka-atlas/result-format`、API/Web并更新三端插件。实现、等待参数、计时及真实验收边界见 [问数质量改进](docs/agent-query-quality-implementation.md)。
- 范围与任务关联迁移 `20261013120000_agent_query_sessions` 后需应用 `20261014100000_agent_selection_access`：移除范围到期列、增加宿主对话绑定及加密选数授权，不改写原查询归属。应停止旧 API 后应用新迁移，避免旧代码读取被删除的列。应用迁移、生成 Prisma Client、重新构建并重启 API/Web 后生效；旧网页 `/api-center` 已移除，REST 文档地址保持不变。
- 集成中心管理页面和插件下载仅管理员和系统管理员可用；后端文档接口也检查独立的 `api.access` 权限。MCP 对 ADMIN、SYSTEM_ADMIN、DEVELOPER、USER 均开放本人个人凭证认证，独立选数页允许所有已登录用户管理本人的会话，不扩大原有 REST 开放 API 权限。支持接口说明、Schema、虚构示例、OpenAPI 下载及真实在线测试。
- 开放路径为 `/api/external/v1`，只接受 `Authorization: Bearer <HAZE_PERSONAL_CREDENTIAL>`。每次请求实时调用 Haze `/api/auth/personal-credential/me` 校验当前身份、状态与角色；Cookie 不可替代个人凭证，个人凭证不能访问既有网页管理接口。
- 只开放语义搜索、Package 获取、候选值和指标查询及任务状态／结果／取消，不开放任意 SQL、自然语言问数、澄清编排或 MCP 协议。搜索和提交范围为全部已发布可查询表，任务始终按 Haze `member_no` 隔离。
- 指标／候选值提交为异步 202；需携带 Package 的 `content_version` 和本人唯一的 `idempotency_key`。同请求重试返回原任务，参数变更或语义版本冲突返回 409。实际结果最多 5000 行／5 MiB，并提供截断标志，不是模型的 100 行摘要。
- 每用户每分钟 60 次请求，最多 3 个未结束语义查询（含网页问数），请求体上限 64 KiB，执行超时 10 分钟，结果保留 24 小时；超限返回 429 及 Retry-After。当前仅单 API 实例部署，勿多副本绕过进程内准入／限流。
- 调试面板直接使用真实 Bearer 请求且 `credentials: omit`，无 Cookie 认证回退；凭证仅在当前页面内存，离开页面清空，示例使用占位符，不保存请求历史、不记录凭证。响应预览遮蔽与输入凭证相同的字符串。外部 401／403／503 不会清除网页登录会话；停止等待与取消后台任务是不同操作。
- 此功能不修改 Haze，无需数据库迁移；重新构建并重启 API／Web 后生效。调用流程、错误码及部署验收见 [外部 API 使用说明](deploy/external-api.md)。

## Haze 角色权限

直接复用 Haze 登录及 `/api/auth/me` 返回的 `role_code`、`role_name`，不按手机号、会员编号或角色显示名称识别系统管理员，也不使用 Haze 其他产品的权限代码推断 Atlas 权限。

| Haze 角色 | 业务查看与个人问数／查询 | 治理任务、AI 治理、发布、指标／维度维护 | 数据源、AI 配置、系统设置 |
| --- | --- | --- | --- |
| SYSTEM_ADMIN（系统管理员） | 允许 | 允许 | 允许 |
| ADMIN（管理员） | 允许 | 允许 | 禁止 |
| DEVELOPER（开发者） | 允许 | 禁止 | 禁止 |
| USER（使用者） | 允许 | 禁止 | 禁止 |

- 普通成员可查看首页、资产列表与详情、物理字段、语义 Package、指标和维度来源；不能修改或发布治理信息。保存本人查询配置、创建问数与查询、取消及导出仍然允许。
- 管理员可以读取已有治理选项并选择数据域，但不能维护系统选项。问数使用的可用模型列表只返回使用所需信息，不开放模型管理或凭据。
- 前端按同一规则过滤菜单、首页快捷入口和编辑控件；直接访问受限地址会显示无权访问，不挂载业务页面。后端在认证后独立校验，未声明权限的非公开接口默认拒绝，不能仅靠前端按钮限制。
- 无权限返回 403，不注销有效会话；缺失或未知角色拒绝授权，不降级为普通角色。每次后端请求重新读取 Haze 当前资料，前端在登录资料刷新时处理角色变化、失效旧请求并重建工作区。已开始的后台任务不会因此自动取消。
- 数据源鉴权失败不代表 Atlas 登录失效：MaxCompute 上游 401 对外返回 502。网页遇到其他业务请求的 401 时先通过 `/api/auth/me` 重新确认会话，只有会话校验返回 401 才退出；校验暂时不可用时保留用户并提供重试。
- 系统管理员的全功能权限不覆盖个人历史归属规则；不能读取其他成员或无归属的历史问数、查询与保存配置。
- 本次权限接入不需要数据库迁移。部署时重新构建共享类型、API 和 Web，等待或停止活动任务后重启 API；开发 API 不自动重载，单独更新前端不会使后端授权生效。现有会话可通过 Haze 资料刷新获得角色，无需重新治理数据。
- 权限回归测试使用四种模拟 Haze 角色，覆盖真实 HTTP 授权、菜单与页面限制、只读控件、角色变化和个人历史隔离；真实账号的页面操作可在部署后手动验收。

## Personal ask and query history

- New conversations and query-debug executions belong to the authenticated Haze `member_no`; the client cannot select an owner. Messages, events, charts, archived results and Excel exports follow their conversation.
- Other users' and unowned legacy resources return 404; missing or expired login returns 401. Query detail/result/cancel endpoints also enforce ownership.
- Existing history is retained with a null owner, hidden and inaccessible. Do not automatically assign it to a login or delete it during deployment.
- Recently opened conversations are remembered per member number. Account changes reset workspaces, abort stale requests and close SSE/queries polling; same-origin tabs revalidate through notifications that contain no credentials or user data.
- Migration `20261009070000_account_owned_queries` adds nullable owner columns and scoped indexes/unique constraints without deleting records. It has been executed and registered on the local database; existing pending migration-history discrepancies remain untouched. On another database, inspect pending migrations before deployment, regenerate Prisma Client, build database/API, then restart the API.
- Regression tests: `pnpm --filter @eureka-atlas/api test:unit` and `pnpm --filter @eureka-atlas/web test:unit`. Ownership tests use simulated Haze accounts and do not need real credentials or browser automation.

## Workspace

- `apps/web` — Next.js user interface.
- `apps/api` — NestJS backend API.
- `packages/database` — Prisma schema and generated database client.
- `packages/types` — shared TypeScript contracts.
- `packages/config` — shared TypeScript compiler configuration.

Business modules are scaffolded only in this milestone. DataWorks integration, governance workflows, LLM calls, and semantic packages start in later milestones.

## 数据查询部署

### 保存查询与我的查询

在查询配置顶部使用「保存查询」命名并保存数据集、模式、字段顺序、筛选关系及排序。「我的查询」从右侧抽屉打开本人配置进行编辑，不自动执行。打开已有配置后默认更新原查询，也可「另存为新查询」；删除配置不影响执行记录或后台任务。

配置长期保存在 PostgreSQL，按 Haze 会员编号隔离，同账号跨设备可用。相对日期保留预设，执行时重新计算；固定日期不变，快照仍自动读取最新有效分区。保存和加载校验不访问 MaxCompute。语义更新后提示当前口径，失效字段和条件需明确修正后再使用。

部署迁移 `20261010080000_saved_data_queries` 后运行 `pnpm db:generate`，构建数据库与 API 并重启 API。迁移历史正常时使用 `pnpm --filter @eureka-atlas/database run deploy`（必须带 `run`，避免触发 pnpm 内置 deploy 命令）。若存在历史迁移差异，应核对数据库后只应用本次新增迁移，不能重置或删除历史数据。接口为 `/api/saved-data-queries` 的本人配置 CRUD；刷新通过 `savedQueryId` 恢复配置，已有 `queryId` 继续恢复执行快照。

测试：构建 API 后运行 `pnpm --filter @eureka-atlas/api exec node --test test/saved-data-query.test.js` 和 `pnpm --filter @eureka-atlas/web test:unit`。页面与真实账号流程手动验收，不需要浏览器自动检查。

数据查询入口为 `/query/data`，明细默认、可切换汇总。最多保存 200,000 行（SQL 读取 200,001 行判定截断），提交到完整读取共计 10 分钟，成功结果保留 24 小时。智能问数仍限制 5,000 行。

从第二个可选业务条件开始，每行可选择 AND / OR 连接前面的条件，默认 AND；请求将连接符保存在各筛选条件的 `logic` 中。混用时遵循 SQL 的 AND 优先于 OR，例如 `A OR B AND C` 表示 `A OR (B AND C)`。必填日期和最新快照范围始终与整组业务条件共同生效，一个日期区间的上下界始终作为整体，候选值搜索关键词也始终缩小结果范围。删除条件后保留其余行的连接符，首个业务条件不使用连接符。不提供用户自定义括号嵌套。关系会随查询请求保存，刷新恢复和 Excel 查询说明使用同一请求。

日期预设（昨日、近 7／30／N 天）在每次提交新查询时，由后端按 Asia/Shanghai 解析为截至昨日的实际日期，并按已发布日期格式写入查询及候选值 SQL；自定义区间直接使用选择的日期。DATETIME 区间包含结束日期整天，使用次日零点作为排除的上界。SQL 保持单条 SELECT，不生成动态日期函数或 SET 语句。查询记录及 Excel 保存本次实际日期，复制 SQL 后日期保持固定；需要更新日期时请重新生成查询，历史结果不会自动刷新。

API 机器需 Python 3.11+，安装固定读取依赖：

```powershell
python -m pip install -r apps/api/python/requirements.txt
```

配置服务端 `MAXCOMPUTE_PYTHON_BIN` 为 Python 可执行文件路径（Windows 默认 python，Linux 默认 python3）。示例配置不包含密钥；数据源凭据仅经子进程标准输入传入，不写入命令行或客户端。

Python 子进程的输入输出固定为 UTF-8，结果协议使用 ASCII JSON 转义保存中文与 emoji；API 严格校验 UTF-8，不允许错误编码被静默替换为乱码。编码修复需要重新构建并重启 API，已保存的乱码结果不会自动修复，需重新查询。数据查询 Excel 中的 `null` 导出为空白单元格；真实文本 `NULL`、`[NULL]` 保持原样，数值精度及公式前缀保护不变。

读取程序位于 `apps/api/python/maxcompute_reader.py`，部署时随 API 的 dist 一起保留 python 目录。PyODPS 仅读取已提交的实例，通过 `open_reader(tunnel=True, limit=False)` 使用 InstanceTunnel，不重新执行 SQL，不降级为有限结果接口。超过 10,000 行要求 MaxCompute 对所有源表授予完整下载权限；权限不足会明确失败，不绕过云端限制。公网 Tunnel 可能产生下载费用，详见 [InstanceTunnel 官方说明](https://www.alibabacloud.com/help/en/maxcompute/instancetunnel)。

部署新增迁移 `20261010020000_data_query_results`，生成 Prisma Client，构建并重启 API。旧查询记录保留，不迁移旧结果内容。结果按每块 1,000 行持久化，接口只返回单页（50／100／200／500 行）；Excel 流式读取已保存分块，不重新查询。所有读写和下载继承 Haze 账号归属。取消和超时清理残缺结果；进程重启后未完成读取从实例重新开始，替换已有分块，成功后才可查看和导出。
