import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { zipSync, strToU8 } from "fflate";
import { createHash } from "node:crypto";
import { SystemSettingsService } from "../system-settings/system-settings.service";
import { buildPluginSkill, buildSkillSnapshot } from "./plugin-skill";
import { PLUGIN_HOSTS } from "./plugin-host";
import { EUREKA_CAPABILITIES, EUREKA_COMPOSER, EUREKA_PLUGIN_VERSION } from "./eureka-plugin";
import { integrationOrigin, selectorUrl } from "./public-origin";
import { buildMenuSkill } from "./menu-skill";
import { claudeMenuModule } from "./claude-menu-module";
import { McpToolsService } from "./mcp-tools.service";
import {
  ATLAS_ICON_LICENSE,
  ATLAS_ICON_PNG,
  ATLAS_ICON_SVG,
} from "./plugin-assets";

@Injectable()
export class PluginPackageService {
  constructor(
    private readonly settings: SystemSettingsService,
    private readonly tools: McpToolsService,
  ) {}
  private async snapshot() {
    const setting = await this.settings.askPrompt();
    if (
      /haze_[A-Za-z0-9_-]{16,}|Bearer\s+(?!\$\{|<|YOUR_)[A-Za-z0-9_-]{24,}/i.test(
        setting.prompt,
      )
    )
      throw new BadRequestException(
        "当前问数配置疑似包含真实凭证，请先移除后再导出插件。",
      );
    return {
      ...buildSkillSnapshot(setting.prompt, setting.customized),
      customized: setting.customized,
      origin: integrationOrigin(),
    };
  }
  async info() {
    const s = await this.snapshot();
    return {
      name: "atlas-ask",
      title: "Atlas数据助手",
      version: s.version,
      rules_version: s.rulesVersion,
      customized: s.customized,
      mcp_url: s.origin + "/api/mcp",
      selector_url: selectorUrl(),
      downloads: [
        {
          client: "codex",
          label: "OpenAI Codex",
          download_url:
            "/api/integrations/plugins/codex.zip?rules_version=" +
            s.rulesVersion,
        },
        {
          client: "claude",
          label: "Claude Code",
          download_url:
            "/api/integrations/plugins/claude.zip?rules_version=" +
            s.rulesVersion,
        },
        {
          client: "eureka",
          label: "Eureka",
          version: EUREKA_PLUGIN_VERSION,
          download_url:
            "/api/integrations/plugins/eureka.zip?rules_version=" +
            s.rulesVersion,
        },
      ],
      tools: (await this.tools.definitions()).map(({ name, description }) => ({
        name,
        description,
      })),
      selection_modes: {
        codex: "authenticated-browser",
        claude: "native-mod-pane",
        eureka: "authenticated-browser",
      },
      claude_code_min_version: "2.1.303",
    };
  }
  async archive(client: string, expected?: string) {
    if (client !== "codex" && client !== "claude" && client !== "eureka")
      throw new NotFoundException("不支持的插件客户端。");
    const s = await this.snapshot();
    if (expected && expected !== s.rulesVersion)
      throw new ConflictException("问数规则已更新，请刷新插件信息后重新下载。");
    const { label, install, selection } = PLUGIN_HOSTS[client];
    const version = client === "eureka" ? EUREKA_PLUGIN_VERSION : s.version;
    const developmentOnly = process.env.NODE_ENV !== "production";
    const identity = {
      name: "atlas-ask",
      version,
      description: "使用正式语义、会话选表和远程MCP完成中文业务问数。",
      author: { name: "Eureka Atlas" },
    };
    const files: Record<string, string | Uint8Array> = {
      "skills/atlas-ask/SKILL.md": buildPluginSkill(client),
      "references/current-rules.md": s.rules,
      "skills/atlas-menu/SKILL.md": buildMenuSkill(client),
      "atlas-release.json": JSON.stringify(
        {
          client,
          version,
          rules_version: s.rulesVersion,
          generated_at: new Date().toISOString(),
          mcp_url: s.origin + "/api/mcp",
          development_only: developmentOnly,
        },
        null,
        2,
      ),
      "assets/atlas.svg": ATLAS_ICON_SVG,
      "assets/atlas.png": ATLAS_ICON_PNG,
      "assets/LUCIDE-LICENSE.txt": ATLAS_ICON_LICENSE,
      "README.md": `# Atlas数据助手 · ${label} 插件 ${version}

本包仅用于 ${label}，包含该客户端清单、问数及菜单 Skill、当前规则快照。
${developmentOnly ? "\n**仅供开发测试：此包由非生产环境生成，不可作为正式市场发行包。**\n" : ""}

## 安装与认证

${install}

## 连接与选数

远程 MCP：${s.origin}/api/mcp

${selection}

${
  client === "eureka"
    ? `## Eureka 宿主接入契约

plugin.json 的 extensions.com.eureka 是 Eureka 专属扩展，不是 Agent Plugins 标准字段。请使用支持本契约版本及组织插件功能的 Eureka，并在安装时检查、确认 MCP 服务地址。schemaVersion 为 1；auth.atlas 对应 mcp.json 的 mcpServers.atlas，provider 为 haze-personal-credential。宿主需验证清单版本、映射、可信来源 Haze、服务端授权关系及目标 HTTPS 地址，再按当前登录用户在可信连接层注入 Bearer。拒绝未知 provider、未知服务、任意包内目标地址及跨来源凭证混用；禁止带凭证跟随未授权重定向，不向模型、日志、URL、包文件或前端暴露凭证。

package.json 的 pi.skills 指向 ./skills；不声明 pi.mcp。组织插件宿主负责一次性注册 mcp.json 中的服务，并避免与通用 Pi 包发现重复注册。不包含自定义 JS 扩展、运行依赖、安装脚本或凭证读取脚本。仅用通用 Pi 加载技能不会自动连接 MCP，也不能代替 Eureka 组织 Plugin 安装。

宿主须维护组织安装与禁用边界、每用户连接隔离、工具名映射、当前宿主对话与 Atlas session_id 的持久关联。重载或更新不能静默创建新全范围；原范围失效需用户恢复。数据目录使用 open_selection_menu 独立窗口，保存后读取 get_query_session 获取最新 scope_revision；不注册或承诺快捷命令或原生选数面板。MCP 尚未注册或认证未完成时必须明确停止，不使用模型工具自行读取密钥或构造凭证。

## 输入框选用方式

本包声明 extensions.com.eureka.composer.selectionMode=persistent。插件声明选用方式，用户决定是否启用：用户选中后，标签常驻当前对话输入框，后续消息持续使用，直到用户主动移除；未选中或移除后，不得凭历史选择继续使用插件的技能、MCP或宿主能力，仍由宿主核验本轮选择与权限。once 表示仅本条消息使用，发送后清空。本声明不自动选中、安装、查询或启动后台常驻进程，不授予额外权限，也不改变 Atlas 业务会话及选数的持久化方式。

## 宿主能力 · 问题澄清

Eureka 已支持通过 capabilities.requestUserInput 声明问题澄清能力，本包声明为 true。安装准备与详情会显示“宿主能力 · 问题澄清”。这是 Eureka 的 request_user_input 工具，不是 Atlas MCP 工具，不在 mcp.json 注册，也不附加脚本。宿主仍按本轮实际插件入口或所属 Skill 路径、来源 Haze、能力 ID、加载包摘要、登录身份和工具权限决定是否开放。仅安装或在普通文本中提到插件，不代表本轮获权；常规设置中的日常澄清开关不控制插件声明，完全禁用工具也不会被声明自动恢复。

atlas-ask 先读取业务规则、已有会话与语义口径，仅在缺失信息会显著改变结果时提问。提问成功后停止并等待宿主继续，不重复普通文字提问或提前查数；支持自定义答案与跳过，但跳过不等于同意默认值。回答后保留原 Atlas session_id、scope_revision 和选数状态。宿主未提供工具时退回普通文字询问必要信息，不假装展示卡片。atlas-menu 仍走目录页面，选表不改为问答卡片。

Eureka 版独立版本为 ${EUREKA_PLUGIN_VERSION}；plugin.json、package.json、atlas-release.json 及 Haze 发布版本必须一致。管理员上传时将 Haze 版本填写为 ${EUREKA_PLUGIN_VERSION}，更新安装后活动会话需在空闲时显式重载；不自动更新，不因重载丢弃原业务会话。该宿主澄清能力仅适用于 Eureka；三端共享查询、展示与等待规范。

此 ZIP 供管理员手动上传 Haze 插件市场；本次未上传或发布，尚未完成真实安装与查询联调。“入口调用 → 歧义澄清 → 原业务会话继续查询”仍需真实验证，离线包与模拟测试不能代替。离线包校验不替代实际 Eureka 安装、认证与查询验证。本包不提供历史版本管理、回滚或自动更新。
`
    : ""
}

宿主完成接入后的选数流程不要求 Atlas 网页登录，也不覆盖已有工作台登录。原选表失效或会话标识丢失不能静默新建全范围；选数范围跟随对话持久保存，不再七天自动清理，与查询结果24小时有效期不同。范围变更仅影响新查询，旧任务仍属于原会话。

独立窗口的个人凭证只在服务端加密保存；每次选数操作实时通过 Haze 校验，凭证重置或账号停用立即拒绝访问。窗口授权仅限当前选表操作，不能登录管理中心或读取其他对话。使用“断开授权”可清除该对话存储的加密凭证，不删除选表或取消查询；浏览器 Cookie 每次访问滚动续期。

## 查询

全选只表示可检索范围，不是确认来源。对多个合理业务来源，比较用途、来源、粒度及指标口径后仍有歧义时必须让用户选择；明确来源不重复问，无卡片工具用文字询问并等待，不默认合并不同粒度。原子AVG率与派生汇总比值不得仅按名称视为相同指标。选择后保留原业务会话、范围版本和选数，不新增强制服务端确认门禁。

实际成功结果优先使用 presentation 表格，文字用于结论与汇总解释；网页避免重复结果卡片表格的规则不适用于插件。Server-Timing/timings_ms 仅报告 Atlas 内部 auth、scope、packages、submit、wait、result 与 tool 耗时，不含 Eureka 调度、其凭证进程或模型耗时；各项有嵌套关系，不可简单相加。

先检索，再获取Package，再确认必要日期和真实候选值。提交默认短时等待，成功时直接使用 result 和 presentation；未完成沿用任务ID调用 get_query_result 有界等待（wait_ms 默认8000、最大10000，0立即返回），不运行终端 sleep，不重复提交。停止等待不等于取消。原始结果上限5000行/5MiB，默认100行；额外格式化展示最多100行/32768字符，展示截断与原结果截断分别说明。仅按已有unit展示：%乘100，‰乘1000，万元除10000，亿元除100000000，其他万/亿数量单位按对应倍率换算；小数/百分比默认2位，不新增需维护的尺度/精度字段。presentation已经换算，不二次转换；原始结果和SQL公式保持不变。候选值默认50/最多200。每用户每分钟60次请求（包括MCP协议及工具调用）、最多3个未结束语义查询，REST与MCP共用额度，遵守重试提示。实时Haze鉴权，ADMIN/SYSTEM_ADMIN/DEVELOPER/USER均可使用本人个人凭证访问MCP。插件管理页面及下载仍仅ADMIN/SYSTEM_ADMIN可访问；选数授权只允许个人凭证所属用户编辑本人的会话。共享凭证不能隔离不同最终用户。实际查询可能产生MaxCompute费用。

## 更新和卸载

这是当前配置快照，规则修订：${s.rulesVersion}。规则修订只覆盖共享业务 Skill、菜单规则和当前规则快照，不含宿主说明、插件版本、地址、图标或生成时间；它不是 ZIP 文件校验和。下载的 X-Atlas-Archive-SHA256 或本地导出的 .sha256 文件校验实际 ZIP 字节，含清单、宿主说明和生成时间，生成时间不同可能导致 ZIP 哈希变化。${client === "eureka" ? "管理员修改规则后需重新下载并按组织插件流程更新，不自动更新已安装文件。新会话加载已安装插件，已有会话需在空闲时重载，并复用当前对话已有 Atlas session_id。" : "管理员修改规则后需重新下载所用客户端的插件包、按客户端流程更新并开启新会话，不自动更新已安装文件。"}卸载使用客户端原生卸载流程；移除自行配置的凭证。卸载、关闭客户端和选表都不会自动取消远程查询，请先显式取消不需要的任务。

图标几何基于 Lucide (ISC)，许可证见 assets/LUCIDE-LICENSE.txt。
本包未代表公共商店发布，也未代替真实客户端安装与查询验收。
`,
    };
    if (client === "codex") {
      for (const [name, displayName, description, prompt] of [
        [
          "atlas-menu",
          "Atlas数据目录",
          "打开当前对话的数据目录，选择查询数据表，保存后继续原对话。",
          "使用 $atlas-menu 打开当前 Atlas 对话的数据目录。",
        ],
        [
          "atlas-ask",
          "Atlas数据助手",
          "使用正式业务口径检索数据、查询指标并验证结果，支持当前对话数据范围。",
          "使用 $atlas-ask 查询业务数据，遵守当前对话已保存的数据范围。",
        ],
      ]) {
        files[`skills/${name}/agents/openai.yaml`] = `interface:
  display_name: ${JSON.stringify(displayName)}
  short_description: ${JSON.stringify(description)}
  icon_small: "./assets/atlas.png"
  icon_large: "./assets/atlas.svg"
  brand_color: "#0f172a"
  default_prompt: ${JSON.stringify(prompt)}
policy:
  allow_implicit_invocation: true
`;
        files[`skills/${name}/assets/atlas.png`] = ATLAS_ICON_PNG;
        files[`skills/${name}/assets/atlas.svg`] = ATLAS_ICON_SVG;
      }
      files["plugin.json"] = JSON.stringify(
        {
          $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
          ...identity,
          extensions: {
            "com.openai": {
              interface: {
                displayName: "Atlas数据助手",
                shortDescription: "基于正式语义的中文问数",
                longDescription: identity.description,
                developerName: "Eureka Atlas",
                category: "Productivity",
                capabilities: ["Read", "Interactive"],
                logo: "./assets/atlas.png",
                composerIcon: "./assets/atlas.png",
                defaultPrompt:
                  "使用 Atlas 查询业务指标，必要时先让我选择数据范围。",
              },
            },
          },
        },
        null,
        2,
      );
      files["mcp.json"] = JSON.stringify(
        {
          $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
          mcpServers: {
            atlas: {
              type: "streamable-http",
              url: s.origin + "/api/mcp",
              extensions: {
                "com.openai": {
                  auth: { type: "api_key", headerScheme: "bearer" },
                },
              },
            },
          },
        },
        null,
        2,
      );
    } else if (client === "eureka") {
      files["plugin.json"] = JSON.stringify(
        {
          $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
          ...identity,
          extensions: {
            "com.eureka": {
              schemaVersion: 1,
              displayName: "Atlas数据助手",
              icon: "./assets/atlas.png",
              auth: { atlas: { provider: "haze-personal-credential" } },
              composer: EUREKA_COMPOSER,
              capabilities: EUREKA_CAPABILITIES,
            },
          },
        },
        null,
        2,
      );
      files["package.json"] = JSON.stringify(
        {
          name: identity.name,
          version: identity.version,
          description: identity.description,
          keywords: ["pi-package"],
          pi: { skills: ["./skills"] },
        },
        null,
        2,
      );
      files["mcp.json"] = JSON.stringify(
        {
          $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
          mcpServers: {
            atlas: { type: "streamable-http", url: s.origin + "/api/mcp" },
          },
        },
        null,
        2,
      );
    } else {
      files[".claude-plugin/plugin.json"] = JSON.stringify(identity, null, 2);
      files["hooks/hooks.json"] = JSON.stringify(
        { modules: ["./register.js"] },
        null,
        2,
      );
      files["hooks/register.js"] = claudeMenuModule(s.origin);
      files[".mcp.json"] = JSON.stringify(
        {
          mcpServers: {
            atlas: {
              type: "http",
              url: s.origin + "/api/mcp",
              headers: { Authorization: "Bearer ${ATLAS_PERSONAL_CREDENTIAL}" },
            },
          },
        },
        null,
        2,
      );
    }
    const root = "atlas-ask-" + client;
    const zipped: Record<string, Uint8Array> = {};
    for (const [name, content] of Object.entries(files))
      zipped[root + "/" + name] =
        typeof content === "string" ? strToU8(content) : content;
    const buffer = Buffer.from(zipSync(zipped));
    return {
      buffer,
      sha256: createHash("sha256").update(buffer).digest("hex"),
      filename: `${root}-${version}-${s.rulesVersion.slice(0, 12)}.zip`,
      rulesVersion: s.rulesVersion,
    };
  }
}
