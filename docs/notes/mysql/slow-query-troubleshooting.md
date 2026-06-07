---
title: MySQL 慢 SQL 排查
sidebarTitle: 05 慢 SQL 排查
---

# MySQL 慢 SQL 排查

> 慢 SQL 排查不是看到慢就加索引，而是先定位 SQL，再确认数据量、执行计划、锁等待、返回字段、分页方式和业务访问路径。

## 先说结论

慢 SQL 排查顺序：

```text
1. 确认慢的是哪条 SQL。
2. 拿到真实参数。
3. 看表数据量和过滤后数据量。
4. 跑 EXPLAIN。
5. 看是否命中预期索引。
6. 看 rows、Extra、排序、临时表。
7. 判断是否有锁等待。
8. 判断是否是连接池耗尽。
9. 改 SQL、改索引或改业务查询方式。
10. 用真实数据量复测。
```

不要一上来就：

```text
加索引。
```

因为慢可能来自：

- 没有索引。
- 索引用错。
- 返回行太多。
- 深分页。
- 大字段回表。
- 排序和临时表。
- 锁等待。
- 连接池耗尽。
- 下游接口慢，但误以为 SQL 慢。

## 第一步：拿到慢 SQL

来源可能有：

- 应用日志。
- MyBatis SQL 日志。
- 慢查询日志。
- APM。
- `show full processlist`。
- 数据库监控平台。

应用日志里至少要能看到：

```text
SQL 模板。
参数。
耗时。
接口名。
traceId。
userId / orderId 等业务 ID。
```

如果只有：

```text
selectOrderList cost 3000ms
```

但没有 SQL 和参数，排查会很痛苦。

## 开启慢查询日志

查看是否开启：

```sql
show variables like 'slow_query_log';
show variables like 'long_query_time';
show variables like 'slow_query_log_file';
```

临时开启：

```sql
set global slow_query_log = on;
set global long_query_time = 1;
```

`long_query_time = 1` 表示超过 1 秒的查询记入慢日志。

生产环境不要随便长期开很低阈值。

要看数据库压力和日志量。

慢日志的价值：

```text
找到真实慢 SQL，而不是靠猜。
```

## 看当前正在跑的 SQL

```sql
show full processlist;
```

关注：

| 字段 | 看什么 |
| --- | --- |
| `Id` | 连接 ID |
| `User` | 哪个用户 |
| `Host` | 哪个应用机器 |
| `db` | 哪个库 |
| `Command` | 当前命令 |
| `Time` | 当前状态持续多久 |
| `State` | 是否 Sending data、Locked 等 |
| `Info` | 当前 SQL |

如果看到很多连接长时间：

```text
Locked
Waiting for ...
```

可能不是 SQL 本身慢，而是锁等待。

## 拿真实参数

同一条 SQL，不同参数可能差很多。

比如：

```sql
select *
from orders
where user_id = ?
order by create_time desc
limit 20;
```

用户 A 有 5 条订单。

用户 B 有 50 万条订单。

执行差异可能很大。

所以排查时要拿真实参数：

```text
user_id = 10001
status = PAID
start_time = 2026-06-01
end_time = 2026-06-07
```

不要只用本地随便造的数据测试。

## 看表数据量

先看总量：

```sql
select count(*) from orders;
```

再看过滤后数据量：

```sql
select count(*)
from orders
where user_id = 10001;
```

```sql
select count(*)
from orders
where status = 'PAID'
  and create_time >= '2026-06-01 00:00:00'
  and create_time < '2026-06-08 00:00:00';
```

如果过滤后仍然几十万行，SQL 慢很正常。

这时不一定是索引问题，可能是业务查询范围太大。

## 跑 EXPLAIN

```sql
explain
select id, order_no, status, create_time
from orders
where user_id = 10001
order by create_time desc
limit 20;
```

重点看：

```text
type
possible_keys
key
rows
filtered
Extra
```

判断：

- `key` 是否是预期索引。
- `rows` 是否太大。
- `Extra` 是否有 `Using filesort`。
- 是否出现 `Using temporary`。
- 是否全表扫描。

如果 MySQL 8 环境允许，可以用：

```sql
explain analyze
select ...
```

它会实际执行并返回更接近真实的执行统计。

生产慎用，尤其是大查询。

## 慢查询常见原因

### 没有索引

