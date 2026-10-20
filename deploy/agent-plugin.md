# Atlas数据助手插件：桌面端选数与 Eureka 专用包

## 交付范围

- 管理页 `/integrations/plugins`：仅 ADMIN / SYSTEM_ADMIN 可访问、获取信息和下载插件。
- 三份独立 ZIP：`/api/integrations/plugins/codex.zip`、`/api/integrations/plugins/claude.zip`、`/api/integrations/plugins/eureka.zip`，下载链接附规则版本；规则变化返回409，刷新后重试。
- 所有有效角色 ADMIN、SYSTEM_ADMIN、DEVELOPER、USER 都可用本人的 Haze 个人凭证访问 `/api/mcp`。
- 原有 REST `/api/external/v1` 仍限管理员，不随本功能放宽。网页登录 Token、个人凭证和选数授权不互相替代。
- 本次做的是身份、对话和任务隔离，不新增用户级数据表/数据行授权。选数只能缩小当前已发布可查询范围，不是完整的数据权限系统。

## 客户端体验与接入状态

### Codex：免网页登录的独立窗口

安装 `atlas-ask-codex`，在客户端连接设置填入本人 Haze 个人凭证一次。在技能列表选择 **Atlas数据目录**（`$atlas-menu`）打开选表，选择 **Atlas数据助手**（`$atlas-ask`）显式问数。Codex 包为两个技能提供 `agents/openai.yaml` 显示名称、默认提示和 Atlas 指南针图标；插件入口也使用同一图标。更新后需重新加载插件并开启新对话，具体入口位置由客户端版本决定。不要宣称 Codex 有 `/atlas_menu` 原生命令或已实现 Codex 原生侧栏。

Agent 必须复用当前对话已有的 `session_id`，调用 `open_selection_menu`；仅明确的新对话没有业务会话时才创建。客户端打开返回的 `browser_url`，进入独立选数窗口。没有客户端打开链接能力时应如实告知并交给用户打开，不编造成功。

URL 中的片段包含五分钟有效、一次性启动码，不包含长期个人凭证。该链接本身是当前选数范围的短时授权，不能转发。片段不会发给网页服务器，页面在交换授权前清除片段；不要把完整启动链接写进访问日志、代码、截图或最终回答。客户端可能保存工具结果，所以仍需将其视为敏感入口，而非无秘密的普通链接。

启动码用于打开窗口，不是选数窗口的登录倒计时。已打开窗口不因启动码到期而掉线。浏览器使用专用 HttpOnly / SameSite=Strict Cookie（生产还启用 Secure），路径限定到当前选数窗口。Cookie 每次使用滚动续期一年；长期不使用导致浏览器自身清理 Cookie 时，需从 Agent 重新打开，但已保存范围保留。

服务端只为这个对话加密保存该 MCP 请求中的个人凭证，每次读取/保存实时通过 Haze 校验身份和角色。凭证重置、账号停用、未知角色拒绝访问；Haze 短时故障显示重试，不清除工作台登录。凭证轮换会更新窗口授权 epoch，旧 Cookie 不能借新凭证继续使用，需要当前新凭证重新打开。可在页面点击“断开授权”，清除该对话存储的加密凭证并撤销所有该对话窗口 Cookie，不删除范围或取消查询。

### Claude Desktop Code 模式：原生面板

安装 `atlas-ask-claude`，要求内置 Claude Code **2.1.303 或以上**、非 WSL 会话，并且组织允许 Mods。`/status` 查看内置版本。官方文档中 Mods 早期可用版本更低，本包仅以实际校验版本 2.1.303 为最低测试基线。

在本机用户环境中配置一次 `ATLAS_PERSONAL_CREDENTIAL`，再完全退出并重开 Claude Desktop。`.mcp.json` 和 Mods 共用此变量；已经运行的桌面应用不会继承另一个 PowerShell 窗口的临时 `$env:` 赋值。凭证不是模型服务商 API key，不要使用 `ANTHROPIC_API_KEY` 等被客户端保护的变量。

运行 **`/atlas_menu`** 打开原生选数面板。它通过 Claude 官方 Mods API 在可信宿主层读取变量和发送 HTTPS 请求，个人凭证不进入模型参数、UI 树、URL、store 或本插件日志。模块没有模型调用、进程启动、环境写入或文件读写操作，但 Mods 本身具备用户级权限，只安装可信发布者的包。

