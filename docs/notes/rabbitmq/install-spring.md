---
title: RabbitMQ 安装配置与 Spring Boot 集成
sidebarTitle: 安装与 Spring 集成
---

# RabbitMQ 安装配置与 Spring Boot 集成

> 这一篇按工程落地流程写：先把 RabbitMQ 跑起来，再让 Spring Boot 能声明拓扑、发送消息、消费消息、处理失败。

## 本地安装

用 Docker Compose：

```yaml
services:
  rabbitmq:
    image: rabbitmq:4-management
    container_name: flashmart-rabbitmq
    hostname: flashmart-rabbitmq
    ports:
      - "5672:5672"
      - "15672:15672"
    environment:
      RABBITMQ_DEFAULT_USER: flashmart
      RABBITMQ_DEFAULT_PASS: flashmart123
      RABBITMQ_DEFAULT_VHOST: flashmart
    volumes:
      - rabbitmq-data:/var/lib/rabbitmq
    restart: unless-stopped

volumes:
  rabbitmq-data:
```

启动：

```bash
docker compose up -d
```

查看：

```bash
docker compose ps
docker compose logs -f rabbitmq
```

管理台：

```text
http://localhost:15672
```

账号：

```text
flashmart / flashmart123
```

端口别记错：

| 端口 | 用途 |
| --- | --- |
| `5672` | AMQP，Spring Boot 连这个 |
| `15672` | 管理台，不是业务连接端口 |

## vhost、用户、权限

`vhost` 是 RabbitMQ 的逻辑隔离空间。开发、测试、生产建议拆开。

如果没有用环境变量创建，可以手动执行：

```bash
docker exec -it flashmart-rabbitmq rabbitmqctl add_vhost flashmart
docker exec -it flashmart-rabbitmq rabbitmqctl add_user flashmart flashmart123
docker exec -it flashmart-rabbitmq rabbitmqctl set_permissions -p flashmart flashmart ".*" ".*" ".*"
```

查看：

```bash
docker exec -it flashmart-rabbitmq rabbitmqctl list_vhosts
docker exec -it flashmart-rabbitmq rabbitmqctl list_users
docker exec -it flashmart-rabbitmq rabbitmqctl list_permissions -p flashmart
```

注意：

- 生产不要用 `guest/guest`。
- 生产不要所有应用共用 `/` vhost。
- 密码不要提交到 Git。
- 管理台不要暴露公网。

## Spring Boot 依赖

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-amqp</artifactId>
</dependency>
```

Web 项目通常已经有 Jackson；如果是纯 AMQP 项目，按需补 JSON 依赖。

## 连接配置

`application.yml`：

```yaml
spring:
  rabbitmq:
    host: localhost
    port: 5672
    username: flashmart
    password: flashmart123
    virtual-host: flashmart
    publisher-confirm-type: correlated
    publisher-returns: true
    template:
      mandatory: true
    listener:
      simple:
        acknowledge-mode: manual
        prefetch: 10
        concurrency: 2
        max-concurrency: 8
        retry:
          enabled: false
```

关键配置：

| 配置 | 作用 |
| --- | --- |
| `publisher-confirm-type: correlated` | Broker 收到 exchange 后回调确认 |
| `publisher-returns: true` | 路由不到队列时返回消息 |
| `template.mandatory: true` | 开启不可路由消息返回 |
| `acknowledge-mode: manual` | 消费端手动 ack/nack |
| `prefetch: 10` | 单个消费者最多预取 10 条未确认消息 |
| `retry.enabled: false` | 不让框架自动重试，先用 DLQ 兜失败 |

为什么先关自动重试：

- 自动重试容易和手动 ack 混在一起。
- 新手很难判断消息到底重试了几次。
- 先让失败消息进入 DLQ，更容易排查。
- 后面要做重试队列时，再单独设计。

## 命名常量

先把 exchange、queue、routing key 收口：

```java
public final class RabbitNames {

