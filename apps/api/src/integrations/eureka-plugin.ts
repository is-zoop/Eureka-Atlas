// Eureka-only host capability adaptation; Codex/Claude keep their existing version and content.
export const EUREKA_PLUGIN_VERSION = "2.3.0";
export const EUREKA_CAPABILITIES = { requestUserInput: true } as const;

export const EUREKA_ASK_CLARIFICATION = `
## Eureka 宿主能力 · 问题澄清

- Eureka 已支持通过 extensions.com.eureka.capabilities.requestUserInput 声明问题澄清能力。本包声明为 true，但仅声明不授予额外工具权限；插件须通过实际插件入口调用或所属 Skill 加载，由宿主检查来源、能力 ID、已加载包摘要、身份及启用状态。仅安装插件或在普通文字中提到插件名，不代表本轮获得此能力。完全禁用工具时不得通过声明自动恢复工具。
- 常规设置中的日常“问题澄清”开关不控制本插件声明的能力；以宿主实际向本轮提供的工具及权限为准，不因日常开关关闭就假定插件能力关闭，也不因声明就绕过禁用工具。
- 先读取适用规则、当前对话已有的 Atlas session_id、scope_revision 和选数状态，再依据已获语义 Package 理解口径。优先利用已有上下文；只有时间范围、指标定义、店铺范围或分析维度缺失，且会显著改变结果时才提问。不要每次查询都提问；不编造指标、店铺、真实业务选项或用户已确认的口径。
- 当宿主实际提供 request_user_input 时，调用该宿主工具。它不是 Atlas MCP 工具，不在 mcp.json 注册，不与网页 request_clarification 混用，不猜测或改用带 MCP 前缀的同名工具。每次提交 1–4 个问题，每题给出 2–4 个真实可用选项；互斥口径使用 selection: single，可合并选项使用 selection: multiple。用户也可自定义回答或跳过。
- request_user_input 提问成功后，本轮立即停止并等待宿主在用户回答后继续。不要再输出一组普通文字问题，不继续调用查询工具，不要求用户另开浏览器回答。继续失败时由宿主提供显式重试；不要自行重复提交可能已经执行的远端查询。
- 跳过不构成业务口径确认，不能解释为同意默认值。关键口径仍缺失时说明限制并停止相应查询，不编造答案，也不反复逼迫用户回答同一问题。
- 回答后继续原任务，复用原 Atlas session_id、已记录的 scope_revision 及选数状态。不得仅因澄清新建业务会话或清空选数；若等待期间范围确有变化，通过同一 session_id 的 get_query_session 读取最新 scope_revision，而不是回退全部范围。沿用原任务幂等与结果验证规则。
- atlas-menu 继续使用既有数据目录页面和 open_selection_menu 流程；选表不改成问答卡片。澄清工具未提供、被关闭或不在本轮权限内时，退回普通文字询问必要信息，不声称已展示卡片，不读取宿主凭证或尝试绕过权限。

以下是仅在时间范围缺失且确实需要确认时的 request_user_input 参数示例，不是每次必问模板；日期按运行时当前日期与业务时区计算，不固定业务日期、会话或账号：

\`\`\`json
{
  "questions": [{
    "title": "时间范围",
    "question": "本次流量分析使用哪个时间范围？",
    "selection": "single",
    "options": [
      { "id": "yesterday", "label": "昨天", "description": "查询上一完整自然日" },
      { "id": "last_7_days", "label": "最近 7 天", "description": "查询过去七个完整自然日" }
    ]
  }]
}
\`\`\`
`;
