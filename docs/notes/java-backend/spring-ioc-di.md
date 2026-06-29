---
title: Spring IoC 与依赖注入
sidebarTitle: Spring IoC / DI
---

# Spring IoC 与依赖注入

> Spring 地基里最先要懂的不是注解名字，而是：对象谁创建、依赖谁装配、生命周期谁管理。源码题里再往下问容器启动流程、BeanDefinition、`BeanFactory` 与 `ApplicationContext` 的区别，以及两个后置处理器扩展点。

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

## 什么是 IoC 和 DI

IoC（控制反转）是思想：对象的创建和依赖装配的**控制权**从代码本身反转给容器。DI（依赖注入）是 IoC 的落地手段：容器把依赖注入进来。

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

## BeanDefinition：Bean 的“图纸”

容器不是直接管对象，而是先把每个 Bean 抽象成一份 `BeanDefinition`——描述这个 Bean 怎么造的元数据：

| 信息 | 含义 |
| --- | --- |
| beanClassName | 类全限定名 |
| scope | singleton / prototype ... |
| lazyInit | 是否懒加载 |
| dependsOn | 依赖哪些 Bean 先创建 |
| autowireMode | 注入方式 |
| initMethod / destroyMethod | 初始化 / 销毁方法 |
| primary | 是否首选 |

`@Component` 扫描、`@Bean` 方法、XML 配置，最终都被解析成 `BeanDefinition` 注册进 `BeanDefinitionRegistry`。**先有 BeanDefinition，才有 Bean 实例**，这也是为什么能在 Bean 实例化之前通过 `BeanFactoryPostProcessor` 修改它。

## BeanFactory 和 ApplicationContext

| | BeanFactory | ApplicationContext |
| --- | --- | --- |
| 定位 | 最底层容器接口 | BeanFactory 的扩展 |
| 加载时机 | 懒加载，getBean 时才造 | 启动时预实例化单例 |
| 额外能力 | 基本只有 getBean | 事件、国际化、资源加载、自动注册后置处理器 |

项目里用的都是 `ApplicationContext`（如 `AnnotationConfigApplicationContext`、Spring Boot 的 `AnnotationConfigServletWebServerApplicationContext`）。`ApplicationContext` 内部仍然委托一个 `DefaultListableBeanFactory` 干实际的 Bean 管理活。

## 容器启动：refresh()

`ApplicationContext` 启动的核心是 `AbstractApplicationContext.refresh()`，这是一个模板方法，步骤固定：

```java
public void refresh() {
    prepareRefresh();                         // 准备：启动时间、环境校验
    obtainFreshBeanFactory();                 // 创建 BeanFactory，加载 BeanDefinition
    prepareBeanFactory(beanFactory);          // 配置 BeanFactory（类加载器、忽略接口等）
    postProcessBeanFactory(beanFactory);
    invokeBeanFactoryPostProcessors(bf);      // 执行 BeanFactoryPostProcessor（含扫描、@Configuration 解析）
    registerBeanPostProcessors(beanFactory);  // 注册 BeanPostProcessor（此时还没执行）
    initMessageSource();                      // 国际化
    initApplicationEventMulticaster();        // 事件广播器
    onRefresh();                              // 子类扩展（Spring Boot 在这创建内嵌 Web 容器）
    registerListeners();                      // 注册监听器
    finishBeanFactoryInitialization(bf);      // 实例化所有非懒加载单例 Bean
    finishRefresh();                          // 发布 ContextRefreshedEvent
}
```

能把这十来步说出大意，尤其是 **“先执行 BeanFactoryPostProcessor，再注册 BeanPostProcessor，最后 finishBeanFactoryInitialization 才批量造单例 Bean”** 这个顺序，源码题就到位了。单个 Bean 的创建细节（实例化、属性填充、初始化、循环依赖）见 [Bean 生命周期与循环依赖](/notes/java-backend/spring-bean-lifecycle)。

## 两个后置处理器扩展点

这是 Spring 扩展性的核心，面试常对比着问：

| 扩展点 | 作用对象 | 时机 |
| --- | --- | --- |
| `BeanFactoryPostProcessor` | BeanDefinition（图纸） | Bean 实例化**之前**，可改定义 |
| `BeanPostProcessor` | Bean 实例（成品） | Bean 初始化前后，可包装 / 代理 |

- `BeanFactoryPostProcessor`：典型是 `ConfigurationClassPostProcessor`（解析 `@Configuration`/`@ComponentScan`/`@Bean`）和 `PropertySourcesPlaceholderConfigurer`（替换 `${}` 占位符）。
- `BeanPostProcessor`：`@Autowired` 注入（`AutowiredAnnotationBeanPostProcessor`）、`@PostConstruct`（`CommonAnnotationBeanPostProcessor`）、AOP 织入（`AbstractAutoProxyCreator`）全靠它。

