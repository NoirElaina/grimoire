---
title: 本地事务与外部副作用
sidebarTitle: 事务与外部副作用
---

# 本地事务与外部副作用

> 事务只管数据库，不管 MQ、Redis、HTTP、文件和短信。项目里最容易出事故的地方，正是“数据库回滚了，外部动作已经发生”。

## 先给结论

本地事务内不要直接做不可回滚副作用。

| 副作用 | 风险 |
| --- | --- |
| 发 MQ | 数据库回滚但消息已发出 |
| 写 Redis | 数据库回滚但缓存已变 |
| 调支付 | 数据库失败但支付请求已发 |
| 发送短信 | 业务失败但用户收到短信 |
| 写文件 | 数据库回滚但文件已上传 |

常用方案：

```text
简单场景：TransactionSynchronization.afterCommit
可靠场景：本地事务 + outbox 表 + 异步发送 + 重试
复杂跨服务：Saga / TCC / 可靠消息最终一致
```

## afterCommit

订单创建后发送消息：

```java
@Transactional(rollbackFor = Exception.class)
public Long createOrder(CreateOrderCommand command) {
    OrderDO order = orderFactory.create(command);
    orderMapper.insert(order);

    OrderCreatedEvent event = new OrderCreatedEvent(order.getId(), order.getOrderNo());

    TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
        @Override
        public void afterCommit() {
            rabbitTemplate.convertAndSend(
                RabbitMqConfig.ORDER_EXCHANGE,
                RabbitMqConfig.ORDER_CREATED_ROUTING_KEY,
                event
            );
        }
    });

    return order.getId();
}
```

优点：

- 数据库提交后才发消息。
- 事务回滚不会发消息。
- 适合学习项目和低风险通知。

缺点：

- `afterCommit` 里发 MQ 失败，数据库已经提交。
- 失败后如果没有重试，消息会丢。
- 应用进程在提交后、发送前崩溃时也可能丢事件。

所以 `afterCommit` 不是可靠消息最终方案。

## outbox 模式

核心思想：

```text
业务数据和事件记录放进同一个本地事务
事务提交后，再由异步任务发送事件
发送成功标记完成
发送失败继续重试
```

流程：

```text
1. 开启本地事务
2. 写订单表
3. 写 outbox_event 表
4. 提交事务
5. 后台任务扫描待发送事件
6. 发送 MQ
7. 发送成功后标记 SENT
8. 发送失败增加 retry_count，等待下次重试
```

这样至少保证：

```text
订单提交了 -> outbox 事件也一定存在
订单回滚了 -> outbox 事件也不存在
```

## outbox 表设计

```sql
create table outbox_event (
    id bigint primary key auto_increment,
    event_id varchar(64) not null,
    aggregate_type varchar(64) not null,
    aggregate_id varchar(64) not null,
    event_type varchar(64) not null,
    payload json not null,
    status varchar(32) not null,
    retry_count int not null default 0,
    next_retry_at datetime not null,
    created_at datetime not null,
    updated_at datetime not null,
    unique key uk_outbox_event_event_id (event_id),
    index idx_outbox_event_status_retry (status, next_retry_at)
);
```

字段含义：

| 字段 | 含义 |
| --- | --- |
| `event_id` | 事件唯一 ID，用于幂等 |
| `aggregate_type` | 聚合类型，如 `ORDER` |
| `aggregate_id` | 业务 ID，如订单 ID |
| `event_type` | 事件类型 |
| `payload` | 消息体 |
| `status` | `PENDING` / `SENT` / `FAILED` |
| `retry_count` | 重试次数 |
| `next_retry_at` | 下次重试时间 |

## 写业务和 outbox

```java
@Transactional(rollbackFor = Exception.class)
public Long createOrder(CreateOrderCommand command) {
    OrderDO order = orderFactory.create(command);
    orderMapper.insert(order);

    OutboxEventDO event = new OutboxEventDO();
    event.setEventId(UUID.randomUUID().toString());
    event.setAggregateType("ORDER");
    event.setAggregateId(order.getId().toString());
    event.setEventType("ORDER_CREATED");
    event.setPayload(writeJson(new OrderCreatedEvent(order.getId(), order.getOrderNo())));
    event.setStatus("PENDING");
    event.setNextRetryAt(LocalDateTime.now());
    outboxEventMapper.insert(event);

    return order.getId();
}
```

