---
title: 问题排查
sidebarTitle: 问题排查
---

# 问题排查

线上问题最怕的不是“暂时没定位到”，而是：

- 一上来就乱猜
- 没有 traceId
- 没有固定排查顺序
- 修完了也没留下可复用路径

所以这篇不再只是空模板，而是直接给一版更实用的 Java 后端排查方法。

## 先说结论

一个后端问题更稳的排查顺序通常是：

1. 先定现象
2. 再定范围
3. 再定层次
4. 再定根因
5. 最后定修复和防再发

一句话就是：

**不要一上来改代码，先把问题缩到一个层里。**

## 第一步：先把问题概述写实

至少先记这些：

```text
问题标题：
发生时间：
影响范围：
相关环境：
相关接口：
现象描述：
```

例如：

```text
问题标题：创建订单接口 RT 飙升
发生时间：2026-05-11 14:20
影响范围：订单服务线上流量约 35%
相关接口：POST /api/orders
现象描述：RT 从 120ms 升到 5s，部分请求超时
```

这一步的作用是避免后面越查越偏。

## 第二步：先定问题属于哪一层

Java 后端问题，通常先分成这几层：

- 请求层
- 应用层
- 数据库层
- Redis / MQ / Feign 等外部依赖层
- JVM / 线程 / GC 层
- 网络与网关层

如果不先分层，最常见的场景就是：

- 明明是数据库慢
- 却一直在怀疑 Controller 写得不好

## 第三步：先查日志，再查代码

日志是现场，代码只是解释现场的候选人。

先收这些：

- `traceId`
- `requestId`
- 异常堆栈
- 调用耗时
- SQL 慢日志
- 远程调用异常

如果系统里已经有 traceId，可以先 `rg` 或日志平台按 traceId 过滤整条链。

## 一版比较实用的排查单

### 请求层

重点看：

- 参数是否合法
- 是否是某类特定请求触发
- 是否只有某个用户、某个租户、某个商品出问题

### 应用层

重点看：

- 是否有 NPE / 参数越界 / 状态机错误
- 是否某段业务循环或递归失控
- 是否锁等待或事务过长

### 数据库层

重点看：

- 慢 SQL
- 锁等待
- 索引失效
- 连接池耗尽

### 外部依赖层

重点看：

- Redis 超时
- MQ 堆积
- OpenFeign / HTTP 下游超时
- Nacos / Sentinel / Gateway 配置变更

### JVM 层

重点看：

- 线程池打满
- Full GC
- 堆内存上涨
- 死锁

## 排查时最好按“先现象后根因”写记录

例如：

```md
### 现象
- 接口 RT 升高
- Tomcat 工作线程占满
- 同时出现大量 `Read timed out`

### 定位过程
- 通过 traceId 发现卡在 `userClient.getById`
- 下游 `user-service` QPS 正常，但 RT 升高
- 继续看下游日志，发现某 SQL 缺索引
```

这样复盘才有价值。

## 一个典型接口慢问题怎么查

下面给一条真实很常见的路径。

### 场景

`GET /api/orders/{id}` 慢，RT 从 `80ms` 升到 `2s+`。

### 排查顺序

1. 先看接口日志，确认是全量慢还是部分 ID 慢
2. 按 traceId 看整条链路
3. 区分是应用内慢，还是下游依赖慢
4. 如果是数据库慢，看 SQL 和执行计划

### 代码层最好埋这些日志

```java
long start = System.currentTimeMillis();
try {
    UserVO user = userClient.getById(userId);
    log.info("call userClient success, traceId={}, cost={}ms",
            MDC.get("traceId"),
            System.currentTimeMillis() - start);
} catch (Exception e) {
    log.error("call userClient failed, traceId={}", MDC.get("traceId"), e);
    throw e;
}
```

这样你能迅速判断慢在哪一跳。

## 一个典型 500 问题怎么查

### 优先确认三件事

1. 是否可稳定复现
2. 是所有请求都报还是特定条件报
3. 堆栈顶层真正抛错的方法在哪

不要只看最外层：

```text
Servlet.service() for servlet [dispatcherServlet] threw exception
```

要继续看到真正业务异常位置。

## 一个典型数据库问题怎么查

如果怀疑数据库，至少先确认：

- 哪条 SQL 慢
- 是否走索引
- 是否锁等待
- 是否连接池不足

MySQL 场景里，最常看的不是“Java 代码像不像有问题”，而是：

- 慢查询日志
- `EXPLAIN`
- 当前锁等待

例如：

```sql
EXPLAIN
SELECT * FROM orders
WHERE user_id = 1001
ORDER BY create_time DESC
LIMIT 20;
```

然后确认：

- 是否命中联合索引
- 是否出现 filesort / full scan

## 一个典型线程池打满问题怎么查

如果接口开始大量超时、吞吐下降、CPU 不高但系统很卡，就要怀疑线程池问题。

重点看：

- Tomcat 线程池
- 自定义业务线程池
- MQ 消费线程池

Spring 里如果你自己定义线程池，最好一开始就打印关键指标：

```java
ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
executor.setCorePoolSize(8);
executor.setMaxPoolSize(16);
executor.setQueueCapacity(200);
executor.setThreadNamePrefix("biz-async-");
executor.initialize();
```

线上排查时重点问：

- 活跃线程数多少
- 队列堆积多少
- 是否因为下游阻塞导致线程不释放

## 一个典型 Redis / Feign 问题怎么查

### Redis

重点看：

- 连接超时
- 热点 key
- 大 key
- 突发缓存失效

### Feign / HTTP

重点看：

- 下游是否超时
- 是否大量重试
- 是否线程被外部依赖阻塞

排查时可以优先加调用耗时日志：

```java
StopWatch stopWatch = new StopWatch();
stopWatch.start();
try {
    userClient.getById(userId);
} finally {
    stopWatch.stop();
    log.info("call user service cost={}ms", stopWatch.getTotalTimeMillis());
}
```

## 遇到线上问题时，一定要区分“止血”和“根修”

### 止血

例如：

- 回滚版本
- 临时限流
- 关闭某个开关
- 临时加缓存

### 根修

例如：

- 补索引
- 修事务范围
- 修空指针
- 修线程池配置

很多排查文档只写了止血方案，后面同样问题还会再来。

## 一版比较推荐的排查记录模板

```md
## 问题概述
- 发生时间：
- 影响范围：
- 相关接口：
- 现象：

## 现场信息
- traceId：
- 异常堆栈：
- 关键日志：
- 监控截图：

## 排查过程
1. 先确认复现条件
2. 缩小到哪一层
3. 哪一跳最慢 / 哪一处报错
4. 如何验证根因

## 根因
- 根因描述：
- 为什么发生：
- 为什么之前没发现：

## 修复
- 临时止血：
- 最终修复：
- 补了哪些测试 / 监控：
```

## 最后记一句话

**排查能力的核心，不是记住多少“故障类型”，而是遇到问题时能不能快速把它缩到一层、缩到一跳、缩到一段代码。**

只要这条路径稳定下来，复杂问题也会慢慢变得有章法。
