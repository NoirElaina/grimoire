---
title: 接口设计
sidebarTitle: 接口设计
---

# 接口设计

> 接口设计先把“资源、参数、返回、错误、权限、幂等”定清楚，再写 Controller。

## 先给结论

后端接口最容易乱在这些地方：

- URL 一会儿名词一会儿动词。
- 请求体直接用 Entity。
- 错误码每个接口自己发明。
- 分页、排序、筛选没有统一约定。
- 权限和幂等没写进设计。
- Controller 里夹业务逻辑。

一版合格接口，至少要写清：

- 谁调用。
- 调什么资源。
- 需要什么权限。
- 请求参数和校验规则。
- 成功返回结构。
- 失败错误码。
- 是否分页、排序、幂等。

## URL 先按资源设计

推荐：

```text
GET    /users                 查询用户列表
POST   /users                 创建用户
GET    /users/{userId}        查询用户详情
PUT    /users/{userId}        整体更新用户
PATCH  /users/{userId}        局部更新用户
DELETE /users/{userId}        删除用户
```

不要：

```text
POST /createUser
POST /queryUserList
POST /deleteUser
GET  /user/getById
```

动作类接口可以放到资源下面：

```text
POST /orders/{orderId}/cancel
POST /orders/{orderId}/pay
POST /orders/{orderId}/confirm-receipt
```

判断方法：

- 能用资源 + HTTP 方法表达，就不要在 URL 里写动词。
- 业务动作确实不是 CRUD，就用子资源动作。
- URL 用复数名词：`/users`、`/orders`。
- 路径参数放资源 ID，筛选条件放 query。

## HTTP 方法约定

| 方法 | 用法 | 是否幂等 |
| --- | --- | --- |
| `GET` | 查询 | 是 |
| `POST` | 创建、提交动作 | 通常否 |
| `PUT` | 整体替换 | 是 |
| `PATCH` | 局部修改 | 通常是，但看实现 |
| `DELETE` | 删除 | 是 |

注意：

- `GET` 不要产生业务写入。
- `POST` 创建成功可以返回新资源 ID。
- `PUT` 更适合“客户端提交完整对象”。
- `PATCH` 更适合只改几个字段。
- 删除如果是逻辑删除，也还是用 `DELETE`。

## 请求参数放哪里

路径参数：资源 ID。

```http
GET /users/10001
```

query 参数：筛选、分页、排序。

```http
GET /orders?userId=10001&status=PAID&pageNo=1&pageSize=20
```

body：创建、修改的复杂数据。

```json
{
  "username": "alice",
  "mobile": "13800138000",
  "roleIds": [1, 2]
}
```

Header：认证、追踪、幂等。

```http
Authorization: Bearer <access-token>
X-Trace-Id: 7f32e1c9f3a44b61
Idempotency-Key: order-10001-pay-1
```

## 请求 DTO 独立出来

不要让 Entity 进 Controller：

```java
public record CreateUserRequest(
    @NotBlank(message = "用户名不能为空")
    @Size(max = 30, message = "用户名不能超过30个字符")
    String username,

    @NotBlank(message = "手机号不能为空")
    @Pattern(regexp = "^1\\d{10}$", message = "手机号格式不正确")
    String mobile,

    @NotEmpty(message = "角色不能为空")
    List<Long> roleIds
) {

    public CreateUserCommand toCommand() {
        return new CreateUserCommand(username, mobile, roleIds);
    }
}
```

为什么要独立：

- Entity 字段经常比接口多。
- Entity 可能有内部字段：`deleted`、`version`、`createTime`。
- 请求字段有校验规则。
- 接口演进不应该被表结构绑死。

## 返回 VO 独立出来

```java
public record UserDetailVO(
    Long id,
    String username,
    String mobile,
    List<String> roles,
    LocalDateTime createTime
) {
}
```

不要直接返回：

```java
return userMapper.selectById(id);
```

