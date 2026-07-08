---
title: OpenFeign 使用笔记
sidebarTitle: OpenFeign
---

# OpenFeign 使用笔记

OpenFeign 适合把“服务间 HTTP 调用”收敛成声明式客户端：

```text
Service
  -> Feign Client
  -> HTTP
  -> Downstream Service
```

它看起来像本地方法调用，但底层仍然是远程调用。
所以这篇不讲“Feign 很方便”，只记项目里怎么写才稳：客户端怎么定义、超时怎么配、请求头怎么透传、异常怎么业务化、fallback 和重试什么时候不能乱用。

## 依赖和开启 Feign

Spring Cloud 项目里一般引入：

```xml
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-openfeign</artifactId>
</dependency>
```

启动类开启 Feign：

```java
@SpringBootApplication
@EnableFeignClients(basePackages = "com.example.order.client")
public class OrderApplication {

    public static void main(String[] args) {
        SpringApplication.run(OrderApplication.class, args);
    }
}
```

建议显式指定 `basePackages`。
不要让 Feign 扫描范围过大，后面多模块项目里会更难控制。

## 推荐目录结构

以订单服务调用用户服务为例：

```text
com.example.order
├─ controller
├─ service
├─ domain
├─ repository
├─ client
│  └─ user
│     ├─ UserClient.java
│     ├─ UserClientConfig.java
│     ├─ UserClientErrorDecoder.java
│     ├─ UserClientFallbackFactory.java
│     └─ dto
│        ├─ UserBatchQueryRequest.java
│        └─ UserProfileResponse.java
└─ config
   └─ FeignCommonConfig.java
```

`client` 包是外部服务适配层。

它不应该放：

- 本地业务编排
- Controller 返回 VO
- 数据库 Entity
- 复杂补偿逻辑

它只负责把远程接口契约稳定地封装起来。

## 最小 Client

```java
@FeignClient(
        name = "user-service",
        path = "/api/users",
        configuration = UserClientConfig.class
)
public interface UserClient {

    @GetMapping("/{id}")
    UserProfileResponse getById(@PathVariable("id") Long id);

    @PostMapping("/batch-query")
    List<UserProfileResponse> batchQuery(@RequestBody UserBatchQueryRequest request);
}
```

业务层调用：

```java
@Service
public class OrderQueryService {

    private final OrderRepository orderRepository;
    private final UserClient userClient;

    public OrderQueryService(OrderRepository orderRepository, UserClient userClient) {
        this.orderRepository = orderRepository;
        this.userClient = userClient;
    }

    public OrderDetailVO getDetail(Long orderId) {
        Order order = orderRepository.findById(orderId)
                .orElseThrow(() -> new BizException("订单不存在"));

        UserProfileResponse user = userClient.getById(order.getUserId());

        return OrderDetailVO.from(order, user);
    }
}
```

注意这里的调用虽然像本地方法：

```java
userClient.getById(order.getUserId())
```

但它背后有网络、超时、序列化、下游异常和版本兼容问题。

## `name`、`url`、`path`

### `name`

```java
@FeignClient(name = "user-service")
```

通常表示服务名。

如果接了 Nacos、Eureka、Consul 这类注册中心，`name` 会用于服务发现和负载均衡。

### `url`

```java
@FeignClient(
        name = "third-party-pay",
        url = "${remote.pay.url}"
)
```

`url` 表示直连地址。

适合：

- 第三方 HTTP API
- 本地联调
- 没有服务注册中心的系统

有 `url` 时，通常不会再走注册中心按服务名找实例。

### `path`

```java
@FeignClient(
        name = "user-service",
        path = "/api/users"
)
```

`path` 是这个 Client 的统一路径前缀。

方法上只写剩余路径：

```java
@GetMapping("/{id}")
UserProfileResponse getById(@PathVariable("id") Long id);
```

## DTO 要分开

Feign DTO 只代表远程接口契约。

不要这样：

```java
@GetMapping("/{id}")
UserVO getById(@PathVariable("id") Long id);
```

然后 Controller 直接返回：

```java
return userClient.getById(id);
```

更稳：

```java
public record UserProfileResponse(
        Long id,
        String nickname,
        String avatar,
        Integer status
) {
}
```

本地 VO 自己组装：

```java
public record OrderDetailVO(
        Long orderId,
        String orderNo,
        String buyerName,
        BigDecimal amount
) {
    public static OrderDetailVO from(Order order, UserProfileResponse user) {
        return new OrderDetailVO(
                order.getId(),
                order.getOrderNo(),
                user.nickname(),
                order.getAmount()
        );
    }
}
```

原因很简单：

- 下游响应结构不等于你的前端展示结构。
- 下游字段变化不能直接污染你的 Controller。
- 本地领域对象不应该被远程契约牵着走。

## 超时配置

远程调用必须配置超时。

全局默认：

```yaml
spring:
  cloud:
    openfeign:
      client:
        config:
          default:
            connectTimeout: 2000
            readTimeout: 3000
            loggerLevel: basic
```

单个 Client 覆盖：

