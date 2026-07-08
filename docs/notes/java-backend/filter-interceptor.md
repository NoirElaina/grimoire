---
title: 过滤器与拦截器
sidebarTitle: 过滤器与拦截器
---

# 过滤器与拦截器

> Filter 和 Interceptor 都能“拦请求”，但它们属于不同层、由不同东西驱动：Filter 是 Servlet 规范的、由 Servlet 容器驱动；Interceptor 是 Spring MVC 的、由 DispatcherServlet 驱动。把“谁在什么时候、用什么机制调用它们”讲清楚，选型和排查就都顺了。

## 请求经过哪里

一条请求从进来到出去，大致是这样穿过各层的：

```text
Client
  -> Servlet Filter Chain（多个 Filter 依次 doFilter）
  -> DispatcherServlet
  -> HandlerMapping 找到 Controller + 拦截器链
  -> Interceptor.preHandle()        （正序）
  -> Controller 方法（AOP 在这一层包在方法外）
  -> Interceptor.postHandle()       （逆序，渲染前）
  -> 视图渲染 / 写响应体
  -> Interceptor.afterCompletion()  （逆序，最后）
  -> Servlet Filter Chain 返回阶段（doFilter 调用栈回弹）
  -> Client
```

记住几个分界点：

- **Filter 在 `DispatcherServlet` 之外**，比 Spring MVC 的一切都早，也比一切都晚（去程和回程都经过它）。
- **Interceptor 在 `DispatcherServlet` 内部**，要等 `HandlerMapping` 找到了具体 handler 才执行，所以它能拿到 Controller 方法。
- **AOP 在 Controller/Service 方法这一层**，包在目标方法的外面。

## Filter 的机制：责任链 + 递归

Filter 来自 Servlet 规范（`jakarta.servlet.Filter`），由 **Servlet 容器（Tomcat）** 管理，和 Spring 没有必然关系。多个 Filter 组成一条责任链，核心就一个方法：

```java
public void doFilter(ServletRequest req, ServletResponse resp, FilterChain chain) {
    // 前置处理
    chain.doFilter(req, resp);   // 调用链上下一个 Filter；到末尾就进入 DispatcherServlet
    // 后置处理（请求处理完回弹时执行）
}
```

关键在 `chain.doFilter()`：它把控制权交给链上的下一个节点，**本质是一个递归调用栈**。所以 `chain.doFilter()` 之前的代码是“去程”，之后的代码是“回程”：

```text
FilterA 前  ->  FilterB 前  ->  DispatcherServlet 处理  ->  FilterB 后  ->  FilterA 后
```

两个直接后果：

- **必须调用 `chain.doFilter()`**，否则请求被截断，不会往下走。
- 想在响应返回后做事（比如打印耗时、清理），就写在 `chain.doFilter()` 之后。

因为 Filter 在最外层、能直接拿到原始的 `HttpServletRequest`/`HttpServletResponse`，它能做最底层的事：包装请求/响应、改字符编码、CORS、traceId。但它**不知道这次请求会进哪个 Controller 方法**——那是 MVC 找 handler 之后才确定的。

### OncePerRequestFilter 为什么需要

Spring 提供的 `OncePerRequestFilter` 保证**一次请求只执行一次**。为什么会执行多次？因为 `forward`、`include`、异步 `dispatch` 等会让请求在容器内被再次 dispatch，普通 Filter 可能被重复触发。`OncePerRequestFilter` 的做法是在 request 上打一个属性标记，进来时先检查标记，已处理过就跳过。写 traceId、鉴权这类“只该做一次”的逻辑，继承它最稳。

## Interceptor 的机制：DispatcherServlet 主动调用

Interceptor 是 Spring MVC 的概念（`HandlerInterceptor`），不是 Servlet 规范的。它由 `DispatcherServlet.doDispatch` 在内部主动调用，挂在 `HandlerExecutionChain`（handler + 拦截器列表）上。三个回调对应 doDispatch 的不同阶段：

```java
// doDispatch 内部（简化）
if (!mappedHandler.applyPreHandle(request, response)) return;  // preHandle 返回 false 直接结束
ModelAndView mv = ha.handle(request, response, handler);       // 调 Controller
mappedHandler.applyPostHandle(request, response, mv);          // postHandle
// ... 渲染视图 ...
mappedHandler.triggerAfterCompletion(request, response, ex);   // afterCompletion（含异常路径）
```

