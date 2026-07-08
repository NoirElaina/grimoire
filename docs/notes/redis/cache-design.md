---
title: Redis 基础使用与缓存设计
sidebarTitle: 缓存设计总览
---

# Redis 基础使用与缓存设计

> Redis 笔记不要写成命令大全，重点是：什么时候用、key 怎么设计、TTL 怎么定、一致性怎么兜。

## 适合和不适合

| 场景 | 建议 |
| --- | --- |
| 高频读、低频写 | 适合缓存 |
| 数据允许短暂不一致 | 适合缓存 |
| 只需要短时间状态 | 适合 Redis |
| 需要排序 TopN | 适合 `ZSet` |
| 强一致余额、库存最终扣减 | 不要只靠 Redis |
| 可靠消息、死信、重试、堆积治理 | 优先 MQ |
| 大对象、长文本、文件内容 | 不适合 Redis |
| 全量数据镜像 | 不适合 Redis |

总的来说，Redis 扛热点和短状态，MySQL 扛最终事实。

## 数据结构怎么选

| 数据结构 | 典型用途 | 备注 |
| --- | --- | --- |
| `String` | 缓存 JSON、计数器、验证码、锁值 | 最常用，注意 value 不要太大 |
| `Hash` | 用户对象字段、配置项、购物车 | 适合对象局部字段读写 |
| `List` | 简单队列、最近记录 | 可靠消费不如 MQ |
| `Set` | 去重、标签、关注集合 | 适合无序集合 |
| `ZSet` | 排行榜、延迟任务、时间线 | score 设计要稳定 |
| `Bitmap` | 签到、活跃标记 | 适合布尔状态 |
| `HyperLogLog` | UV 粗略统计 | 有误差，不能当精准计数 |
| `Stream` | 轻量消息流 | 有消费组，但复杂业务仍优先 MQ |

选型原则：

- 能用简单结构就不用复杂结构。
- value 越大，序列化、网络传输、阻塞风险越高。
- 需要原子操作时，优先用 Redis 原生命令或 Lua。
- 需要可靠流程时，不要把 Redis 硬当 MQ。

## key 命名

推荐格式：

```text
业务系统:模块:对象:标识
```

示例：

```text
mall:user:profile:10001
mall:order:detail:202406010001
mall:auth:refresh-token:device-001
mall:rate-limit:login:13800138000
mall:rank:product-hot:20240601
```

多租户：

```text
mall:{tenant_001}:user:profile:10001
```

Redis Cluster 里 `{}` 是 hash tag，同一 tag 的 key 会落到同一 slot。只有确实需要多 key 原子操作时再这么设计。

Java 里不要到处手写字符串：

```java
public final class RedisKeys {

    private static final String APP = "mall";

    private RedisKeys() {
    }

    public static String userProfile(Long userId) {
        return APP + ":user:profile:" + userId;
    }

    public static String loginLimit(String mobile) {
        return APP + ":rate-limit:login:" + mobile;
    }
}
```

key 设计检查：

- 是否包含业务前缀。
- 是否包含租户 / 环境隔离。
- 是否有明确对象和 ID。
- 是否能从 key 看出用途。
- 是否避免把用户输入原样拼成长 key。

## TTL 设计

不要随手写一个过期时间。TTL 要按业务定：

| 数据 | TTL 建议 |
| --- | --- |
| 验证码 | 3～5 分钟 |
| 登录失败计数 | 5～30 分钟 |
| 用户基础信息缓存 | 5～30 分钟 |
| 商品详情缓存 | 5～60 分钟 |
| 空值缓存 | 30 秒～5 分钟 |
| 排行榜日榜 | 到当天结束后再多留一段 |
| 分布式锁 | 按业务耗时设置，必须有过期 |

给缓存 TTL 加随机抖动，避免同一时间大量过期：

```java
Duration ttl = Duration.ofMinutes(10)
    .plusSeconds(ThreadLocalRandom.current().nextInt(30, 180));
redisTemplate.opsForValue().set(key, value, ttl);
```

