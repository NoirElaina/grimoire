---
title: 项目里的 MQ 用法
sidebarTitle: 项目用法
---

# 项目里的 MQ 用法

> 项目里用 MQ，不是“发一条消息给消费者”这么简单。要说明白：为什么要异步、消息什么时候发、发到哪里、失败怎么兜、重复怎么处理。

## 项目里为什么用 MQ

常见目的：

| 目的 | 例子 | 不用 MQ 的问题 |
| --- | --- | --- |
| 异步解耦 | 订单创建后发通知、加积分、写审计 | 主流程被非核心动作拖慢 |
| 削峰填谷 | 秒杀下单、库存扣减、日志写入 | 瞬时流量压垮数据库 |
| 延迟处理 | 订单 30 分钟未支付自动关闭 | 定时扫表压力大，延迟不稳定 |
| 失败重试 | 外部系统临时失败后重试 | 同步接口只能直接失败 |
| 事件驱动 | 订单已创建、支付成功、退款成功 | 服务之间强耦合 |

总的来说：

```text
同步流程只做必须立即完成的事。
可以稍后做、可以重试做、可以通知别人做的事，考虑 MQ。
```

## 典型业务链路

以订单创建为例：

```text
用户提交订单
  -> 本地事务写 orders、order_items、锁定库存
  -> 事务提交后发送 OrderCreatedEvent
  -> MQ 路由到订单事件队列
  -> 消费者处理通知、审计、超时关闭准备
```

关键点：

- 订单没提交成功，不能发消息。
- 消息发出后，消费者可能重复收到。
- 消费失败不能无限回原队列。
- 业务最终状态必须能靠数据库兜住。

## 什么时候发送消息

不要在事务中间直接发：

```java
@Transactional(rollbackFor = Exception.class)
public void createOrder(CreateOrderRequest request) {
    OrderDO order = saveOrder(request);

    rabbitTemplate.convertAndSend(
            RabbitMqConfig.ORDER_EXCHANGE,
            RabbitMqConfig.ORDER_CREATED_ROUTING_KEY,
            new OrderCreatedEvent(order.getId())
    );

    // 后面如果抛异常，订单回滚了，但消息已经发出
    reserveStock(order);
}
```

更稳的是事务提交后发送：

```java
@Transactional(rollbackFor = Exception.class)
public void createOrder(CreateOrderRequest request) {
    OrderDO order = saveOrder(request);
    reserveStock(order);

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
}
```

这只能解决：

```text
本地事务回滚了，消息不应该发。
```

它不能解决：

```text
事务提交成功后，发送 MQ 时应用宕机。
```

这个问题要用 outbox 或本地消息表兜。

## 推荐拓扑

按业务事件命名：

```text
exchange:
    order.exchange

routing key:
    order.created
    order.paid
    order.timeout

queue:
    order.created.queue
    order.timeout.delay.queue
    order.timeout.close.queue
    order.dead.queue
```

不要把所有业务都塞进一个队列。

原因：

- 不同业务消费速度不同。
- 重试策略不同。
- 死信处理不同。
- 堆积排查需要知道是哪类消息。

## 订单超时关闭

可以用 TTL + 死信交换机：

```text
创建订单
  -> 发送消息到 order.timeout.delay.queue
  -> 消息在延迟队列里等待 30 分钟
  -> TTL 到期后变成死信
  -> 路由到 order.timeout.close.queue
  -> 消费者检查订单是否仍未支付
  -> 条件更新关闭订单并回补库存
```

消费者不能直接关闭订单，必须先查状态：

```java
OrderDO order = orderMapper.selectById(orderId);
if (!OrderStatus.WAIT_PAY.equals(order.getStatus())) {
    return;
}

int updated = orderMapper.closeTimeoutOrder(orderId, OrderStatus.WAIT_PAY, OrderStatus.CLOSED);
if (updated == 0) {
    return;
}

stockService.releaseReservedStock(orderId);
```

原因：

```text
用户可能已经支付。
支付回调和超时关闭可能并发。
消息可能重复投递。
```

数据库状态机是最后防线。

## 消费端怎么写

监听器只处理 MQ 边界：

```java
@RabbitListener(queues = RabbitMqConfig.ORDER_CREATED_QUEUE)
public void onOrderCreated(OrderCreatedEvent event, Channel channel, Message message) throws IOException {
    long deliveryTag = message.getMessageProperties().getDeliveryTag();
    try {
        orderEventService.handleOrderCreated(event);
        channel.basicAck(deliveryTag, false);
    } catch (Exception exception) {
        channel.basicNack(deliveryTag, false, false);
    }
}
```

业务逻辑放到 service：

