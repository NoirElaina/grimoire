---
title: RabbitMQ 安装配置与 Spring Boot 集成
sidebarTitle: 02 安装与 Spring 集成
---

# RabbitMQ 安装配置与 Spring Boot 集成

> 这篇只记工程落地：本地怎么装、端口怎么配、用户和 vhost 怎么建、Spring Boot 怎么发消息和消费消息。

## 先给结论

普通 Java 后端项目里，RabbitMQ 起步按这个顺序做：

1. 本地用 Docker Compose 启动 RabbitMQ 管理版镜像。
2. 新建业务专用 `vhost`、用户、权限，不要用生产 `guest`。
3. Spring Boot 引入 `spring-boot-starter-amqp`。
4. 用配置文件管理连接、确认、返回、消费并发、手动确认。
5. 用 Bean 声明 `Exchange`、`Queue`、`Binding`。
6. 生产者用 `RabbitTemplate`，发送时带 `messageId`。
7. 消费者用 `@RabbitListener`，业务成功后 `ack`，失败按规则进入重试或死信。

别一开始就只写：

```java
rabbitTemplate.convertAndSend("queue", message);
```

先把交换机、路由键、队列、确认、死信都设计清楚。

## 本地 Docker Compose 安装

新建 `docker-compose.yml`：

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

查看日志：

```bash
docker compose logs -f rabbitmq
```

访问管理页面：

```text
http://localhost:15672
```

登录：

```text
username: flashmart
password: flashmart123
```

端口记住两个：

| 端口 | 用途 |
| --- | --- |
| `5672` | AMQP 客户端连接端口，Spring Boot 连接这里 |
| `15672` | Management UI / HTTP API |

官方也提供一行 Docker 命令：

```bash
docker run -it --rm --name rabbitmq \
  -p 5672:5672 \
  -p 15672:15672 \
  rabbitmq:4-management
```

但项目里更推荐 Compose，配置更清楚，也方便保留数据卷。

## 用户、vhost、权限

RabbitMQ 里的 `vhost` 可以理解成“逻辑隔离空间”。不同项目、不同环境最好拆开：

```text
flashmart-dev
flashmart-test
flashmart-prod
```

如果不是通过环境变量创建，也可以进容器手动建：

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

- 生产不要用默认 `guest/guest`。
- 官方默认 `guest` 用户只适合本机访问，远程连接会受限制。
- 生产用户名和密码走环境变量、配置中心或密钥系统。
- vhost 权限要按应用隔离，不要所有应用都连 `/`。

## 基础配置文件

Spring Boot 配置：

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

这些配置的意思：

| 配置 | 作用 |
| --- | --- |
| `publisher-confirm-type: correlated` | 开启生产者确认，知道消息有没有到达 exchange |
| `publisher-returns: true` | 开启路由失败返回 |
| `template.mandatory: true` | 消息路由不到队列时触发 returns |
| `acknowledge-mode: manual` | 消费端手动确认 |
| `prefetch: 10` | 单个消费者最多预取 10 条未确认消息 |
| `concurrency` | 初始消费者线程数 |
| `max-concurrency` | 最大消费者线程数 |
| `retry.enabled: false` | 先别让框架自动无限重试，业务自己设计重试和死信 |

生产环境注意：

- `host` 最好用内网地址或服务发现名。
- 管理端口 `15672` 不要暴露公网。
- 密码不要写进 Git。
- 不同环境使用不同 vhost。

## Maven 依赖

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-amqp</artifactId>
</dependency>
```

如果消息体用 JSON，通常还需要 Jackson。Web 项目一般已经有；非 Web 项目按需引入 JSON 依赖。

## 命名约定

先统一名字，不然后面排查会非常乱：

```java
public final class RabbitNames {

    public static final String ORDER_EVENT_EXCHANGE = "flashmart.order.event.exchange";
    public static final String ORDER_DLX_EXCHANGE = "flashmart.order.dlx.exchange";

    public static final String ORDER_CREATED_QUEUE = "flashmart.order.created.queue";
    public static final String ORDER_CREATED_DLQ = "flashmart.order.created.dlq";

    public static final String ORDER_CREATED_ROUTING_KEY = "order.created";
    public static final String ORDER_CREATED_DLQ_ROUTING_KEY = "order.created.dlq";

