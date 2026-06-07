---
title: 日志 traceId 与审计日志
sidebarTitle: 日志 traceId 与审计
---

# 日志 traceId 与审计日志

> 日志不是越多越好。好日志要能回答：谁、什么时候、请求了什么、结果怎样、失败在哪、能不能串起整条链路。

## 先给结论

后端项目日志先做到这几件事：

- 每个请求都有 `traceId`。
- 日志格式里打印 `traceId`。
- Controller / Filter 记录请求摘要。
- Service 记录关键业务节点。
- 异常日志只在统一出口打堆栈。
- 敏感字段不进日志。
- 重要操作写审计日志。

## 日志级别

| 级别 | 用途 |
| --- | --- |
| `DEBUG` | 本地调试、SQL 参数、细节变量 |
| `INFO` | 关键业务节点、启动信息、重要状态变化 |
| `WARN` | 可恢复异常、第三方超时、降级、重试 |
| `ERROR` | 未知异常、数据不一致、任务失败 |

不要把参数错误、未登录、库存不足这类可预期业务结果都打成 `ERROR`。

## traceId 解决什么

没有 traceId：

```text
用户说：我刚才下单失败了
你只能翻一堆日志猜是哪条
```

有 traceId：

```json
{
  "code": "SYSTEM_ERROR",
  "message": "系统异常",
  "traceId": "0f9d7e9b6d28458a"
}
```

然后直接查：

```text
traceId=0f9d7e9b6d28458a
```

## Filter 生成 traceId

```java
public class TraceIdFilter implements Filter {

    public static final String TRACE_ID = "traceId";

    @Override
    public void doFilter(ServletRequest servletRequest,
                         ServletResponse servletResponse,
                         FilterChain chain) throws IOException, ServletException {
        HttpServletRequest request = (HttpServletRequest) servletRequest;
        String traceId = request.getHeader("X-Trace-Id");
        if (!StringUtils.hasText(traceId)) {
            traceId = UUID.randomUUID().toString().replace("-", "");
        }

        MDC.put(TRACE_ID, traceId);
        try {
            chain.doFilter(servletRequest, servletResponse);
        } finally {
            MDC.remove(TRACE_ID);
        }
    }
}
```

关键点：

- 优先使用上游传来的 `X-Trace-Id`。
- 没有就自己生成。
- 请求结束必须清理 MDC。
- 不清理会在线程池复用时串请求。

注册：

```java
@Bean
public FilterRegistrationBean<TraceIdFilter> traceIdFilter() {
    FilterRegistrationBean<TraceIdFilter> registration = new FilterRegistrationBean<>();
    registration.setFilter(new TraceIdFilter());
    registration.setOrder(Ordered.HIGHEST_PRECEDENCE);
    return registration;
}
```

## 日志格式

`application.yml`：

```yaml
logging:
  pattern:
    level: "%5p [traceId:%X{traceId:-}]"
```

输出类似：

```text
INFO [traceId:0f9d7e9b6d28458a] o.e.f.order.OrderService : create order success, orderId=10001
```

如果接入 Micrometer Tracing，Spring Boot 可以把 tracing 里的 correlation id 带进日志。学习项目先手写 `traceId` 更容易理解。

## 请求日志

请求入口记录摘要，不要记录完整敏感 body。

```java
public class AccessLogFilter implements Filter {

    private static final Logger log = LoggerFactory.getLogger(AccessLogFilter.class);

    @Override
    public void doFilter(ServletRequest servletRequest,
                         ServletResponse servletResponse,
                         FilterChain chain) throws IOException, ServletException {
        HttpServletRequest request = (HttpServletRequest) servletRequest;
        long start = System.currentTimeMillis();

        try {
            chain.doFilter(servletRequest, servletResponse);
        } finally {
            long cost = System.currentTimeMillis() - start;
            log.info("request end, method={}, uri={}, costMs={}, ip={}",
                request.getMethod(),
                request.getRequestURI(),
                cost,
                request.getRemoteAddr()
            );
        }
    }
}
```

不要默认打印：

- 密码。
- token。
- 手机号全量。
- 身份证。
- 银行卡。
- 支付密钥。

