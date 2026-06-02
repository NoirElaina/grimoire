---
title: RabbitMQ 总览
sidebarTitle: 专题首页
---

# RabbitMQ 总览

这一组内容专门沉淀 RabbitMQ 的使用和设计，不再混在 `Java 后端` 的平铺笔记里。

RabbitMQ 相关内容一旦开始写深，通常很快就会分出几条线：

- 消息模型：交换机、队列、绑定、路由键
- Spring Boot 集成：生产者、消费者、配置和序列化
- 可靠性设计：确认、重试、死信、延迟、补偿
- 消费端设计：并发、限流、顺序、幂等
- 排障与监控：堆积、丢消息、重复消费、性能抖动

所以它更适合单独做成一个专题，而不是继续挂在 `Java 后端` 下面。

## 起步笔记

- [RabbitMQ 消息模型与核心概念](/notes/rabbitmq/message-model)
- [RabbitMQ 安装配置与 Spring Boot 集成](/notes/rabbitmq/install-spring)

## 后面可以继续补

- 生产者确认与投递可靠性
- 消费者确认、重试与死信
- 延迟消息设计
- 幂等与顺序性处理
- 高并发消费与限流
- 线上排障与监控指标