```java
@Transactional(rollbackFor = Exception.class)
public void handleOrderCreated(OrderCreatedEvent event) {
    if (messageLogMapper.exists(event.eventId())) {
        return;
    }

    messageLogMapper.insertConsumed(event.eventId(), event.orderId());
    auditLogMapper.insertOrderCreatedLog(event.orderId());
}
```

这样拆的好处：

- listener 负责 ack/nack。
- service 负责事务和业务幂等。
- 测试时可以直接测 service。

## 幂等怎么兜

MQ 消息可能重复。

常见幂等方案：

| 方案 | 适合 |
| --- | --- |
| 消费日志表 | 每条事件都有唯一 `event_id` |
| 业务唯一约束 | 创建类消息，比如一个订单只能生成一条积分流水 |
| 状态机条件更新 | 订单状态、支付状态、退款状态 |
| Redis 幂等 key | 短时间防重，不能替代数据库最终兜底 |

消费日志表示例：

```sql
create table mq_consume_log (
    id bigint primary key auto_increment,
    event_id varchar(64) not null,
    event_type varchar(64) not null,
    biz_id bigint not null,
    consume_status tinyint not null,
    create_time datetime not null,
    update_time datetime not null,
    unique key uk_mq_consume_event (event_id)
) engine = InnoDB default charset = utf8mb4 comment = 'MQ消费日志';
```

先插入消费日志，再执行业务，或者在同一个事务内完成业务写入和日志写入。

如果唯一键冲突，说明处理过，直接 ack。

## 生产者可靠性

生产者要考虑三段：

```text
业务事务是否提交。
消息是否成功到 exchange。
消息是否成功路由到 queue。
```

落地手段：

- 本地事务提交后再发送。
- publisher confirm 确认到 exchange。
- mandatory return 处理无法路由。
- outbox 表兜事务提交后应用宕机。
- 定时任务扫描未发送消息重试。

本地消息表示例：

```sql
create table mq_outbox (
    id bigint primary key auto_increment,
    event_id varchar(64) not null,
    event_type varchar(64) not null,
    exchange_name varchar(128) not null,
    routing_key varchar(128) not null,
    payload json not null,
    send_status tinyint not null,
    retry_count int not null default 0,
    next_retry_time datetime not null,
    create_time datetime not null,
    update_time datetime not null,
    unique key uk_mq_outbox_event (event_id),
    key idx_mq_outbox_retry (send_status, next_retry_time)
) engine = InnoDB default charset = utf8mb4 comment = 'MQ本地消息表';
```

## 消费者可靠性

消费者要考虑：

- 业务成功后再 ack。
- 失败时不要无限 `requeue = true`。
- 重试次数要有限。
- 失败后进入死信队列。
- 重复消费必须幂等。
- 消费堆积要能监控。

推荐流程：

```text
收到消息
  -> 反序列化
  -> 校验 event_id
  -> 业务幂等判断
  -> 本地事务处理
  -> 成功 ack
  -> 失败 nack，不重新入原队列
  -> 进入重试 / 死信
```

## 项目回答模板

如果被问“项目里用的 MQ”，可以这样答：

```text
我们项目里用 RabbitMQ 做订单相关异步事件和订单超时关闭。

订单创建成功后，不在事务中间发消息，而是事务提交后发送订单创建事件。
为了防止事务提交后应用宕机导致消息丢失，关键事件可以落 outbox 表，由后台任务重试发送。

订单超时关闭用 TTL + 死信交换机实现。
创建订单后发送延迟消息，TTL 到期后进入关闭队列。
消费者收到后先查订单状态，只有 WAIT_PAY 才条件更新为 CLOSED，然后回补库存。

消费端使用手动 ack，业务成功后 ack，失败进入重试或死信。
重复消息用 event_id 唯一约束、消费日志表和订单状态机兜住。
```

## 检查清单

- [ ] 这条消息是为了解耦、削峰、延迟还是重试。
- [ ] 业务事务回滚时消息不会发出。
- [ ] 事务提交后发送失败有 outbox 或重试兜底。
- [ ] exchange、routing key、queue 命名能表达业务。
- [ ] 消费者业务成功后才 ack。
- [ ] 失败消息不会无限回原队列。
- [ ] 消费端有幂等。
- [ ] 关键状态有数据库条件更新兜底。
- [ ] 队列堆积、死信数量、消费失败有监控。

## 关联笔记

- [Spring 事务同步与 MQ](/notes/rabbitmq/transaction-after-commit)
- [RabbitMQ 延迟队列](/notes/rabbitmq/delay-queue)
- [RabbitMQ 死信队列](/notes/rabbitmq/dead-letter-queue)
- [MQ 消费幂等](/notes/rabbitmq/message-idempotency)
- [RabbitMQ 生产者可靠性](/notes/rabbitmq/producer-reliability)
- [RabbitMQ 消费者可靠性](/notes/rabbitmq/consumer-reliability)
