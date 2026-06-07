---
title: MySQL 总览
sidebarTitle: 专题首页
---

# MySQL 总览

> 这一组只记 MySQL 在后端工程里的实战问题：表结构、索引、事务、锁、慢 SQL、Java 接入。

## 内容入口

| 分组 | 笔记 | 重点 |
| --- | --- | --- |
| 总览 | [MySQL 工程实践总览](/notes/mysql/mysql-engineering) | 后端项目里 MySQL 承担什么边界 |
| 基础 | [MySQL 入门与基础模型](/notes/mysql/mysql-basics) | database、table、row、column、connection |
| 表设计 | [MySQL 表设计规范](/notes/mysql/table-design) | 字段、主键、唯一约束、状态、审计字段 |
| 表设计 | [商品表设计](/notes/mysql/product-table-design) | SPU/SKU、库存、图片、详情拆表 |
| 索引 | [MySQL 索引与 EXPLAIN](/notes/mysql/indexes-explain) | 联合索引、LIKE、失效场景、执行计划 |
| 索引 | [MySQL 索引原理与回表](/notes/mysql/index-principles-covering) | B+Tree、聚簇索引、二级索引、覆盖索引 |
| 事务 | [MySQL 事务隔离与 MVCC](/notes/mysql/transaction-isolation-mvcc) | ACID、隔离级别、ReadView、快照读 |
| 事务 | [MySQL 事务与锁](/notes/mysql/transactions-locks) | 行锁、间隙锁、死锁、条件更新 |
| SQL | [MySQL 多表联查](/notes/mysql/multi-table-join) | 主表、join、分页、应用层组装 |
| 排查 | [MySQL 慢 SQL 排查](/notes/mysql/slow-query-troubleshooting) | 慢查询、`EXPLAIN`、锁等待、优化路径 |
| 接入 | [MySQL 与 Java 后端](/notes/mysql/mysql-java-backend) | MyBatis、连接池、事务、缓存一致性 |
| 选型 | [MongoDB 和 MySQL 对比](/notes/mysql/mongodb-vs-mysql) | 关系型和文档型数据库怎么取舍 |

## 先定边界

MySQL 是大多数业务系统的最终事实来源。Redis、MQ、ES 可以帮它分担压力，但不能替它兜住核心一致性。

| 主题 | 关注点 |
| --- | --- |
| 基础模型 | database、table、row、column、index、transaction、connection |
| 表设计 | 字段类型、主键、唯一约束、状态字段、审计字段 |
| 索引 | 查询路径、联合索引顺序、覆盖索引、低选择性字段 |
| SQL | 可读性、可解释、可优化，别把复杂查询藏太深 |
| 事务 | 边界要小，锁持有时间要短，外部调用不要放事务里 |
| 锁 | 行锁、间隙锁、死锁、条件更新 |
| 排查 | `EXPLAIN`、慢查询、锁等待、连接池 |
| Java 接入 | MyBatis、连接池、事务边界、Flyway、缓存一致性 |

## 项目里先统一这些

- 表名、字段名、索引名规则。
- 主键生成策略。
- 时间字段：`create_time`、`update_time`。
- 逻辑删除字段：`deleted` 或 `deleted_at`。
- 状态字段枚举值。
- 金额字段精度。
- 分页和排序规则。
- 事务注解位置和回滚规则。

## 写 MySQL 笔记时关注什么

不要只记 SQL 语法，要落到工程问题：

- 这个表未来按什么条件查。
- 这个索引服务哪条 SQL。
- 这个事务会锁多久。
- 这个接口慢时怎么定位。
- 这个并发写会不会重复、超卖、死锁。

## 当前写作检查

这组 MySQL 笔记按“基础模型 -> 表设计 -> 索引 -> 事务 -> SQL -> 排查 -> Java 接入”展开。

每篇都要求落到：

- 有具体 SQL。
- 有反例和改法。
- 有排查命令。
- 有工程检查清单。
- 能解释为什么这么设计。

不写“索引要优化”“事务要合理”“SQL 要规范”这种没有操作路径的话。

## 参考

- [MySQL Optimizing Queries with EXPLAIN](https://dev.mysql.com/doc/refman/8.4/en/using-explain.html)
- [MySQL Multiple-Column Indexes](https://dev.mysql.com/doc/refman/8.4/en/multiple-column-indexes.html)
