---
title: 问题排查
sidebarTitle: 问题排查
---

# 问题排查

> 排查不要靠感觉，先保现场，再分层定位，最后写清根因和修复。

## 先给结论

线上问题按这个顺序查：

1. 确认现象：谁、什么时候、哪个接口、错误是什么。
2. 找到请求：拿 `traceId`、用户 ID、订单号、接口路径。
3. 看日志：先看错误栈和关键业务日志。
4. 分层定位：请求层、应用层、数据库、缓存、外部依赖、JVM。
5. 先止血：降级、回滚、扩容、限流、修数据。
6. 再根修：补测试、补监控、补保护、补文档。

不要一上来就改代码。先把问题钉住。

## 现场记录模板

排查时边查边记：

```text
问题：
- 时间：
- 环境：
- 影响范围：
- 入口接口：
- traceId：
- 用户 / 订单 / 业务 ID：

现象：
- HTTP 状态：
- 业务错误码：
- 前端提示：
- 日志异常：

初步判断：
- 请求层 / 应用层 / DB / Redis / MQ / 外部 HTTP / JVM

排查过程：
1.
2.
3.

根因：
-

止血：
-

根修：
-
```

记录不是为了好看，是为了防止排查半小时后忘了前面看过什么。

## 第一眼先看四件事

### 是否刚发布

```text
发布时间：10:30
故障开始：10:35
```

高度相关就优先看：

- 新代码。
- 新配置。
- 新 SQL。
- 新依赖版本。
- 新网关规则。

### 是否只有部分用户

只影响部分用户，常见原因：

- 数据脏。
- 权限 / 租户数据问题。
- 灰度流量。
- 某个分片 / 某个库异常。
- 某个下游区域异常。

### 是否只有某个接口

单接口问题优先查：

- Controller 参数。
- Service 业务逻辑。
- SQL。
- 下游调用。
- 缓存 key。

### 是否全站异常

全站异常优先查：

- 数据库连接池。
- Redis。
- 配置中心。
- 网关。
- JVM 内存 / CPU。
- 线程池。
- 最近发布。

## 分层排查单

### 请求层

看这些：

- URL 是否正确。
- HTTP 方法是否正确。
- Header 是否缺 `Authorization`、`Content-Type`、`X-Trace-Id`。
- 请求体是否符合 DTO。
- 网关是否限流、鉴权、超时。

常见现象：

```text
400：参数绑定失败、JSON 格式错、校验失败
401：token 缺失、过期、签名错误
403：权限不足、CSRF、网关规则拦截
404：路径不匹配、context-path 错、网关路由错
```

### 应用层

看这些：

- `traceId` 对应的完整日志。
- 异常栈第一段业务代码。
- 入参是否符合预期。
- 分支条件是否走错。
- 事务是否回滚。
- 是否吞异常后继续执行。

日志建议至少有：

```java
log.info("create order start, userId={}, request={}", userId, request);
log.info("create order success, userId={}, orderId={}", userId, orderId);
log.warn("cancel order rejected, orderId={}, status={}", orderId, status);
log.error("pay order failed, orderId={}", orderId, exception);
```

注意：日志不要打印密码、token、身份证、银行卡。

### 数据库层

看这些：

- SQL 是否命中索引。
- 慢查询日志。
- 连接池是否打满。
- 锁等待。
- 数据是否脏。
- 事务是否太大。

常用 SQL：

```sql
explain select * from t_order where user_id = 10001 order by create_time desc;

show processlist;

select *
from information_schema.innodb_trx;
```

典型问题：

- `where` 字段没索引。
- `like '%keyword%'` 走不了普通索引。
- 大分页 `limit 100000, 20` 慢。
- 事务里调用外部接口导致锁占用时间长。
- 唯一索引冲突被包装成系统异常。

### Redis 层

看这些：

- key 是否正确。
- TTL 是否异常。
- 是否缓存穿透 / 击穿 / 雪崩。
- 序列化格式是否变了。
- Redis 连接池是否打满。

常见坑：

- key 少拼了租户 ID。
- 缓存空值没有过期时间。
- 热点 key 过期后所有请求打到 DB。
- 发版后类字段变化，旧缓存反序列化失败。

### 外部 HTTP / Feign

看这些：

- 下游域名和地址是否正确。
- 超时时间是否合理。
- 下游错误码是什么。
- 是否重试放大流量。
- 熔断 / 降级是否生效。

日志必须打：

```text
downstream=payment
path=/pay
requestId=xxx
cost=1200ms
status=504
errorCode=PAY_TIMEOUT
```

### MQ 层

看这些：

- 消息是否发出。
- exchange / topic / queue 是否正确。
- 消费者是否在线。
- 是否积压。
- 是否重复消费。
- 死信队列有没有消息。

处理原则：

- 消费端要幂等。
- 失败要能重试。
- 重试多次失败进死信。
- 业务日志里记录 messageId。

### JVM 层

看这些：

- CPU 是否高。
- 内存是否接近上限。
- GC 是否频繁。
- 线程数是否暴涨。
- 线程池队列是否堆积。

