---
title: Spring 事务同步与 MQ
sidebarTitle: 03 事务同步与 MQ
---

# Spring 事务同步与 MQ

> 这篇不是只讲 `afterCommit`，而是借“订单创建后发 MQ”这个场景，把 Spring 事务同步、事务事件、事务后副作用和可靠消息边界串起来。

## 先给结论

Spring 事务里最容易踩坑的是：数据库操作可以回滚，但 MQ、Redis、HTTP 这些外部副作用不会跟着数据库事务回滚。

所以要先分清楚：

| 时机 | 能做什么 | 不建议做什么 |
| --- | --- | --- |
| 事务内 | 写数据库、校验状态、写 outbox | 直接发 MQ、调远程接口、删缓存 |
| `beforeCommit` | 提交前最后检查、刷新 ORM 状态 | 发外部消息 |
| `afterCommit` | 发 MQ、删缓存、发布通知 | 认为消息一定可靠送达 |
| `afterRollback` | 记录回滚、释放外部预留资源 | 再补写主业务数据 |
| `afterCompletion` | 根据提交/回滚状态统一清理 | 写复杂业务流程 |

这类知识点叫：

```text
事务同步 / 事务事件 / 事务后副作用
```

MQ 只是其中一个场景。

## 典型场景

这些都属于“事务后副作用”：

- 订单创建成功后发送 MQ。
- 商品更新成功后删除 Redis 缓存。
- 支付成功后通知第三方系统。
- 用户注册成功后发送短信或邮件。
- 数据提交后通过 WebSocket / SSE 通知前端。
- 事务完成后记录非核心审计日志。

共同点：

```text
它们依赖数据库提交结果，但本身不属于数据库事务。
```

所以不能随手写在事务中间。

## 代码

```java
// 事务提交后发送订单创建事件，避免订单回滚但 MQ 消息已经发出。
OrderCreatedEvent event = new OrderCreatedEvent(
    UUID.randomUUID().toString(),
    order.getId(),
    order.getOrderNo(),
    userId,
    LocalDateTime.now()
);

TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
    @Override
    public void afterCommit() {
        rabbitTemplate.convertAndSend(
            RabbitMqConfig.ORDER_EXCHANGE,
            RabbitMqConfig.ORDER_CREATED_ROUTING_KEY,
            event
        );
    }
});
```

这段代码只是 `afterCommit` 的一个例子。真正要理解的是：Spring 事务有一组生命周期回调，不同回调适合不同事情。

## 它在解决什么

如果在事务方法里直接发 MQ：

```java
@Transactional(rollbackFor = Exception.class)
public Long createOrder(Long userId) {
    Order order = orderRepository.save(...);

    rabbitTemplate.convertAndSend(
        RabbitMqConfig.ORDER_EXCHANGE,
        RabbitMqConfig.ORDER_CREATED_ROUTING_KEY,
        event
    );

    // 后面代码抛异常，数据库事务回滚
    throw new RuntimeException("create order failed");
}
```

会出现一种很尴尬的情况：

```text
MQ 消息已经发出
但订单事务回滚了
消费者收到 orderId 后去查库，发现订单不存在
```

这就是典型的“本地事务和外部副作用不一致”。

MQ、Redis、HTTP 调用都不受数据库事务控制。数据库回滚，不会把已经发出去的消息撤回来。

## `afterCommit` 做了什么

`TransactionSynchronizationManager.registerSynchronization(...)` 可以注册事务同步回调。

其中 `afterCommit()` 会在当前事务真正提交成功之后执行：

```text
开始事务
  -> insert order
  -> update stock
  -> 注册 afterCommit 回调
提交事务成功
  -> 执行 afterCommit
  -> 发送 MQ
```

如果事务回滚：

```text
开始事务
  -> insert order
  -> 注册 afterCommit 回调
发生异常
回滚事务
  -> afterCommit 不执行
  -> MQ 不发送
```

