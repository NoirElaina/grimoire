---
title: Redisson 使用笔记
sidebarTitle: Redisson
---

# Redisson 使用笔记

> Redisson 不是“高级 RedisTemplate”，它更像 Redis 上的一组分布式对象和同步器。后端项目里最常用的是 `RLock`。

## 为什么用 Redisson

自己用 Redis 写锁，需要处理：

- `SET NX PX`。
- 唯一 value。
- Lua 校验释放。
- 租约时间。
- 超时等待。
- 自动续期。
- 当前线程是否持有锁。

Redisson 把这些封装成 Java API。

常见能力：

| 能力 | 类型 |
| --- | --- |
| 分布式锁 | `RLock` |
| 公平锁 | `getFairLock` |
| 读写锁 | `RReadWriteLock` |
| 信号量 | `RSemaphore` |
| 限流器 | `RRateLimiter` |
| 延迟队列 | `RDelayedQueue` |

项目里不要一下子全用，先把 `RLock` 用清楚。

## Spring Boot 配置

依赖：

```xml
<dependency>
    <groupId>org.redisson</groupId>
    <artifactId>redisson-spring-boot-starter</artifactId>
</dependency>
```

如果不用 starter，可以手动配置：

```java
@Configuration
public class RedissonConfig {

    @Bean(destroyMethod = "shutdown")
    public RedissonClient redissonClient(@Value("${spring.data.redis.host}") String host,
                                         @Value("${spring.data.redis.port}") int port) {
        Config config = new Config();
        config.useSingleServer()
            .setAddress("redis://" + host + ":" + port);
        return Redisson.create(config);
    }
}
```

如果 Redis 有密码：

```java
config.useSingleServer()
    .setAddress("redis://" + host + ":" + port)
    .setPassword(password);
```

集群模式要用 `useClusterServers()`，不要把单机配置复制到集群项目里。

## RLock 基本用法

```java
public void rebuildProductCache(Long productId) {
    RLock lock = redissonClient.getLock("lock:product-cache:" + productId);

    boolean locked = false;
    try {
        locked = lock.tryLock(2, 10, TimeUnit.SECONDS);
        if (!locked) {
            return;
        }
        loadFromDbAndRefreshCache(productId);
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        throw new BizException(ErrorCode.SYSTEM_BUSY);
    } finally {
        if (locked && lock.isHeldByCurrentThread()) {
            lock.unlock();
        }
    }
}
```

参数含义：

```java
lock.tryLock(waitTime, leaseTime, unit)
```

| 参数 | 含义 |
| --- | --- |
| `waitTime` | 最多等多久去拿锁 |
| `leaseTime` | 拿到锁后多久自动释放 |
| `unit` | 时间单位 |

例如 `tryLock(2, 10, TimeUnit.SECONDS)`：

- 最多等 2 秒。
- 拿到锁后 10 秒自动释放。
- 10 秒内业务必须完成，否则锁会释放。

## 看门狗 watchdog

Redisson 有锁看门狗机制。

理解方式：

- 如果没有指定固定 `leaseTime`，Redisson 会在客户端存活时为锁续期。
- 默认锁看门狗超时时间通常是 30 秒，可配置。
- 如果指定了 `leaseTime`，锁按固定租约释放，不依赖看门狗续期。

不要机械觉得“有看门狗就安全”：

- 业务线程卡死时，锁可能被续很久。
- 客户端进程崩溃后，续期停止，锁最终释放。
- 长任务仍然应该拆小或设计补偿。

项目里推荐：

- 短任务：指定明确 `leaseTime`。
- 执行时间不稳定但必须互斥：评估看门狗，并限制锁内逻辑。
- 核心一致性：Redisson 锁之外还要数据库约束兜底。

## 加锁失败怎么处理

不要拿不到锁还继续执行业务。

常见策略：

| 场景 | 加锁失败处理 |
| --- | --- |
| 缓存重建 | 返回旧值或稍后重试 |
| 重复提交 | 返回“处理中”或幂等结果 |
| 任务抢占 | 当前实例跳过 |
| 抢券 | 返回活动繁忙或已被处理 |

示例：

```java
if (!locked) {
    throw new BizException(ErrorCode.REQUEST_PROCESSING);
}
```

错误做法：

```java
if (!locked) {
    createOrder(command);
}
```

这等于锁失败后仍然进入临界区。

## 锁粒度

锁 key 要贴业务资源：

```text
lock:product-cache:20001
lock:order:create:user:10001
lock:coupon:receive:30001:10001
lock:job:daily-stat:20260607
```

锁粒度太粗：

```text
lock:order
```

所有订单创建都会排队，吞吐量会很差。

锁粒度太细：

```text
lock:order:create:user:10001:request:uuid
```

每次请求一把锁，根本锁不住同一资源。

## 公平锁

公平锁按请求顺序排队：

```java
RLock lock = redissonClient.getFairLock("lock:coupon:fair:" + couponId);
```

适合：

- 对顺序敏感。
- 等待队列不能插队。

不适合：

- 高吞吐秒杀。
- 对延迟敏感的接口。

公平锁通常开销更高，不要默认使用。

## 读写锁

读多写少可以使用读写锁：

```java
RReadWriteLock readWriteLock = redissonClient.getReadWriteLock("lock:config:shop");
RLock readLock = readWriteLock.readLock();
RLock writeLock = readWriteLock.writeLock();
```

适合：

- 配置读取很多，更新很少。
- 更新期间不允许读到中间状态。

不适合：

- 普通缓存读取。
- 数据库已经能保证一致的简单场景。

## Redisson 和 RedisTemplate 的关系

| 工具 | 主要用途 |
| --- | --- |
| `StringRedisTemplate` | 字符串、计数、TTL、简单命令 |
| `RedisTemplate` | 对象缓存、Hash、JSON 序列化 |
| `RedissonClient` | 分布式锁、同步器、分布式对象 |

不要用 Redisson 替代所有 Redis 操作。

推荐分工：

- 缓存读写：`StringRedisTemplate` 或封装后的 `RedisTemplate`。
- 分布式锁：`RedissonClient`。
- 限流器等高级同步器：确认需求后再用 Redisson。

## 常见坑

| 坑 | 后果 |
| --- | --- |
| `unlock()` 前不判断当前线程 | 可能抛异常 |
| 锁 key 粒度过粗 | 系统吞吐下降 |
| 指定 `leaseTime` 太短 | 业务没完锁释放 |
| 锁内调用慢接口 | 锁持有时间不可控 |
| 忽略加锁失败 | 业务仍然并发执行 |
| 用锁替代唯一索引 | 锁失效后数据重复 |
| 不处理 `InterruptedException` | 线程中断语义丢失 |

## 去空话检查

- [ ] `tryLock` 参数能说清等待时间和租约时间。
- [ ] `finally` 里释放锁，并检查 `isHeldByCurrentThread()`。
- [ ] 加锁失败不会继续执行业务。
- [ ] 锁 key 粒度贴近资源。
- [ ] 知道指定 `leaseTime` 和看门狗续期的区别。
- [ ] 核心数据仍有数据库唯一索引或条件更新兜底。

## 参考

- [Redisson locks and synchronizers](https://redisson.pro/docs/data-and-services/locks-and-synchronizers/index.html)
