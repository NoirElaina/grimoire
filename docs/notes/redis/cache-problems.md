---
title: Redis 缓存异常治理
sidebarTitle: 缓存异常治理
---

# Redis 缓存异常治理

> 缓存不是“查不到就查库”这么简单。真正出问题时，通常是大量请求一起查不到、一起过期、一起回源。

## 三个经典问题

| 问题 | 现象 | 核心风险 |
| --- | --- | --- |
| 缓存穿透 | Redis 没有，MySQL 也没有 | 不存在的数据反复打 DB |
| 缓存击穿 | 热点 key 过期 | 大量请求同时回源同一条数据 |
| 缓存雪崩 | 大量 key 同时过期或 Redis 不可用 | 数据库被整体打垮 |

这三个问题不是背概念，要能落到接口设计里。

## 缓存穿透

穿透常见来源：

- 请求不存在的 ID。
- 恶意扫 ID。
- 参数非法但没校验。
- 数据被删除后缓存没有空值保护。

读流程应该先挡非法参数：

```java
public ProductDetailVO getProductDetail(Long productId) {
    if (productId == null || productId <= 0) {
        throw new BizException(ErrorCode.INVALID_PARAM);
    }
    return productCacheLoader.get(productId);
}
```

空值缓存：

```java
private static final String NULL_VALUE = "__NULL__";

public ProductDetailVO getProductDetail(Long productId) throws JsonProcessingException {
    String key = RedisKeys.productDetail(productId);
    String cached = stringRedisTemplate.opsForValue().get(key);

    if (NULL_VALUE.equals(cached)) {
        return null;
    }
    if (StringUtils.hasText(cached)) {
        return objectMapper.readValue(cached, ProductDetailVO.class);
    }

    ProductDO product = productMapper.selectById(productId);
    if (product == null) {
        stringRedisTemplate.opsForValue().set(key, NULL_VALUE, Duration.ofMinutes(1));
        return null;
    }

    ProductDetailVO detail = productConverter.toDetail(product);
    stringRedisTemplate.opsForValue().set(key, objectMapper.writeValueAsString(detail), randomTtl());
    return detail;
}
```

空值缓存注意：

- TTL 要短。
- 空值标记要明确。
- 真实业务空对象不要和空值标记混淆。
- 删除数据时也要删缓存。

布隆过滤器适合挡明显不存在的 ID：

```text
请求 productId=20001
先问 BloomFilter：这个 ID 是否可能存在
不存在：直接拒绝或返回空
可能存在：继续查 Redis / MySQL
```

布隆过滤器的边界：

- 它可能误判“存在”。
- 它不应该误判“不存在”。
- 删除数据比较麻烦。
- 仍然需要空值缓存兜底。

## 缓存击穿

击穿是热点 key 过期后，大量请求同时查 DB。

典型场景：

```text
商品 20001 是热门商品
Redis key 在 12:00:00 过期
12:00:01 进来 500 个请求
500 个请求都未命中
500 个请求都去查 MySQL
```

### 方案一：互斥回源

只有一个线程查 DB 并重建缓存，其他线程等待或短暂重试。

```java
public ProductDetailVO getWithMutex(Long productId) throws Exception {
    String key = RedisKeys.productDetail(productId);
    ProductDetailVO cached = getCache(key);
    if (cached != null) {
        return cached;
    }

    String lockKey = key + ":rebuild-lock";
    String lockValue = UUID.randomUUID().toString();
    Boolean locked = stringRedisTemplate.opsForValue()
        .setIfAbsent(lockKey, lockValue, Duration.ofSeconds(5));

    if (Boolean.TRUE.equals(locked)) {
        try {
            return loadFromDbAndRefresh(productId);
        } finally {
            releaseLock(lockKey, lockValue);
        }
    }

    Thread.sleep(50);
    ProductDetailVO retryCached = getCache(key);
    if (retryCached != null) {
        return retryCached;
    }
    return loadFromDbWithoutRefresh(productId);
}
```

释放锁要校验 value：

```lua
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
else
    return 0
end
```

生产里可以用 Redisson 简化锁逻辑。

### 方案二：逻辑过期

缓存 value 里带过期时间，Redis key 本身不过期或设置较长 TTL。

```json
{
  "expireAt": "2026-06-07T12:00:00",
  "data": {
    "id": 20001,
    "name": "phone"
  }
}
```

