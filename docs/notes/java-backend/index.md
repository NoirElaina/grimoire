---
title: Java 后端总览
sidebarTitle: 专题首页
---

# Java 后端总览

这一组围绕 Java 后端的“地基 + 工程 + 数据访问 + 事务 + 项目案例”展开。读的时候不要按文件名硬背，先看自己要解决的是语言基础、Spring 工程、数据库访问，还是业务一致性。

## Java 集合与流

| 笔记 | 重点 |
| --- | --- |
| [Java Stream 使用笔记](/notes/java-backend/java-stream) | 集合流式处理、分组、映射、常见坑 |
| [Java 常用集合](/notes/java-backend/java-collections) | `List`、`Set`、`Map`、队列、并发集合怎么选 |
| [Java HashMap 结构](/notes/java-backend/hashmap-structure) | 数组、链表、红黑树、扩容、树化阈值 |

## Java 并发

| 笔记 | 重点 |
| --- | --- |
| [JDK 常见线程池](/notes/java-backend/java-thread-pools) | 四类线程池、底层参数、队列和拒绝策略 |
| [Java ThreadLocal](/notes/java-backend/threadlocal) | `ThreadLocalMap`、弱引用、线程池清理、上下文传递 |
| [Java synchronized](/notes/java-backend/synchronized) | monitor、可重入、可见性、锁粒度 |
| [Java Lock](/notes/java-backend/java-lock) | `ReentrantLock`、`tryLock`、`Condition`、读写锁 |
| [Java 并发深度](/notes/java-backend/java-concurrency) | JMM、`volatile`、CAS/原子类、`ConcurrentHashMap`、`CompletableFuture` |

## Java 设计模式

| 笔记 | 重点 |
| --- | --- |
| [Java 设计模式实战](/notes/java-backend/design-patterns) | 策略、工厂、装饰器、代理、观察者、单例、状态机 |

## Spring 地基

| 笔记 | 重点 |
| --- | --- |
| [Spring IoC 与依赖注入](/notes/java-backend/spring-ioc-di) | Bean 创建、注入、生命周期、循环依赖边界 |
| [Spring AOP](/notes/java-backend/spring-aop) | 动态代理、JDK vs CGLIB、拦截器链、自调用、三级缓存 |
| [Spring Boot 自动配置](/notes/java-backend/spring-boot-autoconfig) | `@EnableAutoConfiguration`、`@Conditional`、自定义 starter |
| [Spring MVC 请求链路](/notes/java-backend/spring-mvc-request-flow) | DispatcherServlet、参数绑定、返回值、异常链路 |
| [Spring Boot 配置文件与 Profile](/notes/java-backend/config-profiles) | 配置分层、环境隔离、敏感配置、启动参数 |

## 基础工程

| 笔记 | 重点 |
| --- | --- |
| [Spring Boot 项目骨架](/notes/java-backend/spring-boot-template) | 包结构、启动类、配置、通用组件落位 |
| [Java 后端分层与 DTO](/notes/java-backend/layering-dto) | controller、service、mapper、DTO/VO/DO 边界 |
| [接口设计](/notes/java-backend/api-design-template) | 请求响应、分页、幂等、错误码、兼容性 |
| [Bean Validation 参数校验](/notes/java-backend/bean-validation) | 入参校验、分组校验、自定义注解 |
| [统一异常与错误码](/notes/java-backend/exception-error-code) | 业务异常、系统异常、错误响应结构 |
| [日志 traceId 与审计日志](/notes/java-backend/logging-trace-audit) | 请求链路、业务审计、异常定位 |
| [Maven 依赖管理](/notes/java-backend/maven-dependency-management) | 版本收敛、依赖冲突、模块边界 |
| [过滤器与拦截器](/notes/java-backend/filter-interceptor) | Servlet Filter、HandlerInterceptor、认证鉴权落点 |
| [问题排查](/notes/java-backend/troubleshooting-template) | 复现、定位、日志、指标、回归验证 |
| [JWT 鉴权设计笔记](/notes/java-backend/jwt-auth) | token 结构、登录态、刷新、吊销和权限 |

## 数据访问

| 笔记 | 重点 |
| --- | --- |
| [MyBatis 核心地基](/notes/java-backend/mybatis-core) | mapper、参数绑定、结果映射、SQL 边界 |
| [MyBatis XML 动态 SQL](/notes/java-backend/mybatis-xml-dynamic-sql) | `if`、`foreach`、批量查询、动态条件 |
| [MyBatis-Plus 使用笔记](/notes/java-backend/mybatis-plus) | CRUD、Wrapper、分页、逻辑删除、自动填充 |
| [Spring Boot Flyway 数据库迁移](/notes/java-backend/flyway) | 版本脚本、上线顺序、回填和回滚边界 |

## 事务与一致性

| 笔记 | 重点 |
| --- | --- |
| [Spring 事务回滚规则](/notes/java-backend/transactional-rollback) | `rollbackFor`、异常类型、事务边界 |
| [Spring 事务传播行为](/notes/java-backend/transaction-propagation) | REQUIRED、REQUIRES_NEW、NESTED 等使用边界 |
| [Spring 事务失效场景](/notes/java-backend/transaction-failure-scenarios) | 自调用、非 public、异常吞掉、代理失效 |
| [本地事务与外部副作用](/notes/java-backend/transaction-outbox-side-effects) | afterCommit、outbox、MQ/缓存副作用 |
| [转账与订单一致性案例](/notes/java-backend/transfer-order-consistency-case) | 转账、订单创建、补偿、状态机 |

## 项目案例

| 笔记 | 重点 |
| --- | --- |
| [商品详情查询与缓存案例](/notes/java-backend/product-detail-cache-case) | 商品聚合查询、缓存、降级和一致性 |
| [用户登录鉴权案例](/notes/java-backend/user-login-auth-case) | 登录、token、Redis 会话、鉴权链路 |
| [订单支付超时关闭](/notes/java-backend/order-timeout-close) | 延迟关闭、状态判断、库存回补 |

## 微服务组件

| 笔记 | 重点 |
| --- | --- |
| [OpenFeign 使用笔记](/notes/java-backend/openfeign) | 声明式调用、超时、降级、错误处理 |
| [Nacos 使用笔记](/notes/java-backend/nacos) | 服务注册发现、配置中心、环境隔离 |
| [Sentinel 使用笔记](/notes/java-backend/sentinel) | 限流、熔断、热点参数、降级策略 |

## 写作边界

- 语言基础要落到后端场景，比如线程池、集合组装、上下文传递。
- Spring 工程要说明代码放在哪里、为什么这么分层。
- 数据访问要绑定 SQL、事务、索引、迁移和异常处理。
- 项目案例要能串起接口、表结构、缓存、MQ、事务和排障。