    public static final String ORDER_EVENT_EXCHANGE = "flashmart.order.event.exchange";
    public static final String ORDER_DLX_EXCHANGE = "flashmart.order.dlx.exchange";

    public static final String ORDER_CREATED_QUEUE = "flashmart.order.created.queue";
    public static final String ORDER_CREATED_DLQ = "flashmart.order.created.dlq";

    public static final String ORDER_CREATED_ROUTING_KEY = "order.created";
    public static final String ORDER_CREATED_FAILED_ROUTING_KEY = "order.created.failed";

    private RabbitNames() {
    }
}
```

不要在业务代码里到处写字符串。

## 声明拓扑

这一段负责把 RabbitMQ 里的结构声明出来：

```text
order.event.exchange
  -- order.created -->
flashmart.order.created.queue
  -- failed -->
flashmart.order.created.dlq
```

Spring 配置：

```java
@Configuration
public class RabbitTopologyConfig {

    @Bean
    public DirectExchange orderEventExchange() {
        return ExchangeBuilder
            .directExchange(RabbitNames.ORDER_EVENT_EXCHANGE)
            .durable(true)
            .build();
    }

    @Bean
    public DirectExchange orderDlxExchange() {
        return ExchangeBuilder
            .directExchange(RabbitNames.ORDER_DLX_EXCHANGE)
            .durable(true)
            .build();
    }

    @Bean
    public Queue orderCreatedQueue() {
        return QueueBuilder
            .durable(RabbitNames.ORDER_CREATED_QUEUE)
            .deadLetterExchange(RabbitNames.ORDER_DLX_EXCHANGE)
            .deadLetterRoutingKey(RabbitNames.ORDER_CREATED_FAILED_ROUTING_KEY)
            .build();
    }

    @Bean
    public Queue orderCreatedDlq() {
        return QueueBuilder
            .durable(RabbitNames.ORDER_CREATED_DLQ)
            .build();
    }

    @Bean
    public Binding orderCreatedBinding(Queue orderCreatedQueue,
                                       DirectExchange orderEventExchange) {
        return BindingBuilder
            .bind(orderCreatedQueue)
            .to(orderEventExchange)
            .with(RabbitNames.ORDER_CREATED_ROUTING_KEY);
    }

    @Bean
    public Binding orderCreatedDlqBinding(Queue orderCreatedDlq,
                                          DirectExchange orderDlxExchange) {
        return BindingBuilder
            .bind(orderCreatedDlq)
            .to(orderDlxExchange)
            .with(RabbitNames.ORDER_CREATED_FAILED_ROUTING_KEY);
    }
}
```

常用 import：

```java
import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.DirectExchange;
import org.springframework.amqp.core.ExchangeBuilder;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
```

注意：

- 业务队列和死信队列都要 durable。
- 主队列配置 DLX，失败才有地方去。
- 不建议在管理台手工建一套，代码里又建一套。
- 队列参数一旦变更，已有队列可能需要删除重建，开发环境尤其常见。

## JSON 消息转换器

Spring Boot 4 / Spring AMQP 4：

```java
@Configuration
public class RabbitMessageConfig {

    @Bean
    public MessageConverter messageConverter(JsonMapper jsonMapper) {
        return new JacksonJsonMessageConverter(jsonMapper, "org.example.flashmart");
    }
}
```

常用 import：

```java
import org.springframework.amqp.support.converter.JacksonJsonMessageConverter;
import org.springframework.amqp.support.converter.MessageConverter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import tools.jackson.databind.json.JsonMapper;
```

Spring Boot 3 / Spring AMQP 3：

```java
@Bean
public MessageConverter messageConverter(ObjectMapper objectMapper) {
    return new Jackson2JsonMessageConverter(objectMapper);
}
```

常用 import：

```java
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.amqp.support.converter.Jackson2JsonMessageConverter;
import org.springframework.amqp.support.converter.MessageConverter;
```

注意：

- Boot 4 对应 Jackson 3，常见类名没有 `2`。
- Boot 3 对应 Jackson 2，常见类名带 `2`。
- 生产者和消费者要使用一致的消息转换器。
- 消息 DTO 不要直接用 Entity。

## Listener 容器配置

如果 `application.yml` 足够，可以不写这个配置。

需要明确 message converter、手动 ack、prefetch、并发时可以写：

```java
@Configuration
public class RabbitListenerConfig {

