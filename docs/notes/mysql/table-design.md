---
title: MySQL 表设计规范
sidebarTitle: 表设计
---

# MySQL 表设计规范

> 表设计不是把字段列出来，而是先把业务对象、访问路径、唯一约束、状态流转和未来变更想清楚。

## 建表前先回答问题

不要一上来写：

```sql
create table orders (...);
```

先写设计说明：

```text
表名：
    orders

业务含义：
    订单主表，一行是一笔订单。

主要写入：
    创建订单。
    支付成功。
    取消订单。
    超时关闭。

主要查询：
    用户按 create_time 倒序分页看订单。
    根据 order_no 查订单详情。
    后台按 status、create_time 查询。
    定时任务扫描待支付且已到关闭时间的订单。

并发风险：
    支付和取消不能同时成功。
    订单号不能重复。
    超时取消不能重复回补库存。

必要约束：
    主键 id。
    唯一 order_no。
    status 条件更新。

必要索引：
    uk_orders_order_no。
    idx_orders_user_time。
    idx_orders_status_close_deadline。
```

这一步决定后面的字段和索引。

如果访问路径没写，索引基本就是猜的。

## 设计一张表的固定流程

建表可以按这个顺序走：

```text
1. 定业务对象
   一行数据到底表达什么。

2. 定生命周期
   创建、修改、删除、状态流转有哪些。

3. 定写入入口
   哪些接口会插入或更新这张表。

4. 定查询入口
   前台列表、详情、后台查询、定时任务分别怎么查。

5. 定唯一约束
   哪些业务字段不能重复，必须由数据库兜底。

6. 定字段类型
   金额、状态、时间、字符串、大文本分别怎么存。

7. 定索引
   每个索引对应哪条 SQL。

8. 定并发策略
   乐观锁、状态机条件更新、唯一键、库存条件扣减。

9. 定迁移策略
   老数据、默认值、回填、线上 DDL 怎么处理。
```

不要把“字段设计”和“索引设计”分开想。

比如商品表里有 `category_id`，不是因为“商品有类目”这么简单，而是因为有这条查询：

```sql
select id, product_name, main_image, min_sale_price
from products
where category_id = #{categoryId}
  and status = 1
order by sort desc, id desc
limit #{limit};
```

所以索引要跟着访问路径走：

```sql
key idx_products_category_status_sort (category_id, status, sort, id)
```

如果某个字段没有展示、过滤、排序、状态流转或唯一约束用途，它可能就不该现在进表。

## 表名和字段命名

推荐：

```text
表名：
    小写下划线。
    使用业务名词。
    不要太缩写。

字段名：
    小写下划线。
    语义明确。
```

示例：

```text
users
orders
order_items
payment_orders
product_inventory
```

不推荐：

```text
t1
tb_order_info_detail_all
orderInfo
USER
```

是否加 `t_` 前缀看团队习惯。

关键是统一。

## 主键设计

常见写法：

```sql
id bigint primary key auto_increment
```

或者分布式 ID：

```sql
id bigint primary key
```

推荐原则：

- 内部主键用 `bigint`。
- 主键不带业务含义。
- 主键不要频繁更新。
- 主键不要用手机号、邮箱、订单号。
- 对外展示用业务单号。

订单表：

```sql
id bigint primary key auto_increment,
order_no varchar(64) not null,
unique key uk_orders_order_no (order_no)
```

这样：

```text
id:
    数据库内部定位。

order_no:
    对外展示、客服查询、业务追踪。
```

## 业务唯一约束

业务唯一性必须由数据库兜住。

比如：

```sql
unique key uk_users_phone (phone)
```

```sql
unique key uk_orders_order_no (order_no)
```

```sql
unique key uk_user_coupon_order (user_id, order_id, coupon_type)
```

不要只靠代码判断是否存在。

错误流程：

```text
请求 A 查询：手机号不存在。
请求 B 查询：手机号不存在。
请求 A 插入成功。
请求 B 也插入成功。
```

唯一索引是最后防线。

Java 里捕获唯一键冲突时，要转成业务语义：

```java
try {
    userMapper.insert(user);
} catch (DuplicateKeyException exception) {
    throw new BusinessException("手机号已被注册");
}
```

## 字段类型选择

### 整数

常用：

| 类型 | 场景 |
| --- | --- |
| `tinyint` | 状态、小枚举、布尔值 |
| `int` | 普通计数、排序值 |
| `bigint` | 主键、用户 ID、订单 ID、库存流水 ID |

状态字段：

```sql
status tinyint not null comment '订单状态：1待支付 2已支付 3已取消'
```

如果状态值要更可读，也可以用 `varchar(32)`：

```sql
status varchar(32) not null comment 'PENDING_PAYMENT/PAID/CANCELED'
```

关键是 Java 里要有枚举，不要散落魔法值。

### 金额

金额用：

```sql
decimal(18, 2) not null
```

不要用：

```sql
double
float
```

原因：

```text
浮点数是近似值，不适合金额。
```

如果系统对金额精度要求更高，也可以用“分”为单位：

```sql
amount_cent bigint not null
```

