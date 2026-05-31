---
title: MySQL 总览
sidebarTitle: 专题首页
---

# MySQL 总览

> 这一组只记 MySQL 在后端工程里的实战问题：表结构、索引、事务、锁、慢 SQL、Java 接入。

## 内容入口

- [MySQL 工程实践](/notes/mysql/mysql-engineering)

## 先定边界

MySQL 是大多数业务系统的最终事实来源。Redis、MQ、ES 可以帮它分担压力，但不能替它兜住核心一致性。

| 主题 | 关注点 |
| --- | --- |
| 表设计 | 字段类型、主键、唯一约束、状态字段、审计字段 |
| 索引 | 查询路径、联合索引顺序、覆盖索引、低选择性字段 |
| SQL | 可读性、可解释、可优化，别把复杂查询藏太深 |
| 事务 | 边界要小，锁持有时间要短，外部调用不要放事务里 |
| 锁 | 行锁、间隙锁、死锁、条件更新 |
| 排查 | `EXPLAIN`、慢查询、锁等待、连接池 |

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

## 参考

- [MySQL Optimizing Queries with EXPLAIN](https://dev.mysql.com/doc/refman/8.4/en/using-explain.html)
- [MySQL Multiple-Column Indexes](https://dev.mysql.com/doc/refman/8.4/en/multiple-column-indexes.html)
