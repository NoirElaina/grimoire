---
title: Redis 分布式锁故障场景
sidebarTitle: 分布式锁故障
---

# Redis 分布式锁故障场景

Redis 分布式锁最常见写法：

```text
SET lock:key randomValue NX PX 30000
```

释放时用 Lua 判断 value：

```lua
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
```

这能解决：

- 互斥。
- 锁自动过期。
- 防止误删别人的锁。

但它不能解决所有故障。

## 主节点宕机的问题

如果 Redis 是主从复制：

```text
client A -> master 获取锁成功
master 还没把锁复制给 replica
master 宕机
replica 被提升为新 master
client B -> 新 master 获取同一把锁成功
```

结果：

```text
A 认为自己持有锁。
B 也认为自己持有锁。
```

互斥性被破坏。

原因是：

```text
Redis 主从复制是异步的。
锁写入 master 成功，不代表已经复制到 replica。
```

所以单 Redis 实例或普通主从 Redis 锁，只能提供有限保证。

## 这个问题有什么后果

如果锁保护的是非核心操作：

```text
防止重复刷新缓存
防止重复发送普通任务
防止重复跑定时任务
```

影响可能可接受。

如果锁保护的是核心一致性：

```text
扣库存
扣余额
发放优惠券
支付回调处理
创建唯一订单
```

就不能只依赖 Redis 锁。

因为主节点故障可能导致两个客户端同时进入临界区。

## Redis Cluster 下是不是就安全

不是自动安全。

Redis Cluster 可以做分片和故障转移，但它不把单 key 锁变成强一致锁。

主节点故障时，仍要考虑：

- 锁是否已复制到从节点。
- failover 期间客户端是否重试。
- 客户端是否连到新主。
- 业务是否能承受短时间双持锁。

如果只是：

```text
SET NX PX
```

那它仍然是“在某个 master 上写入成功”。

不是多数派强一致提交。

## Redlock 思路

Redis 官方文档提出 Redlock 作为更强的分布式锁思路。

基本思想：

```text
准备 N 个相互独立的 Redis master。
客户端尝试在多个 master 上用相同 key 和随机值加锁。
只有在多数节点加锁成功，并且总耗时小于锁有效期，才认为获取锁成功。
```

例如 N=5：

```text
至少 3 个节点成功，才算拿到锁。
```

释放锁时：

```text
向所有节点发送 Lua 删除。
```

Redlock 比单实例主从更能抵抗单点 master 宕机。

但它也不是万能的。

要考虑：

- 时钟漂移。
- 网络分区。
- GC pause。
- 客户端执行时间超过锁租期。
- Redis 节点是否真的独立。
- 业务是否需要线性一致性。

## Redisson 的看门狗能解决什么

Redisson `RLock` 默认有 watchdog。

作用：

```text
业务线程还活着时，自动给锁续期。
```

它解决的是：

```text
业务执行时间超过锁 TTL，锁提前过期。
```

它不能解决：

```text
主节点宕机导致锁未复制。
```

不要把 watchdog 理解成锁强一致保证。

## 更稳的解决方案

### 1. 数据库唯一约束兜底

如果业务目标是“只创建一次”，优先用唯一索引。

```sql
ALTER TABLE order_request
ADD UNIQUE KEY uk_request_id (request_id);
```

Redis 锁可以减少并发冲突，但最终唯一性由数据库保证。

### 2. 幂等表

```sql
CREATE TABLE idempotency_record (
  id BIGINT PRIMARY KEY,
  biz_key VARCHAR(128) NOT NULL,
  biz_type VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  result_json JSON,
  create_time DATETIME NOT NULL,
  update_time DATETIME NOT NULL,
  UNIQUE KEY uk_biz (biz_type, biz_key)
);
```

重复请求先查幂等记录。

即使锁失效，也不会重复写核心结果。

### 3. 条件更新

库存扣减：

```sql
UPDATE product_stock
SET stock = stock - #{count}
WHERE product_id = #{productId}
  AND stock >= #{count};
```

余额扣减：

```sql
UPDATE account
SET balance = balance - #{amount}
WHERE id = #{accountId}
  AND balance >= #{amount};
```

不要只靠 Redis 锁保护扣减。

数据库条件更新必须兜底。

### 4. 乐观锁版本号

```sql
UPDATE product
SET stock = stock - 1,
    version = version + 1
WHERE id = #{id}
  AND version = #{version}
  AND stock > 0;
```

适合冲突不太高的场景。

### 5. 使用强一致协调系统

如果业务真的需要强一致分布式锁，考虑：

- ZooKeeper。
- etcd。
- Consul。

这些系统更适合做一致性协调。

代价是：

- 运维复杂。
- 延迟更高。
- 需要理解 lease/session。

### 6. Fencing Token

Fencing token 是防止“过期锁持有者继续写”的关键设计。

每次拿锁时获取一个递增 token：

```text
client A token = 10
client B token = 11
```

下游资源只接受更大的 token：

```sql
UPDATE resource
SET value = #{value},
    fencing_token = #{token}
WHERE id = #{id}
  AND fencing_token < #{token};
```

即使 A 因为 GC pause 恢复后继续写，它的 token=10，也会被拒绝。

这比单纯锁更安全。

## 什么时候 Redis 锁可以用

适合：

- 防缓存击穿。
- 防重复执行低风险任务。
- 控制定时任务并发。
- 保护非核心临界区。
- 失败后可以重试或对账的流程。

不适合单独承担：

- 扣钱。
- 扣库存。
- 唯一订单创建。
- 支付回调幂等。
- 不可补偿的外部动作。

核心业务要记住：

```text
Redis 锁是优化并发入口。
数据库约束和幂等才是最终兜底。
```

## 工程设计模板

```text
请求进入
  -> 校验幂等 key
  -> 尝试 Redis 锁减少并发
  -> 本地事务
      -> 唯一约束 / 幂等表
      -> 条件更新
      -> 业务写入
  -> 释放 Redis 锁
  -> 异步对账 / 补偿
```

即使 Redis 锁失效：

```text
唯一索引挡重复。
条件更新挡超扣。
幂等表挡重复处理。
对账补偿修复异常状态。
```

## 故障检查清单

- [ ] 锁 value 是否使用随机唯一值。
- [ ] 释放锁是否用 Lua 判断 value。
- [ ] 锁是否设置 TTL。
- [ ] 业务执行时间是否可能超过 TTL。
- [ ] 是否理解 watchdog 只能续期，不能解决主从复制丢锁。
- [ ] Redis 主节点故障时业务是否允许双持锁。
- [ ] 核心业务是否有数据库唯一约束兜底。
- [ ] 扣减是否使用条件更新。
- [ ] 是否有幂等记录。
- [ ] 是否需要 fencing token。
- [ ] 是否需要 ZooKeeper / etcd 这类强一致协调系统。

## 参考

- [Redis Distributed Locks](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/)
- [Redis SET](https://redis.io/docs/latest/commands/set/)
- [Redis 分布式锁](/notes/redis/distributed-lock)
- [Redisson 使用笔记](/notes/redis/redisson)