常用命令：

```bash
jps -l
jstat -gcutil <pid> 1000 10
jstack <pid> > jstack.log
jmap -histo:live <pid> | head
```

容器里要确认能不能拿到对应工具。没有工具时，至少看应用指标和容器指标。

## 慢接口怎么查

先拆时间：

```text
总耗时 = 网关耗时 + 应用处理 + DB + Redis + 下游 HTTP + 序列化返回
```

排查顺序：

1. 找慢请求的 `traceId`。
2. 看入口日志的总耗时。
3. 看每段 DB / Redis / HTTP 调用耗时。
4. 如果 DB 慢，拿 SQL 跑 `explain`。
5. 如果下游慢，看超时、重试、熔断。
6. 如果应用层慢，看循环、锁、线程池、对象转换。

建议埋点：

```java
StopWatch watch = new StopWatch("pageOrders");
watch.start("query-db");
Page<OrderEntity> page = orderMapper.selectPage(...);
watch.stop();

watch.start("convert-vo");
List<OrderVO> records = converter.toVO(page.getRecords());
watch.stop();

log.info("page orders cost, {}", watch.prettyPrint());
```

不要每个接口都手写一堆计时，核心链路、慢链路先加。

## 500 怎么查

先看异常栈：

```text
Caused by: java.lang.NullPointerException
    at com.example.order.OrderServiceImpl.createOrder(OrderServiceImpl.java:58)
```

优先看：

- 第一处业务代码行号。
- 入参是否为空。
- 查库结果是否为空。
- 枚举转换是否失败。
- 集合是否为空。
- 外部返回是否符合预期。

不要只看最外层：

```text
Servlet.service() for servlet [dispatcherServlet] threw exception
```

真正根因通常在 `Caused by` 后面。

## 超时怎么查

先区分是谁超时：

```text
网关超时
Tomcat 处理超时
Feign 调用超时
数据库查询超时
Redis 命令超时
MQ 消费超时
```

再看方向：

- 调用方超时，但被调方成功：超时设置太短或网络抖动。
- 调用方超时，被调方也慢：下游处理慢。
- 大量请求同时超时：依赖整体不可用或线程池耗尽。
- 只有部分请求超时：数据量、锁、分片、热点 key。

不要盲目把超时时间调大。调大可能只是让线程占用更久。

## 数据库慢怎么查

`explain` 重点看：

```text
type: 是否 ALL
key: 是否使用预期索引
rows: 扫描行数
Extra: 是否 Using filesort / Using temporary
```

常见修法：

- 给高频过滤字段建联合索引。
- 联合索引顺序按筛选和排序设计。
- 避免函数包裹索引字段。
- 大分页改成游标分页。
- 列表页不要查大字段。
- 读写链路拆开，报表走异步或宽表。

大分页例子：

```sql
select *
from t_order
where id > 100000
order by id
limit 20;
```

比：

```sql
select *
from t_order
order by id
limit 100000, 20;
```

更稳定。

## 线程池打满怎么查

现象：

- 接口越来越慢。
- 队列堆积。
- 日志出现 `RejectedExecutionException`。
- CPU 不一定高，但请求都卡住。

要看：

- 核心线程数。
- 最大线程数。
- 队列长度。
- 拒绝策略。
- 任务平均耗时。
- 是否在任务里阻塞等待另一个任务。

线程池日志建议：

```java
log.warn("executor busy, active={}, poolSize={}, queueSize={}",
    executor.getActiveCount(),
    executor.getPoolSize(),
    executor.getQueue().size());
```

修法：

- 慢任务拆出去。
- 队列不要无界。
- 下游超时要明确。
- 拒绝策略要能降级。
- 不同业务不要共用一个大线程池。

## 止血和根修分开

止血手段：

- 回滚。
- 限流。
- 暂停定时任务。
- 临时关闭入口。
- 扩容。
- 手工修数据。
- 降级下游依赖。

根修手段：

- 补唯一索引。
- 补幂等。
- 补参数校验。
- 补超时和熔断。
- 补监控报警。
- 补回归测试。
- 优化 SQL 和索引。

线上先止血没问题，但止血后必须补根修记录，不然下次还会遇到。

## 复盘要写什么

```text
事故标题：
影响时间：
影响范围：
发现方式：
根因：
止血动作：
长期修复：
缺失监控：
缺失测试：
负责人：
截止时间：
```

好的复盘不是甩锅，是让同类问题下次更早暴露、更小影响、更快恢复。

## 检查清单

- [ ] 有准确时间线。
- [ ] 有 traceId 或业务 ID。
- [ ] 看过完整异常栈。
- [ ] 区分了请求层、应用层、DB、缓存、外部依赖、JVM。
- [ ] 慢接口拆过每段耗时。
- [ ] 数据库问题跑过 `explain`。
- [ ] 超时问题确认了是哪一层超时。
- [ ] 已先止血，再根修。
- [ ] 修复后补了测试或监控。
- [ ] 复盘记录能让别人复现排查过程。

## 最后记一句话

排查的核心不是“猜对原因”，而是用证据一步步缩小范围。
