---
title: Redis 数据结构实战
sidebarTitle: 02 数据结构
---

# Redis 数据结构实战

> Redis 不是只有 `String`。数据结构选对了，命令天然就是业务能力；选错了，后面会变成大 key、慢命令和一致性坑。

## 选型总表

| 数据结构 | 适合 | 不适合 |
| --- | --- | --- |
| `String` | JSON 缓存、验证码、计数器、锁 | 很大的对象、局部字段频繁更新 |
| `Hash` | 对象字段、购物车、配置项 | 字段无限增长的大对象 |
| `List` | 最近记录、简单队列 | 高可靠消息、复杂重试 |
| `Set` | 去重、标签、关注集合 | 需要按分数排序 |
| `ZSet` | 排行榜、时间线、延迟任务 | score 语义不稳定的场景 |
| `Bitmap` | 签到、活跃标记 | 需要存复杂对象 |
| `HyperLogLog` | UV 粗略统计 | 精确计数 |
| `Stream` | 轻量消息流、消费组 | 完整 MQ 治理、死信和复杂路由 |

## String

最常见用法是缓存一个 JSON：

```text
SET mall:product:detail:20001 "{\"id\":20001,\"name\":\"phone\"}" EX 600
GET mall:product:detail:20001
```

Spring 写法：

```java
public void cacheProduct(ProductDetailVO detail) throws JsonProcessingException {
    String key = RedisKeys.productDetail(detail.id());
    String value = objectMapper.writeValueAsString(detail);
    stringRedisTemplate.opsForValue().set(key, value, Duration.ofMinutes(10));
}
```

计数器：

```text
INCR mall:product:view:20001
EXPIRE mall:product:view:20001 86400
```

计数器的坑：`INCR` 和 `EXPIRE` 是两步，第一步成功第二步失败时，key 可能永不过期。需要原子性时用 Lua。

```lua
local current = redis.call("incr", KEYS[1])
if current == 1 then
    redis.call("expire", KEYS[1], ARGV[1])
end
return current
```

适合 `String` 的判断：

- 读写整个对象。
- value 不大。
- 不需要频繁改对象里的单个字段。
- TTL 直接作用在整个对象上。

## Hash

Hash 适合把一个对象拆成字段：

```text
HSET mall:user:profile:10001 nickname alice avatar /a.png level 3
HGET mall:user:profile:10001 nickname
HGETALL mall:user:profile:10001
EXPIRE mall:user:profile:10001 600
```

购物车也常用 Hash：

```text
HSET mall:cart:10001 20001 "{\"skuId\":20001,\"count\":2}"
HINCRBY mall:cart:10001 20001 1
EXPIRE mall:cart:10001 604800
```

Spring 写法：

```java
public void putCartItem(Long userId, Long skuId, CartItemVO item) {
    String key = RedisKeys.cart(userId);
    redisTemplate.opsForHash().put(key, skuId.toString(), item);
    redisTemplate.expire(key, Duration.ofDays(7));
}
```

Hash 的坑：

- `HGETALL` 碰到大 Hash 会很慢。
- Hash 只能给整个 key 设置 TTL，不能按普通字段独立过期。
- 字段很多时要拆分，比如按用户、店铺、分页维度拆 key。

## List

List 是双端列表：

```text
LPUSH mall:user:recent-view:10001 20001
LTRIM mall:user:recent-view:10001 0 99
LRANGE mall:user:recent-view:10001 0 20
```

适合：

- 最近浏览。
- 最近搜索。
- 简单任务队列。

不适合：

- 订单消息可靠投递。
- 消费失败重试。
- 需要死信队列。
- 多消费者复杂分组。

可靠消息优先 RabbitMQ、Kafka、RocketMQ，不要为了省组件把 Redis List 变成半成品 MQ。

## Set

Set 是无序去重集合：

```text
SADD mall:user:favorites:10001 20001
SISMEMBER mall:user:favorites:10001 20001
SREM mall:user:favorites:10001 20001
SCARD mall:user:favorites:10001
```

适合：

- 收藏商品 ID。
- 标签集合。
- 黑名单、白名单。
- 去重集合。

共同关注、共同标签：

```text
SINTER mall:user:follow:10001 mall:user:follow:10002
```

Set 的坑：

- `SMEMBERS` 大集合会一次性返回全部成员。
- 大集合要分页或拆 key。
- 集合内容如果需要排序，应使用 `ZSet`。

## ZSet

ZSet 是带 score 的有序集合。

排行榜：

