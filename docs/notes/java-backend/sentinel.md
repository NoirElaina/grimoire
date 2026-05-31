---
title: Sentinel 使用笔记
sidebarTitle: Sentinel
---

# Sentinel 使用笔记

Sentinel 用来做运行时流量治理：

```text
请求进入资源
  -> Sentinel 判断规则
  -> 通过 / 限流 / 熔断 / 降级
```

这篇不讲“Sentinel 很强”，只记项目里怎么落：资源怎么定义、规则怎么配、`blockHandler` 和 `fallback` 怎么写、规则怎么放到 Nacos、哪些链路不能假降级。

## 先给结论

后端项目接 Sentinel，先按这套来：

1. 先定义资源名，再配置规则。
2. 资源名要稳定，不要随便用中文或动态参数拼接。
3. HTTP 接口、Service 方法、Feign 调用、MQ 消费逻辑都可以是资源。
4. `blockHandler` 处理 Sentinel 拦截，例如限流、熔断、系统保护。
5. `fallback` 处理业务异常，不等于限流处理。
6. 降级返回必须有业务语义，不要返回假成功。
7. 规则不要只配在控制台内存里，生产要接动态数据源。
8. Sentinel 是保护系统稳定性，不是业务补偿系统。

一句话：

**Sentinel 先保护资源，再谈规则；先明确失败语义，再谈降级返回。**

## 依赖和基础配置

Spring Cloud Alibaba 项目常用 starter：

```xml
<dependency>
    <groupId>com.alibaba.cloud</groupId>
    <artifactId>spring-cloud-starter-alibaba-sentinel</artifactId>
</dependency>
```

配置控制台地址：

```yaml
spring:
  application:
    name: order-service
  cloud:
    sentinel:
      transport:
        dashboard: 127.0.0.1:8858
        port: 8719
```

说明：

| 配置 | 含义 |
| --- | --- |
| `dashboard` | Sentinel Dashboard 地址 |
| `port` | 应用和 Dashboard 通信使用的客户端端口 |

Dashboard 主要用于查看资源、配置规则、观察实时数据。
生产环境规则不要只依赖 Dashboard 临时配置，应用重启后容易丢。

## 资源是什么

Sentinel 的核心不是“接口”，而是 `resource`。

资源可以是：

```text
GET:/api/orders/{id}
order.create
order.pay
remote.user.getById
rabbitmq.orderPaid.consume
```

资源名建议：

```text
领域.动作
remote.下游服务.接口动作
mq.主题.消费动作
```

例如：

```text
order.create
order.cancel
remote.user.getById
remote.inventory.lockStock
mq.orderPaid.consume
```

不要这样：

```text
order.create.1001
用户下单接口
/api/orders/1001
```

资源名要稳定，否则规则没法复用，监控也会碎。

## `@SentinelResource`

方法级资源常用：

```java
@Service
public class OrderService {

    @SentinelResource(
            value = "order.create",
            blockHandler = "createOrderBlockHandler",
            fallback = "createOrderFallback"
    )
    public OrderCreateResult createOrder(CreateOrderCommand command) {
        return doCreateOrder(command);
    }

    public OrderCreateResult createOrderBlockHandler(
            CreateOrderCommand command,
            BlockException exception
    ) {
        return OrderCreateResult.rejected("系统繁忙，请稍后再试");
    }

    public OrderCreateResult createOrderFallback(
            CreateOrderCommand command,
            Throwable throwable
    ) {
        return OrderCreateResult.failed("创建订单失败");
    }
}
```

签名规则要记住：

| 方法 | 处理什么 | 签名要求 |
| --- | --- | --- |
| `blockHandler` | Sentinel 拦截产生的 `BlockException` | 参数和原方法一致，最后多一个 `BlockException` |
| `fallback` | 原方法抛出的业务异常 | 参数和原方法一致，或最后多一个 `Throwable` |

两个返回值类型都要和原方法一致。

## 单独放处理类

如果不想把处理方法写在业务类里，可以放到单独类。

```java
public final class OrderSentinelHandlers {

    private OrderSentinelHandlers() {
    }

    public static OrderCreateResult createOrderBlockHandler(
            CreateOrderCommand command,
            BlockException exception
    ) {
        return OrderCreateResult.rejected("系统繁忙，请稍后再试");
    }

    public static OrderCreateResult createOrderFallback(
            CreateOrderCommand command,
            Throwable throwable
    ) {
        return OrderCreateResult.failed("创建订单失败");
    }
}
```

使用：