| 回调 | 时机 | 典型用途 |
| --- | --- | --- |
| `preHandle` | Controller 执行**前** | 登录/租户上下文、权限前置判断、幂等检查；返回 `false` 中断 |
| `postHandle` | Controller 执行**后、视图渲染前** | 改 ModelAndView（前后端分离用得少） |
| `afterCompletion` | 整个请求完成后（含异常） | 清理 ThreadLocal、记录耗时 |

因为 Interceptor 能拿到 `handler`（通常是 `HandlerMethod`），所以它能读 Controller 方法上的注解、判断进的是哪个方法——这是 Filter 做不到的。

### 多个拦截器的执行顺序

这是高频考点。`preHandle` **正序**执行，`postHandle` 和 `afterCompletion` **逆序**执行，像入栈出栈：

```text
拦截器注册顺序：A、B、C

preHandle:        A -> B -> C
Controller
postHandle:       C -> B -> A
afterCompletion:  C -> B -> A
```

还有一条容易被问的规则：**只要某个拦截器的 `preHandle` 返回过 `true`，它的 `afterCompletion` 就一定会被回调**；中途某个 `preHandle` 返回 `false`，则只回调“已经成功执行过 preHandle”的那些拦截器的 `afterCompletion`，且是逆序。这保证了已经分配的资源（比如设进 ThreadLocal 的上下文）总有机会清理。

```text
A.preHandle = true
B.preHandle = true
C.preHandle = false   -> 中断，不进 Controller
afterCompletion: B -> A   （C 没成功，不回调；A、B 逆序清理）
```

## Filter、Interceptor、AOP 三者怎么区分

面试常把三者放一起问，本质是“拦截发生在哪一层”：

| | Filter | Interceptor | AOP |
| --- | --- | --- | --- |
| 规范/来源 | Servlet 规范 | Spring MVC | Spring AOP（动态代理） |
| 谁驱动 | Servlet 容器 | DispatcherServlet | 代理对象调用方法时 |
| 作用层 | 进 MVC 之前的最外层 | Controller 前后 | 任意 Spring Bean 的方法前后 |
| 能拿到什么 | 原始 request/response | HandlerMethod（Controller 方法） | 方法签名、入参、返回值、异常 |
| 拿不到什么 | 不知道是哪个 Controller 方法 | 拿不到方法入参的解析结果（在它之后） | 不接触 HTTP 原始报文 |
| 典型用途 | traceId、日志、编码、CORS、安全过滤 | 登录/租户上下文、接口耗时、注解检查 | 事务、方法级日志、缓存、权限、参数校验切面 |

包裹关系由外到内：

```text
Filter
 └─ DispatcherServlet
     └─ Interceptor.preHandle
         └─ AOP 切面
             └─ Controller 方法
```

所以想拿方法入参/返回值做事用 AOP；想结合 HTTP 上下文和 Controller 方法用 Interceptor；想处理最原始的 HTTP 请求用 Filter。

## 怎么选

| 需求 | 用什么 |
| --- | --- |
| traceId、请求日志、CORS、编码、包装 request/response | `Filter` |
| JWT / Spring Security 鉴权 | Spring Security Filter Chain |
| 登录用户上下文、租户上下文、接口耗时 | `HandlerInterceptor` |
| Controller 返回统一包装 | `ResponseBodyAdvice` |
| Controller 异常统一处理 | `@RestControllerAdvice` |
| 方法级权限、事务、方法日志 | Spring AOP / `@PreAuthorize` |

总的来说，越靠近 HTTP 原始请求用 `Filter`，越靠近 Controller 业务语义用 `Interceptor`，要操作方法入参/返回值用 `AOP`；**鉴权不要自己随便写 Interceptor，优先接 Spring Security**。

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

注册并指定顺序：

```java
@Configuration
public class WebFilterConfig {

    @Bean
    public FilterRegistrationBean<TraceIdFilter> traceIdFilterRegistration() {
        FilterRegistrationBean<TraceIdFilter> registration = new FilterRegistrationBean<>();
        registration.setFilter(new TraceIdFilter());
        registration.addUrlPatterns("/*");
        registration.setOrder(Ordered.HIGHEST_PRECEDENCE);   // 越小越靠外，traceId 要最早
        return registration;
    }
}
```

