---
title: RabbitMQ 死信队列
sidebarTitle: 死信队列
---

# RabbitMQ 死信队列

> 死信队列不是“失败垃圾桶”，而是消费失败、消息过期、队列溢出后的兜底通道。它的重点不是配置出来，而是后面怎么查、怎么重试、怎么补偿。

## 什么消息会变成死信

RabbitMQ 中消息变成死信，常见有三种原因：

| 原因 | 说明 |
| --- | --- |
| 消费者拒绝 | `basic.reject` / `basic.nack` 且 `requeue=false` |
| 消息过期 | 消息 TTL 到期 |
| 队列超长 | 队列达到长度限制，旧消息被挤出 |

对应业务场景：

| 场景 | 例子 |
| --- | --- |
| 消费失败 | 发券失败、调用下游失败、JSON 转换失败 |
| 延迟队列 | 订单 30 分钟未支付，延迟消息过期 |
| 限制队列长度 | 只保留最近 N 条通知 |

注意：生产者“路由不到队列”不是普通 DLQ 处理范围，它要靠 `mandatory + returns` 或 Alternate Exchange。

## 死信流程

普通消费失败：

```text
business.exchange
  -> business.queue
  -> consumer
  -> basicNack(requeue=false)
  -> business.dlx.exchange
  -> business.failed.dlq
```

延迟队列：

```text
order.exchange
  -> order.delay.queue
  -> TTL 过期
  -> order.exchange
  -> order.timeout.queue
```

这两种都用了 DLX，但语义不同：

| 类型 | DLX 用途 |
| --- | --- |
| 消费失败 | 把失败消息转移到失败队列 |
| 延迟队列 | 把过期消息转发到业务队列 |

所以不要一看到 DLX 就只理解成“失败队列”，它本质是“死信转发交换机”。

## 配置参数

原队列上配置：

```java
Map<String, Object> args = new HashMap<>();
args.put("x-dead-letter-exchange", "flashmart.order.dlx.exchange");
args.put("x-dead-letter-routing-key", "order.created.failed");
```

含义：

| 参数 | 说明 |
| --- | --- |
| `x-dead-letter-exchange` | 消息变成死信后转发到哪个 exchange |
| `x-dead-letter-routing-key` | 转发死信时使用哪个 routing key |

注意：

- 这两个参数配置在“原队列”上，不是配置在 DLQ 上。
- DLX 也只是 exchange，还要有 binding 才能进 DLQ。
- 如果不设置 `x-dead-letter-routing-key`，通常会使用原消息的 routing key。

## Spring 声明示例

常量：

```java
public final class RabbitMqNames {

    public static final String ORDER_EVENT_EXCHANGE = "flashmart.order.event.exchange";
    public static final String ORDER_DLX_EXCHANGE = "flashmart.order.dlx.exchange";

    public static final String ORDER_CREATED_QUEUE = "flashmart.order.created.queue";
    public static final String ORDER_CREATED_DLQ = "flashmart.order.created.dlq";

    public static final String ORDER_CREATED_ROUTING_KEY = "order.created";
    public static final String ORDER_CREATED_FAILED_ROUTING_KEY = "order.created.failed";

    private RabbitMqNames() {
    }
}
```

交换机：

```java
@Bean
public DirectExchange orderEventExchange() {
    return ExchangeBuilder
        .directExchange(RabbitMqNames.ORDER_EVENT_EXCHANGE)
        .durable(true)
        .build();
}

@Bean
public DirectExchange orderDlxExchange() {
    return ExchangeBuilder
        .directExchange(RabbitMqNames.ORDER_DLX_EXCHANGE)
        .durable(true)
        .build();
}
```

业务队列：

```java
@Bean
public Queue orderCreatedQueue() {
    return QueueBuilder
        .durable(RabbitMqNames.ORDER_CREATED_QUEUE)
        .deadLetterExchange(RabbitMqNames.ORDER_DLX_EXCHANGE)
        .deadLetterRoutingKey(RabbitMqNames.ORDER_CREATED_FAILED_ROUTING_KEY)
        .build();
}
```

死信队列：

