---
title: MySQL 与 Java 后端
sidebarTitle: Java 后端接入
---

# MySQL 与 Java 后端

> Java 后端接 MySQL，重点不是能不能查库，而是连接池、事务边界、Mapper SQL、分页、异常转换、缓存一致性和迁移脚本能不能一起工作。

## 先说结论

Java 后端里 MySQL 相关代码要守住这些边界：

```text
Controller:
    不直接写数据库。

Service:
    放业务规则和事务边界。

Mapper:
    放 SQL 和结果映射。

MySQL:
    用约束、索引、事务兜住最终一致性。
```

不要把所有逻辑都塞到 Mapper。

也不要把事务开在 Controller。

## 连接池配置

Spring Boot 默认常用 HikariCP。

基础配置：

```yaml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/flashmart?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai
    username: root
    password: your-password
    hikari:
      maximum-pool-size: 20
      minimum-idle: 5
      connection-timeout: 3000
      idle-timeout: 600000
      max-lifetime: 1800000
```

关注：

| 配置 | 含义 |
| --- | --- |
| `maximum-pool-size` | 最大连接数 |
| `minimum-idle` | 最小空闲连接 |
| `connection-timeout` | 获取连接超时时间 |
| `idle-timeout` | 空闲连接保留时间 |
| `max-lifetime` | 连接最大生命周期 |

不要盲目把连接池调大。

如果 SQL 慢或事务长，调大连接池只会让更多请求同时压数据库。

## URL 参数

常见：

```text
serverTimezone=Asia/Shanghai
characterEncoding=utf8
useUnicode=true
```

如果使用 MySQL 8 驱动，很多默认值已经比老版本好，但项目里仍要明确：

- 字符集。
- 时区。
- 数据库名。
- 连接超时。

时区问题很常见：

```text
数据库时间、Java LocalDateTime、前端展示时间不一致。
```

核心业务时间建议：

- 数据库字段用 `datetime`。
- Java 用 `LocalDateTime`。
- 接口格式统一。
- 服务器和数据库时区统一。

## MyBatis Mapper 分层

推荐结构：

```text
controller
  -> service
  -> mapper
  -> xml
```

Mapper 接口：

```java
public interface OrderMapper {

    /**
     * 根据用户和订单 ID 查询订单详情。
     */
    OrderDetailVO selectOrderDetail(@Param("userId") Long userId,
                                    @Param("orderId") Long orderId);

    /**
     * 支付订单。
     *
     * <p>使用 status 和 pay_expire_time 做并发条件保护。</p>
     */
    int payOrder(@Param("userId") Long userId,
                 @Param("orderId") Long orderId);
}
```

XML：

```xml
<update id="payOrder">
    update orders
    set status = 'PAID',
        pay_time = now(),
        update_time = now()
    where id = #{orderId}
      and user_id = #{userId}
      and status = 'PENDING_PAYMENT'
      and pay_expire_time >= now()
</update>
```

Mapper 注释不是装饰。

它要说明：

- 这条 SQL 用于哪个业务。
- 依赖哪个索引。
- 是否有并发条件。
- 返回值 `affected` 怎么解释。

## Wrapper 和 XML 怎么选

### Wrapper 适合简单单表

```java
LambdaQueryWrapper<OrderEntity> wrapper = Wrappers.lambdaQuery(OrderEntity.class)
        .eq(OrderEntity::getUserId, userId)
        .eq(OrderEntity::getStatus, OrderStatus.PENDING_PAYMENT)
        .orderByDesc(OrderEntity::getCreateTime)
        .last("limit 20");
```

适合：

- 简单条件。
- 简单排序。
- 简单 CRUD。

### XML 适合复杂 SQL

