---
title: Nacos 使用笔记
sidebarTitle: Nacos
---

# Nacos 使用笔记

Nacos 在 Spring Cloud Alibaba 项目里通常做两件事：

```text
服务注册与发现：服务实例在哪里
配置中心：应用配置从哪里加载
```

这篇不讲“Nacos 是什么”，只记项目里怎么落：依赖怎么引、`application.yml` 怎么写、`namespace / group / dataId` 怎么定、配置怎么刷新、服务发现怎么排查。

## 先给结论

普通后端项目用 Nacos，先按这套规则来：

1. 注册中心和配置中心可以都用 Nacos，但配置要分开治理。
2. `namespace` 优先用于环境隔离，例如 dev、test、prod。
3. `group` 用于业务分组或配置分组，不要滥造。
4. `dataId` 必须稳定命名，一眼能看出应用、环境和配置类型。
5. Spring Cloud Alibaba 2025.x 推荐用 `spring.config.import` 导入 Nacos 配置，不要再依赖 `bootstrap.yml`。
6. 动态刷新只适合开关、阈值、文案、限流参数，不适合数据源、端口、线程池核心结构这类配置。
7. 注册成功不等于调用成功，调用还要经过服务发现、负载均衡、网络和下游健康状态。
8. 生产环境不要把 Nacos 健康检查随便接到 Kubernetes liveness probe 上。

一句话：

**Nacos 是服务治理和配置治理的基础设施，不是“配上地址就完事”的连接器。**

## 依赖

服务注册与发现：

```xml
<dependency>
    <groupId>com.alibaba.cloud</groupId>
    <artifactId>spring-cloud-starter-alibaba-nacos-discovery</artifactId>
</dependency>
```

配置中心：

```xml
<dependency>
    <groupId>com.alibaba.cloud</groupId>
    <artifactId>spring-cloud-starter-alibaba-nacos-config</artifactId>
</dependency>
```

两个 starter 可以一起用，也可以只用其中一个。

项目里要先确认版本矩阵：

```text
Spring Boot 版本
Spring Cloud 版本
Spring Cloud Alibaba 版本
Nacos Server 版本
```

不要只看 starter 能不能下载。版本不匹配时，最常见的问题是启动报错、配置不加载、注册不上或运行时兼容问题。

## 最小配置：注册中心

```yaml
spring:
  application:
    name: order-service
  cloud:
    nacos:
      discovery:
        server-addr: 127.0.0.1:8848
        namespace: dev
        group: DEFAULT_GROUP
        cluster-name: DEFAULT
        metadata:
          version: v1
          region: cn-shanghai
```

启动后，应用会以服务名注册到 Nacos：

```text
serviceName = order-service
ip = 当前实例 IP
port = server.port
namespace = dev
group = DEFAULT_GROUP
cluster = DEFAULT
metadata = version / region / 自定义信息
```

调用方通过服务名访问：

```java
@FeignClient(name = "user-service", path = "/api/users")
public interface UserClient {

    @GetMapping("/{id}")
    UserProfileResponse getById(@PathVariable("id") Long id);
}
```

这里的 `user-service` 会走服务发现，不是固定 IP。

## 最小配置：配置中心

Spring Cloud Alibaba 2025.x 推荐使用 `spring.config.import`。

```yaml
spring:
  application:
    name: order-service
  cloud:
    nacos:
      config:
        server-addr: 127.0.0.1:8848
        namespace: dev
        group: DEFAULT_GROUP
  config:
    import:
      - optional:nacos:order-service.yml
      - optional:nacos:order-service-ext.yml?group=ORDER_GROUP
      - optional:nacos:order-service-local.yml?refreshEnabled=false
```

含义：

| 配置 | 说明 |
| --- | --- |
| `optional:nacos:order-service.yml` | 拉取 `DEFAULT_GROUP` 下的 `order-service.yml`，拉不到也不阻止启动 |
| `nacos:order-service.yml` | 拉不到会快速失败，应用启动失败 |
| `?group=ORDER_GROUP` | 覆盖默认 group |
| `?refreshEnabled=false` | 不监听动态刷新 |

旧项目里常见 `bootstrap.yml`：

```yaml
spring:
  cloud:
    nacos:
      config:
        server-addr: 127.0.0.1:8848
        file-extension: yml
```

