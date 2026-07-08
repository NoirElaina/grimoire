---
title: Java Stream 使用笔记
sidebarTitle: Java Stream
---

# Java Stream 使用笔记

Java Stream 适合处理“集合里的数据流转”：

```text
List<T>
  -> filter
  -> map
  -> sorted
  -> collect
```

它不是为了替代所有 `for` 循环，而是让“筛选、转换、分组、聚合”这些集合操作更清楚。

## Stream 的执行模型

Stream 操作分两类：

| 类型 | 示例 | 是否立刻执行 |
| --- | --- | --- |
| 中间操作 | `filter`、`map`、`sorted`、`distinct` | 不立刻执行 |
| 终止操作 | `collect`、`toList`、`count`、`forEach` | 触发执行 |

例如：

```java
List<Long> ids = users.stream()
        .filter(user -> user.getStatus() == UserStatus.ENABLED)
        .map(User::getId)
        .toList();
```

真正开始遍历集合的是最后的：

```java
toList()
```

前面的 `filter`、`map` 只是描述流水线。

## `filter`：筛选

只保留符合条件的数据：

```java
List<Order> paidOrders = orders.stream()
        .filter(order -> order.getStatus() == OrderStatus.PAID)
        .toList();
```

多个条件不要全挤在一行里：

```java
List<Order> validOrders = orders.stream()
        .filter(order -> order.getStatus() == OrderStatus.PAID)
        .filter(order -> order.getAmount().compareTo(BigDecimal.ZERO) > 0)
        .filter(order -> order.getDeleted() == Boolean.FALSE)
        .toList();
```

如果条件很复杂，抽成方法：

```java
List<Order> validOrders = orders.stream()
        .filter(this::isValidPaidOrder)
        .toList();
```

```java
private boolean isValidPaidOrder(Order order) {
    return order.getStatus() == OrderStatus.PAID
            && order.getAmount().compareTo(BigDecimal.ZERO) > 0
            && order.getDeleted() == Boolean.FALSE;
}
```

## `map`：对象转换

`map` 用来把一种对象转成另一种对象。

例如 Entity 转 VO：

```java
List<OrderVO> orderVOList = orders.stream()
        .map(order -> new OrderVO(
                order.getId(),
                order.getOrderNo(),
                order.getStatus().name(),
                order.getAmount()
        ))
        .toList();
```

如果转换逻辑重复出现，抽成静态工厂：

```java
List<OrderVO> orderVOList = orders.stream()
        .map(OrderVO::from)
        .toList();
```

```java
public record OrderVO(
        Long id,
        String orderNo,
        String status,
        BigDecimal amount
) {
    public static OrderVO from(Order order) {
        return new OrderVO(
                order.getId(),
                order.getOrderNo(),
                order.getStatus().name(),
                order.getAmount()
        );
    }
}
```

这样 Service 里就不会堆一坨字段映射。

## `flatMap`：把多层集合摊平

如果每个订单都有多个商品：

```java
public class Order {
    private List<OrderItem> items;
}
```

想拿到所有商品：

```java
List<OrderItem> allItems = orders.stream()
        .flatMap(order -> order.getItems().stream())
        .toList();
```

如果可能为 `null`，先兜底：

```java
List<OrderItem> allItems = orders.stream()
        .flatMap(order -> Optional.ofNullable(order.getItems())
                .orElseGet(List::of)
                .stream())
        .toList();
```

`map` 和 `flatMap` 的区别：

| 写法 | 结果 |
| --- | --- |
| `map(order -> order.getItems())` | `Stream<List<OrderItem>>` |
| `flatMap(order -> order.getItems().stream())` | `Stream<OrderItem>` |

## 提取 ID 列表

后端最常见的 Stream 用法之一：

```java
List<Long> userIds = orders.stream()
        .map(Order::getUserId)
        .filter(Objects::nonNull)
        .distinct()
        .toList();
```

通常用于下一步批量查询：

```java
Map<Long, User> userMap = userRepository.findByIds(userIds).stream()
        .collect(Collectors.toMap(User::getId, Function.identity()));
```

注意：能批量查就不要在 Stream 里逐条查数据库。

错误示例：

```java
List<UserVO> users = orders.stream()
        .map(order -> userRepository.findById(order.getUserId()))
        .map(UserVO::from)
        .toList();
```