要点：

- traceId 用 Filter 而不是 Interceptor，就是为了**尽早**进日志上下文，连 Spring Security 抛的异常日志都能带上 traceId。
- `MDC` 底层是 ThreadLocal，Tomcat 线程会复用，清理必须放 `finally`，否则串日志。

## Filter 示例：访问日志（读 body）

请求体的流默认**只能读一次**，Filter 读了 Controller 就读不到。要记录 body 必须用包装类缓存：

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
                request.getMethod(), request.getRequestURI(), responseWrapper.getStatus(), cost);
            responseWrapper.copyBodyToResponse();   // 不能忘，否则响应体丢失
        }
    }
}
```

注意：`copyBodyToResponse()` 必须调用；不要默认打印完整 body；密码、token、身份证、手机号要脱敏；大文件上传/下载接口要排除；日志量大要采样。

## Interceptor 示例：租户上下文

```java
public class TenantInterceptor implements HandlerInterceptor {

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler)
            throws Exception {
        String tenantId = request.getHeader("X-Tenant-Id");
        if (!StringUtils.hasText(tenantId)) {
            response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.getWriter().write("{\"code\":\"TENANT_REQUIRED\",\"message\":\"租户不能为空\"}");
            return false;   // 中断，不进 Controller
        }
        TenantContext.set(tenantId);
        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response,
                                Object handler, Exception ex) {
        TenantContext.clear();   // ThreadLocal 必须清理
    }
}
```

注册并排除放行路径：

```java
@Configuration
public class WebMvcConfig implements WebMvcConfigurer {

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new TenantInterceptor())
            .addPathPatterns("/**")
            .excludePathPatterns("/auth/**", "/actuator/**", "/swagger-ui/**", "/v3/api-docs/**")
            .order(Ordered.HIGHEST_PRECEDENCE + 10);
    }
}
```

要点：`preHandle` 返回 `false` 后 Controller 不执行；如果已经写了响应就别再放行；上下文在 `set` 之后若 `preHandle` 返回 `false`，要么在那之前清理，要么确认 `afterCompletion` 会兜底清理。

## Interceptor 示例：基于注解的检查

Interceptor 能拿到 `HandlerMethod`，所以能读方法上的注解做“接口级切面”。

```java
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface Idempotent {
    String key();
    long ttlSeconds() default 60;
}
```

```java
public class IdempotentInterceptor implements HandlerInterceptor {

    private final IdempotentService idempotentService;

