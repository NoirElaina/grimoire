---
title: MQ 可靠性总览
sidebarTitle: MQ 可靠性
---

# MQ 可靠性总览

> MQ 可靠性不是某一个开关，而是一条链路：业务事务要产生消息，生产者要把消息送到 Broker，Broker 要安全保存，消费者要处理成功，业务还要能承受重复消息。

## 消息链路

一条消息从生产到消费，大概经过这些节点：

```text
业务代码
  -> 本地数据库事务
  -> 生产者发送消息
  -> Exchange
  -> Binding + Routing Key
  -> Queue
  -> Consumer
  -> 业务处理
  -> ack / nack
```

每一段都有可能失败：

| 位置 | 可能的问题 |
| --- | --- |
| 本地事务 | 订单回滚了，但 MQ 消息已经发出 |
| 发送过程 | 网络断开，生产者不知道消息有没有到 Broker |
| Exchange | 交换机不存在，channel 被关闭 |
| 路由 | routing key 写错，消息没有进入任何队列 |
| Queue | 队列非持久化，Broker 重启后队列或消息没了 |
| Consumer | 业务处理成功，但 ack 前消费者宕机 |
| 业务逻辑 | MQ 重复投递，库存、积分、优惠券重复执行 |
| 异常消息 | 消息一直失败，无限 requeue 打爆消费者 |

所以可靠性设计要按链路逐段兜。

## 三种投递语义

### 最多一次

```text
消息可能丢，但不会重复。
```

典型错误写法：

```text
消费者收到消息后自动 ack。
业务还没处理完，进程挂了。
消息已经被 Broker 删除。
```

这种适合日志、指标这类可以少量丢失的场景。

不适合订单、支付、库存。

### 至少一次

```text
消息尽量不丢，但可能重复。
```

RabbitMQ 做可靠业务时，通常追求的是这个语义。

配套做法：

```text
生产者 confirm。
消费者 manual ack。
失败消息重试或进死信。
业务幂等。
```

注意：

```text
至少一次 = 不丢优先，但要接受重复。
```

### 业务上的恰好一次

严格意义上的“消息只投递一次、只处理一次”很难。

工程里通常做的是：

```text
MQ 层至少一次。
业务层幂等。
最终效果看起来只成功一次。
```

比如：

```text
同一个 orderId 只能取消一次。
同一个 paymentNo 只能支付成功一次。
同一个 messageId + consumerName 只能消费成功一次。
```

这叫业务上的 effectively-once。

## 可靠性的五道防线

### 防线一：本地事务和消息发送一致

错误写法：

```text
开启订单事务
发送 MQ
插入订单失败
事务回滚
消费者收到不存在的订单
```

第一步改进：

```text
订单事务提交后，在 afterCommit 里发送 MQ。
```

更强方案：

```text
订单事务内写业务数据 + 写 outbox。
后台任务发送 outbox 消息。
confirm 成功后标记 SENT。
```

`afterCommit` 解决的是：

```text
事务没提交，不发消息。
```

`outbox` 解决的是：

```text
事务提交后，发送 MQ 前应用崩溃。
```

### 防线二：生产者确认消息到达 Broker

生产者不能认为：

```text
rabbitTemplate.convertAndSend() 调用了，消息就一定可靠。
```

网络可能断，Broker 可能拒绝，连接可能被阻塞。

生产端要用：

```text
publisher confirm
```

Broker 接收并承担消息责任后，会给生产者确认。

如果没有收到 confirm，就要按业务策略重试或交给 outbox 重新发送。

### 防线三：确认消息路由到了队列

publisher confirm 主要说明 Broker 接收了发布操作。

但还要关心：

```text
消息有没有路由到任何队列？
```

如果 exchange 存在，但 routing key 写错，消息可能没有进入业务队列。

要用：

```text
mandatory = true
return callback
```

当消息无法路由时，Broker 会把消息 return 给生产者。

生产者收到 return 后，通常不应该盲目重试，而要先排查：

- exchange 是否正确。
- routing key 是否正确。
- binding 是否存在。
- 队列是否声明成功。

### 防线四：Broker 持久化和高可用

可靠消息至少要考虑：

```text
durable exchange
durable queue
persistent message
```

意思是：

```text
交换机持久化。
队列持久化。
消息持久化。
```

但这还不等于绝对安全。

如果 Broker 节点在消息真正落盘前崩溃，仍然可能丢消息。

所以生产者要配合 publisher confirm。

如果是生产核心链路，还要考虑：

- quorum queue。
- 集群部署。
- 磁盘和内存告警。
- 监控 ready、unacked、publish rate、deliver rate。

### 防线五：消费者处理成功后再 ack

消费者不能在业务处理前 ack。

错误写法：

```text
收到消息
  -> ack
  -> 执行业务
```

如果 ack 后业务失败，消息已经被 Broker 删除。

正确顺序：

```text
收到消息
  -> 幂等判断
  -> 执行业务事务
  -> 事务提交成功
  -> ack
```

如果业务失败：

```text
可恢复失败：
    进入延迟重试。

不可恢复失败：
    进入死信队列。

重复消息：
    直接 ack。
```

