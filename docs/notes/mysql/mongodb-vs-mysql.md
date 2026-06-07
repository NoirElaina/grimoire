---
title: MongoDB 和 MySQL 对比
sidebarTitle: MongoDB 和 MySQL
---

# MongoDB 和 MySQL 对比

> MongoDB 和 MySQL 不是谁替代谁。MySQL 更适合强关系、强事务、结构稳定的业务；MongoDB 更适合文档模型、结构变化快、读写横向扩展诉求强的业务。

## 一句话区别

```text
MySQL:
    关系型数据库。
    数据按表、行、列组织。
    擅长事务、关系约束、复杂 SQL。

MongoDB:
    文档型数据库。
    数据按 collection、document 组织。
    擅长灵活结构、嵌套文档、横向扩展。
```

不要把 MongoDB 理解成“没有表的 MySQL”。

它的数据建模方式不一样。

## 核心对比

| 维度 | MySQL | MongoDB |
| --- | --- | --- |
| 数据模型 | 表、行、列 | collection、document |
| 结构约束 | schema 明确 | schema 灵活 |
| 查询语言 | SQL | MongoDB Query API / Aggregation |
| 事务 | 强事务能力成熟 | 支持事务，但建模上更强调文档内原子性 |
| 关系表达 | 外键、join、关联表 | 嵌入文档、引用、聚合 |
| 复杂联查 | 擅长 | 不适合作为主要强项 |
| 横向扩展 | 可以做，但通常更复杂 | 原生分片体系更常见 |
| 数据一致性 | 强一致和事务边界清晰 | 需要结合副本集、写关注、事务设计 |
| 适合场景 | 订单、支付、库存、账户 | 内容、配置、日志、画像、灵活属性 |

## 数据模型差异

MySQL 订单模型：

```text
orders
order_items
payment_orders
products
```

通过主键、外键、索引、join 关联。

MongoDB 可能会把订单和明细放在一个文档里：

```json
{
  "orderNo": "O202606070001",
  "userId": 10001,
  "status": "WAIT_PAY",
  "items": [
    {
      "skuId": 20001,
      "productName": "phone",
      "price": 1999.00,
      "count": 1
    }
  ],
  "createTime": "2026-06-07T10:00:00"
}
```

这样查订单详情很快，因为明细就在同一个文档里。

但如果要频繁跨订单统计每个 SKU 的销量，MySQL 或专门的分析系统可能更自然。

## 事务差异

MySQL 很适合这类业务：

```text
创建订单
  -> 写订单主表
  -> 写订单明细
  -> 锁定库存
  -> 写操作日志
  -> 一个本地事务提交
```

MongoDB 支持多文档事务，但使用时要谨慎。

更推荐先思考：

```text
能不能把强一致修改收敛到一个文档内？
是否真的需要跨多个集合事务？
```

如果业务天然强事务、强约束，比如：

- 支付。
- 账户余额。
- 库存扣减。
- 优惠券核销。
- 订单状态机。

MySQL 通常更合适。

## 关系和 join

MySQL 擅长关系：

```sql
select o.order_no, p.pay_status
from orders o
left join payment_orders p on p.order_id = o.id
where o.user_id = #{userId};
```

MongoDB 更常见两种方式：

### 嵌入

把相关数据直接放到一个文档里。

适合：

- 一起读取。
- 生命周期一致。
- 子数据数量有限。

### 引用

文档里保存另一个文档的 ID。

适合：

- 子数据很多。
- 多处复用。
- 生命周期不同。

如果系统里大量需求是：

```text
多表强关联。
复杂 join。
多维条件组合。
事务内更新多张表。
```

优先 MySQL。

## 索引差异

MySQL 常见索引：

- B+Tree。
- 联合索引。
- 唯一索引。
- 覆盖索引。
- FULLTEXT。

MongoDB 常见索引：

- 单字段索引。
- 复合索引。
- 多键索引。
- 文本索引。
- TTL 索引。
- 地理空间索引。

MongoDB 文档字段灵活，但索引仍然要按查询设计。

不要以为：

```text
MongoDB schema 灵活 = 查询不用设计索引。
```

