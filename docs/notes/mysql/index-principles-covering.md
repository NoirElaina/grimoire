---
title: MySQL 索引原理与回表
sidebarTitle: 索引原理与回表
---

# MySQL 索引原理与回表

索引不是“让 SQL 变快”的魔法。

索引的本质是：用额外的数据结构，减少 MySQL 为了找到目标行需要扫描的数据量。

在 InnoDB 里，理解索引要先抓住两件事：

```text
主键索引 = 聚簇索引，叶子节点存整行数据。
二级索引 = 非主键索引，叶子节点存索引列 + 主键值。
```

## 索引的作用

| 作用 | 说明 |
| --- | --- |
| 减少扫描行数 | 从全表扫描变成按索引定位 |
| 支撑排序 | `ORDER BY` 命中索引顺序时可以少排序 |
| 支撑分组 | `GROUP BY` 命中索引时可以减少临时表 |
| 保证唯一性 | `UNIQUE` 索引保证业务唯一约束 |
| 覆盖查询 | 查询列都在索引里时，不需要回表 |
| 加速关联 | join 条件列有索引时减少嵌套循环成本 |

索引同时也有成本：

- 占磁盘空间。
- 写入时要维护索引。
- 更新索引列会增加页分裂和随机 IO。
- 索引太多会拖慢 `INSERT` / `UPDATE` / `DELETE`。
- 优化器可能选错索引，需要统计信息和 SQL 形态配合。

## MySQL 常见索引数据结构

不要把“MySQL 索引”只理解成一种结构。

常见结构大致是：

| 索引类型 | 常见结构 | 典型场景 |
| --- | --- | --- |
| InnoDB 普通索引 | B+Tree | 主键、唯一索引、普通索引、联合索引 |
| InnoDB FULLTEXT | 倒排索引 | 文本分词检索 |
| SPATIAL 索引 | R-Tree | 空间数据 |
| MEMORY hash index | Hash | 内存表等值查询 |

日常后端项目里，说 MySQL 索引结构，通常重点说 InnoDB 的 B+Tree。

因为大多数业务表都是：

```sql
engine = InnoDB
```

而 InnoDB 的主键索引、唯一索引、普通索引、联合索引都围绕 B+Tree 展开。

## InnoDB 为什么常用 B+Tree

InnoDB 普通索引使用 B+Tree 结构。

它适合数据库的原因：

- 多叉树高度低，减少磁盘 IO。
- 节点按 key 有序，支持范围查询。
- 叶子节点之间有链表，适合顺序扫描。
- 查询、排序、范围查都能兼顾。

简化结构：

```text
root page
  -> internal page
      -> leaf page
          -> key + row data / primary key
```

不要把 MySQL 索引理解成普通二叉树。

磁盘数据库关心的是页访问次数，不是单纯比较次数。

## B 树和 B+Tree 的区别

简单来说：

```text
数据库索引更偏向 B+Tree，因为它更适合磁盘页、范围查询和顺序扫描。
```

对比：

| 点 | B 树 | B+Tree |
| --- | --- | --- |
| 数据存放 | 内部节点和叶子节点都可能存数据 | 真实数据主要在叶子节点 |
| 内部节点 | 存 key，也可能存 row data | 只存 key 和指针，能放更多 key |
| 树高度 | 同样数据量下可能更高 | 分叉更多，树高度更低 |
| 等值查询 | 命中内部节点可能直接返回 | 一般走到叶子节点 |
| 范围查询 | 需要中序遍历，复杂一些 | 叶子节点有序链表，天然适合范围扫描 |
| 磁盘 IO | 内部节点存数据会降低 fanout | 内部节点更小，减少页访问 |

为什么 B+Tree 更适合 MySQL：

```text
一页通常是固定大小。
内部节点不存整行数据，就能放更多 key。
key 越多，分叉越多，树越矮。
树越矮，磁盘 IO 越少。
```

范围查询也更自然：

```sql
select *
from orders
where create_time >= '2026-06-01'
  and create_time < '2026-06-02';
```