判断 key 是否应该永不过期：

- 基础配置可以长期缓存，但要有主动刷新机制。
- 热点业务数据不建议永久缓存。
- 临时状态必须有 TTL。
- 锁、幂等 key、验证码必须有 TTL。

## Cache Aside 模式

最常用模式：应用自己维护缓存。

读流程：

```text
1. 查 Redis
2. 命中：直接返回
3. 未命中：查 MySQL
4. MySQL 查到：写 Redis，设置 TTL
5. MySQL 未查到：写空值缓存，设置短 TTL
```

写流程：

```text
1. 开事务更新 MySQL
2. 事务提交成功
3. 删除 Redis 缓存
4. 下一次读取回源 MySQL 并回填
```

为什么常见做法是“删缓存”而不是“更新缓存”：

- 更新缓存容易漏字段。
- 多个写请求并发时，旧值可能覆盖新值。
- 删除后重新加载更简单。
- 缓存结构可能不是单表结构。

## 缓存读取代码

示例：

```java
public UserProfileVO getUserProfile(Long userId) {
    String key = RedisKeys.userProfile(userId);

    String cached = stringRedisTemplate.opsForValue().get(key);
    if (StringUtils.hasText(cached)) {
        return json.readValue(cached, UserProfileVO.class);
    }

    UserEntity user = userMapper.selectById(userId);
    if (user == null) {
        stringRedisTemplate.opsForValue().set(key, "{}", Duration.ofMinutes(1));
        throw new BizException(ErrorCode.USER_NOT_FOUND);
    }

    UserProfileVO vo = userConverter.toProfileVO(user);
    stringRedisTemplate.opsForValue().set(
        key,
        json.writeValueAsString(vo),
        randomTtl(Duration.ofMinutes(10))
    );
    return vo;
}
```

注意：

- 空值缓存要用特殊标记，不要和真实空对象混淆。
- 反序列化失败要删缓存，避免一直失败。
- 热点缓存回源要加互斥或预热，避免同时打 DB。

## 写入后删缓存

事务提交后删除缓存更稳：

```java
@Transactional(rollbackFor = Exception.class)
public void updateUserProfile(UpdateUserCommand command) {
    userMapper.updateProfile(command.userId(), command.nickname(), command.avatar());

    TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
        @Override
        public void afterCommit() {
            stringRedisTemplate.delete(RedisKeys.userProfile(command.userId()));
        }
    });
}
```

为什么不要在事务提交前删：

- 事务可能回滚，缓存已经删了。
- 并发读可能在事务提交前回填旧数据。
- 删除动作不是数据库事务的一部分。

一致性要求更高时：

- 写数据库。
- 写 outbox 事件。
- 事务提交后异步删缓存。
- 删除失败重试。
- 必要时用 binlog / CDC 订阅删缓存。

## 穿透、击穿、雪崩

### 缓存穿透

现象：请求不存在的数据，Redis 没有，MySQL 也没有，每次都打 DB。

处理：

- 参数校验，非法 ID 直接拒绝。
- 空值缓存，短 TTL。
- 布隆过滤器挡明显不存在的数据。

空值缓存：

```java
if (user == null) {
    stringRedisTemplate.opsForValue().set(key, "__NULL__", Duration.ofMinutes(1));
    return null;
}
```

### 缓存击穿

现象：热点 key 过期，大量请求同时回源 DB。

处理：

- 热点 key 预热。
- 热点 key 逻辑过期。
- 回源时加互斥锁。
- TTL 加随机抖动。

互斥回源示例：

```java
String lockKey = key + ":lock";
Boolean locked = stringRedisTemplate.opsForValue()
    .setIfAbsent(lockKey, UUID.randomUUID().toString(), Duration.ofSeconds(5));

if (Boolean.TRUE.equals(locked)) {
    try {
        return loadFromDbAndRefreshCache(userId);
    } finally {
        stringRedisTemplate.delete(lockKey);
    }
}

Thread.sleep(50);
return getUserProfile(userId);
```

