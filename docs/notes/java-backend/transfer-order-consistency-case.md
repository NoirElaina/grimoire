---
title: 转账与订单一致性案例
sidebarTitle: 转账与订单一致性
---

# 转账与订单一致性案例

转账和订单创建都属于强一致业务。

核心不是“加事务”三个字，而是：

```text
钱、库存、订单、消息、外部平台这些状态，哪些能在一个本地事务内提交，哪些只能靠补偿和对账。
```

## 本地转账的核心逻辑

如果转账发生在同一个数据库里，优先用本地事务。

核心步骤：

```text
1. 校验转账请求。
2. 生成 transfer_no 幂等号。
3. 查询转出账户和转入账户。
4. 冻结或扣减转出账户余额。
5. 增加转入账户余额。
6. 写资金流水。
7. 更新转账单状态。
8. 提交事务。
```

不要写成：

```text
先查余额，再 Java 里判断，再 update。
```

更稳的扣款 SQL：

```sql
UPDATE account
SET balance = balance - #{amount}
WHERE id = #{fromAccountId}
  AND balance >= #{amount};
```

根据影响行数判断扣款是否成功。

这一步把“余额校验”和“扣减”合成一个原子操作。

## 本地转账事务示例

```java
@Transactional(rollbackFor = Exception.class)
public void transfer(TransferCommand command) {
    String transferNo = command.transferNo();

    if (transferMapper.existsByTransferNo(transferNo)) {
        return;
    }

    transferMapper.insertPendingTransfer(command);

    int debitRows = accountMapper.debit(
            command.fromAccountId(),
            command.amount()
    );
    if (debitRows != 1) {
        throw new BizException("BALANCE_NOT_ENOUGH");
    }

    int creditRows = accountMapper.credit(
            command.toAccountId(),
            command.amount()
    );
    if (creditRows != 1) {
        throw new BizException("TARGET_ACCOUNT_NOT_FOUND");
    }

    accountFlowMapper.insertDebitFlow(command);
    accountFlowMapper.insertCreditFlow(command);
    transferMapper.markSuccess(transferNo);
}
```

数据库约束必须兜底：

```sql
ALTER TABLE transfer_order
ADD UNIQUE KEY uk_transfer_no (transfer_no);

ALTER TABLE account_flow
ADD UNIQUE KEY uk_flow_no (flow_no);
```

没有唯一约束，幂等只靠代码判断不可靠。

## 跨平台转账为什么不能直接回滚

跨平台转账通常涉及：

```text
本系统账户
第三方支付平台
银行通道
清结算系统
MQ
对账系统
```

问题是：

```text
本地数据库事务不能回滚第三方已经成功的扣款。
```

例如：

```text
1. 本地扣减余额成功。
2. 调用第三方转账成功。
3. 本地更新状态失败。
```

这时不能简单说“事务回滚”。

第三方钱已经动了。

正确思路是状态机 + 幂等 + 补偿 + 对账。

## 跨平台转账状态机

转账单不要只有成功/失败。

推荐状态：

```text
INIT
  -> LOCAL_DEBIT_SUCCESS
  -> CHANNEL_SUBMITTED
  -> CHANNEL_SUCCESS
  -> SUCCESS

INIT
  -> LOCAL_DEBIT_SUCCESS
  -> CHANNEL_FAILED
  -> COMPENSATING
  -> COMPENSATED
  -> FAILED
```

状态流转必须单向。

不要随便把 `SUCCESS` 改回 `FAILED`。

示例：

```sql
UPDATE transfer_order
SET status = 'CHANNEL_SUCCESS'
WHERE transfer_no = #{transferNo}
  AND status = 'CHANNEL_SUBMITTED';
```

带旧状态条件，防止乱跳。

## 跨平台转账核心设计

### 1. 幂等号

每次转账要有全局业务单号：

```text
transfer_no
request_id
channel_request_no
```

作用：

- 防止重复扣款。
- 第三方重复请求可识别。
- 回调重复可识别。
- 对账能关联。

### 2. 本地事务只包本地数据

本地事务内做：

- 创建转账单。
- 扣减余额或冻结余额。
- 写流水。
- 写 outbox 事件。

不在事务里做：

- 调第三方接口。
- 发 MQ。
- 发送短信。
- 调远程服务。

### 3. 事务提交后发起外部动作

可以用 outbox：

```text
本地事务：
  transfer_order
  account_balance
  account_flow
  outbox_event

异步任务：
  扫描 outbox_event
  调第三方转账
  更新转账状态
```

这样本地事务和外部动作解耦。

### 4. 回调和查询双通道

