---
title: 统一异常与错误码
sidebarTitle: 统一异常与错误码
---

# 统一异常与错误码

> 后端接口不能靠一堆 `RuntimeException("失败了")` 过日子。错误码要让前端能处理、日志能定位、排查能闭环。

## 统一响应结构

```java
public record ApiResult<T>(
    String code,
    String message,
    T data,
    String traceId
) {
    public static <T> ApiResult<T> success(T data) {
        return new ApiResult<>("SUCCESS", "成功", data, TraceId.current());
    }

    public static ApiResult<Void> fail(ErrorCode errorCode) {
        return new ApiResult<>(errorCode.code(), errorCode.message(), null, TraceId.current());
    }

    public static ApiResult<Void> fail(ErrorCode errorCode, String message) {
        return new ApiResult<>(errorCode.code(), message, null, TraceId.current());
    }
}
```

成功和失败都带 `traceId`，方便用户截图后定位日志。

文件下载、SSE、第三方回调可以不走这个结构。

## 错误码枚举

```java
public enum ErrorCode {

    SUCCESS("SUCCESS", "成功"),
    PARAM_INVALID("PARAM_INVALID", "参数错误"),
    UNAUTHORIZED("UNAUTHORIZED", "请先登录"),
    FORBIDDEN("FORBIDDEN", "没有权限"),
    RESOURCE_NOT_FOUND("RESOURCE_NOT_FOUND", "资源不存在"),
    ORDER_STATUS_INVALID("ORDER_STATUS_INVALID", "订单状态不正确"),
    STOCK_NOT_ENOUGH("STOCK_NOT_ENOUGH", "库存不足"),
    TOO_MANY_REQUESTS("TOO_MANY_REQUESTS", "请求过于频繁"),
    SYSTEM_ERROR("SYSTEM_ERROR", "系统异常");

    private final String code;
    private final String message;

    ErrorCode(String code, String message) {
        this.code = code;
        this.message = message;
    }

    public String code() {
        return code;
    }

    public String message() {
        return message;
    }
}
```

错误码命名建议：

```text
PARAM_INVALID
USER_DISABLED
ORDER_NOT_FOUND
ORDER_STATUS_INVALID
COUPON_ALREADY_RECEIVED
STOCK_NOT_ENOUGH
MQ_SEND_FAILED
```

不要这样：

```text
ERROR_001
FAIL
BAD
EXCEPTION
```

数字码不是不能用，但学习和项目笔记里字符串码更直观。

## 业务异常

```java
public class BizException extends RuntimeException {

    private final ErrorCode errorCode;

    public BizException(ErrorCode errorCode) {
        super(errorCode.message());
        this.errorCode = errorCode;
    }

    public BizException(ErrorCode errorCode, String message) {
        super(message);
        this.errorCode = errorCode;
    }

    public ErrorCode getErrorCode() {
        return errorCode;
    }
}
```

Service 里抛业务异常：

```java
public void pay(Long orderId, Long userId) {
    OrderDO order = orderMapper.selectById(orderId);
    if (order == null || !Objects.equals(order.getUserId(), userId)) {
        throw new BizException(ErrorCode.RESOURCE_NOT_FOUND);
    }
    if (!OrderStatus.WAIT_PAY.name().equals(order.getStatus())) {
        throw new BizException(ErrorCode.ORDER_STATUS_INVALID);
    }
}
```

不要在 Service 返回 `false`、`null` 让 Controller 猜原因。

## 全局异常处理

```java
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(BizException.class)
    public ApiResult<Void> handleBizException(BizException ex) {
        return ApiResult.fail(ex.getErrorCode(), ex.getMessage());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ApiResult<Void> handleValidationException(MethodArgumentNotValidException ex) {
        String message = ex.getBindingResult().getFieldErrors().stream()
            .findFirst()
            .map(FieldError::getDefaultMessage)
            .orElse("参数错误");
        return ApiResult.fail(ErrorCode.PARAM_INVALID, message);
    }

    @ExceptionHandler(Exception.class)
    public ApiResult<Void> handleException(Exception ex) {
        log.error("unhandled exception", ex);
        return ApiResult.fail(ErrorCode.SYSTEM_ERROR);
    }
}
```

