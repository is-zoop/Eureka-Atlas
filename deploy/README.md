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
docker compose --env-file .env.docker -f docker-compose.yaml build migrate api web
docker compose --env-file .env.docker -f docker-compose.yaml stop web api
docker compose --env-file .env.docker -f docker-compose.yaml up -d --force-recreate migrate api web
docker compose --env-file .env.docker -f docker-compose.yaml ps -a
docker compose --env-file .env.docker -f docker-compose.yaml logs --tail=100 migrate api web
```

检查健康接口 `https://你的域名/api/health`；API 健康检查是进程存活检查，数据库另有独立健康检查。登录、问数 SSE、查询／分页／Excel 和真实 MaxCompute 大结果由使用者手动验收。不要扩容多个 API 副本，当前后台任务调度按单个 API 实例部署。

### 构建停在证书更新之后

宿主机 `curl` 能访问 npm，不代表 Docker 构建环境的 DNS、代理和包下载也正常；访问仓库首页成功也不能证明包文件可以下载。Dockerfile 将系统依赖与 pnpm 安装分为独立步骤，安装 pnpm 时输出详细请求与脚本日志，单次下载设置 60 秒超时、重试一次。失败时保留证书安装层缓存，不需要反复使用 `--no-cache`。

中止旧构建，上传最新 Dockerfile 后执行：

```bash
docker compose --env-file .env.docker -f docker-compose.yaml --progress plain build api web
```

仍然失败时，根据最后一条 npm 请求日志检查 DNS、连接超时、证书或返回状态；不要关闭 TLS 校验。可以使用临时容器测试同一 Node 镜像中的实际包下载（若镜像未缓存，会先拉取镜像）：

```bash
docker run --rm node:24-bookworm-slim \
  npm install --global pnpm@11.19.0 \
  --no-audit --no-fund --loglevel=verbose --foreground-scripts \
  --fetch-retries=0 --fetch-timeout=60000
```

临时容器测试仍不等同于独立 BuildKit 构建器的网络。若临时容器成功而构建失败，继续检查 `docker buildx ls` 所选构建器及其网络、DNS、代理配置。上述检查和中止构建不会停止现有应用，也不删除数据卷。仅在镜像构建成功后再重新创建应用容器。

### pnpm 依赖安装超时

如果失败位置是 `pnpm ... install --frozen-lockfile`，并出现 `TimeoutError: The operation was aborted due to timeout`，先区分 npm 引导安装、pnpm 仓库请求和依赖安装脚本的独立下载。`Lockfile passes supply-chain policies` 表示该轮策略检查通过，不等于整个安装已经成功，也不能仅凭随后的一条通用超时确定具体请求地址。构建失败时，`build ... && up ...` 不会执行后面的容器更新；迁移成功同样不代表新 API/Web 镜像构建成功。

Dockerfile 给 pnpm 仓库请求单独设置了 180 秒超时、最多 3 次重试（重试间隔 10–60 秒）、4 个并发请求，以适应较慢网络。npm 全局安装 pnpm 的 `--fetch-timeout` 不会自动应用到这个步骤；`PRISMA_ENGINES_MIRROR` 也不是 npm 包下载源。保留冻结锁文件、供应链策略、TLS、包完整性验证和必需的安装脚本。超时参数不覆盖第三方脚本自建的网络请求，也不能修复不可访问的域名或代理。

上传最新 Dockerfile 后使用原有构建器重试，不加 `--no-cache`。可以在 Bash 中保留完整日志，并让管道正确返回构建失败状态：

```bash
set -o pipefail
docker compose --env-file .env.docker -f docker-compose.yaml --progress plain build \
  --build-arg PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma \
  api web 2>&1 | tee docker-build.log
```