```yaml
spring:
  cloud:
    openfeign:
      client:
        config:
          user-service:
            connectTimeout: 1000
            readTimeout: 2000
            loggerLevel: basic
          third-party-pay:
            connectTimeout: 3000
            readTimeout: 8000
            loggerLevel: basic
```

两个时间要分清：

| 配置 | 含义 |
| --- | --- |
| `connectTimeout` | 建立连接最多等多久 |
| `readTimeout` | 请求发出后，等响应最多多久 |

经验：

- 内部服务同步调用不要配太长。
- 支付、第三方接口可以按 SLA 单独放宽。
- 超时不是越大越稳，越大越容易拖垮上游线程。

## Client 配置类

给用户服务单独配置：

```java
public class UserClientConfig {

    @Bean
    public ErrorDecoder userClientErrorDecoder() {
        return new UserClientErrorDecoder();
    }

    @Bean
    public RequestInterceptor userClientRequestInterceptor() {
        return template -> {
            template.header("X-Client-Name", "order-service");
        };
    }
}
```

注意：如果这个配置类被全局扫描成普通 Spring Bean，它可能影响所有 Feign Client。
所以项目里要明确约定：

- 公共配置放 `FeignCommonConfig`
- Client 专属配置放对应 `client.xxx` 包
- 不要把专属配置类随手丢到全局 `config` 包里

## 请求头透传

公共上下文用 `RequestInterceptor`：

```java
@Configuration
public class FeignCommonConfig {

    @Bean
    public RequestInterceptor traceRequestInterceptor() {
        return template -> {
            putHeaderIfPresent(template, "X-Trace-Id", TraceContext.getTraceId());
            putHeaderIfPresent(template, "X-Tenant-Id", TenantContext.getTenantId());
            putHeaderIfPresent(template, "X-User-Id", UserContext.getUserId());
        };
    }

    private void putHeaderIfPresent(RequestTemplate template, String name, String value) {
        if (StringUtils.hasText(value)) {
            template.header(name, value);
        }
    }
}
```

适合统一透传：

- `X-Trace-Id`
- `X-Request-Id`
- `X-Tenant-Id`
- `X-User-Id`
- `Authorization`
- 幂等 Key

不建议每个业务方法里手动拼 header。

如果是第三方接口鉴权，建议放在对应 Client 配置里，不要混进全局拦截器。

## 错误处理：`ErrorDecoder`

Feign 默认抛出来的异常通常太泛。

更稳的是把 HTTP 错误转换成业务能理解的异常：

```java
public class UserClientErrorDecoder implements ErrorDecoder {

    private final ErrorDecoder defaultErrorDecoder = new Default();

    @Override
    public Exception decode(String methodKey, Response response) {
        if (response.status() == 404) {
            return new RemoteUserNotFoundException("用户不存在");
        }

        if (response.status() == 429) {
            return new RemoteRateLimitException("用户服务限流");
        }

        if (response.status() >= 500) {
            return new RemoteServiceException("用户服务异常");
        }

        return defaultErrorDecoder.decode(methodKey, response);
    }
}
```

业务层就可以按异常类型处理：

```java
try {
    UserProfileResponse user = userClient.getById(userId);
    return UserVO.from(user);
} catch (RemoteUserNotFoundException exception) {
    throw new BizException("用户不存在");
} catch (RemoteServiceException exception) {
    throw new BizException("用户服务暂时不可用");
}
```

错误要尽早业务化。
不要让上层到处判断 `FeignException.status()`。

## 统一响应体怎么处理

很多内部接口会返回统一结构：

```json
{
  "code": "0",
  "message": "success",
  "data": {}
}
```

Feign Client 可以直接声明包装响应：

```java
@GetMapping("/{id}")
ApiResponse<UserProfileResponse> getById(@PathVariable("id") Long id);
```

业务层拆开：

```java
ApiResponse<UserProfileResponse> response = userClient.getById(userId);

if (!response.success()) {
    throw new RemoteBusinessException(response.code(), response.message());
}

UserProfileResponse user = response.data();
```

也可以自定义 Decoder 做统一拆包，但不要一开始就过度封装。
如果团队还没统一好错误模型，显式处理反而更清楚。

## Fallback：优先用 `FallbackFactory`

如果要降级，优先用 `FallbackFactory`，因为它能拿到失败原因。

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

不要写这种假成功：

```java
return new UserProfileResponse(id, "默认用户", "", 1);
```

除非业务明确允许降级展示。

## 什么时候可以 fallback

适合 fallback：

- 推荐内容
- 用户头像、标签、画像补充
- 非核心展示字段
- 失败后可以展示默认值的查询

不适合 fallback：

- 下单
- 扣库存
- 扣余额
- 支付状态查询
- 权限判断
- 审批流转

核心链路宁愿失败得明确，也不要伪成功。

因为伪成功会让数据状态变脏，后面补偿更痛苦。

## 重试和幂等

不要一看到超时就开重试。

可以考虑重试：

- GET 查询
- 幂等的状态查询
- 明确支持幂等 Key 的 POST
- 临时网络抖动

不要随便重试：

- 创建订单
- 扣余额
- 发优惠券
- 创建支付单
- 发送短信

如果必须重试，先设计幂等：

