# Milestone 7 计算指标治理（修订版）

## 1. 修订结论

Milestone 7 的核心模型调整为：

```text
物理字段
    ↓
ColumnSemantic（原子指标）
    ↓
SemanticMetric（派生指标）
```

不再采用：

```text
物理字段
    ↓
计算指标
```

### 核心原则

1. `ColumnSemantic.semanticType = METRIC` 表示 **原子指标**。
2. 原子指标直接绑定物理字段，并通过 `aggregation` 定义默认聚合方式。
3. `SemanticMetric` 只表示 **派生指标 / 计算指标**。
4. 派生指标只能引用原子指标，不直接引用任意物理字段。
5. 用户不再手工维护“依赖字段列表”。
6. 依赖关系由公式中的原子指标引用自动解析。

---

# 2. 示例

## 2.1 原子指标

物理字段：

```text
pay_amt
```

治理后：

```text
业务名称：支付金额
语义类型：METRIC
聚合方式：SUM
单位：元
```

这已经是一个完整的原子指标。

不需要再次创建：

```text
计算指标：支付金额 = SUM(pay_amt)
```

---

## 2.2 派生指标

已有原子指标：

```text
支付金额
退款金额
```

创建派生指标：

```text
退款率
=
退款金额 / 支付金额
```

系统在真正生成 SQL 语义时展开为：

```sql
SUM(refund_amt) / NULLIF(SUM(pay_amt), 0)
```

因此：

> 派生指标公式描述的是“指标之间的关系”，而不是重复描述字段的聚合方式。

---

# 3. 本阶段目标

在现有 Eureka Atlas 单表治理工作台中增加：

```text
原子指标
    ↓
派生指标治理
    ↓
正式发布
    ↓
Semantic Package
```

完成后用户可以：

1. 将字段治理为原子指标；
2. 基于原子指标创建派生指标；
3. 保存派生指标草稿；
4. 发布正式派生指标；
5. 在 Semantic Package 中输出原子指标与派生指标关系。

---

# 4. 当前项目基础

当前项目已经存在：

```text
MetaColumn
ColumnSemantic
GovernanceReview
GovernanceWorkspaceService
SemanticPackage
```

其中 `ColumnSemantic` 已包含：

```text
metricName
semanticType
aggregation
unit
```

这已经足够表达原子指标。

因此 Milestone 7：

- 不新增“原子指标表”
- 不把原子指标复制到 SemanticMetric
- 只新增派生指标模型

---

# 5. 术语定义

## 5.1 原子指标 Atomic Metric

满足：

```text
ColumnSemantic.semanticType = METRIC
```

例如：

| 物理字段 | 业务名称 | 聚合 |
|---|---|---|
| pay_amt | 支付金额 | SUM |
| refund_amt | 退款金额 | SUM |
| pay_buyer_cnt | 支付买家数 | SUM |

原子指标是派生指标的最小业务计算单元。

---

## 5.2 派生指标 Derived Metric

由一个或多个原子指标计算得到。

例如：

```text
退款率
=
退款金额 / 支付金额
```

```text
客单价
=
支付金额 / 支付买家数
```

```text
推广费率
=
推广花费 / 销售额
```

---

# 6. 本阶段范围

## 包含

- 新增派生指标数据模型
- 治理工作台增加“计算指标”区域
- 新增 / 编辑 / 删除派生指标草稿
- 从当前表原子指标中插入指标引用
- 公式编辑
- 自动解析公式依赖
- 发布派生指标
- Semantic Package 增加 derived metrics

## 不包含

- 跨表指标
- Join
- 派生指标引用另一个派生指标
- AI 自动生成公式
- 独立指标中心
- 指标版本管理
- 实际执行 MaxCompute SQL 校验
- 跨表指标复用

第一版严格限制：

> 派生指标只能引用当前表、当前治理草稿中语义类型为 METRIC 的原子指标。

---

# 7. 数据模型设计

