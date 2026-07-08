---
title: Redis 入门与基础模型
sidebarTitle: 基础模型
---

# Redis 入门与基础模型

> 学 Redis 先别急着背命令。先知道它在项目里负责什么、为什么快、哪些操作会把它拖慢。

## Redis 在后端里是什么角色

Redis 常见定位：

| 角色 | 例子 | 关键点 |
| --- | --- | --- |
| 缓存 | 商品详情、用户资料、配置 | MySQL 是事实来源，Redis 是加速层 |
| 短状态 | 验证码、登录态、幂等 token | 必须有 TTL |
| 原子计数 | 阅读量、接口限流、失败次数 | 用原生命令或 Lua 保证原子性 |
| 排行榜 | 热门商品、积分榜 | `ZSet` 按 score 排序 |
| 轻量协调 | 分布式锁、任务抢占 | 只能做短时间互斥 |

总的来说，Redis 适合处理 **高频读、短状态、原子小操作**，不适合承接所有业务事实。

## 为什么 Redis 快

工程上可以按这几个点理解：

- 数据主要在内存里，少了磁盘随机 IO。
- 命令执行模型简单，核心命令可以按单线程事件循环理解。
- 数据结构是 Redis 自己优化过的，不是普通 Java 集合。
- 网络协议简单，请求响应开销低。
- 大多数命令是 O(1) 或 O(logN)。

不要把“单线程”理解成“永远不会阻塞”。只要一个命令执行很久，后面的请求就会排队。

容易拖慢 Redis 的操作：

| 操作 | 风险 |
| --- | --- |
| `KEYS *` | 扫全库，线上禁用 |
| 超大 `HGETALL` | 一次返回太多字段 |
| 超大集合 `SMEMBERS` | 网络和 CPU 都会被打满 |
| 大 value 读写 | 序列化、传输、主从同步都慢 |
| 大 key 删除 | 可能阻塞主线程 |
| Lua 脚本循环太久 | Redis 期间无法处理其他命令 |

线上排查 key 用 `SCAN`，不是 `KEYS`：

```text
SCAN 0 MATCH mall:user:* COUNT 100
```

`SCAN` 也不是免费，只是分批迭代，比一次扫全库安全。

## keyspace 和 DB

Redis 保存的是 key-value。

```text
SET mall:user:profile:10001 "{\"id\":10001,\"nickname\":\"alice\"}"
GET mall:user:profile:10001
```

默认有多个逻辑 DB，常见是 `0` 到 `15`。生产项目不建议靠 DB 编号区分业务，因为：

- Cluster 模式下通常只使用 DB 0。
- DB 编号可读性差。
- 多服务共享时容易误删。

更推荐用 key 前缀隔离：

```text
mall:prod:user:profile:10001
mall:test:user:profile:10001
```

## key 命名

推荐格式：

```text
系统:模块:对象:标识
```

示例：

```text
mall:user:profile:10001
mall:product:detail:20001
mall:order:detail:202606010001
mall:auth:captcha:13800138000
mall:limit:login:13800138000
```

Java 里要收口，不要散落硬编码：

```java
public final class RedisKeys {

    private static final String APP = "mall";

    private RedisKeys() {
    }

    public static String userProfile(Long userId) {
        return APP + ":user:profile:" + userId;
    }

    public static String loginLimit(String mobile) {
        return APP + ":limit:login:" + mobile;
    }
}
```

key 设计检查：

- 能不能一眼看出业务用途。
- 有没有环境、租户、系统隔离。
- 标识是否稳定，不要把超长文本原样拼进去。
- 集合类 key 是否有容量上限。
- 是否需要 TTL。

## TTL 是业务设计，不是随手写时间

设置过期：

```text
SET mall:auth:captcha:13800138000 123456 EX 300
EXPIRE mall:user:profile:10001 600
TTL mall:user:profile:10001
```

常见 TTL：

| 数据 | TTL |
| --- | --- |
| 验证码 | 3 到 5 分钟 |
| 登录失败计数 | 5 到 30 分钟 |
| 用户资料缓存 | 5 到 30 分钟 |
| 商品详情缓存 | 5 到 60 分钟 |
| 空值缓存 | 30 秒到 5 分钟 |
| 分布式锁 | 按业务耗时设置，必须有过期 |

