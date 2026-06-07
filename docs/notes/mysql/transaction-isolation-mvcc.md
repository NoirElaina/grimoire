---
title: MySQL 事务隔离与 MVCC
sidebarTitle: 事务隔离与 MVCC
---

# MySQL 事务隔离与 MVCC

事务不是 `@Transactional` 的语法问题。

事务解决的是：

```text
多个 SQL 要么一起成功，要么一起失败；
并发执行时，还要尽量看起来像一个正确的顺序。
```

MySQL InnoDB 的事务核心要理解三块：

- ACID。
- 隔离级别。
- MVCC + 锁。

## ACID

| 特性 | 含义 | 工程例子 |
| --- | --- | --- |
| Atomicity 原子性 | 一个事务内的操作要么都成功，要么都回滚 | 创建订单、扣库存、写明细必须一起成败 |
| Consistency 一致性 | 事务前后数据满足约束 | 转账前后总金额不凭空变化 |
| Isolation 隔离性 | 并发事务之间不能随便互相干扰 | A 事务未提交的数据 B 不能乱读 |
| Durability 持久性 | 提交后数据不能因为普通故障丢失 | commit 后宕机恢复仍能看到数据 |

ACID 不是口号。

业务写事务时要问：

```text
哪些 SQL 必须原子提交？
哪些约束必须由数据库保证？
并发时允许看到什么？
提交后如何保证可恢复？
```

## 并发异常

| 异常 | 含义 |
| --- | --- |
| 脏读 | 读到别人未提交的数据 |
| 不可重复读 | 同一事务内两次读同一行，结果不同 |
| 幻读 | 同一事务内两次按条件查询，出现新增或消失的行 |
| 丢失更新 | 两个事务基于旧值更新，后提交覆盖先提交 |
| 写偏斜 | 两个事务各自读到满足条件，然后分别写不同数据，最终破坏约束 |

隔离级别就是在性能和异常控制之间取舍。

## MySQL 隔离级别

InnoDB 支持四个隔离级别：

| 隔离级别 | 脏读 | 不可重复读 | 幻读 | 常见用途 |
| --- | --- | --- | --- | --- |
| `READ UNCOMMITTED` | 可能 | 可能 | 可能 | 几乎不用 |
| `READ COMMITTED` | 避免 | 可能 | 可能 | 高并发读写、减少锁冲突 |
| `REPEATABLE READ` | 避免 | 避免 | InnoDB 配合 next-key lock 处理很多场景 | MySQL 默认，核心业务常用 |
| `SERIALIZABLE` | 避免 | 避免 | 避免 | 特殊强一致、排查并发问题 |

MySQL InnoDB 默认：

```sql
SELECT @@transaction_isolation;
-- REPEATABLE-READ
```

## READ COMMITTED

特点：

```text
每次普通 SELECT 都生成新的 ReadView。
```

所以一个事务内两次读同一行，可能看到别的事务刚提交的新版本。

适合：

- 普通后台系统。
- 对重复读要求不强。
- 希望减少 gap lock 影响。
- 高并发更新下希望减少锁冲突。

风险：

- 同一事务内多次查询结果可能不同。
- 业务不能假设“第一次读到的值一直不变”。

## REPEATABLE READ

特点：

```text
同一个事务中第一次一致性读生成 ReadView；
后续普通 SELECT 复用这个 ReadView。
```

所以同一事务内多次普通查询看到同一个快照。

适合：

- MySQL 默认。
- 核心交易。
- 需要同一事务内读结果稳定。
- 配合行锁、唯一索引、条件更新控制并发。

注意：

`REPEATABLE READ` 下普通快照读和当前读不是一回事。

```sql
-- 快照读：走 MVCC
SELECT * FROM account WHERE id = 1;

-- 当前读：读最新已提交版本，并加锁
SELECT * FROM account WHERE id = 1 FOR UPDATE;
```

## SERIALIZABLE

特点：

```text
把并发事务尽量串行化。
```

一致性强，但并发性能差。

适合：

- 特殊强一致场景。
- XA / 分布式事务特殊场景。
- 排查并发问题。

普通业务不要轻易全局改成 `SERIALIZABLE`。

## MVCC 是什么

MVCC 是 Multi-Version Concurrency Control，多版本并发控制。

核心思想：

```text
写操作创建新版本。
读操作根据事务视图选择可见版本。
读写尽量不互相阻塞。
```

InnoDB 通过这些东西实现 MVCC：

- 隐藏字段。
- undo log。
- ReadView。

## 隐藏字段

InnoDB 行记录里有隐藏信息，常用来理解 MVCC：

| 字段 | 含义 |
| --- | --- |
| `trx_id` | 最近一次修改该行的事务 id |
| `roll_pointer` | 指向 undo log 中旧版本 |
| `row_id` | 没有主键时生成的隐藏行 id |

