---
title: Spring 事务回滚规则
sidebarTitle: Spring 事务回滚
---

# Spring 事务回滚规则

`@Transactional(rollbackFor = Exception.class)` 最常被用来解决一个问题：

**Spring 默认不会因为受检异常（checked exception）回滚事务。**

所以这行注解不是“让事务生效”，而是明确告诉 Spring：

```java
@Transactional(rollbackFor = Exception.class)
```

只要方法里抛出 `Exception` 及其子类，并且异常能从事务方法抛出去，就把当前事务标记为回滚。

## 先给结论

Spring 声明式事务默认规则：

| 异常类型 | 默认是否回滚 |
| --- | --- |
| `RuntimeException` | 回滚 |
| `Error` | 回滚 |
| checked `Exception` | 不回滚 |

加上：

```java
@Transactional(rollbackFor = Exception.class)
```

之后：

| 异常类型 | 是否回滚 |
| --- | --- |
| `RuntimeException` | 回滚 |
| `Error` | 回滚 |
| checked `Exception` | 回滚 |

但它有几个前提：

1. 方法必须被 Spring 事务代理拦截到。
2. 异常不能在方法内部被吞掉。
3. 数据库操作必须走同一个事务管理器。
4. 事务只绑定当前线程，普通新线程里的操作不会自动加入当前事务。

## 一个最小例子

假设有一个下单方法：

```java
@Service
public class OrderService {

    private final OrderRepository orderRepository;
    private final AccountRepository accountRepository;

    public OrderService(OrderRepository orderRepository, AccountRepository accountRepository) {
        this.orderRepository = orderRepository;
        this.accountRepository = accountRepository;
    }

    @Transactional(rollbackFor = Exception.class)
    public void createOrder(CreateOrderCommand command) throws Exception {
        orderRepository.save(command.toOrder());
        accountRepository.freezeBalance(command.userId(), command.amount());

        if (command.amount().compareTo(BigDecimal.ZERO) <= 0) {
            throw new Exception("订单金额必须大于 0");
        }
    }
}
```

这里如果抛出的是 checked `Exception`：

```java
throw new Exception("订单金额必须大于 0");
```

因为方法上写了：

```java
@Transactional(rollbackFor = Exception.class)
```

所以前面的：

```java
orderRepository.save(...)
accountRepository.freezeBalance(...)
```

都会回滚。

如果没有 `rollbackFor = Exception.class`，这个 checked exception 默认不会触发回滚。

## 为什么默认不回滚 checked exception

Spring 默认只对：

- `RuntimeException`
- `Error`

做回滚。

checked exception 在 Java 里经常被当成“业务上可预期、可恢复”的异常。
所以 Spring 默认认为它不一定代表事务失败。

例如：

```java
public void importUser() throws FileNotFoundException {
    // 文件不存在不一定意味着数据库操作必须回滚
}
```

但在很多后端业务里，checked exception 也可能表示整个业务动作失败：

```java
public void createOrder() throws OrderCreateException {
    // 下单失败，前面所有数据库写入都应该回滚
}
```

这种场景就要显式配置 `rollbackFor`。

## `rollbackFor = Exception.class` 到底匹配什么

`rollbackFor` 是按异常类型匹配的。

```java
@Transactional(rollbackFor = Exception.class)
```

表示：

```text
Exception.class 以及 Exception 的所有子类都触发回滚
```

包括：

- `IOException`
- `SQLException`
- 自定义 checked exception
- `RuntimeException`

因为 `RuntimeException` 也是 `Exception` 的子类。

但注意：

```text
Error 不是 Exception 的子类
```

不过 Spring 默认本来就会对 `Error` 回滚，所以通常不用额外写：

```java
rollbackFor = Throwable.class
```

一般业务代码里不建议无脑用 `Throwable.class`，否则一些严重错误也会被当成普通业务异常处理，反而容易掩盖问题。

## 推荐写在 Service 方法上

事务边界一般放在业务用例方法上：

```java
@Service
public class PaymentService {

    @Transactional(rollbackFor = Exception.class)
    public void pay(PayCommand command) throws PayException {
        createPayOrder(command);
        deductBalance(command);
        updateOrderStatus(command);
    }
}
```

不要把事务边界放得太细：

```java
@Transactional
public void createPayOrder(...) {}

@Transactional
public void deductBalance(...) {}

@Transactional
public void updateOrderStatus(...) {}
```

如果每个小方法自己开边界，调用链一复杂，就很难看出“这次业务动作到底应该整体提交，还是整体回滚”。

更推荐：

```text
一个完整业务动作 = 一个清晰事务边界
```

例如：

- 创建订单
- 支付成功
- 取消订单
- 审核通过
- 发起退款

## 不要吞异常

这个写法不会回滚：

```java
@Transactional(rollbackFor = Exception.class)
public void createOrder(CreateOrderCommand command) {
    try {
        orderRepository.save(command.toOrder());
        accountRepository.freezeBalance(command.userId(), command.amount());
        remoteRiskService.check(command.userId());
    } catch (Exception exception) {
        log.error("create order failed", exception);
    }
}
```

