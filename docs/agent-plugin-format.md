# Atlas数据助手插件：三端包与 Eureka 宿主能力

## 产物与共享源

管理员从 `/integrations/plugins` 获取以下 ZIP，稳定插件名称均为 `atlas-ask`：

| client | 当前版本 | 下载 | ZIP 根目录 |
| --- | --- | --- | --- |
| codex | 2.2.1 | `/api/integrations/plugins/codex.zip` | `atlas-ask-codex/` |
| claude | 2.2.1 | `/api/integrations/plugins/claude.zip` | `atlas-ask-claude/` |
| eureka | 2.3.0 | `/api/integrations/plugins/eureka.zip` | `atlas-ask-eureka/` |

下载仍需 ADMIN / SYSTEM_ADMIN 的网页登录权限，附 `rules_version` 可拒绝过期规则快照（409）。正文泄露检查在所有端执行。MCP 的使用权限仍与管理权限分开，四种有效角色可用本人的个人凭证访问，不放宽原 REST。

`plugin-skill.ts` 和 `menu-skill.ts` 是共享业务内容；`plugin-host.ts` 只包含各宿主的安装、认证和界面操作说明。三端都用同一生效问数配置及强制规则生成 `references/current-rules.md`，并复用实际 MCP 工具定义及图标。不是复制三套长期独立维护的查询规则，也不是将 Codex 字样替换成 Eureka。

### Eureka 精确布局

```text
atlas-ask-eureka/
  plugin.json
  package.json
  mcp.json
  skills/
    atlas-ask/SKILL.md
    atlas-menu/SKILL.md
  references/current-rules.md
  assets/atlas.png
  assets/atlas.svg
  assets/LUCIDE-LICENSE.txt
  atlas-release.json
  README.md
```

不含 Codex `agents/openai.yaml`、Claude hooks/Mods、JS 扩展、安装脚本、运行依赖、真实凭证、账号数据、固定业务会话、node_modules 或本地绝对路径。两个 Skill 用相对于技能目录的 `../../references/current-rules.md` 引用规则，宿主必须保留整个包，不能只复制 Skill 文件。

Codex 继续提供 Agent Plugins 1.0 `plugin.json`、`mcp.json`，以及每个技能的 `agents/openai.yaml` 和自包含图标；Claude 继续提供 `.claude-plugin/plugin.json`、`.mcp.json` 和原生 Mods 模块。Codex 专属 `extensions.com.openai.auth` 只在 Codex MCP 配置中，不能复制进 Eureka 服务器对象。

## Eureka 清单与加载契约

**发行链路：Atlas 生成 ZIP → 管理员上传 Haze 插件市场 → 用户在 Eureka 组织扩展安装。** 管理员上传后，用户可在已支持组织插件功能和本契约版本的 Eureka 中安装，安装时检查并确认 MCP 服务地址。新会话加载已安装插件，已有会话需在空闲时重载。本次未上传或发布，**尚未完成真实安装与查询联调**；不以离线包校验代替真实验收。

### plugin.json

以 Agent Plugins 1.0 基础格式生成；`name`、`description`、`author` 与 Codex/Claude 同源。版本按端发行：Codex/Claude 仍为2.2.1，Eureka 独立提升为2.3.0，其生成源为 `eureka-plugin.ts`；Eureka `plugin.json`、`package.json` 和 release 的版本一致。额外声明：

```json
{
  "extensions": {
    "com.eureka": {
      "schemaVersion": 1,
      "displayName": "Atlas数据助手",
      "icon": "./assets/atlas.png",
      "auth": {
        "atlas": { "provider": "haze-personal-credential" }
      },
      "capabilities": {
        "requestUserInput": true
      }
    }
  }
}
```

`com.eureka` 是 **Eureka 专属扩展契约**，不是 Agent Plugins 标准已定义的认证字段。通过基础 Schema 校验只证明基础结构成立，不证明 Eureka 会识别扩展。

### package.json

```json
{
  "name": "atlas-ask",
  "version": "2.3.0",
  "description": "使用正式语义、会话选表和远程MCP完成中文业务问数。",
  "keywords": ["pi-package"],
  "pi": { "skills": ["./skills"] }
}
```

版本以 Eureka 独立生成源为准，与该端 `plugin.json` 相同；在 Haze 发布时也必须填写2.3.0，不修改其他端版本。Eureka 当前使用的 Pi 包管理器可据此读取身份及发现两个技能，但 **Pi 技能发现不等于组织 Plugin 安装**。不配置 `pi.mcp`，不捆绑 MCP adapter 或凭证读取脚本；支持本契约的 Eureka 组织插件宿主必须从 `mcp.json` 统一注册服务，避免与通用 Pi 发现路径重复注册。

