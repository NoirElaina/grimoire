---
title: MyBatis-Plus 使用笔记
sidebarTitle: MyBatis-Plus
---

# MyBatis-Plus 使用笔记

MyBatis-Plus 不是 ORM 魔法，它本质上是 **在 MyBatis 上补了一层通用 CRUD、条件构造器和插件能力**。  
如果把它当成“数据库层全自动方案”，项目后面通常会写得越来越别扭；如果把它当成“帮你减少样板代码的增强层”，就会顺很多。

## 先说结论

MyBatis-Plus 最适合的用法通常是：

1. 简单单表 CRUD 用它提效。
2. 常见条件查询用 `LambdaQueryWrapper` / `LambdaUpdateWrapper`。
3. 分页、乐观锁、逻辑删除这类横切能力交给插件。
4. 复杂查询、联表、多表聚合、报表 SQL 仍然自己写。
5. Service 层保留业务逻辑，不要把 Wrapper 拼接当业务实现本身。

一句话就是：

**让 MyBatis-Plus 解决重复劳动，不要让它替你设计数据访问层。**

## 它到底帮你解决什么

纯 MyBatis 的常见问题是：

- 单表 CRUD 样板代码太多
- 简单条件查询也要反复写 XML
- 分页、乐观锁、逻辑删除每个项目都要重新接

MyBatis-Plus 主要补了这些：

- `BaseMapper<T>`
- `IService<T>` / `ServiceImpl<M, T>`
- `QueryWrapper` / `LambdaQueryWrapper`
- `UpdateWrapper` / `LambdaUpdateWrapper`
- 分页插件
- 乐观锁插件
- 逻辑删除
- 自动填充

所以它真正擅长的是“通用查询和常见治理能力”，不是复杂领域建模。

## 最基本的落地结构

一个典型项目里可以这样分：

```text
com.example.app
├─ controller
├─ service
├─ service/impl
├─ mapper
├─ entity
├─ dto
├─ vo
└─ config
```

### `entity`

对应数据库表，放：

- 表字段
- `@TableName`
- `@TableId`
- `@TableField`

### `mapper`

继承 `BaseMapper<Entity>`，负责：

- 通用 CRUD
- 自定义 SQL 方法

### `service`

放业务接口，不要只机械继承后就什么都不写。  
真正业务动作还是应该在这里命名清楚。

### `service/impl`

可以继承 `ServiceImpl<Mapper, Entity>`，复用通用方法，再补业务逻辑。

## 一个最小例子

### 实体

```java
@Data
@TableName("sys_user")
public class UserEntity {

    @TableId(type = IdType.ASSIGN_ID)
    private Long id;

    private String username;

    private String password;

    private Integer status;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createTime;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updateTime;
}
```

### Mapper

```java
public interface UserMapper extends BaseMapper<UserEntity> {
}
```

### Service

```java
public interface UserService extends IService<UserEntity> {

    UserEntity getByUsername(String username);
}
```

### ServiceImpl

```java
@Service
public class UserServiceImpl
        extends ServiceImpl<UserMapper, UserEntity>
        implements UserService {

    @Override
    public UserEntity getByUsername(String username) {
        return lambdaQuery()
                .eq(UserEntity::getUsername, username)
                .one();
    }
}
```

这个写法的重点不是“少写了多少行”，而是简单查询不再需要额外 XML。

## 为什么更推荐 `LambdaQueryWrapper`

MyBatis-Plus 有两套常见写法：

### 字符串字段名

```java
QueryWrapper<UserEntity> wrapper = new QueryWrapper<>();
wrapper.eq("username", username);
```

### Lambda 字段引用

```java
LambdaQueryWrapper<UserEntity> wrapper = Wrappers.lambdaQuery();
wrapper.eq(UserEntity::getUsername, username);
```

更推荐第二种，原因很直接：

1. 重构字段名时更安全。
2. 少写错列名字符串。
3. 可读性通常更好。

所以日常项目里，优先用：

