---
title: MySQL 入门与基础模型
sidebarTitle: 01 基础模型
---

# MySQL 入门与基础模型

> 学 MySQL 不要从背 SQL 语法开始，先把“库、表、行、索引、事务、连接、执行路径”这些基础模型搞清楚。后面排查慢 SQL、死锁、事务问题都靠这些模型。

## MySQL 在后端里负责什么

MySQL 在业务系统里通常是最终事实来源。

也就是说：

```text
订单到底有没有创建。
用户到底有没有支付。
库存到底还剩多少。
优惠券到底有没有发。
```

这些最终都要以 MySQL 里的数据为准。

Redis、MQ、ES 可以辅助：

- Redis 提升读性能。
- MQ 解耦和异步。
- ES 做搜索。

但核心一致性一般还是落在 MySQL。

所以后端写 MySQL 时，重点不是“查得出来”，而是：

```text
查得准。
写得对。
并发下不乱。
慢了能查。
错了能修。
```

## 最小概念模型

先记住这条线：

```text
database
  -> table
  -> row
  -> column
  -> index
  -> transaction
```

对应到项目：

```text
flashmart 数据库
  -> orders 表
  -> 某一笔订单记录
  -> order_no / user_id / status / create_time 字段
  -> uk_order_no / idx_user_time 索引
  -> 下单、支付、取消这些事务
```

## database 是什么

一个 database 可以理解成一个业务系统的数据命名空间。

比如：

```sql
create database flashmart default character set utf8mb4;
use flashmart;
```

工程里常见规则：

- 一个应用一个主库，先不要乱拆。
- 开发、测试、生产环境分开。
- 不同环境不要共用同一个库。
- 本地库可以重建，生产库不能随便清。

连接 MySQL 时，后端配置通常要指定：

```yaml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/flashmart
    username: root
    password: your-password
```

## table 是什么

表是业务对象的结构化存储。

比如订单表：

```sql
create table orders (
    id bigint primary key auto_increment,
    order_no varchar(64) not null,
    user_id bigint not null,
    status varchar(32) not null,
    total_amount decimal(18, 2) not null,
    create_time datetime not null,
    update_time datetime not null,
    unique key uk_orders_order_no (order_no),
    key idx_orders_user_time (user_id, create_time)
) engine = InnoDB default charset = utf8mb4;
```

一张表设计时要回答：

```text
它表示哪个业务对象？
主键是什么？
业务唯一键是什么？
主要按什么条件查？
哪些字段会被更新？
哪些状态不能被并发改乱？
```

如果这些问题没想清楚，后面索引和事务都会乱。

## row 是什么

一行就是一条业务事实。

比如：

```text
orders 表的一行 = 一笔订单。
users 表的一行 = 一个用户。
product 表的一行 = 一个商品。
```

工程里要避免一行表达太多概念。

错误例子：

```text
订单表里同时塞订单主信息、订单明细、支付流水、物流信息、优惠券信息。
```

问题：

- 字段越来越多。
- 高频列表查询拖慢。
- 更新不同业务会互相影响。
- 锁住一行时影响太大。

更稳：

```text
orders:
    订单主表。

order_items:
    订单明细。

payment_order:
    支付单。

shipment:
    发货信息。
```

## column 是什么

字段是业务属性。

字段设计不是随便选类型，而是要考虑：

- 值是否允许为空。
- 是否参与查询。
- 是否参与排序。
- 是否参与唯一约束。
- 是否会频繁更新。
- 数据长度未来会不会增长。

比如金额：

```sql
total_amount decimal(18, 2) not null
```

不要用：

```sql
total_amount double
```

因为浮点数是近似值，不适合金额。

比如状态：

```sql
status varchar(32) not null
```

或者：

```sql
status tinyint not null
```

关键是要在代码里有枚举对应，不要让魔法值散落。

## primary key 是什么

主键是数据库定位一行记录的核心标识。

常见：

```sql
id bigint primary key auto_increment
```

主键要满足：

- 唯一。
- 不为空。
- 尽量不变。
- 尽量短。
- 尽量适合索引组织。

不要用这些做主键：

- 手机号。
- 邮箱。
- 用户名。
- 订单号。

这些更适合作为业务唯一键。

推荐：

```text
id:
    内部主键。

order_no:
    外部展示和业务追踪。
```

## unique key 是什么

唯一索引用来兜住业务唯一性。

比如订单号不能重复：

```sql
unique key uk_orders_order_no (order_no)
```

比如用户手机号不能重复：

```sql
unique key uk_users_phone (phone)
```

它的价值不只是加速查询，更重要是防并发重复写。

不要只靠代码判断：

```java
User user = userMapper.selectByPhone(phone);
if (user == null) {
    userMapper.insert(newUser);
}
```

并发下两个请求可能同时查不到，然后都插入。

唯一约束才是最终防线。

## index 是什么

索引可以理解成：

```text
给某些字段建立一份有序目录。
```

没有索引：

```text
MySQL 可能从第一行扫到最后一行。
```

