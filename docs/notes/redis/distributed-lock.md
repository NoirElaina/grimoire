---
title: Redis 分布式锁
sidebarTitle: 05 分布式锁
---

# Redis 分布式锁

> Redis 锁解决的是“多个进程短时间抢同一个资源”的问题。它不是事务，也不是幂等，也不能替代数据库约束。

## 什么时候需要分布式锁

单机锁只能锁住当前 JVM：

```java
synchronized (this) {
    doSomething();
}
```

如果服务部署了多个实例，请求可能打到不同机器，单机锁就不够了。

适合 Redis 锁的场景：

- 防止同一订单重复提交。
- 防止同一用户重复抢券。
- 定时任务多实例抢占。
- 热点缓存重建互斥。
- 同一资源短时间串行处理。

不适合：

- 长事务。
- 金额扣减最终一致。
- 需要强一致串行化的核心数据。
- 锁内调用大量外部接口。
- 任务时长不可控。

## 最小正确命令

加锁要同时满足三个条件：

- key 不存在才设置。
- 设置唯一 value。
- 设置过期时间。

命令：

```text
SET lock:order:10001 8c9f2c3e NX PX 10000
```

含义：

| 部分 | 含义 |
| --- | --- |
| `lock:order:10001` | 锁 key |
| `8c9f2c3e` | 当前线程生成的唯一值 |
| `NX` | key 不存在才写入 |
| `PX 10000` | 10 秒后自动过期 |

不要这样写：

```text
SETNX lock:order:10001 1
EXPIRE lock:order:10001 10
```

因为这是两步，`SETNX` 成功后应用崩了，`EXPIRE` 没执行，锁可能永远不释放。

## 安全释放锁

释放锁不能直接 `DEL`。

错误：

```text
DEL lock:order:10001
```

问题场景：

```text
1. A 拿到锁，租约 10 秒
2. A 执行超过 10 秒，锁过期
3. B 拿到同一把锁
4. A 执行完直接 DEL
5. B 的锁被 A 删除
```

正确做法：释放前校验 value 是不是自己的。

Lua：

```lua
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
else
    return 0
end
```

Lua 保证“比较 value + 删除 key”在 Redis 里原子执行。

## Java 简化实现

```java
public boolean tryLock(String key, String value, Duration ttl) {
    Boolean locked = stringRedisTemplate.opsForValue().setIfAbsent(key, value, ttl);
    return Boolean.TRUE.equals(locked);
}
```

释放：

```java
private static final DefaultRedisScript<Long> UNLOCK_SCRIPT = new DefaultRedisScript<>(
    """
    if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
    else
        return 0
    end
    """,
    Long.class
);

public boolean unlock(String key, String value) {
    Long result = stringRedisTemplate.execute(UNLOCK_SCRIPT, List.of(key), value);
    return Long.valueOf(1).equals(result);
}
```

使用：

```java
public void rebuildProductCache(Long productId) {
    String lockKey = "lock:product-cache:" + productId;
    String lockValue = UUID.randomUUID().toString();

    if (!tryLock(lockKey, lockValue, Duration.ofSeconds(5))) {
        return;
    }

    try {
        loadFromDbAndRefreshCache(productId);
    } finally {
        unlock(lockKey, lockValue);
    }
}
```

## 租约时间怎么定

租约太短：

- 业务没执行完，锁先过期。
- 其他线程进入临界区。
- 出现并发执行。

租约太长：

- 持锁线程崩溃后，其他请求等待太久。
- 用户体验差。

实践：

- 根据 P99 执行时间设置。
- 锁内逻辑尽量短。
- 不要在锁内做慢 IO。
- 需要自动续期时用 Redisson。

## 锁和幂等不是一回事

分布式锁控制的是并发进入。

幂等控制的是重复执行结果。

比如订单创建：

```text
用户连续点两次提交
锁可以挡住同时进入
但第一次执行完后第二次再来，锁已经释放
这时仍然需要幂等号或唯一索引
```

更稳的做法：

- 前端提交带请求号。
- 后端用幂等表或 Redis 幂等 key。
- 数据库有唯一约束。
- 锁只减少并发冲突，不做最终兜底。

## 锁和数据库事务的关系

不要把 Redis 锁当数据库事务。

如果是库存扣减，最终兜底应该在 MySQL：

```sql
update sku_stock
set available_stock = available_stock - 1
where sku_id = 10001
  and available_stock >= 1;
```

受影响行数为 1 才算成功。

Redis 锁可以减少并发，但数据库条件更新才是最终保护。

## 常见坑

| 坑 | 后果 |
| --- | --- |
| 没有过期时间 | 死锁 |
| value 不是唯一值 | 可能误删别人的锁 |
| 直接 `DEL` | 可能释放别人的锁 |
| 租约太短 | 业务没完锁先没了 |
| 锁粒度太粗 | 吞吐量很差 |
| 锁内逻辑太多 | 超时和阻塞风险高 |
| 加锁失败还继续执行 | 锁形同虚设 |
| 不配数据库约束 | 锁失效后业务裸奔 |

## 锁 key 粒度

粒度要尽量贴近资源：

```text
lock:order:create:user:10001
lock:coupon:receive:coupon:30001:user:10001
lock:product-cache:20001
lock:job:daily-stat:20260607
```

不要一上来写：

```text
lock:global
```

全局锁会把系统并发能力直接打没。

## 去空话检查

- [ ] 加锁使用 `SET key value NX PX ttl`。
- [ ] value 是唯一值。
- [ ] 释放锁用 Lua 校验 value。
- [ ] 锁内逻辑短，租约能覆盖 P99。
- [ ] 加锁失败有明确业务返回。
- [ ] 核心数据还有数据库约束兜底。
- [ ] 能区分分布式锁和幂等。

## 参考

- [Redis SET](https://redis.io/docs/latest/commands/set/)
- [Redis distributed locks](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/)
