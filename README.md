# Eureka Atlas

Enterprise data semantic governance platform. This repository currently contains Milestone 1: the runnable monorepo foundation only.

## Prerequisites

- Node.js 24+
- pnpm 11+
- PostgreSQL running at `127.0.0.1:5432`

## Setup

1. Copy `.env.example` to `.env` and replace `<PASSWORD>` with the password for the local `postgres` account.
2. Install dependencies: `pnpm install`
3. Validate the Prisma configuration: `pnpm db:validate`
4. Verify the database connection: `pnpm db:push`

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
- Data assets, semantic definitions and model configurations remain shared; ask conversations and all query execution records are private to the Haze member number. No roles or user-management screens are added. Logging out revokes only the current Eureka session, not Haze sessions, and does not stop background ask tasks.
- Business APIs, SSE, and Excel downloads require a valid session. Health and API documentation remain public. Haze downtime returns 503 without revoking the session; account disablement, token expiry, password changes and Haze logout invalidate it.
- Add the exact Eureka web origin to `WEB_ORIGIN` for LAN or deployed access. Production requires HTTPS because session cookies are Secure. Browser requests continue through same-origin `/api`.
- Apply the checked-in migration with `pnpm --filter @eureka-atlas/database deploy`, regenerate with `pnpm db:generate`, build database/API with `pnpm --filter @eureka-atlas/database build` and `pnpm build:api`, then restart the API. Never reset existing databases to add authentication.
- If old migrations are pending while their SQL changes already exist, do not blindly deploy them. Inspect the database and apply only the new authentication migration, then record `20261009043000_haze_auth_session` with Prisma `migrate resolve --applied`. The local database used for this integration has this migration applied; pre-existing migration-history discrepancies were left untouched.
- Focused tests: build the API, then run `pnpm --filter @eureka-atlas/api exec node --test test/auth.test.js` and `pnpm --filter @eureka-atlas/web exec node --test test/auth.test.cjs`. Real Haze account login, expiry, logout, and page appearance are checked manually; no browser automation is required.

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
