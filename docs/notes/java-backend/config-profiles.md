---
title: Spring Boot 配置文件与 Profile
sidebarTitle: 配置与 Profile
---

# Spring Boot 配置文件与 Profile

> 配置管理不是把所有东西塞进 `application.yml`。重点是：环境隔离、敏感信息、默认值、启动参数和可验证。

## 先给结论

后端项目先按这个结构：

```text
application.yml
application-local.yml
application-dev.yml
application-prod.yml
```

规则：

- 公共配置放 `application.yml`。
- 本地配置放 `application-local.yml`。
- 测试环境放 `application-dev.yml`。
- 生产配置放 `application-prod.yml`。
- 密码、密钥、token 不提交到 Git。
- 生产配置优先由环境变量、配置中心或部署平台注入。

## 基础写法

`application.yml`：

```yaml
spring:
  application:
    name: flashmart
  profiles:
    active: local

server:
  port: 8080
```

`application-local.yml`：

```yaml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/flashmart?useUnicode=true&characterEncoding=utf8
    username: root
    password: root
  data:
    redis:
      host: localhost
      port: 6379
```

生产不要把密码写死在仓库：

```yaml
spring:
  datasource:
    url: ${MYSQL_URL}
    username: ${MYSQL_USERNAME}
    password: ${MYSQL_PASSWORD}
```

## 激活 Profile

本地启动：

```text
--spring.profiles.active=local
```

命令行：

```bash
java -jar app.jar --spring.profiles.active=prod
```

环境变量：

```bash
SPRING_PROFILES_ACTIVE=prod
```

Docker Compose：

```yaml
services:
  app:
    image: flashmart-api
    environment:
      SPRING_PROFILES_ACTIVE: prod
      MYSQL_URL: jdbc:mysql://mysql:3306/flashmart
      MYSQL_USERNAME: flashmart
      MYSQL_PASSWORD: ${MYSQL_PASSWORD}
```

## 配置优先级

Spring Boot 配置有优先级。工程上先记住：

```text
命令行参数
环境变量
外部配置文件
项目内 application-{profile}.yml
项目内 application.yml
默认值
```

所以生产环境不要靠改代码里的 `application-prod.yml` 来切配置，更常见是部署时注入环境变量。

## `@Value` 和 `@ConfigurationProperties`

少量配置可以用 `@Value`：

```java
@Component
public class JwtTokenProvider {

    private final String secret;

    public JwtTokenProvider(@Value("${flashmart.jwt.secret}") String secret) {
        this.secret = secret;
    }
}
```

一组配置更推荐 `@ConfigurationProperties`：

```java
@ConfigurationProperties(prefix = "flashmart.jwt")
public record JwtProperties(
    String secret,
    Duration accessTokenTtl,
    Duration refreshTokenTtl
) {
}
```

启用：

```java
@ConfigurationPropertiesScan
@SpringBootApplication
public class FlashMartApplication {
}
```

配置：

```yaml
flashmart:
  jwt:
    secret: ${JWT_SECRET}
    access-token-ttl: 30m
    refresh-token-ttl: 7d
```

优点：

- 配置集中。
- 类型安全。
- 支持 IDE 提示。
- 可以加校验。

## 配置校验

关键配置启动时就要校验。

```java
@Validated
@ConfigurationProperties(prefix = "flashmart.jwt")
public record JwtProperties(
    @NotBlank String secret,
    @NotNull Duration accessTokenTtl,
    @NotNull Duration refreshTokenTtl
) {
}
```

不要等到用户登录时才发现 `JWT_SECRET` 没配。

## 敏感配置

不要提交：

- 数据库生产密码。
- Redis 密码。
- JWT secret。
- 第三方支付密钥。
- 短信平台密钥。
- OSS access key。

可以提交：

```yaml
jwt:
  secret: ${JWT_SECRET}
```

不能提交：

```yaml
jwt:
  secret: abc123-real-prod-secret
```

本地可以用 `.env` 或不进 Git 的 `application-local.yml`。

如果 `application-local.yml` 要提交，就只能放示例值，不放真实密钥。

## 配置命名

推荐按业务前缀：

```yaml
flashmart:
  jwt:
    access-token-ttl: 30m
  order:
    pay-timeout: 30m
  cache:
    product-detail-ttl: 10m
```

不要散落：

```yaml
tokenExpire: 30
timeout: 30
cacheTime: 10
```

配置名要能看出：

- 属于哪个系统。
- 属于哪个模块。
- 单位是什么。
- 默认值是否安全。

## 本地、测试、生产差异

| 配置 | local | dev | prod |
| --- | --- | --- | --- |
| 数据库 | 本机或 Docker | 测试库 | 生产库 |
| Redis | 本机 | 测试 Redis | 生产 Redis |
| 日志级别 | DEBUG 可接受 | INFO | INFO/WARN |
| Flyway | 可自动跑 | 可自动跑 | 按发布流程 |
| 第三方支付 | 沙箱 | 沙箱 | 真实渠道 |
| Swagger | 开 | 开 | 谨慎开放 |

不要让生产使用 local 的默认值。

## 配置中心

如果接 Nacos：

```text
bootstrap / spring.config.import
  -> Nacos 配置
  -> application.yml
```

要先约定：

- namespace 区分环境。
- group 区分系统或业务域。
- dataId 命名稳定。
- 敏感配置是否放配置中心。
- 配置变更是否需要审批。

配置中心不是万能的。数据库密码、支付密钥仍然要按安全策略管理。

## 启动参数检查

上线前至少确认：

```text
当前 profile 是什么
数据库连到哪里
Redis 连到哪里
日志级别是什么
端口是什么
第三方接口是沙箱还是生产
Flyway 是否会执行
```

可以在启动日志里打印非敏感摘要：

```java
@Component
public class StartupProfileLogger implements ApplicationRunner {

    private final Environment environment;

    public StartupProfileLogger(Environment environment) {
        this.environment = environment;
    }

    @Override
    public void run(ApplicationArguments args) {
        log.info("active profiles: {}", Arrays.toString(environment.getActiveProfiles()));
    }
}
```

不要打印密码、token、密钥。

## 去空话检查

- [ ] 不同环境有不同 profile。
- [ ] 生产密钥不提交 Git。
- [ ] 一组业务配置用 `@ConfigurationProperties`。
- [ ] 关键配置有校验。
- [ ] 配置名包含模块和单位语义。
- [ ] 上线前能确认 profile、DB、Redis、第三方渠道。

## 参考

- [Spring Boot Externalized Configuration](https://docs.spring.io/spring-boot/reference/features/external-config.html)
- [Spring Boot Profiles](https://docs.spring.io/spring-boot/reference/features/profiles.html)
