---
title: MySQL 工程实践
sidebarTitle: 00 工程实践总览
---

# MySQL 工程实践

> MySQL 不只是会写 SQL，更重要的是把表结构、索引、事务、锁和 Java 代码一起设计。

## 先给结论

普通 Java 后端里，MySQL 最稳的做法：

- 先看业务读写场景，再建表。
- 每个索引都要对应真实查询。
- 联合索引顺序按过滤、排序、区分度设计。
- 事务边界放在 Service，且尽量小。
- 不在事务里调用远程 HTTP、MQ、Redis 慢操作。
- 更新核心数据用条件更新兜住并发。
- 慢 SQL 先 `EXPLAIN`，不要只会加索引。
- Redis、MQ、ES 都不能替代 MySQL 的最终一致性。

## 表设计先写访问路径

建表前先写清楚：

```text
订单表 t_order

主要写入：
- 用户下单创建订单
- 支付成功更新状态
- 取消订单更新状态

主要查询：
- 按 order_no 查详情
- 按 user_id 分页查订单列表，按 create_time 倒序
- 后台按 status、create_time 分页查
- 定时任务扫描超时未支付订单

并发点：
- 支付、取消不能同时成功
- 同一个 order_no 不能重复
```

然后再建表：

```sql
create table t_order (
    id bigint not null primary key,
    order_no varchar(64) not null,
    user_id bigint not null,
    amount decimal(18, 2) not null,
    status tinyint not null,
    pay_time datetime null,
    create_time datetime not null,
    update_time datetime not null,
    deleted tinyint not null default 0,
    version int not null default 0,
    unique key uk_order_no(order_no),
    key idx_user_time(user_id, create_time),
    key idx_status_time(status, create_time)
) engine = InnoDB default charset = utf8mb4;
```

表设计不是字段堆砌，而是把未来的查询和并发写提前放进去。

## 字段类型

常用建议：

| 数据 | 类型 | 备注 |
| --- | --- | --- |
| 主键 | `bigint` | 雪花 ID、自增 ID 都常见 |
| 金额 | `decimal(18,2)` | 不用 `double` / `float` |
| 状态 | `tinyint` / `smallint` | Java 里用枚举映射 |
| 时间 | `datetime` | 业务时间更直观 |
| 是否删除 | `tinyint` | `0` 未删，`1` 已删 |
| 短文本 | `varchar` | 长度按业务限制 |
| 长文本 | `text` | 不要放进高频列表查询 |
| JSON | `json` | 适合扩展字段，不适合核心查询条件 |

注意：

- 字段尽量 `not null`，给默认值。
- 状态字段要有注释和枚举说明。
- 金额、库存、积分不要用浮点类型。
- 大字段拆表或延迟查询，别让列表页每次都扫。

## 主键怎么选

常见方案：

| 方案 | 优点 | 注意 |
| --- | --- | --- |
| 自增 ID | 简单、聚簇索引友好 | 分库分表不方便，暴露业务规模 |
| 雪花 ID | 分布式生成、趋势递增 | 依赖时钟，长度大 |
| UUID | 全局唯一 | 太长、随机写入不友好 |
| 业务单号 | 可读性好 | 不建议直接做主键 |

推荐：

- 内部主键用 `bigint`。
- 对外展示用业务单号：`order_no`。
- 业务单号加唯一索引。
- 不要用手机号、邮箱、用户名当主键。

## 索引先服务 SQL

先写 SQL，再设计索引。

查询用户订单：

```sql
select id, order_no, amount, status, create_time
from t_order
where user_id = 10001
  and deleted = 0
order by create_time desc
limit 20;
```

索引：

```sql
create index idx_user_deleted_time on t_order(user_id, deleted, create_time);
```

后台按状态查：

```sql
select id, order_no, user_id, amount, status, create_time
from t_order
where status = 1
  and create_time >= '2026-06-01 00:00:00'
  and create_time < '2026-06-02 00:00:00'
order by create_time desc
limit 20;
```

索引：

```sql
create index idx_status_time on t_order(status, create_time);
```

原则：