## 可靠性不等于不重复

这点很重要。

可靠消息系统通常会让消息重复，而不是冒险丢消息。

比如：

```text
消费者处理成功。
ack 还没发出去。
消费者宕机。
Broker 重新投递。
```

这时消息会重复。

再比如：

```text
生产者发送成功。
Broker confirm 已经发出。
网络断了，生产者没收到 confirm。
生产者重新发送。
```

这时也会重复。

所以：

```text
生产者可靠性越强，越可能带来重复消息。
消费者必须幂等。
```

## Broker 侧配置要点

### durable exchange

```java
@Bean
public DirectExchange orderExchange() {
    return new DirectExchange("flashmart.order.exchange", true, false);
}
```

第二个参数 `true` 表示 durable。

### durable queue

```java
@Bean
public Queue orderCreatedQueue() {
    return QueueBuilder.durable("flashmart.order.created.queue").build();
}
```

### persistent message

```java
rabbitTemplate.convertAndSend(exchange, routingKey, event, message -> {
    message.getMessageProperties().setMessageId(event.eventId());
    message.getMessageProperties().setDeliveryMode(MessageDeliveryMode.PERSISTENT);
    return message;
});
```

通常 Spring AMQP 发送普通消息时会有默认持久化行为，但核心消息不要只靠猜。

可以在发送时显式设置，或者统一配置消息转换器和后处理器。

## 典型可靠链路

如果是订单创建事件，可以这样设计：

```text
订单事务
  -> 插入 orders
  -> 插入 order_items
  -> 扣减库存
  -> 写 message_outbox(eventId, eventType, payload, NEW)
  -> 提交事务

Outbox 发送器
  -> 扫描 NEW / RETRY 消息
  -> 发送 RabbitMQ
  -> 等待 publisher confirm
  -> confirm ack: 标记 SENT
  -> confirm nack / timeout: 标记 RETRY
  -> return: 标记 ROUTE_FAILED

RabbitMQ
  -> durable exchange
  -> durable queue
  -> persistent message

消费者
  -> manual ack
  -> 消费日志表或业务唯一约束
  -> 业务事务提交
  -> ack
  -> 失败进重试或死信
```

这条链路做到的是：

```text
消息大概率不丢。
失败能重试。
重复能幂等。
异常能排查。
```

## 可靠性分级

不是所有消息都要按最高级别做。

### 普通通知类

比如：

- 发送站内信。
- 刷新缓存。
- 记录非核心日志。

可以：

```text
publisher confirm 可选。
consumer auto / manual ack 按场景。
失败可少量丢弃。
```

### 业务事件类

比如：

- 订单创建。
- 支付成功。
- 库存扣减。
- 发券。

建议：

```text
publisher confirm。
mandatory return。
manual ack。
死信队列。
消费幂等。
```

### 核心交易类

比如：

- 支付回调。
- 退款成功。
- 资金流水。

建议：

```text
outbox。
publisher confirm。
mandatory return。
quorum queue。
manual ack。
消费日志。
业务唯一约束。
死信队列。
兜底扫描。
对账补偿。
```

## 排查可靠性问题

消息“没了”时，不要只盯着消费者。

按链路查：

1. 业务事务有没有提交。
2. 是否在事务提交前发送 MQ。
3. 生产者有没有开启 publisher confirm。
4. 是否收到 confirm ack。
5. 是否收到 return callback。
6. exchange、routing key、binding 是否正确。
7. queue 是否 durable。
8. message 是否 persistent。
9. 队列 ready 数是否增加。
10. 队列 unacked 数是否异常。
11. 消费者 ack 模式是什么。
12. 是否业务成功前就 ack。
13. 失败消息是否无限 requeue。
14. 是否进入死信队列。
15. 消费幂等是否把消息直接忽略了。

## 最小落地清单

核心业务消息至少做到：

```text
生产者：
  - afterCommit 或 outbox。
  - publisher confirm。
  - mandatory return。
  - 稳定 eventId / messageId。

Broker：
  - durable exchange。
  - durable queue。
  - persistent message。
  - 死信队列。

消费者：
  - manual ack。
  - 业务成功后 ack。
  - 失败进入重试或死信。
  - 消费幂等。
  - 监控 ready / unacked / dead-letter。
```

## 关联笔记

- [Spring 事务同步与 MQ](/notes/rabbitmq/transaction-after-commit)
- [RabbitMQ 死信队列](/notes/rabbitmq/dead-letter-queue)
- [RabbitMQ 延迟队列](/notes/rabbitmq/delay-queue)
- [MQ 消费幂等](/notes/rabbitmq/message-idempotency)
- [RabbitMQ 生产者可靠性](/notes/rabbitmq/producer-reliability)
- [RabbitMQ 消费者可靠性](/notes/rabbitmq/consumer-reliability)

## 参考

- [RabbitMQ Reliability Guide](https://www.rabbitmq.com/docs/reliability)
- [RabbitMQ Consumer Acknowledgements and Publisher Confirms](https://www.rabbitmq.com/docs/confirms)
- [RabbitMQ Publishers](https://www.rabbitmq.com/docs/publishers)
