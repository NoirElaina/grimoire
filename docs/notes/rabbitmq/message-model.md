---
title: RabbitMQ 消息模型与核心概念
sidebarTitle: 01 消息模型
---

# RabbitMQ 消息模型与核心概念

这篇只解决一个问题：

**一条消息从生产者发出以后，到底靠什么规则进入某个队列，又怎么被消费者拿走。**

先不要背 API。RabbitMQ 的核心链路可以压成这一行：

```text
basic.publish(exchange, routingKey, properties, body)
  -> Exchange
  -> Binding
  -> Queue
  -> basic.deliver
  -> Consumer
  -> ack / nack
```

## 先给结论

| 对象 | 负责什么 | 不负责什么 |
| --- | --- | --- |
| Producer | 发布消息到交换机 | 不直接决定消息最终被哪个消费者处理 |
| Exchange | 按规则路由消息 | 不长期存消息 |
| Binding | 连接交换机和队列 | 不消费消息 |
| Queue | 存消息、投递给消费者 | 不决定消息应该路由到哪里 |
| Consumer | 处理消息并确认 | 不从交换机消费 |

最容易记错的是这两句：

- 生产者通常发给 `exchange`，不是直接发给 `queue`。
- 一个队列多个消费者是竞争消费，不是广播。

## 发布消息时到底发了什么

生产者发布消息，本质上是发一个 `basic.publish`：

```text
exchange = "order.event.exchange"
routingKey = "order.paid"
properties = {
  contentType: "application/json",
  deliveryMode: 2,
  messageId: "msg_001",
  correlationId: "trace_001",
  headers: {
    source: "order-service"
  }
}
body = "{\"orderId\":1001,\"amount\":99.00}"
```

这几个字段要分清：

| 字段 | 作用 |
| --- | --- |
| `exchange` | 发到哪个交换机 |
| `routingKey` | 给交换机用的路由标签 |
| `properties` | 消息元信息，例如持久化、追踪 ID、content type |
| `body` | 真正业务内容 |

生产者最核心的职责不是“知道队列名”，而是把业务事件发布到稳定的交换机和路由键上。

## 消息流转状态

一条消息通常会经历这些状态：

```text
published
  -> routed
  -> ready in queue
  -> delivered to consumer
  -> unacked
  -> acked / nacked / rejected
```

队列里常见两个数量：

| 状态 | 含义 |
| --- | --- |
| `ready` | 还没投递给消费者的消息 |
| `unacked` | 已投递给消费者，但还没收到确认的消息 |

排查堆积时先看：

- `ready` 很高：消费者处理不过来，或者没有消费者。
- `unacked` 很高：消费者拿到了消息但没 ack，可能卡住、超时、线程池满。

## Exchange：只做路由

交换机声明时最重要的是：

```text
name = "order.event.exchange"
type = "topic"
durable = true
autoDelete = false
arguments = {}
```

| 字段 | 常用值 | 说明 |
| --- | --- | --- |
| `name` | `order.event.exchange` | 交换机名称 |
| `type` | `direct` / `topic` / `fanout` / `headers` | 路由规则 |
| `durable` | `true` | Broker 重启后是否保留交换机 |
| `autoDelete` | `false` | 没有绑定后是否自动删除 |
| `arguments` | `{}` | 扩展参数 |

交换机不负责长期保存业务消息。
如果消息没路由到任何队列，并且没有其他兜底策略，它就可能直接丢掉。

## `direct`：精确匹配

`direct` 交换机按绑定键精确匹配。

```text
Exchange: order.direct.exchange

Binding:
  order.created.queue <- order.created
  order.paid.queue    <- order.paid
```

匹配结果：

| 消息 `routingKey` | 进入队列 |
| --- | --- |
| `order.created` | `order.created.queue` |
| `order.paid` | `order.paid.queue` |
| `order.cancelled` | 不进入上面两个队列 |

适合：

- 事件类型固定
- 路由要求精确
- 不需要层级通配

例如：

```text
user.registered
order.created
order.paid
coupon.expired
```

## `topic`：按单词通配

`topic` 交换机把路由键按 `.` 分段。

通配符：

| 符号 | 含义 |
| --- | --- |
| `*` | 匹配一个单词 |
| `#` | 匹配零个或多个单词 |

例子：

```text
Exchange: order.topic.exchange

Binding:
  order.audit.queue  <- order.#
  order.pay.queue    <- order.*.paid
  order.all.queue    <- #
```

匹配结果：

