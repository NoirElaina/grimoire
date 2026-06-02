---
title: Redis 总览
sidebarTitle: 专题首页
---

# Redis 总览

> 这一组只记 Redis 在后端项目里怎么用稳：key、TTL、缓存一致性、锁、计数、热点治理。

## 内容入口

- [Redis 基础使用与缓存设计](/notes/redis/cache-design)
- [RedisTemplate JSON 序列化配置](/notes/redis/redis-template-json)

## 先定边界

Redis 在业务系统里通常是 **高性能辅助层**，不是最终事实来源。

| 场景 | 能不能用 Redis | 注意点 |
| --- | --- | --- |
| 缓存商品、用户、配置 | 可以 | MySQL 仍是准数据源 |
| 登录态、短 token 状态 | 可以 | TTL、吊销、续期要设计 |
| 计数器、限流 | 可以 | 注意窗口、过期、原子性 |
| 排行榜 | 很适合 | `ZSet` 天然匹配 |
| 分布式锁 | 能用但要克制 | 必须有过期、唯一值、安全释放 |
| 可靠消息队列 | 不优先 | 重试、堆积、死信更适合 MQ |
| 核心库存最终扣减 | 不建议只靠 Redis | DB/MQ/对账必须兜底 |

## 项目里先统一这些

- key 命名：`系统:模块:业务:id`。
- TTL 策略：所有缓存 key 都要明确是否过期。
- 序列化：不要混用 JDK 序列化、JSON 字符串、Hash。
- 一致性：写数据库成功后删缓存，不直接更新缓存。
- 降级：Redis 挂了时，核心接口怎么走。
- 观测：缓存命中率、慢命令、大 key、热点 key 都要能看。

## 写 Redis 笔记时关注什么

不要只背命令，要落到工程问题：

- 数据结构怎么选。
- key 和 TTL 怎么设计。
- 缓存穿透、击穿、雪崩怎么处理。
- Java 里 `StringRedisTemplate` / `RedisTemplate` 怎么封装。
- 分布式锁什么时候能用，什么时候不要用。
- Redis 与 MySQL 的一致性边界在哪里。

## 参考

- [Redis data types](https://redis.io/docs/latest/develop/data-types/)
- [Redis keys and expiration](https://redis.io/docs/latest/develop/using-commands/keyspace/)
