---
type: Note
_width: wide
---
# v\_tb\_crowd\_portrait

## 天猫客户人群

1. **TableName**: v\_tb\_crowd\_portrait
2. **Project**: paiwo\_smart
3. **Description**: 天猫客户人群，可查询店铺客户不同人群维度下的客户数量，包括店铺客户人群、推广客户人群等，支持按客户类型、人群类型、人群归属分析客户画像；
4. **Granularity:** 日期 / 店铺 / 人群类型 / 人群名称 / 客户类型
5. **RequiresDateRange**：否
6. **Example**:

```sql
SELECT
get_date              as "日期"
,shop_project         as "品牌项目名"
,shop_fin_name        as "店铺名称"
,crowd_detail_name    as "人群名称"
,crowd_detail_type    as "人群类型"
,customer_num         as "客户数"
,customer_type        as "客户类型"
,crowd_type           as "人群归属"
FROM paiwo_smart.v_tb_crowd_portrait
```

7. Columns
    | 字段名 | 物理字段名 | 数据类型 | 字段类型 | 聚合方式 | 单位 |
    | --- | --- | --- | --- | --- | --- |
    | 日期 | get\_date | date | dimension |  |  |
    | 品牌项目名 | shop\_project | string | dimension |  |  |
    | 店铺名称 | shop\_fin\_name | string | dimension |  |  |
    | 人群名称 | crowd\_detail\_name | string | dimension |  |  |
    | 人群类型 | crowd\_detail\_type | string | dimension |  |  |
    | 客户数 | customer\_num | decimal | measure | sum |  |
    | 客户类型 | customer\_type | string | dimension |  |  |
    | 人群归属 | crowd\_type | string | dimension |  |  |

8. DimensionColumns
    | 字段名 | 是否可筛选 | 是否可分组 | 候选值查询 | 说明 |
    | --- | --- | --- | --- | --- |
    | 日期 | 是 | 是 | 否 | 支持日期筛选 |
    | 品牌项目名 | 是 | 是 | 是 | 淘系店铺品牌项目 |
    | 店铺名称 | 是 | 是 | 是 | 指定天猫店铺 |
    | 人群名称 | 是 | 是 | 是 | 支持客户画像人群筛选 |
    | 人群类型 | 是 | 是 | 是 | 消费层级、年龄段、地域、性别等 |
    | 客户类型 | 是 | 是 | 是 | 客户新访、未购客户回访、已购客户回访、访问人群、支付人群等 |
    | 人群归属 | 是 | 是 | 是 | 店铺客户人群 / 推广客户人群 |