所以它至少能保证：

```text
数据库没提交成功，就不发送订单创建消息。
```

## 事务同步有哪些回调

`afterCommit` 只是事务同步回调里的一个点。

常见回调：

| 回调 | 什么时候触发 | 常见用途 |
| --- | --- | --- |
| `beforeCommit` | 事务提交前 | 提交前做最后检查，不适合发 MQ |
| `beforeCompletion` | 事务完成前，不管提交还是回滚都会走 | 清理提交前资源 |
| `afterCommit` | 事务成功提交后 | 发 MQ、删缓存、发领域事件、调非核心外部通知 |
| `afterCompletion` | 事务完成后，提交或回滚都会走 | 根据状态统一清理资源、打日志 |
| `savepoint` | 创建嵌套事务保存点时 | 嵌套事务相关，普通业务少用 |
| `savepointRollback` | 回滚到保存点时 | 嵌套事务相关，普通业务少用 |

最常用的是：

```text
beforeCommit
afterCommit
afterRollback 语义通常通过 afterCompletion(STATUS_ROLLED_BACK) 处理
afterCompletion
```

如果只关心“事务成功后做某事”，用 `afterCommit`。

如果还想知道最终是提交还是回滚，用 `afterCompletion`。

## 生命周期顺序

一次正常提交大致是：

```text
开启事务
  -> 执行业务 SQL
  -> registerSynchronization
  -> beforeCommit
  -> beforeCompletion
  -> 数据库 commit
  -> afterCommit
  -> afterCompletion(STATUS_COMMITTED)
```

一次回滚大致是：

```text
开启事务
  -> 执行业务 SQL
  -> registerSynchronization
  -> 发生异常 / 标记 rollback-only
  -> beforeCompletion
  -> 数据库 rollback
  -> afterCompletion(STATUS_ROLLED_BACK)
```

注意：

- 回滚时不会执行 `afterCommit`。
- `beforeCompletion` 不管提交还是回滚都可能执行。
- `afterCompletion` 可以拿到最终状态。
- 外部动作如果必须等数据真实提交后才能做，放 `afterCommit` 或 `AFTER_COMMIT` 事件。

## `beforeCommit` 能做什么

`beforeCommit` 是提交前回调：

```java
TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
    @Override
    public void beforeCommit(boolean readOnly) {
        log.info("before commit, readOnly={}", readOnly);
    }
});
```

适合：

- 提交前做轻量检查。
- ORM 场景下提交前 flush。
- 记录“准备提交”的日志。

不适合：

- 发 MQ。
- 删除缓存。
- 调第三方接口。

原因很简单：`beforeCommit` 执行后，数据库仍然可能提交失败或回滚。

如果你在 `beforeCommit` 发了 MQ，仍然可能出现：

```text
MQ 已发出
数据库提交失败
```

所以 `beforeCommit` 不是“安全发送外部副作用”的时机。

## `afterCompletion` 怎么用

`afterCompletion` 会带事务最终状态：

```java
TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
    @Override
    public void afterCompletion(int status) {
        if (status == STATUS_COMMITTED) {
            log.info("order transaction committed, orderId={}", order.getId());
            return;
        }

        if (status == STATUS_ROLLED_BACK) {
            log.warn("order transaction rolled back, orderNo={}", order.getOrderNo());
            return;
        }

        log.warn("order transaction completed with unknown status, orderNo={}", order.getOrderNo());
    }
});
```

适合：

- 记录事务最终状态。
- 清理 ThreadLocal / 临时资源。
- 回滚时做非事务资源补偿。

不适合：

- 在回滚后再乱改数据库状态。
- 在里面写大量业务分支。
- 用它替代真正的事务边界。

## 哪些动作适合事务后做

数据库事务提交后再做的动作，一般叫“事务后副作用”。

常见有：