但这要求前后端和业务展示统一处理。

### 时间

常用：

```sql
create_time datetime not null
update_time datetime not null
pay_time datetime null
cancel_time datetime null
```

业务截止时间建议落具体时间点：

```sql
pay_expire_time datetime not null
close_deadline_time datetime not null
```

不要每次都临时算：

```java
createTime.plusMinutes(15)
```

因为不同订单未来可能有不同超时时长。

### 字符串

常用：

```sql
varchar(64)
varchar(128)
varchar(255)
```

要按业务限制长度。

比如：

```sql
phone varchar(20) not null
order_no varchar(64) not null
email varchar(128) null
avatar_url varchar(255) null
```

不要无脑：

```sql
varchar(4000)
```

字段越大，索引和内存成本越高。

### 大文本

`text`、`longtext` 适合大内容：

- 商品详情。
- 富文本。
- 错误堆栈。
- JSON 快照。

不要把大字段放进高频列表查询。

更稳：

```text
product:
    商品基础字段。

product_detail:
    商品详情大字段。
```

列表页只查基础表。

详情页再查大字段。

### JSON

MySQL 有 `json` 类型。

适合：

- 扩展字段。
- 非核心配置。
- 快照信息。
- 第三方回调原文。

不适合：

- 高频查询条件。
- 核心状态。
- 金额。
- 需要强约束的字段。

比如支付回调原文可以：

```sql
callback_payload json null
```

但支付状态不能藏在 JSON 里。

## null 和默认值

能 `not null` 就尽量 `not null`。

原因：

- Java 映射更稳定。
- 查询条件更简单。
- 聚合统计少踩坑。
- 业务语义更明确。

示例：

```sql
status varchar(32) not null
deleted tinyint not null default 0
create_time datetime not null
update_time datetime not null
```

可以为 null 的字段：

- `pay_time`：未支付时为空。
- `cancel_time`：未取消时为空。
- `remark`：用户没填时为空。

不要混用：

```text
null
''
0
'UNKNOWN'
```

同一个语义只选一种表达。

## 审计字段

常见基础字段：

```sql
create_time datetime not null,
update_time datetime not null
```

如果有后台操作：

```sql
create_by bigint null,
update_by bigint null
```

如果用逻辑删除：

```sql
deleted tinyint not null default 0,
delete_time datetime null
```

注意：

```text
逻辑删除不是所有表都需要。
```

比如订单、支付流水这类核心业务表，通常不做普通意义上的删除，而是通过状态表达。

## 逻辑删除和唯一索引

逻辑删除常见：

```sql
deleted tinyint not null default 0
```

如果用户手机号唯一：

```sql
unique key uk_users_phone (phone)
```

删除后想重新注册同一个手机号，就会冲突。

有几种处理方式：

### 不允许复用

手机号历史上用过就不能再用。

这时保留：

```sql
unique key uk_users_phone (phone)
```

### 允许复用

可以改成：

```sql
unique key uk_users_phone_deleted (phone, deleted)
```

但这只能允许一个已删除记录。

更常见做法是删除时改写唯一字段：

```sql
update users
set deleted = 1,
    phone = concat(phone, '#deleted#', id)
where id = #{id}
```

具体取舍看业务。

不要想当然地给所有表加逻辑删除。

## 状态字段设计

状态字段要能表达业务流转。

订单：

```text
PENDING_PAYMENT
PAID
CANCELED
SHIPPED
FINISHED
```

SQL：

```sql
status varchar(32) not null comment '订单状态'
```

条件更新：

```sql
update orders
set status = 'PAID',
    pay_time = now(),
    update_time = now()
where id = #{orderId}
  and status = 'PENDING_PAYMENT'
  and pay_expire_time >= now();
```

状态字段不能只是展示字段，它经常是并发控制的一部分。

## 订单表示例

```sql
create table orders (
    id bigint primary key auto_increment,
    order_no varchar(64) not null comment '订单号',
    user_id bigint not null comment '用户ID',
    status varchar(32) not null comment '订单状态',
    total_amount decimal(18, 2) not null comment '订单总金额',
    payable_amount decimal(18, 2) not null comment '应付金额',
    pay_expire_time datetime not null comment '用户支付截止时间',
    close_deadline_time datetime not null comment '后台关闭截止时间',
    pay_time datetime null comment '支付时间',
    cancel_time datetime null comment '取消时间',
    create_time datetime not null comment '创建时间',
    update_time datetime not null comment '更新时间',
    unique key uk_orders_order_no (order_no),
    key idx_orders_user_time (user_id, create_time),
    key idx_orders_status_close_deadline (status, close_deadline_time)
) engine = InnoDB default charset = utf8mb4 comment = '订单主表';
```

这张表里每个索引都能解释：

```text
uk_orders_order_no:
    按订单号查详情，兜住订单号唯一。

idx_orders_user_time:
    用户订单列表。

idx_orders_status_close_deadline:
    超时订单扫描。
```

如果某个索引解释不出服务哪条 SQL，就先别建。

## 订单明细表示例

