---
title: MySQL 多表联查
sidebarTitle: 多表联查
---

# MySQL 多表联查

> 多表联查不是把所有表 `join` 到一起。先确认主表、过滤条件、关联基数、索引和返回行数，再决定是联查、分批查，还是让应用层组装。

## 先确定主表

主表通常是过滤最强、结果集最小、最能决定分页的表。

例如用户订单列表：

```sql
select o.id, o.order_no, o.status, o.create_time
from orders o
where o.user_id = #{userId}
order by o.create_time desc
limit #{offset}, #{limit};
```

这里主表是 `orders`。

不要一上来联 `order_items`、`products`、`payments`。

原因：

```text
订单主表决定分页。
订单明细是一对多，联上后会放大行数。
分页结果可能变错。
```

## 常见 join 类型

| 类型 | 含义 | 项目里怎么用 |
| --- | --- | --- |
| `inner join` | 两边都匹配才返回 | 查有支付单的订单 |
| `left join` | 左表保留，右表没有则为 null | 查订单和可能不存在的退款单 |
| `right join` | 右表保留 | 少用，通常改成 `left join` |
| `cross join` | 笛卡尔积 | 极少用于业务查询 |

常用的是：

```sql
from orders o
left join payment_orders p on p.order_id = o.id
```

## `on` 和 `where`

`on` 写关联条件：

```sql
left join payment_orders p on p.order_id = o.id
```

`where` 写主表过滤：

```sql
where o.user_id = #{userId}
```

左连接时要小心：

```sql
select o.id, p.pay_status
from orders o
left join payment_orders p on p.order_id = o.id
where p.pay_status = 1;
```

这会把没有支付单的订单过滤掉，效果接近 `inner join`。

如果想保留订单，只关联成功支付单：

```sql
select o.id, p.pay_status
from orders o
left join payment_orders p
  on p.order_id = o.id
 and p.pay_status = 1
where o.user_id = #{userId};
```

## 一对一联查

订单和支付单如果基本一对一，可以联查：

```sql
select o.id,
       o.order_no,
       o.status,
       p.pay_no,
       p.pay_status
from orders o
left join payment_orders p on p.order_id = o.id
where o.order_no = #{orderNo};
```

索引：

```sql
unique key uk_orders_order_no (order_no)
key idx_payment_orders_order (order_id)
```

这里返回一行或少量行，联查问题不大。

## 一对多联查

订单和订单明细是一对多。

详情页可以联查：

```sql
select o.id,
       o.order_no,
       o.status,
       i.product_id,
       i.product_name,
       i.buy_count
from orders o
join order_items i on i.order_id = o.id
where o.order_no = #{orderNo};
```

索引：

```sql
unique key uk_orders_order_no (order_no)
key idx_order_items_order (order_id)
```

但列表页不推荐这样分页：

```sql
select o.id, o.order_no, i.product_name
from orders o
join order_items i on i.order_id = o.id
where o.user_id = #{userId}
order by o.create_time desc
limit 0, 10;
```

问题：

```text
一个订单有 3 个明细，会变成 3 行。
limit 限制的是 join 后的行，不是订单数量。
列表页可能只返回 4 个订单。
```

更稳：

```sql
select id, order_no, status, create_time
from orders
where user_id = #{userId}
order by create_time desc
limit 0, 10;
```

再批量查明细：

```sql
select *
from order_items
where order_id in (...)
order by order_id, id;
```

应用层按 `order_id` 分组组装。

## 多表联查索引

join 字段必须有索引，尤其是被关联表的外键字段。

```sql
select o.id, i.id
from orders o
join order_items i on i.order_id = o.id
where o.user_id = #{userId};
```

索引：

```sql
key idx_orders_user_time (user_id, create_time)
key idx_order_items_order (order_id)
```

如果 `order_items.order_id` 没索引，MySQL 可能对明细表反复扫描。

检查：

```sql
explain
select o.id, i.id
from orders o
join order_items i on i.order_id = o.id
where o.user_id = 10001;
```

重点看：