更新一行时，不是简单覆盖后旧值消失。

旧版本会通过 undo log 串起来。

```text
当前版本 trx_id=100
  -> undo 旧版本 trx_id=90
    -> undo 更旧版本 trx_id=80
```

## ReadView

ReadView 可以理解为一次快照读的可见性规则。

它记录：

- 当前活跃事务列表。
- 最小活跃事务 id。
- 下一个将要分配的事务 id。
- 当前事务 id。

判断某个版本是否可见时，大致看：

```text
这个版本是不是当前事务自己改的？
这个版本对应的事务是否已经提交？
这个版本是否属于快照创建之后才出现的事务？
```

如果当前版本不可见，就沿着 undo log 找旧版本。

直到找到可见版本，或者找不到。

## RC 和 RR 下 MVCC 的差别

关键差别：

```text
READ COMMITTED：每次 SELECT 都创建新的 ReadView。
REPEATABLE READ：一个事务内第一次 SELECT 创建 ReadView，后续复用。
```

示例：

```text
T1 开启事务
T1 SELECT balance = 100

T2 UPDATE balance = 200
T2 COMMIT

T1 再次 SELECT
```

在 `READ COMMITTED`：

```text
T1 第二次 SELECT 看到 200。
```

在 `REPEATABLE READ`：

```text
T1 第二次普通 SELECT 仍看到 100。
```

但如果 T1 执行当前读：

```sql
SELECT * FROM account WHERE id = 1 FOR UPDATE;
```

它会读取当前最新已提交版本，并加锁。

## 快照读和当前读

### 快照读

普通 `SELECT`：

```sql
SELECT * FROM account WHERE id = 1;
```

特点：

- 不加锁。
- 走 MVCC。
- 读事务可见版本。

### 当前读

这些是当前读：

```sql
SELECT * FROM account WHERE id = 1 FOR UPDATE;
SELECT * FROM account WHERE id = 1 LOCK IN SHARE MODE;
UPDATE account SET balance = balance - 100 WHERE id = 1;
DELETE FROM account WHERE id = 1;
INSERT INTO account ...;
```

特点：

- 读取最新已提交版本。
- 需要加锁。
- 用于写入或写前检查。

业务并发控制不能只靠快照读。

例如扣款必须：

```sql
UPDATE account
SET balance = balance - 100
WHERE id = 1
  AND balance >= 100;
```

用条件更新让数据库保证原子判断和修改。

## 不同隔离级别怎么选

| 场景 | 建议 |
| --- | --- |
| 普通查询系统 | `READ COMMITTED` 或默认 `REPEATABLE READ` 都可，按团队统一 |
| 核心交易写入 | 默认 `REPEATABLE READ`，配合行锁、唯一索引、条件更新 |
| 报表批量读取 | 可以考虑 `READ COMMITTED`，减少长事务快照和 undo 压力 |
| 高并发更新 | 重点不是盲目升隔离级别，而是缩短事务、条件更新、避免大范围锁 |
| 需要严格串行 | 小范围使用 `SERIALIZABLE` 或显式锁，不建议全局 |

## 常见误区

### 误区 1：RR 就不会有并发问题

`REPEATABLE READ` 只是隔离级别。

余额扣减、库存扣减仍要靠：

- 条件更新。
- 唯一约束。
- 行锁。
- 版本号。
- 幂等表。

### 误区 2：MVCC 不需要锁

MVCC 主要优化读。

写写冲突仍需要锁。

当前读也需要锁。

### 误区 3：事务越大越安全

事务越大：

- 锁持有越久。
- undo log 压力越大。
- 死锁概率越高。
- 连接占用越久。

事务边界要小。

外部 RPC、MQ 发送、文件上传不要放在数据库事务里。

## 工程检查清单

- [ ] 是否知道当前库默认隔离级别。
- [ ] 是否区分快照读和当前读。
- [ ] 核心扣减是否用条件更新，而不是先查再改。
- [ ] 是否用唯一索引兜住幂等和唯一性。
- [ ] 事务里是否避免外部调用。
- [ ] 长事务是否会导致 undo log 压力。
- [ ] 是否用 `SELECT ... FOR UPDATE` 明确写前锁定。
- [ ] 是否知道 `READ COMMITTED` 和 `REPEATABLE READ` 的 ReadView 差异。
- [ ] 是否用测试复现并发场景，而不是靠想象。

## 参考

- [MySQL Transaction Isolation Levels](https://dev.mysql.com/doc/refman/8.4/en/innodb-transaction-isolation-levels.html)
- [MySQL Consistent Nonlocking Reads](https://dev.mysql.com/doc/refman/8.4/en/innodb-consistent-read.html)
- [MySQL InnoDB Multi-Versioning](https://dev.mysql.com/doc/refman/8.4/en/innodb-multi-versioning.html)
