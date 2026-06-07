---
title: Spring IoC 与依赖注入
sidebarTitle: Spring IoC / DI
---

# Spring IoC 与依赖注入

> Spring 地基里最先要懂的不是注解名字，而是：对象谁创建、依赖谁装配、生命周期谁管理。

## 先给结论

Spring IoC 容器负责管理 Bean：

```text
扫描类 / 读取配置
  -> 创建 BeanDefinition
  -> 实例化对象
  -> 注入依赖
  -> 初始化
  -> 放进容器
  -> 业务代码使用
```

后端项目里要记住：

- 业务对象不要到处 `new`，交给 Spring 管理。
- 依赖优先构造器注入。
- Service 写业务，Repository / Mapper 写数据访问。
- 配置类负责第三方组件 Bean。
- Bean 的名字、作用域、条件装配要能说清。

## 什么是 IoC

普通写法是对象自己创建依赖：

```java
public class OrderService {

    private final OrderMapper orderMapper = new OrderMapper();
}
```

问题：

- 强依赖具体实现。
- 不方便替换测试对象。
- 对象创建散落在业务代码里。
- 配置和生命周期不好统一管理。

Spring 写法：

```java
@Service
public class OrderService {

    private final OrderMapper orderMapper;

    public OrderService(OrderMapper orderMapper) {
        this.orderMapper = orderMapper;
    }
}
```

对象创建和依赖组装交给容器，业务类只声明自己需要什么。

## 常见 Bean 注解

| 注解 | 用在哪里 | 语义 |
| --- | --- | --- |
| `@Component` | 通用组件 | 放进 Spring 容器 |
| `@Service` | 业务服务 | 表示业务层 Bean |
| `@Repository` | 数据访问 | 表示持久层 Bean |
| `@Controller` | MVC 控制器 | 返回页面或响应 |
| `@RestController` | REST 接口 | 返回 JSON |
| `@Configuration` | 配置类 | 提供 Bean 定义 |
| `@Bean` | 方法上 | 方法返回值注册为 Bean |

不要把所有类都标 `@Component`。注解语义要和分层一致。

## 构造器注入

推荐：

```java
@Service
public class ProductService {

    private final ProductMapper productMapper;
    private final ProductCache productCache;

    public ProductService(ProductMapper productMapper, ProductCache productCache) {
        this.productMapper = productMapper;
        this.productCache = productCache;
    }
}
```

优点：

- 依赖不可变。
- 启动时就能发现缺依赖。
- 方便单元测试。
- 不需要字段反射注入。

不推荐字段注入：

```java
@Autowired
private ProductMapper productMapper;
```

问题：

- 依赖不明显。
- 不方便构造测试对象。
- 字段可以被外部误改。
- 循环依赖更容易被隐藏。

## `@Bean` 什么时候用

自己写的业务类通常用 `@Service`、`@Component`。

第三方对象或需要复杂构造逻辑时用 `@Bean`：

```java
@Configuration
public class RedisConfig {

    @Bean
    public RedisTemplate<String, Object> redisTemplate(RedisConnectionFactory connectionFactory,
                                                       ObjectMapper objectMapper) {
        RedisTemplate<String, Object> template = new RedisTemplate<>();
        template.setConnectionFactory(connectionFactory);
        template.setKeySerializer(new StringRedisSerializer());
        template.setHashKeySerializer(new StringRedisSerializer());
        template.setValueSerializer(new GenericJacksonJsonRedisSerializer(objectMapper));
        template.setHashValueSerializer(new GenericJacksonJsonRedisSerializer(objectMapper));
        template.afterPropertiesSet();
        return template;
    }
}
```

适合 `@Bean` 的对象：

- `RedisTemplate`
- `RabbitTemplate` 定制化配置
- `ObjectMapper` 扩展模块
- 第三方 SDK Client
- 线程池
- 规则引擎、加密器、限流器

## 同类型多个 Bean

如果同一个类型有多个 Bean，Spring 不知道注入哪个。

```java
@Bean
public PaymentClient alipayClient() {
    return new AlipayClient();
}

@Bean
public PaymentClient wechatPayClient() {
    return new WechatPayClient();
}
```

注入时要指定：

```java
@Service
public class PayService {

    private final PaymentClient alipayClient;

    public PayService(@Qualifier("alipayClient") PaymentClient alipayClient) {
        this.alipayClient = alipayClient;
    }
}
```

或者用 `@Primary` 指定默认 Bean。

```java
@Bean
@Primary
public PaymentClient defaultPaymentClient() {
    return new AlipayClient();
}
```

工程原则：

