---
title: Bean Validation 参数校验
sidebarTitle: Bean Validation
---

# Bean Validation 参数校验

> 参数校验不是“前端已经校验过了”。后端必须在接口入口把非法数据挡住，并返回稳定的错误码。

## 先给结论

Spring Boot Web 项目里常用组合：

```text
spring-boot-starter-validation
@Valid / @Validated
DTO 字段约束
全局异常处理
统一错误码
```

落地位置：

```text
Controller：校验 HTTP 入参格式
Service：校验业务规则
数据库：用唯一索引、非空、外键或条件更新兜底
```

不要把所有校验都写在 Controller，也不要只靠注解处理业务规则。

## 依赖

Spring Boot 3 / 4 项目通常引：

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-validation</artifactId>
</dependency>
```

常见包名：

```java
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
```

老项目可能还是 `javax.validation`，新项目优先用 `jakarta.validation`。

## Request DTO 校验

```java
public record CreateUserRequest(
    @NotBlank(message = "用户名不能为空")
    @Size(max = 32, message = "用户名不能超过 32 个字符")
    String username,

    @NotBlank(message = "手机号不能为空")
    @Pattern(regexp = "^1\\d{10}$", message = "手机号格式不正确")
    String mobile,

    @NotBlank(message = "密码不能为空")
    @Size(min = 8, max = 64, message = "密码长度必须在 8 到 64 位之间")
    String password
) {
}
```

Controller 要加 `@Valid`：

```java
@PostMapping("/users")
public ApiResult<Long> create(@Valid @RequestBody CreateUserRequest request) {
    Long userId = userService.create(request);
    return ApiResult.success(userId);
}
```

如果不加 `@Valid`，字段注解不会自动生效。

## 常用约束

| 注解 | 用途 | 注意 |
| --- | --- | --- |
| `@NotNull` | 不能为 `null` | 字符串空串也能通过 |
| `@NotBlank` | 字符串非空且非空白 | 只用于字符串 |
| `@NotEmpty` | 集合、数组、字符串非空 | 字符串空白能通过 |
| `@Size` | 长度或集合大小 | 不判断是否为 null |
| `@Min` / `@Max` | 数值范围 | 常用于整数 |
| `@DecimalMin` / `@DecimalMax` | 小数范围 | 常用于金额 |
| `@Pattern` | 正则 | 正则不要写得过度复杂 |
| `@Email` | 邮箱 | 只做基础格式判断 |
| `@Positive` | 必须大于 0 | ID、数量常用 |
| `@Future` / `@Past` | 时间约束 | 注意时区和业务语义 |

组合使用：

```java
public record PageRequest(
    @NotNull(message = "页码不能为空")
    @Min(value = 1, message = "页码必须从 1 开始")
    Integer pageNo,

    @NotNull(message = "每页条数不能为空")
    @Min(value = 1, message = "每页条数不能小于 1")
    @Max(value = 100, message = "每页条数不能超过 100")
    Integer pageSize
) {
}
```

## 嵌套对象校验

嵌套对象要在字段上加 `@Valid`：

```java
public record CreateOrderRequest(
    @NotEmpty(message = "订单商品不能为空")
    List<@Valid OrderItemRequest> items,

    @Valid
    AddressRequest address
) {
}
```

子对象：

```java
public record OrderItemRequest(
    @NotNull(message = "skuId 不能为空")
    Long skuId,

    @NotNull(message = "购买数量不能为空")
    @Min(value = 1, message = "购买数量必须大于 0")
    Integer count
) {
}
```

没有 `@Valid` 时，外层对象能校验，里面的字段不会递归校验。

## Query 参数校验

如果是 `@RequestParam` 或 `@PathVariable`：

```java
@RestController
@RequestMapping("/api/products")
@Validated
public class ProductController {

    @GetMapping("/{productId}")
    public ApiResult<ProductDetailVO> detail(
            @PathVariable @Positive(message = "商品 ID 必须大于 0") Long productId) {
        return ApiResult.success(productService.getDetail(productId));
    }
}
```

注意版本差异：

- Spring MVC 对方法参数校验支持在新版本里更完整。
- Controller 类级别 `@Validated` 在不同版本行为有差异。
- 项目里要以当前 Spring Boot / Spring Framework 版本实际行为为准。

简单做法：请求体用 `@Valid @RequestBody`，query/path 参数在 Controller 入口或 Service 里再做显式校验。

## 分组校验

新增和更新的校验规则可能不同。

定义分组：

```java
public interface CreateGroup {
}

