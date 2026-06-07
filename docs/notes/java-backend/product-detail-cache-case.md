---
title: 商品详情查询与缓存案例
sidebarTitle: 商品详情缓存案例
---

# 商品详情查询与缓存案例

> 这是一个项目案例：用商品详情接口串起 Controller、Service、MyBatis、Redis 缓存、缓存穿透、击穿和更新后删缓存。

## 要解决的问题

商品详情页通常访问很频繁。

如果每次都查 MySQL：

```text
前端打开商品详情
  -> 查商品表
  -> 查图片表
  -> 查 SKU 表
  -> 查店铺 / 类目
  -> 拼 VO
```

高峰期会有几个问题：

- 数据库压力大。
- 多表查询响应慢。
- 热门商品容易把同一批 SQL 打爆。
- 商品不存在时，恶意请求会一直穿透到 DB。

目标：

- 热点详情优先走 Redis。
- 未命中时回源 MySQL。
- 不存在的商品写空值缓存。
- 热点回源加互斥锁。
- 商品更新后删缓存。
- MySQL 仍然是事实来源。

## 接口设计

```text
GET /api/products/{productId}
```

返回：

```json
{
  "code": "SUCCESS",
  "data": {
    "id": 10001,
    "name": "机械键盘",
    "price": 299.00,
    "mainImage": "https://cdn.example.com/1.png",
    "images": [
      "https://cdn.example.com/1.png",
      "https://cdn.example.com/2.png"
    ],
    "stock": 120
  }
}
```

Controller：

```java
@RestController
@RequestMapping("/api/products")
public class ProductController {

    private final ProductDetailService productDetailService;

    public ProductController(ProductDetailService productDetailService) {
        this.productDetailService = productDetailService;
    }

    @GetMapping("/{productId}")
    public ApiResult<ProductDetailVO> detail(@PathVariable Long productId) {
        return ApiResult.success(productDetailService.getDetail(productId));
    }
}
```

Controller 不写缓存逻辑，只负责 HTTP。

## 数据库设计

最小表：

```sql
create table product (
    id bigint primary key auto_increment,
    name varchar(128) not null,
    category_id bigint not null,
    price decimal(10, 2) not null,
    status varchar(32) not null,
    stock int not null,
    created_at datetime not null,
    updated_at datetime not null
);

create table product_image (
    id bigint primary key auto_increment,
    product_id bigint not null,
    image_url varchar(512) not null,
    sort_no int not null,
    created_at datetime not null,
    index idx_product_image_product_sort (product_id, sort_no)
);
```

查询详情通常至少需要：

```sql
select id, name, category_id, price, status, stock
from product
where id = #{productId}
  and status = 'ON_SALE';

select image_url
from product_image
where product_id = #{productId}
order by sort_no asc;
```

## VO 设计

```java
public record ProductDetailVO(
    Long id,
    String name,
    BigDecimal price,
    String mainImage,
    List<String> images,
    Integer stock
) {
}
```

不要直接返回 `ProductDO`，否则会把数据库结构暴露给前端。

## 缓存 key

```java
public final class ProductRedisKeys {

    private static final String APP = "flashmart";

    private ProductRedisKeys() {
    }

    public static String detail(Long productId) {
        return APP + ":product:detail:" + productId;
    }

    public static String detailRebuildLock(Long productId) {
        return APP + ":product:detail:" + productId + ":rebuild-lock";
    }
}
```

TTL：

| key | TTL |
| --- | --- |
| 正常商品详情 | 10 到 30 分钟，加随机抖动 |
| 空值缓存 | 1 到 3 分钟 |
| 重建锁 | 3 到 10 秒 |

## 查询流程

```text
1. 校验 productId
2. 查 Redis
3. 命中正常值：反序列化返回
4. 命中空值：返回不存在
5. 未命中：尝试拿重建锁
6. 拿到锁：查 DB，写缓存，返回
7. 没拿到锁：短暂等待后再查 Redis
8. DB 不存在：写空值缓存
```

Service：

```java
@Service
public class ProductDetailService {

    private static final String NULL_VALUE = "__NULL__";

    private final StringRedisTemplate stringRedisTemplate;
    private final ObjectMapper objectMapper;
    private final ProductMapper productMapper;
    private final ProductImageMapper productImageMapper;
    private final ProductConverter productConverter;

    public ProductDetailService(StringRedisTemplate stringRedisTemplate,
                                ObjectMapper objectMapper,
                                ProductMapper productMapper,
                                ProductImageMapper productImageMapper,
                                ProductConverter productConverter) {
        this.stringRedisTemplate = stringRedisTemplate;
        this.objectMapper = objectMapper;
        this.productMapper = productMapper;
        this.productImageMapper = productImageMapper;
        this.productConverter = productConverter;
    }

    public ProductDetailVO getDetail(Long productId) {
        if (productId == null || productId <= 0) {
            throw new BizException(ErrorCode.INVALID_PARAM);
        }

        String key = ProductRedisKeys.detail(productId);
        String cached = stringRedisTemplate.opsForValue().get(key);
        if (NULL_VALUE.equals(cached)) {
            throw new BizException(ErrorCode.PRODUCT_NOT_FOUND);
        }
        if (StringUtils.hasText(cached)) {
            return readDetail(cached);
        }

        return rebuildWithMutex(productId);
    }
}
```

