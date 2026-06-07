---
title: Spring 事务传播行为
sidebarTitle: 事务传播行为
---

# Spring 事务传播行为

> 事务传播行为解决的是：一个 `@Transactional` 方法调用另一个 `@Transactional` 方法时，到底用同一个事务，还是开新事务，还是必须没有事务。

## 先给结论

最常用：

| 传播行为 | 直觉理解 | 常见用途 |
| --- | --- | --- |
| `REQUIRED` | 有事务就加入，没有就新建 | 默认，绝大多数业务 |
| `REQUIRES_NEW` | 暂停外层事务，自己开新事务 | 独立记录日志、outbox、失败记录 |
| `NESTED` | 嵌套事务，依赖保存点 | 局部回滚，使用前先确认数据库和事务管理器支持 |
| `MANDATORY` | 必须已有事务 | 强制某方法只能在事务内调用 |
| `SUPPORTS` | 有事务就加入，没有也能跑 | 只读查询 |
| `NOT_SUPPORTED` | 挂起事务，非事务执行 | 不想占用事务的慢操作 |
| `NEVER` | 有事务就报错 | 禁止在事务内执行 |

默认是：

```java
@Transactional(propagation = Propagation.REQUIRED)
```

## REQUIRED

默认传播行为。

```java
@Transactional(rollbackFor = Exception.class)
public void createOrder(CreateOrderCommand command) {
    orderMapper.insert(order);
    stockService.decrease(command.skuId(), command.count());
}
```

如果 `stockService.decrease()` 也是 `REQUIRED`：

```java
@Transactional(rollbackFor = Exception.class)
public void decrease(Long skuId, Integer count) {
    stockMapper.decrease(skuId, count);
}
```

调用链：

```text
createOrder 开启事务 T1
  -> decrease 加入事务 T1
  -> 任一方法抛出回滚异常
  -> T1 整体回滚
```

适合绝大多数“一个业务动作要么都成功，要么都失败”的场景。

## REQUIRES_NEW

`REQUIRES_NEW` 会开一个独立事务。

```java
@Transactional(rollbackFor = Exception.class)
public void createOrder(CreateOrderCommand command) {
    orderMapper.insert(order);
    auditService.recordCreateOrder(order.getId());
    throw new BizException(ErrorCode.SYSTEM_ERROR);
}
```

审计服务：

```java
@Transactional(propagation = Propagation.REQUIRES_NEW, rollbackFor = Exception.class)
public void recordCreateOrder(Long orderId) {
    auditLogMapper.insert(buildAuditLog(orderId));
}
```

结果：

```text
外层订单事务 T1 回滚
审计日志事务 T2 已提交
```

适合：

- 记录失败日志。
- 记录审计流水。
- 写 outbox。
- 保存重试任务。

不适合：

- 核心业务数据必须和外层一起回滚的场景。
- 被误用后会造成“主业务失败，但子数据提交”。

## NESTED

`NESTED` 是嵌套事务，常见依赖数据库保存点。

理解：

```text
外层事务 T1
  -> 创建保存点 S1
  -> 内层失败，回滚到 S1
  -> 外层还可以继续
```

示例：

```java
@Transactional(rollbackFor = Exception.class)
public void importProducts(List<ProductImportRow> rows) {
    for (ProductImportRow row : rows) {
        try {
            productImportItemService.importOne(row);
        } catch (BizException ex) {
            importErrorMapper.insert(buildError(row, ex));
        }
    }
}
```

内层：

```java
@Transactional(propagation = Propagation.NESTED, rollbackFor = Exception.class)
public void importOne(ProductImportRow row) {
    productMapper.insert(convert(row));
    productImageMapper.insertBatch(convertImages(row));
}
```

注意：

- 不是所有事务管理器都支持。
- 行为和数据库、驱动、事务管理器有关。
- 使用前要写测试确认。

如果不确定，批量导入更常见是每条独立 `REQUIRES_NEW` 或拆成任务。

## MANDATORY

必须在已有事务中执行。

```java
@Transactional(propagation = Propagation.MANDATORY, rollbackFor = Exception.class)
public void decreaseStock(Long skuId, Integer count) {
    stockMapper.decrease(skuId, count);
}
```

如果没有外层事务就调用，会直接报错。

适合：

- 强制库存扣减必须属于某个业务事务。
- 防止别人单独调用底层写方法。

但不要滥用，否则普通复用会很痛苦。

## SUPPORTS

有事务就加入，没有事务也能执行。

```java
@Transactional(propagation = Propagation.SUPPORTS, readOnly = true)
public ProductDetailVO getDetail(Long productId) {
    return productMapper.selectDetail(productId);
}
```

适合只读查询。

但要注意：

- 没事务时可能每条 SQL 单独连接/自动提交。
- 多次查询之间不保证同一个事务视图。
- 强一致读还是要明确事务边界。

## NOT_SUPPORTED

如果当前有事务，先挂起，非事务执行。

适合事务里不想包含的慢操作：

```java
@Transactional(rollbackFor = Exception.class)
public void createOrder(CreateOrderCommand command) {
    orderMapper.insert(order);
    pricingQueryService.queryPromotion(command);
}
```

```java
@Transactional(propagation = Propagation.NOT_SUPPORTED)
public PromotionResult queryPromotion(CreateOrderCommand command) {
    return promotionClient.query(command);
}
```

但更推荐：外部调用尽量放在事务前，或者事务提交后异步处理，不要让事务边界绕来绕去。

## NEVER

有事务就报错。

```java
@Transactional(propagation = Propagation.NEVER)
public void callSlowReportApi() {
    reportClient.generate();
}
```

适合明确禁止事务内调用的慢操作。

实际项目里用得少。

## 传播行为和代理

事务传播只有经过 Spring 代理调用才生效。

错误：

```java
@Service
public class OrderService {

    @Transactional(rollbackFor = Exception.class)
    public void create() {
        saveAuditLog();
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW, rollbackFor = Exception.class)
    public void saveAuditLog() {
        auditLogMapper.insert(...);
    }
}
```

`this.saveAuditLog()` 是自调用，不经过代理，`REQUIRES_NEW` 不生效。

正确：

```java
@Service
public class OrderService {

    private final AuditLogService auditLogService;

    public OrderService(AuditLogService auditLogService) {
        this.auditLogService = auditLogService;
    }

    @Transactional(rollbackFor = Exception.class)
    public void create() {
        auditLogService.saveAuditLog();
    }
}
```

## 使用建议

| 场景 | 建议 |
| --- | --- |
| 普通创建订单 | `REQUIRED` |
| 支付成功更新订单和支付流水 | `REQUIRED` |
| 主事务失败也要记录失败日志 | `REQUIRES_NEW` |
| 批量导入单条失败不影响整体 | 评估 `NESTED` 或每条独立事务 |
| 底层写方法必须在事务内 | `MANDATORY` |
| 普通查询 | 不加事务或 `SUPPORTS + readOnly` |
| 事务中调用慢外部接口 | 优先移出事务，不优先靠传播行为补 |

## 去空话检查

- [ ] 默认 `REQUIRED` 能解释清楚。
- [ ] `REQUIRES_NEW` 知道会独立提交。
- [ ] `NESTED` 使用前确认保存点支持。
- [ ] 传播行为不会在自调用里生效。
- [ ] 外部慢调用不随便放进事务。
- [ ] 不为了“高级”乱用传播行为。

## 参考

- [Spring Transaction Propagation](https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/tx-propagation.html)
- [Spring Propagation Javadoc](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/transaction/annotation/Propagation.html)
