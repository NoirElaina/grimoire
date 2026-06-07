---
title: Spring MVC 请求链路
sidebarTitle: Spring MVC 请求链路
---

# Spring MVC 请求链路

> 会写 Controller 不等于懂 Web 链路。真正排查 404、参数解析、拦截器、异常处理时，要知道请求经过哪些组件。

## 一条请求怎么走

典型链路：

```text
浏览器 / 前端
  -> Nginx
  -> Tomcat
  -> Filter
  -> DispatcherServlet
  -> HandlerMapping
  -> HandlerInterceptor.preHandle
  -> HandlerAdapter
  -> Controller
  -> Service
  -> 返回值处理 / HttpMessageConverter
  -> ResponseBodyAdvice
  -> HandlerInterceptor.postHandle / afterCompletion
  -> Filter
  -> 前端
```

核心记忆：

- `Filter` 属于 Servlet 容器层。
- `DispatcherServlet` 是 Spring MVC 的入口。
- `HandlerMapping` 找 Controller 方法。
- `HandlerAdapter` 调用 Controller 方法。
- `HttpMessageConverter` 负责 JSON 读写。
- `@ControllerAdvice` 处理异常和响应增强。

## DispatcherServlet

Spring MVC 是前端控制器模式。所有匹配的请求先进入 `DispatcherServlet`，再分发到具体 Controller。

你写的：

```java
@RestController
@RequestMapping("/api/products")
public class ProductController {

    @GetMapping("/{productId}")
    public ProductDetailVO detail(@PathVariable Long productId) {
        return productService.getDetail(productId);
    }
}
```

实际是 MVC 帮你完成：

```text
请求路径 /api/products/10001
  -> 找到 ProductController.detail
  -> 解析 productId
  -> 调用方法
  -> 把返回值写成 JSON
```

## HandlerMapping

`HandlerMapping` 负责把请求映射到处理器。

常见 404 排查：

```text
1. URL 是否写错
2. HTTP 方法是否写错
3. Controller 是否被 Spring 扫描
4. 类上和方法上的 @RequestMapping 是否拼对
5. context-path 是否影响路径
6. 网关 / Nginx 是否改写路径
```

例子：

```yaml
server:
  servlet:
    context-path: /flashmart
```

实际访问路径会变成：

```text
/flashmart/api/products/10001
```

## 参数解析

常见参数位置：

| 注解 | 来源 | 例子 |
| --- | --- | --- |
| `@PathVariable` | 路径变量 | `/products/{id}` |
| `@RequestParam` | query/form 参数 | `?page=1` |
| `@RequestBody` | JSON body | POST JSON |
| `@RequestHeader` | 请求头 | `Authorization` |
| `@CookieValue` | Cookie | `SESSION` |

示例：

```java
@PostMapping
public ApiResult<Long> create(@Valid @RequestBody CreateProductRequest request,
                              @RequestHeader("X-User-Id") Long userId) {
    Long productId = productService.create(userId, request);
    return ApiResult.success(productId);
}
```

常见错误：

- GET 请求里写 `@RequestBody`，前端或网关不一定稳定支持。
- JSON 字段名和 DTO 字段名不一致。
- `Content-Type` 没有写 `application/json`。
- 基本类型参数没传，导致绑定失败。

## HttpMessageConverter

JSON 请求体和响应体不是 Controller 自己转换的，而是 `HttpMessageConverter` 做的。

流程：

```text
JSON body -> ObjectMapper -> Request DTO
Response VO -> ObjectMapper -> JSON response
```

所以这些问题一般和消息转换有关：

- `LocalDateTime` 格式不对。
- 枚举入参解析失败。
- 前端传字符串，后端字段是数字。
- 返回对象循环引用。
- 接口返回乱码或不是 JSON。

项目里通常要统一 Jackson 配置：

```yaml
spring:
  jackson:
    time-zone: Asia/Shanghai
    date-format: yyyy-MM-dd HH:mm:ss
```