| 动作 | 为什么放事务后 |
| --- | --- |
| 发送 MQ | 避免事务回滚但消息已发 |
| 删除 Redis 缓存 | 避免事务回滚但缓存已删 |
| 发送 WebSocket / SSE 通知 | 避免通知了不存在的数据 |
| 调第三方通知接口 | 避免外部系统看到未提交状态 |
| 发布 Spring 应用事件 | 避免监听器读到未提交数据 |
| 写非核心审计日志 | 不阻塞主事务 |

不适合放在事务后回调里的：

- 核心数据库写入。
- 必须和主事务一起提交的数据。
- 长时间阻塞的外部调用。
- 失败后没有补偿方案的重要动作。

`afterCommit` 适合“事务成功后触发”，不适合承载复杂业务流程。

## 更完整的写法

放在 Service 事务方法里：

```java
@Service
public class OrderServiceImpl implements OrderService {

    private final OrderRepository orderRepository;
    private final RabbitTemplate rabbitTemplate;

    public OrderServiceImpl(OrderRepository orderRepository,
                            RabbitTemplate rabbitTemplate) {
        this.orderRepository = orderRepository;
        this.rabbitTemplate = rabbitTemplate;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public Long createOrder(Long userId, CreateOrderCommand command) {
        Order order = orderRepository.create(userId, command);

        OrderCreatedEvent event = new OrderCreatedEvent(
            UUID.randomUUID().toString(),
            order.getId(),
            order.getOrderNo(),
            userId,
            LocalDateTime.now()
        );

        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                rabbitTemplate.convertAndSend(
                    RabbitMqConfig.ORDER_EXCHANGE,
                    RabbitMqConfig.ORDER_CREATED_ROUTING_KEY,
                    event
                );
            }
        });

        return order.getId();
    }
}
```

注意：这段代码必须在事务上下文里注册才有意义。

## 先判断有没有事务

如果当前方法没有事务，直接调用：

```java
TransactionSynchronizationManager.registerSynchronization(...)
```

可能会报错或行为不符合预期。

可以封装一个工具：

```java
public final class TransactionAfterCommit {

    private TransactionAfterCommit() {
    }

    public static void run(Runnable action) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    action.run();
                }
            });
            return;
        }

        action.run();
    }
}
```

使用：

```java
TransactionAfterCommit.run(() -> rabbitTemplate.convertAndSend(
    RabbitMqConfig.ORDER_EXCHANGE,
    RabbitMqConfig.ORDER_CREATED_ROUTING_KEY,
    event
));
```

这个工具表达的意思是：

- 如果当前有事务：提交后执行。
- 如果当前没事务：立即执行。

## `@TransactionalEventListener`

如果不想在业务方法里直接写 `TransactionSynchronizationManager`，可以用 Spring 的事务事件监听。

先定义事件：

```java
public record OrderCreatedApplicationEvent(
    String eventId,
    Long orderId,
    String orderNo,
    Long userId,
    LocalDateTime occurredAt
) {
}
```

事务方法里发布事件：

```java
@Transactional(rollbackFor = Exception.class)
public Long createOrder(Long userId, CreateOrderCommand command) {
    Order order = orderRepository.create(userId, command);

    applicationEventPublisher.publishEvent(new OrderCreatedApplicationEvent(
        UUID.randomUUID().toString(),
        order.getId(),
        order.getOrderNo(),
        userId,
        LocalDateTime.now()
    ));

    return order.getId();
}
```

监听事务提交后事件：

```java
@Component
public class OrderCreatedEventListener {

    private final RabbitTemplate rabbitTemplate;

    public OrderCreatedEventListener(RabbitTemplate rabbitTemplate) {
        this.rabbitTemplate = rabbitTemplate;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void handle(OrderCreatedApplicationEvent event) {
        rabbitTemplate.convertAndSend(
            RabbitMqConfig.ORDER_EXCHANGE,
            RabbitMqConfig.ORDER_CREATED_ROUTING_KEY,
            event
        );
    }
}
```

