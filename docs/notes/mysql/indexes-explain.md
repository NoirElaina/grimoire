---
title: MySQL 索引与 EXPLAIN
sidebarTitle: 03 索引与 EXPLAIN
---

# MySQL 索引与 EXPLAIN

> 索引不是“给字段加速”，而是“给某条 SQL 设计访问路径”。`EXPLAIN` 不是背字段，而是确认 MySQL 有没有按你预期的路径读数据。

## 先说结论

索引设计先问三个问题：

```text
这条 SQL 从哪里过滤？
按什么排序？
要返回多少行？
```

然后再决定：

```text
索引放哪些字段。
字段顺序怎么排。
是否需要覆盖索引。
是否值得维护这个索引。
```

不要这样建索引：

```text
看到 where 里有 user_id，加一个。
看到 where 里有 status，加一个。
看到 order by create_time，加一个。
```

要这样：

```text
先写核心 SQL。
再设计联合索引。
再用 EXPLAIN 验证。
最后看实际数据量和响应时间。
```

## 索引的工程代价

索引能提升查询，但不是免费的。

每多一个索引，就会增加：

- 磁盘占用。
- Buffer Pool 压力。
- 插入成本。
- 删除成本。
- 更新索引字段的成本。
- 优化器选择成本。

所以：

```text
读多写少，可以多一些索引。
写多读少，索引必须克制。
高频 SQL，值得定制索引。
低频后台 SQL，不一定值得牺牲写入。
```

## 单列索引和联合索引

单列索引：

```sql
create index idx_orders_user_id on orders(user_id);
```

联合索引：

```sql
create index idx_orders_user_status_time
    on orders(user_id, status, create_time);
```

在业务系统里，真正有价值的往往是联合索引。

因为查询通常不是只按一个字段：

```sql
select id, order_no, status, create_time
from orders
where user_id = #{userId}
  and status = 'PENDING_PAYMENT'
order by create_time desc
limit 20;
```

这个 SQL 更适合：

```sql
create index idx_orders_user_status_time
    on orders(user_id, status, create_time);
```

而不是三个单列索引：

```sql
create index idx_user_id on orders(user_id);
create index idx_status on orders(status);
create index idx_create_time on orders(create_time);
```

## 最左前缀原则

联合索引：

```sql
create index idx_user_status_time
    on orders(user_id, status, create_time);
```

能比较好支持：

```sql
where user_id = ?
```

```sql
where user_id = ?
  and status = ?
```

```sql
where user_id = ?
  and status = ?
order by create_time desc
```

不适合：

```sql
where status = ?
```

因为它没有从最左列 `user_id` 开始。

记忆：

```text
联合索引像一本按 user_id、status、create_time 排序的电话簿。
你不提供 user_id，直接找 status，很难利用这本电话簿的有序性。
```

## 联合索引顺序怎么排

常见顺序：

```text
等值过滤字段
  -> 范围字段
  -> 排序字段
  -> 覆盖查询字段
```

但不是死规则，要看具体 SQL。

### 用户订单列表

SQL：

```sql
select id, order_no, status, payable_amount, create_time
from orders
where user_id = #{userId}
order by create_time desc
limit 20;
```

索引：

```sql
create index idx_orders_user_time
    on orders(user_id, create_time);
```

原因：

```text
user_id 过滤某个用户。
create_time 支撑这个用户下的倒序分页。
```

### 后台状态筛选

SQL：

```sql
select id, order_no, user_id, status, create_time
from orders
where status = #{status}
  and create_time >= #{startTime}
  and create_time < #{endTime}
order by create_time desc
limit 20;
```

索引：

```sql
create index idx_orders_status_time
    on orders(status, create_time);
```

原因：

```text
status 是等值。
create_time 是范围和排序。
```

### 超时订单扫描

SQL：

```sql
select id
from orders
where status = 'PENDING_PAYMENT'
  and close_deadline_time <= now()
order by close_deadline_time
limit 100;
```