    private RabbitNames() {
    }
}
```

建议：

- exchange：`系统.模块.类型.exchange`。
- queue：`系统.模块.事件.queue`。
- dead queue：`系统.模块.事件.dlq`。
- routing key：`业务.事件`。

## 声明交换机、队列、绑定

```java
@Configuration
public class RabbitMqTopologyConfig {

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
            .deadLetterRoutingKey(RabbitNames.ORDER_CREATED_DLQ_ROUTING_KEY)
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
            .with(RabbitNames.ORDER_CREATED_DLQ_ROUTING_KEY);
    }
}
```

注意：

- exchange、queue 都建议 durable。
- 消费失败不要默认一直 requeue，容易死循环。
- 死信队列一开始就建，别等线上失败后才补。
- 这些 Bean 会由 Spring AMQP 管理并声明到 RabbitMQ。

## JSON 消息转换器

Spring Boot 4 / Spring AMQP 4 用 `JacksonJsonMessageConverter`：

```java
@Configuration
public class RabbitMqMessageConfig {

    @Bean
    public MessageConverter jacksonMessageConverter(JsonMapper jsonMapper) {
        return new JacksonJsonMessageConverter(jsonMapper, "org.example.flashmart");
    }
}
```

常用 import：

```java
import org.springframework.amqp.support.converter.JacksonJsonMessageConverter;
import org.springframework.amqp.support.converter.MessageConverter;
import tools.jackson.databind.json.JsonMapper;
```

Spring Boot 3 / Spring AMQP 3 常见写法：

```java
@Bean
public MessageConverter jacksonMessageConverter(ObjectMapper objectMapper) {
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

- Boot 4 是 Jackson 3，类名没有 `2`。
- Boot 3 是 Jackson 2，常见类名带 `2`。
- 生产者和消费者的消息转换器要一致。
- 不同服务之间传消息，更推荐用稳定 DTO，不要直接传 Entity。

## Listener 容器配置

如果只靠 `application.yml` 够用，可以不写工厂。

如果要明确 JSON 转换器、手动确认、并发参数，可以写：

```java
@Configuration
public class RabbitMqListenerConfig {

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
```

消费者并发不是越大越好：

- DB 压力扛不住时，并发越高越容易雪崩。
- 外部接口慢时，并发越高越容易堆线程。
- 顺序消息不能随便开高并发。
- `prefetch` 太大时，单个消费者会囤很多未确认消息。

## 生产者发送消息

事件 DTO：

```java
public record OrderCreatedEvent(
    Long orderId,
    Long userId,
    BigDecimal amount,
    LocalDateTime occurredAt
) {
}
```

发送：

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

注意：

- `messageId` 用于日志、幂等、排查。
- routing key 不要硬编码散落在业务代码里。
- DTO 字段要稳定，不要直接发数据库 Entity。
- 发送消息最好和本地事务配合 outbox，不要事务没提交就让消费者处理。

## 生产者确认和返回

配置了：

```yaml
spring:
  rabbitmq:
    publisher-confirm-type: correlated
    publisher-returns: true
    template:
      mandatory: true
```

再配置回调：

```java
@Configuration
public class RabbitMqTemplateConfig {

    @Bean
    public RabbitTemplate rabbitTemplate(ConnectionFactory connectionFactory,
                                         MessageConverter messageConverter) {
        RabbitTemplate template = new RabbitTemplate(connectionFactory);
        template.setMessageConverter(messageConverter);
        template.setMandatory(true);

        template.setConfirmCallback((correlationData, ack, cause) -> {
            String messageId = correlationData == null ? null : correlationData.getId();
            if (ack) {
                log.info("rabbit message confirmed, messageId={}", messageId);
                return;
            }
            log.warn("rabbit message confirm failed, messageId={}, cause={}", messageId, cause);
        });

        template.setReturnsCallback(returned -> log.warn(
            "rabbit message returned, exchange={}, routingKey={}, replyCode={}, replyText={}",
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
| confirm | 消息有没有到达 exchange |
| returns | 消息到了 exchange，但没有路由到 queue |

重要：confirm 成功不代表消费者已经处理成功，只代表 broker 接收到了。

## 消费者接收消息

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
            log.info("consume order created, messageId={}, orderId={}",
                messageId,
                event.orderId()
            );

            handleBusiness(event, messageId);

            channel.basicAck(deliveryTag, false);
        } catch (DuplicateMessageException exception) {
            log.info("duplicate message ignored, messageId={}", messageId);
            channel.basicAck(deliveryTag, false);
        } catch (Exception exception) {
            log.error("consume order created failed, messageId={}", messageId, exception);
            channel.basicNack(deliveryTag, false, false);
        }
    }

    private void handleBusiness(OrderCreatedEvent event, String messageId) {
        // 业务处理：发优惠券、创建物流任务、发送通知等
    }
}
```

常用 import：

```java
import com.rabbitmq.client.Channel;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
```

`basicNack(deliveryTag, false, false)` 的最后一个 `false` 表示不重新入队；如果队列配置了死信，就会进入 DLQ。

不要随便写 `true`：

```java
channel.basicNack(deliveryTag, false, true);
```

这会让失败消息重新回队列，处理逻辑没修好时容易无限循环。

## 消费幂等

RabbitMQ 消息可能重复投递。消费端必须幂等。

常见做法：

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

消费时：

```java
@Transactional(rollbackFor = Exception.class)
public void handleBusiness(OrderCreatedEvent event, String messageId) {
    boolean firstConsume = consumeLogRepository.tryStart(messageId, "orderCreatedListener");
    if (!firstConsume) {
        throw new DuplicateMessageException(messageId);
    }

    couponService.issueNewUserCoupon(event.userId());
    consumeLogRepository.markSuccess(messageId, "orderCreatedListener");
}
```

也可以用业务唯一键兜：

```sql
create unique index uk_coupon_order on user_coupon(order_id, coupon_type);
```

原则：

- 消息重复不是异常，是 MQ 使用前提。
- 幂等优先用数据库唯一约束兜底。
- 只靠 Redis 去重，要考虑过期和丢失。

## 死信队列怎么用

消息进入死信常见原因：

- 消费者 `nack` 且不重新入队。
- 消息过期。
- 队列达到长度限制。

死信队列用途：

- 保存失败消息。
- 后台人工查看。
- 定时补偿重试。
- 排查失败原因。

不要让死信队列只是“失败垃圾桶”。至少要有：

- 失败原因日志。
- messageId。
- 原始 exchange / routingKey。
- 重试次数。
- 人工重放入口或脚本。

查看死信：

```bash
docker exec -it flashmart-rabbitmq rabbitmqctl list_queues -p flashmart name messages consumers
```

## 本地验证流程

启动 RabbitMQ：

```bash
docker compose up -d
```

确认 broker 状态：

```bash
docker exec -it flashmart-rabbitmq rabbitmq-diagnostics status
```

确认队列：

```bash
docker exec -it flashmart-rabbitmq rabbitmqctl list_queues -p flashmart name messages consumers
```

启动 Spring Boot 后，看管理台：

```text
http://localhost:15672
```

重点看：

- Exchanges 是否存在。
- Queues 是否存在。
- Bindings 是否正确。
- Ready 消息是否堆积。
- Unacked 是否一直不降。
- Consumers 是否为 0。

## 常见坑

### 连接不上

检查：

- Spring 连接的是 `5672`，不是 `15672`。
- `virtual-host` 是否正确。
- 用户是否有该 vhost 权限。
- 容器是否启动。
- Docker 网络里服务名是否写对。

### 管理台能打开，应用连不上

管理台走 `15672`，AMQP 客户端走 `5672`。这是两个端口。

### 消息发了但队列没有

检查：

- exchange 名称。
- routing key。
- binding 是否存在。
- `template.mandatory` 和 returns callback 是否开启。

### 消费者一直重复消费

常见原因：

- 失败后 `basicNack(..., true)` 重新入队。
- 业务代码一直抛同一个异常。
- 没有死信队列。
- 自动重试配置不合理。

### 队列里 Unacked 很多

说明消息被消费者拿走但没有确认。

检查：

- 是否忘记 `basicAck`。
- 消费逻辑是否卡住。
- prefetch 是否太大。
- 消费者线程是否阻塞。

### JSON 转换失败

检查：

- 生产者和消费者使用的 message converter 是否一致。
- DTO 包名是否可信。
- 字段是否改名。
- 是否直接传了 Entity。
- Boot 4/3 的 Jackson converter 是否用错。

## 落地检查清单

- [ ] Docker Compose 能启动 RabbitMQ。
- [ ] 管理台 `15672` 能访问。
- [ ] Spring Boot 连接 `5672`。
- [ ] 已创建业务 vhost、用户、权限。
- [ ] 不使用生产 `guest/guest`。
- [ ] exchange、queue、binding 都用 Bean 声明。
- [ ] 队列 durable。
- [ ] 配了 DLX 和 DLQ。
- [ ] 生产者开启 confirm 和 returns。
- [ ] 消息带 `messageId`。
- [ ] 消费者手动 ack。
- [ ] 消费失败不会无限 requeue。
- [ ] 消费端有幂等。
- [ ] DTO 稳定，不直接传 Entity。
- [ ] 管理台不暴露公网。

## 最后记一句话

RabbitMQ 和 Spring 集成不难，难的是别只做到“能发能收”：确认、死信、幂等、监控才是工程里真正保命的部分。

## 参考

- [RabbitMQ Installing RabbitMQ](https://www.rabbitmq.com/docs/download)
- [RabbitMQ Management Plugin](https://www.rabbitmq.com/docs/management)
- [RabbitMQ Access Control](https://www.rabbitmq.com/docs/access-control)
- [Spring AMQP RabbitTemplate](https://docs.spring.io/spring-amqp/reference/amqp/template.html)
- [Spring AMQP Message Converters](https://docs.spring.io/spring-amqp/reference/amqp/message-converters.html)
