---
title: Human-in-the-loop
sidebarTitle: Human-in-the-loop
---

# Human-in-the-loop

> Human-in-the-loop 不是“最后让用户点一下确认”。真正的 HITL 是：在高风险动作执行前暂停、展示上下文、允许批准/修改/拒绝，并能恢复工作流。

## 风险分级

| 风险 | 示例 | 策略 |
| --- | --- | --- |
| `low` | 搜索文档、读取日志 | 直接执行 |
| `medium` | 写草稿、生成文件 | 可选审批 |
| `high` | 发邮件、改数据库、提交 PR | 执行前审批 |
| `critical` | 删除数据、支付、改权限 | 强制审批 + 二次确认 |

风险不是模型说了算。运行时根据工具元数据和参数判断。

```ts
type ToolRiskPolicy = {
  toolName: string
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  approvalRequired: boolean
}
```

## 审批 payload

审批页面不能只显示：

```text
Agent wants to continue. Approve?
```

应该显示：

```json
{
  "runId": "run_123",
  "toolCallId": "call_456",
  "tool": "send_email",
  "risk": "high",
  "reason": "Send payment reminder to customer",
  "arguments": {
    "to": "a***@example.com",
    "subject": "订单待支付提醒",
    "bodyPreview": "你的订单将在 30 分钟后关闭..."
  },
  "dryRun": {
    "willSendEmail": true,
    "recipientCount": 1
  }
}
```

必须让人知道：

- 谁发起。
- 要执行什么工具。
- 影响什么对象。
- 参数是什么。
- 是否可撤销。
- 不批准会怎样。

## 决策类型

不要只有 approve/reject。

| 决策 | 含义 |
| --- | --- |
| `approve` | 按原参数执行 |
| `edit` | 修改参数后执行 |
| `reject` | 拒绝执行，并给原因 |
| `respond` | 让用户补充信息 |
| `delegate` | 转给更高权限的人 |
| `timeout` | 超时自动取消或降级 |

编辑示例：

```json
{
  "decision": "edit",
  "arguments": {
    "subject": "订单支付提醒",
    "body": "请在 30 分钟内完成支付。"
  }
}
```

## 工作流恢复

HITL 必须能暂停后恢复。

运行状态：

```ts
type ApprovalState = {
  runId: string
  toolCallId: string
  status: 'waiting' | 'approved' | 'edited' | 'rejected' | 'expired'
  requestedAt: string
  decidedAt?: string
  decidedBy?: string
  decisionPayload?: unknown
}
```

恢复逻辑：

```ts
async function resumeAfterApproval(runId: string, decision: ApprovalDecision) {
  const state = await loadRunState(runId)
  applyDecision(state, decision)
  return continueRun(state)
}
```

不能把待审批状态只放内存。人可能几个小时后才点。

## 审计日志

每次审批要记录：

```json
{
  "runId": "run_123",
  "toolCallId": "call_456",
  "tool": "send_email",
  "risk": "high",
  "requestedBy": "agent",
  "decidedBy": "user_10001",
  "decision": "approve",
  "createdAt": "2026-06-07T10:00:00Z",
  "decidedAt": "2026-06-07T10:03:00Z"
}
```

审计用途：

- 出事故能查是谁批准。
- 能复盘 Agent 为什么走到这一步。
- 能统计哪些工具经常被拒绝。
- 能发现规则是不是太松或太严。

## 审批 UI

审批 UI 要展示：

- 任务目标。
- Agent 当前计划。
- 高风险工具名。
- 参数摘要。
- 影响对象。
- dry-run 结果。
- approve/edit/reject 按钮。
- 历史 trace 链接。

不要让用户审批原始 JSON。JSON 可以作为展开详情，但主视图要是人能读懂的动作摘要。

## 超时策略

审批不能无限挂着。

```text
低风险：几分钟后自动取消
高风险：等待人工，不自动执行
紧急告警：超时升级给其他人
```

状态变化：

```text
waiting -> approved
waiting -> rejected
waiting -> expired
waiting -> escalated
```

超时后恢复时，要让模型知道审批已经过期，而不是继续假装可以执行。

## 和工具协议的关系

HITL 应该挂在工具调用前：

```text
模型请求工具
  -> 工具 schema 校验
  -> 风险策略判断
  -> 需要审批：暂停
  -> 人类批准
  -> 执行工具
  -> 工具结果回填
```

不要让模型自己决定“我需不需要审批”。模型可以解释原因，但最终由运行时策略判断。

## 去空话检查

- [ ] HITL 发生在高风险工具执行前。
- [ ] 审批 payload 展示影响对象和参数摘要。
- [ ] 支持 approve/edit/reject，不只有 approve。
- [ ] 暂停状态持久化，不只放内存。
- [ ] 决策有审计日志。
- [ ] 超时有策略。
- [ ] 模型不能绕过审批策略。

## 参考

- [LangGraph Human-in-the-loop](https://docs.langchain.com/oss/python/langgraph/human-in-the-loop)
- [LangChain Human-in-the-loop Middleware](https://docs.langchain.com/oss/python/langchain/human-in-the-loop)
- [Microsoft Agent Framework Overview](https://learn.microsoft.com/en-us/agent-framework/overview/)
