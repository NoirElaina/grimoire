---
title: Spring 事务失效场景
sidebarTitle: 事务失效场景
---

# Spring 事务失效场景

> 事务失效最坑的地方是：代码看起来有 `@Transactional`，实际却没有按你想的回滚。

## 先给结论

常见失效原因：

| 场景 | 为什么失效 |
| --- | --- |
| 自调用 | 没经过 Spring 代理 |
| 方法不是可代理方法 | private / final 等可能无法增强 |
| 异常被吞 | 事务看不到异常 |
| checked exception 未配置回滚 | 默认只回滚运行时异常和 Error |
| 数据库引擎不支持事务 | MyISAM 等不支持 |
| 没有被 Spring 管理 | 自己 new 的对象不是 Bean |
| 多线程 / 异步 | 新线程不在当前事务上下文 |
| 事务管理器用错 | 多数据源时连错事务 |
| 外部副作用 | MQ、Redis、HTTP 不受数据库事务控制 |

## 自调用

错误：

```java
@Service
public class UserService {

    public void register(RegisterCommand command) {
        createUser(command);
    }

    @Transactional(rollbackFor = Exception.class)
    public void createUser(RegisterCommand command) {
        userMapper.insert(user);
        roleMapper.insert(defaultRole);
    }
}
```

`register()` 调用 `createUser()` 是 `this.createUser()`，没有经过 Spring 代理。

解决：

- 把事务方法提到另一个 Service。
- 让外部调用事务方法。
- 不要依赖同类内部调用触发事务。

```java
@Service
public class UserApplicationService {

    private final UserCreateService userCreateService;

    public void register(RegisterCommand command) {
        userCreateService.createUser(command);
    }
}
```

## 异常被吞

错误：

```java
@Transactional(rollbackFor = Exception.class)
public void createOrder(CreateOrderCommand command) {
    try {
        orderMapper.insert(order);
        stockMapper.decrease(command.skuId(), command.count());
    } catch (Exception ex) {
        log.error("create order failed", ex);
    }
}
```

方法正常结束，事务会提交。

正确：

```java
@Transactional(rollbackFor = Exception.class)
public void createOrder(CreateOrderCommand command) {
    try {
        orderMapper.insert(order);
        stockMapper.decrease(command.skuId(), command.count());
    } catch (Exception ex) {
        log.error("create order failed", ex);
        throw ex;
    }
}
```

如果必须 catch 后不抛：

```java
TransactionAspectSupport.currentTransactionStatus().setRollbackOnly();
```

但这会让代码和 Spring 事务强耦合，不建议作为常规写法。

## checked exception 默认不回滚

默认情况下：

```text
RuntimeException 回滚
Error 回滚
checked Exception 不回滚
```

所以项目里常见：

```java
@Transactional(rollbackFor = Exception.class)
public void importProducts(MultipartFile file) throws IOException {
    productMapper.insert(...);
    file.getInputStream().readAllBytes();
}
```

如果不写 `rollbackFor = Exception.class`，`IOException` 这类 checked exception 可能不会触发回滚。

更工程化的做法：

- 业务异常继承 `RuntimeException`。
- 对确实会抛 checked exception 的事务方法配置 `rollbackFor`。
- 不要为了省事让所有异常都在底层吞掉。

## private / final 方法

Spring 声明式事务基于代理。

不要把事务写在 private 方法上：

```java
@Transactional(rollbackFor = Exception.class)
private void createOrderInternal() {
    orderMapper.insert(order);
}
```

外部无法通过代理调用 private 方法，事务增强不会按预期生效。

同理，类或方法 `final` 也可能影响代理增强，尤其使用 CGLIB 代理时。

## Bean 没被 Spring 管理

错误：

```java
OrderService orderService = new OrderService(orderMapper);
orderService.create(command);
```

自己 `new` 出来的对象没有事务代理。

正确：

```java
@Service
public class OrderController {

    private final OrderService orderService;

    public OrderController(OrderService orderService) {
        this.orderService = orderService;
    }
}
```

让 Spring 注入 Bean。

## 数据库不支持事务

MySQL 表引擎如果不是 InnoDB，事务可能无效。

检查：

```sql
show table status where name = 'order_info';
```

应该看到：

```text
Engine = InnoDB
```

如果是 MyISAM，事务提交回滚都不是你想象的效果。

## 多线程和异步

错误理解：

```java
@Transactional(rollbackFor = Exception.class)
public void createOrder(CreateOrderCommand command) {
    orderMapper.insert(order);
    CompletableFuture.runAsync(() -> stockMapper.decrease(command.skuId(), command.count()));
    throw new BizException(ErrorCode.SYSTEM_ERROR);
}
```

异步线程不在当前事务里。

结果可能是：

```text
订单插入回滚
库存异步扣减已经提交
```

事务上下文通常绑定在线程上，不会自动跨线程传播。

需要异步时：

- 事务提交后发事件。
- MQ 异步处理。
- outbox 保证消息和本地事务一致。

## 多数据源事务管理器

多数据源时：

```java
@Transactional(transactionManager = "orderTransactionManager", rollbackFor = Exception.class)
public void createOrder(CreateOrderCommand command) {
    orderMapper.insert(order);
}
```

如果事务管理器用错，可能出现：

- 事务没管到当前数据源。
- 一个库回滚，另一个库提交。
- 以为是本地事务，实际跨库不一致。

跨库强一致不是普通 `@Transactional` 能解决的。优先用业务拆分、最终一致、MQ、outbox、TCC/Saga 等方案。

## 外部副作用不回滚

事务只管数据库连接上的操作。

这些不会跟着数据库回滚：

- RabbitMQ 消息。
- Redis 写入。
- HTTP 调第三方。
- 文件写入。
- 短信发送。

错误：

```java
@Transactional(rollbackFor = Exception.class)
public void createOrder(CreateOrderCommand command) {
    orderMapper.insert(order);
    rabbitTemplate.convertAndSend(exchange, routingKey, event);
    throw new BizException(ErrorCode.SYSTEM_ERROR);
}
```

数据库回滚了，消息可能已经发出。

正确方向：

- `afterCommit` 后发送。
- outbox 表记录事件。
- MQ 发送失败可重试。
- 消费端幂等。

## 排查事务是否生效

看日志：

```yaml
logging:
  level:
    org.springframework.transaction: DEBUG
```

看数据库：

- 业务失败后数据是否真的回滚。
- 表引擎是否支持事务。
- 是否多数据源。
- 是否异常被吞。
- 是否自调用。

最小验证：

```java
@Transactional(rollbackFor = Exception.class)
public void testRollback() {
    userMapper.insert(user);
    throw new RuntimeException("test rollback");
}
```

执行后查表，不应该有新增数据。

## 去空话检查

- [ ] 事务方法从外部 Bean 调用，避免自调用。
- [ ] 事务方法不吞异常。
- [ ] checked exception 配置了 `rollbackFor` 或转成业务异常。
- [ ] 表引擎支持事务。
- [ ] 异步线程不假装在同一个事务里。
- [ ] 多数据源明确 transactionManager。
- [ ] MQ、Redis、HTTP 不认为会跟着事务回滚。

## 参考

- [Spring Using @Transactional](https://docs.spring.io/spring-framework/reference/7.0/data-access/transaction/declarative/annotations.html)
- [Spring Transactional Javadoc](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/transaction/annotation/Transactional.html)
