# Atlas WPS 数据助手

Windows WPS 表格加载项，目标版本 12.1.0.28043。0.4.1 修复 WPS 复选框回调导致覆盖选项未生效的问题；Windows 图标使用深色圆形底、加粗白色指南针，圆形外透明，优化开始菜单的小尺寸辨识度。本次图标修订保持 0.4.1 版本号。不提供插件内配置编辑、手写 SQL、定时刷新或权限管理。

## Windows 安装包试用（推荐）

产物：`release/AtlasWpsSetup-0.4.1-x64.exe`。支持 Windows 10／11 x64、.NET Framework 4.8，以及支持 JS 加载项的 WPS 表格。当前电脑具备运行依赖；其他用户电脑由安装向导检查。安装包未代码签名，可能被 Windows SmartScreen 或企业安全策略提醒／拦截；仅使用可信来源文件，不关闭安全软件或绕过企业策略。正式分发前应代码签名并人工验证目标 WPS 安装版本。

1. 保存工作簿并完全退出 WPS，运行安装包。不需要管理员权限。
2. 当前本机测试保留 `http://127.0.0.1:3001`，Atlas API 和数据库仍需正常运行；无需运行 `pnpm dev:wps`、安装 Node.js、pnpm 或 Python 客户端。
3. 完成时勾选“启动 Atlas 本地助手”；可选择 Windows 登录自动启动（默认不选）。助手在系统托盘运行，没有终端窗口。
4. 重新打开 WPS 表格，选择 **Atlas → 打开助手**，登录、打开我的查询并查询／刷新专用结果工作表。先使用空白测试工作簿。
5. 下一次开机若未选择自启动，从开始菜单 **Atlas WPS 数据助手** 启动即可。退出托盘助手会断开插件，但不取消后台查询或删除工作簿数据。
6. Atlas 部署后，在开始菜单 **Atlas 服务设置**（或托盘菜单）改为服务根地址 `https://你的Atlas域名`，不要加 `/api` 或页面路径。保存会重启本地助手；地址变化时清除原地址的保存登录态，需要重新登录，同地址重启或升级保留仍有效的登录态。远程 HTTP、含账号密码的 URL、路径／查询参数均不允许；保留 TLS 证书验证。

安装目录为当前用户 `%LOCALAPPDATA%/Programs/AtlasWps`，包含固定版本官方签名 Node.js v24.12.0、隐藏启动器、编译 UI、独立本地服务与依赖许可。仅监听 `127.0.0.1:3891`，不占用原开发服务 3889，不添加防火墙规则，不部署公网服务。安装更新现有 `AtlasWpsProbe` 的同一登记，不重复创建 Atlas 菜单；安装前 XML 在 `%APPDATA%/kingsoft/wps/jsaddons/` 留存 `publish.xml.atlas-backup-*`。登记采用已在本机验证的官方 `publish.xml / enable_dev` 模式，不修改 `oem.ini`、WPS 安装目录或启动协议注册表。其他加载项保持原样。

安装版不是 Vite 代理：上游 `eureka_atlas_session`（包括生产 Secure Cookie）由本地助手管理，以 Windows DPAPI CurrentUser 加密写入安装目录的 `session.dat`，仅当前 Windows 用户可解密；不保存密码或明文凭据。浏览器只持有随机 `atlas_wps_session`，HttpOnly、SameSite=Strict，本机会话按摘要查找。同源 `POST /api/auth/restore` 通过 Atlas `/auth/me` 重新验证后恢复 Cookie；不会对任意未登录 GET 自动附加身份。关闭面板、重开 WPS、同地址升级或重启助手不再强制重新登录。有效期完全沿用上游，不续期；401／撤销和主动退出清除该上游会话的全部本地恢复绑定，503／网络异常保留缓存。其他 Windows 用户、不同服务地址或损坏的缓存不能恢复。卸载删除缓存。转发前校验真实 Host、Origin 和 Sec-Fetch-Site，只允许本插件所需接口；不转发前端 Authorization、任意 Cookie 或任意 URL，不跟随重定向，不记录凭据／响应正文。后台仍执行 Atlas／Haze 的账号校验。共享同一个 Windows 用户的人员也共享其恢复登录能力，共用电脑请主动退出。