服务端以 Haze 用户＋宿主对话标识绑定独立业务会话。模块拦截本包的 Atlas 工具调用：`create_query_session` 返回该对话已绑定会话，查询工具不能切换其他 `session_id`；失败时拒绝调用，不静默创建全范围。模型调用选数菜单也打开原生面板，不以普通浏览器冒充侧栏。若 Mods 被策略禁用或未加载，不应声称此体验可用，应先修复客户端条件。

面板支持搜索、逐表勾选、保存、失效表提示与清空恢复全部的显式确认。一次展示前50个搜索匹配项，不会因列表裁切或搜索而丢掉其他已选表。关闭/重开恢复服务端保存范围，不需网页登录。

### Eureka：组织插件安装与使用

发行链路是 **Atlas 生成 ZIP → 管理员上传 Haze 插件市场 → 用户在 Eureka 组织扩展安装**。管理员上传后，用户可在已支持组织插件功能和本契约版本的 Eureka 中安装，安装时检查并确认 MCP 服务地址。认证由 Eureka 使用当前登录用户的 Haze 个人凭证在连接层完成，不需要向模型提供密钥。新会话加载已安装插件，已有会话需在空闲时重载。本次只修改 Atlas，不上传或发布；**尚未完成真实安装与查询联调**。

下载菜单选择 Eureka，或由管理员网页登录调用 `/api/integrations/plugins/eureka.zip`。ZIP 根目录 `atlas-ask-eureka`，稳定名称 `atlas-ask`；包含 `plugin.json`、`package.json`、`mcp.json`、两个 Skill、规则、图标和 README，无任何 JS 扩展、安装脚本、运行依赖、真实凭证或客户端私有文件。

- `package.json.pi.skills=["./skills"]` 供 Pi 发现技能，不写 `pi.mcp`。**Pi 发现两个 Skill 不是组织 Plugin 安装，也不会自动注册 MCP。**
- 组织宿主必须从 `mcp.json` 统一注册名为 `atlas` 的 Streamable HTTP 服务、建立实际工具名映射并去重。
- `plugin.json.extensions.com.eureka` 是 Eureka 专属契约，不是 Agent Plugins 标准认证字段，需使用支持该契约版本的宿主。`schemaVersion=1`；`auth.atlas.provider=haze-personal-credential` 严格对应 `mcpServers.atlas`。
- 宿主用当前登录用户在来源 Haze 的个人凭证，在可信连接层注入 Bearer。必须核验包来源、组织权限、目标 HTTPS 地址与凭证授权关系，禁止仅凭包内 URL/声明向任意地址发送凭证，禁止未授权重定向和跨来源身份混用。插件不读取或保存凭证，也不携带原有 Haze 请求头脚本。
- 宿主必须持久关联当前对话与 Atlas `session_id`，更新/重载后读取并复用，不静默新建 ALL。协议会话不等于宿主对话，Skill 提示不能替代宿主绑定与用户隔离。
- 使用 `open_selection_menu` 打开独立窗口，以实际存在的打开链接能力为准；不支持时明确告知，不承诺 `/atlas_menu`、`$atlas-menu` 或原生侧栏。保存后读取 `get_query_session` 的最新 `scope_revision` 继续原会话。
- 插件本身不保存凭证；现有 Atlas 浏览器选数服务仍会为该对话加密保存已认证的凭证用于持续校验，可在页面“断开授权”。这不是新的工作台登录或 OAuth 续期实现。

完整 JSON、字段映射和安全要求见 [格式与宿主契约](../docs/agent-plugin-format.md)。本次不实现历史版本管理、回滚、自动更新、发布接口或 Eureka 原生面板。

#### Eureka 2.3.0：宿主能力 · 问题澄清

依据 Eureka `docs/clarification.md`，本次仅更新 Eureka 版包：在 `extensions.com.eureka` 合并 `capabilities.requestUserInput=true`，保留 schemaVersion=1、图标和个人凭证认证。Eureka 已支持声明该能力，安装准备及详情显示“宿主能力 · 问题澄清”。Codex、Claude 维持2.2.1版本与原产物内容。

`request_user_input` 是 Eureka 宿主工具，不是 Atlas MCP；不新增同名 MCP、不改 `mcp.json`、不引入 JS/hooks/凭证脚本。能力按实际插件入口或所属 Skill 加载路径、来源 Haze、能力 ID、已加载摘要及会话权限开放，不能只靠安装或普通文字提及插件名获权。日常澄清开关不控制插件声明；完全禁用工具不会被声明自动恢复。

