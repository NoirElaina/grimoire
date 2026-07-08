---
title: Spring Boot 自动配置
sidebarTitle: 自动配置
---

# Spring Boot 自动配置

> 自动配置是 Spring Boot 的灵魂。它的本质不是"自动"，而是**约定优于配置 + 条件装配**：引入了什么依赖，就自动注册对应的 Bean，没有就跳过。源码层面要懂入口链路（`@EnableAutoConfiguration` → `AutoConfigurationImportSelector` → 加载配置类 → `@Conditional` 过滤），工程层面要会写自定义 starter。

## 1. 从入口说起

### 1.1 @SpringBootApplication

```java
@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
```

`@SpringBootApplication` 是一个组合注解：

```java
@SpringBootConfiguration    // 本质是 @Configuration，标记当前类为配置类
@EnableAutoConfiguration    // 自动配置的入口
@ComponentScan              // 扫描当前包及子包
public @interface SpringBootApplication { }
```

自动配置的核心是 `@EnableAutoConfiguration`。

### 1.2 @EnableAutoConfiguration → @Import

```java
@AutoConfigurationPackage
@Import(AutoConfigurationImportSelector.class)
public @interface EnableAutoConfiguration { }
```

关键在 `@Import(AutoConfigurationImportSelector.class)`。`@Import` 导入一个 `ImportSelector` 时，Spring 会调用它的 `selectImports` 方法，返回一批类名，Spring 把它们当作配置类注册。

### 1.3 AutoConfigurationImportSelector.selectImports

```java
public class AutoConfigurationImportSelector implements DeferredImportSelector {

    @Override
    public String[] selectImports(AnnotationMetadata annotationMetadata) {
        // 1. 检查开关 spring.boot.enableautoconfiguration（默认 true）
        if (!isEnabled(annotationMetadata)) {
            return NO_IMPORTS;
        }
        // 2. 加载候选配置类（从文件读取）
        AutoConfigurationEntry autoConfigurationEntry = getAutoConfigurationEntry(annotationMetadata);
        return autoConfigurationEntry.getConfigurations().toArray(new String[0]);
    }
}
```

`getAutoConfigurationEntry` 的核心流程：

```
1. 从 META-INF 读取所有候选自动配置类的全限定名
2. 去重
3. 按 @AutoConfigureBefore / @AutoConfigureAfter / @AutoConfigureOrder 排序
4. 用 @Conditional 过滤（AutoConfigurationImportFilter 提前过滤）
5. 返回最终生效的配置类列表
```

::: tip DeferredImportSelector
`AutoConfigurationImportSelector` 实现的是 `DeferredImportSelector`（延迟导入选择器），它的 `selectImports` 会在**所有用户自定义 `@Configuration` 处理完之后**才执行。这保证了用户的 `@Bean` 定义优先于自动配置，`@ConditionalOnMissingBean` 才能正确判断。
:::

---

## 2. 配置类的发现机制

### 2.1 Spring Boot 2.x：spring.factories

在 `META-INF/spring.factories` 文件中列出：

```properties
# Auto Configuration
org.springframework.boot.autoconfigure.EnableAutoConfiguration=\
  com.example.autoconfigure.DataSourceAutoConfiguration,\
  com.example.autoconfigure.RedisAutoConfiguration,\
  com.example.autoconfigure.WebMvcAutoConfiguration
```

Spring Boot 启动时读取所有 jar 包里的 `spring.factories`，把 `EnableAutoConfiguration` 这个 key 下的所有类加载为候选。

### 2.2 Spring Boot 3.x：AutoConfiguration.imports

Spring Boot 3.0（Spring 6）改用新文件：

```
META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports
```

内容是纯类名列表，一行一个：

```
com.example.autoconfigure.DataSourceAutoConfiguration
com.example.autoconfigure.RedisAutoConfiguration
com.example.autoconfigure.WebMvcAutoConfiguration
```

