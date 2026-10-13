# Linux Docker 部署

入口文件为项目根目录 `docker-compose.yaml`，必须连同 `Dockerfile`、源码、`pnpm-lock.yaml`、`pnpm-workspace.yaml` 上传，不是只上传一个 YAML。

使用 Docker Engine 与 Docker Compose v2（`docker compose`），支持 `service_healthy` 与 `service_completed_successfully`。构建需要可访问 Node／PostgreSQL 镜像仓库、npm、Debian 和 PyPI。运行需要可访问 Haze、数据源、模型服务及 MaxCompute Tunnel。

## 初次启动

在服务器上的项目根目录执行：

```bash
cp .env.docker.example .env.docker
chmod 600 .env.docker
mkdir -p deploy-data/sqlite
# 编辑 .env.docker 后再执行下方命令
docker compose --env-file .env.docker -f docker-compose.yaml config --quiet
docker compose --env-file .env.docker -f docker-compose.yaml up -d --build
docker compose --env-file .env.docker -f docker-compose.yaml ps -a
```

必须填写随机 PostgreSQL 密码、32 字节 Base64 加密密钥，以及真实 `WEB_ORIGIN`。示例域名只是占位符。数据库密码建议使用 `openssl rand -hex 24` 的输出；连接字符串直接拼接密码，特殊字符需 URL 编码，因此不要使用未经编码的特殊字符密码。只有全新数据库才生成新加密密钥；迁移现有数据时必须沿用原 `DATA_SOURCE_ENCRYPTION_KEY`，否则原数据源／模型凭据和登录令牌不能解密。不要修改或上传开发电脑的 `.env`。

服务顺序：PostgreSQL 健康 → `migrate` 成功退出 → API 健康 → Web。`migrate` 退出码 0 是正常现象，数据库迁移失败会阻止 API 启动，不会执行 reset／db push 或删除历史。Web 和 API 使用正式构建，不运行 `pnpm dev`。API 包含 Python 3.11 和项目固定的 PyODPS 依赖，以及结果读取脚本。

Web 和 PostgreSQL 分别只在服务器本机提供 `127.0.0.1:3000` 和 `127.0.0.1:5432`；API 没有宿主机端口映射。启动前确认本机 5432 未被其他 PostgreSQL 实例占用。Compose 新建的是空数据库，不会自动读取或导入开发电脑的数据。账户、共享资产、会话、执行记录和结果分块持久化在 `postgres_data` 卷；更换容器不会删除它。不要执行带 `-v`／`--volumes` 的 down 操作来更新应用。

从其他电脑使用数据库工具时，通过 SSH 隧道连接，不将数据库端口直接暴露到公网：

```bash
ssh -N -L 15432:127.0.0.1:5432 paiwo@服务器IP
```

保持 SSH 连接，数据库工具连接本机 `127.0.0.1:15432`；数据库、用户名和密码使用 `.env.docker` 中的对应配置。

API／Web 以非 root 的 `node` 用户运行。构建与运行保留工作区布局，避免破坏 pnpm 链接与 Prisma Client 的原生引擎；本机 Windows 的 node_modules、dist、.next、密钥及 WPS 安装包不会进入构建上下文。镜像中的 API／Web 工作区依赖仍含构建依赖，Linux 原生编译工具只存在于构建阶段，运行阶段不安装编译工具。

## HTTPS 与同源 API

生产登录 Cookie 带 Secure，必须从 HTTPS 域名使用，不要通过 HTTP 公网地址验收登录。使用现有 Nginx／OpenResty／1Panel 配置证书，把域名反代到 `http://127.0.0.1:3000`。`WEB_ORIGIN` 必须与用户访问的 HTTPS 域名、端口精确一致。

在已有 HTTPS `server` 中使用以下 location；端口不同需同步修改：

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_read_timeout 660s;
    proxy_send_timeout 660s;
}
```

浏览器和 WPS 安装版都访问同一域名的 `/api`；Web 将其转发到 Docker 网络内的 `api:3001`，不把 `localhost:3001` 暴露给客户端。API_ORIGIN 在 Web 构建时固定为该容器地址，不能只改运行环境就换上游服务名。反代禁止缓存用户 API、SSE 或下载，保持 Cookie／Origin，不把 API 重定向到登录 HTML。

上述默认适合反代运行在宿主机（或 host 网络）。如果反代也是 bridge 网络容器，容器的 `127.0.0.1` 不是宿主机：将反代加入本 Compose 网络后转发到 `web:3000`，或使用明确的宿主机内网地址并限制防火墙；不要把明文端口无保护地开放到公网。

## 现有数据库与更新

### 首次部署缺失问数表的迁移恢复

源码已补齐 `20260929120000_ask_and_query_execution`（问数及查询执行基础表）和 `20261012110000_complete_schema_history`（模型鉴权字段、数据源默认状态及结果外键名称）。原先已发布的迁移 SQL 不变，不删除历史、不分配旧记录所有者。全新数据库按完整迁移链初始化，不需要手动 resolve。

以下恢复流程仅适用于首次部署在 `20261009070000_account_owned_queries` 的第一条 SQL 处失败、日志明确为 `relation "ask_session" does not exist` 的情况。若导入过本地数据库或有部分建表／变更，先核对结构和迁移记录，不照抄 resolve，也不要直接运行新基础迁移。

1. 上传新增的两个迁移目录（包含 `migration.sql`），不要覆盖 `.env.docker`，移除旧的空目录 `20260929130000_query_scopes`（仅在其确实为空时使用 `rmdir`）。
2. 在项目目录备份数据库，确认缺失表与失败记录：

```bash
umask 077
docker compose --env-file .env.docker -f docker-compose.yaml exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > atlas-before-migration-repair.dump