    @Bean
    public SimpleRabbitListenerContainerFactory rabbitListenerContainerFactory(
            SimpleRabbitListenerContainerFactoryConfigurer configurer,
            ConnectionFactory connectionFactory,
            MessageConverter messageConverter) {
        SimpleRabbitListenerContainerFactory factory = new SimpleRabbitListenerContainerFactory();
        configurer.configure(factory, connectionFactory);
        factory.setMessageConverter(messageConverter);
        factory.setAcknowledgeMode(AcknowledgeMode.MANUAL);
        factory.setPrefetchCount(10);
        factory.setConcurrentConsumers(2);
        factory.setMaxConcurrentConsumers(8);
        return factory;
    }
}
```

常用 import：

```java
import org.springframework.amqp.core.AcknowledgeMode;
import org.springframework.amqp.rabbit.config.SimpleRabbitListenerContainerFactory;
import org.springframework.amqp.rabbit.connection.ConnectionFactory;
import org.springframework.amqp.support.converter.MessageConverter;
import org.springframework.boot.autoconfigure.amqp.SimpleRabbitListenerContainerFactoryConfigurer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
```

并发不要乱调：

- 消费慢但 DB 扛得住：可以加并发。
- DB 已经慢：加并发只会更糟。
- 需要顺序：不要多消费者并发抢。
- 外部接口慢：先加超时、限流、熔断。

## 发送消息

事件对象：

```java
public record OrderCreatedEvent(
    Long orderId,
    Long userId,
    BigDecimal amount,
    LocalDateTime occurredAt
) {
}
```

生产者：

```java
@Service
public class OrderEventPublisher {

    private final RabbitTemplate rabbitTemplate;

    public OrderEventPublisher(RabbitTemplate rabbitTemplate) {
        this.rabbitTemplate = rabbitTemplate;
    }

    public void publishOrderCreated(OrderCreatedEvent event) {
        String messageId = UUID.randomUUID().toString();
        CorrelationData correlationData = new CorrelationData(messageId);

        rabbitTemplate.convertAndSend(
            RabbitNames.ORDER_EVENT_EXCHANGE,
            RabbitNames.ORDER_CREATED_ROUTING_KEY,
            event,
            message -> {
                MessageProperties properties = message.getMessageProperties();
                properties.setMessageId(messageId);
                properties.setHeader("eventType", "ORDER_CREATED");
                properties.setHeader("aggregateId", event.orderId().toString());
                return message;
            },
            correlationData
        );
    }
}
```

常用 import：

```java
import org.springframework.amqp.core.MessageProperties;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Service;
```

注意：

- `messageId` 用来排查、幂等、日志关联。
- `CorrelationData` 用来做 publisher confirm。
- routing key 不要散落硬编码。
- 消息 DTO 字段要稳定。

## 生产者确认和路由失败

配置：

```java
@Configuration
public class RabbitTemplateConfig {