## 7.1 SemanticMetric

新增正式派生指标模型：

```prisma
model SemanticMetric {
  id                     String         @id @default(cuid())
  metaTableId            String
  sourceGovernanceTaskId String

  name                   String
  formula                String
  unit                   String?
  description            String?

  dependencies           Json

  publishedBy            String
  publishedAt            DateTime       @default(now())
  updatedAt              DateTime       @updatedAt

  metaTable              MetaTable      @relation(
    fields: [metaTableId],
    references: [id],
    onDelete: Cascade
  )

  sourceGovernanceTask   GovernanceTask @relation(
    "PublishedSemanticMetrics",
    fields: [sourceGovernanceTaskId],
    references: [id],
    onDelete: Restrict
  )

  @@unique([metaTableId, name])
  @@index([sourceGovernanceTaskId])
  @@map("semantic_metric")
}
```

不再需要：

```text
SemanticMetricType
AGGREGATE
DERIVED
```

原因：

> `SemanticMetric` 在当前版本中天然就是派生指标。

简单聚合：

```text
SUM(pay_amt)
```

已经由：

```text
ColumnSemantic + aggregation
```

表达。

---

## 7.2 MetaTable

增加：

```prisma
semanticMetrics SemanticMetric[]
```

---

## 7.3 GovernanceTask

增加：

```prisma
publishedSemanticMetrics SemanticMetric[]
  @relation("PublishedSemanticMetrics")
```

---

## 7.4 GovernanceReview

继续沿用当前 JSON 草稿模式：

```prisma
metricDrafts Json
```

默认：

```json
[]
```

---

# 8. MetricDraft 设计

```ts
type MetricDraft = {
  id: string;
  name: string;
  formula: string;
  unit: string;
  description: string;
};
```

不再要求：

```text
dependencyColumnIds
```

因为依赖由公式自动解析。

---

# 9. 原子指标引用方式

## UI 展示

用户看到：

```text
[支付金额] / [支付买家数]
```

其中：

```text
[支付金额]
[支付买家数]
```

是不可随意修改的指标 Token。

---

## 内部存储

不要直接使用业务名称作为唯一标识。

建议内部公式序列化为：

```text
{{metric:<metaColumnId>}}
```

例如：

```text
{{metric:cm_pay_amt}} / NULLIF({{metric:cm_pay_buyer_cnt}}, 0)
```

原因：

- 业务名称以后可以修改
- 物理字段名称可能不适合作为语义唯一键
- `metaColumnId` 在当前表内稳定
- 可以自动解析依赖关系

UI 层负责将 Token 显示成业务名称。

---

# 10. 公式语义

用户定义的公式是：

> 原子指标表达式

不是完整 SQL。

例如：

```text
退款金额 / 支付金额
```

系统内部：

```text
{{metric:refund_column_id}}
/
NULLIF({{metric:pay_column_id}}, 0)
```

最终 Package / Agent 层需要时，可以展开：

```sql
SUM(refund_amt)
/
NULLIF(SUM(pay_amt), 0)
```

---

# 11. 原子指标的 SQL 展开规则

每个原子指标来自：

```text
MetaColumn
+
ColumnSemantic
```

例如：

```text
MetaColumn.name = pay_amt

ColumnSemantic.metricName = 支付金额

ColumnSemantic.aggregation = SUM
```

展开：

```sql
SUM(pay_amt)
```

另一个：

```text
MetaColumn.name = pay_buyer_cnt
aggregation = COUNT_DISTINCT
```

可展开：

```sql
COUNT(DISTINCT pay_buyer_cnt)
```

因此：

> 派生指标不重复维护原子聚合逻辑。

---

# 12. 可用于公式的原子指标

计算指标编辑器中的“插入指标”只显示：

```text
当前治理草稿
AND
semanticType = METRIC
AND
aggregation 已配置
```

不显示：

```text
DIMENSION
LABEL
PARTITION
```

