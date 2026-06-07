---
title: RabbitMQ 延迟队列
sidebarTitle: 延迟队列
---

# RabbitMQ 延迟队列

> RabbitMQ 原生没有“普通延迟队列”这个队列类型，常见做法是用 `TTL + DLX`：消息先进入延迟队列，过期后变成死信，再转发到真正的业务队列。

## 先给结论

这段配置的意思：

```java
args.put("x-message-ttl", 30 * 1000);
args.put("x-dead-letter-exchange", ORDER_EXCHANGE);
args.put("x-dead-letter-routing-key", ORDER_TIMEOUT_ROUTING_KEY);
```

翻译成人话：

```text
消息进入这个队列后，最多待 30 秒。
30 秒后如果还没有被消费，就过期。
过期消息会被当成死信。
死信转发到 ORDER_EXCHANGE。
转发时使用 ORDER_TIMEOUT_ROUTING_KEY。
最后路由到“订单超时处理队列”。
```

所以 `x-message-ttl` 是：

```text
队列级消息 TTL，单位是毫秒，表示消息在这个队列里最多存活多久。
```

`30 * 1000` 就是 30 秒。

## 延迟队列的流程

以“订单 30 分钟未支付自动取消”为例：

```text
用户创建订单
  -> 发送 order.timeout.delay 消息
  -> 消息进入 delay queue
  -> 在 delay queue 等 30 分钟
  -> 消息过期
  -> 变成死信
  -> 转发到 order exchange
  -> routing key = order.timeout
  -> 进入 order timeout queue
  -> 消费者检查订单是否仍未支付
  -> 未支付则取消订单
```

重点：

- 延迟队列本身通常不挂消费者。
- 真正处理业务的是过期后转发到的业务队列。
- 消费者收到消息后还要查数据库确认状态，不能直接取消。

## 为什么 TTL + DLX 能实现延迟

RabbitMQ 里消息过期后，如果队列配置了死信交换机，过期消息会被转发到 DLX。

也就是：

```text
delay.queue
  x-message-ttl = 30000
  x-dead-letter-exchange = order.exchange
  x-dead-letter-routing-key = order.timeout

order.exchange + order.timeout
  -> order.timeout.queue
```

延迟效果来自：

```text
消息在 delay.queue 里等到 TTL 过期
```

业务触发来自：

```text
过期后死信转发到真正的业务队列
```

## 三个参数分别是什么

### `x-message-ttl`

```java
args.put("x-message-ttl", 30 * 1000);
```

含义：

- 队列级消息过期时间。
- 单位是毫秒。
- 这里是 30 秒。
- 消息在这个队列里停留超过 TTL 后，会过期。

注意：这是队列参数，不是 Java 里的定时器。

如果这个队列有消费者，消息可能还没过期就被消费了；所以延迟队列一般不绑定消费者。

### `x-dead-letter-exchange`

```java
args.put("x-dead-letter-exchange", ORDER_EXCHANGE);
```

含义：

- 这个队列里的消息变成死信后，转发到哪个 exchange。
- 这里转发到 `ORDER_EXCHANGE`。

消息变成死信的常见原因：

- TTL 过期。
- 消费者 `nack` / `reject` 且 `requeue=false`。
- 队列超过最大长度。

延迟队列主要利用的是第一种：TTL 过期。

### `x-dead-letter-routing-key`

```java
args.put("x-dead-letter-routing-key", ORDER_TIMEOUT_ROUTING_KEY);
```

含义：

- 死信转发时使用哪个 routing key。
- 这里用 `ORDER_TIMEOUT_ROUTING_KEY`。

如果 `ORDER_EXCHANGE` 是 direct exchange，那么必须有一个队列绑定这个 routing key：

```text
ORDER_EXCHANGE
  + ORDER_TIMEOUT_ROUTING_KEY
  -> ORDER_TIMEOUT_QUEUE
```

否则消息过期后还是可能路由不到业务队列。

## 代码示例：声明延迟队列

常量：

```java
public final class RabbitMqConfig {

    public static final String ORDER_EXCHANGE = "flashmart.order.exchange";

    public static final String ORDER_DELAY_QUEUE = "flashmart.order.delay.queue";
    public static final String ORDER_TIMEOUT_QUEUE = "flashmart.order.timeout.queue";

    public static final String ORDER_DELAY_ROUTING_KEY = "order.delay";
    public static final String ORDER_TIMEOUT_ROUTING_KEY = "order.timeout";

    private RabbitMqConfig() {
    }
}
```