::: warning 迁移注意
Spring Boot 3.x 仍然兼容 `spring.factories` 中的 `EnableAutoConfiguration`，但官方推荐迁移到新文件。其他 key（如 `EnvironmentPostProcessor`、`ApplicationContextInitializer`）仍然用 `spring.factories`。
:::

### 2.3 为什么要改

`spring.factories` 是一个 Properties 文件，所有扩展点都堆在一个文件里，维护困难。新方案把自动配置单独抽出来，更清晰，也支持更高效的加载和过滤。

---

## 3. @Conditional：条件装配

自动配置类发现后不是全部生效，而是经过 `@Conditional` 过滤。这是"引入依赖才生效"的核心。

### 3.1 常用条件注解

| 注解 | 条件 | 典型用途 |
| --- | --- | --- |
| `@ConditionalOnClass` | classpath 存在指定类 | 引入了依赖才生效 |
| `@ConditionalOnMissingClass` | classpath 不存在指定类 | 反向条件 |
| `@ConditionalOnBean` | 容器中存在指定 Bean | 依赖其他 Bean 先注册 |
| `@ConditionalOnMissingBean` | 容器中不存在指定 Bean | 用户没自定义就用默认的 |
| `@ConditionalOnProperty` | 配置属性满足条件 | 开关式配置 |
| `@ConditionalOnResource` | 存在指定资源文件 | 配置文件 / 模板存在才生效 |
| `@ConditionalOnWebApplication` | 是 Web 应用 | Web 相关配置 |
| `@ConditionalOnNotWebApplication` | 不是 Web 应用 | 非 Web 场景 |
| `@ConditionalOnExpression` | SpEL 表达式为 true | 复合条件 |

### 3.2 @ConditionalOnClass：依赖驱动的条件

```java
@Configuration(proxyBeanMethods = false)
@ConditionalOnClass({DataSource.class, EmbeddedDatabaseType.class})
@EnableConfigurationProperties(DataSourceProperties.class)
public class DataSourceAutoConfiguration { }
```

只有 classpath 上有 `javax.sql.DataSource`（引入了 JDBC 相关依赖），这个配置类才会被处理。条件判断靠 `Condition` 接口实现：

```java
public class OnClassCondition implements Condition {
    @Override
    public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
        // 通过 ClassLoader 检查类是否存在
        // 注意：这里不能直接 Class.forName，因为缺失的类会导致 ClassNotFoundException
        // 实际用 ClassUtils.forName 并 catch 异常，或者读字节码注解
    }
}
```

::: tip 为什么用 @ConditionalOnClass 而不是 @Import
如果配置类直接 import 了不存在的类，类加载就会失败。`@ConditionalOnClass` 在**注解元数据层面**做条件判断（读取 class 文件的注解信息，不触发类加载），避免了 `ClassNotFoundException`。这就是为什么自动配置类的 `@ConditionalOnClass` 写在类级别而不是方法级别。
:::

### 3.3 @ConditionalOnMissingBean：用户优先

```java
@Bean
@ConditionalOnMissingBean(DataSource.class)
public DataSource defaultDataSource(DataSourceProperties properties) {
    return properties.initializeDataSourceBuilder().type(HikariDataSource.class).build();
}
```

如果用户自己定义了 `DataSource` Bean，这个默认的就不会创建。这就是 Spring Boot "你不配我就帮你配，你配了我就不插手"的设计哲学。

**生效的前提**：`DeferredImportSelector` 确保自动配置在用户配置之后处理，所以用户定义的 Bean 已经在容器中，`@ConditionalOnMissingBean` 能正确检测到。

### 3.4 @ConditionalOnProperty：配置开关

```java
@Bean
@ConditionalOnProperty(prefix = "spring.cache", name = "type", havingValue = "redis")
public RedisCacheManager redisCacheManager() { }
```

```yaml
spring:
  cache:
    type: redis   # 只有配了这个，RedisCacheManager 才生效
```

参数：

| 参数 | 说明 |
| --- | --- |
| `prefix` | 属性前缀 |
| `name` / `value` | 属性名 |
| `havingValue` | 期望值（不设则只要存在就匹配） |
| `matchIfMissing` | 属性不存在时是否匹配（默认 false） |

