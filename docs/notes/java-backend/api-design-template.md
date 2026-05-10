---
title: 接口设计
sidebarTitle: 接口设计
---

# 接口设计

后端接口最容易出问题的地方，不是“怎么写个 Controller”，而是：

- URL 命名混乱
- DTO / VO 不清楚
- 错误码随手写
- 幂等、分页、权限要求没有提前定

所以这篇不再只是留一个表格模板，而是直接给一版更实用的接口设计方法和代码骨架。

## 先说结论

一个接口设计得稳不稳，通常先看这 6 件事：

1. 资源命名是否清楚
2. 请求 DTO 是否独立
3. 返回 VO 是否稳定
4. 错误和异常是否统一
5. 幂等、权限、分页是否提前设计
6. Controller / Service / Mapper 责任是否分清

一句话就是：

**接口设计不是“把表字段暴露出去”，而是给调用方提供稳定业务契约。**

## 先从 URL 设计开始

比较推荐的基本风格：

- 资源优先
- 路径名用名词
- 动作用 HTTP 方法表达

例如：

```text
GET    /api/users/{id}
POST   /api/users
PUT    /api/users/{id}
DELETE /api/users/{id}
GET    /api/orders/{id}
POST   /api/orders
```

不要写成：

```text
/api/getUserById
/api/createOrder
/api/deleteUser
```

这种写法在项目变大后会越来越乱。

## 一个接口设计说明至少要先写清这些

```text
接口名称：
请求路径：
请求方法：
调用方：
是否需要登录：
是否幂等：
是否分页：
主要异常场景：
```

这部分不是文档形式主义，而是后面代码边界的来源。

## 请求 DTO 一定要独立

例如创建用户：

```java
@Data
public class CreateUserRequest {

    @NotBlank(message = "username cannot be blank")
    private String username;

    @NotBlank(message = "password cannot be blank")
    private String password;

    @Email(message = "email format invalid")
    private String email;
}
```

这里 DTO 的关键价值在于：

- 参数校验有承载位置
- 不把数据库字段原样暴露给外部
- 后面扩字段不会把 Entity 拖下水

## 返回 VO 也不要直接复用 Entity

```java
@Data
@Builder
public class UserVO {
    private Long id;
    private String username;
    private String email;
    private Integer status;
}
```

原因很简单：

- Entity 常常带数据库字段
- VO 只该暴露调用方需要的字段

例如密码、逻辑删除标记、内部审计字段，通常都不该出现在返回 VO 里。

## 一版比较稳的 Controller 写法

```java
@RestController
@RequestMapping("/api/users")
public class UserController {

    private final UserService userService;

    public UserController(UserService userService) {
        this.userService = userService;
    }

    @PostMapping
    public ApiResponse<IdResponse> create(@Valid @RequestBody CreateUserRequest request) {
        Long id = userService.create(request);
        return ApiResponse.success(new IdResponse(id));
    }

    @GetMapping("/{id}")
    public ApiResponse<UserVO> getById(@PathVariable Long id) {
        return ApiResponse.success(userService.getById(id));
    }
}
```

Controller 层最好只做这几件事：

- 接协议
- 参数校验
- 调 service
- 包统一返回

不要在 Controller 里直接写：

- 复杂业务规则
- SQL
- 大量 try/catch

## Service 层应该承接业务语义

```java
public interface UserService {
    Long create(CreateUserRequest request);
    UserVO getById(Long id);
}
```

实现类里再写业务规则：

```java
@Service
public class UserServiceImpl implements UserService {

    private final UserMapper userMapper;

    public UserServiceImpl(UserMapper userMapper) {
        this.userMapper = userMapper;
    }

    @Override
    public Long create(CreateUserRequest request) {
        checkUsernameNotExists(request.getUsername());

        UserEntity entity = new UserEntity();
        entity.setUsername(request.getUsername());
        entity.setPassword(hash(request.getPassword()));
        entity.setEmail(request.getEmail());
        entity.setStatus(1);

        userMapper.insert(entity);
        return entity.getId();
    }

    @Override
    public UserVO getById(Long id) {
        UserEntity entity = userMapper.selectById(id);
        if (entity == null) {
            throw new BizException(40401, "user not found");
        }
        return UserVO.builder()
                .id(entity.getId())
                .username(entity.getUsername())
                .email(entity.getEmail())
                .status(entity.getStatus())
                .build();
    }
}
```

## 错误响应要统一

一个很容易被忽略的点是：  
接口设计不只包括成功响应，也包括失败响应。

例如可以统一成：

```json
{
  "code": 40401,
  "message": "user not found",
  "data": null
}
```

这样调用方才知道：

- 这是业务错误
- 还是系统错误

## 分页接口不要临时发明结构

建议一开始统一成固定分页返回：

```java
@Data
@Builder
public class PageResponse<T> {
    private Long total;
    private Long current;
    private Long size;
    private List<T> records;
}
```

接口形态例如：

```java
@GetMapping
public ApiResponse<PageResponse<UserVO>> page(UserPageQuery query) {
    return ApiResponse.success(userService.page(query));
}
```

不要有的接口叫：

- `items`
- 有的叫 `list`
- 有的叫 `rows`

分页结构混乱会让前后端一起痛苦。

## 幂等要在接口设计期就想

下面这些接口，经常要提前考虑幂等：

- 创建订单
- 支付回调
- 发券
- 发消息
- 导入任务

比较常见的做法包括：

- 幂等号
- 唯一业务键
- token 防重复提交

如果等到线上重复提交再补，通常已经晚了。

## 权限也要写进设计，不要只留给网关猜

例如：

```text
是否需要登录：是
是否需要角色：ADMIN
是否仅本人可见：是
```

然后代码里明确体现：

```java
@PreAuthorize("hasRole('ADMIN')")
@DeleteMapping("/{id}")
public ApiResponse<Void> delete(@PathVariable Long id) {
    userService.delete(id);
    return ApiResponse.success(null);
}
```

权限不写进接口设计，后面很容易变成“谁记得加谁加”。

## 一个最小接口设计文档模板

下面这版更适合真正写到文档里：

```md
## 创建用户

- 路径：`POST /api/users`
- 调用方：管理后台
- 是否登录：是
- 是否幂等：否
- 功能：创建新用户

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| username | String | 是 | 用户名 |
| password | String | 是 | 登录密码 |
| email | String | 否 | 邮箱 |

### 成功响应

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 1001
  }
}
```

### 主要异常

- 用户名已存在
- 参数校验失败
- 权限不足
```

## 常见坑

### 1. 用 Entity 直接做请求和返回

短期省事，长期会非常难收拾。

### 2. 路径设计像动词列表

项目一大，API 风格就会碎。

### 3. 错误结构不统一

调用方只能靠 message 猜错误类型。

### 4. 分页、筛选、排序约定不统一

前端每接一个列表都像接新系统。

### 5. 幂等和权限没有前置设计

这两件事后补通常都更贵。

## 最后记一句话

**好的接口设计，不是把后端内部实现暴露出去，而是给调用方一份稳定、清楚、可长期演进的业务契约。**