SQL：

```sql
select *
from orders
where user_id = 10001;
```

如果没有：

```sql
key idx_orders_user_time(user_id, create_time)
```

可能全表扫描。

### 索引顺序不匹配

索引：

```sql
key idx_status_time(status, create_time)
```

SQL：

```sql
where user_id = ?
order by create_time desc
```

这个索引帮不上核心过滤。

### 返回太多字段

错误：

```sql
select *
from product
where category_id = ?
limit 20;
```

如果 `product` 有大字段，列表页会被拖慢。

更好：

```sql
select id, product_name, price, main_image, sales_count
from product
where category_id = ?
limit 20;
```

详情页再查大字段。

### 深分页

```sql
limit 100000, 20
```

MySQL 要跳过大量行。

改游标分页：

```sql
where id > #{lastId}
order by id
limit 20
```

或限制最大页数。

### 排序没有合适索引

SQL：

```sql
where user_id = ?
order by create_time desc
```

索引：

```sql
key idx_user_time(user_id, create_time)
```

比只有：

```sql
key idx_user(user_id)
```

更适合。

### 锁等待

SQL 本身可能不慢，但在等锁。

表现：

```text
show processlist 里 Time 很长。
State 显示等待锁。
```

这时要查事务和锁，不是盲目加索引。

## 案例：用户订单列表慢

SQL：

```sql
select id, order_no, status, payable_amount, create_time
from orders
where user_id = 10001
order by create_time desc
limit 20;
```

排查：

```sql
show index from orders;
```

```sql
explain
select id, order_no, status, payable_amount, create_time
from orders
where user_id = 10001
order by create_time desc
limit 20;
```

期望索引：

```sql
create index idx_orders_user_time
    on orders(user_id, create_time);
```

如果用户订单特别多，仍然慢，可以考虑：

- 游标分页。
- 只查轻量字段。
- 限制时间范围。
- 对历史订单归档。

## 案例：后台订单列表慢

SQL：

```sql
select id, order_no, user_id, status, payable_amount, create_time
from orders
where status = 'PAID'
  and create_time >= '2026-06-01 00:00:00'
  and create_time < '2026-06-08 00:00:00'
order by create_time desc
limit 50;
```

索引：

```sql
create index idx_orders_status_time
    on orders(status, create_time);
```

如果一周内已支付订单太多，后台还要查很多条件：

- 收货人手机号。
- 订单号。
- 用户 ID。
- 支付状态。

可能需要把查询拆成不同路径。

比如：

```text
按 order_no 精确查：
    走 uk_order_no。

按 user_id 查：
    走 idx_user_time。

按 status + time 查：
    走 idx_status_time。
```

不要指望一个万能索引服务所有后台筛选。

## 案例：`select *` 拖慢列表

商品表：

```sql
product (
    id,
    name,
    price,
    main_image,
    detail_html,
    attributes_json,
    create_time
)
```

列表页错误：

```sql
select *
from product
where category_id = #{categoryId}
limit 20;
```

问题：

```text
detail_html、attributes_json 这些详情字段也被查出来。
网络传输和对象映射都变慢。
```

更好：

```sql
select id, name, price, main_image
from product
where category_id = #{categoryId}
limit 20;
```

详情页：

```sql
select id, name, price, main_image, detail_html, attributes_json
from product
where id = #{id};
```

## 案例：函数导致索引用不上

错误：

```sql
select id, order_no
from orders
where date(create_time) = '2026-06-01';
```

改成：

```sql
select id, order_no
from orders
where create_time >= '2026-06-01 00:00:00'
  and create_time < '2026-06-02 00:00:00';
```

索引：

```sql
create index idx_orders_create_time
    on orders(create_time);
```

原则：

```text
不要对索引字段做函数。
把计算放在常量上。
```

## 案例：统计接口慢

SQL：

```sql
select status, count(*)
from orders
where create_time >= '2026-06-01 00:00:00'
  and create_time < '2026-07-01 00:00:00'
group by status;
```

如果订单量很大，每次实时统计都会慢。

优化方向：

- 缩小时间范围。
- 增加合适索引。
- 做按天统计表。
- 定时预聚合。
- 后台异步生成报表。

不要所有报表都实时扫订单主表。

## 锁等待和慢 SQL 的区别

慢 SQL 是：

```text
自己执行计划差，扫描多，排序多。
```