- 没有查询场景的索引不要建。
- 写多读少的表，索引更要克制。
- 唯一约束优先用唯一索引兜住。
- 低选择性字段单独建索引通常收益不大。

## 联合索引顺序

联合索引不是字段随便排：

```sql
create index idx_user_status_time on t_order(user_id, status, create_time);
```

适合：

```sql
where user_id = ?
  and status = ?
order by create_time desc
```

也能用到前缀：

```sql
where user_id = ?
```

但不适合只按 `status` 查：

```sql
where status = ?
```

因为没有从最左列 `user_id` 开始。

一般顺序：

```text
等值条件 -> 范围条件 / 排序字段
```

例子：

```sql
where user_id = ?
  and status = ?
  and create_time >= ?
order by create_time desc
```

索引：

```sql
create index idx_user_status_time on t_order(user_id, status, create_time);
```

注意：范围条件之后的字段通常很难继续充分利用索引进行过滤。

## 覆盖索引

如果查询字段都在索引里，可能不用回表：

```sql
select id, order_no, status, create_time
from t_order
where user_id = ?
order by create_time desc
limit 20;
```

索引：

```sql
create index idx_user_time_cover
on t_order(user_id, create_time, id, order_no, status);
```

不要为了覆盖索引把所有字段都塞进去：

- 索引越大，写入越慢。
- 占用更多磁盘和内存。
- 维护成本更高。

只给高频、稳定、收益明确的查询做覆盖索引。

## `EXPLAIN` 看什么

最少看这些列：

| 字段 | 重点 |
| --- | --- |
| `type` | 是否 `ALL` 全表扫 |
| `possible_keys` | 理论可用索引 |
| `key` | 实际使用索引 |
| `rows` | 预估扫描行数 |
| `Extra` | 是否 `Using filesort`、`Using temporary` |

示例：

```sql
explain
select id, order_no, amount
from t_order
where user_id = 10001
order by create_time desc
limit 20;
```

排查顺序：

1. `key` 是否使用预期索引。
2. `rows` 是否明显过大。
3. `Extra` 是否有 `Using filesort`。
4. where 条件是否写法导致索引失效。
5. 返回列是否导致大量回表。

不要看到 `Using filesort` 就恐慌，关键看数据量、耗时、是否可接受。

## 常见索引失效写法

函数包裹字段：

```sql
where date(create_time) = '2026-06-01'
```

改成范围：

```sql
where create_time >= '2026-06-01 00:00:00'
  and create_time < '2026-06-02 00:00:00'
```

左模糊：

```sql
where username like '%alice'
```

类型不一致：

```sql
where user_id = '10001'
```

对字段计算：

```sql
where amount + 10 > 100
```

低选择性字段单独索引：

```sql
where deleted = 0
```

`deleted` 通常要和其他过滤字段组成联合索引，而不是单独建。

## 分页为什么慢

慢分页：

```sql
select id, order_no, amount, create_time
from t_order
where user_id = 10001
order by id
limit 100000, 20;
```

问题：MySQL 需要跳过前 100000 行。

更稳的游标分页：

```sql
select id, order_no, amount, create_time
from t_order
where user_id = 10001
  and id > 900000
order by id
limit 20;
```

按时间倒序：

```sql
select id, order_no, amount, create_time
from t_order
where user_id = 10001
  and create_time < '2026-06-01 12:00:00'
order by create_time desc
limit 20;
```

后台必须跳页时：

- 限制最大页数。
- 用搜索条件缩小范围。
- 只查 ID 后回表。
- 做异步导出，不让列表页硬翻十万页。

## 模糊查询

普通索引适合：

```sql
where username like 'alice%'
```

不适合：

```sql
where username like '%alice%'
```

如果业务需要任意包含搜索：

- 数据量小：可以接受，但要限范围。
- 数据量中等：考虑专门搜索字段、前缀、倒排表。
- 数据量大：用 ES / OpenSearch / 专门检索服务。

不要在核心高频接口里直接上 `%keyword%`。

## 事务边界

事务放 Service：

