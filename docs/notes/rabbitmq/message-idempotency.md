---
title: MQ 消费幂等
sidebarTitle: MQ 幂等
---

# MQ 消费幂等

> MQ 幂等的核心不是“消息一定不会重复”，而是：同一条消息重复到达时，消费者多执行几次，业务最终结果仍然正确。

## 先纠正一个说法

“MQ 保证不重复消费”这个说法不准确。

更准确的表达是：

```text
MQ 可以通过 ack、重试、死信降低消息丢失风险。
但只要存在网络、宕机、重试、消费者超时，就不能承诺消息永远只投递一次。
所以工程上要保证：重复投递时业务不重复生效。
```

也就是：

```text
Broker 负责尽量可靠投递。
消费者负责幂等处理。
数据库负责最终约束。
```

如果面试问“怎么保证 MQ 不重复消费”，不要回答“RabbitMQ 自己保证不重复”。

应该回答：

```text
不追求物理上绝不重复投递，而是在消费端做幂等。

消息必须有全局唯一 eventId。
消费者用消费日志表、业务唯一索引或状态机条件更新兜住重复处理。
业务成功后再 ack。
如果发现消息已处理，直接 ack，不再 nack 重试。
```

## 为什么 MQ 会重复消费

RabbitMQ 常见工程形态是 **至少一次投递**。

也就是说，只要系统中有网络、进程、事务、ack 这些边界，就要默认消息可能重复。

常见重复来源：

- 生产者发送后没有收到 publisher confirm，于是重试发送。
- 本地事务提交了，但应用在发送 MQ 前后崩溃，补偿任务重新发送。
- 消费者业务处理成功了，但还没来得及 `basicAck` 就断开连接。
- 消费者 `basicNack(..., requeue = true)` 后消息重新回到队列。
- 死信队列、重试队列、人工补偿时把旧消息重新投递。
- 多实例消费者并发抢同一类消息，某个实例处理中途超时或重启。

所以 MQ 设计里不要追求“永远不重复”，而要设计成：

```text
消息可以重复来
  -> 消费者能识别是否处理过
  -> 重复消息直接 ack
  -> 第一次消息才执行业务
```

## 幂等到底幂等什么

幂等要先确定维度。

### 按消息维度

同一个 `eventId` 或 `messageId` 只能被同一个消费者成功处理一次。

适合：

- 订单创建事件发优惠券。
- 支付成功事件写积分。
- 库存扣减事件写流水。

### 按业务维度

同一个业务对象只能进入目标状态一次。

适合：

- 订单超时取消：只有 `WAITING_PAY` 才能改成 `CLOSED`。
- 支付成功：只有 `UNPAID` 才能改成 `PAID`。
- 发货：只有 `PAID` 才能改成 `SHIPPED`。

### 按消费者维度

同一条消息可能被多个消费者处理。

比如 `OrderCreatedEvent` 同时被这些消费者订阅：

- 发优惠券消费者。
- 写审计日志消费者。
- 发送站内信消费者。

这时不能只用 `messageId` 判断全局处理过，否则第一个消费者处理完，其他消费者就会被误判成重复。

更稳的唯一键是：

```text
message_id + consumer_name
```

## 消息 ID 怎么设计

生产端创建事件时就要生成稳定 ID：

```java
OrderCreatedEvent event = new OrderCreatedEvent(
        UUID.randomUUID().toString(),
        order.getId(),
        order.getOrderNo(),
        userId,
        LocalDateTime.now()
);
```

这个 `eventId` 要贯穿整条链路：

```java
rabbitTemplate.convertAndSend(
        RabbitMqConfig.ORDER_EXCHANGE,
        RabbitMqConfig.ORDER_CREATED_ROUTING_KEY,
        event,
        message -> {
            message.getMessageProperties().setMessageId(event.eventId());
            return message;
        }
);
```

注意：

- `eventId` 是业务事件 ID，应该由生产者生成，并且重试发送时保持不变。
- `messageId` 是 RabbitMQ 消息属性，可以放同一个 `eventId`。
- `deliveryTag` 不能当幂等键，它只在当前 channel 内标识本次投递。
- 消费端不要重新 `UUID.randomUUID()`，那样每次重复消费都会变成“新消息”。

## 方案一：业务唯一约束

最可靠的幂等一般落在数据库里。

比如订单创建后给用户发一张优惠券，可以让发券流水天然唯一：

```sql
create table user_coupon (
  id bigint primary key auto_increment,
  user_id bigint not null,
  order_id bigint not null,
  coupon_type varchar(64) not null,
  created_at datetime not null,
  unique key uk_order_coupon (order_id, coupon_type)
);
```