热点缓存建议加随机抖动，避免一批 key 同时失效：

```java
Duration ttl = Duration.ofMinutes(10)
    .plusSeconds(ThreadLocalRandom.current().nextInt(30, 180));
stringRedisTemplate.opsForValue().set(key, value, ttl);
```

判断一个 key 是否能不过期：

- 临时状态不能不过期。
- 锁不能不过期。
- 幂等 key 不能不过期。
- 缓存可以长期存在，但必须有主动失效或刷新机制。

## Redis 和 MySQL 的关系

Redis 不是 MySQL 的平替。

| 对比 | Redis | MySQL |
| --- | --- | --- |
| 主要目标 | 快速读写、短状态 | 持久事实、事务、查询 |
| 存储 | 内存为主 | 磁盘为主 |
| 查询能力 | 按 key 或结构操作 | SQL、索引、事务 |
| 一致性 | 应用自己设计 | 事务和约束更强 |
| 典型失败 | 缓存失效、淘汰、主从延迟 | 锁等待、慢查询、死锁 |

后端项目里常见规则：

```text
读：先查 Redis，未命中查 MySQL，再回填 Redis
写：先写 MySQL，事务提交后删除 Redis
```

不要把 Redis 里的值当最终真相，除非这个业务本身就是短状态，比如验证码、限流计数。

## 持久化只负责恢复，不等于强一致

Redis 有两类常见持久化：

| 方式 | 含义 | 适合理解 |
| --- | --- | --- |
| RDB | 周期性生成快照 | 恢复快，但可能丢最近一段数据 |
| AOF | 记录写命令日志 | 数据更完整，但文件更大 |

实际项目里要记住：

- 开了持久化也可能丢最后一小段数据。
- 缓存数据丢了可以回源 MySQL。
- 短状态丢了要能接受或补偿。
- 核心交易事实不要只放 Redis。

## 内存淘汰

Redis 内存满了以后怎么处理，取决于 `maxmemory-policy`。

常见策略可以这样理解：

| 策略 | 行为 |
| --- | --- |
| `noeviction` | 不淘汰，写入报错 |
| `allkeys-lru` | 所有 key 里按 LRU 倾向淘汰 |
| `volatile-lru` | 只淘汰设置了过期时间的 key |
| `allkeys-random` | 所有 key 随机淘汰 |
| `volatile-ttl` | 优先淘汰快过期的 key |

缓存项目常见选择是 `allkeys-lru` 或类似策略，但前提是业务能接受缓存被淘汰。

如果某个 key 不能丢，不要让它和普通缓存挤在同一个 Redis 里。

## Spring Boot 连接池

常见配置：

```yaml
spring:
  data:
    redis:
      host: localhost
      port: 6379
      timeout: 2s
      lettuce:
        pool:
          max-active: 16
          max-idle: 8
          min-idle: 2
          max-wait: 2s
```

配置思路：

- `timeout` 不要无限等待。
- 连接池不是越大越好，要看 Redis、应用实例数和 QPS。
- Redis 异常时要有降级，不要让线程全部卡住。
- 慢命令要治理，不要只加连接池。

## 什么时候不要用 Redis

这些场景不要硬上 Redis：

- 需要复杂条件查询。
- 需要强事务约束。
- value 很大，甚至接近文件存储。
- 集合会无限增长且不分页。
- Redis 挂了业务完全不能动。
- 没有监控、没有过期策略、没有清理策略。

## 去空话检查

- [ ] 能说清 Redis 是缓存层、短状态层还是协调层。
- [ ] 每个 key 都有命名规则和 TTL 策略。
- [ ] 不用 `KEYS *` 排查线上问题。
- [ ] 不把 Redis 持久化当成数据库事务。
- [ ] 不把核心事实只放 Redis。
- [ ] Redis 异常时知道接口怎么降级。

## 参考

- [Redis data types](https://redis.io/docs/latest/develop/data-types/)
- [Redis EXPIRE](https://redis.io/docs/latest/commands/expire/)
- [Redis SET](https://redis.io/docs/latest/commands/set/)