| 消息 `routingKey` | `order.#` | `order.*.paid` | `#` |
| --- | --- | --- | --- |
| `order.created` | 命中 | 不命中 | 命中 |
| `order.trade.paid` | 命中 | 命中 | 命中 |
| `order.trade.pay.success` | 命中 | 不命中 | 命中 |
| `user.created` | 不命中 | 不命中 | 命中 |

实际项目里，业务事件优先考虑 `topic`。
因为它能同时支持精确消费和粗粒度订阅。

推荐路由键风格：

```text
领域.对象.动作
```

例如：

```text
order.created
order.paid
order.cancelled
refund.created
member.level.upgraded
```

不要一会儿写 `order.create`，一会儿写 `order.created`。路由键不统一，后面绑定和排查都会变脏。

## `fanout`：广播到所有绑定队列

`fanout` 不看 `routingKey`。

```text
Exchange: system.broadcast.exchange(fanout)

Binding:
  cache.refresh.queue
  search.reindex.queue
  config.reload.queue
```

只要消息发到这个交换机，所有绑定队列都会收到一份。

适合：

- 配置刷新
- 缓存失效广播
- 多个下游都无差别接收同一事件

不适合：

- 复杂业务分类
- 只想让部分下游接收
- 后续路由规则会变复杂的场景

## `headers`：按消息头匹配

`headers` 交换机按 `properties.headers` 匹配，不看 `routingKey`。

例如按：

```text
headers.region = "cn"
headers.source = "order-service"
```

来决定是否进入队列。

它比较灵活，但业务系统里不常作为默认选择。
除非你明确需要按 header 组合路由，否则优先用 `direct` 或 `topic`。

## Queue：真正存消息的地方

队列声明时常见参数：

```text
name = "stock.order.paid.queue"
durable = true
exclusive = false
autoDelete = false
arguments = {
  "x-dead-letter-exchange": "order.dlx.exchange",
  "x-dead-letter-routing-key": "order.paid.dead",
  "x-message-ttl": 60000
}
```

| 参数 | 说明 |
| --- | --- |
| `durable` | Broker 重启后队列是否还在 |
| `exclusive` | 是否只允许当前连接使用，连接关闭后删除 |
| `autoDelete` | 最后一个消费者取消订阅后是否删除 |
| `x-message-ttl` | 队列内消息存活时间 |
| `x-dead-letter-exchange` | 死信转发到哪个交换机 |
| `x-dead-letter-routing-key` | 死信转发时使用的路由键 |
| `x-max-length` | 队列最大消息数 |

业务队列通常用：

```text
durable = true
exclusive = false
autoDelete = false
```

临时回调队列或测试队列才更常用 `exclusive` / `autoDelete`。

## Binding：路由规则落地的位置

绑定表达的是：

```text
某个 exchange 的某类消息 -> 进入某个 queue
```

例子：

```text
Exchange: order.event.exchange(topic)
Queue: stock.order.paid.queue
BindingKey: order.paid
```

含义：

```text
发到 order.event.exchange
并且 routingKey 匹配 order.paid
就进入 stock.order.paid.queue
```

一个队列可以绑定多个规则：

```text
stock.order.queue <- order.created
stock.order.queue <- order.paid
stock.order.queue <- order.cancelled
```

一个交换机也可以绑定多个队列：

```text
order.event.exchange
  -> stock.order.paid.queue    <- order.paid
  -> coupon.order.paid.queue   <- order.paid
  -> audit.order.event.queue   <- order.#
```

## 默认交换机

RabbitMQ 有一个特殊的默认交换机，名字是空字符串 `""`。

它的规则是：

```text
routingKey = queueName
```

例如：

```text
exchange = ""
routingKey = "hello.queue"
```

消息会进入名为 `hello.queue` 的队列。

这适合 demo 或简单测试，但业务系统里不建议长期依赖默认交换机。
原因是它会让生产者重新耦合到队列名。

## 没路由到队列会怎样

如果消息发到交换机后，没有任何绑定匹配：

```text
Producer -> Exchange -> no matched queue
```

默认情况下，这条消息可能直接被丢弃。

如果不希望静默丢失，常用两种方式：

### 1. `mandatory`

生产者发送时打开 `mandatory`。
如果消息不可路由，Broker 会把消息退回给生产者。

适合：

- 生产者需要立刻知道“没有队列接这类消息”
- 需要打日志或告警

### 2. Alternate Exchange

给交换机配置备用交换机：

```text
order.event.exchange
  arguments:
    alternate-exchange = order.unrouted.exchange
```