### 3.5 组合条件

多个条件注解可以叠加，是 **AND** 关系：

```java
@Configuration
@ConditionalOnClass(RedisOperations.class)
@ConditionalOnProperty(prefix = "spring.redis", name = "enabled", havingValue = "true", matchIfMissing = true)
public class RedisAutoConfiguration { }
```

Redis 类在 classpath **且** `spring.redis.enabled` 为 true（或不配默认 true），才生效。

---

## 4. 自动配置类的结构

一个典型的自动配置类长这样：

```java
@AutoConfiguration                   // Spring Boot 3 的组合注解（@Configuration + @AutoConfigureBefore/After）
@ConditionalOnClass({SqlSessionFactory.class, SqlSessionFactoryBean.class})
@ConditionalOnSingleCandidate(DataSource.class)
@EnableConfigurationProperties(MybatisProperties.class)
@AutoConfigureAfter(DataSourceAutoConfiguration.class)
public class MybatisAutoConfiguration {

    private final MybatisProperties properties;

    // 构造器注入配置属性
    public MybatisAutoConfiguration(MybatisProperties properties) {
        this.properties = properties;
    }

    @Bean
    @ConditionalOnMissingBean
    public SqlSessionFactory sqlSessionFactory(DataSource dataSource) throws Exception {
        SqlSessionFactoryBean factory = new SqlSessionFactoryBean();
        factory.setDataSource(dataSource);
        // ... 配置
        return factory.getObject();
    }

    @Bean
    @ConditionalOnMissingBean
    public SqlSessionTemplate sqlSessionTemplate(SqlSessionFactory sqlSessionFactory) {
        return new SqlSessionTemplate(sqlSessionFactory);
    }
}
```

固定套路：

1. `@ConditionalOnClass` 守门：依赖在才处理。
2. `@EnableConfigurationProperties` 绑定配置前缀。
3. `@AutoConfigureAfter` 指定依赖的配置类先加载。
4. 每个方法 `@Bean` + `@ConditionalOnMissingBean`：用户没自定义才创建默认实现。
5. 构造器注入属性对象，不直接 `@Value`。

---

## 5. 启动流程：自动配置何时介入

```
SpringApplication.run()
  ├─ createApplicationContext()           // 创建 AnnotationConfigServletWebServerApplicationContext
  ├─ prepareContext()                      // 注册主配置类（@SpringBootApplication 标记的类）
  │     └─ load(primarySources)            // 注册主类为 BeanDefinition
  ├─ refreshContext()                      // ← 核心在这里
  │     └─ invokeBeanFactoryPostProcessors()
  │           └─ ConfigurationClassPostProcessor
  │                 ├─ process user @Configuration       // 1. 先处理用户的配置类
  │                 │     └─ @ComponentScan 扫描
  │                 │     └─ @Import(DeferredImportSelector) 注册但延迟执行
  │                 ├─ process deferred imports           // 2. 用户配置处理完后
  │                 │     └─ AutoConfigurationImportSelector.selectImports()
  │                 │           ├─ 读取 AutoConfiguration.imports / spring.factories
  │                 │           ├─ 去重、排序
  │                 │           └─ @Conditional 过滤
  │                 └─ 注册筛选后的自动配置类为 BeanDefinition
  │           └─ register bean definitions
  ├─ registerBeanPostProcessors()
  └─ finishBeanFactoryInstantiation()      // 实例化所有单例 Bean
```

关键时序：**用户的 `@Configuration` 先处理，自动配置类后处理**（靠 `DeferredImportSelector`）。这保证了 `@ConditionalOnMissingBean` 能正确检测用户是否已定义。

---

## 6. @ConfigurationProperties：配置绑定

### 6.1 基本用法

```java
@ConfigurationProperties(prefix = "spring.datasource")
public class DataSourceProperties {

    private String url;
    private String username;
    private String password;
    private String driverClassName;
    private Hikari hikari = new Hikari();

    // getter / setter ...

    public static class Hikari {
        private int maximumPoolSize = 10;
        // getter / setter ...
    }
}
```