Eureka `atlas-ask` 仅在读过规则、已有业务会话及语义口径后，对会显著影响结果的缺失信息提问。每次1–4题，每题2–4个真实选项，支持单选/多选/自定义/跳过；成功提问后立即等待宿主继续，不重复普通问题、不提前查询、不要求另开浏览器。跳过不是同意默认值，关键口径缺失仍应停止相应查询。工具未提供时退回普通文字，不假装显示卡片。

回答后仍使用原 Atlas `session_id`、`scope_revision` 和选数，必要时从同一会话刷新版本，不新建全范围或清空选择。`atlas-menu` 继续既有目录页面，未改成问答卡片。活动会话须在空闲时显式重载。

Eureka 版独立版本源为 `eureka-plugin.ts`，当前2.3.0；`plugin.json`、`package.json`、`atlas-release.json`、文件名和 Haze 发布版本必须一致。管理员上传时将 Haze 版本填写为2.3.0，本次不修改 Haze、不上传或发布。管理信息中的基础 `version` 仍为 Codex/Claude 的2.2.1，Eureka 下载项另含 `version=2.3.0`，不把其他端误升级。

真实 Atlas 新包仍须验证“入口调用 → 歧义澄清 → 原业务会话继续查询”，并覆盖自定义答案、跳过、无工具时的文字退回和重载不丢选数；离线包或模拟测试不替代真实安装与查询联调。

#### 本地生成正式 Eureka ZIP

使用项目已有 Node/TypeScript、Nest 测试依赖及本地数据库设置，不安装桌面客户端：

```powershell
cd "E:\Eureka Atlas\apps\api"
node node_modules/typescript/bin/tsc -p tsconfig.build.json
cd ..\..
node apps/api/scripts/export-eureka-plugin.cjs --origin https://atlas.paiwo188.com
```

脚本要求显式 `--origin`，默认生产模式，复用 `public-origin.ts` 检查可信 HTTPS 根地址；不接受 localhost、私有 IP、容器名或请求 Host。它只编译 Nest DI 容器，不 init/listen，不启动查询调度；通过现有 `SystemSettingsService` 读取数据库中当前生效问数规则，再走同一 ZIP 生成器及泄露检查。数据库不可达或规则包含疑似凭证时失败，不静默替换默认规则。它是本地开发/管理操作，不取代 HTTP 管理权限。

默认输出在项目内 `artifacts/agent-plugins/`（Git 忽略），文件名沿用版本号与业务修订前12位，并生成 `.zip.sha256` 侧车文件。控制台仅打印产物路径、哈希、公开 MCP 地址和开发标记，不打印规则正文或环境变量。可用 `--output <目录>` 改输出位置。

本地 HTTP 测试必须显式声明开发用途：

```powershell
node apps/api/scripts/export-eureka-plugin.cjs --origin http://localhost:3000 --development
```

开发 ZIP 的 README 标注不可作为正式市场发行包，release 含 `development_only=true`，仅用于对应测试环境。localhost 指向 Eureka 服务端所在环境，不一定是用户浏览器所在机器。不要把它上传正式市场。正式包仍应人工核对公开域名、规则和 ZIP SHA-256 后由管理员上传；此脚本不进行 Haze/Eureka 网络操作。

#### 规则修订与 ZIP 校验

`rules_version` 只覆盖共享查询业务 Skill、菜单规则和当前规则快照，不覆盖宿主适配、包版本、域名、图标、生成时间。它跨三端相同，用于过期规则检查，不是 ZIP 文件哈希。宿主适配改变通过对应客户端版本发布：Codex/Claude保持2.2.1，Eureka宿主澄清适配独立为2.3.0。共享业务规则及其哈希未因 Eureka 宿主能力改变，不额外增加宿主摘要。

`X-Atlas-Archive-SHA256` 和本地 `.zip.sha256` 文件是实际 ZIP 字节的 SHA-256。生成时间不同可使 ZIP 哈希不同，但不应改变规则修订；ZIP 不内嵌自己的最终校验和。不要把文件名中的12位规则摘要当作文件校验和。

#### 部署与验收清单