索引：

```sql
create index idx_orders_status_close_deadline
    on orders(status, close_deadline_time);
```

这就是订单超时关闭场景里的典型索引。

## 范围条件后的字段

联合索引：

```sql
create index idx_status_time_user
    on orders(status, create_time, user_id);
```

SQL：

```sql
where status = 'PAID'
  and create_time >= '2026-06-01 00:00:00'
  and user_id = 10001
```

`status` 是等值。

`create_time` 是范围。

`user_id` 在范围字段后面，通常很难继续充分利用来缩小索引扫描范围。

所以如果常按用户查：

```sql
where user_id = ?
  and status = ?
  and create_time >= ?
```

更适合：

```sql
create index idx_user_status_time
    on orders(user_id, status, create_time);
```

## 覆盖索引

如果查询所需字段都在索引里，MySQL 可能不需要回表。

SQL：

```sql
select id, order_no, status, create_time
from orders
where user_id = #{userId}
order by create_time desc
limit 20;
```

覆盖索引：

```sql
create index idx_user_time_cover
    on orders(user_id, create_time, id, order_no, status);
```

优点：

```text
减少回表。
高频列表查询可能更快。
```

代价：

```text
索引更大。
写入更慢。
维护成本更高。
```

不要为了覆盖索引把所有字段都塞进去。

只给高频、稳定、字段少的查询做覆盖索引。

## 低选择性字段

低选择性字段比如：

```text
deleted: 0/1
gender: male/female
status: 少数几个值
```

单独建索引通常收益有限：

```sql
create index idx_orders_deleted on orders(deleted);
```

如果大部分数据都是：

```text
deleted = 0
```

这个索引筛不掉多少行。

更常见做法是放进联合索引：

```sql
create index idx_orders_user_deleted_time
    on orders(user_id, deleted, create_time);
```

是否把 `deleted` 放进联合索引，要看数据量和 SQL。

不要机械地所有逻辑删除表都把 `deleted` 放第二列。

## 常见索引失效写法

### 函数包裹字段

错误：

```sql
where date(create_time) = '2026-06-01'
```

更好：

```sql
where create_time >= '2026-06-01 00:00:00'
  and create_time < '2026-06-02 00:00:00'
```

原因：

```text
不要对索引字段做函数计算。
把计算放到常量侧。
```

### 左模糊

可能无法有效使用普通 B+Tree 索引：

```sql
where username like '%alice'
```

前缀匹配更友好：

```sql
where username like 'alice%'
```

如果要任意包含搜索：

- 小数据量可以接受。
- 中大数据量考虑搜索引擎。
- 或设计专门搜索表。

### 隐式类型转换

字段是 bigint：

```sql
user_id bigint
```

查询却传字符串：

```sql
where user_id = '10001'
```

可能带来类型转换和索引问题。

Java 里参数类型要和数据库字段对齐。

### 对字段计算

错误：

```sql
where amount + 10 > 100
```

更好：

```sql
where amount > 90
```

### 不符合最左前缀

索引：

```sql
key idx_user_status_time(user_id, status, create_time)
```

不适合：

```sql
where status = 'PAID'
```

要么调整 SQL，要么根据真实场景新增另一个索引。

## `EXPLAIN` 怎么用

基础：

```sql
explain
select id, order_no, status, create_time
from orders
where user_id = 10001
order by create_time desc
limit 20;
```

MySQL 8 也可以：

```sql
explain analyze
select ...
```

`EXPLAIN ANALYZE` 会实际执行查询并输出执行统计。

生产环境要谨慎，尤其是写 SQL 或大查询。

## `EXPLAIN` 重点字段

最少看这些：

| 字段 | 关注点 |
| --- | --- |
| `type` | 访问类型，是否全表扫描 |
| `possible_keys` | 理论可能用哪些索引 |
| `key` | 实际用了哪个索引 |
| `key_len` | 使用了索引的多少部分 |
| `rows` | 预估扫描行数 |
| `filtered` | 条件过滤比例估算 |
| `Extra` | 额外操作，如 filesort、temporary、index condition |

