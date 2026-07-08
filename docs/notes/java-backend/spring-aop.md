---
title: Spring AOP
sidebarTitle: AOP
---

# Spring AOP

> AOP（面向切面编程）解决的是横切关注点：日志、事务、权限、限流，这些逻辑散落在每个业务方法里会污染业务代码。Spring AOP 的本质是**运行时动态代理**：在 Bean 实例化后、注入前，给 Bean 包一层代理对象，调用方法时先走拦截器链。源码层面要懂代理选型（JDK vs CGLIB）、拦截器链执行流程，以及 AOP 和循环依赖的关系。

## 1. 核心概念

| 术语 | 含义 | Spring 中的对应 |
| --- | --- | --- |
| **Aspect（切面）** | 横切逻辑的模块化，一个包含横切逻辑的类 | `@Aspect` 标注的类 |
| **JoinPoint（连接点）** | 程序执行中可以切入的点 | Spring AOP 中就是方法调用 |
| **Pointcut（切点）** | 匹配哪些连接点 | `@Pointcut` / `execution(...)` 表达式 |
| **Advice（通知/增强）** | 在切点处做什么 | `@Before` / `@After` / `@Around` 等 |
| **Target（目标对象）** | 被代理的原始对象 | 业务 Bean |
| **Weaving（织入）** | 把切面应用到目标对象的过程 | Spring AOP 用运行时动态代理织入 |

简单来说，**切面 = 切点 + 通知**。切点决定"在哪些方法上"，通知决定"做什么"。

---

## 2. 动态代理：AOP 的底层

Spring AOP 不改字节码（那是 AspectJ 做的事），而是在运行时为目标对象生成一个**代理对象**。有两种代理方式。

### 2.1 JDK 动态代理

基于 `java.lang.reflect.Proxy`，要求目标类**实现接口**。

```java
public interface UserService {
    User getById(Long id);
}

public class UserServiceImpl implements UserService {
    @Override
    public User getById(Long id) { return ...; }
}
```

代理生成：

```java
UserService proxy = (UserService) Proxy.newProxyInstance(
    classLoader,
    new Class[]{UserService.class},    // 代理接口
    (proxyObj, method, args) -> {
        // 前置增强
        System.out.println("before: " + method.getName());
        Object result = method.invoke(target, args);  // 调用原始对象
        // 后置增强
        System.out.println("after: " + method.getName());
        return result;
    }
);
```

特点：

- 代理对象和目标对象**实现同一个接口**。
- 只能代理接口中的方法。
- 原理是在运行时动态生成一个实现了指定接口的类（`$Proxy0`），所有方法调用转发给 `InvocationHandler.invoke`。

### 2.2 CGLIB 代理

基于字节码生成（ASM），不要求接口，通过**生成目标类的子类**来代理。

```java
public class OrderService {   // 没有实现接口
    public Order createOrder(Request req) { return ...; }
}
```

代理生成：

```java
Enhancer enhancer = new Enhancer();
enhancer.setSuperclass(OrderService.class);   // 继承目标类
enhancer.setCallback((MethodInterceptor) (obj, method, args, proxy) -> {
    System.out.println("before: " + method.getName());
    Object result = proxy.invokeSuper(obj, args);  // 调用父类（原始）方法
    System.out.println("after: " + method.getName());
    return result;
});
OrderService proxy = (OrderService) enhancer.create();
```

特点：

- 代理对象是目标对象的**子类**。
- 不能代理 `final` 类和 `final` 方法（无法继承 / 覆盖）。
- JDK 17+ 需要反射默认开启或 `--add-opens`，否则生成字节码可能受限。

### 2.3 Spring 怎么选

Spring 默认的代理选择策略（`DefaultAopProxyFactory`）：

```
如果目标类实现了接口：
    默认用 JDK 动态代理（代理接口）
    但如果设置了 proxyTargetClass = true → 强制用 CGLIB

如果目标类没有实现接口：
    用 CGLIB
```

Spring Boot 2.x 之后，`spring.aop.proxy-target-class` **默认为 true**，即默认用 CGLIB。这是为了解决"注入接口类型时如果实现类被 CGLIB 代理了，注入接口会失败"等一致性问题。

