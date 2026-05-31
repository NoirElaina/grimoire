---
title: Spring Boot 项目骨架
sidebarTitle: Spring Boot 项目骨架
---

# Spring Boot 项目骨架

> 新后端项目先把骨架搭对：包结构、配置、异常、校验、日志、健康检查。

## 先给结论

一个 Spring Boot 项目起步先定这些：

- 包结构按业务和分层稳定下来。
- DTO / Entity / VO 分开。
- Controller 只处理 HTTP 入参和出参。
- Service 放业务语义和事务。
- Mapper / Repository 只做数据访问。
- 全局异常、参数校验、日志追踪一开始就接。
- 配置按环境拆，不把密码、地址写死在代码里。

## 最小依赖

Web 项目先别堆太多依赖：

```xml
<dependencies>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-web</artifactId>
    </dependency>

    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-validation</artifactId>
    </dependency>

    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-actuator</artifactId>
    </dependency>

    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-test</artifactId>
        <scope>test</scope>
    </dependency>
</dependencies>
```

按需再加：

- 数据库：`spring-boot-starter-jdbc`、`mybatis-plus-spring-boot3-starter`。
- Redis：`spring-boot-starter-data-redis`。
- 安全：`spring-boot-starter-security`。
- OpenAPI：`springdoc-openapi-starter-webmvc-ui`。

原则：项目没用到的 starter 不要提前加，依赖越多，自动配置变量越多。

## 推荐包结构

按“业务模块 + 分层”放：

```text
com.example.mall
├── MallApplication.java
├── common
│   ├── api
│   ├── error
│   ├── exception
│   └── web
├── config
├── user
│   ├── controller
│   ├── service
│   ├── mapper
│   ├── entity
│   ├── dto
│   ├── vo
│   └── converter
└── order
    ├── controller
    ├── service
    ├── mapper
    ├── entity
    ├── dto
    ├── vo
    └── converter
```

小项目也可以先按分层：

```text
controller
service
mapper
entity
dto
vo
config
common
```

但项目一旦模块多了，推荐切到“业务模块优先”，不然所有 Controller 堆在一起很快乱。

## 启动类保持干净

```java
@SpringBootApplication
public class MallApplication {

    public static void main(String[] args) {
        SpringApplication.run(MallApplication.class, args);
    }
}
```

启动类里不要塞：

- 业务初始化逻辑。
- Bean 手动注册大杂烩。
- 一堆 `@EnableXxx`。
- 静态工具方法。

初始化逻辑放 `ApplicationRunner`：

```java
@Component
public class StartupChecker implements ApplicationRunner {

    @Override
    public void run(ApplicationArguments args) {
        // 检查必要配置、缓存预热、字典加载
    }
}
```

## 配置文件拆法

`application.yml` 放公共配置：

```yaml
spring:
  application:
    name: mall-api
  profiles:
    active: dev

server:
  port: 8080
  servlet:
    context-path: /api

management:
  endpoints:
    web:
      exposure:
        include: health,info
  endpoint:
    health:
      show-details: never
```

`application-dev.yml` 放本地配置：

```yaml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/mall_dev
    username: root
    password: root

logging:
  level:
    com.example.mall: debug
```

`application-prod.yml` 放生产占位：

```yaml
spring:
  datasource:
    url: ${DB_URL}
    username: ${DB_USERNAME}
    password: ${DB_PASSWORD}

logging:
  level:
    root: info
```

注意：

- 生产密码走环境变量、配置中心、密钥系统，不进 Git。
- `spring.profiles.active` 在线上通常由启动参数或环境变量控制。
- 不同环境只改配置，不改代码。

## 统一返回结构

```java
public record ApiResult<T>(
    String code,
    String message,
    T data,
    String traceId
) {

    public static <T> ApiResult<T> ok(T data) {
        return new ApiResult<>("0", "OK", data, TraceId.get());
    }

    public static <T> ApiResult<T> fail(String code, String message) {
        return new ApiResult<>(code, message, null, TraceId.get());
    }
}
```

Controller 示例：

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
}
```

如果项目用了统一响应包装器，也要保留“文件下载、SSE、第三方回调”这类不包装的出口。

## 参数校验

请求 DTO：

```java
public record CreateUserRequest(
    @NotBlank(message = "用户名不能为空")
    @Size(max = 30, message = "用户名不能超过30个字符")
    String username,

    @NotBlank(message = "手机号不能为空")
    @Pattern(regexp = "^1\\d{10}$", message = "手机号格式不正确")
    String mobile
) {

    public CreateUserCommand toCommand() {
        return new CreateUserCommand(username, mobile);
    }
}
```

Controller 必须加 `@Valid`：

```java
public ApiResult<Long> create(@Valid @RequestBody CreateUserRequest request) {
    return ApiResult.ok(userService.createUser(request.toCommand()));
}
```

Service 里继续做业务校验：

```java
if (userRepository.existsByMobile(command.mobile())) {
    throw new BizException(ErrorCode.USER_MOBILE_EXISTS);
}
```

区分两类校验：

- 格式校验：放 DTO 注解。
- 业务校验：放 Service。

## 全局异常处理

业务异常：

```java
public class BizException extends RuntimeException {