这一步不发 MQ，只写本地数据库。

## 异步发送任务

```java
@Scheduled(fixedDelay = 3000)
public void publishPendingEvents() {
    List<OutboxEventDO> events = outboxEventMapper.selectPending(LocalDateTime.now(), 100);
    for (OutboxEventDO event : events) {
        publishOne(event);
    }
}
```

发送单条：

```java
public void publishOne(OutboxEventDO event) {
    try {
        rabbitTemplate.convertAndSend(resolveExchange(event), resolveRoutingKey(event), event.getPayload());
        outboxEventMapper.markSent(event.getId(), LocalDateTime.now());
    } catch (Exception ex) {
        int nextRetryCount = event.getRetryCount() + 1;
        LocalDateTime nextRetryAt = LocalDateTime.now().plusSeconds(backoffSeconds(nextRetryCount));
        outboxEventMapper.markRetry(event.getId(), nextRetryCount, nextRetryAt);
    }
}
```

注意：

- 发送任务可能多实例同时跑，要避免重复抢同一条。
- 可以用状态机、乐观锁、`select for update` 或分布式锁。
- 即使重复发送，消费者也必须幂等。

## 消费者幂等

因为 outbox 可能重复发送，消费者要用 `event_id` 做幂等。

```sql
create table mq_consume_record (
    id bigint primary key auto_increment,
    event_id varchar(64) not null,
    consumer_name varchar(64) not null,
    consumed_at datetime not null,
    unique key uk_consume_event_consumer (event_id, consumer_name)
);
```

消费：

```java
@Transactional(rollbackFor = Exception.class)
public void handle(OrderCreatedEvent event) {
    boolean inserted = consumeRecordMapper.insertIgnore(event.eventId(), "stock-service") == 1;
    if (!inserted) {
        return;
    }

    stockService.freezeStock(event.orderId());
}
```

唯一索引是最终兜底。

## Redis 删除缓存算不算副作用

算。

更新商品：

```java
@Transactional(rollbackFor = Exception.class)
public void updateProduct(UpdateProductCommand command) {
    productMapper.updateById(command.toDO());

    TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
        @Override
        public void afterCommit() {
            stringRedisTemplate.delete(ProductRedisKeys.detail(command.productId()));
        }
    });
}
```

如果删除失败会短暂不一致。

更可靠：

- outbox 记录 `CACHE_INVALIDATE` 事件。
- 异步任务删除缓存。
- 删除失败重试。
- TTL 兜底。

## 第三方支付调用怎么放

不要在长事务里调用支付。

更合理：

```text
1. 本地创建支付单，状态 INIT
2. 提交事务
3. 调第三方支付下单
4. 成功后更新支付单为 WAIT_PAY
5. 失败后更新为 FAIL 或可重试
```

原因：

- 支付接口慢，会长时间占数据库连接和锁。
- 支付请求发出后不可随数据库事务回滚。
- 支付回调才是最终状态来源之一。

## 方案选择

| 场景 | 推荐 |
| --- | --- |
| 普通缓存删除 | afterCommit + TTL |
| 普通通知消息 | afterCommit 可接受 |
| 订单创建事件 | outbox + MQ + 幂等 |
| 支付状态变化 | 本地流水 + 回调幂等 + 对账 |
| 关键库存扣减 | DB 条件更新 + MQ + 对账 |

## 去空话检查

- [ ] MQ、Redis、HTTP 不放在事务里假装可回滚。
- [ ] 简单副作用放 `afterCommit`。
- [ ] 关键事件使用 outbox 记录。
- [ ] outbox 有状态、重试次数、下次重试时间。
- [ ] 消费者用唯一键做幂等。
- [ ] 第三方支付不包在长事务里。

## 关联笔记

- [Spring 事务回滚规则](/notes/java-backend/transactional-rollback)
- [Spring 事务传播行为](/notes/java-backend/transaction-propagation)
- [RabbitMQ 生产者可靠性](/notes/rabbitmq/producer-reliability)
- [MQ 幂等](/notes/rabbitmq/message-idempotency)
