---
title: RabbitMQ 消费者可靠性
sidebarTitle: 消费者可靠性
---

# RabbitMQ 消费者可靠性

> 消费者可靠性的核心问题是：消息到达消费者后，业务真的处理成功了吗？失败时会不会丢？重复投递时会不会重复执行业务？

## 消费者要负责什么

消费者不是收到消息就完事。

它至少要保证：

```text
1. 业务成功后再 ack。
2. 业务失败时消息能重试或进死信。
3. 重复消息不会重复执行业务。
4. 消费速度不会把自己打爆。
5. 异常消息不会无限 requeue。
```

对应机制：

| 问题 | 机制 |
| --- | --- |
| 处理前消息不能删除 | manual ack |
| 业务失败不能丢 | nack + 重试队列 / 死信队列 |
| 重复消费不能重复写业务 | 幂等表 / 唯一约束 / 状态机 |
| 消费者不能被压垮 | prefetch + concurrency |
| 毒丸消息不能无限循环 | 最大重试次数 + DLQ |

## ack 是什么

RabbitMQ 把消息投递给消费者后，需要知道：

```text
这条消息可以从队列里删除了吗？
```

消费者通过 ack 告诉 RabbitMQ：

```text
我已经处理完成，你可以删除了。
```

如果消费者没有 ack 就断开连接，RabbitMQ 会重新投递消息。

这就是为什么可靠消费通常是：

```text
manual ack + 业务幂等
```

## ack 模式

### 自动 ack

自动 ack 的语义是：

```text
消息投递出去后，Broker 就认为成功了。
```

风险：

```text
消费者收到消息。
Broker 认为已经完成。
消费者还没处理业务就宕机。
消息丢失。
```

所以自动 ack 不适合核心业务。

### Spring AUTO

Spring AMQP 的 `AUTO` 不是 RabbitMQ 原生自动 ack。

它通常表示：

```text
listener 方法正常返回，容器 ack。
listener 方法抛异常，容器按规则 reject / requeue。
```

它适合简单业务，但核心链路我更倾向于 manual ack。

原因是 manual ack 能把边界写得很清楚：

```text
业务事务提交成功后，我才 ack。
```

### manual ack

manual ack 由代码显式控制：

```text
basicAck:
    消费成功。

basicNack:
    消费失败，可以选择是否 requeue。

basicReject:
    拒绝单条消息。
```

核心业务推荐：

```text
acknowledge-mode: manual
```

## Spring Boot 配置

`application.yml`：

```yaml
spring:
  rabbitmq:
    listener:
      simple:
        acknowledge-mode: manual
        prefetch: 10
        concurrency: 2
        max-concurrency: 8
        default-requeue-rejected: false
```

含义：

| 配置 | 作用 |
| --- | --- |
| `acknowledge-mode: manual` | 手动 ack |
| `prefetch: 10` | 每个消费者最多同时拿 10 条未 ack 消息 |
| `concurrency: 2` | 初始消费者线程数 |
| `max-concurrency: 8` | 最大消费者线程数 |
| `default-requeue-rejected: false` | 异常时默认不重新入队，避免无限循环 |

`prefetch` 不要乱设太大。

如果单条消息处理耗时长，prefetch 太大会导致：

- 消费者内存压力变大。
- 消息长时间处于 unacked。
- 其他消费者拿不到消息。
- 服务停止时大量消息需要重新入队。

## 正确的 ack 顺序

最安全的顺序：

```text
收到消息
  -> 调用事务 service
  -> 幂等判断
  -> 执行业务
  -> 事务提交成功
  -> listener basicAck
```

注意一个细节：

如果 `@RabbitListener` 方法本身加了 `@Transactional`，然后在方法内部 `basicAck`：

```text
basicAck 可能早于事务真正提交。
```

更清晰的写法是：

```text
Listener 不开事务。
Listener 调用带 @Transactional 的 Service。
Service 返回后事务已经提交。
Listener 再 ack。
```

## 推荐代码结构

### Listener 负责 MQ 边界

```java
@Component
@RequiredArgsConstructor
public class OrderCreatedConsumer {

    private final OrderCreatedConsumerService consumerService;

    @RabbitListener(queues = RabbitMqConfig.ORDER_CREATED_QUEUE, ackMode = "MANUAL")
    public void onMessage(OrderCreatedEvent event, Message message, Channel channel) throws IOException {
        long deliveryTag = message.getMessageProperties().getDeliveryTag();
        String messageId = message.getMessageProperties().getMessageId();

        if (!StringUtils.hasText(messageId)) {
            messageId = event.eventId();
        }

        try {
            consumerService.consume(event, messageId);
            channel.basicAck(deliveryTag, false);
        } catch (DuplicateMessageException exception) {
            channel.basicAck(deliveryTag, false);
        } catch (RetryableMessageException exception) {
            channel.basicNack(deliveryTag, false, false);
        } catch (Exception exception) {
            channel.basicNack(deliveryTag, false, false);
        }
    }
}
```

