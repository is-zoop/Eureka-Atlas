export type PluginClient = "codex" | "claude" | "eureka";

// Host operations only. Business rules live in plugin-skill.ts and menu-skill.ts.
export const PLUGIN_HOSTS: Record<
  PluginClient,
  { label: string; install: string; selection: string }
> = {
  codex: {
    label: "OpenAI Codex",
    install:
      "仅支持具备 Agent Plugins 1.0 插件能力的 Codex CLI/桌面端，不支持 Codex IDE 插件界面。按当前版本的 portable 插件导入/市场安装流程加载 atlas-ask-codex 解压根目录。在连接设置选择 API-key/Bearer 并输入本人 Haze 个人凭证，不写入任何包文件。是否支持本地 ZIP/目录导入由客户端版本决定；需要团队市场登记时使用客户端官方流程，不把 ZIP 当市场清单。",
    selection:
      "Codex 从技能列表选择「Atlas数据目录」（支持时使用 $atlas-menu），「Atlas数据助手」支持 $atlas-ask 显式调用。调用 open_selection_menu，传当前对话已有 session_id，由客户端实际支持的打开链接能力打开 browser_url 独立窗口；这是独立窗口，不是原生侧栏，不承诺 /atlas_menu 原生命令。不能打开时明确告知用户，并用宿主支持的方式提供本次启动入口，不能编造打开成功。认证由已配置的 MCP 连接提供，不读取客户端密钥库。",
  },
  claude: {
    label: "Claude Code",
    install:
      "使用 Claude Code 支持的本地插件目录加载/安装流程选择 atlas-ask-claude 解压根目录，或由团队登记为插件来源。启动前设置本机自定义环境变量 ATLAS_PERSONAL_CREDENTIAL，然后重启/重新连接 MCP，不把凭证写入共享文件。原生入口为 .claude-plugin/plugin.json 和 .mcp.json；用 claude plugin validate 检查配置。",
    selection:
      "Claude Desktop Code 模式使用 /atlas_menu 原生选数面板，要求内置 Claude Code 2.1.303 或以上、非 WSL 会话且组织允许 Mods。模块在可信宿主层读取与 .mcp.json 共用的 ATLAS_PERSONAL_CREDENTIAL，不把它放入模型、UI、store 或 URL。服务端绑定当前宿主对话，不能切换其他 session_id；模块拦截本包工具调用并在异常时拒绝执行。不能用普通浏览器冒充原生侧栏；面板不可用时说明版本或组织策略限制。模块具备环境读取和网络权限，仅安装可信来源。",
  },
  eureka: {
    label: "Eureka",
    install:
      "管理员将本包上传 Haze 插件市场后，用户可在已支持组织插件功能的 Eureka 中安装。安装时检查并确认 MCP 服务地址；认证由 Eureka 使用当前登录用户的 Haze 个人凭证在连接层完成，不需要向模型提供密钥。新会话加载已安装插件，已有会话需在空闲时重载。开发测试包仅用于对应测试环境，localhost 指向 Eureka 服务端所在环境。",
    selection: `使用 Eureka 实际提供的工具定义和名称映射，不猜测工具前缀。Atlas MCP 未加载或认证失败时，说明具体问题并停止调用，不自行读取密钥或构造凭证。

打开数据目录时，复用当前对话已记录的 Atlas session_id，调用 open_selection_menu。使用宿主实际支持的打开链接能力打开返回的 browser_url；无法打开时明确告知用户，并按宿主支持的方式提供本次入口，不假装已打开，不承诺原生侧栏或快捷命令。启动链接仅限当前对话，不转发或反复展示。

用户保存后调用 get_query_session，读取最新 scope_revision 后继续原对话。重载或更新后仍复用已有业务会话；标识丢失或范围失效时告知用户恢复或重新选择，不能静默新建全范围会话。凭证始终由 Eureka 连接层处理，不进入模型参数、Skill、URL 或输出。`,
  },
};
