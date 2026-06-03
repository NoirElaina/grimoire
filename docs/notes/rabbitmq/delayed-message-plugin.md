---
title: RabbitMQ 延迟消息插件
sidebarTitle: 07 延迟消息插件
---

# RabbitMQ 延迟消息插件

> RabbitMQ 延迟消息插件的核心是：声明一个 `x-delayed-message` 交换机，发送消息时通过 `x-delay` 指定延迟毫秒数，时间到了再把消息路由到目标队列。

## 先说结论

RabbitMQ 做延迟消息常见有两种方案：

| 方案 | 核心机制 | 适合场景 |
| --- | --- | --- |
| TTL + DLX | 消息先进延迟队列，过期后死信到业务队列 | 不想装插件、固定延迟、重试队列、订单超时取消 |
| 延迟消息插件 | 消息先进 `x-delayed-message` 交换机，按 `x-delay` 延迟路由 | 每条消息延迟时间不同、想少建延迟队列 |

如果只是订单 15 分钟超时取消，`TTL + DLX` 就够用。

如果业务需要每条消息不同延迟时间，比如：

```text
订单 A 延迟 5 分钟。
订单 B 延迟 15 分钟。
订单 C 延迟 2 小时。
```

延迟消息插件会更直观。

但要注意：RabbitMQ 官方插件仓库已经标注 **不再维护**，并且明确提醒它有明显限制，不适合大量、长期、核心调度任务。

所以这篇笔记的态度是：

```text
学习和老项目维护要会。
新项目生产选型要谨慎。
```

## 它和 TTL + DLX 有什么区别

### TTL + DLX

流程：

```text
Producer
  -> normal exchange
  -> delay queue
  -> 等待 x-message-ttl
  -> dead-letter exchange
  -> business queue
  -> Consumer
```

特点：

- 不需要额外插件。
- 延迟时间通常绑定在队列上。
- 不同延迟时间一般要建不同延迟队列。
- 很适合重试队列和订单超时取消。

### 延迟消息插件

流程：

```text
Producer
  -> x-delayed-message exchange
  -> 等待 x-delay
  -> business queue
  -> Consumer
```

特点：

- 需要安装插件。
- 延迟时间写在每条消息的 `x-delay` header 里。
- 同一个交换机可以处理不同延迟时间。
- 拓扑更少，但依赖插件能力和版本兼容。

## 核心概念

### `x-delayed-message`

这是插件提供的新 exchange type。

声明交换机时，不再写普通的：

```text
direct
topic
fanout
```

而是写：

```text
x-delayed-message
```

但是它内部仍然需要知道自己按什么路由规则工作。

所以要额外传一个参数：

```text
x-delayed-type
```

比如：

```text
x-delayed-type = direct
```

表示这个延迟交换机最终按 direct exchange 的规则路由。

### `x-delay`

`x-delay` 是发送消息时设置的 header。

单位是毫秒。

比如：

```text
x-delay = 30000
```

表示这条消息延迟 30 秒后再路由到队列。

如果不带 `x-delay`，消息会像普通消息一样立即路由。

## 安装插件

### 先检查 RabbitMQ 版本

插件版本必须和 RabbitMQ 版本匹配。

先看 RabbitMQ 版本：

```bash
rabbitmq-diagnostics server_version
```

或者 Docker：

```bash
docker exec rabbitmq rabbitmq-diagnostics server_version
```

再去插件 release 页面下载匹配版本的 `.ez` 文件。

不要随便拿一个版本就复制进去，否则可能启动失败。

### 查看插件目录

```bash
rabbitmq-plugins directories -s
```

Docker 里可以这样看：

```bash
docker exec rabbitmq rabbitmq-plugins directories -s
```

### 复制插件

假设下载到本地的文件是：

```text
rabbitmq_delayed_message_exchange-4.2.0.ez
```

复制到容器：

```bash
docker cp rabbitmq_delayed_message_exchange-4.2.0.ez rabbitmq:/plugins/
```

### 启用插件

```bash
rabbitmq-plugins enable rabbitmq_delayed_message_exchange
```

Docker：

```bash
docker exec rabbitmq rabbitmq-plugins enable rabbitmq_delayed_message_exchange
```

然后重启 RabbitMQ：

```bash
docker restart rabbitmq
```

### 验证是否启用

```bash
rabbitmq-plugins list | grep delayed
```

看到类似：

```text
[E*] rabbitmq_delayed_message_exchange
```