    public IdempotentInterceptor(IdempotentService idempotentService) {
        this.idempotentService = idempotentService;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler)
            throws Exception {
        if (!(handler instanceof HandlerMethod handlerMethod)) {
            return true;   // 静态资源等非 Controller 请求直接放行
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
        if (!idempotentService.tryAcquire(requestId, annotation.ttlSeconds())) {
            response.setStatus(HttpServletResponse.SC_CONFLICT);
            response.getWriter().write("{\"code\":\"DUPLICATE_REQUEST\"}");
            return false;
        }
        return true;
    }
}
```

这种适合做轻量的接口级前置判断，但**核心幂等结果仍要靠数据库唯一约束、状态机或业务流水兜住**，拦截器只是第一道闸。

## 和 Spring Security 的关系

Spring Security 本质上也是一组 Filter（`FilterChainProxy` 里串了一长串 Security Filter）。所以 JWT 鉴权应放进 Security Filter Chain，而不是自己写 Interceptor：

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
                .anyRequest().authenticated())
            .addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class)
            .build();
    }
}
```

一个坑：如果自定义 JWT Filter 既被 Spring 当普通 Servlet Filter 注册（比如标了 `@Component`），又被加进 Security Filter Chain，会**执行两次**。可以禁掉普通注册：

```java
@Bean
public FilterRegistrationBean<JwtAuthenticationFilter> jwtFilterRegistration(
        JwtAuthenticationFilter filter) {
    FilterRegistrationBean<JwtAuthenticationFilter> registration = new FilterRegistrationBean<>(filter);
    registration.setEnabled(false);   // 只让它在 Security Chain 里生效
    return registration;
}
```

判断标准：认证授权走 Security；traceId/访问日志走普通 Filter；业务上下文在认证之后于 MVC 层补充。**为什么鉴权不放 Interceptor**：Interceptor 在 MVC 层、太晚，静态资源、错误转发、部分非 MVC 请求可能覆盖不到，安全应该在更外层的 Filter 层兜住。

## 异常处理的边界

Interceptor 抛的异常在 `DispatcherServlet` 内部，能被 `@RestControllerAdvice` / `HandlerExceptionResolver` 接住。**Filter 抛的异常在 MVC 之外，`@RestControllerAdvice` 接不住**——这是高频坑。

Filter 里要么自己写响应：

```java
try {
    filterChain.doFilter(request, response);
} catch (BizException ex) {
    response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
    response.setContentType(MediaType.APPLICATION_JSON_VALUE);
    response.getWriter().write(objectMapper.writeValueAsString(
            ApiResult.fail(ex.code(), ex.getMessage())));
}
```

要么显式交给 `HandlerExceptionResolver` 处理。不要在 Filter 里到处吞异常，响应和日志要统一。

## 执行顺序怎么配

Filter 用 `order`，越小越靠外：

```java
registration.setOrder(Ordered.HIGHEST_PRECEDENCE);
```

Interceptor 用 `order`：

```java
registry.addInterceptor(new TenantInterceptor()).order(Ordered.HIGHEST_PRECEDENCE + 10);
```

建议顺序：

```text
Filter（由外到内）:
1. TraceId
2. 请求包装 / 访问日志
3. Spring Security

Interceptor（preHandle 正序）:
1. 用户 / 租户上下文
2. 幂等 / 注解检查
3. 接口耗时统计
```

不要让顺序靠“刚好现在能跑”，顺序是工程约束，要显式写出来。

## 常见坑

### 把鉴权写在 Interceptor

太晚，覆盖不全。认证授权优先走 Spring Security Filter Chain。

### Filter 读了 body 后 Controller 读不到

请求体流只能读一次，要读 body 用 `ContentCachingRequestWrapper` 包装，并控制日志大小。

### 忘记清理 ThreadLocal

Tomcat 线程复用，用户/租户上下文、traceId 不清理会串请求。Filter 放 `finally`，Interceptor 放 `afterCompletion`。

### 拦截器排除路径漏配

登录、刷新 token、健康检查、OpenAPI 文档常要排除：`/auth/**`、`/actuator/**`、`/swagger-ui/**`、`/v3/api-docs/**`。

### Filter 执行两次

常因既 `@Component` 注册成普通 Filter、又加进 Security Chain，或 async/error dispatch 没处理。`OncePerRequestFilter` 能缓解重复执行，但重复**注册**要从配置上解决。

### 在拦截器里写重业务

拦截器适合轻量判断，复杂权限、数据权限、状态机放 Service 或 AOP。

## 选择清单

- [ ] 能说清 Filter 由容器驱动、Interceptor 由 DispatcherServlet 驱动、AOP 由代理驱动。
- [ ] 能讲清 Filter 的 `doFilter` 递归调用链（去程/回程）。
- [ ] 能讲清拦截器三个回调时机，以及多拦截器 pre 正序、post/after 逆序。
- [ ] 能区分 Filter / Interceptor / AOP 的作用层和能拿到的信息。
- [ ] 需要 Controller 方法信息用 Interceptor，需要原始 HTTP 用 Filter，需要方法入参/返回值用 AOP。
- [ ] 认证授权走 Spring Security，不自己写 Interceptor。
- [ ] 读请求体用包装类，且不影响 Controller。
- [ ] 写了 ThreadLocal 就在 finally / afterCompletion 清理。
- [ ] 知道 Filter 抛的异常 @RestControllerAdvice 接不住。
- [ ] Filter / Interceptor 顺序显式配置，安全 Filter 没被重复注册。

## 参考

- [Spring Framework Filters](https://docs.spring.io/spring-framework/reference/web/webmvc/filters.html)
- [Spring Framework HandlerInterceptor](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/web/servlet/HandlerInterceptor.html)
- [Spring Security Servlet Architecture](https://docs.spring.io/spring-security/reference/servlet/architecture.html)