- 本次只需构建并部署 API/Web，更新三端所用插件；新增 Eureka 产物不增加数据库迁移。原有迁移如尚未应用，仍按下节维护窗口流程处理。
- 已有 Codex 使用反馈不等于 Eureka 验收。自动化可验证结构、权限、Schema、业务内容共享和宿主声明，不能模拟宣称真实安装已成功。
- 使用已支持组织插件功能和本契约版本的 Eureka，由授权管理员实际上传 Haze，核验市场文件哈希，再由组织用户安装、启用、禁用/卸载并验证唯一 MCP 注册。
- 真实联调必须覆盖正确来源用户的 Bearer 注入、恶意目标地址/未知声明/未授权重定向拒绝、跨用户隔离、凭证重置/停用与 Haze 故障、对话恢复及版本冲突。
- 使用明确授权的测试表/日期验证选数保存后查询、结果来源/精度/截断、取消任务。实际 MaxCompute 查询可能收费；本次没有执行。

## 十个 MCP 工具

- 对话：`create_query_session`、`get_query_session`、`open_selection_menu`。
- 查数：`search_semantic_assets`、`get_semantic_package`、`get_dimension_values`、`query_data`。
- 任务：`get_query_status`、`get_query_result`、`cancel_query`。

插件管理页的工具清单直接读取实际定义。菜单参数只有当前业务会话标识，不接受个人凭证或用户编号。凭证从已验证的 HTTP 连接层传给服务端，不输出到工具参数/结果。

仍使用官方 SDK 的无状态 Streamable HTTP，仅 POST；初始化不创建传输会话 ID，不支持旧 SSE 入口。业务会话与传输连接无关，断线不丢选表、不自动取消任务。

## 选数范围、并发与任务

- 新对话默认 ALL：动态的全部已发布可查询表，未来新发布表也会包含。
- SELECTED：只包含明确选择的表，不自动加入新表。无效/撤下表、损坏或空的 SELECTED 阻止新查询，不能变成 ALL。
- 清空并确认才恢复 ALL。页面勾选未保存不会修改服务端范围。
- 保存使用 `expected_revision` 乐观锁；冲突409后读取并确认，不自动覆盖。
- 搜索、Package 和新查询均由服务器检查范围与版本，不只依赖 Skill。查询仍是单表，不接受任意 SQL。
- 准入事务锁定范围行，保存任务会话和范围版本，再提交远程查询。范围修改只影响之后的新提交；旧任务仍可在原业务会话读取/取消，不能冒认其他会话或普通 REST 任务。
- **选表范围不再按七天失效或自动清理**，跟随对话持久保存；查询结果仍从提交时起24小时可读，不代表到期物理删除 JSON。
- MCP、原有 REST 和选数接口共用每用户60次/分钟额度；最多3个未结束语义查询（含网页问数）。建议任务轮询至少3秒，遵守 Retry-After，不为选数页面持续高频心跳。
- 查询上限5000行/5MiB，默认100行；候选值最多200/默认50；10分钟执行超时、10秒上游请求超时。实际查询可能产生 MaxCompute 费用。
- 共享个人凭证仍共享 Haze 身份、任务和额度，不能当作多个独立最终用户。

## 网页入口与认证边界

- 插件免登录窗口：`/integrations/plugins/agent-selector/:viewId`。HTML 外壳无需工作台登录，但所有数据请求都需独立授权，单有 viewId 或业务会话 ID 不能读取数据。
- 数据接口：`/api/integrations/selection-browser/:viewId`，启动交换 `/exchange`；不接受工作台 Cookie 或个人 Bearer 作为替代，且独立401不会清除工作台登录。
- 原生面板接口：`/api/integrations/selection-native/open`、`/:sessionId`，只接受实时个人 Bearer，不使用网页登录 Cookie，不接受客户端指定用户身份。
- 原 `/integrations/plugins/data-selector` 保留为人工管理入口，使用同账号网页登录；不作为插件免登录入口或原生面板的兜底。包内旧 `select-data.html` 已移除。
- 选数页面不显示工作台侧栏和导航。原 API 管理页 `/integrations/api` 和 REST 文档路径不变。

## 数据库与部署

新增迁移：`20261014100000_agent_selection_access`，在已有 `20261013120000_agent_query_sessions` 上增加：