声明 exchange：

```java
@Bean
public DirectExchange orderExchange() {
    return ExchangeBuilder
        .directExchange(RabbitMqConfig.ORDER_EXCHANGE)
        .durable(true)
        .build();
}
```

声明延迟队列：

```java
@Bean
public Queue orderDelayQueue() {
    Map<String, Object> args = new HashMap<>();
    args.put("x-message-ttl", 30 * 1000);
    args.put("x-dead-letter-exchange", RabbitMqConfig.ORDER_EXCHANGE);
    args.put("x-dead-letter-routing-key", RabbitMqConfig.ORDER_TIMEOUT_ROUTING_KEY);

    return QueueBuilder
        .durable(RabbitMqConfig.ORDER_DELAY_QUEUE)
        .withArguments(args)
        .build();
}
```

声明真正处理超时的队列：

```java
@Bean
public Queue orderTimeoutQueue() {
    return QueueBuilder
        .durable(RabbitMqConfig.ORDER_TIMEOUT_QUEUE)
        .build();
}
```

绑定延迟队列：

```java
@Bean
public Binding orderDelayBinding(Queue orderDelayQueue,
                                 DirectExchange orderExchange) {
    return BindingBuilder
        .bind(orderDelayQueue)
        .to(orderExchange)
        .with(RabbitMqConfig.ORDER_DELAY_ROUTING_KEY);
}
```

绑定超时处理队列：

```java
@Bean
public Binding orderTimeoutBinding(Queue orderTimeoutQueue,
                                   DirectExchange orderExchange) {
    return BindingBuilder
        .bind(orderTimeoutQueue)
        .to(orderExchange)
        .with(RabbitMqConfig.ORDER_TIMEOUT_ROUTING_KEY);
}
```

## 发送延迟消息

订单创建后发送到延迟队列对应的 routing key：

```java
OrderTimeoutMessage message = new OrderTimeoutMessage(
    UUID.randomUUID().toString(),
    order.getId(),
    order.getOrderNo(),
    LocalDateTime.now()
);

rabbitTemplate.convertAndSend(
    RabbitMqConfig.ORDER_EXCHANGE,
    RabbitMqConfig.ORDER_DELAY_ROUTING_KEY,
    message
);
```

这条消息不会马上进入 `ORDER_TIMEOUT_QUEUE`。

它会先进入：

```text
ORDER_DELAY_QUEUE
```

等 30 秒过期后，再被转发到：

```text
ORDER_TIMEOUT_QUEUE
```

## 消费超时消息

消费者监听真正的超时队列：

```java
@RabbitListener(queues = RabbitMqConfig.ORDER_TIMEOUT_QUEUE)
public void handleOrderTimeout(OrderTimeoutMessage message,
                               Message rawMessage,
                               Channel channel) throws IOException {
    long deliveryTag = rawMessage.getMessageProperties().getDeliveryTag();

    try {
        orderTimeoutService.handle(message.orderId());
        channel.basicAck(deliveryTag, false);
    } catch (Exception exception) {
        log.error("handle order timeout failed, orderId={}", message.orderId(), exception);
        channel.basicNack(deliveryTag, false, false);
    }
}
```

业务处理一定要二次确认状态：

```java
@Transactional(rollbackFor = Exception.class)
public void handle(Long orderId) {
    Order order = orderRepository.getById(orderId);
    if (order == null) {
        return;
    }

    if (!order.isWaitingPayment()) {
        return;
    }

    orderRepository.cancelTimeoutOrder(orderId);
}
```

为什么要查状态：

- 用户可能已经支付。
- 订单可能已经取消。
- 消息可能重复投递。
- 延迟消息只是提醒，不是最终事实。

最终事实仍然是数据库里的订单状态。

## 延迟队列不要挂消费者

延迟队列：

```text
flashmart.order.delay.queue
```

一般不监听。

如果你监听了延迟队列：

```java
@RabbitListener(queues = RabbitMqConfig.ORDER_DELAY_QUEUE)
```

消息可能刚进去就被消费掉，根本等不到 TTL 过期，也就不会转发到超时队列。

正确监听的是：

```java
@RabbitListener(queues = RabbitMqConfig.ORDER_TIMEOUT_QUEUE)
```

## 队列 TTL 和消息 TTL 的区别

队列级 TTL：

```java
args.put("x-message-ttl", 30 * 1000);
```

