---
title: MyBatis-Plus 使用笔记
sidebarTitle: MyBatis-Plus
---

# MyBatis-Plus 使用笔记

> 这篇只记工程里怎么接、怎么写、哪里容易翻车。

## 依赖怎么选

Spring Boot 3 用这个：

```xml
<dependency>
    <groupId>com.baomidou</groupId>
    <artifactId>mybatis-plus-spring-boot3-starter</artifactId>
    <version>${mybatis-plus.version}</version>
</dependency>
```

Spring Boot 2 用这个：

```xml
<dependency>
    <groupId>com.baomidou</groupId>
    <artifactId>mybatis-plus-boot-starter</artifactId>
    <version>${mybatis-plus.version}</version>
</dependency>
```

分页插件从 `3.5.9+` 开始要额外引入解析器模块：

```xml
<dependency>
    <groupId>com.baomidou</groupId>
    <artifactId>mybatis-plus-jsqlparser</artifactId>
    <version>${mybatis-plus.version}</version>
</dependency>
```

注意：

- 引了 MyBatis-Plus starter 后，不要再手动引 `mybatis-spring-boot-starter`。
- JDK 8 老项目如果分页解析器不兼容，查对应版本的 `mybatis-plus-jsqlparser-4.9`。
- 版本最好统一交给 BOM 或父工程管理，不要每个模块各写一套。

## 最小配置

启动类或配置类扫 Mapper：

```java
@SpringBootApplication
@MapperScan("com.example.order.mapper")
public class OrderApplication {

    public static void main(String[] args) {
        SpringApplication.run(OrderApplication.class, args);
    }
}
```

`application.yml` 里先保留这些：

```yaml
mybatis-plus:
  mapper-locations: classpath*:/mapper/**/*.xml
  type-aliases-package: com.example.order.entity
  configuration:
    map-underscore-to-camel-case: true
    log-impl: org.apache.ibatis.logging.stdout.StdOutImpl
  global-config:
    db-config:
      id-type: assign_id
```

线上注意：

- `log-impl` 会打印 SQL，生产一般不要开标准输出。
- `id-type` 要和数据库主键策略统一，别一会儿雪花，一会儿自增。
- 多模块项目要确认 `mapper-locations` 能扫到所有 XML。

## 推荐目录

```text
com.example.order
├── controller
├── service
│   ├── OrderService.java
│   └── impl
│       └── OrderServiceImpl.java
├── mapper
│   └── OrderMapper.java
├── entity
│   └── OrderEntity.java
├── dto
├── vo
└── config
    └── MybatisPlusConfig.java
```

分层原则：

- `entity`：表字段映射。
- `mapper`：数据库访问。
- `service`：业务动作和事务边界。
- `dto`：请求入参。
- `vo`：接口返回。
- `config`：插件、填充器、类型处理器。

## Entity 写法

```java
@TableName("t_order")
public class OrderEntity {

    @TableId(type = IdType.ASSIGN_ID)
    private Long id;

    private Long userId;

    private BigDecimal amount;

    private Integer status;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createTime;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updateTime;

    @TableLogic
    private Integer deleted;

    @Version
    private Integer version;
}
```

字段约定：

- 数据库字段用 `snake_case`，Java 字段用 `camelCase`。
- 表名不规范时用 `@TableName`。
- 主键策略不要靠默认猜，显式写出来。
- 逻辑删除字段建议统一叫 `deleted`。
- 乐观锁字段建议统一叫 `version`。

## Mapper 写法

```java
public interface OrderMapper extends BaseMapper<OrderEntity> {

    /**
     * 查询用户最近订单。
     *
     * <p>复杂排序、关联字段、统计字段放到 XML，避免在 Service 里硬拼 Wrapper。</p>
     */
    List<OrderSummaryVO> selectRecentOrders(@Param("userId") Long userId,
                                            @Param("limit") Integer limit);

    /**
     * 按订单状态统计数量。
     *
     * <p>返回接口 VO，不返回 Entity，避免把表结构泄漏到上层。</p>
     */
    List<OrderStatusCountVO> countByStatus(@Param("userId") Long userId);
}
```