大集合没有合适索引，一样会慢。

## 什么时候选 MySQL

适合：

- 订单。
- 支付。
- 账户。
- 库存。
- 交易流水。
- 权限关系。
- 需要复杂 SQL 查询。
- 结构相对稳定。
- 事务和唯一约束很重要。

例如：

```text
一个订单只能支付一次。
一个优惠券只能核销一次。
库存不能扣成负数。
账户余额不能算错。
```

这些要让数据库约束兜住。

## 什么时候选 MongoDB

适合：

- 内容详情。
- 商品扩展属性。
- 用户画像。
- 配置中心。
- 日志和事件文档。
- 表单数据。
- 结构经常变化的数据。
- 一次读取整个文档的场景。

例如商品扩展属性：

```json
{
  "productId": 20001,
  "attributes": {
    "color": "black",
    "memory": "256G",
    "screen": "6.7 inch"
  }
}
```

不同类目属性差异很大，用文档模型会更灵活。

但如果这些属性要频繁参与筛选、排序、统计，就要认真设计索引，甚至考虑搜索引擎。

## 项目里怎么组合

常见组合：

```text
MySQL:
    保存核心交易事实。

MongoDB:
    保存灵活文档、扩展属性、内容详情。

Redis:
    缓存热点数据。

MQ:
    做异步事件和最终一致性。

ES:
    做全文检索和复杂筛选。
```

比如商品系统：

```text
MySQL:
    product、sku、inventory、order。

MongoDB:
    商品富文本详情、类目扩展参数。

Redis:
    商品详情缓存。

ES:
    商品搜索。
```

不要把所有能力压给一个数据库。

## 常见误区

### MongoDB 不需要设计表结构

MongoDB 也需要建模。

只是建模单位从“表关系”变成“文档结构”。

### MongoDB 一定比 MySQL 快

不一定。

如果查询模式适合文档一次读取，MongoDB 可能很快。

如果需求是复杂关联、聚合、事务，MySQL 可能更稳。

### MySQL 不能存 JSON

MySQL 也有 JSON 类型。

但如果核心查询都围绕 JSON 内部字段筛选，要重新考虑模型和索引。

### MongoDB 不支持事务

MongoDB 支持事务。

但不能因为支持事务，就把它当关系型数据库硬用。

模型选型仍然要看业务访问模式。

## 回答模板

可以这样讲：

```text
MySQL 是关系型数据库，适合结构稳定、关系明确、事务要求高的业务，比如订单、支付、库存。
MongoDB 是文档型数据库，适合结构灵活、字段变化快、一次读取整个文档的场景，比如内容、配置、用户画像、商品扩展属性。

MySQL 通过表、主键、唯一索引、事务和 join 表达关系。
MongoDB 更强调文档建模，可以嵌入子文档，也可以引用其他文档。

如果业务需要强事务、唯一约束、复杂联查，我优先选 MySQL。
如果业务字段变化频繁、关系不复杂、读写文档整体为主，可以考虑 MongoDB。
实际项目里也可以组合使用：MySQL 存核心事实，MongoDB 存灵活文档，Redis 做缓存，ES 做搜索。
```

## 检查清单

- [ ] 数据是否结构稳定。
- [ ] 是否需要复杂 join。
- [ ] 是否需要强事务。
- [ ] 是否有大量灵活扩展字段。
- [ ] 是否主要按文档整体读写。
- [ ] 是否需要全文检索或复杂筛选。
- [ ] 是否能接受跨文档事务复杂度。
- [ ] 是否有索引和容量规划。

## 关联笔记

- [MySQL 表设计规范](/notes/mysql/table-design)
- [商品表设计](/notes/mysql/product-table-design)
- [MySQL 多表联查](/notes/mysql/multi-table-join)

## 参考

- [MongoDB vs MySQL](https://www.mongodb.com/resources/compare/mongodb-mysql)
- [MongoDB Data Modeling](https://www.mongodb.com/docs/manual/data-modeling/)
- [MySQL Optimization and Indexes](https://dev.mysql.com/doc/mysql/en/optimization-indexes.html)