卸载：Windows 应用列表或开始菜单 **卸载**。先退出 WPS；卸载只停止本助手、移除仍指向 3891 的 Atlas 登记与已安装文件、快捷方式和本产品自启动项。使用编译时显式文件清单，不递归删除安装根目录，不删除工作簿、其他加载项或服务器任务；XML 备份保留以便人工恢复。错误 XML 不覆盖，已改为别的部署地址的 Atlas 登记不删除。

### 重新生成安装包

构建机需要 PowerShell 7、pnpm、.NET Framework C# 编译器及官方签名 Node.js v24.12.0；最终用户不需要这些构建工具。`pnpm package:wps` 构建专用 `dist-desktop/`，不打包网页发布 SDK、源码、数据库或 `.env`。NSIS 3.13 便携编译器从官方 HTTPS 下载，固定 SHA-256 校验后解压到忽略的 `.build-tools/`；不安装编译器到系统。

```powershell
pnpm package:wps
# 自定义编译工具路径（便携 NSIS Bin/makensis.exe）
pwsh -NoProfile -File apps/wps-addin/installer/build.ps1 -MakeNsis 'C:/NSIS/Bin/makensis.exe' -Node 'C:/Node/node.exe'
```

自动化测试覆盖 Cookie 隔离、生产 Secure Cookie 桥接、跨站拒绝、超时／503 会话保留、401／退出清理、双账号，以及独立临时 XML 的注册／重装／卸载／错误格式／外部实体防护。生成安装器不等于在真实 WPS 上完成验收：安装、菜单、登录、查询写表、重开刷新和卸载仍需人工试用。不自动运行安装器或操作真实 WPS。

## 本机源码开发使用

本机已通过当前用户 `publish.xml` 登记 `AtlasWpsProbe`，加载地址仍为 `http://127.0.0.1:3889/`。升级后不需重新点击网页安装按钮；保持服务运行，保存文件、完全退出并重启 WPS，再打开 **Atlas → 打开助手**。

本地运行需要 Atlas API（127.0.0.1:3001）、数据库及已有 MaxCompute 完整结果读取环境。加载项开发服务：

```powershell
pnpm dev:api
# 在另一个终端运行；如果已有 3889 预览服务，不要重复启动
pnpm dev:wps
```

请先使用 `.xlsx` 测试工作簿：

1. 用 Haze 手机号和密码登录。此登录使用现有 Atlas 鉴权，不是 WPS 账号登录。
2. 从“我的查询”选择已在 Atlas 网页保存的配置，可以搜索、翻页或刷新列表。仅浏览列表不执行 SQL。
3. 点击“查询／刷新工作表”。每次读取最新保存配置；相对日期、最新快照由 Atlas 在执行时计算。
4. 首次导入新建以查询名称命名的专用结果表，不添加 `Atlas_` 前缀，从 A1 开始写中文表头与数据，不修改原有工作表。名称最多 31 个字符，非法字符替换为下划线；同名（不区分大小写）时追加 `_2`、`_3` 等序号。
5. 同一查询再次执行会找到本工作簿的绑定结果表。完整结果分批暂存完毕后，默认弹窗确认覆盖范围；勾选菜单“刷新覆盖”后跳过这一步，直接刷新。按最新查询名称同步表名与绑定，旧的 `Atlas_查询名称` 会在刷新时去掉前缀。未选择查询而直接恢复上次任务时保留绑定表名。旧结果多出的行列会清空，确认范围外不修改；更新失败会恢复数据、原表名及绑定。
6. 成功后手动保存工作簿。插件不调用 Save/SaveAs，不依赖或保证原生撤销栈。

工作簿自定义属性仅记录版本、所属会员编号、保存查询 ID、结果表名称和行列范围，不保存密码、Cookie、令牌、SQL 或查询结果副本。保存工作簿后，下次打开、登录同一账号并选择相同查询即可刷新。结果表更名／删除、损坏绑定、只读／保护／合并区域／数组公式会明确失败，不自动改绑或静默覆盖别的表。

### 菜单与全部更新