## 回源与重建缓存

```java
private ProductDetailVO rebuildWithMutex(Long productId) {
    String lockKey = ProductRedisKeys.detailRebuildLock(productId);
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

    sleepSilently(Duration.ofMillis(50));
    String cached = stringRedisTemplate.opsForValue().get(ProductRedisKeys.detail(productId));
    if (StringUtils.hasText(cached) && !NULL_VALUE.equals(cached)) {
        return readDetail(cached);
    }
    return loadFromDbWithoutRefresh(productId);
}
```

这里为了学习展示了手写锁。生产里可以用 Redisson。

安全释放锁：

```lua
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
else
    return 0
end
```

## 查 DB 并写缓存

```java
private ProductDetailVO loadFromDbAndRefresh(Long productId) {
    ProductDO product = productMapper.selectOnSaleById(productId);
    if (product == null) {
        stringRedisTemplate.opsForValue().set(
            ProductRedisKeys.detail(productId),
            NULL_VALUE,
            Duration.ofMinutes(1)
        );
        throw new BizException(ErrorCode.PRODUCT_NOT_FOUND);
    }

    List<ProductImageDO> images = productImageMapper.selectByProductId(productId);
    ProductDetailVO detail = productConverter.toDetailVO(product, images);

    writeDetailCache(productId, detail);
    return detail;
}

private void writeDetailCache(Long productId, ProductDetailVO detail) {
    String value = writeJson(detail);
    Duration ttl = Duration.ofMinutes(10)
        .plusSeconds(ThreadLocalRandom.current().nextInt(30, 300));
    stringRedisTemplate.opsForValue().set(ProductRedisKeys.detail(productId), value, ttl);
}
```

## 商品更新后删缓存

商品修改后不要直接更新缓存，推荐事务提交后删除缓存。

```java
@Transactional(rollbackFor = Exception.class)
public void updateProduct(UpdateProductCommand command) {
    productMapper.updateById(command.toProductDO());
    productImageMapper.replaceImages(command.productId(), command.images());

    TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
        @Override
        public void afterCommit() {
            stringRedisTemplate.delete(ProductRedisKeys.detail(command.productId()));
        }
    });
}
```

原因：

- 商品详情可能由多张表拼出来。
- 事务没提交时不能让缓存提前失效并回填旧值。
- 删除缓存比更新缓存更不容易写错。

如果删除失败不能接受，要加 outbox 或重试任务。

## 并发场景

| 场景 | 处理 |
| --- | --- |
| 不存在商品被反复请求 | 空值缓存 |
| 热门商品过期 | 互斥锁回源 |
| 同一批 key 同时过期 | TTL 随机抖动 |
| 商品更新时并发读 | afterCommit 删除缓存 |
| Redis 故障 | 限流后查 DB 或降级 |
| 缓存反序列化失败 | 删除 key 后回源 |

反序列化失败不要一直抛异常：

```java
private ProductDetailVO readDetail(String cached) {
    try {
        return objectMapper.readValue(cached, ProductDetailVO.class);
    } catch (JsonProcessingException e) {
        throw new BizException(ErrorCode.CACHE_DATA_INVALID);
    }
}
```

实际项目里可以在 catch 中删除对应 key，再回源 DB。

## 测试用例

至少测：

- 商品存在，首次查 DB 并写缓存。
- 商品存在，第二次命中 Redis。
- 商品不存在，写空值缓存。
- 非法 productId 被拒绝。
- 热门 key 未命中时只有一个线程重建。
- 商品更新事务提交后删除缓存。
- 商品更新事务回滚时不删除缓存。
- Redis 返回坏 JSON 时能处理。

## 去空话检查

- [ ] 商品详情缓存 key 和 TTL 明确。
- [ ] Controller 不写缓存细节。
- [ ] 不存在商品有空值缓存。
- [ ] 热点回源有互斥锁或逻辑过期。
- [ ] 更新商品后在事务提交后删缓存。
- [ ] MySQL 仍然是事实来源。

## 关联笔记

- [Redis 缓存设计总览](/notes/redis/cache-design)
- [Redis 缓存异常治理](/notes/redis/cache-problems)
- [Redis 与 MySQL 缓存一致性](/notes/redis/cache-consistency)
- [Spring 事务回滚规则](/notes/java-backend/transactional-rollback)