- 删除业务会话 `expiresAt` 与清理逻辑，保留原会话 ID、选表、revision、原任务归属。
- 增加可空 `clientConversationId` 以及 `[ownerMemberNo, clientConversationId]` 唯一约束。旧会话不补造宿主标识。
- `agent_selection_access` 每个会话最多一条，保存加密个人凭证、摘要、一次性启动码哈希/截止时间和授权 epoch；启动码原文不入库。作用仅为当前选数，不颁发工作台登录。
- 浏览器模式的加密凭证会保留到主动撤销或业务会话被明确删除；不是页面关闭即删除。备份也需保护。不要轮换/丢失现有 `DATA_SOURCE_ENCRYPTION_KEY`，除非同步重加密已有数据源、登录和选数凭证。

先备份、核对迁移历史并等待活动任务完成，停止旧 API 后应用实际缺失迁移、生成 Prisma Client、构建并重启 API/Web。此迁移删除旧列，不能让旧 API 持续处理请求并读取被删列。不要 reset、db push、删除卷或盲目重放已存在 SQL；历史不一致时核对后使用 Prisma 官方 resolve 登记。

Windows API 可能锁住 Prisma DLL，应在维护窗口停止对应进程后正式生成，不覆盖/删除使用中的 DLL。本次开发环境曾遇到该锁；仅构建前端或编译 dist 不代表运行进程已更新。Docker沿用既有构建和迁移服务，新模块由 TypeScript 生成器内嵌，不依赖本机临时文件。

继续单 API 实例，本次不提高容量、不宣称进程内限流或调度已支持多副本。

## 公开域名与代理

`WEB_ORIGIN` 第一个地址用于生成 MCP、启动链接及原生模块地址；生产须为可信 HTTPS 根域名，不能读不可信 Host 自动拼接。例：`WEB_ORIGIN=https://atlas.paiwo188.com`，MCP 即 `https://atlas.paiwo188.com/api/mcp`。本次检查到本机 `.env.docker` 已如此配置；服务器仍需实际使用该环境并重启。

API 调试请求同源，复制调用示例使用浏览器域名；`API_ORIGIN=http://api:3001` 只是容器内部代理。更换域名后需更新插件并重开客户端，旧 ZIP 不会自动改写地址。

代理必须保留 Authorization、Accept、Content-Type、MCP-Protocol-Version、Set-Cookie 和真实状态；不缓存鉴权/选数/下载。不记录请求体、Authorization、Cookie、启动码或完整工具结果。不向任意网页开放 CORS；桌面原生请求不需要放宽来源检查。

## 验证与边界

本次 Eureka 2.3.0 澄清能力设置已通过10项针对性后端测试和 API 编译/类型检查，覆盖声明合并、问答示例、停止等待/跳过/无工具退回、三端版本与内容隔离、下载权限及规则/ZIP 哈希边界。实际导出的11文件 ZIP 已核对能力为 true、三份版本一致、无同名 MCP、README 验收声明及侧车 SHA-256；与2.2.1实际包比较，atlas-menu 和共享规则文件完全一致。本次未调用宿主澄清工具，也未修改 Eureka/Haze、上传发布或执行真实查询；“入口调用 → 歧义澄清 → 原业务会话继续查询”尚待真实验收。

2.2.1 宿主说明修订已通过8项针对性后端测试（含三端打包、下载权限、过期规则、泄露拒绝、宿主文本与哈希边界）、10项前端集成中心测试，以及 API/Web TypeScript 检查。实际重新导出的 ZIP 已核验11个文件、README 与两个 Skill 均使用生成源的新文本、验收声明保留及侧车 SHA-256；业务规则修订与2.2.0相同。此前2.2.0已通过原 Claude 模块和 MCP 回归，并用本机现有 Pi 的 `loadSkillsFromDir` 离线识别两个技能且无诊断。本次没有安装插件、访问 Haze 或执行真实数据查询；尚未完成真实安装与查询联调。

自动测试使用真实 Nest 路由、SDK 和密码学，但模拟 Haze/MaxCompute，不等于真实账号/真实仓库验收。官方 Claude Code 2.1.303 `plugin validate` 与无登录/无网络的 Mods 测试可验证模块扫描、原生 desktop UI 树及隔离钩子，但不能替代实际桌面应用绘制和组织策略验证。

真实验收仍需安装对应 ZIP 到 Codex Desktop 与 Claude Desktop Code 模式，提供授权测试账号、表和日期范围，覆盖：当前对话菜单、保存后查询、跨账号/跨会话拒绝、重开恢复、清空确认、并发版本冲突、密钥重置/停用、Haze故障重试及取消任务。缺少真实客户端或授权条件时明确保留未完成，不用模拟结果代替，也不复用此前暴露的凭证。