    private final ErrorCode errorCode;

    public BizException(ErrorCode errorCode) {
        super(errorCode.message());
        this.errorCode = errorCode;
    }

    public ErrorCode errorCode() {
        return errorCode;
    }
}
```

错误码：

```java
public enum ErrorCode {
    USER_MOBILE_EXISTS("USER_001", "手机号已存在"),
    PARAM_INVALID("COMMON_001", "请求参数不合法"),
    SYSTEM_ERROR("COMMON_999", "系统繁忙，请稍后再试");

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

异常处理器：

```java
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(BizException.class)
    public ApiResult<Void> handleBizException(BizException exception) {
        ErrorCode errorCode = exception.errorCode();
        return ApiResult.fail(errorCode.code(), errorCode.message());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ApiResult<Void> handleValidException(MethodArgumentNotValidException exception) {
        String message = exception.getBindingResult()
            .getFieldErrors()
            .stream()
            .findFirst()
            .map(DefaultMessageSourceResolvable::getDefaultMessage)
            .orElse(ErrorCode.PARAM_INVALID.message());
        return ApiResult.fail(ErrorCode.PARAM_INVALID.code(), message);
    }

    @ExceptionHandler(Exception.class)
    public ApiResult<Void> handleException(Exception exception) {
        log.error("unhandled exception, traceId={}", TraceId.get(), exception);
        return ApiResult.fail(ErrorCode.SYSTEM_ERROR.code(), ErrorCode.SYSTEM_ERROR.message());
    }
}
```

注意：最后一个 `Exception` 要打完整日志，但不要把堆栈返回给前端。

## Service 层模板

```java
public interface UserService {

    Long createUser(CreateUserCommand command);

    UserVO getUser(Long userId);
}
```

```java
@Service
public class UserServiceImpl implements UserService {

    private final UserMapper userMapper;

    public UserServiceImpl(UserMapper userMapper) {
        this.userMapper = userMapper;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public Long createUser(CreateUserCommand command) {
        if (existsByMobile(command.mobile())) {
            throw new BizException(ErrorCode.USER_MOBILE_EXISTS);
        }

        UserEntity user = UserEntity.create(command.username(), command.mobile());
        userMapper.insert(user);
        return user.getId();
    }

    private boolean existsByMobile(String mobile) {
        return userMapper.countByMobile(mobile) > 0;
    }
}
```

Service 里适合放：

- 业务校验。
- 状态流转。
- 事务边界。
- 多表协作。
- 领域事件 / MQ 发送入口。

Service 里不适合放：

- HTTP 参数解析。
- Servlet 对象。
- SQL 字符串硬拼。
- 返回前端专用结构的大量拼装。

## traceId 和日志

请求入口生成 `traceId`：

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

日志格式里带上：

```properties
logging.pattern.level=%5p [traceId:%X{traceId}]
```

排查线上问题时，`traceId` 比“你帮我看看刚才那个请求”靠谱很多。

## 健康检查

最小配置：

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info
  endpoint:
    health:
      show-details: never
```

生产建议：

- `/actuator/health` 可以给负载均衡探活。
- 其他 actuator 端点不要随便暴露公网。
- 如果暴露 `metrics`、`env`、`configprops`，必须加鉴权或内网限制。
- 自定义健康检查只做轻量判断，不要每次探活跑大 SQL。

## 新项目检查清单

- [ ] 包结构已经统一，后续模块按同一规则放。
- [ ] `application-dev.yml`、`application-prod.yml` 已拆分。
- [ ] 敏感配置没有提交到 Git。
- [ ] DTO / Entity / VO 分开。
- [ ] Controller 加了 `@Valid`。
- [ ] 全局异常处理能覆盖参数异常、业务异常、未知异常。
- [ ] 返回结构包含 `code`、`message`、`data`、`traceId`。
- [ ] Service 方法有业务语义，不只是 Mapper 透传。
- [ ] 写操作需要事务的地方已加 `@Transactional(rollbackFor = Exception.class)`。
- [ ] 日志里能看到 `traceId`。
- [ ] actuator 只暴露必要端点。

## 参考

- [Spring Boot 外部化配置](https://docs.spring.io/spring-boot/how-to/properties-and-configuration.html)
- [Spring Boot Actuator Endpoints](https://docs.spring.io/spring-boot/reference/actuator/endpoints.html)
