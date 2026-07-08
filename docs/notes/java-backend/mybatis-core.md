---
title: MyBatis 核心地基
sidebarTitle: MyBatis 核心地基
---

# MyBatis 核心地基

> MyBatis-Plus 是增强工具，MyBatis 才是地基。先知道 Mapper、XML、参数绑定、结果映射、SqlSession 怎么工作，后面写复杂 SQL 才不慌。

## Mapper 和 XML 怎么对应

Mapper：

```java
@Mapper
public interface ProductMapper {

    ProductDO selectById(@Param("productId") Long productId);
}
```

XML：

```xml
<mapper namespace="org.example.flashmart.product.mapper.ProductMapper">

    <select id="selectById" resultType="org.example.flashmart.product.entity.ProductDO">
        select id, name, price, status, created_at, updated_at
        from product
        where id = #{productId}
    </select>

</mapper>
```

对应关系：

```text
namespace = Mapper 接口全限定名
id = Mapper 方法名
```

如果不匹配，常见报错：

```text
Invalid bound statement not found
```

排查：

- XML 是否放在 `mapper-locations` 能扫描到的位置。
- `namespace` 是否写对。
- `id` 是否和方法名一致。
- XML 是否打进最终 jar 包。

## 参数绑定

单个参数：

```java
ProductDO selectById(Long productId);
```

XML 可以用：

```xml
where id = #{value}
```

但工程里更推荐显式 `@Param`：

```java
ProductDO selectById(@Param("productId") Long productId);
```

XML：

```xml
where id = #{productId}
```

多个参数必须写清：

```java
List<ProductDO> selectByStatusAndCategory(@Param("status") String status,
                                          @Param("categoryId") Long categoryId);
```

XML：

```xml
where status = #{status}
  and category_id = #{categoryId}
```

不要依赖 `param1`、`param2` 这种默认名字，后面维护很难读。

## `#{}` 和 `${}`

`#{}` 是参数占位：

```xml
where username = #{username}
```

它会使用预编译参数，能防 SQL 注入。

`${}` 是字符串拼接：

```xml
order by ${sortField}
```

它会直接拼到 SQL 中，有注入风险。

规则：

- 普通值一律用 `#{}`。
- 表名、列名、排序字段不得不用 `${}` 时，必须先白名单校验。

排序白名单：

```java
private static final Map<String, String> SORT_FIELD_MAP = Map.of(
    "createdAt", "created_at",
    "price", "price"
);

public String resolveSortField(String sortField) {
    String column = SORT_FIELD_MAP.get(sortField);
    if (column == null) {
        throw new BizException(ErrorCode.PARAM_INVALID);
    }
    return column;
}
```

XML：

```xml
order by ${sortColumn} ${sortDirection}
```

`sortDirection` 也必须限制为 `asc` 或 `desc`。

## resultType 和 resultMap

简单字段可以用 `resultType`：

```xml
<select id="selectById" resultType="org.example.flashmart.product.entity.ProductDO">
    select id, name, price
    from product
    where id = #{productId}
</select>
```

如果字段名和 Java 属性名不一致：

```text
created_at -> createdAt
```

可以开启下划线转驼峰：

```yaml
mybatis:
  configuration:
    map-underscore-to-camel-case: true
```

复杂映射用 `resultMap`：

```xml
<resultMap id="ProductDetailMap" type="org.example.flashmart.product.dto.ProductDetailDO">
    <id property="id" column="id"/>
    <result property="name" column="name"/>
    <result property="price" column="price"/>
    <result property="categoryName" column="category_name"/>
</resultMap>

<select id="selectDetailById" resultMap="ProductDetailMap">
    select p.id, p.name, p.price, c.name as category_name
    from product p
    left join category c on c.id = p.category_id
    where p.id = #{productId}
</select>
```

复杂列表页建议用专门的查询 DO / DTO，不要硬塞进 Entity。

## 插入后拿主键

```xml
<insert id="insert" useGeneratedKeys="true" keyProperty="id">
    insert into product (name, price, status, created_at, updated_at)
    values (#{name}, #{price}, #{status}, now(), now())
</insert>
```

Java：

```java
ProductDO product = new ProductDO();
productMapper.insert(product);
Long productId = product.getId();
```

如果主键没回填，检查：

- 数据库是否自增主键。
- `useGeneratedKeys` 是否开启。
- `keyProperty` 是否是 Java 属性名，不是列名。

## 更新受影响行数

条件更新：

```java
int updateStatus(@Param("orderId") Long orderId,
                 @Param("fromStatus") String fromStatus,
                 @Param("toStatus") String toStatus);
```

XML：

```xml
<update id="updateStatus">
    update order_info
    set status = #{toStatus},
        updated_at = now()
    where id = #{orderId}
      and status = #{fromStatus}
</update>
```

Service：

```java
int affected = orderMapper.updateStatus(orderId, "WAIT_PAY", "PAID");
if (affected != 1) {
    throw new BizException(ErrorCode.ORDER_STATUS_INVALID);
}
```

不要忽略 update 返回值。并发场景里它是业务判断依据。

## 批量操作

批量插入：

```java
int insertBatch(@Param("items") List<ProductImageDO> items);
```

XML：

```xml
<insert id="insertBatch">
    insert into product_image (product_id, image_url, sort_no, created_at)
    values
    <foreach collection="items" item="item" separator=",">
        (#{item.productId}, #{item.imageUrl}, #{item.sortNo}, now())
    </foreach>
</insert>
```

注意：

- 列表为空要在 Service 里提前判断。
- 一次不要塞太多，避免 SQL 太长。
- 大批量要分批。

## MyBatis 和事务

在 Spring Boot 里，一般不手动操作 `SqlSession`。

Service 加事务：

```java
@Transactional(rollbackFor = Exception.class)
public void createProduct(CreateProductCommand command) {
    productMapper.insert(product);
    productImageMapper.insertBatch(images);
}
```

同一个事务内的 Mapper 操作由 Spring 管理连接和提交回滚。

不要在业务里手动：

```java
sqlSession.commit();
sqlSession.rollback();
```

除非你明确不用 Spring 管理事务。

## 常见问题

| 问题 | 排查 |
| --- | --- |
| `Invalid bound statement` | namespace、id、XML 扫描路径 |
| 参数取不到 | 是否写 `@Param`，XML 名字是否一致 |
| 返回字段为 null | 列名、别名、驼峰映射、resultMap |
| SQL 注入风险 | 是否用了 `${}` |
| 批量插入失败 | 集合为空、SQL 太长、字段类型不匹配 |
| 更新没生效 | 是否检查 affected rows |
| 分页不对 | 是否先排序，分页插件是否配置 |

## 去空话检查

- [ ] namespace 等于 Mapper 全限定名。
- [ ] XML id 等于 Mapper 方法名。
- [ ] 多参数都写 `@Param`。
- [ ] 普通值用 `#{}`，`${}` 只允许白名单字段。
- [ ] 复杂映射用 `resultMap`。
- [ ] 更新语句检查受影响行数。
- [ ] 批量操作先判断空集合并控制批大小。

## 参考

- [MyBatis Java API](https://mybatis.org/mybatis-3/java-api.html)
- [MyBatis SqlSession Javadoc](https://mybatis.org/mybatis-3/apidocs/org/apache/ibatis/session/SqlSession.html)