原因是异常被 catch 住了。
事务方法最后正常返回，Spring 会认为可以提交。

如果 catch 以后仍然希望回滚，要重新抛出：

```java
@Transactional(rollbackFor = Exception.class)
public void createOrder(CreateOrderCommand command) throws Exception {
    try {
        orderRepository.save(command.toOrder());
        accountRepository.freezeBalance(command.userId(), command.amount());
        remoteRiskService.check(command.userId());
    } catch (Exception exception) {
        log.error("create order failed", exception);
        throw exception;
    }
}
```

或者转换成业务异常：

```java
@Transactional(rollbackFor = Exception.class)
public void createOrder(CreateOrderCommand command) throws OrderCreateException {
    try {
        orderRepository.save(command.toOrder());
        accountRepository.freezeBalance(command.userId(), command.amount());
        remoteRiskService.check(command.userId());
    } catch (Exception exception) {
        throw new OrderCreateException("创建订单失败", exception);
    }
}
```

## 如果必须 catch 后不抛

不推荐，但有时确实会遇到：方法需要返回一个统一结果对象，又不能向外抛异常。

这时可以手动标记回滚：

```java
@Transactional(rollbackFor = Exception.class)
public Result<Void> createOrder(CreateOrderCommand command) {
    try {
        orderRepository.save(command.toOrder());
        accountRepository.freezeBalance(command.userId(), command.amount());
        remoteRiskService.check(command.userId());
        return Result.success();
    } catch (Exception exception) {
        TransactionAspectSupport.currentTransactionStatus().setRollbackOnly();
        log.error("create order failed", exception);
        return Result.fail("创建订单失败");
    }
}
```

但这会让业务代码直接依赖 Spring 事务 API。
更干净的方式还是抛异常，让事务框架处理回滚。

## 自调用会让事务失效

这个写法很常见，但事务不会按你想的生效：

```java
@Service
public class OrderService {

    public void submit(CreateOrderCommand command) throws Exception {
        createOrder(command);
    }

    @Transactional(rollbackFor = Exception.class)
    public void createOrder(CreateOrderCommand command) throws Exception {
        orderRepository.save(command.toOrder());
        throw new Exception("创建失败");
    }
}
```

问题在这里：

```java
createOrder(command);
```

这是同一个对象内部方法调用，没有经过 Spring 代理。
`@Transactional` 是靠代理拦截方法调用来开启事务的，绕过代理就不会进入事务增强逻辑。

更稳的写法是让外部 Bean 调用事务方法：

```java
@Service
public class OrderApplicationService {

    private final OrderService orderService;

    public OrderApplicationService(OrderService orderService) {
        this.orderService = orderService;
    }

    public void submit(CreateOrderCommand command) throws Exception {
        orderService.createOrder(command);
    }
}
```

```java
@Service
public class OrderService {

    @Transactional(rollbackFor = Exception.class)
    public void createOrder(CreateOrderCommand command) throws Exception {
        orderRepository.save(command.toOrder());
        throw new Exception("创建失败");
    }
}
```

## 方法可见性也要注意

事务注解尽量放在 `public` 方法上。

```java
@Transactional(rollbackFor = Exception.class)
public void createOrder(...) {
}
```

不要指望下面这种私有方法事务生效：

```java
private void createOrder(...) {
}
```

Spring 事务通常通过代理拦截外部方法调用。
私有方法、同类内部调用、构造方法里的调用，都不适合作为事务边界。

## `rollbackFor` 和 `noRollbackFor`

有时你希望大部分异常都回滚，但某个业务异常不回滚。

例如库存不足只是业务校验失败，不需要回滚前面的审计记录：

```java
@Transactional(
        rollbackFor = Exception.class,
        noRollbackFor = InsufficientStockException.class
)
public void createOrder(CreateOrderCommand command) throws Exception {
    auditRepository.save(command.toAuditLog());
    stockService.check(command.skuId(), command.quantity());
}
```

如果抛出：

```java
throw new InsufficientStockException();
```

Spring 会优先匹配更具体的规则。
也就是说，`noRollbackFor = InsufficientStockException.class` 会覆盖更宽泛的 `rollbackFor = Exception.class`。

## 不建议用字符串形式

优先用：

```java
@Transactional(rollbackFor = OrderCreateException.class)
```

少用：

```java
@Transactional(rollbackForClassName = "OrderCreateException")
```

字符串规则是按异常类名模式匹配，容易误伤类似名字的异常。

例如：

```text
CustomException
CustomExceptionV2
CustomException$NestedException
```

都可能被模式规则匹配到。

类型写法更安全，也更容易重构。

## 事务只管数据库，不管外部副作用

这个方法即使数据库回滚，短信也不会自动撤回：

```java
@Transactional(rollbackFor = Exception.class)
public void createOrder(CreateOrderCommand command) throws Exception {
    orderRepository.save(command.toOrder());
    smsClient.send(command.phone(), "下单成功");
    throw new Exception("后续处理失败");
}
```

事务只能回滚参与同一个事务管理器的资源，例如数据库连接。

它不能回滚：

