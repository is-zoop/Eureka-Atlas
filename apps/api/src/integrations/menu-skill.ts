import { PLUGIN_HOSTS, type PluginClient } from "./plugin-host";

export const MENU_SKILL = `---
name: atlas-menu
description: 打开 Atlas数据目录，选择当前对话的查询数据表，复用已配置个人凭证，不要求网页登录。
---

# Atlas数据目录

- 本技能仅用于当前对话的数据范围。先读取[当前规则快照](../../references/current-rules.md)，遵守共享业务约束；实际入口和认证由下方当前宿主说明决定。
- 先找到当前对话此前使用的 Atlas session_id。有已有 ID 必须复用，不得为了打开菜单创建另一条全范围会话。只有明确的新对话从未创建时才调用 create_query_session。
- 调用 open_selection_menu，参数只有当前 session_id；凭证由 MCP 连接层提供，不读取、打印或要求用户粘贴个人凭证，不读取客户端密钥库。
- 独立窗口流程使用客户端实际支持的打开链接能力打开返回的 browser_url。若无法打开，明确告知用户并按宿主能力提供这一次的启动入口，不编造打开成功，不假装是原生侧栏。
- 启动链接带一次性授权码，不是个人凭证，但也不能转发给他人；不要重复展示完整链接或把它写入代码、日志和归档。引导码到期不影响已打开的选数窗口。
- 用户保存后读取 get_query_session，使用新的 scope_revision 继续原对话。取消选择并确认表示恢复全部已发布可查询表。旧任务不自动取消。
- 浏览器选数授权与工作台网页登录无关，不请求 Cookie 登录、不发送登录 Token。身份失败请用户在可信宿主中检查登录或连接授权后重新打开同一会话；不通过新建会话扩大数据范围。重载或更新不得静默新建全范围会话。
`;

export function buildMenuSkill(client: PluginClient) {
  return (
    MENU_SKILL + "\n## 当前宿主操作\n\n" + PLUGIN_HOSTS[client].selection + "\n"
  );
}