Mapper 里注释要写“为什么自定义”，不要只翻译方法名：

- 这个查询为什么不用 `BaseMapper`。
- 返回对象是不是 VO / DTO。
- 是否依赖特殊索引、排序、分页。
- 是否要配套 XML 里的 `resultMap`。

## Service 不要只套壳

可以继承 `IService`，但不要让它变成“万能 DAO”：

```java
public interface OrderService extends IService<OrderEntity> {

    Long createOrder(CreateOrderCommand command);

    void cancelOrder(Long orderId, Long userId);

    PageResult<OrderVO> pageUserOrders(OrderPageQuery query);
}
```

实现里承接业务语义：

```java
@Service
public class OrderServiceImpl extends ServiceImpl<OrderMapper, OrderEntity>
        implements OrderService {

    @Override
    @Transactional(rollbackFor = Exception.class)
    public Long createOrder(CreateOrderCommand command) {
        OrderEntity order = new OrderEntity();
        order.setUserId(command.userId());
        order.setAmount(command.amount());
        order.setStatus(OrderStatus.CREATED.getCode());

        save(order);
        return order.getId();
    }
}
```

判断标准：

- `save(order)` 这种通用操作可以用。
- `createOrder(command)` 这种业务动作必须自己命名。
- Controller 不要直接调用 `mapper.insert()`。
- 跨多张表修改时，事务放在 Service。

## Wrapper 查询

优先用 Lambda，避免字段名字符串写错：

```java
LambdaQueryWrapper<OrderEntity> wrapper = Wrappers.lambdaQuery(OrderEntity.class)
    .eq(OrderEntity::getUserId, userId)
    .eq(OrderEntity::getStatus, OrderStatus.CREATED.getCode())
    .orderByDesc(OrderEntity::getCreateTime);

List<OrderEntity> orders = orderMapper.selectList(wrapper);
```

动态条件这样写：

```java
LambdaQueryWrapper<OrderEntity> wrapper = Wrappers.lambdaQuery(OrderEntity.class)
    .eq(query.userId() != null, OrderEntity::getUserId, query.userId())
    .eq(query.status() != null, OrderEntity::getStatus, query.status())
    .ge(query.startTime() != null, OrderEntity::getCreateTime, query.startTime())
    .lt(query.endTime() != null, OrderEntity::getCreateTime, query.endTime())
    .orderByDesc(OrderEntity::getCreateTime);
```

查一条要注意唯一性：

```java
OrderEntity order = orderMapper.selectOne(
    Wrappers.lambdaQuery(OrderEntity.class)
        .eq(OrderEntity::getOrderNo, orderNo)
        .last("limit 1")
);
```

更推荐靠唯一索引保证只会有一条：

```sql
alter table t_order add unique uk_order_no(order_no);
```

## 分页怎么接

插件配置：

```java
@Configuration
public class MybatisPlusConfig {

    @Bean
    public MybatisPlusInterceptor mybatisPlusInterceptor() {
        MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();
        interceptor.addInnerInterceptor(new OptimisticLockerInnerInterceptor());
        interceptor.addInnerInterceptor(new BlockAttackInnerInterceptor());
        interceptor.addInnerInterceptor(new PaginationInnerInterceptor(DbType.MYSQL));
        return interceptor;
    }
}
```

分页插件尽量放最后，单库项目指定 `DbType`。

调用方式：

```java
Page<OrderEntity> page = Page.of(query.pageNo(), query.pageSize());

Page<OrderEntity> result = orderMapper.selectPage(
    page,
    Wrappers.lambdaQuery(OrderEntity.class)
        .eq(OrderEntity::getUserId, query.userId())
        .orderByDesc(OrderEntity::getCreateTime)
);
```