- `lambdaQuery()`
- `lambdaUpdate()`
- `Wrappers.lambdaQuery()`
- `Wrappers.lambdaUpdate()`

## 常见查询写法

### 按条件查一条

```java
UserEntity user = lambdaQuery()
        .eq(UserEntity::getUsername, username)
        .eq(UserEntity::getStatus, 1)
        .one();
```

### 按条件查列表

```java
List<UserEntity> users = lambdaQuery()
        .like(UserEntity::getUsername, keyword)
        .orderByDesc(UserEntity::getCreateTime)
        .list();
```

### 条件动态拼接

```java
List<UserEntity> users = lambdaQuery()
        .eq(status != null, UserEntity::getStatus, status)
        .like(StringUtils.hasText(keyword), UserEntity::getUsername, keyword)
        .ge(startTime != null, UserEntity::getCreateTime, startTime)
        .le(endTime != null, UserEntity::getCreateTime, endTime)
        .list();
```

这也是 MyBatis-Plus 很顺手的一点：  
条件是否生效可以直接写在方法参数里，不用堆很多 `if`。

## 更新写法

### 按主键更新

```java
UserEntity user = new UserEntity();
user.setId(id);
user.setStatus(0);
updateById(user);
```

### 按条件更新

```java
lambdaUpdate()
        .eq(UserEntity::getId, id)
        .set(UserEntity::getStatus, 0)
        .update();
```

### 批量条件更新

```java
lambdaUpdate()
        .in(UserEntity::getId, ids)
        .set(UserEntity::getStatus, 1)
        .update();
```

这里要注意：

**Wrapper 更新很方便，但越方便越要防止误更新全表。**

## 删除写法

### 物理删除

```java
removeById(id);
```

### 条件删除

```java
lambdaUpdate()
        .eq(UserEntity::getStatus, 0)
        .remove();
```

如果项目开启逻辑删除，上面这些删除大多会变成更新删除标记，而不是真删。

## 分页怎么接

分页是 MyBatis-Plus 非常适合交给插件的一层。

典型配置：

```java
@Bean
public MybatisPlusInterceptor mybatisPlusInterceptor() {
    MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();
    interceptor.addInnerInterceptor(new PaginationInnerInterceptor(DbType.MYSQL));
    return interceptor;
}
```

查询时：

```java
Page<UserEntity> page = new Page<>(current, size);

Page<UserEntity> result = lambdaQuery()
        .eq(UserEntity::getStatus, 1)
        .page(page);
```

然后拿：

- `result.getRecords()`
- `result.getTotal()`
- `result.getCurrent()`
- `result.getSize()`

## 乐观锁怎么接

如果表里有版本号字段，可以配乐观锁插件：

```java
@Version
private Integer version;
```

再在插件里加：

```java
interceptor.addInnerInterceptor(new OptimisticLockerInnerInterceptor());
```

这样更新时会自动带上版本条件。  
适合：

- 库存
- 状态流转
- 后台编辑覆盖保护

但要记住，乐观锁不是所有写冲突都能自动解决，它只是帮你发现并发覆盖。

## 逻辑删除怎么接

常见配置：

```java
@TableLogic
private Integer deleted;
```

或者配全局逻辑删除字段。

优点：

- 查询默认过滤已删数据
- 删除变更新

问题也很实际：

- 唯一索引设计会变复杂
- 统计、导出、后台排查时要特别注意“是否包含已删数据”

所以逻辑删除不是一定比物理删除高级，而是看业务是否真的需要保留删除痕迹。

## 自动填充怎么做

常见场景：

- `createTime`
- `updateTime`
- `createBy`
- `updateBy`

可以通过 `MetaObjectHandler` 做自动填充：

```java
@Component
public class CommonMetaObjectHandler implements MetaObjectHandler {

    @Override
    public void insertFill(MetaObject metaObject) {
        this.strictInsertFill(metaObject, "createTime", LocalDateTime.class, LocalDateTime.now());
        this.strictInsertFill(metaObject, "updateTime", LocalDateTime.class, LocalDateTime.now());
    }

    @Override
    public void updateFill(MetaObject metaObject) {
        this.strictUpdateFill(metaObject, "updateTime", LocalDateTime.class, LocalDateTime.now());
    }
}
```