锁等待是：

```text
SQL 本身可能很快，但被其他事务挡住。
```

排查锁等待：

```sql
show full processlist;
show engine innodb status;
```

关注：

- 长事务。
- `Locked`。
- 等待时间。
- 哪条 SQL 持锁。
- 哪条 SQL 等锁。

如果是锁等待，解决方案可能是：

- 缩短事务。
- 优化更新条件索引。
- 固定更新顺序。
- 拆小批量。
- 找出长事务来源。

不是单纯加索引。

## 连接池耗尽

接口慢也可能是拿不到数据库连接。

Spring Boot HikariCP 常见现象：

```text
Connection is not available, request timed out
```

排查：

- 活跃连接数是否打满。
- 是否有慢 SQL 占着连接。
- 是否有长事务。
- 连接池大小是否合理。
- 数据库最大连接数是否允许。

不要一上来把连接池改大。

如果根因是慢 SQL，连接池调大只会让更多请求同时打到数据库。

## 优化手段优先级

通常按这个顺序：

```text
1. 减少不必要查询。
2. 缩小查询范围。
3. 只返回必要字段。
4. 改分页方式。
5. 设计合适索引。
6. 拆大表或归档历史数据。
7. 缓存热点结果。
8. 异步化报表和导出。
9. 预聚合。
10. 引入搜索或分析系统。
```

索引很重要，但不是唯一手段。

## MyBatis 里怎么辅助排查

Mapper 方法要有语义：

```java
public interface OrderMapper {

    /**
     * 查询用户订单列表。
     *
     * <p>使用 idx_orders_user_time 索引，按创建时间倒序分页。</p>
     */
    List<OrderListVO> selectUserOrderList(@Param("userId") Long userId,
                                          @Param("lastCreateTime") LocalDateTime lastCreateTime,
                                          @Param("limit") int limit);
}
```

XML 里不要写过度复杂的动态 SQL。

复杂后台筛选可以拆成多个查询路径：

- 精确订单号查询。
- 用户维度查询。
- 状态时间范围查询。
- 导出任务查询。

不要一个 Mapper 方法通过几十个 `<if>` 拼出万能 SQL。

## 慢 SQL 排查记录模板

排查时记录：

```text
接口：
    GET /api/orders

慢 SQL：
    select ...

参数：
    user_id = 10001

耗时：
    3.2s

表数据量：
    orders 1200 万行

过滤后数据量：
    user_id = 10001 有 48 万行

EXPLAIN：
    key = idx_orders_user_time
    rows = 480000
    Extra = Using where

根因：
    用户订单量过大，offset 分页过深。

处理：
    改游标分页。
    列表只返回轻量字段。
    限制最大查询时间范围。

验证：
    真实参数下耗时从 3.2s 降到 80ms。
```

这种记录比“加了索引，优化了 SQL”有用得多。

## 检查清单

- [ ] 是否拿到了真实 SQL 和参数。
- [ ] 是否知道表总行数。
- [ ] 是否知道过滤后行数。
- [ ] 是否跑过 `EXPLAIN`。
- [ ] `key` 是否符合预期。
- [ ] `rows` 是否过大。
- [ ] 是否有 `Using filesort` 或 `Using temporary`。
- [ ] 是否存在深分页。
- [ ] 是否 `select *`。
- [ ] 是否查了大字段。
- [ ] 是否函数包裹索引字段。
- [ ] 是否有锁等待。
- [ ] 是否连接池耗尽。
- [ ] 是否可以缩小业务查询范围。
- [ ] 优化后是否用真实数据复测。

## 去空话检查

这篇没有写“慢 SQL 要优化索引”这种大话。

它要求每次排查必须有：

- 慢 SQL 原文。
- 真实参数。
- 表数据量。
- `EXPLAIN`。
- 锁等待判断。
- 连接池判断。
- 优化前后耗时对比。

没有这些证据，就不能说“已经优化了”。

## 参考

- [MySQL Slow Query Log](https://dev.mysql.com/doc/refman/8.4/en/slow-query-log.html)
- [MySQL SHOW PROCESSLIST](https://dev.mysql.com/doc/refman/8.4/en/show-processlist.html)
- [MySQL Optimizing Queries with EXPLAIN](https://dev.mysql.com/doc/refman/8.4/en/using-explain.html)