也不显示：

- 其他表指标
- 未纳入当前治理范围的字段

---

# 13. 用户交互

治理工作台结构：

```text
表级语义

字段语义

计算指标
```

计算指标区：

```text
计算指标                      [+ 新增计算指标]
```

列表：

| 指标名称 | 计算公式 | 单位 | 依赖原子指标 | 操作 |
|---|---|---|---|---|
| 退款率 | 退款金额 / 支付金额 | % | 2 | 编辑 |
| 客单价 | 支付金额 / 支付买家数 | 元 | 2 | 编辑 |

---

# 14. 新增指标 Dialog / Sheet

建议：

```text
指标名称 *
[退款率]

单位
[%]

业务说明
[退款金额占支付金额的比例]

计算公式 *
┌────────────────────────────────────┐
│ [退款金额] / [支付金额]            │
└────────────────────────────────────┘

[插入原子指标]

[取消] [保存]
```

不再出现：

```text
依赖字段 *
```

因为依赖自动从公式解析。

---

# 15. 公式依赖校验

原来设计中的：

```text
用户选择依赖字段
+
用户写公式
```

取消。

新的规则：

```text
公式
   ↓
自动解析 metric tokens
   ↓
dependencies
```

因此不再存在：

```text
选了3个字段是否必须全部写进公式
```

这种双份维护问题。

---

# 16. 后端校验规则

新增：

```text
MetricValidationService
```

位置建议：

```text
apps/api/src/governance/metric-validation.service.ts
```

校验：

1. 指标名称不能为空
2. 同表指标名称不能重复
3. 公式不能为空
4. 公式至少引用一个原子指标
5. 每个 metric token 必须对应当前表字段
6. 对应 ColumnDraft.semanticType 必须是 `METRIC`
7. 原子指标必须存在 aggregation
8. 禁止引用未选择字段
9. 禁止引用派生指标
10. 禁止完整 SQL 语句

---

# 17. 公式允许内容

第一版允许：

```text
+
-
*
/
(
)
数字常量
```

以及少量安全函数：

```text
NULLIF
COALESCE
ROUND
```

不允许：

```text
SELECT
FROM
JOIN
INSERT
UPDATE
DELETE
DROP
ALTER
CREATE
TRUNCATE
;
--
/*
*/
```

不做完整 SQL Parser。

---

# 18. dependencies 自动生成

保存正式 `SemanticMetric` 时：

从公式 Token 自动提取：

```json
[
  {
    "meta_column_id": "cm_refund",
    "column": "refund_amt",
    "metric_name": "退款金额",
    "aggregation": "SUM"
  },
  {
    "meta_column_id": "cm_pay",
    "column": "pay_amt",
    "metric_name": "支付金额",
    "aggregation": "SUM"
  }
]
```

用户不直接编辑该字段。

---

# 19. Workspace 修改

当前：

```ts
type WorkspaceInput = {
  selectedColumns?: string[];
  table?: Partial<TableDraft>;
  columns?: ColumnDraft[];
};
```

扩展：

```ts
type WorkspaceInput = {
  selectedColumns?: string[];
  table?: Partial<TableDraft>;
  columns?: ColumnDraft[];
  metrics?: MetricDraft[];
};
```

返回：

```ts
draft: {
  table: TableDraft;
  columns: ColumnDraft[];
  metrics: MetricDraft[];
}
```

---

# 20. 保存草稿

当前：

```text
GovernanceReview.tableDraft
GovernanceReview.columnDrafts
```

增加：

```text
GovernanceReview.metricDrafts
```

“保存草稿”一次保存：

- 表语义
- 字段语义
- 派生指标

---

# 21. 字段语义修改时的联动

如果某个字段已经被计算指标引用：

```text
支付金额
semanticType = METRIC
```

用户后来把它改成：

```text
DIMENSION
```

系统必须立即提示：

```text
该字段正在被以下计算指标引用：

- 退款率
- 客单价

请先修改或删除这些计算指标。
```