这层很适合统一治理，不要在业务代码里每次手动 set。

## `BaseMapper` 和 `IService` 到底该不该全项目通用

可以用，但别滥用。

### 适合直接用通用方法的场景

- 按 ID 查
- 按简单条件查
- 简单分页
- 单表增删改

### 不适合只靠通用方法硬写的场景

- 联表查询
- 聚合统计
- 复杂排序和分组
- 业务条件很多的搜索页
- 需要非常精确 SQL 控制的场景

这时候更稳的做法通常是：

- Mapper 里自定义方法
- XML 写 SQL
- 返回专门的 VO / DTO

不要为了“全用 MyBatis-Plus”把 SQL 写得特别绕。

## 什么时候该回到 XML / 自定义 SQL

这块很关键。

下面这些情况，我一般直接写 SQL，不强行 Wrapper：

1. 多表联查。
2. 复杂分组聚合。
3. 有窗口函数、子查询、公共表达式。
4. 查询性能很敏感，需要精确控制。
5. 返回结构明显不是单表实体。

经验上：

- 单表为主，用 MyBatis-Plus 很舒服
- 一旦跨表复杂度上来，老老实实写 SQL 更稳

## MyBatis-Plus 最常见的几个坑

### 1. 把 Entity 当所有层通用对象

很多项目会直接：

- Controller 收 Entity
- Service 传 Entity
- Mapper 也用 Entity
- 返回前端还是 Entity

这样后面很容易出问题：

- 字段越长越混乱
- 前端返回字段和表结构强耦合
- 敏感字段容易泄露

更稳的做法是：

- `Entity` 只面向存储
- 请求用 `DTO`
- 返回用 `VO`

### 2. Wrapper 拼太多，把业务逻辑写碎

比如一个方法几十个 `.eq/.like/.or/.and` 连着写，最后：

- 不好读
- 不好测
- 不好复用

这时候应该停下来拆：

- 查询对象
- 条件构造方法
- 自定义 SQL

### 3. 误更新、误删除全表

这是真坑。

如果 update/remove 条件没拼上，后果很大。  
所以实践上要注意：

- 关键更新前先校验条件
- 必要时加防全表更新拦截
- 对后台危险操作单独收口

### 4. `one()` 查出多条直接报错

`one()` 适合你确定唯一的场景。  
如果数据可能脏，或者唯一性没被数据库约束住，`one()` 容易炸。

所以：

- 真唯一，用唯一索引 + `one()`
- 不确定唯一，就 `list()` 或 `limit 1`

### 5. 逻辑删除后唯一索引冲突

这是很多项目会踩的。

例如用户名逻辑删除后再新增同名用户，如果唯一索引还只建在 `username` 上，就会冲突。

所以逻辑删除设计时，要提前想：

- 唯一索引是否要带 `deleted`
- 业务是否允许“删后重建”

## 比较推荐的一种项目实践

如果是普通后台项目，我会这样约束：

1. `Mapper` 统一继承 `BaseMapper`。
2. 简单查询优先 `lambdaQuery/lambdaUpdate`。
3. Service 层写清楚业务动作，不直接暴露一堆通用 CRUD 给 Controller。
4. 联表和复杂报表统一写自定义 SQL。
5. 打开分页插件。
6. 按需打开乐观锁、逻辑删除、自动填充。
7. Entity、DTO、VO 分开。
8. 对高风险更新删除增加保护。

这套做法通常比较均衡：

- 开发效率高
- SQL 仍然可控
- 后面不容易烂

## 最后记一句话

**MyBatis-Plus 最好的定位，是“让简单事更简单”，不是“让复杂事假装简单”。**

用对地方，它很省力。  
用错地方，你会写出一堆难维护的 Wrapper 魔法。