docker compose --env-file .env.docker -f docker-compose.yaml exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
SELECT to_regclass('public.ask_session') AS ask_session, to_regclass('public.ask_run') AS ask_run, to_regclass('public.query_execution') AS query_execution;
SELECT migration_name, finished_at, rolled_back_at, logs FROM "_prisma_migrations" WHERE migration_name = '20261009070000_account_owned_queries';
SQL
```

三个表都应为空；失败记录未成功完成，且 logs 与上述第一条 SQL 报错一致。备份失败或结构不同则停止，不继续恢复。

3. 使用可访问镜像仓库的内置构建器重新构建，成功后只将这条失败记录标记为已回滚（不是已应用）：

```bash
docker compose --env-file .env.docker -f docker-compose.yaml --progress plain build --builder default migrate api web

docker compose --env-file .env.docker -f docker-compose.yaml run --rm --no-deps migrate pnpm --filter @eureka-atlas/database exec prisma migrate resolve --rolled-back 20261009070000_account_owned_queries --schema prisma/schema.prisma
```

4. 继续执行迁移并启动；先前已成功的迁移保留，Prisma 会执行新增基础迁移、重试账号归属迁移及完成其余迁移：

```bash
docker compose --env-file .env.docker -f docker-compose.yaml up -d --no-build --force-recreate migrate api web
docker compose --env-file .env.docker -f docker-compose.yaml ps -a
docker compose --env-file .env.docker -f docker-compose.yaml logs --tail=100 migrate api web
```

预期 migrate 退出码 0、API／Web healthy。`--rolled-back` 只修复失败记录，不执行 SQL 回滚；此处安全的前提是第一条 SQL 即失败，没有应用任何业务结构变化。不使用 reset、db push、删除卷或将失败迁移标记为已应用来绕过错误。

### 迁移回归测试

`pnpm --filter @eureka-atlas/database test:migrations` 检查所有迁移目录是否有 SQL。显式提供 `MIGRATION_TEST_DATABASE_URL` 后还会测试完整初始化、重复部署、上述真实失败的重现与恢复，以及旧记录／凭据保留，并通过 Prisma diff 检查最终结构与 schema 完全一致。测试账号需要创建数据库权限；测试仅创建并删除随机命名的 `atlas_migration_test_*` 数据库，不迁移或修改配置地址指向的现有数据库。未提供地址时数据库测试明确跳过，不能当作已验证。

### 常规更新

本配置默认使用容器 PostgreSQL。迁移开发电脑数据需要自行备份／恢复，并保留原加密密钥；不要直接把 Windows PostgreSQL 数据目录挂到 Linux。修改 PostgreSQL 初始化用户名／密码变量不会自动修改已经初始化的数据库账号。

若导入的数据库迁移历史与源码不同，先检查 `prisma migrate status` 与已有结构。项目此前存在本地迁移历史差异，不能盲目 resolve 全部迁移；迁移任务失败时核对日志，不通过清空数据库绕过。使用已有外部数据库时，应同时调整 API 与 migrate 的 DATABASE_URL，移除内置 postgres 服务和对应 depends_on，不要留下未使用的数据库依赖。

更新前备份数据库及 `.env.docker`，在项目目录执行：

```bash
docker compose --env-file .env.docker -f docker-compose.yaml build --pull
docker compose --env-file .env.docker -f docker-compose.yaml stop web api
docker compose --env-file .env.docker -f docker-compose.yaml up -d --force-recreate migrate api web
docker compose --env-file .env.docker -f docker-compose.yaml ps -a
docker compose --env-file .env.docker -f docker-compose.yaml logs --tail=100 migrate api web
```

检查健康接口 `https://你的域名/api/health`；API 健康检查是进程存活检查，数据库另有独立健康检查。登录、问数 SSE、查询／分页／Excel 和真实 MaxCompute 大结果由使用者手动验收。不要扩容多个 API 副本，当前后台任务调度按单个 API 实例部署。

SQLite 文件需放入挂载目录，注册路径使用 `/data/sqlite/文件名.db`，不能保留 Windows 盘符路径；文件需允许 UID 1000 读取。若不使用 SQLite，空目录保留即可。

WPS 插件继续安装在 Windows 客户端，不运行在 Linux 容器；部署后在“Atlas 服务设置”填写同一个 HTTPS 服务根地址，不带 `/api`。安装包可独立分发，不包含在服务器镜像中。

参考：[Docker Compose 启动依赖](https://docs.docker.com/compose/how-tos/startup-order/)、[pnpm Docker 工作区建议](https://pnpm.io/docker)。