说明已经启用。

管理后台里创建 Exchange 时，也应该能看到：

```text
x-delayed-message
```

这个类型。

## Spring Boot 配置

### 定义延迟交换机

用 `CustomExchange` 最直观：

```java
@Configuration
public class RabbitMqConfig {

    public static final String ORDER_DELAYED_EXCHANGE = "flashmart.order.delayed.exchange";
    public static final String ORDER_TIMEOUT_QUEUE = "flashmart.order.timeout.queue";
    public static final String ORDER_TIMEOUT_ROUTING_KEY = "order.timeout";

    @Bean
    public CustomExchange orderDelayedExchange() {
        Map<String, Object> args = new HashMap<>();
        args.put("x-delayed-type", "direct");
        return new CustomExchange(
                ORDER_DELAYED_EXCHANGE,
                "x-delayed-message",
                true,
                false,
                args
        );
    }

    @Bean
    public Queue orderTimeoutQueue() {
        return QueueBuilder.durable(ORDER_TIMEOUT_QUEUE).build();
    }

    @Bean
    public Binding orderTimeoutBinding() {
        return BindingBuilder
                .bind(orderTimeoutQueue())
                .to(orderDelayedExchange())
                .with(ORDER_TIMEOUT_ROUTING_KEY)
                .noargs();
    }
}
```

这里的意思是：

```text
先把消息发到 flashmart.order.delayed.exchange。
交换机收到消息后读取 x-delay。
到时间后，按 direct 规则和 routing key 路由到 flashmart.order.timeout.queue。
```

注意：

```text
延迟消息插件的延迟发生在 exchange 层。
TTL + DLX 的延迟发生在 queue 层。
```

这两点是它们拓扑差异的根。

### 发送延迟消息

发送时设置 `MessageProperties#setDelay`：

```java
public void sendOrderTimeoutMessage(OrderCreatedEvent event, Duration delay) {
    rabbitTemplate.convertAndSend(
            RabbitMqConfig.ORDER_DELAYED_EXCHANGE,
            RabbitMqConfig.ORDER_TIMEOUT_ROUTING_KEY,
            event,
            message -> {
                message.getMessageProperties().setMessageId(event.eventId());
                message.getMessageProperties().setDelayLong(delay.toMillis());
                return message;
            }
    );
}
```

如果你的 Spring AMQP 版本没有 `setDelayLong`，可以用：

```java
message.getMessageProperties().setDelay((int) delay.toMillis());
```

但是 `int` 有范围限制。

普通订单 15 分钟、30 分钟这种没问题；特别长的延迟不要这么做。

### 消费者监听正常队列

消费者不监听延迟交换机。

消费者只监听最终的业务队列：

```java
@RabbitListener(queues = RabbitMqConfig.ORDER_TIMEOUT_QUEUE)
public void handleOrderTimeoutMessage(OrderCreatedEvent event, Message message) {
    Integer receivedDelay = message.getMessageProperties().getReceivedDelay();
    log.info("收到订单超时消息，orderId={}, receivedDelay={}", event.orderId(), receivedDelay);

    orderService.cancelExpiredOrder(event.userId(), event.orderId());
}
```

`receivedDelay` 只是用于观察这条消息曾经被延迟过。

不要把收到的 `x-delay` 原样继续传给下一条消息，否则可能导致意外的二次延迟。

## 订单超时取消怎么写

用延迟消息插件做订单超时，拓扑会比 TTL + DLX 简单：

```text
订单创建成功
  -> afterCommit 发送 OrderCreatedEvent
  -> x-delay = 16 分钟
  -> 到时间后进入 order.timeout.queue
  -> 消费者调用 cancelExpiredOrder
```

发送代码：

```java
private void sendOrderTimeoutAfterCommit(OrderCreatedEvent event, LocalDateTime closeDeadlineTime) {
    TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
        @Override
        public void afterCommit() {
            Duration delay = Duration.between(LocalDateTime.now(), closeDeadlineTime);
            if (delay.isNegative() || delay.isZero()) {
                delay = Duration.ZERO;
            }

            rabbitTemplate.convertAndSend(
                    RabbitMqConfig.ORDER_DELAYED_EXCHANGE,
                    RabbitMqConfig.ORDER_TIMEOUT_ROUTING_KEY,
                    event,
                    message -> {
                        message.getMessageProperties().setMessageId(event.eventId());
                        message.getMessageProperties().setDelayLong(delay.toMillis());
                        return message;
                    }
            );
        }
    });
}
```