转成接口分页对象：

```java
List<OrderVO> records = result.getRecords().stream()
    .map(orderConverter::toVO)
    .toList();

return PageResult.of(records, result.getTotal(), result.getCurrent(), result.getSize());
```

分页坑：

- 前端传 `pageSize` 要限制最大值。
- 多表分页的 count SQL 可能不准，复杂场景写自定义 count。
- `left join` 分页 SQL 里表和字段都写别名，减少 count 优化误判。
- 不要把 `Page` 直接返回给前端，自己封装分页 VO。

## 更新和删除要防手滑

按主键更新：

```java
OrderEntity update = new OrderEntity();
update.setId(orderId);
update.setStatus(OrderStatus.PAID.getCode());
orderMapper.updateById(update);
```

按条件更新：

```java
int rows = orderMapper.update(
    null,
    Wrappers.lambdaUpdate(OrderEntity.class)
        .eq(OrderEntity::getId, orderId)
        .eq(OrderEntity::getStatus, OrderStatus.CREATED.getCode())
        .set(OrderEntity::getStatus, OrderStatus.CANCELED.getCode())
);

if (rows != 1) {
    throw new BizException("订单状态已变化");
}
```

删除也要带明确条件：

```java
orderMapper.delete(
    Wrappers.lambdaQuery(OrderEntity.class)
        .eq(OrderEntity::getUserId, userId)
        .eq(OrderEntity::getId, orderId)
);
```

建议开启 `BlockAttackInnerInterceptor`，拦截无条件全表 `update` / `delete`。

## 逻辑删除

全局配置：

```yaml
mybatis-plus:
  global-config:
    db-config:
      logic-delete-field: deleted
      logic-delete-value: 1
      logic-not-delete-value: 0
```

字段：

```java
@TableLogic
private Integer deleted;
```

数据库默认值：

```sql
alter table t_order
    add column deleted tinyint not null default 0 comment '是否删除：0否，1是';
```

常见坑：

- 逻辑删除不是归档，表还是会变大。
- 唯一索引要考虑 `deleted`，否则删除后可能无法重新创建同名数据。
- 后台管理“查已删除数据”一般要写自定义 SQL。

## 自动填充

字段：

```java
@TableField(fill = FieldFill.INSERT)
private LocalDateTime createTime;

@TableField(fill = FieldFill.INSERT_UPDATE)
private LocalDateTime updateTime;
```

填充器：

```java
@Component
public class AuditMetaObjectHandler implements MetaObjectHandler {

    @Override
    public void insertFill(MetaObject metaObject) {
        LocalDateTime now = LocalDateTime.now();
        strictInsertFill(metaObject, "createTime", LocalDateTime.class, now);
        strictInsertFill(metaObject, "updateTime", LocalDateTime.class, now);
    }

    @Override
    public void updateFill(MetaObject metaObject) {
        strictUpdateFill(metaObject, "updateTime", LocalDateTime.class, LocalDateTime.now());
    }
}
```

如果还要填 `createBy`、`updateBy`，从当前登录上下文里取，不要从请求体传。

## 乐观锁

字段：

```java
@Version
private Integer version;
```

更新时带旧版本：

```java
OrderEntity order = orderMapper.selectById(orderId);
order.setStatus(OrderStatus.PAID.getCode());

int rows = orderMapper.updateById(order);
if (rows != 1) {
    throw new BizException("订单已被其他操作修改，请刷新后重试");
}
```

适合：

- 订单状态流转。
- 库存扣减前置校验。
- 配置类数据编辑。

不适合：

- 高频计数器。
- 批量无差别更新。
- 强一致扣减，通常要配合数据库条件更新或锁。

## 自定义 XML

复杂查询回到 XML：