B+Tree 可以先定位到第一个满足条件的叶子节点，再沿着叶子链表向后扫。

这就是它适合：

- 等值查询。
- 范围查询。
- 排序。
- 分页。
- 联合索引最左前缀。

的原因。

## 聚簇索引

InnoDB 表一定有聚簇索引。

选择顺序：

```text
1. 如果有 PRIMARY KEY，用主键作为聚簇索引。
2. 如果没有主键，用第一个所有列 NOT NULL 的 UNIQUE 索引。
3. 如果都没有，InnoDB 生成隐藏 row id。
```

聚簇索引叶子节点存整行数据：

```text
PRIMARY KEY(id)

叶子节点：
id = 1001
name = "Alice"
age = 20
status = 1
create_time = ...
```

所以通过主键查很快：

```sql
SELECT * FROM user WHERE id = 1001;
```

一次走到主键索引叶子节点，就拿到整行。

## 二级索引

二级索引叶子节点不存整行。

它存：

```text
二级索引列 + 主键值
```

例如：

```sql
CREATE INDEX idx_user_status ON user(status);
```

二级索引叶子节点类似：

```text
status = 1, id = 1001
status = 1, id = 1002
status = 2, id = 1003
```

如果查询：

```sql
SELECT * FROM user WHERE status = 1;
```

流程：

```text
1. 走 idx_user_status 找到 id。
2. 再拿 id 去主键聚簇索引查整行。
```

第二步就是回表。

## 什么是回表

回表是指：

```text
通过二级索引找到主键后，再回到主键索引查整行数据。
```

示例：

```sql
CREATE INDEX idx_order_user_id ON orders(user_id);

SELECT id, user_id, order_no, amount
FROM orders
WHERE user_id = 10086;
```

如果 `idx_order_user_id` 里只有 `user_id`，叶子节点只带 `user_id + id`。

`order_no`、`amount` 不在索引里。

MySQL 必须：

```text
idx_order_user_id
  -> 找到 id
  -> PRIMARY KEY(id)
  -> 拿 order_no、amount
```

这就是回表。

## 回表为什么慢

回表慢不在于“多查一次”这么简单。

关键是：

- 二级索引扫描可能命中很多行。
- 每一行都要去主键索引查。
- 主键查可能是随机 IO。
- 回表次数多时，成本会很高。

如果二级索引命中 10 行，回表不明显。

如果命中 10 万行，回表会很痛。

## 覆盖索引

覆盖索引是指：

```text
查询需要的列都能从索引里拿到，不需要回表。
```

例如：

```sql
CREATE INDEX idx_order_user_status_no
ON orders(user_id, status, order_no);

SELECT user_id, status, order_no
FROM orders
WHERE user_id = 10086
  AND status = 1;
```

查询列：

```text
user_id
status
order_no
```

都在联合索引里。

MySQL 不需要回主键索引拿整行。

`EXPLAIN` 的 `Extra` 里常见：

```text
Using index
```

表示使用了覆盖索引。

## 如何减少回表

### 1. 不要 `SELECT *`

只查业务需要的列。

```sql
-- 差
SELECT * FROM orders WHERE user_id = 10086;

-- 好
SELECT id, order_no, status
FROM orders
WHERE user_id = 10086;
```

查的列越少，越容易被索引覆盖。

### 2. 建联合索引覆盖高频查询

高频查询：

```sql
SELECT id, order_no, status
FROM orders
WHERE user_id = ?
ORDER BY create_time DESC
LIMIT 20;
```

可以考虑：

```sql
CREATE INDEX idx_order_user_time_cover
ON orders(user_id, create_time, id, order_no, status);
```

注意：覆盖索引不是把所有字段都塞进去。

只覆盖高频、稳定、收益明显的查询。

### 3. 用延迟关联优化深分页

差：

```sql
SELECT *
FROM orders
WHERE user_id = 10086
ORDER BY create_time DESC
LIMIT 100000, 20;
```

