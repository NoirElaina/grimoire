---
title: A2A 协议
sidebarTitle: A2A 协议
---

# A2A 协议

> A2A 解决的是“一个 Agent 怎么发现、调用、协作另一个独立 Agent”。它不是工具协议，也不是 MCP 的替代品。

## A2A 核心对象

| 对象 | 含义 |
| --- | --- |
| Agent Card | 描述远程 Agent 身份、能力、端点、认证 |
| Message | Agent 之间发送的消息 |
| Part | 消息里的最小内容块，如 text、file、data |
| Task | 一次远程任务 |
| Artifact | Agent 产出的结果文件或结构化产物 |

## Agent Card

Agent Card 是发现入口。

示例：

```json
{
  "name": "order-analysis-agent",
  "description": "Analyze order anomalies and produce investigation reports.",
  "url": "https://agents.example.com/order-analysis",
  "version": "1.0.0",
  "capabilities": {
    "streaming": true,
    "pushNotifications": false
  },
  "skills": [
    {
      "id": "analyze_order",
      "name": "Analyze Order",
      "description": "Analyze a single order by orderNo."
    }
  ],
  "authentication": {
    "schemes": ["Bearer"]
  }
}
```

Agent Card 要回答：

- 这个 Agent 是谁。
- 能做什么。
- 入口在哪里。
- 支持哪些输入输出。
- 怎么认证。
- 是否支持流式。

## Message 和 Part

Message 由多个 Part 组成。

```json
{
  "role": "user",
  "parts": [
    {
      "kind": "text",
      "text": "分析订单 202606070001 为什么超时关闭"
    },
    {
      "kind": "data",
      "data": {
        "orderNo": "202606070001"
      }
    }
  ]
}
```

Part 可以是：

- text。
- file。
- data。

这样比纯文本更适合跨系统传结构化数据。

## Task

调用远程 Agent 时，不是只发一条聊天消息，而是创建或推进一个任务。

```json
{
  "id": "task_123",
  "status": "working",
  "messages": [
    {
      "role": "user",
      "parts": [
        {
          "kind": "text",
          "text": "分析订单异常"
        }
      ]
    }
  ]
}
```

任务状态通常要考虑：

```text
submitted
working
input_required
completed
failed
cancelled
```

如果远程 Agent 需要更多信息，应返回 `input_required`，而不是编造。

## Artifact

远程 Agent 的产物：

```json
{
  "artifacts": [
    {
      "name": "order-analysis-report",
      "parts": [
        {
          "kind": "text",
          "text": "订单超时关闭原因：支付未完成..."
        }
      ]
    }
  ]
}
```

Artifact 可以是：

- 报告。
- 文件。
- JSON 结构。
- 图表。
- 代码补丁。

调用方不要只读最后一句话，要按 artifact 处理结果。

## A2A 和多 Agent 框架的区别

多 Agent 框架通常在一个应用里编排多个角色：

```text
manager agent
  -> researcher agent
  -> writer agent
```

A2A 面向独立系统之间的通信：

```text
客服 Agent
  -> 调用 订单分析 Agent
  -> 调用 退款处理 Agent
```

远程 Agent 可能由另一个团队维护，调用方看不到内部实现。

## 认证和授权

A2A 服务必须认证。

常见：

- Bearer Token。
- OAuth/OIDC。
- mTLS。
- API key。

调用方还要做授权：

```text
当前用户是否能调用这个远程 Agent
这个远程 Agent 是否能访问目标订单
是否需要人工审批
是否允许跨租户
```

不要因为对方也是 Agent，就放开所有数据。

## 调用流程

```text
1. 获取 Agent Card
2. 检查技能、认证、端点
3. 创建任务或发送消息
4. 等待状态变化或订阅流
5. 如果 input_required，补充信息
6. 如果 completed，读取 artifacts
7. 如果 failed，记录错误和 trace
```

伪代码：

```ts
async function callRemoteAgent(orderNo: string) {
  const card = await fetchAgentCard('https://agents.example.com/order-analysis')
  assertSkill(card, 'analyze_order')

  const task = await createTask(card.url, {
    message: {
      role: 'user',
      parts: [
        { kind: 'text', text: '分析订单异常' },
        { kind: 'data', data: { orderNo } }
      ]
    }
  })

  return waitForArtifacts(task.id)
}
```

## 什么时候需要 A2A

适合：

- 多团队维护不同 Agent。
- 每个 Agent 有独立权限和工具。
- 需要跨系统调用。
- 希望隐藏内部实现。
- 需要标准化发现和通信。

不适合：

- 一个应用内部几个函数协作。
- 一个 Agent 调数据库工具。
- 简单工具调用。
- 没有跨系统边界。

内部工具优先 MCP 或普通函数。跨 Agent 系统再考虑 A2A。

## 失败场景

| 失败 | 处理 |
| --- | --- |
| Agent Card 获取失败 | 降级或提示不可用 |
| 技能不存在 | 不调用，返回能力不足 |
| 认证失败 | 刷新 token 或拒绝 |
| input_required | 回到调用方补信息 |
| 远程任务超时 | 取消或异步等待 |
| artifacts 不符合预期 | schema 校验失败 |
| 重复调用 | 用 task id / idempotency key |

## 去空话检查

- [ ] 能区分 A2A 和 MCP。
- [ ] Agent Card 写清身份、能力、端点、认证。
- [ ] Message 用 Part 承载结构化数据。
- [ ] Task 有状态机。
- [ ] 结果按 Artifact 处理。
- [ ] 远程 Agent 调用有认证和授权。
- [ ] 失败状态不让模型编造结果。

## 参考

- [Agent2Agent Protocol Specification](https://google-a2a.github.io/A2A/specification/)
- [Microsoft Agent Framework A2A Documentation](https://learn.microsoft.com/en-us/agent-framework/)
