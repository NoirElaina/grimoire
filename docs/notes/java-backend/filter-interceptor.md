---
title: 过滤器与拦截器
sidebarTitle: 过滤器与拦截器
---

# 过滤器与拦截器

> Filter 和 Interceptor 都能“拦请求”，但层级不同：Filter 在 Servlet 层，Interceptor 在 Spring MVC 层。

## 先给结论

在 Spring Boot Web 项目里可以这样选：

| 需求 | 用什么 |
| --- | --- |
| traceId、请求日志、CORS、编码、包装 request/response | `Filter` |
| JWT / Spring Security 鉴权 | Spring Security Filter Chain |
| 登录用户上下文、租户上下文、接口耗时 | `HandlerInterceptor` |
| Controller 返回统一包装 | `ResponseBodyAdvice` |
| Controller 异常统一处理 | `@RestControllerAdvice` |
| 方法级权限 | Spring Security `@PreAuthorize` |

一句话：

- 越靠近 HTTP 原始请求，用 `Filter`。
- 越靠近 Controller 业务语义，用 `Interceptor`。
- 鉴权不要自己随便写 Interceptor，优先接 Spring Security。

## 请求经过哪里

大概顺序：

```text
Client
  -> Servlet Filter Chain
  -> DispatcherServlet
  -> HandlerMapping
  -> HandlerInterceptor.preHandle()
  -> Controller
  -> HandlerInterceptor.postHandle()
  -> HandlerInterceptor.afterCompletion()
  -> Servlet Filter Chain 返回阶段
  -> Client
```

关键差别：

- `Filter` 在 `DispatcherServlet` 之前。
- `Interceptor` 在 Spring MVC 找到 Controller 之后。
- `Filter` 不知道具体 Controller 方法。
- `Interceptor` 能拿到 `handler`，通常能判断 Controller / Method。
- `Filter` 能包装 `HttpServletRequest` / `HttpServletResponse`。
- `Interceptor` 更适合做 MVC 层上下文和业务前置检查。

## Filter 适合做什么

典型场景：

- traceId 注入。
- 请求 / 响应日志。
- 统一编码。
- CORS。
- 请求体缓存包装。
- 原始 Header 检查。
- 安全框架过滤链。
- 灰度、限流、网关透传字段预处理。

不适合：

- 写复杂业务规则。
- 直接查很多业务表。
- 做 Controller 返回值包装。
- 依赖 `@ControllerAdvice` 处理异常。

Filter 层抛出的异常不一定会进入 Spring MVC 的异常处理器，所以要么直接写响应，要么显式交给 `HandlerExceptionResolver`。

## Interceptor 适合做什么

典型场景：

- 登录用户上下文绑定。
- 租户上下文绑定。
- 接口耗时统计。
- 基于 HandlerMethod 的注解检查。
- 简单权限前置判断。
- 幂等注解检查。

不适合：

- 读取和反复消费请求体。
- 包装 response body。
- 替代 Spring Security。
- 做非常底层的 HTTP 处理。

如果要改响应体，通常用：

- `ResponseBodyAdvice`。
- `@RestControllerAdvice`。
- Filter 包装 response，但要非常谨慎。

## Filter 示例：traceId

```java
public class TraceIdFilter extends OncePerRequestFilter {

    private static final String TRACE_ID = "traceId";

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain)
            throws ServletException, IOException {
        String traceId = Optional.ofNullable(request.getHeader("X-Trace-Id"))
            .filter(StringUtils::hasText)
            .orElse(UUID.randomUUID().toString().replace("-", ""));

        MDC.put(TRACE_ID, traceId);
        response.setHeader("X-Trace-Id", traceId);

        try {
            filterChain.doFilter(request, response);
        } finally {
            MDC.remove(TRACE_ID);
        }
    }
}
```

注册顺序：

```java
@Configuration
public class WebFilterConfig {

    @Bean
    public FilterRegistrationBean<TraceIdFilter> traceIdFilterRegistration() {
        FilterRegistrationBean<TraceIdFilter> registration = new FilterRegistrationBean<>();
        registration.setFilter(new TraceIdFilter());
        registration.addUrlPatterns("/*");
        registration.setOrder(Ordered.HIGHEST_PRECEDENCE);
        return registration;
    }
}
```

注意：

- `OncePerRequestFilter` 保证一次请求在一个请求线程里只执行一次。
- `filterChain.doFilter()` 必须调用，否则请求不会继续。
- 清理 `MDC` 必须放 `finally`，线程复用时不然会串日志。

## Filter 示例：请求日志