```java
public interface OrderMapper extends BaseMapper<OrderEntity> {

    /**
     * 分页查询订单列表，包含用户昵称和支付状态。
     */
    IPage<OrderListVO> selectOrderPage(Page<OrderListVO> page,
                                       @Param("query") OrderPageQuery query);
}
```

```xml
<select id="selectOrderPage" resultType="com.example.order.vo.OrderListVO">
    select
        o.id,
        o.order_no,
        o.amount,
        o.status,
        u.nickname as user_nickname
    from t_order o
    left join t_user u on u.id = o.user_id
    where o.deleted = 0
    <if test="query.userId != null">
        and o.user_id = #{query.userId}
    </if>
    <if test="query.status != null">
        and o.status = #{query.status}
    </if>
    order by o.create_time desc
</select>
```

XML 适合放：

- 多表关联。
- 分组统计。
- 动态排序白名单。
- 自定义 `resultMap`。
- 性能调优后的 SQL。

## 批量操作

小批量可以用 `saveBatch`：

```java
saveBatch(orders, 500);
```

更稳的做法：

- 每批控制在 300～1000 条，看字段数和数据库压力。
- 大批量导入用专门导入链路，不要一个 HTTP 请求硬扛。
- 批量写失败要能定位到哪批、哪条数据。
- 批量修改涉及业务状态时，不要只靠 `updateBatchById`，要校验状态。

## 常见坑

### Entity 到处传

不要：

```java
@PostMapping("/orders")
public Long create(@RequestBody OrderEntity order) {
    return orderService.save(order) ? order.getId() : null;
}
```

要：

```java
@PostMapping("/orders")
public Long create(@Valid @RequestBody CreateOrderRequest request) {
    return orderService.createOrder(orderConverter.toCommand(request));
}
```

### Wrapper 写成业务逻辑碎片

如果一个查询 Wrapper 超过十几行，并且有很多业务判断，抽成明确方法：

```java
private LambdaQueryWrapper<OrderEntity> buildPageWrapper(OrderPageQuery query) {
    return Wrappers.lambdaQuery(OrderEntity.class)
        .eq(OrderEntity::getUserId, query.userId())
        .eq(query.status() != null, OrderEntity::getStatus, query.status())
        .orderByDesc(OrderEntity::getCreateTime);
}
```

### `getOne` 查出多条

`getOne(wrapper)` 默认遇到多条可能抛异常。能唯一就加唯一索引，不能唯一就分页或 `limit 1`。

### 空条件误更新

这种代码要禁止：

```java
Wrappers.lambdaUpdate(OrderEntity.class)
    .set(OrderEntity::getStatus, OrderStatus.CLOSED.getCode());
```

必须带业务条件，最好配合 `BlockAttackInnerInterceptor`。

### 逻辑删除和唯一索引冲突

如果业务允许删除后重建同名数据，索引要设计成：

```sql
create unique index uk_user_name_deleted on t_user(name, deleted);
```

或者用 `deleted_at` 参与唯一索引，按项目数据库能力定。

## 落地检查清单

- [ ] starter 和 Spring Boot 版本匹配。
- [ ] `@MapperScan` 扫描路径正确。
- [ ] 分页插件可用，`3.5.9+` 已补 `mybatis-plus-jsqlparser`。
- [ ] `BlockAttackInnerInterceptor` 已配置。
- [ ] 主键、逻辑删除、乐观锁字段策略统一。
- [ ] Entity、DTO、VO 没有混用。
- [ ] 自定义 Mapper 方法有注释，复杂 SQL 放 XML。
- [ ] 分页返回对象已封装，不直接暴露 `Page`。
- [ ] 更新 / 删除都带明确业务条件。
- [ ] 生产环境没有打开控制台 SQL 输出。

## 参考

- [MyBatis-Plus 安装](https://baomidou.com/en/getting-started/install/)
- [MyBatis-Plus 分页插件](https://baomidou.com/en/plugins/pagination/)
- [MyBatis-Plus 插件主体](https://mybatis.plus/guide/interceptor.html)