```java
// @EnableAspectJAutoProxy 的参数
@EnableAspectJAutoProxy(proxyTargetClass = true)   // 强制 CGLIB
```

| 对比 | JDK 动态代理 | CGLIB |
| --- | --- | --- |
| 要求 | 目标类实现接口 | 无要求（不能是 final） |
| 代理对象关系 | 实现同一接口 | 继承目标类 |
| 性能（创建） | 较快 | 较慢（生成字节码） |
| 性能（调用） | 反射调用，稍慢 | MethodFastCall，较快 |
| Spring Boot 默认 | 否（2.x 之前） | 是（2.x 之后默认 proxyTargetClass=true） |

---

## 3. 通知类型

### 3.1 五种通知

```java
@Aspect
@Component
public class LogAspect {

    // 切点：匹配 service 包下所有类的所有方法
    @Pointcut("execution(* com.example.service..*.*(..))")
    public void servicePointcut() {}

    @Before("servicePointcut()")
    public void before(JoinPoint jp) {
        log.info("before: {}.{}",
            jp.getTarget().getClass().getSimpleName(),
            jp.getSignature().getName());
    }

    @After("servicePointcut()")
    public void after(JoinPoint jp) {
        log.info("after");
    }

    @AfterReturning(pointcut = "servicePointcut()", returning = "result")
    public void afterReturning(JoinPoint jp, Object result) {
        log.info("return: {}", result);
    }

    @AfterThrowing(pointcut = "servicePointcut()", throwing = "ex")
    public void afterThrowing(JoinPoint jp, Exception ex) {
        log.error("exception: {}", ex.getMessage());
    }

    @Around("servicePointcut()")
    public Object around(ProceedingJoinPoint pjp) throws Throwable {
        long start = System.currentTimeMillis();
        try {
            Object result = pjp.proceed();        // 执行目标方法
            return result;
        } finally {
            log.info("cost: {}ms", System.currentTimeMillis() - start);
        }
    }
}
```

### 3.2 执行顺序

当多种通知同时作用于同一个方法时，执行顺序：

```
@Around（前半段）
  └─ @Before
       └─ 目标方法
  └─ @AfterReturning（正常返回）  /  @AfterThrowing（抛异常）
       └─ @After
@Around（后半段）
```

::: tip @Around 最灵活
`@Around` 能控制是否调用目标方法（`pjp.proceed()`）、修改参数、修改返回值、吞掉异常。其他四种通知做不到这些。实际项目中 `@Around` 用得最多，因为它能包揽前置+后置+异常处理。
:::

### 3.3 @Around 的注意事项

```java
@Around("servicePointcut()")
public Object around(ProceedingJoinPoint pjp) throws Throwable {
    // 1. 必须调用 proceed()，否则目标方法不执行
    Object result = pjp.proceed();

    // 2. 必须返回结果，否则调用方拿到 null
    return result;
}
```

常见错误：

```java
@Around("servicePointcut()")
public Object around(ProceedingJoinPoint pjp) throws Throwable {
    pjp.proceed();
    return null;   // ❌ 吞掉了返回值，调用方拿到 null
}
```

---

## 4. 拦截器链的执行

### 4.1 ReflectiveMethodInvocation

代理对象的方法被调用时，不是直接执行一个 `InvocationHandler`，而是走一条**拦截器链**。核心是 `ReflectiveMethodInvocation`（JDK 代理）或 `CglibMethodInvocation`（CGLIB 代理）。

```java
// 简化后的核心逻辑
public Object proceed() throws Throwable {
    if (currentInterceptorIndex == interceptors.size() - 1) {
        // 所有拦截器执行完，调用目标方法
        return invokeJoinpoint();
    }
    // 取下一个拦截器
    MethodInterceptor interceptor = interceptors.get(++currentInterceptorIndex);
    return interceptor.invoke(this);
}
```

每个通知被适配成一个 `MethodInterceptor`，按顺序执行：

```
调用代理方法
  └─ ReflectiveMethodInvocation.proceed()
       ├─ ExposeInvocationInterceptor    （最外层，暴露调用上下文）
       ├─ AspectJAroundAdvice            （@Around）
       ├─ MethodBeforeAdviceInterceptor  （@Before）
       ├─ AspectJAfterAdvice             （@After）
       ├─ AfterReturningAdviceInterceptor（@AfterReturning）
       ├─ AspectJAfterThrowingAdvice     （@AfterThrowing）
       └─ invokeJoinpoint()              （目标方法）
```