这会变成 N 次数据库查询。

更稳的写法：

```java
List<Long> userIds = orders.stream()
        .map(Order::getUserId)
        .filter(Objects::nonNull)
        .distinct()
        .toList();

Map<Long, User> userMap = userRepository.findByIds(userIds).stream()
        .collect(Collectors.toMap(User::getId, Function.identity()));

List<UserVO> users = orders.stream()
        .map(order -> userMap.get(order.getUserId()))
        .filter(Objects::nonNull)
        .map(UserVO::from)
        .toList();
```

## `toMap`：注意重复 key

这个写法很容易炸：

```java
Map<Long, Order> orderMap = orders.stream()
        .collect(Collectors.toMap(Order::getId, Function.identity()));
```

如果 `id` 重复，会抛异常。

更安全的写法是显式指定合并规则：

```java
Map<Long, Order> orderMap = orders.stream()
        .collect(Collectors.toMap(
                Order::getId,
                Function.identity(),
                (oldValue, newValue) -> newValue
        ));
```

如果你希望保留旧值：

```java
Map<Long, Order> orderMap = orders.stream()
        .collect(Collectors.toMap(
                Order::getId,
                Function.identity(),
                (oldValue, newValue) -> oldValue
        ));
```

如果顺序重要，用 `LinkedHashMap`：

```java
Map<Long, Order> orderMap = orders.stream()
        .collect(Collectors.toMap(
                Order::getId,
                Function.identity(),
                (oldValue, newValue) -> oldValue,
                LinkedHashMap::new
        ));
```

## `groupingBy`：分组

按订单状态分组：

```java
Map<OrderStatus, List<Order>> ordersByStatus = orders.stream()
        .collect(Collectors.groupingBy(Order::getStatus));
```

按用户分组：

```java
Map<Long, List<Order>> ordersByUserId = orders.stream()
        .collect(Collectors.groupingBy(Order::getUserId));
```

分组后统计数量：

```java
Map<OrderStatus, Long> countByStatus = orders.stream()
        .collect(Collectors.groupingBy(
                Order::getStatus,
                Collectors.counting()
        ));
```

分组后求金额：

```java
Map<OrderStatus, BigDecimal> amountByStatus = orders.stream()
        .collect(Collectors.groupingBy(
                Order::getStatus,
                Collectors.mapping(
                        Order::getAmount,
                        Collectors.reducing(BigDecimal.ZERO, BigDecimal::add)
                )
        ));
```

如果分组逻辑开始变复杂，不要硬塞一条 Stream，可以拆成普通循环，代码会更清楚。

## `reduce`：聚合

求订单总金额：

```java
BigDecimal totalAmount = orders.stream()
        .map(Order::getAmount)
        .filter(Objects::nonNull)
        .reduce(BigDecimal.ZERO, BigDecimal::add);
```

不要用 `double` 处理金额：

```java
double total = orders.stream()
        .mapToDouble(order -> order.getAmount().doubleValue())
        .sum();
```

金额用 `BigDecimal`，别让精度偷偷漏水。

## `sorted`：排序

按创建时间倒序：

```java
List<Order> sortedOrders = orders.stream()
        .sorted(Comparator.comparing(Order::getCreatedAt).reversed())
        .toList();
```

处理可能为 `null` 的字段：

```java
List<Order> sortedOrders = orders.stream()
        .sorted(Comparator.comparing(
                Order::getPaidAt,
                Comparator.nullsLast(Comparator.naturalOrder())
        ))
        .toList();
```

注意：如果数据量很大，优先让数据库排序，而不是查出来后在 JVM 里排。

## `anyMatch`、`allMatch`、`noneMatch`

判断是否存在待支付订单：

```java
boolean hasPendingOrder = orders.stream()
        .anyMatch(order -> order.getStatus() == OrderStatus.PENDING);
```

判断是否全部已支付：

```java
boolean allPaid = orders.stream()
        .allMatch(order -> order.getStatus() == OrderStatus.PAID);
```

判断是否没有失败订单：

```java
boolean noFailedOrder = orders.stream()
        .noneMatch(order -> order.getStatus() == OrderStatus.FAILED);
```

这三个方法会短路。
也就是说，一旦结果确定，就不会继续遍历后面的元素。