```java
@Service
public class OrderServiceImpl implements OrderService {

    @Override
    @Transactional(rollbackFor = Exception.class)
    public Long createOrder(CreateOrderCommand command) {
        Long orderId = orderRepository.create(command);
        stockRepository.freeze(command.skuId(), command.quantity());
        return orderId;
    }
}
```

事务里不要做：

- 远程 HTTP 调用。
- 等待 MQ 结果。
- 大文件处理。
- 大量循环写入。
- 用户交互等待。

原因：事务越久，锁持有越久，死锁和连接池耗尽风险越高。

推荐：

```text
事务内：写数据库、写 outbox、更新必要状态
事务外：发 MQ、调远程、刷新缓存
```

## 隔离级别

常见现象：

| 问题 | 含义 |
| --- | --- |
| 脏读 | 读到别人未提交的数据 |
| 不可重复读 | 同一事务两次读同一行结果不同 |
| 幻读 | 同一事务两次范围查询行数不同 |

MySQL InnoDB 常用默认隔离级别是 `REPEATABLE READ`。

工程上更常见的重点不是背概念，而是：

- 查询是否需要锁。
- 更新是否带条件。
- 事务是否过大。
- 是否靠唯一索引防重复。
- 是否能接受重试。

## 条件更新兜并发

订单取消：

```sql
update t_order
set status = 3,
    update_time = now()
where id = 10001
  and status = 1;
```

Java：

```java
int rows = orderMapper.cancel(orderId, OrderStatus.CREATED, OrderStatus.CANCELED);
if (rows != 1) {
    throw new BizException(ErrorCode.ORDER_STATUS_CHANGED);
}
```

库存扣减：

```sql
update sku_stock
set available_stock = available_stock - #{quantity}
where sku_id = #{skuId}
  and available_stock >= #{quantity};
```

受影响行数为 1 才算成功。

条件更新比“先查再改”更能扛并发。

## 行锁不是总能锁一行

InnoDB 行锁建立在索引访问路径上。

危险写法：

```sql
update t_order
set status = 3
where order_no = 'NO10001';
```

如果 `order_no` 没有索引，可能扫描很多行，锁范围也会变大。

更稳：

```sql
alter table t_order add unique key uk_order_no(order_no);
```

然后再更新：

```sql
update t_order
set status = 3
where order_no = 'NO10001'
  and status = 1;
```

写 SQL 时要确认 where 条件能命中索引。

## 死锁怎么处理

死锁不是一句“重试一下”就完了。

先拿现场：

```sql
show engine innodb status;
```

看：

- 哪两个事务。
- 分别持有什么锁。
- 等待什么锁。
- 涉及哪条 SQL。
- 是否访问顺序不一致。

常见原因：

- 多个事务更新表顺序不一致。
- 批量更新 ID 顺序不一致。
- 没有索引导致锁范围过大。
- 事务里夹杂慢操作。

修法：

- 固定更新顺序。
- 缩小事务。
- 给条件加合适索引。
- 批量操作按 ID 排序。
- 死锁可重试，但要有次数和日志。

重试示例：

```java
for (int attempt = 1; attempt <= 3; attempt++) {
    try {
        return orderService.cancelOrder(command);
    } catch (DeadlockLoserDataAccessException exception) {
        if (attempt == 3) {
            throw exception;
        }
        Thread.sleep(50L * attempt);
    }
}
```

## 慢查询排查路径

按这个顺序：

1. 找到慢 SQL 和参数。
2. 看数据量：表总行数、过滤后行数。
3. 跑 `EXPLAIN`。
4. 看是否命中预期索引。
5. 看是否有排序、临时表、回表。
6. 检查 where 条件写法。
7. 检查是否需要改索引或改 SQL。
8. 检查是否能用缓存、异步、预计算。

常用 SQL：

```sql
show full processlist;

explain select ...

show index from t_order;
```

慢查询优化不要只盯 SQL：

- 接口是否需要这么多字段。
- 是否应该分页。
- 是否可以拆成两次查询。
- 是否可以异步导出。
- 是否应该换成搜索引擎。

## MyBatis / MyBatis-Plus 里的 SQL