### mcp.json

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  "mcpServers": {
    "atlas": {
      "type": "streamable-http",
      "url": "https://atlas.paiwo188.com/api/mcp"
    }
  }
}
```

示例域名仅说明结构；实际地址使用 `public-origin.ts` 从可信 `WEB_ORIGIN` 生成，不从请求 Host 拼接。没有 Authorization 值、假占位凭证或 OpenAI 专属认证扩展。

### 宿主必须实现的安全边界

1. 管理员审核来自 Haze 市场的包，安全解压并保持根目录；验证包身份、版本、清单 schemaVersion、图标/技能引用范围，以及组织授权和启用状态。
2. `com.eureka.auth` 的 `atlas` 键严格对应 `mcpServers.atlas`。未知 provider、未知服务或不匹配映射拒绝处理，不能静默改用其他账号/来源。
3. 宿主使用当前登录用户在**来源 Haze** 的个人凭证，在可信连接层注入 Bearer。须校验目标 HTTPS 地址、可信市场来源/组织配置与凭证授权关系；包内容是待审核输入，**仅凭包内声明不能授权向任意地址发送 Haze 凭证**。授权不是“任何 HTTPS 都可信”，也不能仅靠字符串匹配；防止未授权重定向、跨来源凭证混用。
4. 插件只声明需求，不获取/保存凭证。宿主不能把原始凭证写进模型参数、Skill、URL、工具结果、日志、包内文件或前端存储；凭证缺失或刷新失败应停止，不能让模型读本机密钥库或向用户索要粘贴凭证。宿主需处理其自身 Haze 登录状态、凭证重置/停用及每用户连接隔离。
5. 组织宿主负责 MCP 注册去重、实际工具名映射及禁用/卸载后的连接解绑。协议服务名为 `atlas`，Skill 用协议工具名，不能猜测 adapter 实际注册前缀。卸载不能自动取消已提交查询。
6. 持久关联当前宿主对话与 Atlas `session_id`；已有 ID 必须复用。更新/重载不能默默创建全范围会话，ID 丢失或范围失效应请求用户恢复。当前包不包含自动对话绑定 JS 扩展，也不声称提示词本身提供宿主级强制绑定。

Atlas 不捆绑或复制 Eureka 的 adapter 或 Haze 凭证读取代码，也不修改 Eureka/Haze 或读取其私有登录文件。以 Eureka 实际提供的工具定义和名称映射为准，不猜测前缀；Atlas MCP 未加载或认证失败时说明问题并停止，不自行读取密钥或构造凭证。安装、认证与对话恢复须经真实联调验证，不能以包内声明或静态检查代替。

## Eureka 宿主能力 · 问题澄清

本次按 Eureka `docs/clarification.md` 适配，仅修改 Eureka 版产物。`extensions.com.eureka.capabilities.requestUserInput=true` 与现有 schemaVersion=1、图标、认证配置合并。Eureka 已支持声明该能力；安装准备及详情展示“宿主能力 · 问题澄清”，但声明不是额外权限或实际验收。

- 唯一工具是宿主 `request_user_input`，不在 `mcp.json` 注册、不新增 Atlas MCP 工具、JS、hooks 或凭证脚本。宿主按实际插件入口/所属 Skill 路径及来源、能力 ID、已加载包摘要、登录身份、启用状态与会话工具权限开放能力；不能凭普通文本中的插件名称获权。
- 日常澄清开关仅控制日常对话，不控制插件声明；仅安装但未通过入口调用不会开放日常澄清。完全禁用工具不会因声明而恢复。
- Eureka `atlas-ask` 先读规则、已有 Atlas 会话与选数和语义 Package。仅当时间、指标、店铺或分析维度确实缺失且会显著改变结果时才提问，不每次必问、不编造选项。每次1–4题、每题2–4个真实选项，可单选、多选、自定义或跳过。
- 提问成功立即停止本轮，等待宿主收到答案后继续；不重复输出普通问题、不提前调用查询、不要求另开浏览器。关键口径被跳过仍不算确认，不能擅用默认值。
- 回答后复用原 `session_id`、`scope_revision` 和选数。必要时从同一业务会话刷新版本，不新建 ALL，不重置选择；不自行重发可能已执行的远端查询。工具未提供时才退回普通文字询问，不声称显示了卡片。
- `atlas-menu` 的正文和选数流程保持原样，不改成问答卡片。Codex/Claude 产物继续原版本与行为，不加入该 Eureka 能力。
- 发布后更新组织安装；活动会话须在空闲时显式重载，不能仅换 ZIP 而沿用旧加载快照。Haze 发布版本需与2.3.0清单一致，本次不上传或发布。

“入口调用 → 歧义澄清 → 原业务会话继续查询”尚未完成真实联调；离线包校验和模拟测试不等同于实际 Atlas 新包验收。

## 选数、业务范围与认证

- Eureka 仅使用已有 `open_selection_menu` 独立窗口流程；不承诺已有 `/atlas_menu`、`$atlas-menu` 或原生选数侧栏。使用宿主实际提供的打开链接能力，不支持则明确告知用户，不能假装打开。
- 菜单传入当前业务 `session_id`，保存后读取 `get_query_session` 的新 `scope_revision` 继续原对话。失效/空 SELECTED 阻止新查询，不回退为 ALL；清空并确认才恢复 ALL。
- Codex 保持“Atlas数据目录”（`$atlas-menu`）和“Atlas数据助手”（`$atlas-ask`）入口；Claude 的 `/atlas_menu` 仍由原有 Mods 注册，不属于 Eureka 功能。
- 共享查询顺序、Package 校验、结果精度/截断验证、任务归属及显式取消规则不变。身份/对话隔离不是完整的数据表或行授权；本次没有新增数据权限系统。
- 独立窗口不依赖 Atlas 工作台登录，不改变工作台 Cookie。长期个人凭证不在链接中；启动链接包含五分钟一次性选数授权，仍不可转发或记录。片段由页面立即清除；宿主可能保存工具结果，不承诺链接从未进入客户端记录。
- **插件不保存凭证，不等于 Atlas 独立选数服务器不保存。** 沿用现有实现：服务器为当前对话加密保存个人凭证，每次选数实时校验 Haze；专用 HttpOnly/SameSite=Strict Cookie 仅允许该对话选数，生产还启用 Secure。主动断开授权会清除加密凭证、撤销窗口授权，保留选表与任务。
- 已打开窗口不随启动码到期退出，Cookie 滚动续期一年；个人凭证失效/账号停用/撤销后拒绝访问。选数范围不按七天清理；查询结果仍从提交起24小时可读，本次未增加物理结果清理。

## 地址、修订和文件校验

- 正式环境必须显式配置可信 HTTPS 根域名。`public-origin.ts` 拒绝生产模式的 localhost、私有/回环/链路本地 IP、单段容器名及明确内部域后缀；配置检查不替代宿主的来源/授权校验。
- 非生产生成的 ZIP 在 README 标注仅供开发，`atlas-release.json.development_only=true`；本地 HTTP 仅允许 loopback。开发测试包仅用于对应测试环境，localhost 指向 Eureka 服务端所在环境，不一定是用户浏览器所在机器。正式本地导出脚本默认生产模式且要求显式 `--origin`。
- `rules_version` = SHA-256(共享查询 Skill 业务正文、共享菜单规则、当前生效配置及强制规则快照)。不含宿主说明、插件版本、地址、图标或生成时间；三端同一业务规则的哈希相同。宿主说明或包格式变化使用对应客户端的新版本号发布，不把生成时间当内容修订。
- 下载文件名沿用 `atlas-ask-<client>-<version>-<rules_version前12位>.zip`。`atlas-release.json` 保留 client、version、rules_version、generated_at、mcp_url，并标注开发用途。
- `X-Atlas-Archive-SHA256` 校验实际 ZIP 全部字节，本地导出同时生成同名 `.zip.sha256` 文件。ZIP 包含生成时间，重复生成时文件哈希可能不同；规则哈希不是 ZIP 校验和，ZIP 也不能包含自身最终校验和。
- 不新增历史版本数据库、历史包下载、回滚、自动更新或发布接口。

## 验证边界与参考

项目已有 SDK/Ajv 基础 Schema 测试、ZIP 精确文件清单测试、认证映射/技能引用/泄露检查、权限与陈旧快照 HTTP 测试涵盖三端。离线通过不等于管理员已上传 Haze，也不代表已经通过 Eureka 真实安装、认证或查询验证；尚未完成真实安装与查询联调。

依据：Agent Plugins 1.0 的 plugin/mcp Schema；Eureka 安装依赖中的 Pi `docs/packages.md`（`pi.skills`）、`docs/skills.md`（递归技能发现与相对引用）；Codex 和 Claude 原有清单依据保持不变。部署及待完成联调见 [部署说明](../deploy/agent-plugin.md)。
