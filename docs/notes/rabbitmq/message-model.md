---
title: RabbitMQ 消息模型与核心概念
sidebarTitle: 01 消息模型
---

# RabbitMQ 消息模型与核心概念

> 这一篇只讲消息在 RabbitMQ 里怎么走，不讲 Spring 代码。Spring 落地放到下一篇。

## 先给结论

RabbitMQ 的核心流程：

```text
Producer
  -> Exchange
  -> Binding + Routing Key
  -> Queue
  -> Consumer
  -> ack / nack
```

几个关键点：

- 生产者通常不是直接发给队列，而是发给交换机。
- 交换机不存消息，只负责路由。
- 队列才是真正存消息的地方。
- 绑定关系决定消息能进哪些队列。
- 消费者处理成功后要确认，Broker 才会删除消息。
- 消费失败时要决定：重新入队、进入死信，还是直接丢弃。

先把这条线想明白，再写代码。

## 组件关系

| 名称 | 作用 |
| --- | --- |
| Producer | 发送消息的应用 |
| Exchange | 接收消息并按规则路由 |
| Binding | 把 exchange 和 queue 连接起来的规则 |
| Routing Key | 生产者发送消息时携带的路由键 |
| Queue | 存放消息，等待消费者处理 |
| Consumer | 从队列取消息并处理 |
| Ack | 消费者确认消息处理完成 |
| Nack / Reject | 消费者拒绝消息 |
| DLX | Dead Letter Exchange，死信交换机 |
| DLQ | Dead Letter Queue，死信队列 |

一个最小模型：

```text
exchange: order.event.exchange
routing key: order.created
queue: coupon.issue.queue
binding: order.event.exchange + order.created -> coupon.issue.queue
```

意思是：订单创建事件进入订单事件交换机，然后按 `order.created` 路由到发券队列。

## 消息到底发到哪里

很多初学者会说：

```text
发消息到队列
```

更准确是：

```text
发消息到 exchange，再由 exchange 路由到 queue
```

生产者发送时通常带三样东西：

```text
exchange
routing key
message body
```

例如：

```text
exchange = order.event.exchange
routingKey = order.created
body = {"orderId":10001,"userId":20001}
```

RabbitMQ 会做：

```text
1. 找到 order.event.exchange
2. 根据 exchange 类型和 routing key 找绑定关系
3. 把消息投递到匹配的 queue
4. 等 consumer 消费
```

如果没有任何队列匹配，这条消息可能直接丢失；生产者需要用 `mandatory` / return 或 Alternate Exchange 兜住。

## Exchange 类型

### Direct Exchange

精确匹配 routing key。

```text
binding key = order.created
routing key = order.created -> 匹配
routing key = order.paid    -> 不匹配
```

适合：

- 事件类型明确。
- 一个 routing key 对应一个或多个队列。
- 后端业务最常见的简单路由。

例子：

```text
order.created -> coupon.issue.queue
order.paid    -> delivery.create.queue
order.closed  -> audit.log.queue
```

### Topic Exchange

按单词通配，routing key 用 `.` 分段。

通配符：

| 符号 | 含义 |
| --- | --- |
| `*` | 匹配一个单词 |
| `#` | 匹配零个或多个单词 |

例子：

```text
binding key = order.*       -> order.created、order.paid
binding key = order.#       -> order.created、order.pay.timeout
binding key = *.created     -> order.created、user.created
```

适合：

- 事件种类多。
- 想让某些消费者订阅一组事件。
- 日志、通知、审计这类宽泛订阅。

注意：topic 很灵活，也容易乱。routing key 规范一定要提前定。

### Fanout Exchange

广播，不看 routing key。

```text
message -> exchange -> 所有绑定队列
```

适合：

- 配置刷新。
- 广播通知。
- 多个系统都要收到同一条事件。

注意：fanout 是“每个绑定队列一份”，不是“每个消费者一份”。如果一个队列下面挂多个消费者，仍然是竞争消费。

### Headers Exchange

按消息 header 匹配。

实际业务里用得少，因为：

- 配置比 routing key 麻烦。
- 排查不如 direct/topic 直观。
- 多数业务用 topic 已经够了。

普通后端项目优先掌握 direct、topic、fanout。

## Queue 是存消息的地方

队列负责保存消息，直到消息被消费者确认。

常见队列参数：