```java
@PostMapping("/orders")
CreateOrderResponse createOrder(
        @RequestHeader("Idempotency-Key") String idempotencyKey,
        @RequestBody CreateOrderRequest request
);
```

业务调用：

```java
String idempotencyKey = "order:create:" + command.requestId();
orderClient.createOrder(idempotencyKey, request);
```

没有幂等保障的写接口，不要靠客户端重试赌运气。

## 避免 N+1 远程调用

错误示例：

```java
List<OrderDetailVO> detailList = orders.stream()
        .map(order -> {
            UserProfileResponse user = userClient.getById(order.getUserId());
            return OrderDetailVO.from(order, user);
        })
        .toList();
```

100 条订单就可能调用 100 次用户服务。

更稳的是让下游提供批量接口：

```java
@PostMapping("/batch-query")
List<UserProfileResponse> batchQuery(@RequestBody UserBatchQueryRequest request);
```

调用方先聚合 ID：

```java
List<Long> userIds = orders.stream()
        .map(Order::getUserId)
        .filter(Objects::nonNull)
        .distinct()
        .toList();

List<UserProfileResponse> users = userClient.batchQuery(new UserBatchQueryRequest(userIds));

Map<Long, UserProfileResponse> userMap = users.stream()
        .collect(Collectors.toMap(
                UserProfileResponse::id,
                Function.identity(),
                (oldValue, newValue) -> oldValue
        ));

List<OrderDetailVO> detailList = orders.stream()
        .map(order -> OrderDetailVO.from(order, userMap.get(order.getUserId())))
        .toList();
```

服务间调用最怕“写起来像本地循环”。
每一个 Feign 方法调用都是真 HTTP。

## 日志级别

Feign 常见日志级别：

| 级别 | 内容 |
| --- | --- |
| `none` | 不记录 |
| `basic` | 方法、URL、状态码、耗时 |
| `headers` | 再加请求和响应头 |
| `full` | 再加 body 和 metadata |

生产环境建议：

```yaml
spring:
  cloud:
    openfeign:
      client:
        config:
          default:
            loggerLevel: basic
```

只在排查单个 Client 时临时开 `full`。

原因：

- body 可能很大
- token 和手机号可能泄露
- 日志量会暴涨
- 慢接口会被日志进一步拖慢

如果必须打请求响应 body，要先做脱敏。

## 服务间调用不要层层套娃

危险链路：

```text
order-service
  -> user-service
    -> permission-service
      -> tenant-service
```

问题：

- 延迟叠加
- 超时难配置
- 一层失败拖垮整条链
- 排查时链路太长

改法：

- 能批量就批量。
- 能缓存就缓存。
- 能异步就异步。
- 聚合逻辑尽量收敛在明确的应用服务里。
- 不要一个接口里反复调用同一个下游。

OpenFeign 只是降低调用成本，不代表应该增加调用次数。

## Feign Client 里不要写业务逻辑

不要这样：

```java
@FeignClient(name = "user-service")
public interface UserClient {

    @GetMapping("/api/users/{id}")
    UserProfileResponse getById(@PathVariable("id") Long id);

    default UserProfileResponse getRequiredUser(Long id) {
        UserProfileResponse user = getById(id);
        if (user == null) {
            throw new BizException("用户不存在");
        }
        return user;
    }
}
```

Client 只描述远程接口。

业务语义放 Service：

```java
public UserProfileResponse getRequiredUser(Long userId) {
    UserProfileResponse user = userClient.getById(userId);
    if (user == null) {
        throw new BizException("用户不存在");
    }
    return user;
}
```

这样远程契约和本地业务规则不会混在一起。

## 常见坑

### 1. Feign 返回对象直接返回给前端

下游响应结构会污染你的前端接口。
要转成本地 VO。

### 2. 循环里逐条远程调用

这是 N+1 HTTP 调用。
让下游提供批量接口。

### 3. 关键链路 fallback 假成功

下单、支付、扣库存、权限判断不要返回默认值糊弄过去。

### 4. 没配超时

下游一慢，上游线程池也会被拖住。

### 5. 错误没有业务化

所有异常都抛 `FeignException`，Service 层就没法做清晰处理。

### 6. 日志开 `full` 不脱敏

容易泄露 token、手机号、身份证、地址等敏感信息。

### 7. 写接口无幂等还开启重试

可能重复创建、重复扣款、重复发券。

### 8. 忽略版本兼容

下游字段改名、枚举扩展、响应结构变化，都可能让上游反序列化或业务判断出问题。

## 项目检查清单

接一个新的 Feign Client 时，至少检查：

- Client 包位置是否清晰？
- `name`、`url`、`path` 是否用对？
- DTO 是否和本地 VO / Entity 分开？
- 是否配置了 connect timeout 和 read timeout？
- 是否需要透传 trace、tenant、token？
- HTTP 错误是否转换成业务异常？
- 是否需要批量接口，避免 N+1 调用？
- fallback 是不是只用于弱依赖读接口？
- 写接口是否有幂等 Key？
- 是否禁止对非幂等接口重试？
- 日志级别是否合适，敏感字段是否脱敏？
- 调用链是否过深？