```xml
<select id="selectAdminOrderPage" resultType="OrderListVO">
    select
        o.id,
        o.order_no,
        o.user_id,
        o.status,
        o.payable_amount,
        o.create_time
    from orders o
    where 1 = 1
    <if test="query.status != null">
        and o.status = #{query.status}
    </if>
    <if test="query.startTime != null">
        and o.create_time &gt;= #{query.startTime}
    </if>
    <if test="query.endTime != null">
        and o.create_time &lt; #{query.endTime}
    </if>
    order by o.create_time desc
</select>
```

适合：

- 多条件查询。
- join。
- 聚合。
- 自定义字段。
- 需要明确 SQL 结构。

不要用二十行 Wrapper 硬拼复杂 SQL。

后面排查时很难读。

## 事务边界

事务放 Service。

```java
@Service
@RequiredArgsConstructor
public class OrderServiceImpl implements OrderService {

    private final OrderMapper orderMapper;
    private final StockMapper stockMapper;

    @Override
    @Transactional(rollbackFor = Exception.class)
    public Long createOrder(CreateOrderCommand command) {
        Long orderId = orderMapper.insertOrder(command);
        stockMapper.deductStock(command.items());
        return orderId;
    }
}
```

不要：

```text
Controller 开事务。
Mapper 开事务。
私有方法上写 @Transactional。
同类内部调用事务方法。
```

事务失效常见：

- 自调用。
- 方法不是 public。
- 异常被 catch 后吞掉。
- checked exception 没配置 rollbackFor。
- 类没有被 Spring 管理。

## 更新要看影响行数

支付订单：

```java
int affected = orderMapper.payOrder(userId, orderId);
if (affected == 0) {
    throw new BusinessException("订单已超时或当前状态不可支付");
}
```

库存扣减：

```java
int affected = stockMapper.deduct(productId, quantity);
if (affected == 0) {
    throw new BusinessException("库存不足");
}
```

不要写成：

```java
orderMapper.payOrder(userId, orderId);
```

然后不看返回值。

对条件更新来说，影响行数就是并发结果。

## 异常转换

数据库异常不要原样丢给前端。

唯一键冲突：

```java
try {
    userMapper.insert(user);
} catch (DuplicateKeyException exception) {
    throw new BusinessException("手机号已被注册");
}
```

死锁：

```java
try {
    orderService.cancelOrder(command);
} catch (DeadlockLoserDataAccessException exception) {
    throw new BusinessException("系统繁忙，请稍后重试");
}
```

应用日志里要保留技术细节。

前端响应要返回业务语义。

## 分页写法

普通小分页：

```sql
select id, order_no, status, create_time
from orders
where user_id = #{userId}
order by create_time desc
limit #{offset}, #{size}
```

大数据深分页不推荐。

游标分页：

```sql
select id, order_no, status, create_time
from orders
where user_id = #{userId}
  and create_time < #{lastCreateTime}
order by create_time desc
limit #{size}
```

后端 DTO：

```java
public record CursorPageRequest(
        LocalDateTime lastCreateTime,
        Integer size
) {
}
```

响应：

```java
public record CursorPageResponse<T>(
        List<T> records,
        LocalDateTime nextCursor,
        boolean hasMore
) {
}
```

不要让前端无限跳到第 10000 页。

## 批量操作

批量插入：

```xml
<insert id="batchInsert">
    insert into order_items (
        order_id, product_id, product_name, quantity, unit_price, create_time
    )
    values
    <foreach collection="items" item="item" separator=",">
        (
            #{orderId},
            #{item.productId},
            #{item.productName},
            #{item.quantity},
            #{item.unitPrice},
            now()
        )
    </foreach>
</insert>
```

注意：

- 批量大小要限制。
- 不要一次插入几十万行。
- 大批量任务用分批。
- 失败要能重试。

分批处理：

```java
for (List<OrderItem> batch : Lists.partition(items, 500)) {
    orderItemMapper.batchInsert(orderId, batch);
}
```

## SQL 日志

开发环境可以打开 SQL 日志。

但生产环境不要直接打印所有 SQL 和参数。