如果要读取 body，不能直接读原始 request，否则 Controller 可能读不到。

```java
public class AccessLogFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain)
            throws ServletException, IOException {
        ContentCachingRequestWrapper requestWrapper = new ContentCachingRequestWrapper(request);
        ContentCachingResponseWrapper responseWrapper = new ContentCachingResponseWrapper(response);

        long start = System.currentTimeMillis();
        try {
            filterChain.doFilter(requestWrapper, responseWrapper);
        } finally {
            long cost = System.currentTimeMillis() - start;
            log.info("access log, method={}, uri={}, status={}, cost={}ms",
                request.getMethod(),
                request.getRequestURI(),
                responseWrapper.getStatus(),
                cost);
            responseWrapper.copyBodyToResponse();
        }
    }
}
```

注意：

- `copyBodyToResponse()` 不能忘，否则响应体可能丢。
- 不要默认打印完整 body。
- 密码、token、身份证、手机号要脱敏。
- 大文件上传、下载接口要排除。
- 日志量大时要采样。

## Interceptor 示例：租户上下文

```java
public class TenantInterceptor implements HandlerInterceptor {

    @Override
    public boolean preHandle(HttpServletRequest request,
                             HttpServletResponse response,
                             Object handler) throws Exception {
        String tenantId = request.getHeader("X-Tenant-Id");
        if (!StringUtils.hasText(tenantId)) {
            response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.getWriter().write("{\"code\":\"TENANT_REQUIRED\",\"message\":\"租户不能为空\"}");
            return false;
        }

        TenantContext.set(tenantId);
        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest request,
                                HttpServletResponse response,
                                Object handler,
                                Exception ex) {
        TenantContext.clear();
    }
}
```

注册：

```java
@Configuration
public class WebMvcConfig implements WebMvcConfigurer {

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new TenantInterceptor())
            .addPathPatterns("/**")
            .excludePathPatterns(
                "/auth/**",
                "/actuator/**",
                "/swagger-ui/**",
                "/v3/api-docs/**"
            )
            .order(Ordered.HIGHEST_PRECEDENCE + 10);
    }
}
```

注意：

- `preHandle` 返回 `false` 后，Controller 不会执行。
- 如果 `preHandle` 里已经写了响应，就不要继续放行。
- `ThreadLocal` 上下文必须在 `afterCompletion` 清理。
- 如果 `preHandle` 在设置上下文后又返回 `false`，要自己先清理。

## Interceptor 示例：注解检查

自定义注解：

```java
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface Idempotent {

    String key();

    long ttlSeconds() default 60;
}
```

拦截器：

```java
public class IdempotentInterceptor implements HandlerInterceptor {

    private final IdempotentService idempotentService;

    public IdempotentInterceptor(IdempotentService idempotentService) {
        this.idempotentService = idempotentService;
    }

    @Override
    public boolean preHandle(HttpServletRequest request,
                             HttpServletResponse response,
                             Object handler) throws Exception {
        if (!(handler instanceof HandlerMethod handlerMethod)) {
            return true;
        }

        Idempotent annotation = handlerMethod.getMethodAnnotation(Idempotent.class);
        if (annotation == null) {
            return true;
        }

        String requestId = request.getHeader("Idempotency-Key");
        if (!StringUtils.hasText(requestId)) {
            response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
            response.getWriter().write("{\"code\":\"IDEMPOTENT_KEY_REQUIRED\"}");
            return false;
        }

        boolean acquired = idempotentService.tryAcquire(requestId, annotation.ttlSeconds());
        if (!acquired) {
            response.setStatus(HttpServletResponse.SC_CONFLICT);
            response.getWriter().write("{\"code\":\"DUPLICATE_REQUEST\"}");
            return false;
        }

        return true;
    }
}
```

Controller：

```java
@Idempotent(key = "createOrder")
@PostMapping("/orders")
public ApiResult<Long> create(@Valid @RequestBody CreateOrderRequest request) {
    return ApiResult.ok(orderService.createOrder(request.toCommand()));
}
```

这种适合做“接口级切面”，但核心幂等结果仍然要靠数据库唯一约束、状态机或业务流水兜住。

## 和 Spring Security 的关系

Spring Security 本质上也是一组 Filter。