## 业务日志怎么写

好的业务日志：

```java
log.info("order created, orderId={}, orderNo={}, userId={}, amount={}",
    order.getId(), order.getOrderNo(), userId, order.getPayAmount());
```

差的业务日志：

```java
log.info("创建订单成功");
```

好日志至少包含：

- 业务动作。
- 关键 ID。
- 当前状态。
- 外部调用结果。
- 耗时。

例如支付：

```java
log.info("payment callback received, orderNo={}, channel={}, channelTradeNo={}, status={}",
    callback.orderNo(), callback.channel(), callback.channelTradeNo(), callback.status());
```

## 异常日志

统一异常处理里打未知异常：

```java
@ExceptionHandler(Exception.class)
public ApiResult<Void> handleException(Exception ex) {
    log.error("unhandled exception", ex);
    return ApiResult.fail(ErrorCode.SYSTEM_ERROR);
}
```

业务异常通常不用打堆栈：

```java
@ExceptionHandler(BizException.class)
public ApiResult<Void> handleBizException(BizException ex) {
    log.info("business exception, code={}, message={}",
        ex.getErrorCode().code(), ex.getMessage());
    return ApiResult.fail(ex.getErrorCode(), ex.getMessage());
}
```

不要在每层都打一次堆栈，否则同一个错误会刷出很多重复日志。

## 审计日志

审计日志记录“谁做了什么”，不是普通 debug 日志。

适合审计：

- 登录成功 / 失败。
- 修改密码。
- 修改用户角色。
- 修改订单价格。
- 审核商品。
- 后台导出数据。
- 删除重要数据。

表设计：

```sql
create table audit_log (
    id bigint primary key auto_increment,
    trace_id varchar(64) not null,
    operator_id bigint null,
    operator_type varchar(32) not null,
    action varchar(64) not null,
    target_type varchar(64) not null,
    target_id varchar(64) null,
    result varchar(32) not null,
    detail_json json null,
    created_at datetime not null,
    index idx_audit_log_trace_id (trace_id),
    index idx_audit_log_operator_time (operator_id, created_at)
);
```

写入：

```java
public void record(AuditCommand command) {
    AuditLogDO auditLog = new AuditLogDO();
    auditLog.setTraceId(MDC.get("traceId"));
    auditLog.setOperatorId(command.operatorId());
    auditLog.setOperatorType(command.operatorType());
    auditLog.setAction(command.action());
    auditLog.setTargetType(command.targetType());
    auditLog.setTargetId(command.targetId());
    auditLog.setResult(command.result());
    auditLog.setDetailJson(command.detailJson());
    auditLogMapper.insert(auditLog);
}
```

审计日志要注意：

- 不记录密码和密钥。
- 重要操作即使失败也可以记录。
- 记录前后差异时要脱敏。
- 审计日志最好只追加，不随意修改。

## 异步线程里的 traceId

MDC 是线程本地变量。新线程不会自动继承。

如果使用线程池：

```java
public class MdcTaskDecorator implements TaskDecorator {

    @Override
    public Runnable decorate(Runnable runnable) {
        Map<String, String> contextMap = MDC.getCopyOfContextMap();
        return () -> {
            if (contextMap != null) {
                MDC.setContextMap(contextMap);
            }
            try {
                runnable.run();
            } finally {
                MDC.clear();
            }
        };
    }
}
```

配置：

```java
@Bean
public ThreadPoolTaskExecutor applicationTaskExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setTaskDecorator(new MdcTaskDecorator());
    return executor;
}
```

否则异步日志会丢 `traceId`。

## 去空话检查

- [ ] 每个请求都有 traceId。
- [ ] 日志格式打印 traceId。
- [ ] MDC 请求结束后清理。
- [ ] 异步线程能传递 traceId 或明确不需要。
- [ ] 未知异常只在统一异常处理里打堆栈。
- [ ] 密码、token、密钥不进日志。
- [ ] 重要后台操作有审计日志。

## 参考

- [Spring Boot Logging](https://docs.spring.io/spring-boot/reference/features/logging.html)
- [Spring Boot Tracing](https://docs.spring.io/spring-boot/reference/actuator/tracing.html)