```text
ZINCRBY mall:rank:product-hot:20260607 1 20001
ZREVRANGE mall:rank:product-hot:20260607 0 9 WITHSCORES
EXPIRE mall:rank:product-hot:20260607 259200
```

延迟任务也可以用 ZSet 做轻量实现：

```text
ZADD mall:delay:order-timeout 1780848000000 order-10001
ZRANGEBYSCORE mall:delay:order-timeout 0 1780848000000 LIMIT 0 100
ZREM mall:delay:order-timeout order-10001
```

但订单超时这类业务，如果已经有 RabbitMQ 延迟队列或死信队列，优先用 MQ，治理能力更完整。

ZSet 的设计重点：

- score 是时间戳、热度、积分还是权重。
- member 是否唯一。
- 榜单是日榜、周榜还是总榜。
- 榜单详情是否需要再查 DB。
- key 是否归档和过期。

## Bitmap

Bitmap 适合布尔状态，比如签到：

```text
SETBIT mall:signin:10001:202606 6 1
GETBIT mall:signin:10001:202606 6
BITCOUNT mall:signin:10001:202606
```

`6` 可以表示当月第 7 天，offset 从 0 开始。

适合：

- 用户签到。
- 当天是否活跃。
- 某个开关是否开启。

不适合：

- 存对象。
- 存需要解释的复杂状态。
- offset 无法稳定映射的业务。

## HyperLogLog

HyperLogLog 用于近似 UV：

```text
PFADD mall:uv:home:20260607 user-10001
PFADD mall:uv:home:20260607 user-10002
PFCOUNT mall:uv:home:20260607
```

它有误差，所以只能用于“近似统计”。

适合：

- 首页 UV。
- 活动 UV。
- 商品详情 UV 粗略统计。

不适合：

- 财务。
- 库存。
- 精准人数。
- 需要列出所有成员的场景。

## Stream

Stream 是 Redis 的消息流结构：

```text
XADD mall:stream:order-created * orderId 10001 userId 20001
XGROUP CREATE mall:stream:order-created order-service 0 MKSTREAM
XREADGROUP GROUP order-service consumer-1 COUNT 10 STREAMS mall:stream:order-created >
XACK mall:stream:order-created order-service 1780848000000-0
```

它可以做：

- 简单消息流。
- 消费组。
- 消费确认。
- pending 消息处理。

但是复杂业务仍然更推荐 MQ：

- MQ 的死信、重试、路由、堆积治理更成熟。
- 运维和观测更清晰。
- 消息可靠性设计更标准。

## Java 里怎么封装

不要在 service 里散落 Redis 命令，按业务封装：

```java
@Component
public class ProductCache {

    private final StringRedisTemplate stringRedisTemplate;
    private final ObjectMapper objectMapper;

    public ProductCache(StringRedisTemplate stringRedisTemplate, ObjectMapper objectMapper) {
        this.stringRedisTemplate = stringRedisTemplate;
        this.objectMapper = objectMapper;
    }

    public Optional<ProductDetailVO> getDetail(Long productId) throws JsonProcessingException {
        String value = stringRedisTemplate.opsForValue().get(RedisKeys.productDetail(productId));
        if (!StringUtils.hasText(value)) {
            return Optional.empty();
        }
        return Optional.of(objectMapper.readValue(value, ProductDetailVO.class));
    }

    public void putDetail(ProductDetailVO detail, Duration ttl) throws JsonProcessingException {
        stringRedisTemplate.opsForValue().set(
            RedisKeys.productDetail(detail.id()),
            objectMapper.writeValueAsString(detail),
            ttl
        );
    }
}
```

封装层负责：

- key 生成。
- TTL。
- 序列化。
- 空值标记。
- 反序列化失败处理。

## 数据结构选择口诀

- 整体缓存对象：`String`。
- 对象字段可局部改：`Hash`。
- 最近 N 条：`List`。
- 去重集合：`Set`。
- 排名和时间分数：`ZSet`。
- 是否签到、是否活跃：`Bitmap`。
- UV 粗略统计：`HyperLogLog`。
- 轻量消息流：`Stream`。

## 去空话检查

- [ ] 每个结构都有业务例子。
- [ ] 集合类 key 有容量上限。
- [ ] 大集合读取不用一次性全量命令。
- [ ] 需要排序时不再用 `Set` 硬凑。
- [ ] 需要可靠消息时不把 `List` 当 MQ。
- [ ] 需要精确统计时不使用 `HyperLogLog`。

## 参考

- [Redis data types](https://redis.io/docs/latest/develop/data-types/)