```java
@Bean
public Queue orderCreatedDlq() {
    return QueueBuilder
        .durable(RabbitMqNames.ORDER_CREATED_DLQ)
        .build();
}
```

绑定：

```java
@Bean
public Binding orderCreatedBinding(Queue orderCreatedQueue,
                                   DirectExchange orderEventExchange) {
    return BindingBuilder
        .bind(orderCreatedQueue)
        .to(orderEventExchange)
        .with(RabbitMqNames.ORDER_CREATED_ROUTING_KEY);
}

@Bean
public Binding orderCreatedDlqBinding(Queue orderCreatedDlq,
                                      DirectExchange orderDlxExchange) {
    return BindingBuilder
        .bind(orderCreatedDlq)
        .to(orderDlxExchange)
        .with(RabbitMqNames.ORDER_CREATED_FAILED_ROUTING_KEY);
}
```

## 消费失败怎么进死信

手动 ack 模式下：

```java
@RabbitListener(queues = RabbitMqNames.ORDER_CREATED_QUEUE)
public void handle(OrderCreatedEvent event,
                   Message message,
                   Channel channel) throws IOException {
    long deliveryTag = message.getMessageProperties().getDeliveryTag();

    try {
        orderCreatedService.handle(event);
        channel.basicAck(deliveryTag, false);
    } catch (DuplicateMessageException exception) {
        channel.basicAck(deliveryTag, false);
    } catch (Exception exception) {
        log.error("consume order created failed, event={}", event, exception);
        channel.basicNack(deliveryTag, false, false);
    }
}
```

`basicNack` 三个参数：

| 参数 | 含义 |
| --- | --- |
| `deliveryTag` | 当前消息投递标识 |
| `multiple` | 是否批量 nack |
| `requeue` | 是否重新入队 |

重点是：

```java
channel.basicNack(deliveryTag, false, false);
```

最后一个 `false` 才会让消息不回原队列，从而进入 DLX。

如果写成：

```java
channel.basicNack(deliveryTag, false, true);
```

消息会重新回原队列，业务一直失败时会无限循环。

## DLQ 消费者要不要写

要看业务。

### 只做人工排查

可以不写 DLQ 消费者。

管理台或脚本查看 DLQ，人工判断是否重放。

适合：

- 低频失败。
- 失败需要人工分析。
- 不希望自动重试扩大问题。

### 自动补偿

可以写 DLQ 消费者，但要谨慎：

```java
@RabbitListener(queues = RabbitMqNames.ORDER_CREATED_DLQ)
public void handleDeadLetter(Message message,
                             Channel channel) throws IOException {
    long deliveryTag = message.getMessageProperties().getDeliveryTag();
    String messageId = message.getMessageProperties().getMessageId();

    try {
        log.warn("dead letter received, messageId={}, headers={}",
            messageId,
            message.getMessageProperties().getHeaders()
        );

        // 记录失败消息、通知告警、按规则重放
        channel.basicAck(deliveryTag, false);
    } catch (Exception exception) {
        log.error("handle dead letter failed, messageId={}", messageId, exception);
        channel.basicNack(deliveryTag, false, false);
    }
}
```

注意：

- DLQ 消费者不要无脑重发回原队列。
- 重放前要判断失败原因是否已修复。
- 自动补偿要限制次数。
- 最终失败要能人工介入。

## `x-death` 怎么看

死信消息会带 `x-death` header。

读取：

```java
Object xDeath = message.getMessageProperties()
    .getHeaders()
    .get("x-death");
```

它能看到：

- 死信来自哪个 queue。
- 死信原因。
- 死信次数。
- 死信时间。

常见 reason：

| reason | 说明 |
| --- | --- |
| `rejected` | 消费者拒绝，且不重新入队 |
| `expired` | TTL 过期 |
| `maxlen` | 队列长度超过限制 |

排查时：

- `rejected`：看消费者异常。
- `expired`：看 TTL / 延迟队列。
- `maxlen`：看队列容量限制。

## 死信和重试的关系

死信队列可以是最终失败队列，也可以是重试流程的一环。

### 最终失败队列