更复杂的规则放配置类，不要每个 Controller 手动格式化。

## Filter 和 Interceptor 的位置

链路位置：

```text
Filter -> DispatcherServlet -> Interceptor -> Controller
```

区别：

| 对比 | Filter | Interceptor |
| --- | --- | --- |
| 属于 | Servlet | Spring MVC |
| 能否拿到 Controller 方法 | 不方便 | 可以拿到 Handler |
| 常见用途 | 跨域、压缩、traceId、原始请求处理 | 登录校验、权限、接口耗时 |
| 生效范围 | 更底层 | MVC 请求 |

登录鉴权常用拦截器，因为可以结合路径和 Handler 方法判断。

traceId 常用 Filter，因为要尽早进入日志上下文。

## 异常处理

Controller 抛异常后，通常由 `@RestControllerAdvice` 统一处理：

```java
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(BizException.class)
    public ApiResult<Void> handleBizException(BizException ex) {
        return ApiResult.fail(ex.getCode(), ex.getMessage());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ApiResult<Void> handleValidationException(MethodArgumentNotValidException ex) {
        String message = ex.getBindingResult().getFieldErrors().stream()
            .findFirst()
            .map(FieldError::getDefaultMessage)
            .orElse("参数错误");
        return ApiResult.fail("PARAM_ERROR", message);
    }
}
```

注意：

- 不要在 Controller 里到处 `try-catch`。
- 业务异常和系统异常要区分。
- 参数校验异常要给前端明确字段问题。
- 第三方回调、文件下载、SSE 不一定适合统一包装。

## 返回值处理

`@RestController` 等价于 `@Controller + @ResponseBody`。

返回对象时：

```java
return ApiResult.success(productDetail);
```

Spring MVC 会把对象转成 JSON。

如果返回文件：

```java
@GetMapping("/export")
public ResponseEntity<Resource> export() {
    return ResponseEntity.ok()
        .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=orders.xlsx")
        .body(resource);
}
```

这类接口不要再套统一 JSON。

## 404、400、500 怎么定位

### 404

```text
URL / 方法 / context-path / Controller 扫描 / 网关路径
```

### 400

```text
参数绑定失败 / JSON 格式错误 / Content-Type 不对 / 校验失败
```

### 500

```text
业务异常没处理 / 空指针 / 数据库错误 / 第三方调用失败
```

### 415

```text
Content-Type 不支持，例如应该传 application/json
```

### 405

```text
URL 对，但 HTTP 方法错，例如接口只支持 POST
```

## 一条接口的最小结构

```java
@RestController
@RequestMapping("/api/orders")
public class OrderController {

    private final OrderService orderService;

    public OrderController(OrderService orderService) {
        this.orderService = orderService;
    }

    @PostMapping
    public ApiResult<Long> create(@Valid @RequestBody CreateOrderRequest request,
                                  @RequestHeader("X-User-Id") Long userId) {
        Long orderId = orderService.create(userId, request);
        return ApiResult.success(orderId);
    }
}
```

Controller 只做：

- 接收参数。
- 参数校验入口。
- 调用 Service。
- 返回结果。

不要在 Controller 里写事务、查库、拼复杂业务规则。

## 去空话检查

- [ ] 能画出 Filter、DispatcherServlet、Interceptor、Controller 的顺序。
- [ ] 404 能按路径、方法、扫描、context-path 排查。
- [ ] 400 能按参数绑定、JSON、校验排查。
- [ ] JSON 转换问题知道看 `HttpMessageConverter` 和 `ObjectMapper`。
- [ ] Controller 不写复杂业务。
- [ ] 文件下载、SSE、回调接口不盲目套统一响应。

## 参考

- [Spring Web MVC DispatcherServlet](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-servlet.html)
- [Spring MVC Special Bean Types](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-servlet/special-bean-types.html)
