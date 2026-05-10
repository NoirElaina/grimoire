---
title: Spring Boot 项目骨架
sidebarTitle: Spring Boot 项目骨架
---

# Spring Boot 项目骨架

如果一开始 Spring Boot 项目骨架没立好，后面最常见的结果就是：

- Controller 越写越重
- DTO / Entity 混在一起
- 日志、异常、校验、traceId 到处散着写
- 配置文件膨胀
- 新同事一进来根本看不懂目录

所以这篇不再保留成“占位模板”，而是直接给一版更实用的项目起手骨架。

## 先说结论

普通 Java 后端业务系统，我更推荐一开始就把这几层立住：

1. `controller`
2. `service`
3. `mapper / repository`
4. `domain / entity`
5. `dto / vo`
6. `config / common / exception`

再补齐这几件基础设施：

- 统一返回
- 全局异常处理
- 参数校验
- traceId
- 环境配置拆分
- 健康检查

一句话就是：

**Spring Boot 项目最重要的不是能启动，而是从第一天就能长。**

## 一版比较稳的目录结构

```text
src/main/java/com/example/app
├─ controller
├─ service
├─ service/impl
├─ mapper
├─ entity
├─ dto
├─ vo
├─ config
├─ common
│  ├─ result
│  ├─ enums
│  ├─ utils
│  └─ constants
├─ exception
└─ infrastructure
   ├─ redis
   ├─ mq
   └─ client
```

这个结构的核心思想是：

- Controller 只接协议层
- Service 只接业务层
- Mapper 只接持久化层
- Redis / MQ / OpenFeign 这类外部依赖收进基础设施层

## Maven 依赖一开始先别堆太多

一个常见的基础依赖集合大概够用：

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
        <artifactId>spring-boot-starter-aop</artifactId>
    </dependency>
    <dependency>
        <groupId>org.projectlombok</groupId>
        <artifactId>lombok</artifactId>
        <optional>true</optional>
    </dependency>
</dependencies>
```

后面按需要再补：

- MyBatis-Plus / JPA
- Redis
- OpenFeign
- Nacos
- Sentinel
- RabbitMQ

不要项目一创建就把半个 Spring Cloud 都堆进去。

## 启动类保持干净

```java
@SpringBootApplication
public class GrimoireApplication {

    public static void main(String[] args) {
        SpringApplication.run(GrimoireApplication.class, args);
    }
}
```

启动类不要直接塞：

- 一堆 `@Bean`
- 业务配置
- 杂乱扫描路径

这些应该回到 `config` 包里。

## 统一返回一开始就定

### 返回结构

```java
@Data
@NoArgsConstructor
@AllArgsConstructor
public class ApiResponse<T> {

    private Integer code;
    private String message;
    private T data;

    public static <T> ApiResponse<T> success(T data) {
        return new ApiResponse<>(0, "success", data);
    }

    public static <T> ApiResponse<T> fail(Integer code, String message) {
        return new ApiResponse<>(code, message, null);
    }
}
```

### Controller 写法

```java
@RestController
@RequestMapping("/api/users")
public class UserController {

    private final UserService userService;

    public UserController(UserService userService) {
        this.userService = userService;
    }

    @GetMapping("/{id}")
    public ApiResponse<UserVO> getById(@PathVariable Long id) {
        return ApiResponse.success(userService.getById(id));
    }
}
```

这层统一之后，前后端协作和错误治理都会简单很多。

## DTO / Entity / VO 一定要分开

很多项目烂掉，就是从“先偷懒直接复用 Entity”开始的。

### DTO

面向请求入参：

```java
@Data
public class CreateUserRequest {

    @NotBlank(message = "username cannot be blank")
    private String username;

    @NotBlank(message = "password cannot be blank")
    private String password;
}
```

### Entity

面向数据库：

```java
@Data
public class UserEntity {
    private Long id;
    private String username;
    private String password;
    private Integer status;
    private LocalDateTime createTime;
}
```

### VO

面向接口返回：

```java
@Data
@Builder
public class UserVO {
    private Long id;
    private String username;
    private Integer status;
}
```

这样你后面改表结构，不会直接把 API 全拖着跑。

## Service 层只放业务动作

```java
public interface UserService {

    UserVO getById(Long id);

    Long create(CreateUserRequest request);
}
```

实现类里才写流程：

```java
@Service
public class UserServiceImpl implements UserService {

    private final UserMapper userMapper;

    public UserServiceImpl(UserMapper userMapper) {
        this.userMapper = userMapper;
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
                .status(entity.getStatus())
                .build();
    }

    @Override
    public Long create(CreateUserRequest request) {
        UserEntity entity = new UserEntity();
        entity.setUsername(request.getUsername());
        entity.setPassword(hashPassword(request.getPassword()));
        entity.setStatus(1);
        userMapper.insert(entity);
        return entity.getId();
    }
}
```

关键是：

- Controller 不写业务
- Service 不直接暴露数据库结构

## 全局异常处理一定要先补

```java
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(BizException.class)
    public ApiResponse<Void> handleBizException(BizException e) {
        return ApiResponse.fail(e.getCode(), e.getMessage());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ApiResponse<Void> handleValidationException(MethodArgumentNotValidException e) {
        String message = e.getBindingResult()
                .getFieldErrors()
                .stream()
                .findFirst()
                .map(DefaultMessageSourceResolvable::getDefaultMessage)
                .orElse("invalid request");
        return ApiResponse.fail(40000, message);
    }

    @ExceptionHandler(Exception.class)
    public ApiResponse<Void> handleException(Exception e) {
        return ApiResponse.fail(50000, "internal server error");
    }
}
```

没有这层，项目很快会出现：

- Controller 自己 try/catch
- 错误结构不统一
- 前端只能猜哪些错误是业务错误

## traceId 最好在一开始就放进去

一个很小但很值的过滤器：

```java
@Component
public class TraceIdFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {
        String traceId = Optional.ofNullable(request.getHeader("X-Trace-Id"))
                .filter(StringUtils::hasText)
                .orElse(UUID.randomUUID().toString().replace("-", ""));

        MDC.put("traceId", traceId);
        response.setHeader("X-Trace-Id", traceId);
        try {
            filterChain.doFilter(request, response);
        } finally {
            MDC.remove("traceId");
        }
    }
}
```

这会让你后面排查问题轻松很多。

## 配置文件建议先按环境拆

### `application.yml`

```yaml
spring:
  application:
    name: grimoire-demo

server:
  port: 8080
```

### `application-dev.yml`

```yaml
spring:
  datasource:
    url: jdbc:mysql://127.0.0.1:3306/grimoire
    username: root
    password: 123456
```

### `application-prod.yml`

生产里只放生产参数，不要把敏感值和默认开发值混在一起。

## 健康检查和基础观测不要最后补

至少先把 actuator 打开：

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics
```

这样你至少能有：

- 健康检查
- 基础 metrics

## 一种比较推荐的初始化检查清单

新项目创建后，第一周内最好确认这些都已经有：

1. 统一返回
2. 全局异常处理
3. 参数校验
4. traceId
5. 环境配置拆分
6. Actuator 健康检查
7. 基础日志格式
8. 数据库访问层约束

## 最后记一句话

**Spring Boot 项目的“模板”不该只是目录示意图，而应该是一套能让项目从第一个月到第十二个月都不轻易变形的最小骨架。**