```sql
create table order_items (
    id bigint primary key auto_increment,
    order_id bigint not null comment '订单ID',
    product_id bigint not null comment '商品ID',
    product_name varchar(128) not null comment '下单时商品名快照',
    product_image varchar(255) null comment '下单时商品图快照',
    quantity int not null comment '购买数量',
    unit_price decimal(18, 2) not null comment '下单时单价',
    create_time datetime not null comment '创建时间',
    key idx_order_items_order_id (order_id)
) engine = InnoDB default charset = utf8mb4 comment = '订单明细表';
```

为什么明细表要保存商品快照？

因为商品可能改名、改价、换图。

订单明细要表达：

```text
用户下单那一刻买的是什么。
```

不能每次都回查商品当前信息。

## 支付单表示例

真实支付不建议直接把订单改成 `PAID`。

应该有支付单：

```sql
create table payment_orders (
    id bigint primary key auto_increment,
    payment_no varchar(64) not null comment '支付单号',
    order_id bigint not null comment '订单ID',
    user_id bigint not null comment '用户ID',
    amount decimal(18, 2) not null comment '支付金额',
    channel varchar(32) not null comment '支付渠道',
    status varchar(32) not null comment '支付状态',
    third_trade_no varchar(128) null comment '三方交易号',
    expire_time datetime not null comment '支付单过期时间',
    pay_time datetime null comment '支付成功时间',
    create_time datetime not null,
    update_time datetime not null,
    unique key uk_payment_orders_payment_no (payment_no),
    unique key uk_payment_orders_third_trade_no (third_trade_no),
    key idx_payment_orders_order_id (order_id),
    key idx_payment_orders_status_expire (status, expire_time)
) engine = InnoDB default charset = utf8mb4 comment = '支付单表';
```

这里的唯一约束用于：

- 支付单幂等。
- 第三方回调幂等。

## 建索引前先写 SQL

不要这样：

```text
我觉得 user_id 可能会查，建一个。
我觉得 status 可能会查，建一个。
我觉得 create_time 可能会查，建一个。
```

要先写 SQL：

```sql
select id, order_no, status, payable_amount, create_time
from orders
where user_id = #{userId}
order by create_time desc
limit #{limit};
```

然后建：

```sql
key idx_orders_user_time (user_id, create_time)
```

索引服务 SQL，不服务想象。

## 旧表加字段

旧表已经有数据时，加 `not null` 字段要谨慎。

不推荐：

```sql
alter table orders
    add column pay_expire_time datetime not null;
```

更稳：

```sql
alter table orders
    add column pay_expire_time datetime null;

update orders
set pay_expire_time = date_add(create_time, interval 15 minute)
where pay_expire_time is null;

alter table orders
    modify column pay_expire_time datetime not null;
```

原因：

```text
先让结构变更成功。
再回填旧数据。
最后收紧约束。
```

大表回填不要一次性全表更新，可以分批。

## 大表变更注意

大表 DDL 可能影响线上。

上线前要确认：

- 表有多少行。
- MySQL 版本。
- DDL 是否在线。
- 是否会锁表。
- 是否要低峰执行。
- 是否有回滚方案。
- 是否需要分批回填。

比如：

```sql
alter table orders add index idx_status_time(status, create_time);
```

对小表没感觉。

对千万级大表，可能产生明显 IO 和锁影响。

## 分库分表前的表设计

早期不要为了“以后可能分库分表”过度设计。

但可以提前保留：

- `user_id`。
- `tenant_id`。
- `order_no`。
- 时间字段。
- 趋势递增主键或分布式 ID。

如果未来按用户分片，订单表里必须有：

```sql
user_id bigint not null
```

如果未来多租户，表里必须有：

```sql
tenant_id bigint not null
```

不要等到要分片时才发现核心表没有分片键。

## 表设计检查清单

建表前检查：

- [ ] 一行数据表达的业务对象是否明确。
- [ ] 主键是否稳定、简短、无业务含义。
- [ ] 业务唯一性是否有唯一约束兜底。
- [ ] 高频查询是否都有访问路径。
- [ ] 每个索引是否能对应一条 SQL。
- [ ] 金额是否使用 `decimal` 或分为单位。
- [ ] 状态字段是否有枚举和流转规则。
- [ ] 时间字段是否统一。
- [ ] 大字段是否避开高频列表。
- [ ] 逻辑删除是否真的需要。
- [ ] 旧表迁移是否考虑已有数据。
- [ ] 大表 DDL 是否评估线上影响。

## 去空话检查

这篇表设计笔记没有停留在“字段要合理、索引要优化”这种话。

每个建议都绑定了工程后果：

- 主键和业务单号分离，避免主键带业务变化。
- 唯一索引兜并发，而不是只靠代码查询。
- 状态字段服务条件更新。
- 大字段拆开，保护列表查询。
- 旧表加字段按“nullable、回填、not null”走。
- 每个索引必须解释服务哪条 SQL。

## 参考

- [MySQL Data Types](https://dev.mysql.com/doc/refman/8.4/en/data-types.html)
- [MySQL Multiple-Column Indexes](https://dev.mysql.com/doc/refman/8.4/en/multiple-column-indexes.html)
