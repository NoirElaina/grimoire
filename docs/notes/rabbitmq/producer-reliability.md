---
title: RabbitMQ 生产者可靠性
sidebarTitle: 09 生产者可靠性
---

# RabbitMQ 生产者可靠性

> 生产者可靠性的核心问题是：业务事件产生以后，消息有没有安全地交给 RabbitMQ，并且有没有进入正确的队列。

## 生产者要负责什么

生产者不是调用一下：

```java
rabbitTemplate.convertAndSend(exchange, routingKey, event);
```

就结束了。

它至少要回答三个问题：

```text
1. 业务事务提交了吗？
2. Broker 确认接收消息了吗？
3. 消息路由到队列了吗？
```

对应机制：

| 问题 | 机制 |
| --- | --- |
| 事务没提交不能发消息 | `afterCommit` / outbox |
| Broker 是否接收 | publisher confirm |
| 是否路由到队列 | mandatory + return callback |
| 发送失败如何补偿 | 重试 / outbox |
| 重复发送如何处理 | 稳定 `eventId` + 消费幂等 |

## 常见丢消息位置

### 事务内提前发送

错误流程：

```text
开启订单事务
  -> 插入订单
  -> 发送 MQ
  -> 扣库存失败
  -> 事务回滚
```

结果：

```text
MQ 消息已经发出。
数据库里没有这笔有效订单。
```

改进：

```text
事务提交后再发送消息。
```

### 事务提交后应用崩溃

`afterCommit` 也不是最终方案。

可能发生：

```text
订单事务提交成功。
afterCommit 准备发送 MQ。
应用刚好宕机。
消息没发出去。
```

更强方案是 outbox：

```text
订单事务内写订单 + 写消息表。
后台任务扫描消息表发送 MQ。
发送成功后标记 SENT。
失败继续重试。
```

### Broker 没收到消息

网络断开时，生产者写 socket 不代表 Broker 已经处理。

所以要开启：

```text
publisher confirm
```

Broker 接收并承担消息责任后，才会回 confirm。

### 消息没路由到队列

exchange 存在，但 routing key 或 binding 错了。

如果不处理 return，消息可能静悄悄没进队列。

所以要开启：

```text
mandatory = true
publisher returns = true
```

## Spring Boot 配置

`application.yml`：

```yaml
spring:
  rabbitmq:
    publisher-confirm-type: correlated
    publisher-returns: true
    template:
      mandatory: true
```

含义：

| 配置 | 作用 |
| --- | --- |
| `publisher-confirm-type: correlated` | 开启带关联数据的 publisher confirm |
| `publisher-returns: true` | 开启不可路由消息 return |
| `template.mandatory: true` | 消息无法路由时返回给生产者 |

`correlated` 的价值是：

```text
confirm 回来时，能知道是哪一条业务消息。
```

## 配置 RabbitTemplate 回调

```java
@Configuration
@RequiredArgsConstructor
public class RabbitProducerConfig {

    private final RabbitTemplate rabbitTemplate;

    @PostConstruct
    public void init() {
        rabbitTemplate.setConfirmCallback((correlationData, ack, cause) -> {
            String messageId = correlationData == null ? null : correlationData.getId();

            if (ack) {
                log.info("MQ 发送到 Broker 成功，messageId={}", messageId);
                return;
            }

            log.warn("MQ 发送到 Broker 失败，messageId={}, cause={}", messageId, cause);
            // 这里不要只打日志，核心消息应该更新 outbox 状态或触发重试。
        });

        rabbitTemplate.setReturnsCallback(returned -> {
            Message message = returned.getMessage();
            String messageId = message.getMessageProperties().getMessageId();

            log.warn(
                    "MQ 消息无法路由，messageId={}, exchange={}, routingKey={}, replyCode={}, replyText={}",
                    messageId,
                    returned.getExchange(),
                    returned.getRoutingKey(),
                    returned.getReplyCode(),
                    returned.getReplyText()
            );

            // 通常这是拓扑配置问题，不能简单无限重试。
        });
    }
}
```

注意：

```text
一个 RabbitTemplate 只能设置一个 ConfirmCallback。
一个 RabbitTemplate 只能设置一个 ReturnsCallback。
```

所以不要在多个业务 service 里各自 set callback。

应该集中配置，然后通过 `messageId` 或 `CorrelationData` 分发处理。