```yaml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/mydb
    username: root
    password: secret
    hikari:
      maximum-pool-size: 20
```

### 6.2 绑定的两种触发方式

**方式一：@EnableConfigurationProperties（自动配置类中常用）**

```java
@Configuration
@EnableConfigurationProperties(DataSourceProperties.class)
public class DataSourceAutoConfiguration { }
```

**方式二：@ConfigurationProperties + @Component（业务代码中常用）**

```java
@Component
@ConfigurationProperties(prefix = "app.feature")
public class FeatureProperties { }
```

### 6.3 宽松绑定

Spring Boot 支持多种命名风格映射到同一属性：

```yaml
app:
  feature:
    max-pool-size: 20    # kebab-case（推荐）
```

对应 Java 字段 `maxPoolSize`（camelCase）。以下都等价：

| 来源 | 格式 |
| --- | --- |
| yml | `max-pool-size`（推荐 kebab-case） |
| properties 文件 | `maxPoolSize` / `max-pool-size` |
| 环境变量 | `APP_FEATURE_MAX_POOL_SIZE`（全大写下划线） |
| Java 字段 | `maxPoolSize` |

### 6.4 校验

```java
@ConfigurationProperties(prefix = "app.feature")
@Validated   // 触发 JSR-303 校验
public class FeatureProperties {

    @NotBlank
    private String name;

    @Min(1) @Max(100)
    private int maxPoolSize;
}
```

绑定后自动校验，校验失败启动报错。

---

## 7. 自动配置的排序

多个自动配置类之间有依赖关系（比如 MyBatis 的配置要在 DataSource 之后），通过以下注解控制顺序：

```java
@AutoConfigureAfter(DataSourceAutoConfiguration.class)    // 在指定配置之后
@AutoConfigureBefore(WebMvcAutoConfiguration.class)       // 在指定配置之前
@AutoConfigureOrder(100)                                   // 数字越小优先级越高
```

::: warning 排序的限制
排序只在**自动配置类之间**生效，不能用来控制用户自定义 `@Configuration` 的顺序。用户的配置始终先于自动配置处理。
:::

---

## 8. 自定义 Starter

### 8.1 命名规范

| 类型 | 命名 | 示例 |
| --- | --- | --- |
| 官方 Starter | `spring-boot-starter-xxx` | `spring-boot-starter-data-redis` |
| 第三方 Starter | `xxx-spring-boot-starter` | `mybatis-spring-boot-starter` |

### 8.2 结构

```
my-feature-spring-boot-starter/
  src/main/java/com/example/autoconfigure/
    MyFeatureAutoConfiguration.java
    MyFeatureProperties.java
  src/main/resources/
    META-INF/
      spring/
        org.springframework.boot.autoconfigure.AutoConfiguration.imports   # Spring Boot 3
      spring.factories                                                      # Spring Boot 2 兼容
```

### 8.3 完整示例

**MyFeatureProperties.java**

```java
@ConfigurationProperties(prefix = "my.feature")
public class MyFeatureProperties {

    private boolean enabled = true;
    private String endpoint = "http://localhost:8080";
    private int timeout = 3000;

    // getter / setter
}
```

**MyFeatureAutoConfiguration.java**

```java
@AutoConfiguration
@ConditionalOnClass(MyFeatureClient.class)
@ConditionalOnProperty(prefix = "my.feature", name = "enabled", havingValue = "true", matchIfMissing = true)
@EnableConfigurationProperties(MyFeatureProperties.class)
public class MyFeatureAutoConfiguration {

    private static final Logger log = LoggerFactory.getLogger(MyFeatureAutoConfiguration.class);

    @Bean
    @ConditionalOnMissingBean
    public MyFeatureClient myFeatureClient(MyFeatureProperties properties) {
        log.info("初始化 MyFeatureClient, endpoint={}", properties.getEndpoint());
        return new MyFeatureClient(properties.getEndpoint(), properties.getTimeout());
    }
}
```

**AutoConfiguration.imports**（Spring Boot 3）