原因：

- 日志量巨大。
- 可能泄露手机号、地址、token。
- 影响性能。

生产更适合：

- 慢 SQL 日志。
- APM。
- 关键业务埋点。
- traceId 串联。

日志里至少保留：

```text
接口名。
业务 ID。
耗时。
异常。
traceId。
```

## Flyway 管结构

Java 代码新增字段时，必须配 migration。

比如实体新增：

```java
private LocalDateTime payExpireTime;
```

要有：

```text
V3__add_order_payment_deadlines.sql
```

内容：

```sql
alter table orders
    add column pay_expire_time datetime null;

update orders
set pay_expire_time = date_add(create_time, interval 15 minute)
where pay_expire_time is null;

alter table orders
    modify column pay_expire_time datetime not null;
```

不要只改 Java，不改数据库。

也不要手动改库后忘记提交 SQL。

## Redis 与 MySQL 一致性

常见策略：

```text
读：
    先查 Redis。
    未命中查 MySQL。
    回填 Redis。

写：
    先写 MySQL。
    事务提交后删除 Redis。
```

事务提交后删缓存：

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

不要在事务还没提交时删缓存。

否则可能：

```text
缓存删了。
数据库事务回滚。
其他请求读到旧数据库，又把旧值写回缓存。
```

## MQ 与 MySQL 一致性

订单创建后发 MQ：

```text
订单事务提交成功后，再发送消息。
```

学习项目可以用：

```java
TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
    @Override
    public void afterCommit() {
        rabbitTemplate.convertAndSend(exchange, routingKey, event);
    }
});
```

生产核心链路更推荐：

```text
事务内写业务表 + message_outbox。
后台发送 outbox。
publisher confirm 成功后标记 SENT。
```

MySQL 是最终事实，MQ 是异步传播。

不要让 MQ 消息先于数据库事务提交。

## Mapper 注释规范

Mapper 方法建议写清楚：

```java
/**
 * 支付订单。
 *
 * <p>并发控制：只有待支付且未过期订单才能更新成功。</p>
 * <p>返回值：1 表示支付状态更新成功，0 表示订单状态已变化或已过期。</p>
 * <p>索引：通过主键 id 定位订单。</p>
 */
int payOrder(@Param("userId") Long userId,
             @Param("orderId") Long orderId);
```

这样后面看 Mapper 就知道：

- 这条 SQL 的业务语义。
- 返回值怎么用。
- 并发条件是什么。
- 是否依赖索引。

## Java 接入检查清单

- [ ] 数据库连接池大小是否合理。
- [ ] URL 时区和字符集是否明确。
- [ ] Service 是否负责事务边界。
- [ ] Mapper 是否只负责 SQL。
- [ ] 条件更新是否检查影响行数。
- [ ] 唯一键冲突是否转成业务异常。
- [ ] 深分页是否避免。
- [ ] 批量操作是否限制大小。
- [ ] 生产是否避免全量 SQL 日志。
- [ ] 数据库结构是否用 Flyway 管。
- [ ] 写 MySQL 后是否处理 Redis 缓存一致性。
- [ ] 事务提交后才发送 MQ 或写 outbox。
- [ ] Mapper 注释是否说明 SQL 语义和索引。

## 去空话检查

这篇没有停在“Java 要合理连接 MySQL”。

它把 Java 接入拆到了工程边界：

- 连接池配置和耗尽风险。
- Service 事务边界。
- Mapper SQL 和注释。
- 条件更新返回值。
- 异常转换。
- 分页和批量。
- Flyway 结构迁移。
- Redis / MQ 和 MySQL 的一致性边界。

## 参考

- [MySQL Optimizing Queries with EXPLAIN](https://dev.mysql.com/doc/refman/8.4/en/using-explain.html)
- [MySQL Slow Query Log](https://dev.mysql.com/doc/refman/8.4/en/slow-query-log.html)