意思是这个队列里的所有消息都是 30 秒后过期。

消息级 TTL：

```java
rabbitTemplate.convertAndSend(exchange, routingKey, message, msg -> {
    msg.getMessageProperties().setExpiration("30000");
    return msg;
});
```

意思是只给当前这条消息设置 30 秒过期。

对比：

| 类型 | 配置位置 | 适合场景 |
| --- | --- | --- |
| 队列级 TTL | queue argument：`x-message-ttl` | 所有消息延迟时间一样 |
| 消息级 TTL | message property：`expiration` | 每条消息延迟时间不同 |

如果订单都是 30 分钟超时，队列级 TTL 就够了。

如果不同订单超时时间不一样，消息级 TTL 或延迟插件更合适。

## `x-message-ttl` 和 `x-expires` 别混

`x-message-ttl` 控制的是消息多久过期：

```java
args.put("x-message-ttl", 30 * 1000);
```

意思是：

```text
这个队列里的消息最多存活 30 秒。
```

`x-expires` 控制的是队列多久不用就删除：

```java
args.put("x-expires", 10 * 60 * 1000);
```

意思是：

```text
这个队列如果 10 分钟没有被使用，就自动删除。
```

对比：

| 参数 | 控制谁 | 常见用途 |
| --- | --- | --- |
| `x-message-ttl` | 消息 | 延迟队列、消息过期 |
| `x-expires` | 队列 | 临时队列自动删除 |

订单超时延迟队列用的是 `x-message-ttl`，不是 `x-expires`。

## 死信里的 `x-death`

消息进入死信后，RabbitMQ 会给消息加一些死信相关 header，其中常见的是 `x-death`。

它可以帮助判断：

- 消息死信过几次。
- 从哪个队列死信过来。
- 死信原因是什么。
- 最近一次死信时间。

消费者里可以读取：

```java
@RabbitListener(queues = RabbitMqConfig.ORDER_TIMEOUT_QUEUE)
public void handle(Message message) {
    Object xDeath = message.getMessageProperties()
        .getHeaders()
        .get("x-death");

    log.info("x-death={}", xDeath);
}
```

常见 reason：

| reason | 含义 |
| --- | --- |
| `expired` | TTL 过期 |
| `rejected` | 消费者 reject / nack 且不重新入队 |
| `maxlen` | 队列长度超过限制 |

做延迟队列时，正常原因通常是：

```text
expired
```

如果你看到 `rejected`，说明不是自然延迟到期，而是被消费者拒绝后进来的。

## 延迟队列和重试队列

延迟队列不只可以做订单超时，也可以做失败重试。

消费失败后不要立刻重新入队，而是进入一个“重试延迟队列”：

```text
业务队列消费失败
  -> nack(false)
  -> 进入失败 DLX
  -> 路由到 retry.5m.queue
  -> 等 5 分钟 TTL
  -> 过期后转回原业务 exchange
  -> 再次进入业务队列消费
```

示例：

```text
order.created.queue
  消费失败
  -> order.retry.5m.queue
  5 分钟后
  -> order.created.queue
```

这种方式比 `requeue=true` 稳：

- 不会立刻打爆消费者。
- 可以拉开重试时间。
- 可以设计最大重试次数。
- 可以把最终失败消息送进 DLQ。

注意：重试次数通常要结合 `x-death` 或业务重试表判断。

## 多级延迟重试

常见重试梯度：

```text
第一次失败 -> 1 分钟后重试
第二次失败 -> 5 分钟后重试
第三次失败 -> 30 分钟后重试
再失败 -> 进入人工 DLQ
```

可以建多个 retry queue：

```text
order.retry.1m.queue   x-message-ttl = 60000
order.retry.5m.queue   x-message-ttl = 300000
order.retry.30m.queue  x-message-ttl = 1800000
order.failed.dlq
```

流程：

```text
business queue
  -> retry 1m
  -> business queue
  -> retry 5m
  -> business queue
  -> retry 30m
  -> business queue
  -> failed dlq
```

这部分比订单超时复杂，适合单独抽成“消费失败与重试”笔记。

## TTL + DLX 的局限

### 延迟不一定精确到毫秒

RabbitMQ 不是定时器系统。TTL 到期后，消息会在 Broker 处理过期和死信时转发，不适合追求毫秒级精度。

### 不同延迟时间容易乱

如果用一个队列放不同 TTL 的消息，可能出现前面的长 TTL 消息挡住后面的短 TTL 消息的问题。