```java
@SentinelResource(
        value = "order.create",
        blockHandlerClass = OrderSentinelHandlers.class,
        blockHandler = "createOrderBlockHandler",
        fallbackClass = OrderSentinelHandlers.class,
        fallback = "createOrderFallback"
)
public OrderCreateResult createOrder(CreateOrderCommand command) {
    return doCreateOrder(command);
}
```

注意：放到外部类时，处理方法必须是 `static`。

## `blockHandler` 和 `fallback`

### `blockHandler`

处理 Sentinel 主动拦截：

- QPS 超限
- 线程数超限
- 熔断打开
- 系统保护触发
- 热点参数限流

典型返回：

```java
return ApiResult.fail("系统繁忙，请稍后再试");
```

### `fallback`

处理业务方法自己抛出的异常：

- 下游调用失败
- 业务计算异常
- 数据不存在
- 非 Sentinel 的运行时异常

典型返回：

```java
return ApiResult.fail("业务处理失败");
```

不要把两者混成一个概念。

如果是限流，应该让用户知道“稍后再试”。
如果是业务失败，应该返回业务失败原因。

## 流控规则

QPS 流控规则可以理解成：

```text
resource = order.create
grade = QPS
count = 100
controlBehavior = 快速失败 / 预热 / 匀速排队
```

适合 QPS 流控：

- 秒杀入口
- 查询接口
- 下单入口
- 文件上传入口

线程数流控可以理解成：

```text
同一个资源同时允许多少个线程进入
```

适合保护慢资源：

- 下游慢接口
- 数据库慢查询
- 大文件处理
- 外部 HTTP 调用

经验：

- 入口接口常用 QPS。
- 慢调用链路常用线程数。
- 先小范围压测，再定阈值，不要拍脑袋。

## 熔断降级规则

熔断保护的是“不稳定依赖”。

常见判断维度：

| 维度 | 适合场景 |
| --- | --- |
| 慢调用比例 | 下游变慢 |
| 异常比例 | 下游大量失败 |
| 异常数 | 短时间错误激增 |

例如用户服务变慢：

```text
resource = remote.user.getById
strategy = 慢调用比例
maxRt = 500ms
比例阈值 = 0.5
熔断时长 = 10s
```

含义：

```text
一段时间内超过 500ms 的调用太多，就短暂熔断 user-service 查询
```

注意：

- 熔断不是把问题修好。
- 熔断只是临时保护上游线程。
- 熔断期间返回什么，要由业务语义决定。

## 热点参数限流

热点参数限流适合这种场景：

```text
商品详情接口，某个 productId 被打爆
用户查询接口，某个 userId 被频繁请求
```

资源：

```java
@SentinelResource(value = "product.detail")
public ProductVO getDetail(Long productId) {
    return productService.getDetail(productId);
}
```

热点参数规则一般会指定：

```text
资源名 = product.detail
参数索引 = 0
单机阈值 = 100
```

含义：

```text
同一个 productId 的访问超过阈值，就限流
```

不要把热点参数限流当普通接口限流用。
它解决的是“少数参数特别热”的问题。

## 系统保护

系统规则保护的是整机：

- Load
- CPU
- 平均 RT
- 入口 QPS
- 线程数

它不是业务接口规则。

适合做最后保护线：

```text
系统负载过高时，整体减少入口流量
```

不要把系统保护当成业务限流。
业务限流应该落到明确资源上。

## OpenFeign 接 Sentinel

如果项目里 OpenFeign 接入 Sentinel，典型配置：

```yaml
feign:
  sentinel:
    enabled: true
```

Feign fallback 要非常谨慎：

```java
@FeignClient(
        name = "user-service",
        path = "/api/users",
        fallbackFactory = UserClientFallbackFactory.class
)
public interface UserClient {

    @GetMapping("/{id}")
    UserProfileResponse getById(@PathVariable("id") Long id);
}
```

```java
@Component
public class UserClientFallbackFactory implements FallbackFactory<UserClient> {

    @Override
    public UserClient create(Throwable cause) {
        return new UserClient() {
            @Override
            public UserProfileResponse getById(Long id) {
                throw new RemoteServiceUnavailableException("用户服务不可用", cause);
            }
        };
    }
}
```

不要在关键链路里返回假用户：

```java
return new UserProfileResponse(id, "默认用户", "", 1);
```

除非这个接口是弱依赖展示数据。

## 规则持久化到 Nacos

Dashboard 里手动配规则适合调试，不适合生产长期使用。

生产更推荐接动态数据源，例如 Nacos：

```xml
<dependency>
    <groupId>com.alibaba.csp</groupId>
    <artifactId>sentinel-datasource-nacos</artifactId>
</dependency>
```