返回 VO 的好处：

- 可以隐藏敏感字段。
- 可以组装多表信息。
- 可以控制时间、枚举、金额格式。
- 可以保持接口稳定。

## 统一响应结构

```json
{
  "code": "0",
  "message": "OK",
  "data": {
    "id": 10001
  },
  "traceId": "7f32e1c9f3a44b61"
}
```

Java 结构：

```java
public record ApiResult<T>(
    String code,
    String message,
    T data,
    String traceId
) {
}
```

建议：

- `code = "0"` 表示成功。
- 业务错误用稳定错误码，不要只靠中文文案。
- `traceId` 每次都返回，方便定位日志。
- 文件下载、SSE、第三方回调可以不套统一结构。

## 错误码要可定位

错误码示例：

```text
COMMON_001  参数不合法
COMMON_401  未登录
COMMON_403  无权限
USER_001    手机号已存在
ORDER_001   订单不存在
ORDER_002   订单状态不允许取消
```

错误响应：

```json
{
  "code": "ORDER_002",
  "message": "订单状态不允许取消",
  "data": null,
  "traceId": "7f32e1c9f3a44b61"
}
```

接口文档里每个接口至少列：

- 参数错误。
- 未登录 / 无权限。
- 资源不存在。
- 状态不允许。
- 幂等冲突。

## HTTP 状态码怎么用

如果团队有统一响应体，也不要完全无视 HTTP 状态：

| 状态码 | 场景 |
| --- | --- |
| `200` | 请求成功，业务成功或业务失败都由响应体表达 |
| `201` | 创建成功，尤其是 REST 风格明显的创建接口 |
| `400` | 请求格式或参数不合法 |
| `401` | 未登录或 token 无效 |
| `403` | 已登录但无权限 |
| `404` | 资源不存在 |
| `409` | 状态冲突、幂等冲突、版本冲突 |
| `500` | 服务端未知错误 |

内部管理系统可以简单点：HTTP 只区分成功、认证、服务端异常；业务失败看 `code`。

对外开放 API 要更严格：HTTP 状态码和错误码都要设计。

## Controller 写法

```java
@RestController
@RequestMapping("/users")
public class UserController {

    private final UserService userService;

    public UserController(UserService userService) {
        this.userService = userService;
    }

    @PostMapping
    public ApiResult<Long> create(@Valid @RequestBody CreateUserRequest request) {
        Long userId = userService.createUser(request.toCommand());
        return ApiResult.ok(userId);
    }

    @GetMapping("/{userId}")
    public ApiResult<UserDetailVO> detail(@PathVariable Long userId) {
        return ApiResult.ok(userService.getUserDetail(userId));
    }

    @GetMapping
    public ApiResult<PageResult<UserListVO>> page(@Valid UserPageQuery query) {
        return ApiResult.ok(userService.pageUsers(query));
    }
}
```

Controller 只做：

- 绑定参数。
- 调用 Service。
- 返回结果。

Controller 不做：

- 查数据库。
- 拼业务规则。
- 写事务。
- 调多个外部系统。

## 分页结构统一

请求参数：

```text
pageNo=1
pageSize=20
sort=createTime,desc
```

限制：

- `pageNo` 从 1 开始。
- `pageSize` 默认 20。
- `pageSize` 最大 100 或 200。
- 排序字段必须白名单。

返回结构：

```json
{
  "records": [],
  "total": 125,
  "pageNo": 1,
  "pageSize": 20,
  "pages": 7
}
```

Java：

```java
public record PageResult<T>(
    List<T> records,
    long total,
    long pageNo,
    long pageSize,
    long pages
) {

    public static <T> PageResult<T> of(List<T> records, long total, long pageNo, long pageSize) {
        long pages = pageSize == 0 ? 0 : (total + pageSize - 1) / pageSize;
        return new PageResult<>(records, total, pageNo, pageSize, pages);
    }
}
```

## 排序和筛选