JWT 鉴权更推荐放到 Security Filter Chain：

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http,
                                                   JwtAuthenticationFilter jwtAuthenticationFilter)
            throws Exception {
        return http
            .csrf(AbstractHttpConfigurer::disable)
            .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/auth/login", "/auth/refresh").permitAll()
                .anyRequest().authenticated()
            )
            .addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class)
            .build();
    }
}
```

如果自定义 JWT Filter 同时作为普通 Servlet Filter 注册，又加进 Security Filter Chain，可能执行两次。

可以禁用普通 Filter 注册：

```java
@Bean
public FilterRegistrationBean<JwtAuthenticationFilter> jwtFilterRegistration(
        JwtAuthenticationFilter jwtAuthenticationFilter) {
    FilterRegistrationBean<JwtAuthenticationFilter> registration = new FilterRegistrationBean<>();
    registration.setFilter(jwtAuthenticationFilter);
    registration.setEnabled(false);
    return registration;
}
```

判断标准：

- 认证、授权、登录态：走 Spring Security。
- traceId、访问日志：普通 Filter。
- 当前用户业务上下文：Security 认证后再在 MVC 层补充。

## 执行顺序

Filter 顺序：

```java
registration.setOrder(Ordered.HIGHEST_PRECEDENCE);
```

Interceptor 顺序：

```java
registry.addInterceptor(new TenantInterceptor())
    .order(Ordered.HIGHEST_PRECEDENCE + 10);
```

建议顺序：

```text
Filter:
1. TraceId
2. 请求包装 / 访问日志
3. Spring Security
4. 其他底层处理

Interceptor:
1. 用户 / 租户上下文
2. 幂等 / 注解检查
3. 接口耗时统计
```

不要让顺序靠“刚好现在能跑”。顺序是工程约束，要明确写出来。

## 异常处理

Interceptor 抛异常，通常能进入 Spring MVC 异常处理：

```java
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(BizException.class)
    public ApiResult<Void> handleBizException(BizException exception) {
        return ApiResult.fail(exception.code(), exception.getMessage());
    }
}
```

Filter 抛异常，不一定能被 `@RestControllerAdvice` 接住。

Filter 里更稳的写法：

```java
try {
    filterChain.doFilter(request, response);
} catch (BizException exception) {
    response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
    response.setContentType(MediaType.APPLICATION_JSON_VALUE);
    response.getWriter().write(json.writeValueAsString(ApiResult.fail(exception.code(), exception.getMessage())));
}
```

或者注入 `HandlerExceptionResolver`：

```java
handlerExceptionResolver.resolveException(request, response, null, exception);
```

但不要在 Filter 里到处吞异常，日志和响应要统一。

## 常见坑

### 把鉴权写在 Interceptor

Interceptor 已经在 Spring MVC 层了，太晚。静态资源、错误转发、部分非 MVC 请求可能覆盖不到。安全逻辑优先走 Spring Security Filter Chain。

### Filter 读取 body 后 Controller 读不到

请求体流默认只能读一次。要读 body，用包装类，并控制日志大小。

### 忘记清理 ThreadLocal

Tomcat 线程会复用。用户上下文、租户上下文、traceId 不清理，会串请求。

### 拦截器排除路径漏了

登录、刷新 token、健康检查、OpenAPI 文档经常要排除：

```text
/auth/**
/actuator/**
/swagger-ui/**
/v3/api-docs/**
```

### Filter 执行两次

常见原因：

- 既 `@Component` 注册为普通 Filter。
- 又加进 Spring Security Filter Chain。
- async / error dispatch 没处理好。

`OncePerRequestFilter` 可以减少重复执行问题，但注册重复还是要从配置上解决。

### 在拦截器里写太重的业务

拦截器适合轻量判断。复杂权限、数据权限、状态机还是要放 Service 或安全框架。

## 选择清单

- [ ] 需要在 `DispatcherServlet` 前处理：用 `Filter`。
- [ ] 需要知道 Controller 方法：用 `Interceptor`。
- [ ] 需要认证授权：用 Spring Security。
- [ ] 需要统一响应体：用 `ResponseBodyAdvice`。
- [ ] 需要统一异常：用 `@RestControllerAdvice`。
- [ ] 读取请求体前确认不会影响 Controller。
- [ ] 写了 `ThreadLocal` 就必须清理。
- [ ] 拦截路径和排除路径写清楚。
- [ ] Filter / Interceptor 顺序显式配置。
- [ ] 安全 Filter 没有被重复注册。

## 最后记一句话

Filter 管 HTTP 入口，Interceptor 管 MVC 入口；鉴权交给 Security，业务规则回到 Service。

## 参考

- [Spring Framework Filters](https://docs.spring.io/spring-framework/reference/web/webmvc/filters.html)
- [Spring Framework HandlerInterceptor](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/web/servlet/HandlerInterceptor.html)
- [Spring Security Servlet Architecture](https://docs.spring.io/spring-security/reference/servlet/architecture.html)