`phase` 常见值：

| phase | 含义 |
| --- | --- |
| `BEFORE_COMMIT` | 提交前处理 |
| `AFTER_COMMIT` | 提交后处理，最常用 |
| `AFTER_ROLLBACK` | 回滚后处理 |
| `AFTER_COMPLETION` | 完成后处理，提交或回滚都会触发 |

优点：

- 业务方法更干净。
- 事件发布和事件处理解耦。
- 多个监听器可以订阅同一个事件。

注意：

- 默认没有事务时，监听器不会执行。
- 如果希望没事务也执行，可以设置 `fallbackExecution = true`，但要慎用。

```java
@TransactionalEventListener(
    phase = TransactionPhase.AFTER_COMMIT,
    fallbackExecution = true
)
public void handle(OrderCreatedApplicationEvent event) {
    // 没有事务时也会执行
}
```

一般业务里不要随便开 `fallbackExecution`，否则“必须事务提交后执行”的语义会变弱。

## 事务事件的其他 phase

### `BEFORE_COMMIT`

```java
@TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
public void beforeCommit(OrderCreatedApplicationEvent event) {
    log.info("order will commit, orderId={}", event.orderId());
}
```

适合提交前校验、日志、flush。

不适合发 MQ，因为后面仍然可能提交失败。

### `AFTER_COMMIT`

```java
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
public void afterCommit(OrderCreatedApplicationEvent event) {
    rabbitTemplate.convertAndSend(
        RabbitMqConfig.ORDER_EXCHANGE,
        RabbitMqConfig.ORDER_CREATED_ROUTING_KEY,
        event
    );
}
```

适合：

- 发 MQ。
- 删除缓存。
- 发通知。
- 触发异步任务。

但要记住：它只能保证“事务提交后才执行”，不能保证“外部动作一定成功”。

### `AFTER_ROLLBACK`

```java
@TransactionalEventListener(phase = TransactionPhase.AFTER_ROLLBACK)
public void afterRollback(OrderCreatedApplicationEvent event) {
    log.warn("order create rolled back, orderNo={}", event.orderNo());
}
```

适合：

- 记录回滚日志。
- 释放外部预留资源。
- 标记某些非事务状态需要补偿。

不适合：

- 再创建订单。
- 再强行发送“订单创建成功”消息。

### `AFTER_COMPLETION`

```java
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMPLETION)
public void afterCompletion(OrderCreatedApplicationEvent event) {
    log.info("order transaction completed, eventId={}", event.eventId());
}
```

它不区分提交还是回滚。如果业务需要知道状态，直接用 `TransactionSynchronization.afterCompletion(int status)` 更明确。

## 异常边界

这里特别容易误解。

### `beforeCommit` 抛异常

`beforeCommit` 还在提交前，如果抛异常，可能导致事务提交失败并回滚。

所以 `beforeCommit` 里不要做不稳定外部调用。

### `afterCommit` 抛异常

`afterCommit` 发生在数据库提交成功之后。

这时即使抛异常：

```text
数据库也不会因为它再回滚。
```

所以：

```java
@Override
public void afterCommit() {
    try {
        rabbitTemplate.convertAndSend(...);
    } catch (Exception exception) {
        log.error("send mq after commit failed", exception);
    }
}
```

如果消息很重要，不能只靠 catch 打日志，要用 Outbox。

### `afterCompletion` 抛异常

它通常用于清理和记录，不要让这里的异常影响主流程。

推荐：

```java
try {
    cleanup();
} catch (Exception exception) {
    log.warn("transaction cleanup failed", exception);
}
```

## 线程边界

Spring 声明式事务默认绑定在线程上。

所以这个写法有坑：

```java
@Transactional(rollbackFor = Exception.class)
public void createOrder() {
    CompletableFuture.runAsync(() -> {
        TransactionSynchronizationManager.registerSynchronization(...);
    });
}
```

异步线程里通常拿不到当前事务上下文。

