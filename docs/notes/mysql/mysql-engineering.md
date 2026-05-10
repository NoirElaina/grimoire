---
title: MySQL 工程实践
sidebarTitle: 01 工程实践
---

# MySQL 工程实践

MySQL 最容易被学成两种极端：

- 只会写 CRUD，项目一慢就不知道为什么
- 背了一堆索引和事务概念，但落不到工程实现

所以这篇不按数据库教材来讲，而是按 Java 后端项目里真正会遇到的问题来讲：**表怎么设计、索引怎么建、SQL 怎么写、事务怎么控、慢查询怎么排。**

## 先说结论

普通业务系统里，MySQL 最稳的实践通常是：

1. 表设计先围绕读写场景，而不是只围绕“字段能存下”。
2. 索引优先服务查询路径，不要靠感觉乱加。
3. Service 层事务要短，不要把远程调用包进大事务。
4. 分页、排序、模糊搜索要提前想索引，不要上线后再补。
5. 遇到慢接口先看 SQL 和执行计划，不要先怀疑 Java 代码。

一句话就是：

**MySQL 在工程里最重要的不是会不会写 SQL，而是能不能把“数据结构、查询路径、事务边界”一起设计好。**

## 表设计先看读写场景

很多表一开始就设计歪，是因为只从“字段需要哪些”出发，而不是从“后面怎么查、怎么改”出发。

例如一个订单表，除了字段本身，你最好先问：

- 最常按什么条件查询
- 最常按什么维度分页
- 是否会按用户维度查最近订单
- 是否有状态流转更新
- 是否会按时间清理历史数据

一个比较常见的订单表可以先长这样：

