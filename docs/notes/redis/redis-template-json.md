---
title: RedisTemplate JSON 序列化配置
sidebarTitle: RedisTemplate 配置
---

# RedisTemplate JSON 序列化配置

> 这段配置的核心目的：让 Redis 的 key 可读，让 value 用 JSON 存，不再用 Java 原生序列化。

## 代码

```java
package org.example.flashmart.common.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.serializer.GenericJacksonJsonRedisSerializer;
import org.springframework.data.redis.serializer.RedisSerializer;
import org.springframework.data.redis.serializer.StringRedisSerializer;
import tools.jackson.databind.ObjectMapper;

@Configuration
public class RedisConfig {

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
}
```

这版适合 Spring Boot 4 / Spring Data Redis 4.x。

如果项目还是 Spring Boot 3 / Spring Data Redis 3.x，旧写法通常是：

```java
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.data.redis.serializer.GenericJackson2JsonRedisSerializer;

template.setValueSerializer(new GenericJackson2JsonRedisSerializer(objectMapper));
template.setHashValueSerializer(new GenericJackson2JsonRedisSerializer(objectMapper));
```

注意：`GenericJackson2JsonRedisSerializer` 在 Spring Data Redis 4.0 起已经标记弃用并准备移除，新项目不要继续用它。

## 这段配置解决什么

Spring Data Redis 的 `RedisTemplate` 默认会用 Java 原生序列化存对象。

默认效果大概是：

```text
\xac\xed\x00\x05sr...
```

这种格式的问题：

- Redis 里看不懂。
- 不方便排查线上数据。
- 类结构变了容易反序列化失败。
- Java 原生反序列化有安全风险。
- 其他语言服务很难读。

改成 JSON 后，Redis 里更像这样：

```json
{
  "@class": "org.example.flashmart.user.vo.UserVO",
  "id": 10001,
  "username": "alice"
}
```

这样更适合业务缓存和问题排查。

## 每一行在干什么

### `RedisConnectionFactory`

```java
RedisConnectionFactory connectionFactory
```

连接工厂由 Spring Boot 根据配置自动创建，底层通常是 Lettuce。

常见配置：

```yaml
spring:
  data:
    redis:
      host: localhost
      port: 6379
      timeout: 2s
```

`RedisTemplate` 本身不直接创建连接，它通过 `connectionFactory` 拿连接。

### `ObjectMapper`

```java
ObjectMapper objectMapper
```

这里注入的是 Spring Boot 管理的 Jackson 配置。

版本差异要注意：

- Spring Boot 4 / Spring Data Redis 4：通常是 `tools.jackson.databind.ObjectMapper`。
- Spring Boot 3 / Spring Data Redis 3：通常是 `com.fasterxml.jackson.databind.ObjectMapper`。

好处：

- 和接口 JSON 序列化规则保持一致。
- 已注册 Java Time 相关模块时，`LocalDateTime` 更容易正常处理。
- 全局的枚举、日期、字段命名策略可以复用。

注意：不要在这个方法里随手修改传进来的全局 `objectMapper`，否则可能影响 Controller 的 JSON 返回。

如果 Redis 需要专用规则，先复制：

```java
ObjectMapper redisObjectMapper = objectMapper.copy();
```

### `setKeySerializer`

```java
template.setKeySerializer(new StringRedisSerializer());
```

Redis 的 key 用字符串序列化。

这样 key 才是可读的：

```text
flashmart:user:profile:10001
```

不要让 key 用 JDK 序列化，否则 Redis 里看到的是乱码，也不方便用命令排查。

### `setHashKeySerializer`

```java
template.setHashKeySerializer(new StringRedisSerializer());
```

Hash 结构里的 field 也用字符串。

例如：

```text
HSET flashmart:user:10001 username alice
```

这里的 `username` 就是 hash key。

### `setValueSerializer`

```java
template.setValueSerializer(new GenericJacksonJsonRedisSerializer(objectMapper));
```

普通 value 用 JSON 序列化。

例如：

```java
redisTemplate.opsForValue().set(key, userVO, Duration.ofMinutes(10));
```

存进去的是 JSON，不是 Java 二进制序列化。

### `setHashValueSerializer`

```java
template.setHashValueSerializer(new GenericJacksonJsonRedisSerializer(objectMapper));
```

Hash value 也用 JSON。

例如：