如果要异步：

- 先在事务线程里注册 `afterCommit`。
- 在 `afterCommit` 里把任务提交给线程池。
- 或者写 Outbox，让后台任务异步发送。

```java
TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
    @Override
    public void afterCommit() {
        taskExecutor.execute(() -> rabbitTemplate.convertAndSend(...));
    }
});
```

注意：这样依然不等于可靠投递，只是把事务后动作异步化。

## 事务传播的影响

如果方法里有 `REQUIRES_NEW`，要特别注意“当前事务”到底是哪一个。

例子：

```java
@Transactional(rollbackFor = Exception.class)
public void outer() {
    innerService.createOrderInNewTransaction();
    throw new RuntimeException("outer rollback");
}

@Transactional(propagation = Propagation.REQUIRES_NEW, rollbackFor = Exception.class)
public void createOrderInNewTransaction() {
    orderRepository.create(...);
    registerAfterCommitSendMq();
}
```

这里内部事务 `REQUIRES_NEW` 可能已经提交并触发 MQ，外部事务再回滚也不会影响内部事务。

所以看到事务同步时，要问：

```text
它注册在哪个事务上？
这个事务什么时候提交？
外层事务会不会再回滚？
```

普通业务里不清楚传播行为时，别随便套 `REQUIRES_NEW`。

## `afterCommit` 和事务事件怎么选

| 写法 | 适合场景 |
| --- | --- |
| `TransactionSynchronizationManager` | 当前方法里临时注册一个提交后动作 |
| `@TransactionalEventListener` | 领域事件 / 应用事件，多个监听器订阅 |
| Outbox | 重要消息，必须最终发出，可重试可追踪 |

简单场景：

```text
afterCommit 就够
```

事件解耦：

```text
@TransactionalEventListener 更清楚
```

强可靠：

```text
Outbox
```

## 这不是最终可靠投递方案

`afterCommit` 只解决一半问题。

它解决了：

```text
订单回滚，但 MQ 已经发出
```

但没有解决：

```text
订单提交成功，但 afterCommit 里发送 MQ 失败
```

例如：

- RabbitMQ 宕机。
- 网络断开。
- exchange 写错。
- routing key 没绑定队列。
- 应用提交事务后立刻崩溃，还没来得及发 MQ。

所以它不是“可靠消息最终方案”，只是比事务内直接发更安全。

## 可靠性更高的 Outbox

如果订单创建消息很重要，推荐 Outbox 模式。

流程：

```text
1. 开启数据库事务
2. 写订单表
3. 同一个事务写 outbox_event 表
4. 提交事务
5. 后台任务扫描未发送事件
6. 发送 RabbitMQ
7. publisher confirm 成功后标记 SENT
8. 失败继续重试
```

表结构示例：

```sql
create table outbox_event (
    id bigint primary key,
    event_id varchar(64) not null,
    event_type varchar(64) not null,
    aggregate_id varchar(64) not null,
    payload text not null,
    status tinyint not null,
    retry_count int not null default 0,
    next_retry_time datetime not null,
    create_time datetime not null,
    update_time datetime not null,
    unique key uk_event_id(event_id),
    key idx_status_retry(status, next_retry_time)
);
```

业务事务里：

```java
@Transactional(rollbackFor = Exception.class)
public Long createOrder(Long userId, CreateOrderCommand command) {
    Order order = orderRepository.create(userId, command);

    outboxEventRepository.save(OutboxEvent.orderCreated(
        order.getId(),
        order.getOrderNo(),
        userId
    ));

    return order.getId();
}
```

后台发送：

```java
public void publishPendingEvents() {
    List<OutboxEvent> events = outboxEventRepository.findPendingEvents();
    for (OutboxEvent event : events) {
        rabbitTemplate.convertAndSend(
            event.exchange(),
            event.routingKey(),
            event.payload(),
            new CorrelationData(event.eventId())
        );
    }
}
```

