---
title: MySQL 事务与锁
sidebarTitle: 事务与锁
---

# MySQL 事务与锁

> 事务和锁不是面试概念。后端真正要会的是：哪些 SQL 会锁数据、锁多久、锁多大范围、死锁怎么查、并发写怎么兜住。

## 先说结论

工程里写 MySQL 事务，先记住：

```text
事务边界要小。
锁持有时间要短。
where 条件要命中索引。
核心状态更新要带条件。
外部调用不要放在事务里。
死锁可以重试，但必须先能定位原因。
```

不要只背：

```text
ACID。
四种隔离级别。
脏读、不可重复读、幻读。
```

这些有用，但真正写代码时更关键的是：

```text
这段代码会不会锁太久？
这条 update 会不会扫太多行？
并发支付和取消会不会都成功？
死锁发生时我能不能拿到现场？
```

## 事务边界放哪里

Java 后端一般把事务放在 Service 层。

```java
@Service
public class OrderServiceImpl implements OrderService {

    @Override
    @Transactional(rollbackFor = Exception.class)
    public Long createOrder(CreateOrderCommand command) {
        Long orderId = orderMapper.insertOrder(command);
        orderItemMapper.batchInsert(orderId, command.items());
        stockMapper.deductStock(command.items());
        cartMapper.deleteChecked(command.userId());
        return orderId;
    }
}
```

原因：

```text
Service 层表达完整业务动作。
Mapper 层只是一条或几条 SQL。
Controller 层不应该关心数据库事务细节。
```

事务不要放得太散。

如果多个 Mapper 各自开事务，很容易出现：

```text
订单插入提交了。
库存扣减失败了。
数据不一致。
```

## 事务里不要做什么

事务里尽量不要做：

- 远程 HTTP 调用。
- 等待 MQ 消费结果。
- 发送邮件短信。
- 大文件上传处理。
- 大量循环调用数据库。
- 用户交互等待。
- 慢查询和复杂报表。

错误例子：

```java
@Transactional(rollbackFor = Exception.class)
public void payOrder(Long orderId) {
    orderMapper.markPaid(orderId);
    paymentClient.confirmWithRemote(orderId);
    couponClient.issueCoupon(orderId);
}
```

问题：

```text
事务打开后，数据库锁一直持有。
远程接口慢，锁就持有很久。
远程接口失败，数据库事务回滚，但外部系统可能已经执行。
```

更稳：

```text
事务内：
    更新本地状态。
    写 outbox。

事务提交后：
    异步发 MQ。
    调用外部系统。
```

## 隔离级别怎么理解

MySQL InnoDB 支持常见隔离级别：

| 隔离级别 | 工程理解 |
| --- | --- |
| `READ UNCOMMITTED` | 可以读到未提交数据，业务系统很少用 |
| `READ COMMITTED` | 每次读看到最新已提交版本，锁范围相对小 |
| `REPEATABLE READ` | InnoDB 默认，同一事务普通查询读同一快照 |
| `SERIALIZABLE` | 最严格，并发能力最低，特殊场景才用 |

InnoDB 默认是：

```text
REPEATABLE READ
```

工程上不要随意改全局隔离级别。

更常见做法是：

```text
用唯一约束防重复。
用条件更新防状态并发。
必要时用 SELECT ... FOR UPDATE。
缩短事务。
控制访问顺序。
```

## MVCC 和快照读

普通查询通常是快照读：

```sql
select *
from orders
where id = 10001;
```

在 `REPEATABLE READ` 下，同一事务里多次普通查询看到的是同一个快照。

这意味着：

```text
别的事务提交了新数据，你当前事务普通 select 不一定看得到。
```

但更新语句不是按旧快照更新。

比如：

```sql
update orders
set status = 'PAID'
where id = 10001
  and status = 'PENDING_PAYMENT';
```

更新会基于当前最新可更新版本去加锁和判断。

所以工程里不要把“我 select 看到的状态”当成最终并发判断。

最终要靠 update 条件和影响行数。

## 当前读

这些通常是当前读，会加锁或读取最新可见版本：

```sql
select ... for update;
select ... for share;
update ...
delete ...
insert ...
```

比如：

```sql
select *
from orders
where id = 10001
for update;
```

表示：

```text
我要锁住这行，后面准备修改。
```

不要随便给查询加 `for update`。

如果你只是展示详情，不需要锁。

## 条件更新兜并发

订单支付：