- `type` 是否是 `ref`、`eq_ref`、`range`。
- `key` 是否用了预期索引。
- `rows` 是否离谱。
- `Extra` 是否有 `Using temporary`、`Using filesort`。

## 避免 `select *`

联查时不要写：

```sql
select *
from orders o
join order_items i on i.order_id = o.id;
```

问题：

- 字段名冲突，比如两个表都有 `id`、`status`。
- 读取无用字段。
- 大字段被带出来。
- MyBatis 映射容易错。

推荐：

```sql
select o.id as order_id,
       o.order_no,
       o.status as order_status,
       i.id as item_id,
       i.product_name
from orders o
join order_items i on i.order_id = o.id
where o.id = #{orderId};
```

## 先分页再联查

如果必须在列表里展示关联字段，可以先分页主表，再联查。

```sql
select o.id,
       o.order_no,
       p.pay_status
from (
    select id, order_no, create_time
    from orders
    where user_id = #{userId}
    order by create_time desc
    limit #{offset}, #{limit}
) o
left join payment_orders p on p.order_id = o.id
order by o.create_time desc;
```

注意：

- 子查询先把订单数量限制住。
- 外层再关联一对一或少量数据。
- 一对多仍然可能放大行数，要谨慎。

## 聚合联查

统计每个订单的明细数量：

```sql
select o.id,
       o.order_no,
       count(i.id) as item_count
from orders o
left join order_items i on i.order_id = o.id
where o.user_id = #{userId}
group by o.id, o.order_no
order by o.id desc
limit 20;
```

如果数据量大，优先考虑冗余字段：

```sql
orders.item_count
```

原因：

```text
订单明细数量下单后基本不变。
列表页每次 group by 明细表，成本没必要。
```

## 联查还是应用层组装

| 场景 | 推荐 |
| --- | --- |
| 一对一、结果少 | 可以 join |
| 一对多详情页 | 可以 join 或分两次查 |
| 一对多列表分页 | 先查主表，再批量查子表 |
| 多个一对多同时查 | 不要大 join，容易行数爆炸 |
| 字段来自缓存或远程服务 | 应用层组装 |
| 查询需要复杂筛选和排序 | 先用 `EXPLAIN` 验证 |

项目里常见组装方式：

```java
List<OrderDO> orders = orderMapper.selectUserOrders(userId, page);
List<Long> orderIds = orders.stream().map(OrderDO::getId).toList();

List<OrderItemDO> items = orderItemMapper.selectByOrderIds(orderIds);
Map<Long, List<OrderItemDO>> itemMap = items.stream()
        .collect(Collectors.groupingBy(OrderItemDO::getOrderId));
```

## 多表联查常见坑

### 一对多分页错误

`limit` 作用在 join 后结果，不一定是主表数量。

### 左连接被写成内连接

右表条件写在 `where`，导致 null 行被过滤。

### 关联字段没索引

小表没感觉，大表会慢得非常明显。

### 多个一对多一起 join

比如订单同时 join 明细、优惠券、物流轨迹。

```text
3 个明细 * 2 张优惠券 * 5 条物流轨迹 = 30 行。
```

结果行数被乘法放大。

### 只看 SQL 能跑，不看返回行数

联查最怕“数据量一上来就爆”。

写 SQL 时要估算：

- 主表返回多少行。
- 每行关联多少子表记录。
- join 后最终多少行。
- 是否会产生临时表和排序。

## 检查清单

- [ ] 主表是否明确。
- [ ] 过滤条件是否先减少主表结果。
- [ ] join 字段是否有索引。
- [ ] 是否避免 `select *`。
- [ ] 一对多分页是否没有被 join 放大。
- [ ] `left join` 的右表过滤是否写对位置。
- [ ] 是否跑过 `EXPLAIN`。
- [ ] 返回行数是否可控。
- [ ] 是否可以拆成批量查询后应用层组装。

## 关联笔记

- [MySQL 索引与 EXPLAIN](/notes/mysql/indexes-explain)
- [MySQL 索引原理与回表](/notes/mysql/index-principles-covering)
- [Java 常用集合](/notes/java-backend/java-collections)