生产里锁释放要校验唯一值，或者直接用 Redisson。

### 缓存雪崩

现象：大量 key 同时失效，或者 Redis 整体不可用。

处理：

- TTL 随机抖动。
- 热点 key 分批预热。
- 限流和降级。
- 本地缓存兜底。
- Redis 高可用部署和监控。

## Spring Boot 接入

依赖：

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-redis</artifactId>
</dependency>
```

配置：

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
```

常规项目优先用 `StringRedisTemplate`：

```java
@Service
public class CacheService {

    private final StringRedisTemplate stringRedisTemplate;

    public CacheService(StringRedisTemplate stringRedisTemplate) {
        this.stringRedisTemplate = stringRedisTemplate;
    }

    public void put(String key, String value, Duration ttl) {
        stringRedisTemplate.opsForValue().set(key, value, ttl);
    }
}
```

如果用 `RedisTemplate<String, Object>`，序列化器要统一：

```java
@Bean
public RedisTemplate<String, Object> redisTemplate(RedisConnectionFactory connectionFactory,
                                                   ObjectMapper objectMapper) {
    RedisSerializer<String> stringSerializer = new StringRedisSerializer();
    GenericJacksonJsonRedisSerializer jsonSerializer =
        new GenericJacksonJsonRedisSerializer(objectMapper);

    RedisTemplate<String, Object> template = new RedisTemplate<>();
    template.setConnectionFactory(connectionFactory);
    template.setKeySerializer(stringSerializer);
    template.setHashKeySerializer(stringSerializer);
    template.setValueSerializer(jsonSerializer);
    template.setHashValueSerializer(jsonSerializer);
    template.afterPropertiesSet();
    return template;
}
```

不要在同一个项目里一部分用 JDK 序列化，一部分用 JSON，一部分手写字符串。

## `@Cacheable` 能不能用

可以，但适合规则简单的缓存。

```java
@Cacheable(cacheNames = "userProfile", key = "#userId", unless = "#result == null")
public UserProfileVO getUserProfile(Long userId) {
    return userRepository.getProfile(userId);
}
```

更新时删除：

```java
@CacheEvict(cacheNames = "userProfile", key = "#command.userId")
public void updateUserProfile(UpdateUserCommand command) {
    userRepository.updateProfile(command);
}
```

不适合只靠注解的场景：

- 需要空值缓存。
- 需要随机 TTL。
- 需要互斥回源。
- 需要按多个 key 删除。
- 缓存结构和返回结构不一致。

复杂缓存建议自己封装，不要让注解把一致性藏起来。

## 分布式锁

最小命令语义：

```text
SET lock:order:10001 <unique-value> NX PX 10000
```

释放锁必须校验 value：

```lua
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
else
    return 0
end
```

锁适合：

- 防重复提交。
- 单个资源短时间互斥。
- 定时任务抢占。
- 缓存击穿时互斥回源。

锁不适合：

- 长事务。
- 强一致资金操作。
- 不知道任务最长执行多久。
- 锁内调用很多外部系统。

生产建议优先用 Redisson，并配置：

- 等待时间。
- 租约时间。
- 看门狗续期是否符合业务。
- finally 释放锁。
- 加锁失败的业务返回。

## 计数与限流

简单计数：

```java
Long count = stringRedisTemplate.opsForValue().increment(key);
if (count != null && count == 1) {
    stringRedisTemplate.expire(key, Duration.ofMinutes(1));
}
```

问题：`INCR` 成功后，如果设置过期失败，key 可能不过期。

更稳的是 Lua：

```lua
local current = redis.call("incr", KEYS[1])
if current == 1 then
    redis.call("expire", KEYS[1], ARGV[1])
end
return current
```

滑动窗口可以用 `ZSet`：

```text
ZADD login:window:13800138000 <timestamp> <requestId>
ZREMRANGEBYSCORE login:window:13800138000 0 <now - window>
ZCARD login:window:13800138000
EXPIRE login:window:13800138000 <window>
```

