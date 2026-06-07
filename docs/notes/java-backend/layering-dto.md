---
title: Java 后端分层与 DTO
sidebarTitle: 分层与 DTO
---

# Java 后端分层与 DTO

> 分层不是为了显得“架构感很强”，而是为了让 Controller、Service、Mapper 各做各的事，避免一个接口越写越烂。

## 先给结论

推荐基础分层：

```text
controller：接 HTTP，请求参数，返回 VO
service：业务流程，事务边界，调用下游
mapper/repository：数据库访问
domain/entity：业务对象或数据库对象
dto/request/command：入参对象
vo/response：出参对象
converter：对象转换
config：配置
common：通用能力
```

最容易写乱的是 Service。Service 应该组织业务流程，而不是把所有 SQL、缓存、MQ、第三方接口细节都堆进去。

## 常见对象类型

| 类型 | 用途 | 是否暴露给前端 |
| --- | --- | --- |
| `Request` | Controller 接收 HTTP 入参 | 是 |
| `Command` | Service 接收业务命令 | 否 |
| `VO` / `Response` | Controller 返回前端 | 是 |
| `DTO` | 服务之间传输数据 | 看场景 |
| `DO` / `Entity` | 数据库表映射 | 否 |
| `Domain` | 业务领域对象 | 否 |

不要直接把数据库 `Entity` 返回给前端。

问题：

- 暴露内部字段。
- 字段改名会影响接口。
- 可能包含敏感字段。
- 前端需要的字段不一定等于数据库字段。

## 包结构

小项目可以这样：

```text
org.example.flashmart
  common
    config
    exception
    web
  user
    controller
    service
    mapper
    entity
    request
    response
    converter
  order
    controller
    service
    mapper
    entity
    request
    response
    converter
```

比按技术大包更适合业务增长：

```text
controller
service
mapper
entity
```

按技术大包在模块多了之后会变成“所有 Controller 混在一起”。

## Controller 层

Controller 只负责 HTTP 边界：

```java
@RestController
@RequestMapping("/api/products")
public class ProductController {

    private final ProductService productService;

    public ProductController(ProductService productService) {
        this.productService = productService;
    }

    @PostMapping
    public ApiResult<Long> create(@Valid @RequestBody CreateProductRequest request) {
        Long productId = productService.create(request.toCommand());
        return ApiResult.success(productId);
    }
}
```

Controller 不做：

- 写 SQL。
- 开事务。
- 拼接复杂业务规则。
- 调用多个 Mapper。
- 直接操作 Redis/MQ。

## Request 和 Command

HTTP 入参：

```java
public record CreateProductRequest(
    @NotBlank String name,
    @NotNull Long categoryId,
    @NotNull BigDecimal price
) {
    public CreateProductCommand toCommand() {
        return new CreateProductCommand(name, categoryId, price);
    }
}
```

业务命令：

```java
public record CreateProductCommand(
    String name,
    Long categoryId,
    BigDecimal price
) {
}
```

为什么要分：

- Request 属于 HTTP。
- Command 属于业务。
- Service 不应该依赖 Web 入参细节。
- 后续 MQ、定时任务、RPC 调用也能复用 Command。

简单项目可以先不拆，但复杂接口建议拆。

## Service 层

Service 负责业务流程：

```java
@Service
public class ProductService {

    private final ProductMapper productMapper;
    private final ProductConverter productConverter;
    private final ProductCache productCache;

    public ProductService(ProductMapper productMapper,
                          ProductConverter productConverter,
                          ProductCache productCache) {
        this.productMapper = productMapper;
        this.productConverter = productConverter;
        this.productCache = productCache;
    }

    @Transactional(rollbackFor = Exception.class)
    public Long create(CreateProductCommand command) {
        ProductDO product = productConverter.toDO(command);
        productMapper.insert(product);
        productCache.evictCategory(command.categoryId());
        return product.getId();
    }
}
```

Service 应该能读成业务步骤：

```text
校验业务规则
保存核心数据
处理缓存 / 事件 / 日志
返回业务结果
```

如果一个 Service 方法超过很多屏，通常要拆：

- 领域服务。
- 策略类。
- 网关类。
- 事件发布器。
- 缓存组件。

## Mapper / Repository 层

Mapper 只做数据访问：

```java
@Mapper
public interface ProductMapper extends BaseMapper<ProductDO> {

    ProductDetailDO selectDetailById(@Param("productId") Long productId);
}
```

不要在 Mapper 里体现业务流程。

SQL 命名要表达查询目的：

```text
selectDetailById
selectPageByQuery
updateStatusByIdAndStatus
decreaseStock
```

条件更新要写在 Mapper 层：

```sql
update sku_stock
set available_stock = available_stock - #{count}
where sku_id = #{skuId}
  and available_stock >= #{count}
```

Service 根据受影响行数判断业务成功。

## Converter 层

转换不要散在各处：

```java
@Component
public class ProductConverter {

    public ProductDO toDO(CreateProductCommand command) {
        ProductDO product = new ProductDO();
        product.setName(command.name());
        product.setCategoryId(command.categoryId());
        product.setPrice(command.price());
        return product;
    }

    public ProductDetailVO toDetailVO(ProductDetailDO detail) {
        return new ProductDetailVO(
            detail.getId(),
            detail.getName(),
            detail.getPrice(),
            detail.getImageUrls()
        );
    }
}
```

转换层适合处理：

- DO -> VO。
- Request -> Command。
- 多表查询结果 -> 页面 VO。
- 枚举展示文案。

不要把转换逻辑夹在 Controller 和 Service 里到处复制。

## 事务边界

事务通常放在 Service：

```java
@Transactional(rollbackFor = Exception.class)
public void pay(Long orderId, Long userId) {
    OrderDO order = orderMapper.selectById(orderId);
    orderPayValidator.validate(order, userId);
    orderMapper.updateStatus(orderId, OrderStatus.PAID);
    paymentMapper.insert(buildPayment(order));
}
```

不要放在 Controller：

- Controller 是 HTTP 层。
- 事务范围容易被接口细节污染。
- 不利于复用业务方法。

不要放在 Mapper：

- Mapper 只是一条或几条 SQL。
- 业务事务通常跨多个 Mapper。

## 外部副作用要隔离

Service 里常见副作用：

- 发 MQ。
- 删 Redis。
- 调第三方支付。
- 发送短信。

不要把副作用混在事务中随手执行。

例如 MQ 发送：

```java
@Transactional(rollbackFor = Exception.class)
public Long createOrder(CreateOrderCommand command) {
    OrderDO order = orderFactory.create(command);
    orderMapper.insert(order);

    TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
        @Override
        public void afterCommit() {
            orderEventPublisher.publishCreated(order.getId());
        }
    });

    return order.getId();
}
```

事务提交后再发，避免数据库回滚但消息已经发出。

## 模块之间怎么调用

同一个单体项目内：

```text
order.service -> product.service
```

可以，但要避免双向调用。

不推荐：

```text
OrderService -> ProductService
ProductService -> OrderService
```

这通常会导致循环依赖。

更好的方式：

- 抽公共查询组件。
- 用领域事件。
- 拆出防腐层。
- 只暴露必要的应用服务接口。

## 去空话检查

- [ ] Controller 只处理 HTTP 边界。
- [ ] Service 负责业务流程和事务边界。
- [ ] Mapper 只负责数据访问。
- [ ] Entity 不直接返回前端。
- [ ] Request 和 Command 在复杂场景分开。
- [ ] 转换逻辑有 Converter 收口。
- [ ] 外部副作用放到 afterCommit、事件或独立组件里。
