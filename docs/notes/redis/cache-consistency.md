---
title: Redis 与 MySQL 缓存一致性
sidebarTitle: 缓存一致性
---

# Redis 与 MySQL 缓存一致性

> 缓存一致性不是追求“Redis 和 MySQL 永远一样”，而是明确谁是事实来源、什么时候允许短暂不一致、失败后怎么修复。

## 读流程

```text
1. 读 Redis
2. 命中：返回
3. 未命中：读 MySQL
4. MySQL 有数据：写 Redis，设置 TTL
5. MySQL 无数据：写空值缓存，设置短 TTL
```

代码骨架：

```java
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

## 写流程

推荐写法：

```java
@Transactional(rollbackFor = Exception.class)
public void updateProduct(UpdateProductCommand command) {
    productMapper.updateById(command.toEntity());

    TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
        @Override
        public void afterCommit() {
            stringRedisTemplate.delete(RedisKeys.productDetail(command.productId()));
        }
    });
}
```

重点是 `afterCommit`：

- 只有数据库事务真的提交了，才删缓存。
- 事务回滚时不删缓存。
- 避免“数据库没改成功，但缓存被删了”的情况。

## 为什么不在事务里直接删缓存

错误流程：

```text
1. 开启事务
2. 更新 MySQL
3. 删除 Redis
4. 并发读请求进来，Redis 未命中
5. 并发读查到旧 MySQL 数据
6. 并发读把旧数据写回 Redis
7. 事务提交新数据
8. Redis 里仍然是旧数据
```

把删除放到 `afterCommit` 可以减少这个窗口。

但要诚实：`afterCommit` 也不能保证 Redis 删除一定成功。网络失败、Redis 短暂不可用都会导致删除失败。

## 删除失败怎么办

如果业务允许短暂不一致：

- 缓存设置较短 TTL。
- 删除失败记录日志。
- 依赖过期时间最终恢复。

如果业务更敏感：

```text
1. 更新 MySQL
2. 同事务写 outbox 表
3. 事务提交
4. 异步任务读取 outbox
5. 删除 Redis
6. 删除成功后标记 outbox 完成
7. 失败则重试
```

outbox 表示例：

```sql
create table cache_invalidation_outbox (
    id bigint primary key auto_increment,
    event_type varchar(64) not null,
    cache_key varchar(255) not null,
    status varchar(32) not null,
    retry_count int not null default 0,
    created_at datetime not null,
    updated_at datetime not null
);
```

这样 Redis 删除失败不会悄悄丢掉。

## 延迟双删

延迟双删流程：

```text
1. 更新 MySQL 前后删除一次缓存
2. 等待一小段时间
3. 再删除一次缓存
```

示例：

```java
@Transactional(rollbackFor = Exception.class)
public void updateProduct(UpdateProductCommand command) {
    String key = RedisKeys.productDetail(command.productId());
    stringRedisTemplate.delete(key);

    productMapper.updateById(command.toEntity());

    TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
        @Override
        public void afterCommit() {
            stringRedisTemplate.delete(key);
            cacheInvalidationExecutor.schedule(() -> stringRedisTemplate.delete(key), 500, TimeUnit.MILLISECONDS);
        }
    });
}
```

延迟双删只是降低并发旧值回填概率，不是强一致方案。

如果删除失败不能接受，仍然需要 outbox、消息重试或 binlog 订阅。

## Binlog / CDC 失效缓存

更系统的做法是监听 MySQL 变更：

```text
MySQL binlog -> Canal/Debezium -> 消息队列 -> 缓存失效服务 -> 删除 Redis
```

适合：

- 多服务都会改同一张表。
- 缓存 key 很多，需要统一治理。
- 不想把删缓存逻辑散在所有业务代码里。

注意：

- CDC 有延迟。
- 事件可能重复。
- 删除缓存要幂等。
- key 映射规则要统一。

## 一致性级别要写清

不同业务要求不同：

| 业务 | 一致性要求 | Redis 策略 |
| --- | --- | --- |
| 商品详情 | 允许秒级旧数据 | Cache Aside + TTL + afterCommit 删除 |
| 用户昵称头像 | 允许短暂旧数据 | 更新后删缓存 |
| 库存最终扣减 | 不允许只靠缓存 | MySQL 条件更新 + MQ + 对账 |
| 订单状态 | 不建议缓存为事实 | 读库或短 TTL 缓存 |
| 首页榜单 | 允许旧数据 | 逻辑过期 + 异步刷新 |

不要所有场景都追求同一种一致性。

## 写操作检查清单

每个写接口都问：

- 改了哪些表。
- 哪些缓存 key 会受影响。
- key 是单个还是批量。
- 删除缓存是在事务提交前还是提交后。
- 删除失败怎么办。
- 是否需要重试。
- 是否允许短暂旧值。
- TTL 能不能兜底。

## 去空话检查

- [ ] 明确 MySQL 是事实来源。
- [ ] 写接口不是更新缓存，而是删除缓存。
- [ ] 删除缓存放在事务提交后。
- [ ] 删除失败有 TTL、重试或 outbox 兜底。
- [ ] 高一致场景不只靠 Redis。
- [ ] 多服务写入时考虑 CDC 或统一失效服务。

## 参考

- [Spring TransactionSynchronization](https://docs.spring.io/spring-framework/reference/data-access/transaction/event.html)
- [Spring Data Redis RedisTemplate](https://docs.spring.io/spring-data/redis/reference/redis/template.html)