如果是新项目，优先用 `spring.config.import`。
如果是旧项目迁移，先确认当前 Spring Cloud Alibaba 版本是否还支持 bootstrap。

## `namespace / group / dataId`

Nacos 配置定位一般可以理解成：

```text
namespace + group + dataId
```

### `namespace`

用于隔离大环境：

```text
dev
test
prod
```

建议：

- 不同环境用不同 namespace。
- 不要在同一个 namespace 里靠配置名字硬区分生产和测试。
- 生产 namespace 的权限要单独控制。

### `group`

用于分组：

```text
DEFAULT_GROUP
ORDER_GROUP
COMMON_GROUP
```

建议：

- 默认业务应用可以先用 `DEFAULT_GROUP`。
- 公共配置可以放 `COMMON_GROUP`。
- 不要把每个服务都建一个 group，除非真的有治理需要。

### `dataId`

用于具体配置文件：

```text
order-service.yml
order-service-database.yml
order-service-feign.yml
common-redis.yml
common-rabbitmq.yml
```

建议命名：

```text
{application-name}.yml
{application-name}-{module}.yml
common-{module}.yml
```

不要用：

```text
config.yml
test.yml
new.yml
aaaa.yml
```

这种名字后面没人知道是谁在用。

## 配置拆分方式

一个服务可以这样拆：

```text
order-service.yml
order-service-database.yml
order-service-feign.yml
order-service-rabbitmq.yml
common-redis.yml
```

应用导入：

```yaml
spring:
  config:
    import:
      - optional:nacos:common-redis.yml?group=COMMON_GROUP
      - optional:nacos:order-service.yml
      - optional:nacos:order-service-database.yml
      - optional:nacos:order-service-feign.yml
      - optional:nacos:order-service-rabbitmq.yml
```

拆分原则：

- 主配置放服务基础配置。
- 公共中间件配置单独放。
- 特定模块配置单独放。
- 不要把所有服务的所有配置塞进一个大 dataId。

## 动态刷新

适合动态刷新的配置：

```yaml
feature:
  new-order-page-enabled: true

order:
  max-cancel-minutes: 30

remote:
  user-service:
    read-timeout: 3000
```

读取方式：

```java
@ConfigurationProperties(prefix = "order")
public class OrderProperties {

    private Integer maxCancelMinutes = 30;

    public Integer getMaxCancelMinutes() {
        return maxCancelMinutes;
    }

    public void setMaxCancelMinutes(Integer maxCancelMinutes) {
        this.maxCancelMinutes = maxCancelMinutes;
    }
}
```

使用：

```java
@Service
public class OrderCancelService {

    private final OrderProperties orderProperties;

    public OrderCancelService(OrderProperties orderProperties) {
        this.orderProperties = orderProperties;
    }

    public boolean canCancel(LocalDateTime createdAt) {
        return createdAt.plusMinutes(orderProperties.getMaxCancelMinutes())
                .isAfter(LocalDateTime.now());
    }
}
```

不建议动态刷新：

- `server.port`
- 数据源核心连接参数
- 线程池核心结构
- MyBatis mapper 扫描路径
- Bean 创建条件
- 需要重建连接的复杂客户端

这类配置改了不代表运行时对象会自动重建。

## `@RefreshScope` 慎用

有些旧项目会这样写：

```java
@RefreshScope
@RestController
public class ConfigController {

    @Value("${order.max-cancel-minutes:30}")
    private Integer maxCancelMinutes;
}
```

问题是：

- `@Value` 分散在各处，不好查。
- `@RefreshScope` 可能导致 Bean 重新创建，影响依赖关系。
- 大量使用后，配置边界不清楚。

更推荐：

```java
@ConfigurationProperties(prefix = "order")
public class OrderProperties {
}
```

把配置集中成一个配置对象，再由业务类依赖这个对象。

## 服务发现和负载均衡

Nacos 负责维护实例列表：

```text
user-service
  ├─ 10.0.0.11:8080 healthy
  ├─ 10.0.0.12:8080 healthy
  └─ 10.0.0.13:8080 unhealthy
```

调用方流程：

```text
Feign / LoadBalancer
  -> 根据 service name 查实例
  -> 过滤不可用实例
  -> 按负载均衡策略选一个实例
  -> 发 HTTP 请求
```

所以排查“调不通”时，要分层看：

