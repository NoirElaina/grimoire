---
title: Spring Bean 生命周期与循环依赖
sidebarTitle: Bean 生命周期与循环依赖
---

# Spring Bean 生命周期与循环依赖

> 这块是 Spring 源码题的高频区。面试官真正想确认的是：你知不知道 Bean 从 BeanDefinition 到可用对象中间发生了什么，以及三级缓存到底解决了什么、解决不了什么。

## 先给结论

单例 Bean 的创建链路（去掉细枝末节）：

```text
扫描 / 解析 -> BeanDefinition
  -> getBean(name)
  -> 一级缓存有就直接返回
  -> 没有则 createBean
    -> 实例化（构造器，拿到原始对象）
    -> 提前暴露：把 ObjectFactory 放进三级缓存
    -> 属性填充（依赖注入，触发其它 Bean 创建）
    -> 初始化（Aware -> 前置处理 -> initMethod -> 后置处理，AOP 代理通常在这里）
    -> 放进一级缓存，清理二三级缓存
  -> 返回
```

记住三句话：

- 三级缓存解决的是**单例 + 属性注入（setter / field）**的循环依赖。
- **构造器注入**的循环依赖解决不了，启动直接报错。
- 三级缓存存的不是对象，是 `ObjectFactory`，目的是**把"要不要生成代理"这件事延迟到真正需要的时候再决定**。

## Bean 生命周期的关键阶段

把 `AbstractAutowireCapableBeanFactory.doCreateBean` 拆开看，核心就四步：

| 阶段 | 做什么 | 关键方法 |
| --- | --- | --- |
| 实例化 | 选构造器，反射创建原始对象 | `createBeanInstance` |
| 提前暴露 | 把生成早期引用的工厂放进三级缓存 | `addSingletonFactory` |
| 属性填充 | 解析并注入依赖 | `populateBean` |
| 初始化 | Aware、BeanPostProcessor、initMethod | `initializeBean` |

初始化阶段 `initializeBean` 内部又是固定顺序：

```text
invokeAwareMethods
  -> BeanNameAware / BeanFactoryAware / ApplicationContextAware
applyBeanPostProcessorsBeforeInitialization
  -> @PostConstruct 在这里被调用（InitDestroyAnnotationBeanPostProcessor）
invokeInitMethods
  -> InitializingBean.afterPropertiesSet
  -> 自定义 init-method
applyBeanPostProcessorsAfterInitialization
  -> AOP 代理通常在这一步生成（AbstractAutoProxyCreator）
```

一个能落地记忆的顺序：

```text
构造器 -> 依赖注入 -> Aware -> @PostConstruct -> afterPropertiesSet -> init-method -> AOP 代理 -> 就绪
                                                                                   销毁时：@PreDestroy -> destroy-method
```

面试里能把"`@PostConstruct` 早于 `afterPropertiesSet`、AOP 代理在初始化的最后一步"说清楚，就已经超过大部分背注解的人。

## 三级缓存是什么

在 `DefaultSingletonBeanRegistry` 里：

| 缓存 | 字段 | 存什么 |
| --- | --- | --- |
| 一级 | `singletonObjects` | 完整的、可直接用的单例 |
| 二级 | `earlySingletonObjects` | 提前暴露的早期对象（可能已经是代理） |
| 三级 | `singletonFactories` | 生成早期引用的 `ObjectFactory` |

获取单例时的查找顺序（`getSingleton`）：

```java
protected Object getSingleton(String beanName, boolean allowEarlyReference) {
    Object singletonObject = this.singletonObjects.get(beanName);
    if (singletonObject == null && isSingletonCurrentlyInCreation(beanName)) {
        singletonObject = this.earlySingletonObjects.get(beanName);
        if (singletonObject == null && allowEarlyReference) {
            synchronized (this.singletonObjects) {
                singletonObject = this.singletonObjects.get(beanName);
                if (singletonObject == null) {
                    singletonObject = this.earlySingletonObjects.get(beanName);
                    if (singletonObject == null) {
                        ObjectFactory<?> singletonFactory = this.singletonFactories.get(beanName);
                        if (singletonFactory != null) {
                            singletonObject = singletonFactory.getObject();
                            this.earlySingletonObjects.put(beanName, singletonObject);
                            this.singletonFactories.remove(beanName);
                        }
                    }
                }
            }
        }
    }
    return singletonObject;
}
```

要点：

- 从三级拿到工厂后，调用 `getObject()` 得到早期引用，**升级到二级**，并把三级移除。
- 升级到二级是为了保证同一个 Bean 多次被依赖时，拿到的是**同一个**早期引用，不会每次都重新走工厂。

## 循环依赖怎么被解开

场景：`A` 依赖 `B`，`B` 依赖 `A`，都是字段 / setter 注入。

```text
创建 A
  实例化 A（原始对象）
  把 A 的 ObjectFactory 放进三级缓存
  填充 A 的属性，发现需要 B
    创建 B
      实例化 B
      把 B 的 ObjectFactory 放进三级缓存
      填充 B 的属性，发现需要 A
        getSingleton(A)：三级缓存命中
        调用 A 的 ObjectFactory -> 拿到 A 的早期引用 -> 升二级
        B 注入这个早期 A
      B 初始化完成 -> 进一级缓存
    A 拿到完整的 B
  A 初始化完成 -> 进一级缓存
```

关键就在 `B` 注入 `A` 时，`A` 还没初始化完，但已经能通过三级缓存拿到一个**可用的早期引用**。

## 为什么要三级，两级不够吗

这是这道题的真正分水岭。