```
com.example.autoconfigure.MyFeatureAutoConfiguration
```

**spring.factories**（Spring Boot 2 兼容）

```properties
org.springframework.boot.autoconfigure.EnableAutoConfiguration=\
  com.example.autoconfigure.MyFeatureAutoConfiguration
```

使用方只需引入依赖：

```xml
<dependency>
    <groupId>com.example</groupId>
    <artifactId>my-feature-spring-boot-starter</artifactId>
    <version>1.0.0</version>
</dependency>
```

```yaml
my:
  feature:
    enabled: true
    endpoint: http://prod-server:8080
    timeout: 5000
```

`MyFeatureClient` 自动注入容器，业务代码直接 `@Autowired`。

---

## 9. 排查自动配置

### 9.1 启动时打印生效的配置

```bash
java -jar app.jar --debug
```

或 `application.yml`：

```yaml
debug: true
```

启动日志会输出 `Positive matches`（生效的自动配置）和 `Negative matches`（未生效的及原因）：

```
============================
CONDITIONS EVALUATION REPORT
============================

Positive matches:
   DataSourceAutoConfiguration matched:
      - @ConditionalOnClass found required classes 'javax.sql.DataSource' (OnClassCondition)

Negative matches:
   RedisAutoConfiguration:
      Did not match:
         - @ConditionalOnClass did not find required class 'org.springframework.data.redis.core.RedisOperations' (OnClassCondition)
```

### 9.2 排查某个 Bean 没生效

1. `--debug` 看 Negative matches，确认是哪个 `@Conditional` 没过。
2. 检查 `@ConditionalOnClass` → 依赖是否引入。
3. 检查 `@ConditionalOnProperty` → 配置项是否正确。
4. 检查 `@ConditionalOnMissingBean` → 是否用户已定义了同类型 Bean。

### 9.3 排除某个自动配置

```java
@SpringBootApplication(exclude = {DataSourceAutoConfiguration.class})
```

```yaml
spring:
  autoconfigure:
    exclude:
      - org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration
```

---

## 10. 常见误区

| 误区 | 说明 |
| --- | --- |
| "自动配置 = 魔法" | 不是魔法，是 `@Import` + `ImportSelector` + `@Conditional` 的组合 |
| "spring.factories 里的类都会加载" | 不会，要过 `@Conditional` 过滤 |
| "自动配置优先于用户配置" | 反了，用户配置先处理（DeferredImportSelector），自动配置用 `@ConditionalOnMissingBean` 让位 |
| "自动配置类 = 普通 Bean" | 它是 `@Configuration` 配置类，里面的 `@Bean` 方法才产生 Bean |
| "`@ConditionalOnClass` 会触发类加载" | 不会，它读注解元数据，不触发缺失类的加载 |
| "starter 必须有 autoconfigure 模块" | 简单场景可以合并，但官方推荐拆分为 `starter`（只管依赖）+ `autoconfigure`（只管配置） |

---

## 11. 检查清单

- [ ] 能说清 `@SpringBootApplication` → `@EnableAutoConfiguration` → `@Import(AutoConfigurationImportSelector)` → `selectImports` 的链路。
- [ ] 知道 Spring Boot 2 用 `spring.factories`，Spring Boot 3 用 `AutoConfiguration.imports`。
- [ ] 能说清 `@ConditionalOnClass` 不触发类加载的原理（注解元数据）。
- [ ] 理解 `@ConditionalOnMissingBean` 生效的前提（DeferredImportSelector 保证用户配置先处理）。
- [ ] 能手写一个自定义 starter（Properties + AutoConfiguration + imports 文件）。
- [ ] 知道用 `--debug` 查看自动配置报告。
- [ ] 知道 `@AutoConfigureAfter` 只控制自动配置类之间的顺序。

## 关联笔记

- [Spring IoC 与依赖注入](/notes/java-backend/spring-ioc-di)
- [Spring Boot 配置文件与 Profile](/notes/java-backend/config-profiles)
- [Spring AOP](/notes/java-backend/spring-aop)