不要只看 `key`。

还要看：

```text
用了索引，但扫描 rows 仍然很大吗？
用了索引，但 Extra 有 Using filesort 吗？
用了索引，但返回字段导致大量回表吗？
```

## `type` 怎么看

大致从好到差：

```text
system / const
eq_ref
ref
range
index
ALL
```

常见解释：

| type | 含义 | 工程判断 |
| --- | --- | --- |
| `const` | 主键或唯一索引等值查一行 | 很好 |
| `ref` | 普通索引等值匹配 | 常见且可接受 |
| `range` | 索引范围扫描 | 常见，关注 rows |
| `index` | 扫整个索引 | 可能有风险 |
| `ALL` | 全表扫描 | 大表要重点排查 |

`ALL` 不一定永远错。

如果表只有几十行，全表扫很正常。

但大表高频接口出现 `ALL`，一般要处理。

## `Extra` 常见值

### `Using index`

通常表示覆盖索引。

也就是查询字段可以从索引里拿到，不必回表。

这是好信号。

### `Using where`

表示存储引擎返回数据后，MySQL 层还要做 where 过滤。

不一定坏，要结合 `rows` 看。

### `Using filesort`

表示需要额外排序。

不一定真的写磁盘文件。

不要看到它就慌。

要问：

```text
排序数据量有多大？
limit 是否很小？
能不能用索引顺序避免？
```

### `Using temporary`

表示用了临时表。

常见于复杂 `group by`、`distinct`、排序。

大数据量时要重点关注。

### `Using index condition`

表示使用了索引条件下推。

通常是 MySQL 优化器在尽量减少回表。

## 案例：用户订单列表

SQL：

```sql
select id, order_no, status, payable_amount, create_time
from orders
where user_id = 10001
order by create_time desc
limit 20;
```

理想索引：

```sql
create index idx_orders_user_time
    on orders(user_id, create_time);
```

期望：

```text
key:
    idx_orders_user_time

type:
    ref 或 range

rows:
    接近这个用户的订单数，而不是全表行数

Extra:
    尽量避免大范围 filesort
```

如果 `key = null`，先检查：

- 索引是否存在。
- where 字段类型是否一致。
- SQL 是否函数包裹字段。
- 数据量是否太小导致优化器选择全表扫。

## 案例：后台按状态查

SQL：

```sql
select id, order_no, user_id, status, create_time
from orders
where status = 'PAID'
  and create_time >= '2026-06-01 00:00:00'
  and create_time < '2026-06-02 00:00:00'
order by create_time desc
limit 50;
```

索引：

```sql
create index idx_orders_status_time
    on orders(status, create_time);
```

如果这条 SQL 很慢，别急着加更多索引。

先看：

```sql
explain select ...
```

再看：

```sql
select count(*)
from orders
where status = 'PAID'
  and create_time >= '2026-06-01 00:00:00'
  and create_time < '2026-06-02 00:00:00';
```

如果一天内 `PAID` 订单本来就几百万，索引也不能让它瞬间变快。

可能要：

- 增加更细筛选条件。
- 做按时间分区或归档。
- 后台异步导出。
- 报表预聚合。

## 案例：深分页

慢 SQL：

```sql
select id, order_no, create_time
from orders
where user_id = 10001
order by id
limit 100000, 20;
```

问题：

```text
MySQL 要先找到并跳过前 100000 行。
```

改游标分页：

```sql
select id, order_no, create_time
from orders
where user_id = 10001
  and id > #{lastId}
order by id
limit 20;
```

如果按时间倒序：

```sql
select id, order_no, create_time
from orders
where user_id = 10001
  and create_time < #{lastCreateTime}
order by create_time desc
limit 20;
```

索引：