配置流控规则：

```yaml
spring:
  cloud:
    sentinel:
      datasource:
        flow-rules:
          nacos:
            server-addr: 127.0.0.1:8848
            namespace: dev
            group-id: SENTINEL_GROUP
            data-id: order-service-flow-rules.json
            data-type: json
            rule-type: flow
```

配置熔断规则：

```yaml
spring:
  cloud:
    sentinel:
      datasource:
        degrade-rules:
          nacos:
            server-addr: 127.0.0.1:8848
            namespace: dev
            group-id: SENTINEL_GROUP
            data-id: order-service-degrade-rules.json
            data-type: json
            rule-type: degrade
```

常见 `rule-type`：

| rule-type | 说明 |
| --- | --- |
| `flow` | 流控规则 |
| `degrade` | 熔断降级规则 |
| `system` | 系统保护规则 |
| `param-flow` | 热点参数规则 |
| `authority` | 授权规则 |

不要把规则只配在控制台内存里。
应用重启、Dashboard 重启、环境迁移时都容易丢。

## Nacos 规则示例

`order-service-flow-rules.json`：

```json
[
  {
    "resource": "order.create",
    "limitApp": "default",
    "grade": 1,
    "count": 100,
    "strategy": 0,
    "controlBehavior": 0
  }
]
```

`order-service-degrade-rules.json`：

```json
[
  {
    "resource": "remote.user.getById",
    "grade": 0,
    "count": 500,
    "timeWindow": 10,
    "minRequestAmount": 20,
    "statIntervalMs": 1000,
    "slowRatioThreshold": 0.5
  }
]
```

规则字段和 Sentinel 版本有关，项目里要以当前依赖版本为准。
不要从网上随手复制一份旧 JSON 就上生产。

## 降级返回怎么设计

降级返回要按业务分级。

### 可以降级展示

```java
public ProductRecommendVO recommendBlockHandler(Long userId, BlockException exception) {
    return ProductRecommendVO.empty("推荐服务繁忙");
}
```

适合：

- 推荐
- 画像
- 标签
- 非核心展示字段

### 必须明确失败

```java
public PayResult payBlockHandler(PayCommand command, BlockException exception) {
    throw new BizException("支付服务繁忙，请稍后重试");
}
```

适合：

- 支付
- 扣库存
- 创建订单
- 权限判断
- 审批状态变更

关键链路不要假成功。

## 常见坑

### 1. 资源名乱写

资源名一旦乱，规则、监控、排查都会乱。

### 2. `blockHandler` 签名不对

必须返回值一致，参数一致，最后多一个 `BlockException`。

### 3. `fallback` 和 `blockHandler` 混用

限流熔断走 `blockHandler`，业务异常走 `fallback`。

### 4. Dashboard 配完就以为生产安全

Dashboard 配置不等于持久化。生产规则要接数据源。

### 5. 所有接口都配降级

不是所有接口都适合降级。核心写链路应该明确失败。

### 6. 阈值拍脑袋

没有压测和线上指标，阈值很容易过松或过紧。

### 7. 把 Sentinel 当补偿系统

Sentinel 只负责运行时保护。
重试、补偿、对账、最终一致性要业务系统自己设计。

### 8. Feign fallback 返回假对象

假对象会污染业务判断，尤其是权限、支付、库存这类链路。

## 项目检查清单

接 Sentinel 时检查：

- 资源名是否稳定？
- 哪些是入口资源，哪些是下游依赖资源？
- 流控规则用 QPS 还是线程数？
- 熔断规则保护哪个下游？
- 热点参数限流是否真的需要？
- `blockHandler` 签名是否正确？
- `fallback` 是否只处理业务异常？
- 降级返回是否有业务语义？
- 核心写链路有没有假成功？
- 规则是否持久化到 Nacos / 其他数据源？
- 是否有指标支撑阈值？
- 是否有监控成功率、限流数、熔断数、RT？

## 最后记一句话

Sentinel 的核心不是“配一个 QPS 阈值”，而是：

**把系统里的关键资源定义清楚，再用流控、熔断、热点参数和系统保护给它们加运行时保护边界。**

## 参考

- [Sentinel 注解支持](https://sentinelguard.io/zh-cn/docs/annotation-support.html)
- [Sentinel Resource and Rule](https://sentinelguard.io/en-us/docs/basic-api-resource-rule.html)
- [Spring Cloud Alibaba Sentinel](https://github.com/alibaba/spring-cloud-alibaba/wiki/sentinel)