- `@Primary` 只能有明确默认实现时用。
- 多策略场景更推荐注入 `Map<String, PaymentClient>`。

```java
@Service
public class PayRouter {

    private final Map<String, PaymentClient> paymentClientMap;

    public PayRouter(Map<String, PaymentClient> paymentClientMap) {
        this.paymentClientMap = paymentClientMap;
    }

    public PaymentClient getClient(String channel) {
        PaymentClient client = paymentClientMap.get(channel + "PaymentClient");
        if (client == null) {
            throw new BizException(ErrorCode.PAY_CHANNEL_NOT_SUPPORTED);
        }
        return client;
    }
}
```

## Bean 作用域

默认是单例：

```text
singleton：一个容器里一个 Bean 实例
prototype：每次获取都创建新实例
request：每个 HTTP 请求一个实例
session：每个 HTTP Session 一个实例
```

后端项目里大多数 Service、Mapper、配置类都是单例。

单例 Bean 要注意：

- 不要放用户请求状态。
- 不要用普通成员变量保存临时业务数据。
- 可变共享状态要加并发控制。

错误示例：

```java
@Service
public class ExportService {

    private Long currentUserId;

    public void export(Long userId) {
        this.currentUserId = userId;
    }
}
```

并发请求会互相污染。

## Bean 生命周期

项目里最常见的是初始化和销毁：

```java
@Component
public class CacheWarmupRunner implements ApplicationRunner {

    @Override
    public void run(ApplicationArguments args) {
        warmupHotProducts();
    }
}
```

第三方资源销毁：

```java
@Bean(destroyMethod = "shutdown")
public RedissonClient redissonClient(Config config) {
    return Redisson.create(config);
}
```

常见初始化方式：

| 方式 | 适合 |
| --- | --- |
| `@PostConstruct` | Bean 创建后做轻量初始化 |
| `ApplicationRunner` | 应用启动后执行一次 |
| `CommandLineRunner` | 启动后处理命令行参数 |
| `SmartLifecycle` | 需要控制启动停止顺序 |

不要在初始化里做很慢、不可控的外部调用，否则应用启动会被卡住。

## 循环依赖

循环依赖：

```text
AService -> BService -> AService
```

如果使用构造器注入，Spring 会在启动时暴露问题。

不要用字段注入把循环依赖“绕过去”。更好的做法是拆职责：

```text
OrderService
  -> OrderDomainService
  -> OrderEventPublisher
```

或者把公共逻辑抽到独立组件：

```text
UserService -> UserProfileReader
OrderService -> UserProfileReader
```

循环依赖通常说明两个类边界不清。

## 条件装配

配置类里常见：

```java
@Bean
@ConditionalOnProperty(prefix = "flashmart.pay", name = "enabled", havingValue = "true")
public PaymentClient paymentClient(PaymentProperties properties) {
    return new PaymentClient(properties);
}
```

适合：

- 某个功能可开关。
- 本地环境不用创建真实第三方 Client。
- 不同 profile 用不同实现。

不要让条件装配藏得太深。出了问题时要能从配置定位为什么某个 Bean 没创建。

## 排查 Bean 问题

常见报错：

| 报错 | 方向 |
| --- | --- |
| `NoSuchBeanDefinitionException` | 没注册、扫描不到、条件不满足 |
| `NoUniqueBeanDefinitionException` | 同类型多个 Bean，没有指定 |
| `BeanCurrentlyInCreationException` | 循环依赖 |
| `UnsatisfiedDependencyException` | 依赖链上某个 Bean 创建失败 |

排查顺序：

```text
1. 看报错里缺的是哪个类型
2. 看这个类有没有注解或 @Bean
3. 看包路径是否在启动类扫描范围内
4. 看是否有 @Conditional 条件
5. 看是否有多个实现冲突
6. 看构造器依赖链是否循环
```

## 去空话检查

- [ ] 业务类优先构造器注入。
- [ ] 同类型多个 Bean 使用 `@Qualifier`、`@Primary` 或策略 Map。
- [ ] 单例 Bean 不保存请求级可变状态。
- [ ] 第三方 Client 用 `@Bean` 集中配置。
- [ ] 循环依赖先拆职责，不靠字段注入掩盖。
- [ ] 能按报错定位 Bean 没创建、创建多个、创建失败。

## 参考

- [Spring Framework Bean Dependencies](https://docs.spring.io/spring-framework/reference/core/beans/dependencies.html)
- [Spring Framework Dependency Injection](https://docs.enterprise.spring.io/spring-framework/reference/core/beans/dependencies/factory-collaborators.html)