| 参数 | 作用 |
| --- | --- |
| durable | 队列是否持久化 |
| exclusive | 是否只允许当前连接使用 |
| auto-delete | 没有消费者后是否自动删除 |
| x-message-ttl | 消息在队列里的存活时间 |
| x-dead-letter-exchange | 死信转发到哪个 exchange |
| x-dead-letter-routing-key | 死信转发使用哪个 routing key |
| x-max-length | 队列最大消息数 |

业务队列通常：

```text
durable = true
exclusive = false
auto-delete = false
```

临时队列才会考虑 exclusive 或 auto-delete。

## Binding 是路由规则

Binding 连接 exchange 和 queue。

Direct 示例：

```text
exchange: order.event.exchange
queue: coupon.issue.queue
binding key: order.created
```

Topic 示例：

```text
exchange: order.topic.exchange
queue: audit.log.queue
binding key: order.#
```

同一个 exchange 可以绑定多个 queue。

同一个 queue 也可以绑定多个 routing key。

这意味着一条消息可以被复制到多个队列：

```text
order.created
  -> coupon.issue.queue
  -> audit.log.queue
  -> push.notify.queue
```

这是 RabbitMQ 做事件分发时最有价值的地方。

## 默认交换机

RabbitMQ 有一个默认 direct exchange，名字是空字符串：

```text
exchange = ""
routing key = queue name
```

如果 routing key 正好等于队列名，消息会进入这个队列。

这就是为什么有些示例看起来像“直接发给队列”：

```text
exchange = ""
routingKey = "hello.queue"
```

但工程里更建议显式声明 exchange、queue、binding，方便治理和排查。

## 消息状态

一条消息大概经历这些状态：

```text
published
  -> routed
  -> ready
  -> delivered
  -> unacked
  -> acked / nacked / dead-lettered
```

管理台里最常看的几个数：

| 指标 | 含义 |
| --- | --- |
| Ready | 队列里等待消费的消息 |
| Unacked | 已投递给消费者，但还没 ack |
| Total | Ready + Unacked |
| Consumers | 当前消费者数量 |

排查时：

- `Ready` 很高：消费者处理不过来，或者消费者不在线。
- `Unacked` 很高：消费者拿到消息但没确认，可能卡住、超时、线程池满。
- `Consumers = 0`：没有消费者连上。

## 消费确认

消费者拿到消息后，Broker 不会立刻删除消息。

如果使用手动确认：

| 动作 | 结果 |
| --- | --- |
| `ack` | 消费成功，Broker 删除消息 |
| `nack(requeue=true)` | 消费失败，消息重新回队列 |
| `nack(requeue=false)` | 消费失败，不重新入队，可能进死信 |
| `reject(requeue=false)` | 拒绝单条消息，可能进死信 |

工程上最常见策略：

```text
业务成功 -> ack
重复消息 -> ack
可恢复失败 -> 进入重试流程
不可恢复失败 -> nack(false) 进死信
```

不要无脑 `requeue=true`。如果业务代码一直报错，消息会一直循环消费，队列和日志都会被打爆。

## Prefetch

`prefetch` 控制一个消费者最多同时拿多少条未确认消息。

例子：

```text
prefetch = 10
```

意思是：一个消费者最多拿 10 条没 ack 的消息。ack 一条后，Broker 再补一条。

怎么定：

- 单条消息处理慢：prefetch 小一点。
- 单条消息处理快：可以适当大一点。
- 消费端内存敏感：不要太大。
- 需要公平分发：不要太大。
- 顺序要求强：不要随便提高并发和 prefetch。

`prefetch` 不是越大越好，它会影响堆积恢复速度和消费者压力。

## 一个业务建模例子

场景：订单创建后要做三件事。

```text
1. 给用户发优惠券
2. 写审计日志
3. 推送通知
```

推荐模型：

```text
exchange: order.event.exchange
type: topic

routing key: order.created

queues:
- coupon.issue.queue       binding: order.created
- audit.log.queue          binding: order.#
- push.notify.queue        binding: order.created
```

这样每个业务都有自己的队列：

- 发券慢，不影响审计。
- 推送失败，不影响发券。
- 每个队列可以独立配置重试、死信、并发和监控。

不要把三个业务都塞进一个队列，让一个消费者里写三段逻辑。

## 一个队列多个消费者

一个队列挂多个消费者时，是竞争消费：

```text
queue: coupon.issue.queue
consumer A
consumer B
consumer C
```

