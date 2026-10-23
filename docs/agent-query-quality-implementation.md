# Agent 问数质量与等待链路：实现及部署

## 当前版本与单位约定

Codex/Claude **2.3.1**，Eureka **2.4.1**。用户已明确：**已有unit就是展示转换规则，不再维护额外精度/尺度配置。** 先前要求维护百分比尺度的设计已移除。

| 正式unit | 展示规则 | 示例 |
| --- | --- | --- |
| % / ％ / 百分比 | 原值×100，默认2位，附百分号 | 0.047278… → 4.73% |
| ‰ / 千分比 | 原值×1000，默认2位 | 0.012345 → 12.35‰ |
| 万元 / 万人 / 万件等 | 原值÷10000，默认2位 | 123456.789 → 12.35万元 |
| 亿元 / 亿数量单位 | 原值÷100000000，默认2位 | 123456789 → 1.23亿元 |
| 百万、千万、十亿等数量级 | 按相应十进制倍率换算 | 百万元÷1000000 |
| 千元、百元 | ÷1000、÷100 | 1234.56元 → 1.23千元 |
| 元、倍、普通单位、未填写 | 不做倍率换算 | 1234.56元 → 1234.56元 |

不根据值域或中文指标名称猜单位，也不把千克/千瓦误当作金额倍率。正式单位标成%就按%转换，不再判断原值是否“已经是百分数”。已转换的presentation不得再次转换。

## 统一展示与原值

共享 `@eureka-atlas/result-format` 使用BigNumber.js处理十进制字符串。小数默认2位，整数类型/COUNT默认0位；换算为万元/百分比等时默认2位。ID、日期、字符串不改写，null显示“—”。DECIMAL计数不从中文名称猜成整数。

- 网页结果表和MCP presentation复用同一格式库。
- 图表轴值与悬停精确值也按unit换算，避免万元标题下画原值。
- 只改显示，不修改SQL、指标公式、原始行、复制/Excel原始数据。
- 治理页面已移除新增的精度输入、尺度下拉、“默认精度”“尺度未确认”说明；字段语义/计算指标保留原单位控件和原有布局。
- 正式数据库、治理输入和Package不再包含displayFormat/display_format。结果列可携带由查询角色和类型自动计算的内部显示提示，用于区分数字指标与数字ID，不是需要维护的配置。

MCP presentation最多100行/32768字符。展示截断不等于原始结果截断，不能把部分展示重新汇总成全量结论。文本通道提供格式化表格及必要结果信息，structuredContent仍保留精确原值。

## 保留的来源选择、会话与等待优化

- 搜索返回真实description、grain、metric_options（原子聚合/派生公式等）和source_resolution。上下文不足以排除多个合理来源时必须让用户选择；明确来源不重复问。不默认跨粒度合并，不按排名第一代替用户确认。
- Eureka使用实际可用的宿主澄清工具；工具未提供则普通文字提问并等待。没有新增服务端来源确认令牌或硬门禁，模型遵守情况仍需实际宿主验收。
- 来源选择只确定query的正式table_id/metric_ids，保留原session_id、scope_revision、选数和已确认条件，不回退ALL。
- query_data/get_dimension_values/get_query_result支持wait_ms=0–10000，默认8000。短任务当前调用直接返回结果；未完成沿用同一任务ID继续get_query_result，不重提任务、不用终端sleep做常规等待。
- REST原异步语义、归属、幂等、取消、10分钟执行超时、24小时结果期、共享限流和实时Haze鉴权保持不变。
- 目录轻量读取，范围校验不逐表构建Package；搜索加载一次所需Package。没有加身份/权限TTL缓存，不盲用持久化旧Package。
- Server-Timing/structuredContent.timings_ms只报告Atlas内部auth/tool/scope/packages/submit/wait/result数值，阶段有嵌套，不含Eureka调度、连接层凭证进程、网络或模型耗时。

## 部署

1. 备份数据库，构建新镜像。停止旧API/Web后再应用 `20261021100000_unit_driven_display`：删除前一版新增的两个displayFormat列。已应用的 `20261020160000_metric_display_format` SQL保留在历史，不修改校验和；不要手工删迁移记录、reset、db push或删除卷。
2. 生成Prisma Client，构建共享包、API/Web并重启。Docker工作区已构建共享包，migrate先于API启动。本轮只在隔离数据库验证迁移，未修改运行中的项目数据库。
3. **无需重新维护尺度，也无需为展示转换重新发布所有指标。** 客户端重新读取最新Package即可使用现有unit；正常新增/编辑业务语义仍走原发布流程。旧聊天消息不会自动重写。
4. 更新三端插件，Eureka Haze版本为2.4.1；活动会话空闲重载，保留原业务会话。仅更新ZIP不会部署后端格式库或删除Web控件。
5. 管理员自定义提示词若残留旧“尺度未确认不转换”或网页专用规则，应清理冲突内容并保留业务约束。此轮没有修改管理员数据库配置；新Skill强制按unit使用presentation，禁止重复换算。

本地导出：构建共享包/API后，运行 `apps/api/scripts/export-eureka-plugin.cjs --origin <可信HTTPS根地址> --client all`，输出至 `artifacts/agent-plugins/`，附实际ZIP SHA-256。规则摘要不等于ZIP校验值。没有自动上传、发布或安装。

## 验证边界

测试覆盖%/‰、万元/亿元/其他数量级、负数/零/null/超大整数/高精度/ID/日期、共享网页/MCP展示、图表换算、无多余治理控件、Package只维护unit、单位变化不改SQL、等待、权限、会话和目录回归。实际宿主互动和付费仓库端到端性能仍需明确授权。本轮未修改Eureka/Haze，未执行付费查询，不把模拟和构建通过当作真实部署验收。

本轮验证结果：API327项（324通过、3项可选测试跳过），Web185项通过，共享格式库6项通过，隔离PostgreSQL迁移5项通过；API/Web类型检查及Next生产webpack构建通过。

已导出并逐份核验版本、单位规则、来源/等待规则及实际SHA-256：
- `artifacts/agent-plugins/atlas-ask-codex-2.3.1-1a956a5a126f.zip`
- `artifacts/agent-plugins/atlas-ask-claude-2.3.1-1a956a5a126f.zip`
- `artifacts/agent-plugins/atlas-ask-eureka-2.4.1-1a956a5a126f.zip`

Eureka包及其`.sha256`另复制到用户桌面。其ZIP SHA-256为`940a7ed3cf4908ed39a46a2ed0aa2bc55bfe76b753d1efb9ca96ddd88eba1b4b`。三端规则修订为`1a956a5a126fd6bedd806c6f8003cee5c77ebca37af1161a7dfb446c5a920938`。没有上传、发布、安装或修改线上数据库。
