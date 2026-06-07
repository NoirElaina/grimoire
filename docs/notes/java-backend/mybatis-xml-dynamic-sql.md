---
title: MyBatis XML 动态 SQL
sidebarTitle: MyBatis 动态 SQL
---

# MyBatis XML 动态 SQL

> 动态 SQL 不是为了少写几行字符串，而是为了把复杂查询条件稳定、可读、可排查地表达出来。

## 先给结论

常用标签：

| 标签 | 用途 |
| --- | --- |
| `<if>` | 条件拼接 |
| `<where>` | 自动处理 `where` 和多余 `and` |
| `<set>` | update 时自动处理逗号 |
| `<foreach>` | in 查询、批量插入 |
| `<choose>` | 类似 if/else |
| `<trim>` | 自定义前缀后缀处理 |
| `<sql>` / `<include>` | 复用 SQL 片段 |

动态 SQL 最大的坑：

- 条件漏掉导致全表查。
- update 语句空字段导致 SQL 错。
- `in` 集合为空。
- `${}` 拼接导致 SQL 注入。
- 查询条件太自由导致索引用不上。

## `<if>`

查询商品列表：

```xml
<select id="selectPageByQuery" resultType="org.example.flashmart.product.dto.ProductListItemDO">
    select id, name, price, status, created_at
    from product
    where deleted = 0
    <if test="query.keyword != null and query.keyword != ''">
        and name like concat('%', #{query.keyword}, '%')
    </if>
    <if test="query.status != null and query.status != ''">
        and status = #{query.status}
    </if>
    <if test="query.categoryId != null">
        and category_id = #{query.categoryId}
    </if>
    order by created_at desc
</select>
```

Mapper：

```java
List<ProductListItemDO> selectPageByQuery(@Param("query") ProductPageQuery query);
```

如果参数是对象，XML 里用 `query.xxx` 更清楚。

## `<where>`

`<where>` 会自动补 `where`，并处理开头多余的 `and`。

```xml
<select id="selectByQuery" resultType="org.example.flashmart.product.entity.ProductDO">
    select id, name, price, status
    from product
    <where>
        deleted = 0
        <if test="status != null">
            and status = #{status}
        </if>
        <if test="categoryId != null">
            and category_id = #{categoryId}
        </if>
    </where>
</select>
```

注意：`<where>` 不会帮你设计索引，也不会阻止你查全表。

如果没有任何条件且又没有固定条件，可能变成：

```sql
select ... from product
```

后台列表必须限制分页和最大 pageSize。

## `<set>`

更新部分字段：

```xml
<update id="updateSelective">
    update product
    <set>
        <if test="name != null">
            name = #{name},
        </if>
        <if test="price != null">
            price = #{price},
        </if>
        <if test="status != null">
            status = #{status},
        </if>
        updated_at = now()
    </set>
    where id = #{id}
</update>
```

`<set>` 会处理末尾多余逗号。

更新要注意：

- `where id = #{id}` 必须有。
- 更新前 Service 校验 id 不为空。
- 重要状态更新要加旧状态条件。

状态机更新：

```xml
<update id="updateStatus">
    update order_info
    set status = #{toStatus},
        updated_at = now()
    where id = #{orderId}
      and status = #{fromStatus}
</update>
```

## `<foreach>` 做 `in`

Mapper：

```java
List<ProductDO> selectByIds(@Param("ids") List<Long> ids);
```

XML：

```xml
<select id="selectByIds" resultType="org.example.flashmart.product.entity.ProductDO">
    select id, name, price, status
    from product
    where id in
    <foreach collection="ids" item="id" open="(" separator="," close=")">
        #{id}
    </foreach>
</select>
```

Service 必须处理空集合：

```java
public List<ProductDO> listByIds(List<Long> ids) {
    if (CollectionUtils.isEmpty(ids)) {
        return List.of();
    }
    return productMapper.selectByIds(ids);
}
```

不要让空集合拼成：

```sql
where id in ()
```

## `<foreach>` 批量插入

```xml
<insert id="insertBatch">
    insert into product_image (product_id, image_url, sort_no, created_at)
    values
    <foreach collection="items" item="item" separator=",">
        (#{item.productId}, #{item.imageUrl}, #{item.sortNo}, now())
    </foreach>
</insert>
```

批量插入注意：

- 一次批量不要过大。
- 列顺序和值顺序必须一致。
- 空集合不要调用 Mapper。
- 大批量可以按 500 或 1000 分批。