不可路由消息会转发到备用交换机，再进入兜底队列。

适合：

- 统一收集无法路由的消息
- 后续人工排查或补偿

## 一个业务建模例子

订单支付成功后，需要：

1. 扣库存
2. 发优惠券
3. 记审计日志

不要写成一个消费者串行做完所有事。更稳的是每个职责一个队列：

```text
Producer
  publish exchange = order.event.exchange
  routingKey = order.paid
  body = { orderId, paidAt, amount }

order.event.exchange(topic)
  ├─ stock.order.paid.queue   binding: order.paid
  ├─ coupon.order.paid.queue  binding: order.paid
  └─ audit.order.event.queue  binding: order.#
```

这样：

- 库存失败不会阻塞优惠券队列。
- 审计可以订阅所有订单事件。
- 新增积分服务时，只要加一个队列和绑定，不用改生产者。

## 一个队列多个消费者

```text
stock.order.paid.queue
  ├─ stock-consumer-1
  ├─ stock-consumer-2
  └─ stock-consumer-3
```

这是竞争消费。

一条消息只会投递给其中一个消费者。
它解决的是吞吐问题，不是广播问题。

适合：

- 同一类任务横向扩容
- 消费逻辑完全一致
- 不要求每个消费者都收到同一条消息

如果想让多个业务方都收到同一条消息，要建多个队列，而不是给一个队列挂多个消费者。

## 多个队列订阅同一事件

```text
order.event.exchange(topic)
  ├─ stock.order.paid.queue   <- order.paid
  ├─ coupon.order.paid.queue  <- order.paid
  └─ audit.order.paid.queue   <- order.paid
```

这是业务解耦。

同一条消息会复制到多个队列。
每个队列都有自己的堆积、重试、死信和消费进度。

对比一下：

| 模式 | 一条消息被处理几次 | 解决什么问题 |
| --- | --- | --- |
| 一个队列多个消费者 | 1 次 | 提升同一任务吞吐 |
| 多个队列绑定同一事件 | 多次 | 多个业务方独立处理 |

## 消费确认和重投递

消费者收到消息后，消息进入 `unacked`。

常见处理结果：

| 动作 | 含义 |
| --- | --- |
| `ack` | 处理成功，Broker 删除消息 |
| `nack(requeue=true)` | 处理失败，重新入队 |
| `nack(requeue=false)` | 处理失败，不重新入队，可能进入死信 |
| `reject` | 拒绝单条消息，语义类似 nack |

不要在业务处理前就 ack。
否则业务失败时，Broker 已经认为消息处理完了。

也不要无脑 `requeue=true`。
如果消息本身有毒，会形成无限重投。

## Prefetch：控制消费者一次拿多少

消费者可以设置 `prefetch`，限制未确认消息数量：

```text
prefetch = 10
```

含义：

```text
同一个 consumer 最多同时持有 10 条 unacked 消息
```

它影响：

- 消费端内存
- 单消费者压力
- 消息分配公平性
- 堆积恢复速度

一般经验：

- 单条处理慢：`prefetch` 小一点。
- 单条处理快：可以适当加大。
- 处理逻辑会调用下游接口：不要太大，避免把下游打爆。

## Spring AMQP 声明示例

后面单独写 Spring Boot 集成时会展开，这里先看模型怎么落到代码：

```java
@Configuration
public class RabbitOrderConfig {

    public static final String ORDER_EXCHANGE = "order.event.exchange";
    public static final String STOCK_QUEUE = "stock.order.paid.queue";
    public static final String COUPON_QUEUE = "coupon.order.paid.queue";
    public static final String AUDIT_QUEUE = "audit.order.event.queue";

    @Bean
    public TopicExchange orderExchange() {
        return ExchangeBuilder
                .topicExchange(ORDER_EXCHANGE)
                .durable(true)
                .build();
    }

    @Bean
    public Queue stockQueue() {
        return QueueBuilder
                .durable(STOCK_QUEUE)
                .deadLetterExchange("order.dlx.exchange")
                .deadLetterRoutingKey("order.paid.dead")
                .build();
    }

    @Bean
    public Queue couponQueue() {
        return QueueBuilder.durable(COUPON_QUEUE).build();
    }

    @Bean
    public Queue auditQueue() {
        return QueueBuilder.durable(AUDIT_QUEUE).build();
    }

    @Bean
    public Binding stockBinding() {
        return BindingBuilder
                .bind(stockQueue())
                .to(orderExchange())
                .with("order.paid");
    }

    @Bean
    public Binding couponBinding() {
        return BindingBuilder
                .bind(couponQueue())
                .to(orderExchange())
                .with("order.paid");
    }

    @Bean
    public Binding auditBinding() {
        return BindingBuilder
                .bind(auditQueue())
                .to(orderExchange())
                .with("order.#");
    }
}
```