- 菜单顺序：打开助手 → 全部更新 → 使用说明 → 刷新覆盖。三个按钮均使用 Lucide PNG 图标，避免原 SVG 不能显示时出现问号。面板、开始菜单的助手／服务设置、EXE、安装包与托盘使用指南针造型；Windows ICO 使用深色圆形底、加粗白色线条与实心指针，圆形外透明，提供 16／32／48／64／128／256px 图像。新快捷方式使用 `atlas-badge.ico` 路径，避免缓存旧细线图标；覆盖安装替换旧图标，不改变登录态或查询绑定。Windows 图标为静态 ICO，不执行 SVG 的 CSS；网页 SVG favicon 可随 `prefers-color-scheme` 切换线条色，但并非识别任意背景像素。[MDN 说明](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-color-scheme)
- “刷新覆盖”默认为不勾选，作用于当前 WPS 加载项生命周期；通过 WPS 官方 [PluginStorage](https://open.wps.cn/documents/app-integration-dev/wps365/client/wpsoffice/jsapi/addin-api/PluginStorage/obj) 在菜单与面板间共享。此选项只跳过覆盖询问，不跳过账号、保护、范围、完整结果和失败回滚检查。
- 覆盖设置不按 Office 回调参数顺序读取 WPS 的参数；菜单点击直接反转插件共享状态，以明确的 `true`／`false` 字符串写入并校验，菜单展示、单次刷新与全部更新读取同一值。原生存储不可用会明确报错，不静默降级为再次确认。[WPS 参数顺序说明](https://bbs.wps.cn/topic/86364)
- “全部更新”只读取当前工作簿自定义属性中、属于当前账号的已加载查询，逐个读取最新保存配置、执行与刷新。其他账号、没有加载到该工作簿的保存配置不会执行。默认逐表确认，勾选刷新覆盖后自动写入；拒绝某个表的写入会跳过该表，继续下一个。
- 只读、保护、被删除的绑定表或失效／被删除配置显示失败信息，不覆盖其他表。登录失效、服务不可用、结果读取失败、取消或工作簿切换会停止后续更新，已成功的表保留；已经提交的后台任务不因关闭面板而取消。已有未读任务时先恢复或取消该任务，不叠加批量任务。插件不自动保存文件。
- 安装仅移除 Atlas 登记的 `debug` 属性，以隐藏本加载项的 JS 调试入口，不改 WPS 安装目录、全局调试设置或其他加载项。[WPS 官方社区说明](https://forum.wps.cn/topic/36581)

## 数据、账号与任务生命周期

- 插件调用现有 `/api/auth`、`/api/saved-data-queries`、`/api/data-queries`，不改数据库或公开鉴权绕过接口。所有查询及任务读取、取消仍由后端校验账号。
- 登录 Cookie 为 HttpOnly，不设置 Authorization，不从前端读取或保存令牌；密码仅用于登录请求，成功后清空输入。
- 本地 WPS Cookie 与普通浏览器 Cookie 不共享，需要在插件内登录。插件退出仅注销当前 Atlas 会话，不调用 Haze 退出。
- 401 清理插件登录及工作区；503 显示服务不可用、可重试，不当作密码错误或退出。焦点恢复和同源登录通知会重新校验身份。
- 任务按 2 秒间隔查询状态；只在服务器确认 SUCCEEDED 后读取结果，按每页 500 行写暂存表，不将 20 万行累积到前端内存。
- 20 万行上限、云端执行与结果读取 10 分钟期限、结果 24 小时有效期继续由 Atlas 管理。超过 20 万行会提示截断；Excel 完整结果云端权限要求不变。
- 字符串先设置文本格式再批量赋值，防止前导零、高精度整数／小数丢失和字符串被作为公式解析。JSON 数值保持数值类型；日期字符串按文本导入，NULL 对应空白。超出单元格 32767 字符上限或不安全整数明确失败，不静默截断。
- 刷新保留专用范围的临时备份；复制失败尝试恢复，恢复也失败则保留 `Atlas_恢复备份` 并提示手动处理。关闭窗口、网络中断或取消本地读取，不能视为宿主事务或自动保存保证。
- 面板仅保留“取消查询”：立即停止本地读取，并请求取消后台任务；后台已完成时只停止本地读取，不删除服务器结果。取消请求失败保留任务信息并允许重试。关闭助手或退出登录仍不会取消后台查询。账号分开的本地存储只保留会员编号、保存查询 ID、任务 ID；恢复操作合并到主“查询／刷新工作表”按钮，未另选查询时继续上次任务，不重复提交 SQL。失败、取消、超时或过期任务解除恢复关联，下一次点击可重新查询。浏览器存储禁用时只保留当前面板的任务 ID。
- 查询按钮在卡片外，问号使用从 Haze 复制的 shadcn Tooltip，悬浮／键盘聚焦查看写表说明；登录提示与页面常驻冗余说明已移除，选中查询仅通过浅色背景标记。
- 安装版登录恢复由 Windows 加密缓存与同源恢复接口完成，Cookie 丢失或助手重启后仍先校验上游身份；前端、工作簿和 URL 不保存令牌。开发／服务器静态部署模式继续依赖 Atlas 自身 Cookie，不调用本地恢复接口。
- 退出登录不会删除已经写入工作簿的数据；文件不是加密或账号权限容器，文件分享及访问权限由使用者控制。

## 本地同源代理与生产部署

本地 Vite 开发／预览只监听 `127.0.0.1:3889`，固定将 `/api` 转发到本机 `127.0.0.1:3001`。代理先校验 Host、真实 Origin 及 Sec-Fetch-Site；拒绝跨站访问、其他 Host 和缺少同源 Origin 的写操作，然后使用上游自身 Origin 转发。Cookie 原样交由后端鉴权。没有任意上游地址参数，不修改 API 的 WEB_ORIGIN、CORS、来源检查或本地密钥。只适用于开发模式 API；生产 Secure Cookie 不应通过本地 HTTP 代理使用。

生产将整个 `dist/`（保留层级）放在 Atlas Web 的同源静态目录，例如 `/wps/`，使用 HTTPS；根 `/api` 继续使用 Atlas 已有反向代理。可以在 Web 构建前将产物复制至 `apps/web/public/wps/`。静态目录不应重定向至 Atlas 网页登录页，加载项自身显示登录表单。不要以 `file://` 打开，不要跨域连接生产 API，也不要部署 Vite 本地预览服务为公网服务器。

换部署地址后需重新登记加载地址。普通客户端可手动打开该目录的 `publish.html`，通过官方 SDK 安装／更新或卸载；仅针对既有 `AtlasWpsProbe`，不影响其他加载项。此机浏览器 WPS 启动协议不可用，当前已使用官方开发登记模式，不需重复重置组件或修改注册表、`oem.ini`。

## 构建、检查与手动验收

```powershell
pnpm --filter @eureka-atlas/wps-addin test
pnpm --filter @eureka-atlas/wps-addin typecheck
pnpm --filter @eureka-atlas/wps-addin lint
pnpm build:wps
pnpm --filter @eureka-atlas/wps-addin preview
```

开发与预览共用 3889，不同时启动。Node.js 22.18+；当前验证环境为 24.12.0。构建产物包含 Ribbon、登录／查询任务窗格、安装页、Lucide 图标和资源。官方 SDK 的旧浏览器 eval 分支及 Radix 的 use client 指令会产生构建告警，不影响构建完成；未关闭或修改依赖警告。

自动化仅使用模拟 WPS API、模拟查询接口、现有后端鉴权测试和普通 HTTP 检查，不打开浏览器、WPS 或真实工作簿，不自动登录真实账号／执行 MaxCompute 查询。真实人工验收至少覆盖：

- 正确／错误密码、服务不可用重试、退出后重新登录。
- 两个账号的“我的查询”隔离；账号 B 不可刷新账号 A 的结果绑定。
- 新建结果表、保存重开后刷新、最新相对日期与快照、空结果、结果行列缩减。
- 数值计算、中文列名、前导零、19 位整数、高精度小数、`=1+1` 等文本不变成公式。
- 写入期间切换／关闭工作簿、停止读取、刷新取消不覆盖旧结果。
- 真实大结果及中断恢复；打开助手后 WPS 菜单和单元格操作仍可用。

Button、Card、Input、Dialog、Tooltip 从 `E:/HazeToolPlat/frontend/src/components/ui/` 复制，沿用 shadcn/ui 与 Lucide。未新增 WPS 原生依赖、Atlas 后端模块或数据库表。

官方参考：[任务窗格](https://open.wps.cn/documents/app-integration-dev/wps365/client/wpsoffice/jsapi/addin-api/TaskPane/task-pane-overview)、[Range.Value2](https://open.wps.cn/documents/app-integration-dev/wps365/client/wpsoffice/jsapi/et/Range/member/Value2)、[Range.Copy](https://open.wps.cn/documents/app-integration-dev/wps365/client/wpsoffice/jsapi/et/Range/member/Copy)、[自定义文档属性及 255 字符限制](https://open.wps.cn/documents/app-integration-dev/wps365/client/wpsoffice/jsapi/et/Workbook/member/CustomDocumentProperties)、[官方开发登记](https://open.wps.cn/documents/app-integration-dev/wps365/client/wpsoffice/wps-integration-mode/wps-addin-development/generate-the-first-wps-addin)。