## `<choose>`

类似 `if / else if / else`。

```xml
<select id="selectOrderList" resultType="org.example.flashmart.order.dto.OrderListItemDO">
    select id, order_no, user_id, status, created_at
    from order_info
    <where>
        <choose>
            <when test="query.orderNo != null and query.orderNo != ''">
                order_no = #{query.orderNo}
            </when>
            <when test="query.userId != null">
                user_id = #{query.userId}
            </when>
            <otherwise>
                created_at &gt;= #{query.startTime}
                and created_at &lt; #{query.endTime}
            </otherwise>
        </choose>
    </where>
    order by created_at desc
</select>
```

适合：

- 有订单号时按订单号精确查。
- 没订单号时按用户查。
- 再没有时按时间范围查。

避免所有条件同时拼上导致索引选择很差。

## `<trim>`

`<trim>` 可以自定义去掉前缀/后缀。

```xml
<trim prefix="where" prefixOverrides="and |or ">
    <if test="status != null">
        and status = #{status}
    </if>
    <if test="userId != null">
        and user_id = #{userId}
    </if>
</trim>
```

`<where>` 和 `<set>` 本质上就是常用 trim 场景。

## SQL 片段复用

字段列表：

```xml
<sql id="BaseColumns">
    id, name, price, status, created_at, updated_at
</sql>

<select id="selectById" resultType="org.example.flashmart.product.entity.ProductDO">
    select
    <include refid="BaseColumns"/>
    from product
    where id = #{productId}
</select>
```

注意：

- 复用片段不要过度抽象。
- 不要把整个复杂查询拆成到处 include，看起来反而更难读。
- 字段片段、固定过滤条件比较适合复用。

## 动态排序

排序字段不能直接信前端。

错误：

```xml
order by ${sortField} ${sortDirection}
```

如果前端传：

```text
id desc; drop table product
```

就有注入风险。

正确做法：Service 白名单转换。

```java
public ProductPageQuery normalize(ProductPageRequest request) {
    String sortColumn = switch (request.sortField()) {
        case "createdAt" -> "created_at";
        case "price" -> "price";
        default -> throw new BizException(ErrorCode.PARAM_INVALID);
    };

    String sortDirection = "asc".equalsIgnoreCase(request.sortDirection()) ? "asc" : "desc";
    return new ProductPageQuery(request.keyword(), request.status(), sortColumn, sortDirection);
}
```

XML：

```xml
order by ${query.sortColumn} ${query.sortDirection}
```

只有白名单处理后的字段才能进 `${}`。

## 分页查询

分页要稳定排序：

```xml
<select id="selectPageByQuery" resultType="org.example.flashmart.product.dto.ProductListItemDO">
    select id, name, price, status, created_at
    from product
    <where>
        deleted = 0
        <if test="query.status != null">
            and status = #{query.status}
        </if>
    </where>
    order by created_at desc, id desc
    limit #{query.offset}, #{query.pageSize}
</select>
```

如果只按 `created_at` 排序，时间相同的数据可能分页漂移。加 `id` 作为第二排序字段更稳定。

深分页要考虑：

```sql
select id
from product
where deleted = 0
order by created_at desc, id desc
limit 100000, 20;
```

这种会很慢。可改成游标分页或先查 ID 再回表。

## 动态 SQL 排查

打开 MyBatis 日志：

```yaml
mybatis:
  configuration:
    log-impl: org.apache.ibatis.logging.stdout.StdOutImpl
```

或者用日志系统输出 SQL。

排查步骤：

```text
1. 打印最终 SQL
2. 拿参数到数据库里执行
3. explain 看索引
4. 检查动态条件是否少拼/多拼
5. 检查集合是否为空
6. 检查排序字段是否白名单
```

## 去空话检查

- [ ] 可选条件用 `<if>`，不是 Java 里拼字符串。
- [ ] 多条件查询用 `<where>` 避免多余 `and`。
- [ ] 更新部分字段用 `<set>`。
- [ ] `in` 查询空集合在 Service 直接返回。
- [ ] `${}` 只接收白名单字段。
- [ ] 分页有稳定排序。
- [ ] 复杂动态 SQL 能拿最终 SQL 去数据库验证。

## 参考

- [MyBatis Dynamic SQL How it Works](https://mybatis.org/mybatis-dynamic-sql/docs/howItWorks.html)
- [MyBatis Java API](https://mybatis.org/mybatis-3/java-api.html)