如仍失败，查看错误前的请求重试、包名、URL 和安装脚本信息，再检查对应构建网络；不要直接禁用安全检查或把 npm 源与 Prisma 引擎源混为一谈。已经成功执行、且没有新增迁移时，无需为了重试 API/Web 构建再次执行迁移。参考：[pnpm 网络配置](https://pnpm.io/settings/network)。

### better-sqlite3 编译下载 Node 头文件超时

如果 Prisma 安装已 `Done`，但 `better-sqlite3 install: node-gyp rebuild` 随后请求 `https://nodejs.org/download/release/.../node-...-headers.tar.gz` 并出现 `ConnectTimeoutError`，失败的是原生模块编译所需的 Node 头文件下载，不是数据库迁移或 Prisma 引擎下载。pnpm 的仓库超时和 Prisma 下载源参数均不控制这个请求。

官方 `node:24-bookworm-slim` 镜像本身包含 `/usr/local/include/node` 下与其 Node 二进制匹配的头文件。Dockerfile 在依赖安装前检查 `node.h`、`common.gypi`、`config.gypi`，并仅在该安装步骤设置 node-gyp 12 推荐的 `npm_package_config_node_gyp_nodedir=/usr/local`。node-gyp 读取本地文件进行真实编译，不再为此请求 nodejs.org；不要通过跳过安装脚本来绕过编译，也不要另装版本可能不匹配的 Debian Node 头文件。

上传最新 Dockerfile 后按上一节的命令重新构建 `api web`，复用现有 pnpm 缓存。此修复不加速供应链检查的 npm 元数据请求，也不处理其他安装脚本自己的网络下载。如果仍失败，按新的第一个错误继续定位，不能把原来的网络错误当作已证明的 Node/SQLite 版本不兼容。迁移已经成功且未新增迁移时，无需重跑迁移。

参考：[node-gyp 12.4 配置](https://github.com/nodejs/node-gyp/blob/v12.4.0/README.md#environment-variables)、[官方 Node 镜像](https://github.com/nodejs/docker-node/blob/main/24/bookworm-slim/Dockerfile)。

### 安装停在 Prisma 引擎下载

如果 `node scripts/postinstall.js` 的工作目录是 `@prisma/engines`，该脚本正在下载数据库引擎，默认来源是 `https://binaries.prisma.sh`，并非 npm 仓库。构建已启用 Prisma 下载调试日志与 pnpm 的 append-only 日志，以显示实际下载地址、缓存和错误。不要使用 `--ignore-scripts` 绕过安装，也不要关闭 TLS 或校验和检查。

官方引擎源无法正常下载时，可在确认备用源可访问、包含当前版本引擎及校验文件后，选择使用 npmmirror。先中止旧构建并上传最新 Dockerfile，然后执行：

```bash
docker compose --env-file .env.docker -f docker-compose.yaml --progress plain build \
  --build-arg PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma \
  api web
```

该参数只作用于镜像构建时的依赖安装和 Prisma Client 生成，不改数据库地址、迁移记录或运行时配置。默认构建仍使用官方源。更换下载源会重跑依赖安装步骤，但 pnpm 的下载缓存可以复用；不需要清空构建缓存。若引擎版本或目标平台更新，需重新确认备用源提供相应文件，不能通过忽略缺失的校验文件来强行继续。

为了避免后续更新漏写参数，Compose 的 `migrate`、`api`、`web` 三个构建目标均从 `.env.docker` 读取 `PRISMA_ENGINES_MIRROR`。上传最新 `docker-compose.yaml`，在服务器原有 `.env.docker` 中添加或修改这一行（不要覆盖密码和密钥）：

```dotenv
PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma
```

之后普通 `docker compose --env-file .env.docker -f docker-compose.yaml build api web` 也会使用所选源，不需要每次传 `--build-arg`。配置后先运行 `docker compose --env-file .env.docker -f docker-compose.yaml config --quiet` 检查配置，不要将包含密钥的完整配置输出发给他人。

`prisma generate` 也可能按需下载引擎，不只是安装依赖时才会下载；安装步骤出现找不到默认 schema 的警告，在本 Dockerfile 中是正常的，因为 schema 在随后复制源码时才加入，并由明确的 `--schema prisma/schema.prisma` 生成。依赖安装完成并不等于引擎文件已下载成功。保持下载源和构建器不变、不清理缓存，才能复用成功的构建层；普通代码更新无需 `--pull` 或 `--no-cache`。

SQLite 文件需放入挂载目录，注册路径使用 `/data/sqlite/文件名.db`，不能保留 Windows 盘符路径；文件需允许 UID 1000 读取。若不使用 SQLite，空目录保留即可。

WPS 插件继续安装在 Windows 客户端，不运行在 Linux 容器；部署后在“Atlas 服务设置”填写同一个 HTTPS 服务根地址，不带 `/api`。安装包可独立分发，不包含在服务器镜像中。

参考：[Docker Compose 启动依赖](https://docs.docker.com/compose/how-tos/startup-order/)、[pnpm Docker 工作区建议](https://pnpm.io/docker)。