有索引：

```text
MySQL 可以先在索引里定位，再找到数据。
```

比如：

```sql
key idx_orders_user_time (user_id, create_time)
```

服务这条 SQL：

```sql
select id, order_no, status, create_time
from orders
where user_id = 10001
order by create_time desc
limit 20;
```

但是索引不是越多越好。

每个索引都会带来：

- 更多磁盘占用。
- 插入变慢。
- 更新索引字段变慢。
- 删除变慢。
- 优化器选择成本增加。

所以索引要服务真实 SQL。

## transaction 是什么

事务是一组数据库操作，要么一起成功，要么一起失败。

比如创建订单：

```text
插入 orders
插入 order_items
扣减库存
清理购物车
```

这些应该在一个事务里。

Spring Boot 里常见：

```java
@Transactional(rollbackFor = Exception.class)
public Long createOrder(CreateOrderCommand command) {
    Long orderId = orderMapper.insertOrder(command);
    orderItemMapper.batchInsert(orderId, command.items());
    stockMapper.deduct(command.items());
    cartMapper.deleteChecked(command.userId());
    return orderId;
}
```

事务重点不是注解本身，而是边界：

```text
事务内只做必要数据库操作。
不要把远程 HTTP、MQ 等慢操作放进去。
```

事务越长，锁持有越久。

## connection 是什么

Java 应用不是每次 SQL 都新建一个 MySQL 连接。

通常使用连接池，比如 HikariCP。

每次请求执行 SQL：

```text
从连接池借连接
  -> 执行 SQL
  -> 事务提交或回滚
  -> 归还连接
```

连接池不是越大越好。

如果数据库只能承受 50 个活跃连接，你把应用连接池开到 500，只会把数据库压爆。

常见配置：

```yaml
spring:
  datasource:
    hikari:
      maximum-pool-size: 20
      minimum-idle: 5
      connection-timeout: 3000
```

排查接口卡住时，要看：

- SQL 是否慢。
- 事务是否没提交。
- 连接池是否耗尽。
- 是否有锁等待。

## 一条 SQL 大概怎么执行

比如：

```sql
select id, order_no, status
from orders
where user_id = 10001
order by create_time desc
limit 20;
```

可以粗略理解成：

```text
客户端发送 SQL
  -> MySQL 解析 SQL
  -> 优化器选择执行计划
  -> InnoDB 根据索引读取数据
  -> 返回结果
```

优化器会决定：

- 用哪个索引。
- 扫多少行。
- 是否排序。
- 是否临时表。
- 是否回表。

所以慢 SQL 排查离不开：

```sql
explain select ...
```

## DDL、DML、DQL

### DDL

数据定义语言，改结构：

```sql
create table users (...);
alter table users add column avatar_url varchar(255);
drop table users;
```

工程里 DDL 应该交给 Flyway 这类迁移工具管理。

### DML

数据操作语言，改数据：

```sql
insert into users ...
update users set ...
delete from users where ...
```

### DQL

查询数据：

```sql
select ...
```

后端项目最多写的是 DQL 和 DML。

DDL 要走迁移脚本，不要临时手改库。

## MySQL 和 Java 代码的关系

Java 后端里通常是：

```text
Controller
  -> Service
  -> Mapper / Repository
  -> MySQL
```

职责：

| 层 | 职责 |
| --- | --- |
| Controller | 接收请求、参数校验、返回响应 |
| Service | 业务规则、事务边界、状态流转 |
| Mapper | SQL 执行、结果映射 |
| MySQL | 存储事实、约束唯一性、事务一致性 |

不要把业务规则全塞到 Mapper。

比如订单支付：

```text
Service 判断订单状态、过期时间。
Mapper 用条件更新兜住并发。
```

## 最小实践模板

建表前先写：

```text
表名：
    orders

表达的业务对象：
    订单主表，一行是一笔订单。

主要写入：
    创建订单、支付、取消、发货。

主要查询：
    按 order_no 查详情。
    按 user_id 分页查列表。
    后台按 status 和 create_time 查。

并发风险：
    支付和取消不能同时成功。
    订单号不能重复。

必要约束：
    主键 id。
    唯一 order_no。
    status 条件更新。

必要索引：
    uk_order_no。
    idx_user_time。
    idx_status_time。
```

再写 SQL。

这比直接上来堆字段更稳。

## 去空话检查

这篇基础笔记保留的是后面能用上的概念：

- `database` 对应连接配置和环境隔离。
- `table` 对应业务对象和访问路径。
- `primary key`、`unique key` 对应并发兜底。
- `index` 对应真实查询。
- `transaction` 对应 Service 边界。
- `connection` 对应连接池和卡顿排查。

没有展开太多历史和理论，因为后面会分别写表设计、索引、事务锁和慢 SQL。

## 参考

- [MySQL Data Types](https://dev.mysql.com/doc/refman/8.4/en/data-types.html)
- [MySQL Optimizing Queries with EXPLAIN](https://dev.mysql.com/doc/refman/8.4/en/using-explain.html)