这里的策略：

```text
成功：
    ack。

重复消息：
    ack。

可重试失败：
    nack(false)，进入重试或死信。

未知异常：
    nack(false)，避免无限 requeue。
```

### Service 负责业务事务

```java
@Service
@RequiredArgsConstructor
public class OrderCreatedConsumerService {

    private static final String CONSUMER_NAME = "orderCreatedConsumer";

    private final MqConsumeLogMapper consumeLogMapper;
    private final CouponService couponService;

    @Transactional(rollbackFor = Exception.class)
    public void consume(OrderCreatedEvent event, String messageId) {
        boolean firstConsume = consumeLogMapper.tryStart(messageId, CONSUMER_NAME);
        if (!firstConsume) {
            throw new DuplicateMessageException(messageId);
        }

        couponService.issueByOrder(event.userId(), event.orderId());
        consumeLogMapper.markSuccess(messageId, CONSUMER_NAME);
    }
}
```

这样事务边界和 ack 边界就清楚了：

```text
Service 返回成功 -> 事务已提交 -> Listener ack。
```

## 失败消息怎么处理

### 不要无限 requeue

危险写法：

```java
channel.basicNack(deliveryTag, false, true);
```

`requeue = true` 表示重新放回队列。

如果业务永远处理不了这条消息，它会反复投递：

```text
消费失败
  -> requeue
  -> 立即又消费
  -> 又失败
  -> 又 requeue
```

这叫毒丸消息，会拖垮消费者。

### 推荐进入重试或死信

更推荐：

```java
channel.basicNack(deliveryTag, false, false);
```

含义：

```text
不重新入原队列。
如果队列配置了 DLX，就进入死信交换机。
```

然后用：

- 延迟队列做重试。
- 死信队列做最终兜底。

## 重试策略

重试要有次数上限。

比如：

```text
第 1 次失败：10 秒后重试
第 2 次失败：30 秒后重试
第 3 次失败：2 分钟后重试
超过 3 次：进入死信队列
```

重试消息要带上：

```text
messageId
retryCount
firstFailureTime
lastFailureReason
```

不要只靠日志。

否则出了问题很难追。

## 幂等是消费者可靠性的核心

RabbitMQ 可靠消费通常是至少一次。

这意味着：

```text
消息可能重复。
```

重复来源：

- 业务成功但 ack 前宕机。
- ack 在网络中丢失。
- 生产者 confirm 丢失后重发。
- 死信消息人工重投。
- 重试队列重新投递。

所以消费者必须幂等。

常见做法：

### 业务唯一约束

```sql
create unique index uk_order_coupon
    on user_coupon(order_id, coupon_type);
```

重复发券时，数据库唯一键兜住。

### 消费日志表

```sql
create table mq_consume_log (
  id bigint primary key auto_increment,
  message_id varchar(64) not null,
  consumer_name varchar(128) not null,
  status varchar(16) not null,
  create_time datetime not null,
  update_time datetime not null,
  unique key uk_message_consumer (message_id, consumer_name)
);
```

唯一键一定要包含：

```text
message_id + consumer_name
```

因为同一条消息可能被多个消费者处理。

### 状态机条件更新

```sql
update orders
set status = 'CANCELED',
    cancel_time = now()
where id = #{orderId}
  and status = 'PENDING_PAYMENT';
```

只有第一次取消成功。

重复消息影响行数为 0，不重复恢复库存。

## `redelivered` 只能当提示

RabbitMQ 重新投递时，消息上可能带：

```text
redelivered = true
```

它可以提示：

```text
这条消息可能之前投递过。
```

但不要只靠它做幂等。

幂等最终还是要落在：

- 数据库唯一约束。
- 消费日志。
- 状态机条件更新。

## prefetch 怎么理解

`prefetch` 控制消费者最多有多少条未 ack 消息。

比如：

```text
prefetch = 10
```

表示：

```text
同一个消费者最多同时持有 10 条 unacked 消息。
```

如果已经有 10 条没 ack，RabbitMQ 暂时不会继续投递给它。

作用：

- 防止消费者被大量消息压垮。
- 控制内存占用。
- 让多个消费者更公平地分配消息。

建议：