简单单表可以用 Wrapper：

```java
LambdaQueryWrapper<OrderEntity> wrapper = Wrappers.lambdaQuery(OrderEntity.class)
    .eq(OrderEntity::getUserId, userId)
    .eq(OrderEntity::getDeleted, 0)
    .orderByDesc(OrderEntity::getCreateTime);
```

复杂 SQL 放 XML：

```xml
<select id="selectOrderPage" resultType="com.example.order.vo.OrderListVO">
    select
        o.id,
        o.order_no,
        o.amount,
        o.status,
        u.nickname as user_nickname
    from t_order o
    left join t_user u on u.id = o.user_id
    where o.deleted = 0
    <if test="query.status != null">
        and o.status = #{query.status}
    </if>
    order by o.create_time desc
</select>
```

Mapper 方法加注释：

```java
public interface OrderMapper {

    /**
     * 分页查询后台订单列表。
     *
     * <p>用于管理端组合筛选，SQL 依赖 idx_status_time 索引；列表只返回轻量字段。</p>
     */
    IPage<OrderListVO> selectOrderPage(Page<OrderListVO> page,
                                       @Param("query") OrderPageQuery query);
}
```

不要把复杂 SQL 藏在二十行 Wrapper 里，后面排查会很痛苦。

## 连接池

HikariCP 常见配置：

```yaml
spring:
  datasource:
    hikari:
      maximum-pool-size: 20
      minimum-idle: 5
      connection-timeout: 3000
      idle-timeout: 600000
      max-lifetime: 1800000
```

排查连接池问题看：

- 活跃连接数。
- 等待连接数。
- 获取连接耗时。
- 慢 SQL。
- 事务是否长时间不提交。
- 是否连接泄漏。

不要盲目把连接池调很大。数据库承受不住时，只会把问题放大。

## Redis 与 MySQL 一致性

常见做法：

```text
读：先 Redis，未命中查 MySQL，回填 Redis
写：先写 MySQL，提交后删 Redis
```

不要：

```text
先删 Redis -> 再写 MySQL -> 事务失败
```

更稳：

```java
@Transactional(rollbackFor = Exception.class)
public void updateProduct(UpdateProductCommand command) {
    productMapper.updateById(command.toEntity());

    TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
        @Override
        public void afterCommit() {
            redisTemplate.delete(ProductCacheKey.detail(command.productId()));
        }
    });
}
```

强一致要求更高：

- 写 MySQL。
- 事务内写 outbox。
- 异步消费 outbox 删除缓存。
- 删除失败重试。
- 定时对账补偿。

## 建表检查清单

- [ ] 表有明确读写场景。
- [ ] 主键类型统一。
- [ ] 有唯一约束兜住业务唯一性。
- [ ] 金额不用浮点类型。
- [ ] 状态字段有枚举说明。
- [ ] 高频查询字段有对应索引。
- [ ] 联合索引顺序匹配 SQL。
- [ ] 大字段不进入高频列表查询。
- [ ] `create_time`、`update_time`、`deleted` 规则统一。
- [ ] 逻辑删除和唯一索引冲突已处理。

## SQL 检查清单

- [ ] 查询字段没有 `select *`。
- [ ] where 条件能命中索引。
- [ ] 没有函数包裹索引字段。
- [ ] 没有不必要的左模糊。
- [ ] 分页限制了最大页数或用了游标。
- [ ] 排序字段有索引或可接受。
- [ ] 慢 SQL 跑过 `EXPLAIN`。
- [ ] 更新 / 删除带明确条件。
- [ ] 批量操作有大小限制。
- [ ] 事务里没有远程调用。

## 参考

- [MySQL Optimizing Queries with EXPLAIN](https://dev.mysql.com/doc/refman/8.4/en/using-explain.html)
- [MySQL Multiple-Column Indexes](https://dev.mysql.com/doc/refman/8.4/en/multiple-column-indexes.html)
- [MySQL InnoDB Locking](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking.html)
- [MySQL InnoDB Deadlocks](https://dev.mysql.com/doc/refman/8.4/en/innodb-deadlocks.html)