重复消费时再次插入同一个 `order_id + coupon_type` 会触发唯一键冲突。

这时业务可以判断为“已经发过”，然后直接 ack。

适合这种方案的业务：

- 发券。
- 写支付流水。
- 写库存冻结流水。
- 写积分变更流水。
- 创建订单快照。

这种方式的关键是：**把重复写入变成数据库唯一约束冲突，而不是靠代码里先查再插。**

先查再插的问题：

```text
线程 A 查询：没有
线程 B 查询：没有
线程 A 插入：成功
线程 B 插入：也可能继续插入
```

唯一约束才是最终防线。

## 方案二：消费日志表

如果业务表本身不好加唯一约束，可以单独建一张消费日志表。

```sql
create table mq_consume_log (
  id bigint primary key auto_increment,
  message_id varchar(64) not null,
  consumer_name varchar(128) not null,
  status varchar(16) not null,
  retry_count int not null default 0,
  first_consume_time datetime not null,
  last_consume_time datetime not null,
  unique key uk_message_consumer (message_id, consumer_name)
);
```

消费流程：

```text
收到消息
  -> 插入 mq_consume_log
  -> 插入成功：第一次消费，执行业务
  -> 插入失败：说明处理过或正在处理，按状态决定 ack / retry
  -> 业务成功：标记 SUCCESS
  -> 本地事务提交成功
  -> basicAck
```

推荐把“写消费日志 + 执行业务 + 标记成功”放到同一个本地事务里。

```java
@Service
@RequiredArgsConstructor
public class OrderCreatedConsumerService {

    private static final String CONSUMER_NAME = "orderCreatedCouponConsumer";

    private final MqConsumeLogMapper consumeLogMapper;
    private final CouponService couponService;

    @Transactional(rollbackFor = Exception.class)
    public ConsumeResult consume(OrderCreatedEvent event, String messageId) {
        try {
            consumeLogMapper.insertStart(MqConsumeLogDO.start(messageId, CONSUMER_NAME));
        } catch (DuplicateKeyException exception) {
            return ConsumeResult.DUPLICATE;
        }

        couponService.issueByOrder(event.userId(), event.orderId());
        consumeLogMapper.markSuccess(messageId, CONSUMER_NAME);
        return ConsumeResult.SUCCESS;
    }
}
```

监听器只负责 ack 边界：

```java
@RabbitListener(queues = RabbitMqConfig.ORDER_CREATED_QUEUE, ackMode = "MANUAL")
public void onMessage(OrderCreatedEvent event, Message message, Channel channel) throws IOException {
    long deliveryTag = message.getMessageProperties().getDeliveryTag();
    String messageId = message.getMessageProperties().getMessageId();

    if (!StringUtils.hasText(messageId)) {
        messageId = event.eventId();
    }

    try {
        orderCreatedConsumerService.consume(event, messageId);
        channel.basicAck(deliveryTag, false);
    } catch (Exception exception) {
        channel.basicNack(deliveryTag, false, false);
    }
}
```

这里的重点：

- 业务事务成功后再 `basicAck`。
- 事务失败时不要 ack，让消息进入重试或死信流程。
- 重复消息不应该报错，不应该继续重试，应该直接 ack。
- `basicNack(..., requeue = false)` 会让消息进入死信交换机；没有配置死信时会被丢弃。

## 方案三：状态机条件更新

很多业务不需要额外消费表，直接用状态机就能幂等。

比如订单超时取消：

```sql
update orders
set status = 'CLOSED',
    close_reason = 'TIMEOUT',
    closed_at = now()
where id = #{orderId}
  and status = 'WAITING_PAY';
```

第一次消费：

```text
WAITING_PAY -> CLOSED
影响行数 = 1
```

重复消费：

```text
CLOSED -> CLOSED
影响行数 = 0
```

最终状态还是 `CLOSED`，所以重复消费不会破坏业务。

同理：

```sql
update orders
set status = 'PAID',
    paid_at = now()
where id = #{orderId}
  and status = 'UNPAID';
```

状态机幂等适合：

- 订单取消。
- 支付成功。
- 退款成功。
- 发货完成。
- 售后关闭。

但要注意，状态机只能保护状态流转。

如果状态流转后还要发券、发短信、调三方接口，这些副作用也要单独幂等。

## Redis 去重能不能用

Redis 可以用，但不要把它当核心业务的唯一防线。

常见写法：

```text
SET mq:consume:{consumerName}:{messageId} 1 NX EX 604800
```

问题在于：