不要把前端传来的字段直接拼进 SQL。

推荐白名单：

```java
private static final Map<String, SFunction<OrderEntity, ?>> SORT_FIELDS = Map.of(
    "createTime", OrderEntity::getCreateTime,
    "amount", OrderEntity::getAmount
);
```

或者在 XML 里做枚举判断：

```xml
<choose>
    <when test="query.sort == 'amount_desc'">
        order by o.amount desc
    </when>
    <otherwise>
        order by o.create_time desc
    </otherwise>
</choose>
```

筛选参数要区分：

- 精确匹配：`status=PAID`。
- 范围查询：`startTime`、`endTime`。
- 关键字：`keyword`，需要说明匹配哪些字段。
- 多选：`statusList=PAID,CLOSED` 或请求体数组。

## 幂等设计

这些接口要考虑幂等：

- 支付。
- 下单。
- 发券。
- 创建唯一业务资源。
- MQ 消费回调。
- 第三方通知。

常见做法：

```http
POST /orders/10001/pay
Idempotency-Key: pay-order-10001-v1
```

服务端保存幂等记录：

```text
key: pay-order-10001-v1
status: PROCESSING / SUCCESS / FAILED
result: 成功响应摘要
expire_time: 2026-06-01 12:00:00
```

处理规则：

- 第一次请求：创建幂等记录并执行业务。
- 重复请求处理中：返回“处理中”或 409。
- 重复请求已成功：返回第一次成功结果。
- 重复请求参数不同：返回幂等冲突。

## 权限写进接口设计

文档里明确：

```text
接口：POST /orders/{orderId}/cancel
登录：需要
角色：admin / order_operator / 订单本人
数据范围：只能取消自己租户下的订单
```

代码里不要只靠前端隐藏按钮。

Service 也要校验数据权限：

```java
OrderEntity order = orderRepository.getRequired(orderId);
if (!permissionService.canCancel(currentUser, order)) {
    throw new BizException(ErrorCode.COMMON_FORBIDDEN);
}
```

## 版本控制

内部系统可以先不做 URL 版本，但要有兼容意识：

```text
/api/users
```

对外开放接口推荐显式版本：

```text
/api/v1/users
/api/v2/users
```

接口变更规则：

- 增加非必填字段：通常兼容。
- 删除字段：破坏兼容。
- 改字段含义：破坏兼容。
- 改错误码：破坏兼容。
- 改分页规则：破坏兼容。

## 最小接口说明模板

````markdown
## 创建用户

- 方法：POST
- 路径：/users
- 登录：需要
- 权限：admin:user:create
- 幂等：按 mobile 唯一约束保证

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| username | string | 是 | 1～30 个字符 |
| mobile | string | 是 | 11 位手机号 |
| roleIds | array | 是 | 角色 ID 列表 |

### 成功响应

```json
{
  "code": "0",
  "message": "OK",
  "data": 10001,
  "traceId": "7f32e1c9f3a44b61"
}
```

### 错误码

| code | message | 场景 |
| --- | --- | --- |
| COMMON_001 | 请求参数不合法 | 字段格式错误 |
| USER_001 | 手机号已存在 | mobile 已注册 |
| COMMON_403 | 无权限 | 没有创建用户权限 |
````

如果这份说明写不出来，代码大概率也会写歪。

## 检查清单

- [ ] URL 是资源名，不是动词列表。
- [ ] 请求 DTO 和返回 VO 没有复用 Entity。
- [ ] 参数校验规则写清楚。
- [ ] 统一响应结构确定。
- [ ] 错误码稳定且可定位。
- [ ] 分页、排序、筛选约定统一。
- [ ] 排序字段有白名单。
- [ ] 权限和数据范围已写进设计。
- [ ] 写接口前确认是否需要幂等。
- [ ] Controller 没有业务逻辑。

## 最后记一句话

接口设计不是“路径怎么起名”，而是把调用契约提前固定住。
