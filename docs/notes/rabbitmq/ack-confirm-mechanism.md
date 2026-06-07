---
title: RabbitMQ ACK 确认机制
sidebarTitle: ACK 确认机制
---

# RabbitMQ ACK 确认机制

> ACK 不是“消费者收到消息了”这么简单。消费者 ACK 解决的是 Broker 到消费者这一段的处理确认；publisher confirm 解决的是生产者到 Broker 这一段的投递确认。

## 两种确认不要混

RabbitMQ 里常见两个确认：

| 确认 | 谁发给谁 | 解决什么 |
| --- | --- | --- |
| consumer ack | Consumer -> RabbitMQ | 消费者是否已经处理完消息 |
| publisher confirm | RabbitMQ -> Producer | Broker 是否接收了生产者消息 |

它们不是一回事。

```text
生产者发消息
  -> publisher confirm 确认消息到 Broker
  -> exchange 路由到 queue
  -> queue 投递给 consumer
  -> consumer ack 确认业务处理完成
```

所以一条可靠链路要同时考虑：

- 生产者是否发成功。
- 消息是否路由到队列。
- 消费者是否处理成功。
- 重复投递时业务是否幂等。

## Consumer ACK 是什么

消费者拿到消息后，RabbitMQ 需要知道：

```text
这条消息可以从队列里删除了吗？
```

消费者通过 ACK 回答这个问题。

如果消费者处理成功并 ack：

```text
RabbitMQ 删除这条消息。
```

如果消费者没 ack 就断开连接：

```text
RabbitMQ 会认为这条消息没有处理完成，后续可能重新投递。
```

这也是重复消费的常见来源。

## Delivery Tag

每次投递都有一个 `deliveryTag`。

它的特点：

- 标识当前 channel 上的一次投递。
- 只在当前 channel 内有意义。
- 不能当业务幂等键。
- 重复投递时可能得到新的 `deliveryTag`。

错误：

```java
String idempotentKey = String.valueOf(message.getMessageProperties().getDeliveryTag());
```

正确：

```java
String idempotentKey = event.eventId();
```

幂等键必须来自业务事件，不应该来自 MQ 投递编号。

## 自动 ACK

自动 ACK 的语义是：

```text
RabbitMQ 把消息发给消费者后，就认为消息已经处理完成。
```

风险：

```text
消息刚到消费者进程。
消费者还没写数据库。
应用突然宕机。
RabbitMQ 已经把消息删了。
```

所以自动 ACK 只适合：

- 日志类。
- 允许丢的统计类。
- 非核心通知。

核心业务不要用自动 ACK。

## Spring AUTO 模式

Spring AMQP 的 `AUTO` 不是 RabbitMQ 协议层的自动 ACK。

它通常表示：

```text
listener 方法正常返回，容器帮你 ack。
listener 方法抛异常，容器按异常和重试配置处理。
```

适合简单业务。

但核心链路我更倾向于 `MANUAL`：

```text
业务事务提交成功后，我才明确 basicAck。
```

边界更清楚。

## Manual ACK

手动 ACK 由代码控制。

常用方法：

```text
basicAck:
    正常确认，消息可以删除。

basicNack:
    否定确认，支持 multiple，支持 requeue。

basicReject:
    否定确认，不支持 multiple。
```

Java 代码：

```java
@RabbitListener(queues = RabbitMqConfig.ORDER_CREATED_QUEUE, ackMode = "MANUAL")
public void onMessage(OrderCreatedEvent event, Channel channel, Message message) throws IOException {
    long deliveryTag = message.getMessageProperties().getDeliveryTag();

    try {
        orderEventService.handle(event);
        channel.basicAck(deliveryTag, false);
    } catch (DuplicateMessageException exception) {
        channel.basicAck(deliveryTag, false);
    } catch (Exception exception) {
        channel.basicNack(deliveryTag, false, false);
    }
}
```

这里的策略是：

```text
业务成功：
    ack。

重复消息：
    已处理过，直接 ack。

业务失败：
    nack(false)，进入重试或死信，不回原队列无限循环。
```

## `multiple` 参数

`basicAck(deliveryTag, multiple)` 里的 `multiple` 表示是否批量确认。

```java
channel.basicAck(deliveryTag, false);
```

只确认当前这条。

```java
channel.basicAck(deliveryTag, true);
```

确认当前 channel 上所有小于等于这个 `deliveryTag` 的未确认消息。

业务项目里通常用：

```java
multiple = false
```

原因：

- 单条消息处理成功就确认单条。
- 避免前面某条还没处理完，却被批量 ack 掉。
- 代码语义更清楚。

## `requeue` 参数

`basicNack(deliveryTag, multiple, requeue)` 里的 `requeue` 很关键。

```java
channel.basicNack(deliveryTag, false, true);
```

表示重新放回队列。

风险：

```text
消费者处理失败。
消息立刻回队列。
又被同一个消费者拿到。
再次失败。
再次回队列。
形成无限重投。
```

核心业务更推荐：

```java
channel.basicNack(deliveryTag, false, false);
```

然后通过：

- 重试队列。
- 延迟重试。
- 死信队列。
- 人工补偿。

来处理失败消息。

## ACK 和数据库事务顺序

正确顺序：

```text
收到消息
  -> 业务幂等判断
  -> 开启本地事务
  -> 写业务表
  -> 写消费日志
  -> 提交事务
  -> basicAck
```

错误顺序：

```text
收到消息
  -> basicAck
  -> 写数据库
  -> 数据库异常
```