一条消息只会被其中一个消费者处理。

这适合横向扩容，提高消费能力。

如果你想让多个业务都收到同一条消息，不是给一个队列加多个消费者，而是建多个队列，并绑定到同一个 exchange。

## 多个队列订阅同一事件

广播给多个业务：

```text
order.created
  -> coupon.issue.queue
  -> audit.log.queue
  -> push.notify.queue
```

每个队列都会拿到一份消息。

这才是事件驱动里常见的“多个系统订阅同一个事件”。

## 死信是什么

死信不是一种特殊消息，而是“原队列处理不了，被转发到死信交换机的消息”。

常见进入死信的原因：

- 消费者 `nack` / `reject` 且 `requeue=false`。
- 消息过期。
- 队列超过最大长度。

配置思路：

```text
business.queue
  x-dead-letter-exchange = business.dlx.exchange
  x-dead-letter-routing-key = business.failed

business.dlq
  binding business.dlx.exchange + business.failed
```

死信队列的作用：

- 保留失败现场。
- 给人工排查入口。
- 给补偿重试入口。
- 防止失败消息无限打主队列。

死信队列不是垃圾桶，必须有人看、有人处理、能重放。

## 消息丢不丢，分别看哪里

消息链路上有几段风险：

| 阶段 | 风险 | 常见保护 |
| --- | --- | --- |
| 业务写库后发消息 | 数据已提交但消息没发出去 | outbox / 事务后发送 / 补偿任务 |
| Producer 到 Exchange | Broker 没收到 | publisher confirm |
| Exchange 到 Queue | 路由不到队列 | mandatory + return / Alternate Exchange |
| Queue 存储 | Broker 崩溃 | durable queue + persistent message |
| Consumer 处理 | 处理失败或宕机 | manual ack + retry / DLQ |
| 业务执行 | 重复投递 | 幂等 |

RabbitMQ 只能解决其中一部分。业务侧必须补幂等、补偿和监控。

## 命名建议

统一命名可以大幅降低排查成本。

```text
exchange:
  flashmart.order.event.exchange
  flashmart.order.dlx.exchange

queue:
  flashmart.order.created.queue
  flashmart.order.created.dlq

routing key:
  order.created
  order.created.failed
```

建议：

- exchange 名里带系统、模块、用途。
- queue 名里带系统、模块、事件。
- 死信队列统一用 `.dlq`。
- routing key 用业务事件名。
- 不要出现 `test.queue`、`mq.queue1` 这种上线后看不懂的名字。

## 常见误区

### 以为消息发给队列

大多数工程场景是发给 exchange。默认交换机只是一个特殊情况。

### 以为多个消费者就是广播

一个队列多个消费者是竞争消费。多个队列绑定同一事件才是广播给多个业务。

### 所有业务共用一个队列

这样会导致：

- 消费速度互相影响。
- 重试策略没法分开。
- 死信队列没法按业务看。
- 堆积时不知道是哪类消息。

不同业务尽量拆不同队列。

### 失败消息重新入队

`requeue=true` 要非常谨慎。业务 bug 没修时，它只会让消息无限循环。

### 只关心能发能收

工程里还要关心：

- 路由失败怎么办。
- 消费失败怎么办。
- 重复消息怎么办。
- 堆积怎么办。
- 死信谁处理。

## 建模检查清单

- [ ] 生产者发到哪个 exchange？
- [ ] exchange 类型是什么？
- [ ] routing key 规则是什么？
- [ ] 队列按业务拆了吗？
- [ ] 每个队列绑定了哪些 routing key？
- [ ] 消费失败是重试、死信还是告警？
- [ ] 是否需要 DLX / DLQ？
- [ ] 是否需要幂等？
- [ ] prefetch 和消费者并发怎么定？
- [ ] 如何判断消息没路由到队列？
- [ ] 管理台看哪些指标？

## 最后记一句话

RabbitMQ 的核心不是“发消息”，而是把消息从 exchange 稳定路由到 queue，再让 consumer 可控地 ack 或失败治理。

## 参考

- [RabbitMQ Exchanges](https://www.rabbitmq.com/docs/exchanges)
- [RabbitMQ Queues](https://www.rabbitmq.com/docs/queues)
- [RabbitMQ Consumers](https://www.rabbitmq.com/docs/consumers)
- [RabbitMQ Dead Letter Exchanges](https://www.rabbitmq.com/docs/dlx)