Outbox 的优势：

- 订单和事件记录在同一个数据库事务里。
- 应用崩溃后还能继续扫描补发。
- 发送失败可以重试。
- 可以记录发送次数和失败原因。

## 和 publisher confirm 的关系

`afterCommit` 关注：

```text
数据库提交后再发
```

publisher confirm 关注：

```text
消息有没有到达 RabbitMQ exchange
```

两者不是替代关系。

更稳的组合：

```text
afterCommit / outbox
  + publisher confirm
  + returns callback
  + 消费端幂等
```

如果只用 `afterCommit`，发送失败时你可能不知道。

如果只用 confirm，但事务内直接发，仍然可能出现订单回滚、消息已发。

## 和消费幂等的关系

即使用了 `afterCommit`，消费者仍然必须幂等。

原因：

- RabbitMQ 可能重复投递。
- 生产者可能重试发送。
- Outbox 任务可能重复扫描。
- 消费者处理完业务但 ack 前宕机，消息会重新投递。

所以事件里要有稳定 ID：

```java
public record OrderCreatedEvent(
    String eventId,
    Long orderId,
    String orderNo,
    Long userId,
    LocalDateTime occurredAt
) {
}
```

消费端用 `eventId` 或业务唯一键去重：

```sql
create unique index uk_event_consumer
on mq_consume_log(event_id, consumer_name);
```

## 什么时候用 afterCommit 就够了

适合：

- 消息不是核心强可靠。
- 丢一条可以靠人工或定时任务补偿。
- 本地项目、练习项目、普通通知类消息。
- 希望避免事务回滚后误发消息。

不适合：

- 支付成功事件。
- 库存扣减事件。
- 订单状态流转核心事件。
- 必须确保每条消息最终发出去的场景。

这些场景应该上 Outbox 或更完整的可靠消息方案。

## 常见坑

### 没有事务还注册 afterCommit

没有事务时，`afterCommit` 没有“提交后”这个语义。要么保证方法有 `@Transactional`，要么封装工具判断 `isSynchronizationActive()`。

### 在 `afterCommit` 里写复杂业务

`afterCommit` 里只做外部副作用：

- 发 MQ。
- 删缓存。
- 发事件。

不要在里面再写一堆数据库事务逻辑。

### 以为 afterCommit 能保证消息一定发成功

不能。它只能保证事务提交后才执行发送动作，不保证 RabbitMQ 一定收到。

### eventId 每次消费才生成

eventId 要在生产事件时生成，并放进消息。消费者用它做幂等。

### 发送失败没有日志

至少要打日志：

```java
try {
    rabbitTemplate.convertAndSend(...);
} catch (Exception exception) {
    log.error("send order created event failed, eventId={}, orderId={}",
        event.eventId(),
        event.orderId(),
        exception
    );
}
```

如果消息重要，不要只打日志，要能重试。

## 检查清单

- [ ] 发送 MQ 的代码不在事务提交前直接执行。
- [ ] `afterCommit` 注册发生在事务方法内。
- [ ] 代码能处理没有事务的情况，或明确保证一定有事务。
- [ ] 事件里有 `eventId`。
- [ ] 发送失败有日志。
- [ ] 重要消息有 Outbox 或补偿任务。
- [ ] publisher confirm 和 returns callback 已配置。
- [ ] 消费端有幂等。
- [ ] 不在 `afterCommit` 里写复杂业务。

## 最后记一句话

`afterCommit` 解决的是“事务回滚但消息已发”的问题；如果你还要保证“事务提交后消息一定最终发出”，就要继续上 Outbox 和重试。

## 参考

- [Spring TransactionSynchronization](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/transaction/support/TransactionSynchronization.html)
- [Spring TransactionSynchronizationManager](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/transaction/support/TransactionSynchronizationManager.html)
- [RabbitMQ Publisher Confirms](https://www.rabbitmq.com/docs/confirms)
