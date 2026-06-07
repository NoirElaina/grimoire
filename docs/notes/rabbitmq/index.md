---
title: RabbitMQ 总览
sidebarTitle: 专题首页
---

# RabbitMQ 总览

> RabbitMQ 这组笔记按一条线读：先弄懂消息怎么流，再学本地安装和 Spring Boot 集成。

## 内容入口

| 分组 | 笔记 | 重点 |
| --- | --- | --- |
| 基础 | [RabbitMQ 消息模型与核心概念](/notes/rabbitmq/message-model) | exchange、queue、binding、routing key |
| 接入 | [RabbitMQ 安装配置与 Spring Boot 集成](/notes/rabbitmq/install-spring) | Docker、Spring AMQP、声明队列和消费 |
| 事务 | [Spring 事务同步与 MQ](/notes/rabbitmq/transaction-after-commit) | afterCommit、事务事件、外部副作用 |
| 确认 | [RabbitMQ ACK 确认机制](/notes/rabbitmq/ack-confirm-mechanism) | consumer ack、publisher confirm、nack、prefetch |
| 延迟 | [RabbitMQ 延迟队列](/notes/rabbitmq/delay-queue) | TTL、DLX、订单超时关闭 |
| 延迟 | [RabbitMQ 延迟消息插件](/notes/rabbitmq/delayed-message-plugin) | `x-delayed-message`、`x-delay`、选型边界 |
| 兜底 | [RabbitMQ 死信队列](/notes/rabbitmq/dead-letter-queue) | 消费失败、消息过期、队列溢出 |
| 幂等 | [MQ 消费幂等](/notes/rabbitmq/message-idempotency) | eventId、唯一约束、消费日志、状态机 |
| 可靠性 | [MQ 可靠性总览](/notes/rabbitmq/reliability-overview) | 生产者、Broker、消费者三段可靠性 |
| 可靠性 | [RabbitMQ 生产者可靠性](/notes/rabbitmq/producer-reliability) | outbox、confirm、return、重试 |
| 可靠性 | [RabbitMQ 消费者可靠性](/notes/rabbitmq/consumer-reliability) | manual ack、重试、死信、监控 |
| 案例 | [项目里的 MQ 用法](/notes/rabbitmq/project-mq-usage) | 订单事件、超时关闭、幂等、outbox |

## 这组笔记先解决什么

| 笔记 | 解决的问题 |
| --- | --- |
| 消息模型 | exchange、queue、binding、routing key、ack、prefetch 到底是什么 |
| 安装与集成 | Docker 怎么起 RabbitMQ，Spring Boot 怎么声明队列、发送、消费、确认 |
| 事务同步与 MQ | Spring 事务回调、事务事件、事务后副作用，以及 MQ 发送边界 |
| ACK 确认机制 | consumer ack、publisher confirm、manual ack、nack、prefetch 怎么配合 |
| 延迟队列 | `x-message-ttl`、DLX、订单超时取消这类延迟消息怎么做 |
| 死信队列 | 消费失败、消息过期、队列溢出后，DLX/DLQ 怎么兜底 |
| MQ 幂等 | 重复消息为什么出现，消费端怎么用唯一约束、消费日志、状态机兜住 |
| 延迟消息插件 | `x-delayed-message`、`x-delay` 怎么用，以及为什么生产选型要谨慎 |
| MQ 可靠性 | 从生产者、Broker、消费者三段看消息为什么会丢、为什么会重复、怎么兜 |
| 生产者可靠性 | `afterCommit`、outbox、publisher confirm、mandatory return 怎么落地 |
| 消费者可靠性 | manual ack、prefetch、重试、死信、幂等和监控怎么配合 |
| 项目用法 | 用订单创建、超时关闭、幂等、outbox 串起项目里的 RabbitMQ 用法 |

## 先记住主线

RabbitMQ 不是“把消息发给队列”这么简单。

真正流程是：

```text
Producer
  -> Exchange
  -> Binding + Routing Key
  -> Queue
  -> Consumer
  -> ack / nack
```

工程里最容易出问题的不是“不会发消息”，而是：

- 消息没有路由到队列。
- 消费失败后无限重新入队。
- 消费者处理成功但没 ack。
- 消息重复投递但业务没幂等。
- 队列堆积后不知道看哪个指标。

## 排障优先看什么

- 消息没到消费者：先查 exchange、routing key、binding、queue。
- 消息重复：先查 publisher confirm 重试、consumer ack 时机、消费幂等。
- 消息堆积：先查 ready、unacked、prefetch、消费者耗时。
- 消费失败：先查重试策略、死信队列、异常日志和幂等状态。