1. 服务是否注册到 Nacos。
2. namespace / group 是否一致。
3. 实例 IP 和端口是否正确。
4. 实例健康状态是否正常。
5. 调用方是否拿到了实例列表。
6. 负载均衡后选中的实例是否能访问。
7. 下游接口本身是否正常。

不要所有问题都归成“Nacos 有问题”。

## 服务元数据

元数据可以写：

```yaml
spring:
  cloud:
    nacos:
      discovery:
        metadata:
          version: v1
          zone: zone-a
          grayscale: "false"
```

适合放：

- 版本号
- 区域
- 灰度标记
- 实例能力标签

不适合放：

- 密码
- token
- 大块配置
- 经常变化的业务参数

元数据会被服务发现链路读取。
不要把它当配置中心用。

## 和 OpenFeign 的关系

OpenFeign 里的：

```java
@FeignClient(name = "user-service")
```

会把 `user-service` 当成服务名。

如果接了 Nacos Discovery，调用时会从 Nacos 找实例：

```text
user-service -> [10.0.0.11:8080, 10.0.0.12:8080]
```

所以 Feign 调不通时，不只看 Feign：

- Nacos 里有没有 `user-service`
- 当前应用 namespace 是否一致
- 分组是否一致
- 实例 IP 是否是容器内不可达 IP
- 下游健康状态是否正常
- Feign 超时是否过短

## Actuator 排查入口

可以接 Actuator 看 Nacos 信息。

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-actuator</artifactId>
</dependency>
```

常用端点：

```text
/actuator/nacosconfig
/actuator/nacosdiscovery
```

配置暴露：

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info,nacosconfig,nacosdiscovery
```

注意：Nacos health indicator 默认可能没有开启。
即使开启，也不要直接把它和 Kubernetes liveness probe 绑死。

如果 Nacos 短暂抖动导致 health 变 `DOWN`，Kubernetes 可能误杀大量正常业务 Pod。

## 常见坑

### 1. 还在新项目里写 `bootstrap.yml`

Spring Cloud Alibaba 2025.x 已经推荐 `spring.config.import`。
新项目不要继续拿旧模板复制。

### 2. namespace 写错

服务注册在 `dev`，调用方在 `test`，自然找不到。

### 3. group 滥用

每个服务一个 group，最后配置查找和权限管理都变复杂。

### 4. dataId 命名随意

`test.yml`、`config.yml` 这种名字无法长期维护。

### 5. 动态刷新预期过高

配置变了，不代表所有 Bean、连接池、线程池都会自动重建。

### 6. 公共配置和服务私有配置混在一起

一个公共 dataId 被很多服务引用，随手改一行就可能影响一片服务。

### 7. 注册 IP 不可达

容器、虚拟机、多网卡环境里，注册到 Nacos 的 IP 可能不是调用方能访问的 IP。

必要时显式配置：

```yaml
spring:
  cloud:
    nacos:
      discovery:
        ip: 10.0.0.11
```

### 8. 把 Nacos 当业务配置数据库

高频变化、强一致、复杂查询的业务数据不要放 Nacos。
Nacos 配置中心不是业务数据库。

## 项目检查清单

接入 Nacos 时检查：

- 是否确认了 Spring Cloud Alibaba 和 Nacos Server 版本？
- 注册中心和配置中心是否都真的需要？
- namespace 是否按环境隔离？
- group 是否有明确规则？
- dataId 是否有命名规范？
- 是否使用 `spring.config.import`？
- 哪些配置允许动态刷新？
- 配置变更是否有审批或发布记录？
- Feign 调用方和服务提供方 namespace 是否一致？
- Nacos 上显示的实例 IP 是否可达？
- 是否需要 Actuator 端点辅助排查？
- 是否避免把 Nacos health 直接作为 liveness probe？

## 最后记一句话

Nacos 落地的关键不是“服务能注册、配置能读取”，而是：

**把环境隔离、配置命名、动态刷新边界、服务发现链路和排查入口都设计清楚。**

## 参考

- [Spring Cloud Alibaba Nacos Quick Start](https://sca.aliyun.com/en/docs/2025.x/user-guide/nacos/quick-start/)
- [Spring Cloud Alibaba Nacos Advanced Guide](https://sca.aliyun.com/en/docs/2025.x/user-guide/nacos/advanced-guide/)