禁止直接发布产生悬空依赖。

---

# 22. AI 行为

Milestone 7 不改变当前 AI 职责。

AI继续生成：

- 表语义建议
- 字段语义建议

不自动生成：

- 派生指标
- 指标公式

计算公式第一版由人工维护。

---

# 23. 发布流程

发布时：

```text
GovernanceReview
    ↓
TableSemantic
ColumnSemantic
SemanticMetric
    ↓
Semantic Package
```

发布步骤：

1. 校验表语义
2. 校验字段语义
3. 校验每个计算指标
4. 根据公式生成 dependencies
5. 发布 TableSemantic
6. 发布 ColumnSemantic
7. 替换当前表 SemanticMetric
8. 重新生成 Semantic Package
9. GovernanceTask → COMPLETED

必须处于同一事务。

---

# 24. 发布策略

项目当前不做版本管理。

所以每次发布：

```text
当前 metricDrafts
=
发布后的完整派生指标集合
```

实现：

1. 删除当前表原有 `SemanticMetric`
2. 根据当前 `metricDrafts` 全量创建

不做历史版本。

---

# 25. Semantic Package 调整

当前：

```json
{
  "table": {},
  "fields": []
}
```

调整：

```json
{
  "table": {},

  "fields": [],

  "metrics": []
}
```

---

# 26. Package 中区分原子指标和派生指标

`fields` 保持当前结构。

原子指标示例：

```json
{
  "column": "pay_amt",
  "name": "支付金额",
  "type": "METRIC",
  "aggregation": "SUM",
  "unit": "元"
}
```

派生指标：

```json
{
  "name": "退款率",
  "type": "DERIVED",
  "formula": "退款金额 / 支付金额",
  "unit": "%",
  "dependencies": [
    {
      "name": "退款金额",
      "column": "refund_amt",
      "aggregation": "SUM"
    },
    {
      "name": "支付金额",
      "column": "pay_amt",
      "aggregation": "SUM"
    }
  ]
}
```

---

# 27. 可选的 SQL 展开结果

Package Builder 可以额外输出：

```json
{
  "sql_expression": "SUM(refund_amt) / NULLIF(SUM(pay_amt), 0)"
}
```

建议 Milestone 7 **生成该字段**，但不执行 SQL。

这样未来 Agent 不需要重新推断原子指标如何聚合。

---

# 28. Semantic Package 示例

```json
{
  "table": {
    "name": "dws_shop_sales_daily",
    "business_name": "店铺销售日报",
    "grain": "日期+店铺"
  },

  "fields": [
    {
      "column": "pay_amt",
      "name": "支付金额",
      "type": "METRIC",
      "aggregation": "SUM",
      "unit": "元"
    },
    {
      "column": "refund_amt",
      "name": "退款金额",
      "type": "METRIC",
      "aggregation": "SUM",
      "unit": "元"
    }
  ],

  "metrics": [
    {
      "name": "退款率",
      "type": "DERIVED",
      "formula": "退款金额 / 支付金额",
      "sql_expression": "SUM(refund_amt) / NULLIF(SUM(pay_amt), 0)",
      "unit": "%",
      "dependencies": [
        "退款金额",
        "支付金额"
      ]
    }
  ]
}
```

---

# 29. API

继续沿用当前 Workspace API。

不新增独立指标中心 API。

保存：

```http
PUT /governance/workspaces/:id
```

Body：

```json
{
  "metrics": []
}
```

发布：

```http
POST /governance/workspaces/:id/publish
```

Package：

继续使用现有查询接口，只增加：

```json
metrics: []
```

---

# 30. 前端任务

当前治理工作台页面已经较大，本 Milestone 新功能不要继续全部堆入 page.tsx。

建议新增：

```text
apps/web/components/governance/calculated-metrics.tsx
```

职责：

- 指标列表
- 新增
- 编辑
- 删除