| 场景 | prefetch 建议 |
| --- | --- |
| 单条处理很快 | 可以适当大一些 |
| 单条处理很慢 | 小一些，比如 1-10 |
| 消息体很大 | 小一些 |
| 严格顺序消费 | 通常设 1，并控制单消费者 |
| 批量处理 | 根据批大小设置 |

## 消费者并发

消费者并发不是越大越好。

并发会影响：

- 数据库连接池。
- 下游接口压力。
- 本地 CPU。
- 消息顺序。
- 业务锁竞争。

比如：

```yaml
spring:
  rabbitmq:
    listener:
      simple:
        concurrency: 2
        max-concurrency: 8
```

这表示容器可以按压力扩展消费者线程。

但如果业务需要同一个订单消息顺序处理，就不能只靠 RabbitMQ 普通队列多消费者。

需要额外设计：

- 按业务 key 分片队列。
- 同一 key 固定路由。
- 单队列单消费者。
- 或用状态机兜住乱序。

## 外部副作用要幂等

消费者里如果调用外部接口，比如：

- 支付系统。
- 短信服务。
- 物流系统。
- 优惠券系统。

也要传幂等号。

否则会出现：

```text
本地数据库幂等了。
但外部系统重复执行了。
```

比如发短信可以接受重复风险，但支付、退款、发券不行。

调用外部系统时建议传：

```text
requestId = messageId + consumerName
```

或者使用业务单号：

```text
paymentNo
refundNo
couponIssueNo
```

## 监控消费者可靠性

重点看这些指标：

```text
ready:
    队列中等待消费的消息数。

unacked:
    已投递给消费者，但还没 ack 的消息数。

consumer count:
    消费者数量。

deliver rate:
    投递速率。

ack rate:
    ack 速率。

redeliver rate:
    重新投递速率。

dead-letter count:
    死信数量。
```

异常信号：

| 现象 | 可能原因 |
| --- | --- |
| ready 一直涨 | 消费太慢或消费者挂了 |
| unacked 很高 | 消费者卡住、prefetch 太大、业务阻塞 |
| redeliver 很高 | 业务反复失败、ack 异常、连接不稳定 |
| DLQ 增长 | 消息不可处理或下游故障 |
| 消费者数量为 0 | 服务没启动、监听失败、队列不存在 |

## 消费者可靠性检查清单

上线前检查：

```text
1. 是否使用 manual ack？
2. ack 是否发生在业务事务提交之后？
3. 异常消息是否不会无限 requeue？
4. 是否有重试次数上限？
5. 是否配置死信队列？
6. 是否有消费幂等？
7. 幂等键是否包含 consumerName？
8. 重复消息是否直接 ack？
9. prefetch 是否合理？
10. 并发是否压垮数据库或下游？
11. 外部接口是否传幂等号？
12. 是否监控 ready、unacked、redeliver、DLQ？
13. 是否能人工重放死信消息？
14. 重放死信是否仍然幂等？
15. 消费失败日志是否包含 messageId、orderId、retryCount？
```

## 常见坑

### ack 早于业务提交

消息已经被删除，但数据库事务后来回滚。

这会丢消息。

### 失败时 `requeue = true`

毒丸消息会一直冲击消费者。

推荐使用延迟重试和死信队列。

### 没有幂等

消费者处理成功但 ack 前宕机，消息会重新投递。

没有幂等就会重复扣库存、重复发券、重复加积分。

### prefetch 太大

大量消息变成 unacked，消费者内存压力变大。

服务重启时还会造成大量消息重新入队。

### 把 redelivered 当唯一依据

`redelivered` 是提示，不是业务幂等保证。

幂等必须靠数据库或业务状态兜住。

## 关联笔记

- [MQ 可靠性总览](/notes/rabbitmq/reliability-overview)
- [RabbitMQ 生产者可靠性](/notes/rabbitmq/producer-reliability)
- [RabbitMQ 死信队列](/notes/rabbitmq/dead-letter-queue)
- [RabbitMQ 延迟队列](/notes/rabbitmq/delay-queue)
- [MQ 消费幂等](/notes/rabbitmq/message-idempotency)

## 参考

- [RabbitMQ Reliability Guide](https://www.rabbitmq.com/docs/reliability)
- [RabbitMQ Consumer Acknowledgements and Publisher Confirms](https://www.rabbitmq.com/docs/confirms)
- [RabbitMQ Consumers](https://www.rabbitmq.com/docs/consumers)
- [Spring AMQP Listener Container Configuration](https://docs.spring.io/spring-amqp/reference/amqp/containerAttributes.html)