```text
Redis SETNX 成功
  -> 业务还没提交
  -> 应用崩溃
  -> 消息重新投递
  -> Redis 里已经有 key
  -> 消费者误以为处理过
```

所以 Redis 更适合：

- 非核心通知类消息防抖。
- 短时间内过滤明显重复投递。
- 配合数据库成功状态做缓存加速。

核心交易链路还是优先使用：

- 数据库唯一约束。
- 消费日志表。
- 状态机条件更新。

## ack 和事务的正确顺序

最重要的顺序是：

```text
收到消息
  -> 开启本地事务
  -> 幂等判断
  -> 执行业务
  -> 提交本地事务
  -> basicAck
```

不要这样做：

```text
收到消息
  -> basicAck
  -> 执行业务
```

因为 ack 之后 RabbitMQ 就认为消息处理完成。

如果后面的业务失败，消息不会再投递，只能靠人工补偿。

也不要这样做：

```text
收到消息
  -> 执行业务
  -> 业务提交成功
  -> basicAck 前应用崩溃
```

这个流程本身无法完全避免。

正确做法不是消灭它，而是让消息再次投递时被幂等逻辑兜住。

## 和生产端可靠投递的关系

MQ 幂等是消费端兜底，但生产端也要配合。

比较完整的链路是：

```text
生产端本地事务
  -> 写业务数据
  -> 写 outbox / 事件表
  -> 事务提交后发送 MQ
  -> publisher confirm 确认到达 Broker
  -> 消费端本地事务
  -> 消费幂等
  -> 业务成功后 ack
```

这条链路里每一段解决的问题不同：

| 环节 | 解决的问题 |
| --- | --- |
| outbox | 本地事务提交和 MQ 发送之间的断点 |
| publisher confirm | 生产者确认消息是否到达 Broker |
| manual ack | Broker 确认消费者是否处理完成 |
| 消费幂等 | 消息重复投递时业务不被重复执行 |
| 死信队列 | 消息一直失败时有地方兜底 |

不要指望某一个机制解决全部可靠性问题。

## 常见坑

### 用 `deliveryTag` 做幂等键

`deliveryTag` 只在当前 channel 内递增。

消费者重连、换 channel、重新投递后，它都不能代表业务消息。

### 重复消息继续 nack

重复消息说明已经处理过。

如果还 `basicNack`，就会让它继续进入重试或死信，造成噪声。

重复消息应该直接 `basicAck`。

### 幂等表没有 `consumer_name`

同一条消息可能有多个消费者。

唯一键只写 `message_id` 会导致一个消费者处理完，其他消费者都不能处理。

### 只靠代码判断状态

比如先查订单是 `WAITING_PAY`，再更新为 `CLOSED`。

并发下仍然可能有问题。

更稳的是条件更新：

```sql
update orders
set status = 'CLOSED'
where id = #{orderId}
  and status = 'WAITING_PAY';
```

### 外部接口没有幂等号

如果消费者里调用第三方支付、短信、物流接口，也要传业务幂等号。

否则 MQ 消费幂等只能保护本地数据库，保护不了外部系统。

## 排查重复消费时看什么

出现重复消费时，不要只看消费者代码。

按这个顺序查：

1. 消息里有没有稳定的 `messageId` 或 `eventId`。
2. 生产端失败重试时有没有复用同一个事件 ID。
3. 消费端是否开启 manual ack。
4. ack 是否放在本地事务提交之后。
5. 重复消息是否直接 ack。
6. 是否存在 `basicNack(..., requeue = true)` 导致无限重投。
7. 是否配置了死信队列和重试队列。
8. 幂等表唯一键是否包含 `consumer_name`。
9. 业务表是否有唯一约束或状态机条件更新。
10. 外部接口是否支持幂等号。

## 最小落地模板

核心交易消息可以按这个模板设计：

```text
事件字段：
  eventId
  eventType
  aggregateId
  occurredAt

消费表唯一键：
  message_id + consumer_name

业务防线：
  唯一约束 / 状态机条件更新

ack 策略：
  业务成功 -> basicAck
  重复消息 -> basicAck
  可恢复失败 -> 进入重试队列
  不可恢复失败 -> 进入死信队列
```

核心认知：

> MQ 重复不是异常，业务不幂等才是异常。

## 参考

- [RabbitMQ Consumer Acknowledgements and Publisher Confirms](https://www.rabbitmq.com/docs/confirms)
- [RabbitMQ Consumers](https://www.rabbitmq.com/docs/consumers)
- [Spring AMQP Listener Container Attributes](https://docs.spring.io/spring-amqp/reference/amqp/containerAttributes.html)
