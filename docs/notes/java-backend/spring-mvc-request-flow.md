---
title: Spring MVC 请求链路
sidebarTitle: Spring MVC 请求链路
---

# Spring MVC 请求链路

> 会写 Controller 不等于懂 Web 链路。排查 404、参数解析、拦截器、异常处理时，要知道请求经过哪些组件；源码题里则要能讲清 `DispatcherServlet.doDispatch` 和它背后的九大组件怎么协作。

## 一条请求怎么走

典型链路：

```text
浏览器 / 前端
  -> Nginx
  -> Tomcat
  -> Filter
  -> DispatcherServlet
  -> HandlerMapping（找 handler + 拦截器链）
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

- `Filter` 属于 Servlet 容器层，在 `DispatcherServlet` 之外。
- `DispatcherServlet` 是 Spring MVC 的入口（前端控制器模式）。
- `HandlerMapping` 找 Controller 方法。
- `HandlerAdapter` 调用 Controller 方法。
- `HttpMessageConverter` 负责 JSON 读写。
- `@ControllerAdvice` 处理异常和响应增强。

## DispatcherServlet 与前端控制器

Spring MVC 是前端控制器模式：所有匹配的请求先进入 `DispatcherServlet`，再由它统一分发到具体 Controller。

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

## doDispatch：MVC 的心脏

所有请求最终进入 `DispatcherServlet.doDispatch`，源码简化后：

```java
protected void doDispatch(HttpServletRequest request, HttpServletResponse response) {
    // 1. 找 handler（Controller 方法 + 拦截器链）
    HandlerExecutionChain mappedHandler = getHandler(request);
    if (mappedHandler == null) { noHandlerFound(request, response); return; }  // -> 404

    // 2. 找能调用该 handler 的适配器
    HandlerAdapter ha = getHandlerAdapter(mappedHandler.getHandler());

    // 3. 前置拦截器
    if (!mappedHandler.applyPreHandle(request, response)) return;

    // 4. 真正调用 Controller 方法（参数解析 + 反射调用 + 返回值处理）
    ModelAndView mv = ha.handle(request, response, mappedHandler.getHandler());

    // 5. 后置拦截器
    mappedHandler.applyPostHandle(request, response, mv);

    // 6. 渲染视图 / 异常处理 / afterCompletion
    processDispatchResult(request, response, mappedHandler, mv, dispatchException);
}
```

记住这条主线：**getHandler → getHandlerAdapter → applyPreHandle → handle → applyPostHandle → processDispatchResult**。404、拦截器顺序、异常处理都能挂到这条线上。

## 九大组件

`DispatcherServlet` 启动时（`initStrategies`）初始化九类组件，常用的有：

| 组件 | 作用 |
| --- | --- |
| `HandlerMapping` | URL → handler 映射 |
| `HandlerAdapter` | 适配并调用不同类型的 handler |
| `HandlerExceptionResolver` | 异常解析 |
| `ViewResolver` | 视图名 → View |
| `HandlerInterceptor` | 拦截器（挂在 HandlerExecutionChain 上） |
| `MultipartResolver` | 文件上传解析 |
| `LocaleResolver` | 国际化 |

`@RequestMapping` 的处理由 `RequestMappingHandlerMapping`（找方法）和 `RequestMappingHandlerAdapter`（调方法）这对组件负责，是现在的主流。

## HandlerMapping 与 404

`RequestMappingHandlerMapping` 在启动时扫描所有 `@RequestMapping`，把 URL pattern + 请求方法等封装成 `RequestMappingInfo`，注册成映射表。请求来时按这张表匹配。

匹配不到就 `noHandlerFound`，默认返回 404。常见 404 排查：

```text
1. URL 是否写错
2. HTTP 方法是否写错
3. Controller 是否被 Spring 扫描到
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

`HandlerAdapter.handle` 内部用 `HandlerMethodArgumentResolver` 链解析每个参数：拿到方法参数 → 遍历解析器列表 → 找到 `supportsParameter` 返回 true 的来解析。

常见参数位置：

| 注解 | 解析器 | 来源 | 例子 |
| --- | --- | --- | --- |
| `@PathVariable` | `PathVariableMethodArgumentResolver` | 路径变量 | `/products/{id}` |
| `@RequestParam` | `RequestParamMethodArgumentResolver` | query/form | `?page=1` |
| `@RequestBody` | `RequestResponseBodyMethodProcessor` | JSON body | POST JSON |
| `@RequestHeader` | `RequestHeaderMethodArgumentResolver` | 请求头 | `Authorization` |
| `@CookieValue` | `ServletCookieValueMethodArgumentResolver` | Cookie | `SESSION` |

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
- 基本类型参数没传，导致绑定失败（建议用包装类型 + 校验）。

## HttpMessageConverter

`@RequestBody` / `@ResponseBody` 的 JSON 转换不是 Controller 自己做的，而是 `HttpMessageConverter`（JSON 场景下是 `MappingJackson2HttpMessageConverter`，内部用 `ObjectMapper`）。