```text
business.queue
  -> 消费失败
  -> failed.dlq
```

特点：

- 失败后先停下来。
- 方便排查。
- 不会无限冲击业务队列。

### 延迟重试队列

```text
business.queue
  -> 消费失败
  -> retry.5m.queue
  -> TTL 过期
  -> business.queue
```

特点：

- 失败后延迟一段时间再重试。
- 适合下游临时不可用。
- 要控制最大重试次数。

最终建议：

```text
短暂失败 -> 延迟重试
多次失败 -> 最终 DLQ
不可恢复失败 -> 直接最终 DLQ
```

## 什么时候不要直接进 DLQ

有些失败适合重试：

- 下游接口 503。
- 网络抖动。
- 数据库短暂连接失败。
- Redis 临时不可用。

有些失败不适合重试：

- JSON 格式错误。
- 必填字段缺失。
- 业务状态不允许。
- 订单不存在且确认不是延迟可见问题。
- 代码 bug 导致必现异常。

简单判断：

```text
可恢复 -> 延迟重试
不可恢复 -> DLQ + 告警
重复消息 -> ack
```

## 业务上怎么处理 DLQ

至少要做到：

- 记录 messageId。
- 记录原 exchange、routing key、queue。
- 记录失败原因。
- 记录 `x-death`。
- 能按 messageId 查业务日志。
- 能人工重放或标记忽略。

可以设计一个失败消息表：

```sql
create table mq_dead_message (
    id bigint primary key,
    message_id varchar(64) not null,
    exchange_name varchar(128) not null,
    routing_key varchar(128) not null,
    queue_name varchar(128) not null,
    payload text not null,
    headers text null,
    reason varchar(64) null,
    status tinyint not null,
    retry_count int not null default 0,
    create_time datetime not null,
    update_time datetime not null,
    unique key uk_message_id(message_id)
);
```

状态可以是：

```text
0 未处理
1 已重放
2 已忽略
3 处理失败
```

这样 DLQ 不只是 RabbitMQ 里的一个队列，而是有业务闭环。

## 常见坑

### 配了 DLQ 但消息没进去

检查：

- 原队列是否配置 `x-dead-letter-exchange`。
- DLX 是否存在。
- DLX 是否绑定 DLQ。
- `x-dead-letter-routing-key` 是否和 binding key 匹配。
- 消费失败时是不是 `requeue=false`。

### 一直重新消费，不进死信

通常是：

```java
basicNack(deliveryTag, false, true)
```

最后一个参数是 `true`，消息会重新入队。

### DLQ 堆积没人管

DLQ 没有处理流程，只是把问题藏起来。

至少要有：

- 告警。
- 排查入口。
- 重放策略。
- 最终忽略策略。

### 所有业务共用一个 DLQ

不推荐。

不同业务失败原因不同，重放规则不同。最好按业务队列配对应 DLQ。

```text
order.created.queue -> order.created.dlq
coupon.issue.queue  -> coupon.issue.dlq
```

### 死信无限循环

如果 DLQ 又配置了 DLX 指回原队列，可能形成循环。

要明确：

- 哪个队列是重试队列。
- 哪个队列是最终失败队列。
- 最大重试次数是多少。

## 排查清单

- [ ] 原队列配置了 `x-dead-letter-exchange`。
- [ ] 原队列配置了正确的 `x-dead-letter-routing-key`。
- [ ] DLX 存在。
- [ ] DLQ 存在。
- [ ] DLX 和 DLQ 有正确 binding。
- [ ] 消费失败时使用 `requeue=false`。
- [ ] DLQ 有告警。
- [ ] DLQ 消息能看到 `messageId`。
- [ ] 能读取 `x-death` 判断死信原因。
- [ ] 有人工重放或补偿策略。
- [ ] 重试队列和最终 DLQ 分清楚。

## 参考

- [RabbitMQ Dead Letter Exchanges](https://www.rabbitmq.com/docs/dlx)
- [RabbitMQ Negative Acknowledgements](https://www.rabbitmq.com/docs/nack)
- [RabbitMQ Message TTL](https://www.rabbitmq.com/docs/ttl)