    @Bean
    public RabbitTemplate rabbitTemplate(ConnectionFactory connectionFactory,
                                         MessageConverter messageConverter) {
        RabbitTemplate template = new RabbitTemplate(connectionFactory);
        template.setMessageConverter(messageConverter);
        template.setMandatory(true);

        template.setConfirmCallback((correlationData, ack, cause) -> {
            String messageId = correlationData == null ? null : correlationData.getId();
            if (ack) {
                log.info("rabbit confirm success, messageId={}", messageId);
                return;
            }
            log.warn("rabbit confirm failed, messageId={}, cause={}", messageId, cause);
        });

        template.setReturnsCallback(returned -> log.warn(
            "rabbit returned, exchange={}, routingKey={}, replyCode={}, replyText={}",
            returned.getExchange(),
            returned.getRoutingKey(),
            returned.getReplyCode(),
            returned.getReplyText()
        ));

        return template;
    }
}
```

两个回调的区别：

| 回调 | 说明 |
| --- | --- |
| confirm | Broker 是否收到并处理到 exchange |
| returns | 消息到了 exchange，但没有路由到 queue |

重要：

- confirm 成功不代表消费者处理成功。
- returns 触发通常说明 exchange、routing key、binding 配错。
- 真正可靠投递还要配合 outbox 或补偿任务。

## 事务后发送消息

不要在数据库事务没提交时就让消费者看见消息。

更稳的做法：

```java
@Transactional(rollbackFor = Exception.class)
public Long createOrder(CreateOrderCommand command) {
    Long orderId = orderRepository.create(command);

    TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
        @Override
        public void afterCommit() {
            orderEventPublisher.publishOrderCreated(new OrderCreatedEvent(
                orderId,
                command.userId(),
                command.amount(),
                LocalDateTime.now()
            ));
        }
    });

    return orderId;
}
```

更可靠的生产方案是 outbox：

```text
1. 业务事务内写订单
2. 同一个事务内写 outbox_event 表
3. 定时任务 / CDC 扫描 outbox_event
4. 发送 RabbitMQ
5. confirm 成功后标记已发送
6. 失败继续重试
```

这块后面可以单独成一篇可靠投递笔记。

## 消费消息

消费者：

```java
@Component
public class OrderCreatedListener {

    @RabbitListener(queues = RabbitNames.ORDER_CREATED_QUEUE)
    public void handle(OrderCreatedEvent event,
                       Message message,
                       Channel channel) throws IOException {
        long deliveryTag = message.getMessageProperties().getDeliveryTag();
        String messageId = message.getMessageProperties().getMessageId();

        try {
            orderCreatedConsumerService.handle(event, messageId);
            channel.basicAck(deliveryTag, false);
        } catch (DuplicateMessageException exception) {
            log.info("duplicate message ignored, messageId={}", messageId);
            channel.basicAck(deliveryTag, false);
        } catch (Exception exception) {
            log.error("consume order created failed, messageId={}", messageId, exception);
            channel.basicNack(deliveryTag, false, false);
        }
    }
}
```

常用 import：

```java
import com.rabbitmq.client.Channel;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;
```

这里的处理策略：

| 情况 | 动作 |
| --- | --- |
| 业务成功 | `basicAck` |
| 重复消息 | `basicAck` |
| 业务失败 | `basicNack(requeue=false)`，进 DLQ |

不要默认：

```java
channel.basicNack(deliveryTag, false, true);
```

如果错误一直存在，它会无限重新入队。

## 消费幂等

RabbitMQ 可能重复投递，消费端必须幂等。

一种做法是消费日志表：

```sql
create table mq_consume_log (
    id bigint primary key,
    message_id varchar(64) not null,
    consumer_name varchar(128) not null,
    status tinyint not null,
    create_time datetime not null,
    update_time datetime not null,
    unique key uk_message_consumer(message_id, consumer_name)
);
```

业务处理：

```java
@Service
public class OrderCreatedConsumerService {