```java
redisTemplate.opsForHash().put("flashmart:user:10001", "profile", userVO);
```

这里 `profile` 对应的值会按 JSON 存。

### `afterPropertiesSet`

```java
template.afterPropertiesSet();
```

告诉 `RedisTemplate`：连接工厂、序列化器这些属性已经配置完，可以初始化内部状态。

手动 new `RedisTemplate` 时建议调用。

## 推荐用法

普通缓存：

```java
String key = "flashmart:user:profile:" + userId;

redisTemplate.opsForValue().set(key, userVO, Duration.ofMinutes(10));

Object cached = redisTemplate.opsForValue().get(key);
if (cached instanceof UserVO user) {
    return user;
}
```

Hash 缓存：

```java
String key = "flashmart:cart:" + userId;

redisTemplate.opsForHash().put(key, skuId.toString(), cartItemVO);
redisTemplate.expire(key, Duration.ofDays(7));
```

计数器：

```java
String key = "flashmart:limit:login:" + mobile;

Long count = redisTemplate.opsForValue().increment(key);
if (count != null && count == 1) {
    redisTemplate.expire(key, Duration.ofMinutes(5));
}
```

注意：计数器 value 是数字，不是对象。混用时要确认这个 key 不会被 JSON 对象覆盖。

## 类型信息问题

`RedisTemplate<String, Object>` 最大的坑是：写进去是 `Object`，读出来也只能先按 `Object` 接。

如果 JSON 里没有类型信息，可能会读成：

```java
LinkedHashMap
```

而不是：

```java
UserVO
```

`GenericJacksonJsonRedisSerializer` 的目的就是处理“不同对象类型都往一个模板里存”的场景，它会依赖 Jackson 的动态类型能力。

如果项目里出现这种问题：

```text
class java.util.LinkedHashMap cannot be cast to class UserVO
```

优先检查：

- value 里有没有 `@class` 这类类型字段。
- 是否传入了自定义 `ObjectMapper` 后丢了默认类型配置。
- 是否之前旧数据是用别的序列化方式写的。
- 是否同一个 key 被不同代码写成了不同结构。

如果缓存类型固定，更稳的方式是不要用 `Object`：

```java
String json = stringRedisTemplate.opsForValue().get(key);
UserVO user = objectMapper.readValue(json, UserVO.class);
```

或者为固定类型单独配置序列化器。

## 是否要复制 ObjectMapper

当前代码直接使用 Spring Boot 的全局 `ObjectMapper`：

```java
new GenericJacksonJsonRedisSerializer(objectMapper)
```

这个写法的好处是规则统一。

但如果你要给 Redis 开启额外的类型信息、null 值处理、特殊字段策略，建议复制一个 Redis 专用 mapper：

```java
ObjectMapper redisObjectMapper = objectMapper.copy();
GenericJacksonJsonRedisSerializer serializer =
    new GenericJacksonJsonRedisSerializer(redisObjectMapper);
```

原则：

- 只复用已有规则：可以直接用全局 `ObjectMapper`。
- 要改 mapper 行为：先 `copy()`，不要污染接口 JSON。

## null 值缓存

有些场景会缓存空值，防止缓存穿透：

```java
redisTemplate.opsForValue().set(key, nullMarker, Duration.ofMinutes(1));
```

不要真的直接缓存 Java `null`。

更推荐用明确标记：

```java
private static final String NULL_VALUE = "__NULL__";
```

因为：

- 真实 null 容易和 key 不存在混淆。
- 不同序列化器对 null 支持不一样。
- 排查时看不出业务含义。

如果使用 `GenericJacksonJsonRedisSerializer` 的 null 值序列化能力，并且自定义了 `ObjectMapper`，需要关注 null value serializer 是否注册。

## 和 StringRedisTemplate 怎么选

| 场景 | 推荐 |
| --- | --- |
| key/value 都是字符串 | `StringRedisTemplate` |
| 自己控制 JSON 字符串 | `StringRedisTemplate + ObjectMapper` |
| 同一个模板要存多种对象 | `RedisTemplate<String, Object>` |
| 类型固定、强约束缓存 | 固定类型序列化器或手动 JSON |
| 计数、锁、限流 | `StringRedisTemplate` 更简单 |

项目里可以同时保留：

```java
private final StringRedisTemplate stringRedisTemplate;
private final RedisTemplate<String, Object> redisTemplate;
```

但要规定：