所以：

- 固定延迟：用一个 delay queue。
- 多个固定延迟：建多个 delay queue，例如 `5m`、`30m`、`2h`。
- 大量不同延迟：考虑延迟插件、定时任务、数据库扫描。

### 队列参数变更麻烦

RabbitMQ 已存在队列的参数不能随便改。

如果你把：

```java
x-message-ttl = 30000
```

改成：

```java
x-message-ttl = 60000
```

启动时可能因为队列参数不一致报错。开发环境可以删队列重建；生产要走变更方案。

## 和延迟插件的区别

TTL + DLX：

- 不需要额外插件。
- 适合固定延迟。
- 逻辑直观。
- 多延迟时间需要多个队列。

Delayed Message Exchange 插件：

- 可以通过 header 指定延迟时间。
- 更适合每条消息延迟不同。
- 需要安装插件。
- 生产使用前要确认版本、运维和兼容性。

普通订单超时这种固定延迟，先用 TTL + DLX 就可以。

插件模式大概这样发：

```java
rabbitTemplate.convertAndSend(
    "order.delayed.exchange",
    "order.timeout",
    message,
    msg -> {
        msg.getMessageProperties().setHeader("x-delay", 30 * 1000);
        return msg;
    }
);
```

注意：

- `x-delay` 是延迟插件的 header。
- `x-message-ttl` 是 RabbitMQ 原生队列参数。
- 两个不是一回事。

## 和定时任务怎么选

| 方案 | 适合场景 |
| --- | --- |
| TTL + DLX | 固定延迟、量不太复杂、RabbitMQ 已经在项目里 |
| 延迟插件 | 每条消息延迟不同，想直接按消息设置延迟 |
| 数据库定时扫描 | 需要强可控、可查询、可补偿，延迟精度要求不高 |
| 调度系统 | 大量定时任务、复杂调度、可视化运维 |

订单 30 分钟未支付取消：

- 中小项目：TTL + DLX 可以。
- 高可靠订单系统：数据库状态 + 定时扫描 / MQ 只是提醒。
- 延迟时间非常多变：延迟插件或调度系统更自然。

不要把 RabbitMQ 延迟队列当成精确定时调度平台。

## 常见坑

### 以为 `x-message-ttl` 是延迟执行时间

更准确是：

```text
消息在这个队列里的存活时间。
```

只是因为过期后会进入 DLX，所以看起来像“延迟执行”。

### 延迟队列被消费者消费了

延迟队列不要挂消费者。消费者应该监听过期后路由到的业务队列。

### routing key 写错

过期后消息会转发到：

```text
x-dead-letter-exchange + x-dead-letter-routing-key
```

如果没有对应 binding，消息还是进不了业务队列。

### 订单超时直接取消

收到超时消息后必须查库：

```text
订单仍是待支付 -> 取消
订单已支付 -> 忽略
订单已取消 -> 忽略
```

### 延迟消息没有幂等

超时消息可能重复投递。取消订单要用状态条件更新：

```sql
update orders
set status = 'CANCELED'
where id = ?
  and status = 'WAITING_PAYMENT';
```

受影响行数为 1 才说明取消成功。

## 检查清单

- [ ] 延迟队列配置了 `x-message-ttl`。
- [ ] `x-message-ttl` 单位按毫秒计算。
- [ ] 延迟队列配置了 `x-dead-letter-exchange`。
- [ ] 延迟队列配置了 `x-dead-letter-routing-key`。
- [ ] 死信 exchange + routing key 能路由到业务队列。
- [ ] 延迟队列没有消费者。
- [ ] 消费者监听的是业务超时队列。
- [ ] 消费时会重新查订单状态。
- [ ] 取消订单用条件更新兜并发。
- [ ] 失败消息有 DLQ 或日志。

## 最后记一句话

`x-message-ttl` 不是“定时任务”，它只是消息在队列里的过期时间；配上 `x-dead-letter-exchange` 和 `x-dead-letter-routing-key`，过期消息才会被转发成你想要的“延迟执行”。

## 参考

- [RabbitMQ Message TTL](https://www.rabbitmq.com/docs/ttl)
- [RabbitMQ Dead Letter Exchanges](https://www.rabbitmq.com/docs/dlx)
- [RabbitMQ Delayed Message Exchange Plugin](https://github.com/rabbitmq/rabbitmq-delayed-message-exchange)