消费端仍然要做业务校验：

```java
@Transactional(rollbackFor = Exception.class)
public void cancelExpiredOrder(Long userId, Long orderId) {
    OrderDetailVO order = orderMapper.selectOrderDetail(userId, orderId);
    if (order == null || !"PENDING_PAYMENT".equals(order.getStatus())) {
        return;
    }

    if (LocalDateTime.now().isBefore(order.getCloseDeadlineTime())) {
        return;
    }

    int affected = orderMapper.cancelOrder(userId, orderId);
    if (affected == 0) {
        return;
    }

    restoreStock(orderMapper.selectOrderItems(orderId));
}
```

不要因为用了插件就省掉这些判断。

原因是：

- 消息可能重复消费。
- 消息可能晚到。
- 消息可能被人工重新投递。
- 订单可能已经支付。
- 订单可能已经被用户取消。

延迟插件只解决“过一段时间再投递”，不解决业务幂等。

## 动态延迟重试

延迟插件也常用于失败重试。

比如消费失败后，不马上重试，而是：

```text
第 1 次失败：10 秒后重试
第 2 次失败：30 秒后重试
第 3 次失败：2 分钟后重试
超过次数：进入死信队列
```

发送重试消息：

```java
private void sendRetryMessage(OrderCreatedEvent event, int retryCount) {
    long delayMillis = switch (retryCount) {
        case 0 -> 10_000L;
        case 1 -> 30_000L;
        case 2 -> 120_000L;
        default -> -1L;
    };

    if (delayMillis < 0) {
        rabbitTemplate.convertAndSend(
                RabbitMqConfig.ORDER_DEAD_EXCHANGE,
                RabbitMqConfig.ORDER_DEAD_ROUTING_KEY,
                event
        );
        return;
    }

    rabbitTemplate.convertAndSend(
            RabbitMqConfig.ORDER_DELAYED_EXCHANGE,
            RabbitMqConfig.ORDER_TIMEOUT_ROUTING_KEY,
            event,
            message -> {
                message.getMessageProperties().setHeader("retry-count", retryCount + 1);
                message.getMessageProperties().setDelayLong(delayMillis);
                return message;
            }
    );
}
```

这种写法比建多个重试队列更灵活。

但是核心点不变：

```text
重试必须有最大次数。
最终失败必须有死信兜底。
消费者必须幂等。
```

## 不适合什么场景

延迟消息插件不要无脑用。

尤其不适合：

- 延迟几天、几周、几个月的长期任务。
- 堆积几十万、几百万条延迟消息。
- 强依赖集群高可用的核心调度。
- 需要精确到秒级甚至毫秒级执行的定时任务。
- 无法接受插件维护状态和版本兼容风险的系统。

更合适的替代方案：

| 场景 | 更推荐 |
| --- | --- |
| 固定延迟重试 | TTL + DLX |
| 订单超时关闭 | TTL + DLX + 兜底扫描 |
| 长期预约任务 | 数据库任务表 + 调度器 |
| 大量延迟任务 | 专门的调度系统或支持延迟的消息中间件 |
| 核心交易消息可靠性 | outbox + MQ + 幂等消费 |

## 插件的关键限制

### 当前官方插件不再维护

RabbitMQ 官方插件仓库已经标注该项目不再维护。

这意味着新项目选型时要特别谨慎。

不要只看到它用起来方便，就把核心链路压在它上面。

### 不适合长期调度

官方说明里也强调，它更适合延迟几秒、几分钟、几小时，最多一两天这种短期延迟。

如果你要做：

```text
7 天后自动确认收货
30 天后会员到期提醒
半年后预约通知
```

不要把消息一直压在 RabbitMQ 延迟插件里。

这类任务更适合：

```text
数据库任务表 + 定时扫描 + 分片执行 + 幂等处理
```

### 大量延迟消息有风险

插件需要存储还没到期的延迟消息。

如果你堆了大量延迟消息，会带来：

- 内存和磁盘压力。
- 节点重启恢复压力。
- 插件内部调度压力。
- 集群节点丢失导致消息风险。

所以它不是“延迟任务数据库”。

### 禁用插件会丢未投递延迟消息

官方仓库明确提醒：

```text
禁用插件会导致尚未投递的延迟消息丢失。
```

所以升级、禁用、迁移前要先确认延迟消息是否已经清空，或者有业务补偿方案。