## `findFirst` 和 `findAny`

取第一个符合条件的订单：

```java
Optional<Order> firstPaidOrder = orders.stream()
        .filter(order -> order.getStatus() == OrderStatus.PAID)
        .findFirst();
```

通常业务代码里优先用 `findFirst`，语义更稳定。
`findAny` 更偏并行流场景，不保证一定拿到第一个。

拿值时不要直接：

```java
Order order = firstPaidOrder.get();
```

更稳：

```java
Order order = firstPaidOrder.orElseThrow(() -> new BizException("订单不存在"));
```

## `peek` 不要写业务逻辑

`peek` 适合临时调试：

```java
orders.stream()
        .peek(order -> log.info("order id: {}", order.getId()))
        .filter(order -> order.getStatus() == OrderStatus.PAID)
        .toList();
```

不要这样写：

```java
orders.stream()
        .peek(order -> order.setStatus(OrderStatus.PAID))
        .toList();
```

`peek` 的语义是“看一眼”，不是业务修改。
要改对象状态时，用普通循环往往更直接。

## `forEach`：适合终止遍历，不适合复杂编排

可以用于简单动作：

```java
orders.forEach(order -> log.info("order: {}", order.getOrderNo()));
```

但不要把复杂业务塞进去：

```java
orders.stream().forEach(order -> {
    orderRepository.updateStatus(order.getId(), OrderStatus.PAID);
    mqProducer.send(order);
    remoteClient.notify(order);
});
```

这种代码的问题是：

- 事务边界不清楚
- 异常处理不清楚
- 重试和补偿不清楚
- 可读性不如显式循环

复杂业务用普通循环更稳：

```java
for (Order order : orders) {
    payOrder(order);
}
```

## `parallelStream` 不要随便用

`parallelStream` 会把任务拆到公共线程池里执行。

看起来很香：

```java
orders.parallelStream()
        .map(this::buildOrderVO)
        .toList();
```

但后端项目里要非常谨慎，尤其不要在里面做：

- 数据库查询
- HTTP 调用
- MQ 发送
- 依赖事务上下文的操作
- 修改共享集合

错误示例：

```java
orders.parallelStream()
        .forEach(order -> orderRepository.updateStatus(order.getId(), OrderStatus.PAID));
```

问题：

- 事务上下文不一定符合预期
- 数据库连接池可能被打爆
- 异常收集和定位更麻烦
- 共享资源容易并发问题

一般经验：

```text
CPU 纯计算、无副作用、数据量足够大 -> 可以评估 parallelStream
IO 操作、事务、远程调用、共享状态 -> 不要随便用
```

## 空集合和 null

优先让方法返回空集合，不要返回 `null`：

```java
public List<Order> listOrders(Long userId) {
    return orderRepository.findByUserId(userId);
}
```

如果上游可能返回 `null`，先兜底：

```java
List<OrderVO> orderVOList = Optional.ofNullable(orders)
        .orElseGet(List::of)
        .stream()
        .map(OrderVO::from)
        .toList();
```

集合里的字段也可能为 `null`：

```java
List<Long> userIds = orders.stream()
        .map(Order::getUserId)
        .filter(Objects::nonNull)
        .distinct()
        .toList();
```

Stream 不会自动帮你处理 null。

## `toList()` 和 `Collectors.toList()`

Java 16 之后可以直接：

```java
List<Long> ids = orders.stream()
        .map(Order::getId)
        .toList();
```

注意：`Stream.toList()` 返回的 List 不保证可变。

如果后面还要 `add`：

```java
List<Long> ids = new ArrayList<>(orders.stream()
        .map(Order::getId)
        .toList());
```

如果项目还在 Java 8，使用：

```java
List<Long> ids = orders.stream()
        .map(Order::getId)
        .collect(Collectors.toList());
```

## 检查清单

写 Stream 前先问：

- 这段逻辑是不是纯集合加工？
- 有没有数据库查询、HTTP、MQ 这类副作用？
- 是否可能出现 null？
- `toMap` 的 key 会不会重复？
- 排序、分页能不能交给数据库？
- Stream 链是不是太长？
- 这段代码用普通循环会不会更清楚？
- 有没有误用 `parallelStream`？

如果答案开始含糊，别硬写 Stream。可读性比炫技重要。
