---
title: Redis 总览
sidebarTitle: 专题首页
---

# Redis 总览

> Redis 专题只记后端项目真正会踩的点：key、TTL、数据结构、缓存异常、一致性、分布式锁、Redisson、Spring Boot 接入。

## 阅读顺序

| 顺序 | 笔记 | 解决的问题 |
| --- | --- | --- |
| 00 | [Redis 缓存设计总览](/notes/redis/cache-design) | 先建立工程边界：Redis 能做什么、不能做什么 |
| 01 | [Redis 入门与基础模型](/notes/redis/redis-basics) | 搞清内存模型、TTL、持久化、淘汰、连接池 |
| 02 | [Redis 数据结构实战](/notes/redis/data-structures) | String、Hash、List、Set、ZSet、Bitmap、HLL、Stream 怎么选 |
| 03 | [Redis 缓存异常治理](/notes/redis/cache-problems) | 穿透、击穿、雪崩、大 key、热点 key 怎么处理 |
| 04 | [Redis 与 MySQL 缓存一致性](/notes/redis/cache-consistency) | 写库、删缓存、事务提交后删除、失败重试怎么设计 |
| 05 | [Redis 分布式锁](/notes/redis/distributed-lock) | `SET NX PX`、唯一值、Lua 释放、锁失效场景 |
| 06 | [Redisson 使用笔记](/notes/redis/redisson) | Spring Boot 里怎么用 `RLock`，看门狗和租约怎么理解 |
| 07 | [RedisTemplate JSON 序列化配置](/notes/redis/redis-template-json) | key/value 序列化、Spring Data Redis 4 迁移问题 |

## 先定边界

Redis 在业务系统里通常是 **高性能辅助层**，不是最终事实来源。

| 场景 | 能不能用 Redis | 注意点 |
| --- | --- | --- |
| 缓存商品、用户、配置 | 可以 | MySQL 仍是准数据源 |
| 登录态、验证码、幂等 key | 可以 | TTL、吊销、续期必须明确 |
| 计数器、限流 | 可以 | 注意窗口、过期、原子性 |
| 排行榜 | 很适合 | `ZSet` 天然匹配 |
| 分布式锁 | 能用但要克制 | 必须有过期、唯一值、安全释放 |
| 可靠消息队列 | 不优先 | 重试、死信、堆积治理更适合 MQ |
| 核心库存最终扣减 | 不建议只靠 Redis | DB/MQ/对账必须兜底 |

## 项目里先统一这些

- key 命名：`系统:模块:对象:标识`，不要让业务代码到处手写。
- TTL 策略：所有缓存 key 都要明确是否过期，热点 key 要有抖动或逻辑过期。
- 序列化：不要混用 JDK 序列化、JSON 字符串、Hash 对象。
- 一致性：写数据库成功后删缓存，复杂场景用 afterCommit、重试、outbox。
- 降级：Redis 挂了时，核心接口怎么走，哪些接口直接返回降级结果。
- 观测：缓存命中率、慢命令、大 key、热点 key、连接数都要能看。

## 写 Redis 笔记时关注什么

不要只背命令，要落到工程问题：

- 这个数据为什么要进 Redis。
- Redis 挂了业务怎么处理。
- key 多大、value 多大、集合会不会无限增长。
- TTL 是业务过期还是缓存过期。
- 写 MySQL 后缓存怎么失效。
- 并发回源会不会打穿数据库。
- 锁失败、锁超时、锁误删怎么办。

## 参考

- [Redis data types](https://redis.io/docs/latest/develop/data-types/)
- [Redis EXPIRE](https://redis.io/docs/latest/commands/expire/)
- [Redis SET](https://redis.io/docs/latest/commands/set/)
- [Redis distributed locks](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/)
- [Spring Data Redis RedisTemplate](https://docs.spring.io/spring-data/redis/reference/redis/template.html)
- [Redisson locks and synchronizers](https://redisson.pro/docs/data-and-services/locks-and-synchronizers/index.html)