限流要明确：

- 按用户、IP、设备还是接口限。
- 窗口大小。
- 超限返回码。
- 是否影响正常用户。

## 排行榜

`ZSet` 示例：

```java
String key = "mall:rank:product-hot:20240601";
stringRedisTemplate.opsForZSet().incrementScore(key, productId.toString(), 1);
stringRedisTemplate.expire(key, Duration.ofDays(3));
```

查 TopN：

```java
Set<String> productIds = stringRedisTemplate.opsForZSet()
    .reverseRange(key, 0, 99);
```

注意：

- 日榜、周榜、总榜要分 key。
- score 含义要稳定。
- 榜单详情通常还要批量查数据库或缓存。
- 榜单 key 要有过期和归档策略。

## 库存不要只靠 Redis

常见误区：

```text
Redis 很快 -> 直接 INCR/DECR 扣库存 -> 订单成功
```

问题：

- Redis 扣了，MySQL 写失败怎么办。
- MySQL 扣了，Redis 删除失败怎么办。
- 订单取消要怎么回补。
- Redis 重启丢数据怎么办。
- 超卖和少卖怎么对账。

更稳的模式：

```text
1. Redis 做活动库存预热和快速拦截
2. 请求进入后写订单 / 冻结库存消息
3. MySQL 做最终扣减，带条件更新
4. MQ 异步削峰
5. 定时对账 Redis、订单、库存流水
```

MySQL 条件扣减示例：

```sql
update sku_stock
set available_stock = available_stock - 1
where sku_id = 10001
  and available_stock >= 1;
```

受影响行数为 1 才算扣减成功。

## 大 key 和热点 key

大 key 风险：

- 网络传输慢。
- 删除阻塞。
- 序列化慢。
- 主从同步压力大。
- 迁移和扩容风险高。

常见大 key：

- 一个 Hash 放几十万字段。
- 一个 String 放几 MB JSON。
- 一个 List / Set / ZSet 无限增长。

处理：

- 拆 key。
- 分页读。
- 控制集合长度。
- 删除用异步删除能力。
- 定期扫描和报警。

热点 key 风险：

- 单 key 被大量请求打爆。
- Redis Cluster 下单 slot 压力大。
- 本地缓存可能更合适。

处理：

- 本地缓存。
- key 分片。
- 热点预热。
- 限流。
- 逻辑过期异步刷新。

## 监控指标

至少看这些：

- 命中率。
- QPS。
- 平均耗时和 P99。
- 慢命令。
- 内存使用率。
- 连接数。
- key 数量。
- 过期 key 数。
- 大 key。
- 热点 key。
- 阻塞命令：`keys`、大范围 `hgetall`、大集合操作。

线上不要使用：

```text
KEYS *
```

排查用：

```text
SCAN 0 MATCH mall:user:* COUNT 100
```

`SCAN` 也不是完全免费，只是比 `KEYS` 安全很多。

## 落地检查清单

- [ ] key 命名规则统一。
- [ ] 所有缓存 key 都有 TTL 策略。
- [ ] 空值缓存和真实数据能区分。
- [ ] TTL 有随机抖动。
- [ ] 写 MySQL 后删除缓存，而不是随手更新缓存。
- [ ] 删除缓存放到事务提交后。
- [ ] 缓存击穿有互斥或逻辑过期方案。
- [ ] 没有把 Redis 当最终数据库。
- [ ] 分布式锁有唯一值、过期、校验释放。
- [ ] 序列化方式统一。
- [ ] 大 key、热点 key、慢命令有监控。
- [ ] Redis 不可用时核心业务有降级策略。

## 参考

- [Redis data types](https://redis.io/docs/latest/develop/data-types/)
- [Redis keyspace](https://redis.io/docs/latest/develop/using-commands/keyspace/)
- [Redis EXPIRE](https://redis.io/docs/latest/commands/expire/)
- [Redis SET](https://redis.io/docs/latest/commands/set/)