### `mandatory` 语义不可靠

普通 exchange 发送时，如果消息无法路由，可以配合 `mandatory` 和 return callback 感知。

但延迟消息是在未来某个时间点再路由。

到那个时间点：

- 原始连接可能已经不存在。
- 队列或 binding 可能已经变化。
- return callback 不一定还能按普通方式工作。

所以延迟插件不适合依赖 `mandatory` 做未来路由保障。

## 和业务设计的关系

延迟插件只是触发器。

业务规则必须自己兜住。

订单超时关闭里仍然要有：

```text
pay_expire_time:
    判断用户能不能支付。

close_deadline_time:
    判断系统能不能关闭。

status 条件更新:
    防止重复取消、重复恢复库存。

消费幂等:
    防止消息重复投递。

兜底扫描:
    防止 MQ 或插件异常。
```

不要写成：

```text
消息到了，所以订单一定可以取消。
```

而要写成：

```text
消息到了，只代表该检查这个订单是否应该取消。
```

这和 TTL + DLX 方案完全一样。

## 选型建议

### 可以使用

可以考虑延迟插件的情况：

- 学习 RabbitMQ 延迟消息机制。
- 老项目已经依赖该插件，需要维护。
- 延迟时间按消息动态变化。
- 延迟时间较短。
- 延迟消息量可控。
- 有兜底扫描和业务幂等。

### 谨慎使用

谨慎使用的情况：

- 新项目核心链路。
- 延迟消息数量很大。
- 任务要延迟很多天。
- 系统对消息丢失非常敏感。
- RabbitMQ 版本升级频繁。
- 部署环境是云厂商托管 RabbitMQ，不一定支持安装插件。

### 我的默认选择

如果是 FlashMart 这种学习电商项目：

```text
第一版：TTL + DLX
第二版：补 outbox 和兜底扫描
第三版：如果确实需要动态延迟，再了解延迟插件
```

原因：

```text
TTL + DLX 更通用。
插件有维护和版本风险。
订单超时关闭不一定需要动态延迟。
```

## 常见坑

### 只声明普通 direct exchange

错误：

```java
new DirectExchange("order.delayed.exchange")
```

这只是普通 direct exchange。

设置 `x-delay` 也不会生效。

必须声明：

```text
type = x-delayed-message
x-delayed-type = direct
```

### 忘记安装插件

如果没有安装插件，却声明 `x-delayed-message`，RabbitMQ 会声明失败。

常见现象：

```text
unknown exchange type 'x-delayed-message'
```

### 延迟交换机和普通交换机同名

RabbitMQ 的 exchange 类型不能随便改。

如果已经存在：

```text
order.exchange = direct
```

你再用同名声明：

```text
order.exchange = x-delayed-message
```

会发生参数不一致错误。

解决方式：

- 换一个新的 exchange 名称。
- 或删除旧 exchange 后重新声明。

生产环境不要直接删，要先确认绑定关系和消息影响。

### 把插件当成精确定时器

RabbitMQ 延迟消息不是精确调度器。

它只能保证大致延迟后投递。

实际消费时间还受这些因素影响：

- Broker 压力。
- 队列堆积。
- 消费者并发。
- 网络抖动。
- 应用重启。

如果业务要求非常精确的执行时间，需要专门调度系统。

### 消费者没有幂等

延迟到了不代表只会消费一次。

只要使用 MQ，就要默认：

```text
消息可能重复。
消费者可能重启。
ack 可能失败。
```

所以消费端仍然要做幂等。

## 最小落地模板

```text
1. 确认 RabbitMQ 版本。
2. 下载匹配版本插件 .ez。
3. 复制到 plugins 目录。
4. rabbitmq-plugins enable rabbitmq_delayed_message_exchange。
5. 声明 x-delayed-message exchange。
6. 设置 x-delayed-type = direct / topic。
7. 发送消息时设置 x-delay。
8. 消费者监听最终业务队列。
9. 消费端做幂等。
10. 保留兜底扫描或补偿机制。
```

## 参考

- [RabbitMQ Delayed Message Plugin](https://github.com/rabbitmq/rabbitmq-delayed-message-exchange)
- [Spring AMQP Delayed Message Exchange](https://docs.spring.io/spring-amqp/reference/amqp/delayed-message-exchange.html)
- [RabbitMQ Scheduling Messages with RabbitMQ](https://www.rabbitmq.com/blog/2015/04/16/scheduling-messages-with-rabbitmq)