```sql
update orders
set status = 'PAID',
    pay_time = now(),
    update_time = now()
where id = #{orderId}
  and user_id = #{userId}
  and status = 'PENDING_PAYMENT'
  and pay_expire_time >= now();
```

订单取消：

```sql
update orders
set status = 'CANCELED',
    cancel_time = now(),
    update_time = now()
where id = #{orderId}
  and user_id = #{userId}
  and status = 'PENDING_PAYMENT';
```

Java：

```java
int affected = orderMapper.payOrder(userId, orderId);
if (affected == 0) {
    throw new BusinessException("订单已超时或当前状态不可支付");
}
```

这比先查再改更稳。

因为最终状态流转发生在一条原子 SQL 里。

## 支付和取消并发

两个线程：

```text
线程 A：用户支付。
线程 B：MQ 超时取消。
```

支付 SQL：

```sql
where status = 'PENDING_PAYMENT'
  and pay_expire_time >= now()
```

取消 SQL：

```sql
where status = 'PENDING_PAYMENT'
```

最终只会有一个更新成功。

如果支付先成功：

```text
状态变 PAID。
取消 affected = 0。
不回补库存。
```

如果取消先成功：

```text
状态变 CANCELED。
支付 affected = 0。
支付失败。
```

这就是状态机条件更新的价值。

## 库存扣减

不要：

```text
先查库存。
Java 判断够不够。
再 update 库存。
```

并发下会超卖。

更稳：

```sql
update product_stock
set available_stock = available_stock - #{quantity},
    update_time = now()
where product_id = #{productId}
  and available_stock >= #{quantity};
```

Java：

```java
int affected = stockMapper.deduct(productId, quantity);
if (affected == 0) {
    throw new BusinessException("库存不足");
}
```

如果一次订单多个商品，要注意固定扣减顺序：

```java
List<OrderItem> items = command.items().stream()
        .sorted(Comparator.comparing(OrderItem::productId))
        .toList();
```

这样多个事务按同一顺序锁库存，能降低死锁概率。

## 行锁依赖索引

InnoDB 行锁建立在索引访问路径上。

危险：

```sql
update orders
set status = 'CANCELED'
where order_no = 'NO10001';
```

如果 `order_no` 没有索引，MySQL 可能扫描大量记录。

锁范围也会变大。

应该有：

```sql
unique key uk_orders_order_no (order_no)
```

再执行：

```sql
update orders
set status = 'CANCELED'
where order_no = 'NO10001'
  and status = 'PENDING_PAYMENT';
```

写更新 SQL 前先问：

```text
where 条件能不能走索引？
```

## 记录锁、间隙锁、next-key lock

### 记录锁

锁住索引记录本身。

比如唯一索引等值命中一行：

```sql
select *
from orders
where order_no = 'NO10001'
for update;
```

如果 `order_no` 是唯一索引，通常只锁匹配记录。

### 间隙锁

锁住索引记录之间的间隙，防止别的事务插入。

常见于范围查询。

### next-key lock

记录锁 + 间隙锁。

在 `REPEATABLE READ` 下，范围更新或锁定读可能锁住扫描到的索引范围。

例如：

```sql
select *
from orders
where status = 'PENDING_PAYMENT'
  and close_deadline_time <= now()
for update;
```

如果索引设计不好，可能锁住很大范围。

所以超时扫描一般要：

```sql
where status = 'PENDING_PAYMENT'
  and close_deadline_time <= now()
order by close_deadline_time
limit 100
```

并配索引：

```sql
key idx_orders_status_close_deadline(status, close_deadline_time)
```

## `select for update` 什么时候用

适合：

- 需要先读一行，再基于当前值做复杂判断和更新。
- 多条 SQL 必须围绕同一行串行执行。
- 无法用单条条件更新表达完整逻辑。

例子：

```sql
select *
from account
where id = #{accountId}
for update;
```

然后计算余额、写流水、更新余额。

但很多场景可以用条件更新代替。

比如库存扣减，直接：

```sql
update product_stock
set available_stock = available_stock - #{quantity}
where product_id = #{productId}
  and available_stock >= #{quantity};
```

不需要先 `for update` 再 update。

## 死锁是什么

死锁是两个或多个事务互相等待对方持有的锁。

例子：

```text
事务 A 锁住商品 1，等待商品 2。
事务 B 锁住商品 2，等待商品 1。
```

MySQL 检测到死锁后，会回滚其中一个事务。

应用会收到异常。

死锁不是完全不能出现。

高并发系统里偶发死锁可以接受，但必须：

- 能定位。
- 能降低概率。
- 能安全重试。