## 发送消息时带上 CorrelationData

```java
public void sendOrderCreatedEvent(OrderCreatedEvent event) {
    CorrelationData correlationData = new CorrelationData(event.eventId());

    rabbitTemplate.convertAndSend(
            RabbitMqConfig.ORDER_EXCHANGE,
            RabbitMqConfig.ORDER_CREATED_ROUTING_KEY,
            event,
            message -> {
                message.getMessageProperties().setMessageId(event.eventId());
                message.getMessageProperties().setType("order.created");
                message.getMessageProperties().setDeliveryMode(MessageDeliveryMode.PERSISTENT);
                return message;
            },
            correlationData
    );
}
```

这里有三个关键点：

- `CorrelationData` 用来关联 confirm。
- `messageId` 用来做链路追踪和消费幂等。
- `PERSISTENT` 表示消息持久化。

`eventId` 必须稳定。

如果发送失败后重试，不能重新生成新的 `eventId`。

否则消费端无法识别重复消息。

## confirm 和 return 的区别

### publisher confirm

confirm 回调说明：

```text
Broker 对这次 publish 给出了确认。
```

可能结果：

```text
ack = true:
    Broker 已经接收并承担责任。

ack = false:
    Broker 没有成功处理这次 publish。
```

### return callback

return 回调说明：

```text
消息无法路由到任何队列。
```

常见原因：

- routing key 写错。
- binding 没声明。
- 发送到了错误的 exchange。
- 队列被删了。

### 两者不要混淆

一条消息可能：

```text
先 return，再 confirm ack。
```

意思是：

```text
Broker 收到了消息，也判断它无法路由。
```

所以生产者可靠性要同时处理：

```text
confirm:
    这条消息 Broker 有没有接收？

return:
    这条消息有没有路由到队列？
```

## afterCommit 发送

如果只是学习项目，可以先这样写：

```java
@Transactional(rollbackFor = Exception.class)
public Long createOrder(CreateOrderCommand command) {
    OrderDO order = createOrderAndDeductStock(command);
    OrderCreatedEvent event = OrderCreatedEvent.from(order);

    TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
        @Override
        public void afterCommit() {
            sendOrderCreatedEvent(event);
        }
    });

    return order.getId();
}
```

这能避免：

```text
事务回滚但 MQ 已发送。
```

但不能避免：

```text
事务提交后，MQ 发送前应用宕机。
```

所以生产级核心链路建议用 outbox。

## outbox 方案

### 表结构

```sql
create table message_outbox (
  id bigint primary key auto_increment,
  event_id varchar(64) not null,
  event_type varchar(128) not null,
  aggregate_id varchar(64) not null,
  exchange_name varchar(128) not null,
  routing_key varchar(128) not null,
  payload json not null,
  status varchar(32) not null,
  retry_count int not null default 0,
  next_retry_time datetime not null,
  create_time datetime not null,
  update_time datetime not null,
  unique key uk_event_id (event_id),
  key idx_status_next_retry (status, next_retry_time)
);
```

状态可以设计为：

```text
NEW
SENDING
SENT
FAILED
ROUTE_FAILED
```

### 事务内写 outbox

```java
@Transactional(rollbackFor = Exception.class)
public Long createOrder(CreateOrderCommand command) {
    OrderDO order = createOrderAndDeductStock(command);

    OrderCreatedEvent event = OrderCreatedEvent.from(order);
    outboxMapper.insert(MessageOutboxDO.newMessage(
            event.eventId(),
            "order.created",
            String.valueOf(order.getId()),
            RabbitMqConfig.ORDER_EXCHANGE,
            RabbitMqConfig.ORDER_CREATED_ROUTING_KEY,
            objectMapper.writeValueAsString(event)
    ));

    return order.getId();
}
```

### 后台发送器

```java
@Scheduled(fixedDelay = 1000)
public void dispatchOutboxMessages() {
    List<MessageOutboxDO> messages = outboxMapper.selectPendingMessages(100);

    for (MessageOutboxDO message : messages) {
        try {
            outboxMapper.markSending(message.getId());
            rabbitProducer.send(message);
        } catch (Exception exception) {
            outboxMapper.markRetry(message.getId(), exception.getMessage());
        }
    }
}
```

confirm 成功：

```text
标记 SENT。
```

confirm 失败或超时：