public interface UpdateGroup {
}
```

DTO：

```java
public record ProductRequest(
    @NotNull(groups = UpdateGroup.class, message = "商品 ID 不能为空")
    Long id,

    @NotBlank(groups = {CreateGroup.class, UpdateGroup.class}, message = "商品名称不能为空")
    String name
) {
}
```

Controller：

```java
@PostMapping
public ApiResult<Long> create(@Validated(CreateGroup.class) @RequestBody ProductRequest request) {
    return ApiResult.success(productService.create(request));
}

@PutMapping
public ApiResult<Void> update(@Validated(UpdateGroup.class) @RequestBody ProductRequest request) {
    productService.update(request);
    return ApiResult.success();
}
```

分组不要滥用。规则太复杂时，拆成 `CreateProductRequest` 和 `UpdateProductRequest` 更清楚。

## 自定义校验注解

比如校验枚举值：

```java
@Target({ElementType.FIELD, ElementType.PARAMETER})
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = EnumValueValidator.class)
public @interface EnumValue {

    Class<? extends Enum<?>> enumClass();

    String message() default "枚举值不合法";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
```

校验器：

```java
public class EnumValueValidator implements ConstraintValidator<EnumValue, String> {

    private Set<String> values;

    @Override
    public void initialize(EnumValue annotation) {
        values = Arrays.stream(annotation.enumClass().getEnumConstants())
            .map(Enum::name)
            .collect(Collectors.toSet());
    }

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        return value == null || values.contains(value);
    }
}
```

使用：

```java
public record UpdateOrderStatusRequest(
    @EnumValue(enumClass = OrderStatus.class, message = "订单状态不合法")
    String status
) {
}
```

这里允许 `null`，是否必填交给 `@NotBlank`。

## 全局异常处理

请求体字段校验失败常见是 `MethodArgumentNotValidException`：

```java
@ExceptionHandler(MethodArgumentNotValidException.class)
public ApiResult<Void> handleMethodArgumentNotValid(MethodArgumentNotValidException ex) {
    FieldError fieldError = ex.getBindingResult().getFieldErrors().stream()
        .findFirst()
        .orElse(null);

    String message = fieldError == null ? "参数错误" : fieldError.getDefaultMessage();
    String field = fieldError == null ? null : fieldError.getField();
    return ApiResult.fail(ErrorCode.PARAM_INVALID, message, field);
}
```

方法参数校验失败常见是 `ConstraintViolationException`：

```java
@ExceptionHandler(ConstraintViolationException.class)
public ApiResult<Void> handleConstraintViolation(ConstraintViolationException ex) {
    String message = ex.getConstraintViolations().stream()
        .findFirst()
        .map(ConstraintViolation::getMessage)
        .orElse("参数错误");
    return ApiResult.fail(ErrorCode.PARAM_INVALID, message);
}
```

返回给前端要稳定：

```json
{
  "code": "PARAM_INVALID",
  "message": "手机号格式不正确",
  "data": null
}
```

## 校验和业务规则的边界

参数校验解决格式问题：

```text
手机号格式对不对
数量是不是大于 0
页大小是不是超过 100
商品 ID 是否为空
```

业务校验解决业务状态：

```text
商品是否上架
库存是否足够
用户是否被禁用
优惠券是否已经领取
订单是否属于当前用户
```

业务规则不要硬塞进注解里。它们通常需要查库、查 Redis、看上下文，更适合放 Service 或 Validator 组件。

```java
public void validateCanPay(OrderDO order, Long userId) {
    if (!Objects.equals(order.getUserId(), userId)) {
        throw new BizException(ErrorCode.ORDER_NOT_FOUND);
    }
    if (!OrderStatus.WAIT_PAY.name().equals(order.getStatus())) {
        throw new BizException(ErrorCode.ORDER_STATUS_INVALID);
    }
}
```

## 去空话检查

- [ ] `@RequestBody` DTO 上加了 `@Valid` 或 `@Validated`。
- [ ] 嵌套对象字段加了 `@Valid`。
- [ ] query/path 参数校验在当前 Spring 版本下真的生效。
- [ ] 全局异常处理能返回统一错误码。
- [ ] 参数格式校验和业务规则校验分开。
- [ ] 分组校验没有让一个 DTO 变得难懂。

## 参考

- [Spring Boot Validation](https://docs.spring.io/spring-boot/reference/io/validation.html)
- [Spring Framework Bean Validation](https://docs.spring.io/spring-framework/reference/core/validation/beanvalidation.html)
- [Spring MVC Validation](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller/ann-validation.html)