流程：

```text
JSON body -> ObjectMapper -> Request DTO
Response VO -> ObjectMapper -> JSON response
```

它根据请求的 `Content-Type`、`Accept` 以及方法参数 / 返回类型，决定用哪个 converter。所以这些问题一般和它有关：

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

## 返回值处理与 ResponseBodyAdvice

返回值由 `HandlerMethodReturnValueHandler` 处理。`@ResponseBody` / `@RestController` 的返回值走 `RequestResponseBodyMethodProcessor`，再交给 `HttpMessageConverter` 写成 JSON。

`@RestController` 等价于 `@Controller + @ResponseBody`。返回对象时：

```java
return ApiResult.success(productDetail);
```

统一响应包装可以实现 `ResponseBodyAdvice`，在写出 body 前统一套 `ApiResult`：

```java
@RestControllerAdvice
public class ApiResponseAdvice implements ResponseBodyAdvice<Object> {

    @Override
    public boolean supports(MethodParameter returnType, Class converterType) {
        return true;   // 可按包名 / 注解过滤
    }

    @Override
    public Object beforeBodyWrite(Object body, ...) {
        if (body instanceof ApiResult) return body;
        return ApiResult.success(body);
    }
}
```

文件下载、SSE、第三方回调不要套统一 JSON：

```java
@GetMapping("/export")
public ResponseEntity<Resource> export() {
    return ResponseEntity.ok()
        .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=orders.xlsx")
        .body(resource);
}
```

## Filter 和 Interceptor 的区别

位置：

```text
Filter -> DispatcherServlet -> Interceptor -> Controller
```

| 对比 | Filter | Interceptor |
| --- | --- | --- |
| 属于 | Servlet 规范 | Spring MVC |
| 是否被 Spring 管理 | 不一定 | 是 Spring Bean |
| 能否拿到 Handler 方法 | 不方便 | 可以拿到 HandlerMethod |
| 执行点 | 在 DispatcherServlet 之外 | 在 doDispatch 内部 |
| 常见用途 | 跨域、压缩、traceId、改写原始请求 | 登录校验、权限、接口耗时 |

- traceId 用 Filter，因为要**尽早**进入日志上下文。
- 登录鉴权用 Interceptor，因为能结合路径和 HandlerMethod 判断（比如读方法上的权限注解）。

拦截器三个回调：`preHandle`（Controller 前）、`postHandle`（Controller 后、渲染前）、`afterCompletion`（整个完成后，含异常）。多个拦截器时，`preHandle` 正序执行，`postHandle` / `afterCompletion` 逆序执行；只要某个 `preHandle` 返回过 true，它的 `afterCompletion` 就一定会被回调（适合做资源清理）。

## 异常处理

`processDispatchResult` 里如果有异常，交给 `HandlerExceptionResolver` 链处理。Spring Boot 默认装了 `ExceptionHandlerExceptionResolver`，它就是让 `@ExceptionHandler` / `@RestControllerAdvice` 生效的组件：

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
- `@RestControllerAdvice` 处理的是**进入 DispatcherServlet 之后**的异常；Filter 层抛的异常它管不到，需要 Filter 自己处理或交给容器的 error page。
- 第三方回调、文件下载、SSE 不一定适合统一包装。

## 状态码怎么定位

| 码 | 方向 |
| --- | --- |
| 404 | URL / 方法 / context-path / Controller 扫描 / 网关路径 |
| 400 | 参数绑定失败 / JSON 格式错误 / 校验失败 |
| 415 | `Content-Type` 不支持，例如应该传 `application/json` |
| 405 | URL 对，但 HTTP 方法错，例如接口只支持 POST |
| 500 | 业务异常没处理 / 空指针 / 数据库错误 / 第三方调用失败 |

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

Controller 只做：接收参数、参数校验入口、调用 Service、返回结果。不要在 Controller 里写事务、查库、拼复杂业务规则。

## 去空话检查

- [ ] 能说出 doDispatch 主线：getHandler → getHandlerAdapter → preHandle → handle → postHandle → processDispatchResult。
- [ ] 知道 RequestMappingHandlerMapping / Adapter 这对组件负责找方法和调方法。
- [ ] 知道参数解析靠 HandlerMethodArgumentResolver，JSON 靠 HttpMessageConverter。
- [ ] 知道统一响应用 ResponseBodyAdvice，统一异常用 @RestControllerAdvice + ExceptionHandlerExceptionResolver。
- [ ] 能区分 Filter 与 Interceptor 的位置和能力，知道拦截器回调顺序。
- [ ] 404 / 400 / 415 / 405 / 500 能按链路定位。
- [ ] Controller 不写复杂业务；下载、SSE、回调不盲目套统一响应。

## 参考

- [Spring Web MVC DispatcherServlet](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-servlet.html)
- [Spring MVC Special Bean Types](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-servlet/special-bean-types.html)
- [Spring MVC Annotated Controllers](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller.html)