这段代码对应的不是“创建几个 Bean”而是这张拓扑：

```text
order.event.exchange(topic)
  ├─ stock.order.paid.queue   <- order.paid
  ├─ coupon.order.paid.queue  <- order.paid
  └─ audit.order.event.queue  <- order.#
```

## 生产者发送示例

```java
rabbitTemplate.convertAndSend(
        "order.event.exchange",
        "order.paid",
        new OrderPaidMessage(orderId, amount, paidAt),
        message -> {
            message.getMessageProperties().setMessageId(UUID.randomUUID().toString());
            message.getMessageProperties().setContentType(MessageProperties.CONTENT_TYPE_JSON);
            message.getMessageProperties().setDeliveryMode(MessageDeliveryMode.PERSISTENT);
            return message;
        }
);
```

这里最重要的是：

- exchange 固定为业务事件交换机
- routing key 表达业务事件
- body 是业务载荷
- properties 放追踪、序列化、持久化等元信息

不要在发送方写死下游队列名。

## 消费者监听示例

```java
@RabbitListener(
        queues = RabbitOrderConfig.STOCK_QUEUE,
        ackMode = "MANUAL"
)
public void handleStock(
        OrderPaidMessage message,
        Channel channel,
        @Header(AmqpHeaders.DELIVERY_TAG) long deliveryTag
) throws IOException {
    try {
        stockService.lockStock(message.orderId());
        channel.basicAck(deliveryTag, false);
    } catch (RecoverableException exception) {
        channel.basicNack(deliveryTag, false, true);
    } catch (Exception exception) {
        channel.basicNack(deliveryTag, false, false);
    }
}
```

这段代码背后的模型是：

- 消费者从 `stock.order.paid.queue` 拿消息。
- 成功后 `ack`。
- 可恢复错误可以重新入队。
- 不可恢复错误不重新入队，交给死信或告警。

## 命名建议

交换机：

```text
{domain}.event.exchange
```

队列：

```text
{consumer}.{domain}.{event}.queue
```

路由键：

```text
{domain}.{event}
```

例子：

```text
order.event.exchange
stock.order.paid.queue
coupon.order.paid.queue
audit.order.event.queue
order.paid
order.created
refund.created
```

命名要服务排查。看到队列名时，最好能知道：

- 谁消费
- 消费哪个领域
- 消费哪类事件

## 常见误区

### 1. 以为消息发给队列

业务系统里更推荐：

```text
Producer -> Exchange -> Queue
```

不要让生产者依赖下游队列名。

### 2. 以为一个队列多个消费者是广播

不是广播，是竞争消费。
广播要多个队列分别绑定同一个事件。

### 3. 交换机、队列、绑定没有版本意识

如果随便改 exchange、routing key、binding key，旧生产者和旧消费者可能直接断链。

修改路由拓扑时要考虑：

- 旧消息还在不在队列里
- 新旧消费者是否同时存在
- 是否需要临时双写 routing key

### 4. 所有业务都共用一个队列

这样会导致：

- 某个慢消费拖累全部业务
- 重试和死信策略没法分开
- 排查时不知道是哪类消息堆积

队列应该按消费职责拆。

### 5. 所有消息都无脑重新入队

如果是参数错误、状态非法、下游永远不会接受的消息，重新入队只会制造死循环。

## 建模检查清单

设计一条 RabbitMQ 链路时，至少回答这些问题：

- 这个消息代表什么业务事件？
- exchange 名是什么？
- exchange 类型是什么？
- routing key 命名是什么？
- 哪些队列会接这条消息？
- 每个队列由哪个服务消费？
- 每个队列的死信策略是什么？
- 消费失败时是重试、死信，还是直接告警？
- 需要保证幂等吗？
- 消费者 prefetch 设多少？
- 不可路由消息要不要兜底？

如果这些问题答不出来，先别急着写 `@RabbitListener`。

## 最后记一句话

RabbitMQ 的消息模型不是“发消息然后消费”这么简单，而是：

**用 exchange、routing key、binding 和 queue，把一条业务事件分发给正确的消费职责，并让每个职责拥有独立的消费进度、失败处理和扩容能力。**