读取流程：

```text
1. 查 Redis
2. 没有：查 DB 并写缓存
3. 有，且逻辑未过期：直接返回
4. 有，但逻辑已过期：先返回旧数据，再异步刷新
5. 刷新时只允许一个线程拿到重建锁
```

适合：

- 热点商品。
- 首页配置。
- 榜单摘要。

不适合：

- 数据必须强实时。
- 不能返回旧数据的接口。

## 缓存雪崩

雪崩有两类：

### 大量 key 同时过期

常见原因：

- 批量预热时都设置了 10 分钟 TTL。
- 每天零点生成的 key 同时过期。
- 活动开始时一批热点 key 同时失效。

处理：

```java
private Duration randomTtl() {
    return Duration.ofMinutes(10)
        .plusSeconds(ThreadLocalRandom.current().nextInt(30, 300));
}
```

还可以：

- 分批预热。
- 热点 key 逻辑过期。
- 本地缓存兜底。
- 回源限流。

### Redis 整体不可用

处理思路：

| 层次 | 做法 |
| --- | --- |
| 应用层 | 设置 Redis 调用超时，不要无限卡住 |
| 接口层 | 非核心接口降级，核心接口直接查 DB 并限流 |
| 缓存层 | 本地缓存兜底热点配置 |
| 数据库层 | 限制回源并发，保护 MySQL |
| 运维层 | 主从、哨兵或 Cluster，监控告警 |

Redis 挂了不要让所有请求无脑打 MySQL。更合理的是：

```text
核心读接口：限流后查 DB
非核心推荐/排行榜：返回空或旧数据
登录验证码：直接失败或走备用通道
```

## 大 key

大 key 不是只看 key 名字长，而是 value 太大。

常见大 key：

- 一个 `String` 存几 MB JSON。
- 一个 `Hash` 有几十万字段。
- 一个 `Set` 存大量用户 ID。
- 一个 `ZSet` 长期不清理。

风险：

- 网络传输慢。
- 序列化慢。
- 删除慢。
- 迁移慢。
- 主从同步压力大。

治理：

- 拆 key，比如按日期、店铺、分页拆。
- 控制集合长度，比如 `LTRIM`。
- 大集合分页读，不一次性 `SMEMBERS`。
- 定期扫描大 key。
- 删除大 key 用异步删除能力或分批删除。

## 热点 key

热点 key 是某一个 key 被大量访问。

常见场景：

- 秒杀商品详情。
- 首页配置。
- 爆款商品库存。
- 热榜 TopN。

处理：

| 方案 | 适合场景 |
| --- | --- |
| 本地缓存 | 读多写少、允许短暂不一致 |
| 逻辑过期 | 热点详情页 |
| key 分片 | 单 key 计数压力过大 |
| 限流 | 突发流量 |
| 预热 | 活动开始前 |

本地缓存注意：

- TTL 要短。
- 更新时要能失效。
- 多实例不一致要能接受。

## 缓存预热

预热不是把所有数据塞进 Redis。

适合预热：

- 首页配置。
- 活动商品。
- 热门榜单。
- 秒杀库存。

预热流程：

```text
1. 查出需要预热的数据 ID
2. 分批加载 MySQL
3. 写 Redis
4. TTL 加随机抖动
5. 记录预热结果和失败项
```

不要预热：

- 冷门数据。
- 大对象。
- 不确定是否会访问的数据。
- 没有过期策略的数据。

## 接口落地流程

商品详情接口可以这样设计：

```text
1. 参数校验
2. 查 Redis
3. 命中空值：返回不存在
4. 命中正常值：返回
5. 未命中：尝试拿重建锁
6. 拿到锁：查 DB，写缓存，释放锁
7. 没拿到锁：短暂等待后再查缓存
8. DB 不存在：写空值缓存
9. DB 存在：写正常缓存，TTL 加抖动
```

## 去空话检查

- [ ] 穿透有参数校验、空值缓存或布隆过滤器。
- [ ] 击穿有互斥回源或逻辑过期。
- [ ] 雪崩有 TTL 抖动、限流和降级。
- [ ] 大 key 有拆分和容量上限。
- [ ] 热点 key 有预热、本地缓存或逻辑过期。
- [ ] Redis 不可用时接口有明确返回策略。

## 参考

- [Redis EXPIRE](https://redis.io/docs/latest/commands/expire/)
