---
title: 商品表设计
sidebarTitle: 商品表设计
---

# 商品表设计

> 商品表不能只写 `id、name、price、stock`。真实电商里要先区分 SPU、SKU、库存、图片、详情，否则后面列表查询、下单快照、库存扣减都会变乱。

## 先划业务边界

商品相关数据通常不是一张表解决：

| 表 | 表达什么 | 例子 |
| --- | --- | --- |
| `products` | SPU，商品主信息 | iPhone 16 |
| `product_skus` | SKU，具体可售规格 | 黑色 / 256G |
| `product_inventory` | 库存 | 可售库存、锁定库存 |
| `product_images` | 商品图片 | 主图、轮播图、详情图 |
| `product_detail` | 大文本详情 | 富文本、参数 JSON |
| `categories` | 类目 | 手机、电脑 |

如果项目还简单，可以少建几张。

但不要把所有字段都塞进 `products`：

```text
商品列表页只需要名称、价格、主图、状态。
详情富文本可能很大。
库存扣减并发很高。
SKU 价格可能和 SPU 价格不同。
```

所以至少建议拆：

```text
products:
    商品主信息。

product_skus:
    规格和售价。

product_inventory:
    库存。

product_detail:
    大文本详情。
```

## 商品主表

`products` 表表达 SPU。

```sql
create table products (
    id bigint primary key auto_increment comment '主键ID',
    product_no varchar(64) not null comment '商品编号，对外展示',
    category_id bigint not null comment '类目ID',
    brand_id bigint null comment '品牌ID',
    seller_id bigint not null comment '商家ID',
    product_name varchar(128) not null comment '商品名称',
    main_image varchar(255) null comment '商品主图',
    min_sale_price decimal(10, 2) not null comment '最低销售价，用于列表展示',
    max_sale_price decimal(10, 2) not null comment '最高销售价，用于列表展示',
    sale_count int not null default 0 comment '销量冗余',
    status tinyint not null comment '状态：0草稿，1上架，2下架，3删除',
    sort int not null default 0 comment '排序值',
    version int not null default 0 comment '版本号',
    create_time datetime not null comment '创建时间',
    update_time datetime not null comment '更新时间',
    unique key uk_products_product_no (product_no),
    key idx_products_category_status_sort (category_id, status, sort, id),
    key idx_products_seller_status_time (seller_id, status, create_time),
    key idx_products_status_time (status, create_time)
) engine = InnoDB default charset = utf8mb4 comment = '商品主表';
```

字段解释：

| 字段 | 为什么需要 |
| --- | --- |
| `product_no` | 对外展示和客服查询，不暴露内部主键 |
| `category_id` | 类目列表、筛选、运营后台查询 |
| `seller_id` | 商家后台管理商品 |
| `min_sale_price` / `max_sale_price` | 列表页不用每次聚合 SKU |
| `status` | 上架、下架、删除等状态流转 |
| `sale_count` | 列表排序常用，通常异步更新 |
| `version` | 乐观锁或后台编辑冲突控制 |

## SKU 表

SKU 表表达真正可售规格。

```sql
create table product_skus (
    id bigint primary key auto_increment comment 'SKU ID',
    product_id bigint not null comment '商品ID',
    sku_no varchar(64) not null comment 'SKU编号',
    sku_name varchar(128) not null comment 'SKU名称',
    spec_json json not null comment '规格JSON，如颜色、容量',
    sale_price decimal(10, 2) not null comment '销售价',
    market_price decimal(10, 2) null comment '划线价',
    status tinyint not null comment '状态：0禁用，1启用',
    create_time datetime not null comment '创建时间',
    update_time datetime not null comment '更新时间',
    unique key uk_product_skus_sku_no (sku_no),
    key idx_product_skus_product_status (product_id, status)
) engine = InnoDB default charset = utf8mb4 comment = '商品SKU表';
```

为什么 `spec_json` 可以用 JSON：

```text
规格字段变化很大。
多数查询按 product_id 查全部 SKU。
通常不按颜色、容量单独建复杂索引。
```

如果业务需要按规格检索，比如“黑色手机”，要考虑规格属性表或搜索系统，而不是只靠 JSON。

## 库存表

库存单独拆表。

```sql
create table product_inventory (
    id bigint primary key auto_increment comment '主键ID',
    sku_id bigint not null comment 'SKU ID',
    available_stock int not null comment '可售库存',
    locked_stock int not null default 0 comment '锁定库存',
    sold_stock int not null default 0 comment '已售库存',
    version int not null default 0 comment '版本号',
    create_time datetime not null comment '创建时间',
    update_time datetime not null comment '更新时间',
    unique key uk_product_inventory_sku (sku_id)
) engine = InnoDB default charset = utf8mb4 comment = '商品库存表';
```