新增：

```text
apps/web/components/governance/metric-editor.tsx
```

职责：

- 指标名称
- 单位
- 描述
- 指标 Token 编辑
- 插入原子指标

新增：

```text
apps/web/components/governance/atomic-metric-picker.tsx
```

职责：

- 搜索原子指标
- 只展示 semanticType = METRIC
- 插入指标 Token

---

# 31. 后端任务

## Step 1 Prisma

- 新增 `SemanticMetric`
- GovernanceReview 增加 `metricDrafts`
- 补充关系
- Migration

## Step 2 Workspace

扩展：

```text
create
get
update
publish
normalize
validatePublish
```

支持 metrics。

## Step 3 Formula Parser

新增：

```text
metric-formula.service.ts
```

职责：

- 解析 metric token
- 校验 token
- 生成 dependencies
- 展开 sql_expression

## Step 4 Package

更新：

```text
PackageService
semantic-package.builder
```

支持：

```text
metrics
```

---

# 32. 测试 Case

## Case 1 客单价

原子指标：

```text
支付金额 → SUM(pay_amt)
支付买家数 → SUM(pay_buyer_cnt)
```

派生指标：

```text
客单价
=
支付金额 / 支付买家数
```

展开：

```sql
SUM(pay_amt) / NULLIF(SUM(pay_buyer_cnt), 0)
```

---

## Case 2 推广费率

原子指标：

```text
推广花费 → SUM(sls_xq_ad_cost)
销售额 → SUM(sls_xq_real_amount)
```

派生：

```text
推广费率
=
推广花费 / 销售额
```

---

## Case 3 只有原子指标

某张表仅治理：

```text
销售额
利润
访客数
```

没有派生指标。

应允许直接发布：

```json
"metrics": []
```

这正是修订后的重要原则：

> 并不是所有指标都需要进入计算指标层。

---

# 33. 验收标准

- [ ] 原子指标仍由 ColumnSemantic 管理
- [ ] 不要求原子指标重复创建 SemanticMetric
- [ ] 计算指标只能引用原子指标
- [ ] 不需要用户单独选择依赖字段
- [ ] 依赖由公式自动解析
- [ ] 字段从 METRIC 改为其他类型时能发现被引用关系
- [ ] 保存草稿后公式不丢失
- [ ] 发布后生成 SemanticMetric
- [ ] Semantic Package 包含 fields + metrics
- [ ] 无派生指标的表仍能正常发布

---

# 34. Codex 执行顺序

```text
Step 1
修改 Prisma

↓

Step 2
metricDrafts

↓

Step 3
Metric Formula Token 模型

↓

Step 4
公式解析与依赖自动识别

↓

Step 5
治理工作台 UI

↓

Step 6
发布 SemanticMetric

↓

Step 7
Package 增加 metrics

↓

Step 8
端到端测试
```

每一步完成并验证后再继续。

---

# 35. 本阶段禁止事项

不要：

- 将原子指标复制到 SemanticMetric
- 让用户手工同时维护“公式 + 依赖字段”
- 让派生指标直接引用 DIMENSION / LABEL / PARTITION
- 创建独立指标中心
- 做跨表指标
- 做指标引用指标
- 做 Join
- AI 自动生成公式
- 引入 RAG / Agent
- 执行 MaxCompute SQL 校验
- 引入版本体系

---

# 36. 最终结构

Milestone 7 完成后：

```text
MetaColumn
    ↓
ColumnSemantic
    │
    ├── DIMENSION
    ├── LABEL
    ├── PARTITION
    └── METRIC
          ↓
       原子指标
          ↓
    SemanticMetric
          ↓
       派生指标
```

最终 Semantic Package：

```text
table
fields
metrics
```

其中：

- `fields[type=METRIC]` = 原子指标
- `metrics` = 派生指标

这样能够保持：

> 字段治理、原子指标、派生指标三个层次清晰，不重复维护同一业务指标。