因为 ACK 后，RabbitMQ 就认为消息结束了。

如果数据库失败，消息不会再投递。

## `@Transactional` 和 ACK 的坑

不推荐把 ACK 写在带事务的 listener 方法中间：

```java
@RabbitListener(queues = RabbitMqConfig.ORDER_CREATED_QUEUE, ackMode = "MANUAL")
@Transactional(rollbackFor = Exception.class)
public void onMessage(OrderCreatedEvent event, Channel channel, Message message) throws IOException {
    orderService.handle(event);
    channel.basicAck(message.getMessageProperties().getDeliveryTag(), false);
}
```

原因：

```text
basicAck 可能已经发送。
但 Spring 事务真正提交发生在方法返回之后。
如果方法返回前后事务提交失败，消息已经被确认删除。
```

更清楚的结构：

```java
@RabbitListener(queues = RabbitMqConfig.ORDER_CREATED_QUEUE, ackMode = "MANUAL")
public void onMessage(OrderCreatedEvent event, Channel channel, Message message) throws IOException {
    long deliveryTag = message.getMessageProperties().getDeliveryTag();
    try {
        orderEventService.handle(event);
        channel.basicAck(deliveryTag, false);
    } catch (Exception exception) {
        channel.basicNack(deliveryTag, false, false);
    }
}
```

```java
@Service
public class OrderEventService {
    @Transactional(rollbackFor = Exception.class)
    public void handle(OrderCreatedEvent event) {
        // 幂等判断 + 业务写库
    }
}
```

Service 返回成功后，事务已经提交，再 ACK。

## Prefetch 和 unacked

`prefetch` 控制消费者最多同时持有多少条未 ACK 消息。

```yaml
spring:
  rabbitmq:
    listener:
      simple:
        acknowledge-mode: manual
        prefetch: 10
```

含义：

```text
同一个消费者最多同时拿 10 条还没 ack 的消息。
如果已经有 10 条 unacked，RabbitMQ 暂时不会继续投递给它。
```

`prefetch` 太大：

- 消费者内存压力变大。
- 单个消费者囤积消息。
- 消费失败时重投范围变大。
- 慢消费者拖住消息。

`prefetch` 太小：

- 吞吐不足。
- 消费者频繁等待消息。

经验：

```text
业务处理慢、涉及数据库事务：
    prefetch 小一点。

业务处理快、幂等轻量：
    可以适当增大。
```

## Publisher Confirm

生产者发送消息后，不能只相信 `convertAndSend` 没报错。

网络可能失败，Broker 也可能没真正接收。

publisher confirm 用来确认：

```text
消息是否被 RabbitMQ Broker 接收。
```

Spring Boot 常见配置：

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
| `publisher-confirm-type: correlated` | 生产者拿到 Broker ack/nack |
| `publisher-returns: true` | 消息无法路由到队列时回调 |
| `mandatory: true` | 无法路由时触发 return |

确认回调关注：

```text
ack = true:
    Broker 接收了消息。

ack = false:
    Broker 没确认接收，要记录失败并重试。
```

return 回调关注：

```text
exchange 存在，但 routing key 没有匹配队列。
```

## ACK 机制回答模板

可以这样讲：

```text
RabbitMQ 有两类确认。

生产端用 publisher confirm 确认消息是否到 Broker，
再用 mandatory return 处理无法路由到队列的消息。

消费端用 manual ack。
消费者业务处理成功后才 basicAck。
业务失败时 basicNack，并且通常 requeue=false，让消息进入重试或死信流程。

如果消费者处理成功但 ack 前宕机，RabbitMQ 会重新投递，所以消费端必须幂等。
幂等不能用 deliveryTag，要用业务 eventId、消费日志表、唯一约束或状态机条件更新。
```

## 常见坑

### 把 ACK 当成业务成功

ACK 只是告诉 RabbitMQ 可以删除消息。

业务是否成功，要看数据库事务是否提交。

### 先 ACK 后写库

这是丢消息的经典写法。

### 重复消息继续 NACK

重复消息说明已经处理过。

应该直接 ACK，不要继续打进重试或死信。

### 无限 requeue

`requeue = true` 容易让坏消息无限循环。

### 用 deliveryTag 做幂等键

`deliveryTag` 是投递编号，不是业务事件编号。

### 只配 ACK，不做幂等

ACK 不能消灭重复投递。

业务幂等才是重复消费的最后防线。

## 检查清单

- [ ] 核心消费者是否使用 manual ACK。
- [ ] 业务事务提交成功后才 ACK。
- [ ] 失败是否不会无限 requeue。
- [ ] 是否配置重试或死信队列。
- [ ] 重复消息是否直接 ACK。
- [ ] 幂等键是否来自业务 `eventId`。
- [ ] 生产者是否开启 publisher confirm。
- [ ] 无法路由的消息是否有 return 处理。
- [ ] `prefetch` 是否和业务处理耗时匹配。

## 关联笔记

- [MQ 消费幂等](/notes/rabbitmq/message-idempotency)
- [RabbitMQ 消费者可靠性](/notes/rabbitmq/consumer-reliability)
- [RabbitMQ 生产者可靠性](/notes/rabbitmq/producer-reliability)
- [RabbitMQ 死信队列](/notes/rabbitmq/dead-letter-queue)

## 参考

- [RabbitMQ Consumer Acknowledgements and Publisher Confirms](https://www.rabbitmq.com/docs/confirms)