关键点：

- 业务异常不一定要打 error 日志。
- 未知异常必须打 error 日志和堆栈。
- 返回给前端的未知异常统一成 `SYSTEM_ERROR`。
- 不把异常堆栈直接返回给前端。

## HTTP 状态码怎么用

两种常见风格：

### 业务统一 200

```json
{
  "code": "ORDER_STATUS_INVALID",
  "message": "订单状态不正确"
}
```

优点：前端处理简单。

缺点：网关、监控不容易从 HTTP 状态看出失败。

### HTTP 状态表达大类

| 场景 | HTTP 状态 |
| --- | --- |
| 参数错误 | 400 |
| 未登录 | 401 |
| 无权限 | 403 |
| 资源不存在 | 404 |
| 限流 | 429 |
| 系统异常 | 500 |

学习项目可以先统一 200，但要知道生产项目可能需要更标准的 HTTP 状态。

## 错误码分层

可以按模块前缀：

```text
USER_NOT_FOUND
USER_DISABLED
AUTH_TOKEN_EXPIRED
ORDER_NOT_FOUND
ORDER_STATUS_INVALID
PRODUCT_OFF_SHELF
STOCK_NOT_ENOUGH
COUPON_EXPIRED
```

也可以按数字段：

```text
100001 参数错误
200001 用户不存在
300001 订单不存在
```

无论哪种，都要有规则：

- 错误码不能随便改。
- message 可以优化，code 要稳定。
- 前端逻辑判断用 code，不用 message。
- 同一个错误不要到处定义多个 code。

## 日志级别

| 异常 | 建议日志 |
| --- | --- |
| 参数校验失败 | 不打或 debug |
| 用户未登录 | 不打或 debug |
| 业务状态不满足 | info 或不打 |
| 库存不足 | info 或不打 |
| 外部服务超时 | warn |
| 数据库异常 | error |
| 空指针、未知异常 | error |

不要把可预期业务失败都打成 error。

否则日志会被“库存不足”“参数错误”淹没，真正系统异常反而看不见。

## Controller 不要到处 try-catch

错误示例：

```java
@PostMapping("/orders")
public ApiResult<Long> create(@RequestBody CreateOrderRequest request) {
    try {
        return ApiResult.success(orderService.create(request));
    } catch (Exception ex) {
        return ApiResult.fail(ErrorCode.SYSTEM_ERROR);
    }
}
```

问题：

- 吞掉真实异常。
- 每个接口重复。
- 事务可能因为异常被吞而不回滚。
- 日志不统一。

正确做法：让异常抛出去，交给全局异常处理。

## 事务里的异常

如果方法有事务：

```java
@Transactional(rollbackFor = Exception.class)
public void createOrder(CreateOrderCommand command) {
    orderMapper.insert(order);
    if (stockNotEnough) {
        throw new BizException(ErrorCode.STOCK_NOT_ENOUGH);
    }
}
```

不要 catch 后不抛：

```java
try {
    orderMapper.insert(order);
} catch (Exception ex) {
    log.error("create order failed", ex);
}
```

这样事务可能提交部分数据。

## 错误码文档

项目里最好维护一张错误码表：

| code | message | 场景 | 前端处理 |
| --- | --- | --- | --- |
| `PARAM_INVALID` | 参数错误 | 请求参数不合法 | 提示字段错误 |
| `UNAUTHORIZED` | 请先登录 | token 缺失/过期 | 跳登录 |
| `ORDER_STATUS_INVALID` | 订单状态不正确 | 重复支付/取消 | 刷新订单 |
| `STOCK_NOT_ENOUGH` | 库存不足 | 创建订单 | 提示用户 |
| `SYSTEM_ERROR` | 系统异常 | 未知异常 | 通用错误页 |

错误码一旦被前端依赖，就不要随手改名。

## 去空话检查

- [ ] 接口失败返回稳定 `code`，不是只返回中文 message。
- [ ] 业务异常和系统异常分开。
- [ ] 未知异常打 error 日志，但不把堆栈返回前端。
- [ ] Controller 不到处写重复 try-catch。
- [ ] 事务方法不吞异常。
- [ ] 前端逻辑判断用错误码，不用中文文案。