优化：

```sql
SELECT o.*
FROM orders o
JOIN (
  SELECT id
  FROM orders
  WHERE user_id = 10086
  ORDER BY create_time DESC
  LIMIT 100000, 20
) t ON o.id = t.id;
```

子查询只走索引拿 id，最后只回表 20 行。

### 4. 主键不要太长

InnoDB 二级索引叶子节点会存主键值。

如果主键很长，所有二级索引都会变大。

例如用很长的字符串做主键，会让二级索引膨胀。

工程里常用：

- `BIGINT` 自增或雪花 id。
- 短且稳定的业务唯一键另建唯一索引。

### 5. 控制低选择性索引

例如：

```sql
status TINYINT
```

如果只有 0、1、2 三个值，单独给 `status` 建索引通常收益不高。

可以放进联合索引：

```sql
CREATE INDEX idx_order_user_status_time
ON orders(user_id, status, create_time);
```

让高选择性列在前。

## 联合索引怎么理解

联合索引：

```sql
CREATE INDEX idx_user_status_time
ON orders(user_id, status, create_time);
```

索引顺序可以理解为：

```text
先按 user_id 排序
user_id 相同再按 status 排序
status 相同再按 create_time 排序
```

能用：

```sql
WHERE user_id = ?
WHERE user_id = ? AND status = ?
WHERE user_id = ? AND status = ? ORDER BY create_time
```

不一定能充分用：

```sql
WHERE status = ?
WHERE create_time > ?
```

这就是最左前缀原则。

## 范围条件对索引的影响

联合索引中遇到范围条件后，后面的列通常不能继续用于精确定位。

例如：

```sql
CREATE INDEX idx_user_time_status
ON orders(user_id, create_time, status);

SELECT *
FROM orders
WHERE user_id = ?
  AND create_time > ?
  AND status = 1;
```

`user_id` 能定位。

`create_time > ?` 是范围。

`status` 很可能不能继续用于索引精确过滤，只能在扫描后过滤。

所以联合索引顺序要结合：

- 等值条件。
- 范围条件。
- 排序字段。
- 选择性。
- 查询频率。

## EXPLAIN 看什么

重点字段：

| 字段 | 关注点 |
| --- | --- |
| `type` | 访问类型，`const`、`ref`、`range` 通常比 `ALL` 好 |
| `key` | 实际使用的索引 |
| `rows` | 预估扫描行数 |
| `filtered` | 过滤比例 |
| `Extra` | `Using index`、`Using where`、`Using filesort`、`Using temporary` |

常见判断：

```text
Using index：覆盖索引。
Using index condition：索引条件下推。
Using filesort：需要额外排序。
Using temporary：可能用了临时表。
ALL：全表扫描。
```

不要只看有没有用索引。

要看扫描多少行、是否回表、是否排序、是否临时表。

## 工程检查清单

- [ ] 高频 SQL 是否有对应索引。
- [ ] 是否避免 `SELECT *`。
- [ ] 是否知道查询是否回表。
- [ ] 是否用覆盖索引减少回表。
- [ ] 联合索引顺序是否符合查询条件。
- [ ] 范围条件是否截断了后续索引利用。
- [ ] 低选择性字段是否没有单独乱建索引。
- [ ] 深分页是否避免大量回表。
- [ ] 主键是否短、稳定、适合做聚簇索引。
- [ ] 是否用 `EXPLAIN` 验证，而不是凭感觉建索引。

## 参考

- [MySQL InnoDB Indexes](https://dev.mysql.com/doc/refman/8.4/en/innodb-indexes.html)
- [MySQL Clustered and Secondary Indexes](https://dev.mysql.com/doc/refman/8.1/en/innodb-index-types.html)
- [MySQL Optimizing Queries with EXPLAIN](https://dev.mysql.com/doc/refman/8.4/en/using-explain.html)
- [MySQL How MySQL Uses Indexes](https://dev.mysql.com/doc/refman/8.4/en/mysql-indexes.html)