    @Transactional(rollbackFor = Exception.class)
    public void handle(OrderCreatedEvent event, String messageId) {
        boolean firstConsume = consumeLogRepository.tryStart(
            messageId,
            "orderCreatedListener"
        );
        if (!firstConsume) {
            throw new DuplicateMessageException(messageId);
        }

        couponService.issueCoupon(event.userId(), event.orderId());
        consumeLogRepository.markSuccess(messageId, "orderCreatedListener");
    }
}
```

也可以用业务唯一约束兜底：

```sql
create unique index uk_coupon_order on user_coupon(order_id, coupon_type);
```

优先级：

```text
数据库唯一约束 > 消费日志表 > Redis 短期去重
```

Redis 去重可以做辅助，但不要单独承担核心幂等。

## 死信队列

主队列配置了：

```text
x-dead-letter-exchange = flashmart.order.dlx.exchange
x-dead-letter-routing-key = order.created.failed
```

消费者失败时：

```java
channel.basicNack(deliveryTag, false, false);
```

消息会进入：

```text
flashmart.order.created.dlq
```

死信队列要用来排查和补偿：

- 看失败消息体。
- 看 messageId。
- 看失败日志。
- 修复业务后手动重放。
- 或由补偿任务按规则重试。

不要只建 DLQ 不处理。那只是把问题换了个地方堆积。

## 本地验证

启动 RabbitMQ：

```bash
docker compose up -d
```

确认 broker：

```bash
docker exec -it flashmart-rabbitmq rabbitmq-diagnostics status
```

确认队列：

```bash
docker exec -it flashmart-rabbitmq rabbitmqctl list_queues -p flashmart name messages consumers
```

启动 Spring Boot 后，打开管理台：

```text
http://localhost:15672
```

检查：

- Exchanges 是否有 `flashmart.order.event.exchange`。
- Queues 是否有 `flashmart.order.created.queue`。
- Bindings 是否连接正确。
- Consumers 是否大于 0。
- Ready 是否堆积。
- Unacked 是否一直不降。

## 常见问题

### 应用连不上

先查：

- 连接端口是不是 `5672`。
- 管理台端口 `15672` 不能给 Spring Boot 用。
- vhost 是否写对。
- 用户是否有 vhost 权限。
- Docker 容器是否运行。

### 消息发了但队列没有

重点查：

- exchange 名称。
- routing key。
- binding。
- `mandatory` 是否开启。
- returns callback 是否打印日志。

### 消费者一直重复消费

常见原因：

- 失败后 `requeue=true`。
- 业务代码一直抛异常。
- 没有 DLQ。
- 自动重试和手动 ack 混乱。

先改成失败进 DLQ，把现场留下来。

### Unacked 很高

说明消费者拿了消息但没确认。

可能是：

- 忘记 ack。
- 业务卡住。
- 消费线程池满。
- prefetch 太大。
- 下游接口超时。

### JSON 转换失败

检查：

- 生产者和消费者 converter 是否一致。
- DTO 包名是否可信。
- Boot 4/3 的 converter 是否用错。
- 字段类型是否改过。
- 是否直接发了 Entity。

## 落地检查清单

- [ ] 本地 RabbitMQ 能启动。
- [ ] 管理台 `15672` 能访问。
- [ ] Spring Boot 连接 `5672`。
- [ ] vhost、用户、权限正确。
- [ ] exchange、queue、binding 用代码声明。
- [ ] 主队列配置 DLX。
- [ ] 死信队列能看到失败消息。
- [ ] producer confirm 开启。
- [ ] returns callback 开启。
- [ ] 消息带 `messageId`。
- [ ] 消费端手动 ack。
- [ ] 失败不会无限 requeue。
- [ ] 消费端有幂等。
- [ ] DTO 不直接用 Entity。
- [ ] 管理台不暴露公网。

## 参考

- [RabbitMQ Installing RabbitMQ](https://www.rabbitmq.com/docs/download)
- [RabbitMQ Management Plugin](https://www.rabbitmq.com/docs/management)
- [RabbitMQ Access Control](https://www.rabbitmq.com/docs/access-control)
- [RabbitMQ Publisher Confirms](https://www.rabbitmq.com/docs/confirms)
- [Spring AMQP RabbitTemplate](https://docs.spring.io/spring-amqp/reference/amqp/template.html)
- [Spring AMQP Message Converters](https://docs.spring.io/spring-amqp/reference/amqp/message-converters.html)
- [Spring AMQP Listener Concurrency](https://docs.spring.io/spring-amqp/reference/amqp/listener-concurrency.html)