这是一个**递归调用链**：每个拦截器决定是否调用 `proceed()` 继续，还是在这里返回 / 抛异常。`@Around` 拦截器在 `proceed()` 之前做前置、之后做后置，自然形成了"包裹"效果。

### 4.2 为什么是责任链模式

Spring AOP 允许多个切面叠加在同一个方法上。比如事务切面 + 日志切面 + 限流切面，每个切面是一个拦截器，它们组成一条链，依次执行。责任链模式让每个拦截器只关心自己的逻辑，不需要知道链上还有谁。

---

## 5. 切点表达式

### 5.1 execution

最常用，匹配方法签名：

```
execution(修饰符? 返回类型 包名.类名.方法名(参数类型) 异常?)
```

| 表达式 | 匹配 |
| --- | --- |
| `execution(* com.example.service..*.*(..))` | service 包及子包下所有类的所有方法 |
| `execution(public * *(..))` | 所有 public 方法 |
| `execution(* save*(..))` | 所有以 save 开头的方法 |
| `execution(* com.example.UserService.*(..))` | UserService 类的所有方法 |
| `execution(* *(String, ..))` | 第一个参数是 String 的所有方法 |

### 5.2 annotation

匹配标注了特定注解的方法（更推荐，耦合度低）：

```java
@Pointcut("@annotation(com.example.annotation.Loggable)")
public void loggablePointcut() {}
```

```java
@Loggable   // 只有标注了这个注解的方法才被增强
public Order createOrder(Request req) { ... }
```

### 5.3 组合

```java
// service 包下且标注了 @Loggable 的方法
@Pointcut("execution(* com.example.service..*.*(..)) && @annotation(com.example.annotation.Loggable)")
public void loggableServiceMethod() {}
```

支持 `&&`、`||`、`!`。

---

## 6. 自调用问题：AOP 最大的坑

### 6.1 问题

```java
@Service
public class OrderService {

    public void process(Order order) {
        // 调用本类的另一个方法
        this.validate(order);   // ← 不走代理！@Transactional / 自定义切面全部失效
        save(order);
    }

    @Transactional
    public void validate(Order order) {
        // 事务不生效
    }
}
```

**原因**：`this.validate()` 是直接调用原始对象的方法，不经过代理对象。AOP 的增强逻辑在代理对象上，绕过代理就是绕过了整条拦截器链。

```
调用方 ──→ 代理对象.validate()  ──→ 拦截器链（事务开启） ──→ 原始对象.validate()
                                                                      │
                                                                      └─→ this.save()  ← 直接调用原始对象，不经过代理
```

### 6.2 解决方案

**方案一：自注入（推荐）**

```java
@Service
public class OrderService {

    @Autowired
    @Lazy
    private OrderService self;   // 注入的是代理对象

    public void process(Order order) {
        self.validate(order);    // 通过代理调用，走拦截器链
        save(order);
    }

    @Transactional
    public void validate(Order order) { ... }
}
```

`@Lazy` 防止循环依赖报错。注入的 `self` 是代理对象，调用 `self.validate()` 会经过代理。

**方案二：AopContext 获取当前代理**

```java
((OrderService) AopContext.currentProxy()).validate(order);
```

需要开启 `@EnableAspectJAutoProxy(exposeProxy = true)`，否则 `AopContext.currentProxy()` 抛异常。

**方案三：拆分到不同类**

把 `validate` 挪到另一个 Service，天然不存在自调用。

自调用只是 `@Transactional` 失效的原因之一。完整的失效场景（非 public、异常被吞、异常类型不对、代理未生成、传播行为不当等）见 [Spring 事务失效场景](/notes/java-backend/transaction-failure-scenarios)。

---

## 7. AOP 与循环依赖的关系

AOP 和循环依赖的交集就一个点：**Spring 的三级缓存之所以第三级放 `ObjectFactory` 而不是直接放半成品对象，就是为了把"是否提前生成代理"延迟到真正被循环依赖时再决定**。没有 AOP，两级缓存就够了；有了 AOP，提前暴露的必须是代理对象，否则 `B` 拿到原始对象、容器里最终却是代理，两者不一致。