```sql
create index idx_orders_user_time
    on orders(user_id, create_time);
```

## 案例：只查 ID 再回表

后台必须跳页时，可以先查 ID：

```sql
select id
from orders
where status = 'PAID'
order by create_time desc
limit 100000, 20;
```

再根据 ID 查详情：

```sql
select id, order_no, user_id, status, payable_amount, create_time
from orders
where id in (...);
```

这样第一步可以利用更小的索引扫描，减少大字段回表。

但这不是银弹。

深分页本质还是要跳过很多数据。

产品上也应该限制最大翻页深度。

## 索引设计流程

建议流程：

```text
1. 写出核心 SQL。
2. 标出等值条件、范围条件、排序字段、返回字段。
3. 设计联合索引。
4. 用 EXPLAIN 看 key、type、rows、Extra。
5. 用真实数据量测耗时。
6. 判断是否需要覆盖索引。
7. 判断索引写入成本是否可接受。
```

例子：

```sql
select id, order_no, status, create_time
from orders
where user_id = ?
  and status = ?
  and create_time < ?
order by create_time desc
limit 20;
```

标注：

```text
等值：
    user_id、status

范围 + 排序：
    create_time

返回：
    id、order_no、status、create_time
```

索引：

```sql
create index idx_orders_user_status_time
    on orders(user_id, status, create_time);
```

如果这是高频列表，可以考虑覆盖：

```sql
create index idx_orders_user_status_time_cover
    on orders(user_id, status, create_time, id, order_no);
```

是否值得，要看实际压力。

## 删除无用索引

索引不是建了就永远保留。

可以查看：

```sql
show index from orders;
```

以及通过监控和慢 SQL 判断哪些索引长期不用。

删除前要确认：

- 是否有线上 SQL 用到。
- 是否有定时任务用到。
- 是否有唯一约束语义。
- 是否影响外键。
- 是否是低频但关键的排障 SQL。

不要只因为“看起来没人用”就删。

唯一索引尤其要谨慎，因为它不仅是性能工具，还是业务约束。

## 常见误区

### 每个 where 字段都单独建索引

多个单列索引通常不如一个匹配 SQL 的联合索引。

### 只看 `key` 不看 `rows`

用了索引但扫描 200 万行，仍然可能慢。

### 看到 `Using filesort` 就一定要优化

小结果集排序可以接受。

要看数据量和耗时。

### 为了覆盖索引塞所有字段

索引变大，写入变慢。

覆盖索引只给高频、稳定查询。

### 忽略数据分布

同样的 SQL，在测试库 1000 行和生产库 1000 万行表现完全不同。

优化要用接近真实的数据量判断。

## 索引检查清单

- [ ] 每个索引都能对应一条真实 SQL。
- [ ] 联合索引从等值条件开始。
- [ ] 范围字段后面的字段没有被过度指望。
- [ ] 排序字段是否能利用索引顺序。
- [ ] 低选择性字段没有单独乱建索引。
- [ ] 高频查询是否需要覆盖索引。
- [ ] 写多表的索引数量是否克制。
- [ ] 慢 SQL 跑过 `EXPLAIN`。
- [ ] `type`、`key`、`rows`、`Extra` 都看过。
- [ ] 生产数据量和测试数据量差异被考虑过。

## 去空话检查

这篇没有只说“索引能优化查询”。

每个点都要求落到：

- 哪条 SQL。
- 哪个索引。
- 为什么这个顺序。
- `EXPLAIN` 看什么字段。
- 写入成本是什么。
- 慢分页怎么改。

如果一个索引说不出服务哪条 SQL，就不应该出现在设计里。

## 参考

- [MySQL Multiple-Column Indexes](https://dev.mysql.com/doc/refman/8.4/en/multiple-column-indexes.html)
- [MySQL Optimizing Queries with EXPLAIN](https://dev.mysql.com/doc/refman/8.4/en/using-explain.html)
