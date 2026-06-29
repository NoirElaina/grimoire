---
title: Spring Boot 配置文件与 Profile
sidebarTitle: 配置与 Profile
---

# Spring Boot 配置文件与 Profile

> 配置管理不是把所有东西塞进 `application.yml`。工程上重点是环境隔离、敏感信息、默认值、可验证；原理上要懂配置怎么被加载成 `Environment`、优先级为什么是那样、`@Profile` 和 `@ConfigurationProperties` 怎么生效。

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

## 底层：Environment 与 PropertySource

Spring 把所有配置抽象成 `Environment`，它内部是一串**有序**的 `PropertySource`：

```text
Environment
  -> MutablePropertySources（一个有序列表）
       命令行参数 PropertySource
       系统环境变量 PropertySource
       JVM 系统属性 PropertySource
       application-{profile}.yml 的 PropertySource
       application.yml 的 PropertySource
       ...
```

取一个配置值（`environment.getProperty("x")`）时，按列表顺序**从前往后找，第一个命中就返回**。这就是“优先级”的本质——不是谁覆盖谁的数据，而是谁排在前面先被找到。

Spring Boot 启动时由 `ConfigDataEnvironmentPostProcessor`（取代了老版本的 `ConfigFileApplicationListener`）负责加载 `application.yml` / `application-{profile}.yml`，并按规则插入到这个列表里。

## 配置优先级

工程上先记住这个由高到低的顺序（高的先被找到，等于覆盖低的）：

```text
命令行参数 (--server.port=8081)
SPRING_APPLICATION_JSON
JVM 系统属性 (-Dxxx)
操作系统环境变量
application-{profile}.yml（项目外 > 项目内）
application.yml（项目外 > 项目内）
@PropertySource
默认值
```

两个结论：

- 同一个 key，命令行 / 环境变量永远能盖掉 jar 里的 yml。所以**生产切配置不是改代码里的 application-prod.yml，而是部署时注入环境变量**。
- 项目外部（jar 同级目录、`config/` 目录）的配置文件优先级高于打进 jar 内的，方便不重新打包就改配置。

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

补充：`spring.profiles.active`（激活）和 `spring.profiles.include`（追加额外 profile）不同；新版还支持在单个文件里用 `---` 分多文档块，配合 `spring.config.activate.on-profile` 按 profile 生效。

## @Profile 怎么生效

`@Profile` 本质是一个条件注解，底层是 `ProfileCondition`（`@Conditional` 的一种）。容器在注册 BeanDefinition 阶段判断当前激活的 profile 是否匹配，不匹配的 Bean 直接不注册：

```java
@Configuration
public class PayConfig {

    @Bean
    @Profile("prod")
    public PaymentClient realPaymentClient() {
        return new RealPaymentClient();
    }

    @Bean
    @Profile({"local", "dev"})
    public PaymentClient mockPaymentClient() {
        return new MockPaymentClient();
    }
}
```

它和 `@ConditionalOnProperty` 的区别：`@Profile` 看激活的 profile，`@ConditionalOnProperty` 看某个配置项的值，后者更灵活，是 Spring Boot 自动配置的常用手段。

## @Value 和 @ConfigurationProperties

少量配置可以用 `@Value`，底层是占位符解析（`PropertySourcesPlaceholderConfigurer` + `Environment`）：

```java
@Component
public class JwtTokenProvider {

    private final String secret;

    public JwtTokenProvider(@Value("${flashmart.jwt.secret}") String secret) {
        this.secret = secret;
    }
}
```

一组配置更推荐 `@ConfigurationProperties`，靠 `ConfigurationPropertiesBindingPostProcessor` 在 Bean 初始化时批量绑定：

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
    access-token-ttl: 30m      # 自动转成 Duration
    refresh-token-ttl: 7d
```

两者对比：

| 对比 | `@Value` | `@ConfigurationProperties` |
| --- | --- | --- |
| 粒度 | 单个值 | 一组前缀 |
| 类型安全 | 弱 | 强（自动类型转换） |
| 校验 | 不方便 | 配合 `@Validated` + JSR-303 |
| 松散绑定 | 不支持 | 支持 |
| SpEL | 支持 | 不支持 |
| IDE 提示 | 弱 | 强（配 metadata） |

### 松散绑定（Relaxed Binding）

`@ConfigurationProperties` 支持松散绑定，下面几种写法都能绑到字段 `accessTokenTtl`：

```text
access-token-ttl   （kebab-case，推荐）
accessTokenTtl     （camelCase）
access_token_ttl   （下划线）
ACCESS_TOKEN_TTL   （大写，常用于环境变量）
```

这就是为什么环境变量 `FLASHMART_JWT_SECRET` 能绑到 `flashmart.jwt.secret`——而 `@Value("${...}")` 不支持这种松散匹配。

## 配置校验

关键配置启动时就要校验，不要等到用户登录时才发现 `JWT_SECRET` 没配。

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

校验失败会让应用**启动直接失败**，这正是想要的——把问题暴露在发布期而不是运行期。

## 敏感配置

不要提交：

- 数据库生产密码。
- Redis 密码。
- JWT secret。
- 第三方支付密钥。
- 短信平台密钥。
- OSS access key。

可以提交（占位符）：

```yaml
jwt:
  secret: ${JWT_SECRET}
```

不能提交（真实值）：

```yaml
jwt:
  secret: abc123-real-prod-secret
```

本地可以用 `.env` 或不进 Git 的 `application-local.yml`。如果 `application-local.yml` 要提交，就只能放示例值，不放真实密钥。

## 配置命名

推荐按业务前缀，含模块和单位语义：

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

配置名要能看出：属于哪个系统、哪个模块、单位是什么、默认值是否安全。

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

## 配置中心：bootstrap vs spring.config.import

接 Nacos / Apollo 时，新老两种接入方式要分清：

```text
老方式（Spring Cloud < 2020）：bootstrap.yml + spring-cloud-starter-bootstrap
  bootstrap 上下文先于 application 上下文加载，在里面配置中心地址

新方式（Spring Boot 2.4+ 推荐）：application.yml 里用 spring.config.import
  spring:
    config:
      import: "nacos:flashmart-${spring.profiles.active}.yml"
```

接入前要先约定：

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

不要打印密码、token、密钥。生产慎开 `/actuator/env`，它会暴露配置项。

## 去空话检查

- [ ] 能说清配置底层是 Environment + 有序 PropertySource，取值“先命中先返回”。
- [ ] 能背出优先级大致顺序，知道命令行 / 环境变量能盖 jar 内 yml。
- [ ] 知道 @Profile 是条件注解，不匹配的 Bean 不注册。
- [ ] 能讲清 @Value 与 @ConfigurationProperties 的区别和松散绑定。
- [ ] 关键配置用 @Validated 校验，启动期失败。
- [ ] 生产密钥不提交 Git，靠环境变量 / 配置中心注入。
- [ ] 配置名包含模块和单位语义。
- [ ] 知道 bootstrap 与 spring.config.import 两种配置中心接入方式。
- [ ] 上线前能确认 profile、DB、Redis、第三方渠道；不打印敏感信息。

## 参考

- [Spring Boot Externalized Configuration](https://docs.spring.io/spring-boot/reference/features/external-config.html)
- [Spring Boot Profiles](https://docs.spring.io/spring-boot/reference/features/profiles.html)
- [Spring Boot Type-safe Configuration Properties](https://docs.spring.io/spring-boot/reference/features/external-config.html#features.external-config.typesafe-configuration-properties)