## 死锁现场怎么查

执行：

```sql
show engine innodb status;
```

重点看：

```text
LATEST DETECTED DEADLOCK
```

关注：

- 哪两个事务。
- 分别执行哪条 SQL。
- 分别持有哪些锁。
- 在等待哪些锁。
- 涉及哪个索引。
- 哪个事务被回滚。

如果是线上，日志里至少要打：

- 业务 ID。
- SQL 参数。
- 当前线程。
- messageId。
- orderId。
- retry attempt。

否则只看到一条死锁异常，很难复盘。

## 降低死锁概率

### 固定更新顺序

多个商品扣库存时，按 `product_id` 排序后更新。

```java
items.sort(Comparator.comparing(OrderItem::productId));
```

不要请求怎么传就怎么扣。

### 缩短事务

事务里只保留必要数据库操作。

不要把远程调用放进去。

### 给条件加索引

更新条件没索引，会扩大锁范围。

### 拆小批量

不要一个事务更新十万行。

分批：

```sql
update ...
where id > ?
order by id
limit 1000;
```

### 失败重试

死锁可以重试，但要有限次。

```java
for (int attempt = 1; attempt <= 3; attempt++) {
    try {
        orderService.cancelExpiredOrder(orderId);
        return;
    } catch (DeadlockLoserDataAccessException exception) {
        if (attempt == 3) {
            throw exception;
        }
        Thread.sleep(50L * attempt);
    }
}
```

重试的前提是业务幂等。

如果重试会重复发券、重复加积分，就不能直接重试。

## 锁等待怎么查

看当前连接：

```sql
show full processlist;
```

看 InnoDB 状态：

```sql
show engine innodb status;
```

MySQL 8 可以通过 performance_schema 查询锁等待。

常见排查方向：

- 是否有长事务。
- 是否有 SQL 一直处于 `Locked`。
- 是否有事务打开后不提交。
- 是否有大批量更新。
- where 条件是否没索引。
- 应用连接池是否耗尽。

## 长事务的危害

长事务会带来：

- 锁持有时间长。
- 其他事务等待。
- undo 无法及时清理。
- 影响快照读。
- 连接长时间占用。
- 更容易死锁。

常见原因：

- 事务里调远程接口。
- 事务里做大循环。
- 查询大量数据后慢慢处理。
- 开启事务后异常路径没及时结束。

治理：

```text
缩小事务范围。
分页批处理。
外部调用放事务后。
超时配置。
监控事务耗时。
```

## Spring 事务注意点

### 自调用失效

```java
public void outer() {
    inner();
}

@Transactional
public void inner() {
    ...
}
```

同一个类内部调用可能不会走代理，事务不生效。

### 异常被吞

```java
@Transactional
public void createOrder() {
    try {
        orderMapper.insert(...);
    } catch (Exception exception) {
        log.error("创建失败", exception);
    }
}
```

异常被捕获不抛出，事务可能正常提交。

### 默认只回滚 RuntimeException

如果要 checked exception 也回滚：

```java
@Transactional(rollbackFor = Exception.class)
```

## 事务检查清单

- [ ] 事务是否放在 Service 层。
- [ ] 事务内是否只有必要数据库操作。
- [ ] 是否有远程调用、MQ、Redis 慢操作放在事务里。
- [ ] 更新 SQL 是否带业务条件。
- [ ] 条件字段是否有索引。
- [ ] 是否用影响行数判断并发结果。
- [ ] 批量更新是否固定顺序。
- [ ] 死锁是否有重试和日志。
- [ ] 重试操作是否幂等。
- [ ] 是否存在自调用导致事务失效。
- [ ] 是否捕获异常后没有抛出。
- [ ] 是否需要 `rollbackFor = Exception.class`。

## 去空话检查

这篇没有停在“事务保证一致性、锁解决并发”。

它落到了：

- 支付和取消并发怎么用条件更新兜住。
- 库存扣减怎么避免超卖。
- 行锁为什么依赖索引。
- `for update` 什么时候用，什么时候不用。
- 死锁怎么拿现场。
- 死锁重试为什么必须配合幂等。
- Spring 事务有哪些常见失效点。

## 参考

- [MySQL InnoDB Transaction Isolation Levels](https://dev.mysql.com/doc/refman/8.4/en/innodb-transaction-isolation-levels.html)
- [MySQL InnoDB Locking](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking.html)
- [MySQL Deadlocks in InnoDB](https://dev.mysql.com/doc/refman/8.4/en/innodb-deadlocks.html)