第三方回调可能丢。

所以要：

- 接收异步回调。
- 定时主动查询。
- 每日对账。

不能只依赖回调。

### 5. 补偿

第三方失败时，如果本地已经扣款，要补偿。

补偿不是数据库 rollback。

补偿是新事务：

```text
插入退款/冲正流水。
把余额加回去。
把转账单置为 COMPENSATED。
记录补偿原因。
```

## 订单创建后续失败怎么处理

分布式订单创建常见链路：

```text
创建订单
  -> 扣库存
  -> 锁优惠券
  -> 发 MQ
  -> 等支付
  -> 超时关闭
```

如果这些都在一个本地库里，可以用本地事务。

如果跨服务、跨库、跨 MQ，就不能靠一个 `rollback` 解决。

要先区分失败发生在哪里。

## 失败点分类

| 失败点 | 是否能本地回滚 | 处理 |
| --- | --- | --- |
| 订单插入失败 | 可以 | 本地事务回滚 |
| 库存扣减失败 | 可以，如果同库同事务 | 回滚订单 |
| 优惠券锁定失败 | 如果远程服务，不能直接回滚 | 取消订单 + 释放已扣资源 |
| MQ 发送失败 | 本地事务已提交后不能回滚订单 | outbox 重试 |
| 支付创建失败 | 不能回滚已经提交订单 | 订单进入待支付失败/关闭流程 |
| 下游服务成功但本地更新失败 | 不能让下游自动回滚 | 对账 + 补偿 |

## 三种一致性方案

### 1. 本地事务

适合：

```text
订单、库存、订单明细都在同一个数据库。
```

流程：

```text
begin
  insert order
  insert order_item
  update stock set stock = stock - n where stock >= n
commit
```

失败直接 rollback。

### 2. TCC

Try / Confirm / Cancel。

```text
Try：冻结资源
Confirm：确认扣减
Cancel：释放冻结
```

适合：

- 金额。
- 库存。
- 优惠券。
- 需要明确预留资源的场景。

难点：

- 每个参与方都要实现三套接口。
- Confirm / Cancel 必须幂等。
- 空回滚、悬挂、防重都要处理。

### 3. Saga

把长事务拆成多个本地事务，每一步都有补偿。

```text
创建订单
  -> 扣库存
  -> 锁优惠券
  -> 创建支付单

失败补偿：
  -> 关闭支付单
  -> 释放优惠券
  -> 释放库存
  -> 取消订单
```

适合：

- 流程长。
- 不要求强一致立即完成。
- 可以接受最终一致。

难点：

- 补偿不是万能。
- 补偿也可能失败。
- 需要状态机和重试。

## 可靠消息方案

订单创建成功后，发送事件给下游：

```text
OrderCreatedEvent
```

不要在本地事务中直接依赖 MQ 成功。

推荐：

```text
本地事务：
  insert order
  update stock
  insert outbox_event

提交后：
  outbox sender 发送 MQ
  发送成功 mark sent
  发送失败继续重试
```

消费者：

```text
按 message_id 幂等。
处理成功再 ack。
处理失败进入重试或死信。
```

## 后续失败的处理原则

不要问：

```text
怎么把整个分布式流程回滚？
```

要问：

```text
哪些资源已经成功占用？
每个资源有没有补偿动作？
补偿动作是否幂等？
补偿失败怎么重试？
最终状态怎么对账？
```

订单最终状态示例：

```text
CREATING
CREATED
PAYING
PAID
CANCELING
CANCELED
FAILED
COMPENSATING
COMPENSATED
```

状态机要允许中间态。

不要只有成功/失败。

## 工程检查清单

- [ ] 本地事务是否只包本地数据库操作。
- [ ] 是否有全局业务单号和幂等约束。
- [ ] 金额和库存是否用条件更新。
- [ ] 外部调用是否移出数据库事务。
- [ ] 是否有 outbox 或事务提交后消息机制。
- [ ] 下游消费者是否幂等。
- [ ] 是否有状态机，而不是布尔状态。
- [ ] 每个成功占用的资源是否有补偿动作。
- [ ] 补偿动作是否幂等、可重试、可对账。
- [ ] 是否有定时扫描处理中间态订单。

## 参考

- [MySQL 事务隔离与 MVCC](/notes/mysql/transaction-isolation-mvcc)
- [本地事务与外部副作用](/notes/java-backend/transaction-outbox-side-effects)
- [RabbitMQ 事务同步与 MQ](/notes/rabbitmq/transaction-after-commit)
- [MQ 幂等](/notes/rabbitmq/message-idempotency)