```text
标记 RETRY，等待下次扫描。
```

return：

```text
标记 ROUTE_FAILED，通常报警，不建议无限重试。
```

## 发送重试怎么做

发送失败不要无限马上重试。

建议：

```text
第一次：立即重试。
第二次：10 秒后。
第三次：1 分钟后。
第四次：5 分钟后。
超过次数：标记 FAILED 并告警。
```

重试时必须复用：

```text
eventId
messageId
业务主键
```

不要重新创建新事件。

否则同一业务动作会变成多条不同消息。

## 不可路由消息怎么处理

return callback 常见 replyText：

```text
NO_ROUTE
```

这一般不是网络抖动，而是拓扑问题。

处理建议：

```text
记录 messageId、exchange、routingKey。
标记 ROUTE_FAILED。
立即报警。
检查 binding 和 queue。
修复拓扑后人工重发。
```

不要这样：

```text
收到 return 后无限重试。
```

因为 routing key 错了，重试一万次也进不了队列。

## 持久化要配齐

只设置消息持久化不够。

要一起看：

```text
exchange durable = true
queue durable = true
message deliveryMode = PERSISTENT
```

示例：

```java
@Bean
public DirectExchange orderExchange() {
    return new DirectExchange(RabbitMqConfig.ORDER_EXCHANGE, true, false);
}

@Bean
public Queue orderCreatedQueue() {
    return QueueBuilder.durable(RabbitMqConfig.ORDER_CREATED_QUEUE).build();
}
```

发送：

```java
message.getMessageProperties().setDeliveryMode(MessageDeliveryMode.PERSISTENT);
```

生产核心业务还要考虑 quorum queue，避免单节点队列数据风险。

## 和消费者幂等的关系

生产者重试会带来重复消息。

这是正常的。

比如：

```text
Broker 已经收到消息。
confirm ack 在网络中丢了。
生产者以为没成功，于是重发。
```

所以生产者可靠性必须和消费者幂等配套。

生产者负责：

```text
同一业务事件重试时使用同一个 eventId。
```

消费者负责：

```text
同一个 messageId + consumerName 只处理成功一次。
```

## 生产者可靠性检查清单

上线前检查：

```text
1. 是否在事务提交后发送 MQ？
2. 核心消息是否使用 outbox？
3. 是否开启 publisher-confirm-type: correlated？
4. 是否开启 publisher-returns？
5. 是否开启 mandatory？
6. 是否配置 ConfirmCallback？
7. 是否配置 ReturnsCallback？
8. confirm 失败是否会重试或标记 outbox？
9. return 是否会报警？
10. eventId 是否稳定？
11. messageId 是否写入消息属性？
12. 消息是否 persistent？
13. exchange 和 queue 是否 durable？
14. 路由失败能不能定位 exchange、routingKey、messageId？
15. 消费端是否幂等？
```

## 常见坑

### 只开 confirm，不开 return

confirm 成功不代表消息一定进入业务队列。

如果 routing key 错了，你需要 return callback 才能知道。

### 只在日志里打印 confirm 失败

核心消息 confirm 失败只打日志，没有重试或 outbox 状态更新，就等于没做可靠性。

### 每次重试生成新 UUID

这会让消费者无法判断重复。

正确做法：

```text
同一业务事件只生成一次 eventId。
重试发送复用这个 eventId。
```

### 在事务内直接发送

事务回滚后，消息已经发出去。

消费者可能处理一个不存在或无效的业务对象。

### return 后盲目重试

不可路由通常是配置问题。

先修 exchange、routing key、binding，再考虑重发。

## 关联笔记

- [MQ 可靠性总览](/notes/rabbitmq/reliability-overview)
- [Spring 事务同步与 MQ](/notes/rabbitmq/transaction-after-commit)
- [MQ 消费幂等](/notes/rabbitmq/message-idempotency)
- [RabbitMQ 消费者可靠性](/notes/rabbitmq/consumer-reliability)

## 参考

- [RabbitMQ Publishers](https://www.rabbitmq.com/docs/publishers)
- [RabbitMQ Consumer Acknowledgements and Publisher Confirms](https://www.rabbitmq.com/docs/confirms)
- [Spring AMQP Publisher Confirms and Returns](https://docs.spring.io/spring-amqp/reference/amqp/template.html#template-confirms)