此外，`@Async` 这类代理不在 `getEarlyBeanReference` 里提前暴露，卷入循环依赖时 Spring 会直接报错。

这两条的完整机制（三级缓存查找顺序、早期引用升二级、`@Async` 报错原因、构造器注入解决不了）在 [Bean 生命周期与循环依赖](/notes/java-backend/spring-bean-lifecycle) 里有完整推导，本篇不重复。只需要记住：**写切面 / `@Async` 时如果撞上循环依赖，首选是拆依赖，不要去研究怎么骗过容器。**

---

## 8. @AspectJ vs Spring AOP

| 对比 | Spring AOP | AspectJ |
| --- | --- | --- |
| 织入时机 | 运行时（动态代理） | 编译时 / 加载时（字节码增强） |
| 实现方式 | JDK 代理 / CGLIB | ajc 编译器 / Java Agent |
| 连接点 | 只支持方法级别 | 支持字段、构造器、方法调用等 |
| 性能 | 代理调用有反射开销 | 直接调用，无额外开销 |
| 使用复杂度 | 低（Spring 集成） | 高（需要编译器 / agent） |

Spring AOP 使用了 AspectJ 的**注解语法**（`@Aspect`、`@Pointcut`、`execution(...)`），但底层实现完全不同。Spring AOP 是基于代理的，AspectJ 是基于字节码编织的。

---

## 9. 实战：自定义注解 + AOP

### 9.1 限流注解

```java
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface RateLimit {
    int qps() default 100;
    String key() default "";
}
```

### 9.2 切面实现

```java
@Aspect
@Component
public class RateLimitAspect {

    private final Map<String, RateLimiter> limiters = new ConcurrentHashMap<>();

    @Around("@annotation(rateLimit)")
    public Object around(ProceedingJoinPoint pjp, RateLimit rateLimit) throws Throwable {
        String key = rateLimit.key().isEmpty()
            ? pjp.getSignature().toLongString()
            : parseKey(rateLimit.key(), pjp);

        RateLimiter limiter = limiters.computeIfAbsent(key,
            k -> RateLimiter.create(rateLimit.qps()));

        if (!limiter.tryAcquire()) {
            throw new BusinessException("请求过于频繁，请稍后再试");
        }
        return pjp.proceed();
    }

    private String parseKey(String keyExpr, ProceedingJoinPoint pjp) {
        // 解析 SpEL 或 #args[0] 之类的表达式
        // 省略实现
        return keyExpr;
    }
}
```

### 9.3 使用

```java
@RestController
public class OrderController {

    @RateLimit(qps = 10, key = "#userId")
    @PostMapping("/orders")
    public Order createOrder(@RequestParam Long userId, @RequestBody CreateOrderRequest req) {
        return orderService.create(userId, req);
    }
}
```

`@RateLimit` 注解 + AOP = 横切逻辑和业务逻辑完全解耦。

---

## 10. 检查清单

- [ ] 能说清 JDK 动态代理（基于接口）和 CGLIB（基于继承）的区别。
- [ ] 知道 Spring Boot 2.x 默认用 CGLIB（`proxyTargetClass=true`）。
- [ ] 能说清五种通知的执行顺序：`@Around` 前 → `@Before` → 目标方法 → `@AfterReturning`/`@AfterThrowing` → `@After` → `@Around` 后。
- [ ] 知道拦截器链是责任链模式，核心是 `ReflectiveMethodInvocation.proceed()` 的递归调用。
- [ ] 能解释自调用失效的原因（`this.xxx()` 不走代理）和三种解决方案。
- [ ] 知道 AOP 是三级缓存存在的原因（延迟代理决策），完整机制见 [Bean 生命周期与循环依赖](/notes/java-backend/spring-bean-lifecycle)。
- [ ] 能手写一个自定义注解 + `@Around` 切面。

## 关联笔记

- [Spring IoC 与依赖注入](/notes/java-backend/spring-ioc-di)
- [Spring Boot 自动配置](/notes/java-backend/spring-boot-autoconfig)
- [Spring 事务失效场景](/notes/java-backend/transaction-failure-scenarios)
- [过滤器与拦截器](/notes/java-backend/filter-interceptor)