如果只有两级（实例化后直接把原始对象放进二级），对**不需要 AOP** 的 Bean 完全够用。问题出在**需要代理**的 Bean 上。

正常情况下，AOP 代理是在初始化的最后一步 `applyBeanPostProcessorsAfterInitialization` 才生成的。但如果 `A` 需要被代理，又发生了循环依赖，`B` 提前拿到的就必须是**代理对象**，而不是原始对象，否则容器里最终的 `A` 是代理，而 `B` 持有的是原始对象，两者不一致。

三级缓存放的是 `ObjectFactory`，它指向 `getEarlyBeanReference`：

```java
protected Object getEarlyBeanReference(String beanName, RootBeanDefinition mbd, Object bean) {
    Object exposedObject = bean;
    for (SmartInstantiationAwareBeanPostProcessor bp : ...) {
        exposedObject = bp.getEarlyBeanReference(exposedObject, beanName);
    }
    return exposedObject;
}
```

这样设计的好处：

- **没有循环依赖时**：三级缓存里的工厂根本不会被调用，代理照常在初始化最后一步生成，时机不变。
- **有循环依赖时**：工厂被调用，`AbstractAutoProxyCreator` 提前生成代理并记录到 `earlyProxyReferences`，保证提前暴露的和最终的是**同一个代理**，且后面初始化结束时不会重复代理。

一句话总结：**三级缓存用 `ObjectFactory` 把"是否提前生成代理"延迟决策，既不破坏 AOP 的正常时机，又能在真正发生循环依赖时给出一致的代理引用。** 两级缓存做不到这种"按需提前代理"。

## 解决不了的情况

### 构造器注入的循环依赖

```java
@Service
public class AService {
    public AService(BService bService) { }
}

@Service
public class BService {
    public BService(AService aService) { }
}
```

实例化 `A` 时构造器就要 `B`，可此时 `A` 连原始对象都还没创建出来，根本没机会放进三级缓存。`B` 同理。结果：

```text
BeanCurrentlyInCreationException
```

这也是为什么有人说"构造器注入能在启动期暴露循环依赖"——它逼你正面解决，而不是靠缓存绕过去。

### prototype 作用域

prototype Bean 不进单例缓存，Spring 不为它管理完整生命周期，循环依赖直接报错。

### @Async 等"非 AOP 自动代理"的代理

`@Async` 的代理不是通过 `getEarlyBeanReference` 提前暴露的，它在初始化后置处理才包一层代理。一旦它卷入循环依赖，提前暴露的是原始对象，最终对象却被换成了代理，Spring 检测到不一致会报错：

```text
Bean with name 'xxx' has been injected into other beans ... in its raw version
as part of a circular reference, but has eventually been wrapped.
```

遇到这种，不要去研究怎么"骗过"容器，应该拆依赖。

## Spring Boot 默认禁止循环依赖

Spring Boot 2.6 起默认：

```yaml
spring:
  main:
    allow-circular-references: false
```

启动时遇到循环依赖会直接失败。打开这个开关能让它启动，但这是**遮羞布不是解决方案**。正确做法和 IoC 那篇一致：

```text
1. 拆职责：把互相依赖的公共逻辑抽到第三个组件
2. 改注入时机：实在要保留，用 @Lazy 延迟注入打破闭环
3. 事件解耦：A 不直接调 B，发事件让 B 监听
```

`@Lazy` 示例（应急用，不是首选）：

```java
@Service
public class AService {
    private final BService bService;

    public AService(@Lazy BService bService) {
        this.bService = bService;
    }
}
```

`@Lazy` 注入的是代理，真正用到时才解析目标 Bean，从而绕开创建期的闭环。但它只是把问题往后推，边界不清的设计该重构还得重构。

## 一个能讲出来的完整故事

面试被问"Spring 怎么解决循环依赖"，可以这样组织：

```text
1. 只针对单例 + setter/字段注入。
2. 实例化后、属性填充前，把生成早期引用的 ObjectFactory 放进三级缓存。
3. 对方注入时通过三级缓存拿到早期引用，需要代理就在这一步提前生成。
4. 早期引用升到二级，保证多次依赖拿到同一个对象。
5. 初始化完成后进一级缓存，清掉二三级。
6. 构造器注入、prototype、@Async 这类场景解决不了，要靠拆职责或 @Lazy。
```

能把第 3、4 步的"代理时机"和"升级二级的原因"讲清楚，这道题就到位了。

## 去空话检查

- [ ] 能说出实例化、属性填充、初始化三大阶段和它们的代表方法。
- [ ] 能排出 `@PostConstruct`、`afterPropertiesSet`、init-method、AOP 代理的先后顺序。
- [ ] 能说清三级缓存各存什么，以及早期引用为什么升二级。
- [ ] 能解释三级缓存的核心是延迟决定是否生成代理，两级为什么不够。
- [ ] 知道构造器注入、prototype、@Async 循环依赖解决不了及其原因。
- [ ] 知道 Spring Boot 2.6+ 默认禁止循环依赖，且首选拆职责而非开开关。

## 参考

- [Spring Framework Bean Lifecycle](https://docs.spring.io/spring-framework/reference/core/beans/factory-nature.html)
- [Spring Framework Customizing Beans (Lifecycle Callbacks)](https://docs.spring.io/spring-framework/reference/core/beans/factory-nature.html#beans-factory-lifecycle)
- [Spring Framework Circular Dependencies](https://docs.spring.io/spring-framework/reference/core/beans/dependencies/factory-collaborators.html)
- [Spring Boot 2.6 Release Notes (Circular References Prohibited)](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-2.6-Release-Notes#circular-references-prohibited-by-default)