```sql
CREATE TABLE `orders` (
  `id` BIGINT NOT NULL,
  `order_no` VARCHAR(64) NOT NULL,
  `user_id` BIGINT NOT NULL,
  `status` TINYINT NOT NULL,
  `amount` DECIMAL(12,2) NOT NULL,
  `create_time` DATETIME NOT NULL,
  `update_time` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_order_no` (`order_no`),
  KEY `idx_user_status_ctime` (`user_id`, `status`, `create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

这里最关键的不是语法，而是：

- `id` 负责主键定位
- `order_no` 负责业务唯一性
- `(user_id, status, create_time)` 明确服务一类真实查询

## 主键怎么选

普通项目里最常见的是：

- 自增主键
- 雪花 ID / 分布式 ID

工程上先记住两个重点：

1. 主键最好短、稳定、不可变。
2. 业务唯一键和主键通常不是一回事。

例如订单系统里：

- 主键：`id`
- 业务唯一键：`order_no`

不要因为业务编号“更有意义”就直接拿来做主键。

## 索引设计不要脱离查询语句

索引不是越多越好，也不是“感觉这里以后可能会查”就先建上。

一个索引是否值得建，通常先看：

- 真实查询条件
- 是否排序
- 是否分页
- 是否回表可以接受

例如这个查询：

```sql
SELECT id, order_no, status, amount, create_time
FROM orders
WHERE user_id = ?
  AND status = ?
ORDER BY create_time DESC
LIMIT 20;
```

它就很适合对应：

```sql
KEY idx_user_status_ctime (user_id, status, create_time)
```

这就是典型的“索引围绕查询设计”，而不是“字段热门就单独建一个索引”。

## 联合索引最重要的是顺序

很多人知道要建联合索引，但顺序还是靠猜。

先记住一个很实用的原则：

- 等值条件优先
- 排序字段随后
- 范围条件通常放后面

例如：

```sql
WHERE user_id = ?
  AND status = ?
ORDER BY create_time DESC
```

比起：

```sql
(create_time, user_id, status)
```

更合理的往往是：

```sql
(user_id, status, create_time)
```

因为查询真正的过滤起点是 `user_id + status`。

## 不要看到慢 SQL 就只会“加索引”

慢查询常见原因至少有这些：

- 没索引
- 索引顺序不对
- 查太多列
- 回表成本高
- 排序 / 分组走临时表
- 分页太深

所以慢 SQL 排查顺序通常应该是：

1. 先看原 SQL
2. 再看 `EXPLAIN`
3. 再决定要不要改索引、改 SQL、改分页方式

## `EXPLAIN` 最少先看什么

别一上来就想把所有字段背下来，工程里先重点看：

- `type`
- `key`
- `rows`
- `Extra`

例如：

```sql
EXPLAIN
SELECT id, order_no, status, amount, create_time
FROM orders
WHERE user_id = 1001
  AND status = 1
ORDER BY create_time DESC
LIMIT 20;
```

你至少想确认：

- 有没有命中期望索引
- 扫描行数是不是离谱
- 是否出现 `Using filesort`
- 是否出现 `Using temporary`

## 分页为什么经常慢

因为很多人写分页默认就是：

```sql
SELECT *
FROM orders
ORDER BY create_time DESC
LIMIT 100000, 20;
```

这在页数很深时会很痛苦。  
数据库要先跳过前面大量记录，再拿后面的 20 条。

### 更稳的做法

如果是时间线类列表，优先考虑基于上次游标翻页：

```sql
SELECT id, order_no, create_time
FROM orders
WHERE create_time < ?
ORDER BY create_time DESC
LIMIT 20;
```

这类写法在大表里通常比深度 `offset` 稳很多。

## 模糊查询别默认上 `%keyword%`

这也是很常见的性能坑。

```sql
WHERE username LIKE '%alice%'
```

这类前后都模糊的搜索，普通 B+Tree 索引通常帮不上什么忙。  
所以一开始就要想清：

- 是前缀搜索？
- 还是全文搜索？
- 还是要接搜索引擎？

不要把“复杂搜索需求”硬塞给普通索引。

## 事务边界不要包太大

Java 项目里最典型的问题不是“不会开事务”，而是事务开太大。

例如：

```java
@Transactional
public void createOrder(CreateOrderRequest request) {
    orderMapper.insert(...);
    userClient.getById(request.getUserId());
    stockClient.lock(...);
    messageProducer.send(...);
}
```

这种写法风险很高，因为你把：

- 数据库写
- 远程调用
- 外部副作用

全放进了一个事务方法里。

更稳的原则通常是：

- 数据库事务尽量只包本地数据库操作
- 远程调用不要卡在长事务里
- 异步消息、状态推进、补偿逻辑拆出来设计

## InnoDB 为什么默认更适合业务系统

普通业务系统里，最关键的通常是：

- 行级锁
- 事务
- 崩溃恢复

所以 InnoDB 基本就是默认选项。  
工程上真正要理解的是：

- 你在享受事务和并发控制时，也要接受它的锁行为和索引路径约束

## 行锁不是“写这一行就一定只锁这一行”

很多并发问题都卡在这里。

InnoDB 的行锁很多时候依赖索引命中路径。  
如果你的更新没有走好索引，锁范围可能会扩大。

例如：

```sql
UPDATE orders
SET status = 2
WHERE order_no = 'A202605110001';
```

如果 `order_no` 上有唯一索引，这通常会非常干净。  
如果没有，代价就会大很多。

也就是说，**索引设计不只是为了查询性能，也是在影响锁粒度。**

## 死锁别只会“重试一下”

死锁在高并发更新里并不罕见，但重点不是“见到死锁就 catch 住”，而是先看它为什么发生。

常见原因包括：

- 两个事务更新资源顺序不一致
- 范围更新锁住了交叉区间
- 缺索引导致锁范围扩大

例如两个事务：

- 事务 A：先改订单，再改库存
- 事务 B：先改库存，再改订单

这种就是典型死锁温床。

更稳的思路通常是：

- 统一更新顺序
- 尽量缩短事务
- 用好索引

## Java 代码里事务怎么写更稳

Service 层里，一个比较合理的事务方法通常是这样的：

```java
@Transactional
public void payOrder(Long orderId) {
    OrderEntity order = orderMapper.selectById(orderId);
    if (order == null) {
        throw new BizException(40401, "order not found");
    }
    if (order.getStatus() != 1) {
        throw new BizException(40001, "order status invalid");
    }

    orderMapper.updateStatus(orderId, 2);
    paymentRecordMapper.insert(...);
}
```

重点是：

- 事务内是本地数据库动作
- 状态判断和状态流转尽量紧凑
- 不把外部网络调用放进事务中间

## MyBatis / MyBatis-Plus 层别把 SQL 隐掉太深

MyBatis-Plus 很方便，但数据库问题一出来，你最后还是得知道 SQL 长什么样。

所以比较推荐的是：

- 单表通用操作可以用 MyBatis-Plus
- 复杂查询、报表、联表老老实实写 SQL
- 慢查询排查时一定能落回真实 SQL

别让 ORM 包装层把 SQL 彻底藏起来。

## 慢查询排查一条比较实用的路径

如果你线上接口慢，先按这条路径走：

1. 先看应用日志里的 SQL 耗时或 traceId
2. 找到具体慢 SQL
3. 用 `EXPLAIN` 看执行计划
4. 判断是索引问题、SQL 写法问题，还是数据量问题
5. 再决定改 SQL、加索引，还是改分页方式

不要先盲猜：

- “是不是线程池小了”
- “是不是 Spring 慢”

很多时候就是 SQL 路径不对。

## 一种比较推荐的 MySQL 工程实践

如果是普通业务系统，我会这样落：

1. 主键和业务唯一键分开设计。
2. 索引围绕真实查询路径建立。
3. Service 事务尽量短，只包本地数据库动作。
4. 分页和排序接口在设计期就考虑索引。
5. 复杂搜索别强行用普通索引硬扛。
6. 慢查询先看 SQL 和 `EXPLAIN`，再谈框架层优化。
7. 并发更新链路提前考虑锁顺序和索引命中。

## 最后记一句话

**MySQL 工程能力的核心，不是会写多少 SQL，而是能不能把“表结构、索引、事务、查询路径、并发行为”一起想清楚。**

只要这五件事能连起来，很多数据库问题都会提前消失。