下单锁库存：

```sql
update product_inventory
set available_stock = available_stock - #{count},
    locked_stock = locked_stock + #{count},
    update_time = now()
where sku_id = #{skuId}
  and available_stock >= #{count};
```

这条 SQL 的重点：

```text
库存判断和扣减在一条 update 里完成。
updated_rows = 1 表示锁定成功。
updated_rows = 0 表示库存不足或并发失败。
```

不要先查库存再扣：

```text
请求 A 查到库存 1。
请求 B 查到库存 1。
两个请求都认为可以扣。
```

## 图片表

```sql
create table product_images (
    id bigint primary key auto_increment comment '主键ID',
    product_id bigint not null comment '商品ID',
    image_url varchar(255) not null comment '图片地址',
    image_type tinyint not null comment '类型：1主图，2轮播图，3详情图',
    sort int not null default 0 comment '排序值',
    create_time datetime not null comment '创建时间',
    key idx_product_images_product_type_sort (product_id, image_type, sort)
) engine = InnoDB default charset = utf8mb4 comment = '商品图片表';
```

图片拆表的原因：

- 一个商品有多张图。
- 图片列表要排序。
- 列表页通常只要主图。
- 详情页才需要轮播图和详情图。

## 详情表

```sql
create table product_detail (
    id bigint primary key auto_increment comment '主键ID',
    product_id bigint not null comment '商品ID',
    detail_html mediumtext null comment '详情富文本',
    param_json json null comment '参数JSON',
    create_time datetime not null comment '创建时间',
    update_time datetime not null comment '更新时间',
    unique key uk_product_detail_product (product_id)
) engine = InnoDB default charset = utf8mb4 comment = '商品详情表';
```

详情表单独拆，是为了保护列表页：

```text
列表页高频访问。
详情富文本体积大。
如果放在主表，列表查询会读到更多页，影响缓存和 IO。
```

## 商品状态流转

状态不要只写数字，要写清流转：

```text
0 草稿
  -> 1 上架
  -> 2 下架
  -> 1 上架
  -> 3 删除
```

后台编辑时：

```sql
update products
set status = 1,
    update_time = now()
where id = #{productId}
  and status in (0, 2);
```

条件更新可以防止错误状态跳转。

## 主要查询和索引

类目商品列表：

```sql
select id, product_no, product_name, main_image, min_sale_price, sale_count
from products
where category_id = #{categoryId}
  and status = 1
order by sort desc, id desc
limit #{limit};
```

索引：

```sql
key idx_products_category_status_sort (category_id, status, sort, id)
```

商家后台商品列表：

```sql
select id, product_no, product_name, status, create_time
from products
where seller_id = #{sellerId}
  and status = #{status}
order by create_time desc
limit #{offset}, #{limit};
```

索引：

```sql
key idx_products_seller_status_time (seller_id, status, create_time)
```

商品详情：

```sql
select *
from products
where id = #{productId};

select *
from product_skus
where product_id = #{productId}
  and status = 1;

select *
from product_images
where product_id = #{productId}
order by image_type, sort;

select *
from product_detail
where product_id = #{productId};
```

详情查询可以多条 SQL，不一定硬做一个大联表。

原因：

- 每张表数据量不同。
- 图片、SKU 是一对多，联表可能放大行数。
- 分开查更容易缓存和组装。

## 下单时为什么要保存商品快照

订单明细不要只保存 `product_id`、`sku_id`。

要保存：

```sql
product_name varchar(128) not null comment '下单时商品名快照',
sku_name varchar(128) not null comment '下单时SKU名快照',
product_image varchar(255) null comment '下单时商品图快照',
sale_price decimal(10, 2) not null comment '下单时成交单价'
```

原因：

```text
商品会改名、改价、换图。
订单要表达下单那一刻的事实。
不能每次展示订单都回查商品当前数据。
```

## 商品表设计检查清单

- [ ] 是否区分 SPU 和 SKU。
- [ ] 库存是否单独拆表，并用条件更新扣减。
- [ ] 大文本详情是否从主表拆出。
- [ ] 图片是否支持多张和排序。
- [ ] 列表页字段是否尽量来自主表，避免大联表。
- [ ] 每个索引是否对应具体查询。
- [ ] 状态是否有流转规则。
- [ ] 下单是否保存商品快照。
- [ ] 是否避免把搜索需求全部压给 MySQL。

## 关联笔记

- [MySQL 表设计规范](/notes/mysql/table-design)
- [MySQL 多表联查](/notes/mysql/multi-table-join)
- [商品详情查询与缓存案例](/notes/java-backend/product-detail-cache-case)