一句话：**BeanFactoryPostProcessor 改“怎么造”，BeanPostProcessor 改“造出来之后”。**

## 常见 Bean 注解

| 注解 | 用在哪里 | 语义 |
| --- | --- | --- |
| `@Component` | 通用组件 | 放进 Spring 容器 |
| `@Service` | 业务服务 | 表示业务层 Bean |
| `@Repository` | 数据访问 | 表示持久层 Bean，附带异常转译 |
| `@Controller` | MVC 控制器 | 返回页面或响应 |
| `@RestController` | REST 接口 | 返回 JSON |
| `@Configuration` | 配置类 | 提供 Bean 定义 |
| `@Bean` | 方法上 | 方法返回值注册为 Bean |

`@Service`/`@Controller` 等都是 `@Component` 的派生注解，扫描机制一致，区别在语义和个别附加处理（如 `@Repository` 的持久层异常转译）。不要把所有类都标 `@Component`，注解语义要和分层一致。

## @Configuration 的代理（full vs lite）

一个高频追问：`@Configuration` 类里一个 `@Bean` 方法调用另一个 `@Bean` 方法，会重复创建对象吗？

```java
@Configuration
public class AppConfig {

    @Bean
    public A a() { return new A(); }

    @Bean
    public B b() { return new B(a()); }   // 这里调 a()
}
```

不会。`@Configuration`（full 模式）的类会被 CGLIB 增强成代理，`@Bean` 方法调用被拦截，发现容器里已有单例就直接返回，保证单例语义。如果是 `@Component` 里的 `@Bean`（lite 模式）则没有这层增强，`a()` 就是普通方法调用，会 new 出新对象。这是 full / lite 配置的关键区别。

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

补充：单构造器时可省略 `@Autowired`；`@Autowired` 注入由 `AutowiredAnnotationBeanPostProcessor` 处理，按“类型 → `@Qualifier` → 字段名”的顺序确定候选 Bean。

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
        template.setValueSerializer(new GenericJackson2JsonRedisSerializer(objectMapper));
        template.setHashValueSerializer(new GenericJackson2JsonRedisSerializer(objectMapper));
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
- 多策略场景更推荐注入 `Map<String, PaymentClient>`（Spring 会把 beanName 作为 key 全部注入）。

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

还有一个经典坑：**单例 Bean 注入 prototype Bean**，注入只发生一次，拿到的 prototype 其实被“固定”了。要每次拿新的，用 `@Lookup` 方法注入或注入 `ObjectProvider<T>`。

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

不要在初始化里做很慢、不可控的外部调用，否则应用启动会被卡住。完整生命周期顺序（实例化 → 属性填充 → Aware → 初始化 → AOP 代理）见 [Bean 生命周期与循环依赖](/notes/java-backend/spring-bean-lifecycle)。

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

循环依赖通常说明两个类边界不清。Spring 怎么用三级缓存解决 setter / 字段注入的循环依赖、为什么解决不了构造器注入，见 [Bean 生命周期与循环依赖](/notes/java-backend/spring-bean-lifecycle)。

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

`@ConditionalOnXxx` 是 Spring Boot 自动配置的基石。不要让条件装配藏得太深，出了问题时要能从配置定位为什么某个 Bean 没创建。

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

- [ ] 能说清 IoC/DI 区别，以及 BeanDefinition 是先于实例的元数据。
- [ ] 能区分 BeanFactory 与 ApplicationContext，知道后者预实例化单例。
- [ ] 能讲出 refresh() 的大致步骤和后置处理器执行顺序。
- [ ] 能区分 BeanFactoryPostProcessor 和 BeanPostProcessor。
- [ ] 知道 @Configuration full 模式靠 CGLIB 保证 @Bean 单例。
- [ ] 业务类优先构造器注入，单例不保存请求级状态。
- [ ] 同类型多个 Bean 使用 `@Qualifier`、`@Primary` 或策略 Map。
- [ ] 第三方 Client 用 `@Bean` 集中配置。
- [ ] 能按报错定位 Bean 没创建、创建多个、创建失败。

## 参考

- [Spring Framework IoC Container](https://docs.spring.io/spring-framework/reference/core/beans.html)
- [Spring Framework Bean Dependencies](https://docs.spring.io/spring-framework/reference/core/beans/dependencies.html)
- [Spring Framework Container Extension Points](https://docs.spring.io/spring-framework/reference/core/beans/factory-extension.html)