- 已发送短信
- 已发 MQ
- 已调用第三方 HTTP 接口
- 已写本地文件
- 已调用另一个服务里的数据库

所以事务方法里要慎重放外部副作用。

更稳的方式：

```text
本地事务提交成功
  -> 记录事件 / outbox
  -> 事务后发送 MQ / 短信 / 调第三方
```

这类场景不要只靠 `@Transactional` 想当然兜住。

## 多数据源要指定事务管理器

如果项目里有多个数据源，事务要明确用哪个 `transactionManager`：

```java
@Transactional(
        transactionManager = "orderTransactionManager",
        rollbackFor = Exception.class
)
public void createOrder(CreateOrderCommand command) throws Exception {
    orderRepository.save(command.toOrder());
}
```

否则可能出现：

- 方法看起来有事务
- 实际用了另一个事务管理器
- 某些数据库操作没有加入当前事务

多个数据库要一起回滚，不是简单写一个 `rollbackFor = Exception.class` 就能解决。
那已经是分布式事务或最终一致性问题。

## 新线程和异步方法不会自动加入当前事务

Spring 的普通事务通常绑定当前线程。

这个写法要小心：

```java
@Transactional(rollbackFor = Exception.class)
public void createOrder(CreateOrderCommand command) {
    orderRepository.save(command.toOrder());

    CompletableFuture.runAsync(() -> {
        orderLogRepository.save(command.toLog());
    });

    throw new RuntimeException("创建失败");
}
```

`CompletableFuture` 里的数据库操作不在当前事务线程里。
外层回滚，不代表异步线程里的操作也一定回滚。

如果需要事务一致性，不要把同一事务里的数据库写入拆到普通异步线程里。

## 常用写法

### 业务写方法

```java
@Transactional(rollbackFor = Exception.class)
public void updateOrderStatus(UpdateOrderStatusCommand command) throws OrderException {
    orderRepository.updateStatus(command.orderId(), command.status());
    orderLogRepository.save(command.toLog());
}
```

### 只读查询

```java
@Transactional(readOnly = true)
public OrderDetail getOrderDetail(Long orderId) {
    return orderRepository.findDetail(orderId);
}
```

只读事务不需要写 `rollbackFor = Exception.class`。
它主要表达这是查询场景，并给事务管理器和数据库驱动一个只读提示。

### 明确业务异常

```java
@Transactional(rollbackFor = OrderCreateException.class)
public void createOrder(CreateOrderCommand command) throws OrderCreateException {
    try {
        orderRepository.save(command.toOrder());
        accountRepository.freezeBalance(command.userId(), command.amount());
    } catch (Exception exception) {
        throw new OrderCreateException("创建订单失败", exception);
    }
}
```

如果项目异常体系比较清楚，优先回滚自己的业务异常，而不是所有 `Exception`。

## 常见失效场景

### 1. 方法不是 Spring Bean 的方法

```java
new OrderService().createOrder(command);
```

手动 `new` 出来的对象不受 Spring 代理管理。

### 2. 同类内部调用

```java
this.createOrder(command);
```

没有经过代理。

### 3. 异常被 catch 后吞掉

```java
catch (Exception exception) {
    log.error("failed", exception);
}
```

方法正常返回，事务提交。

### 4. 抛出的异常不匹配回滚规则

默认 checked exception 不回滚。
需要 `rollbackFor`。

### 5. 数据库表不支持事务

例如 MySQL 里如果用了不支持事务的存储引擎，Spring 事务也救不了。

### 6. 跨线程执行

事务上下文不会自动传到普通新线程。

### 7. 外部副作用已经发生

数据库回滚不等于短信、MQ、HTTP 调用也回滚。

## 检查清单

写事务方法时可以按这个顺序看：

- 这个方法是不是一个完整业务动作？
- 它是不是 Spring Bean 的 `public` 方法？
- 调用它时有没有经过 Spring 代理？
- 抛出的异常是否能从方法冒出去？
- checked exception 是否需要 `rollbackFor`？
- 是否有 `catch` 后吞异常？
- 是否涉及多个事务管理器？
- 是否在事务里开了新线程？
- 是否在事务里做了不可回滚的外部副作用？
- 是否需要把 MQ / 短信 / HTTP 调用放到事务提交之后？

如果这些问题没想清楚，先不要只靠：

```java
@Transactional(rollbackFor = Exception.class)
```

来赌事务一定会按预期回滚。

## 最后记一句话

`@Transactional(rollbackFor = Exception.class)` 的核心作用是：

**把 checked exception 也纳入 Spring 事务回滚规则。**

但事务能不能真的回滚，还要看代理有没有生效、异常有没有抛出、资源有没有加入同一个事务，以及外部副作用是不是已经发生。

## 参考

- [Spring Framework Reference：Using `@Transactional`](https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/annotations.html)
- [Spring Framework Reference：Rolling Back a Declarative Transaction](https://docs.enterprise.spring.io/spring-framework/reference/data-access/transaction/declarative/rolling-back.html)
- [Spring Framework Javadoc：`@Transactional`](https://docs.spring.io/spring-framework/docs/6.2.8/javadoc-api/org/springframework/transaction/annotation/Transactional.html)