- 字符串、计数、锁：优先 `StringRedisTemplate`。
- 对象缓存：用封装后的 `RedisTemplate`。
- 不要同一个 key 一会儿用字符串写，一会儿用对象写。

## 常见坑

### key 可读，value 不可读

说明只配置了 key serializer，没有配置 value serializer。

检查：

```java
template.setValueSerializer(...)
template.setHashValueSerializer(...)
```

### Hash field 乱码

说明没配：

```java
template.setHashKeySerializer(new StringRedisSerializer());
```

### 读出来是 LinkedHashMap

常见原因：

- 缺少类型信息。
- 使用了 `Object` 接收。
- 不同服务的序列化配置不一致。
- 老数据还是旧序列化格式。

解决方向：

- 清理旧 key。
- 使用固定类型读取。
- 统一所有服务的序列化配置。
- 不要跨服务随意共享 `RedisTemplate<String, Object>` 写出的对象缓存。

### LocalDateTime 序列化异常

通常是 `ObjectMapper` 没注册 Java Time 模块。

Spring Boot 默认一般会帮你配置好；如果你自己 new 了一个 `ObjectMapper`，就可能丢失这些模块。

所以这里注入 Spring 管理的 `ObjectMapper` 是合理的。

### 同一个 key 被不同类型覆盖

例如：

```java
redisTemplate.opsForValue().set("flashmart:user:10001", userVO);
stringRedisTemplate.opsForValue().set("flashmart:user:10001", "online");
```

这会导致后续反序列化混乱。

解决：key 命名要带对象语义。

```text
flashmart:user:profile:10001
flashmart:user:online:10001
```

## 推荐封装一层

不要让业务代码到处直接操作 `RedisTemplate<String, Object>`。

可以封装：

```java
@Component
public class RedisCacheClient {

    private final RedisTemplate<String, Object> redisTemplate;

    public RedisCacheClient(RedisTemplate<String, Object> redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    public void set(String key, Object value, Duration ttl) {
        redisTemplate.opsForValue().set(key, value, ttl);
    }

    public Object get(String key) {
        return redisTemplate.opsForValue().get(key);
    }

    public void delete(String key) {
        redisTemplate.delete(key);
    }
}
```

更进一步，按业务类型封装：

```java
@Component
public class UserCache {

    private final RedisTemplate<String, Object> redisTemplate;

    public UserCache(RedisTemplate<String, Object> redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    public void putProfile(Long userId, UserProfileVO profile) {
        redisTemplate.opsForValue().set(UserCacheKey.profile(userId), profile, Duration.ofMinutes(10));
    }

    public Optional<UserProfileVO> getProfile(Long userId) {
        Object value = redisTemplate.opsForValue().get(UserCacheKey.profile(userId));
        if (value instanceof UserProfileVO profile) {
            return Optional.of(profile);
        }
        return Optional.empty();
    }
}
```

这样可以把 key、TTL、类型转换都收口。

## 落地检查清单

- [ ] key serializer 使用 `StringRedisSerializer`。
- [ ] hash key serializer 使用 `StringRedisSerializer`。
- [ ] value serializer 使用 JSON，不用 JDK 原生序列化。
- [ ] hash value serializer 和 value serializer 保持一致。
- [ ] 注入 Spring 管理的 `ObjectMapper`，不要随便 `new ObjectMapper()`。
- [ ] 如果要修改 Redis 专用 mapper，先 `objectMapper.copy()`。
- [ ] 确认对象回读不会变成 `LinkedHashMap`。
- [ ] 不同服务共享缓存时，序列化配置必须一致。
- [ ] 同一个 key 不混用字符串和对象结构。
- [ ] 业务代码不要散落硬编码 key，统一封装 key 生成。
- [ ] 所有缓存写入都明确 TTL。

## 参考

- [Spring Data Redis RedisTemplate](https://docs.spring.io/spring-data/redis/reference/redis/template.html)
- [GenericJacksonJsonRedisSerializer Javadoc](https://docs.spring.io/spring-data-redis/reference/api/java/org/springframework/data/redis/serializer/GenericJacksonJsonRedisSerializer.html)
- [GenericJackson2JsonRedisSerializer Javadoc（Spring Data Redis 3.x）](https://docs.spring.io/spring-data-redis/docs/3.0.7/api/org/springframework/data/redis/serializer/GenericJackson2JsonRedisSerializer.html)
