---
title: Agent 主循环
sidebarTitle: Agent 主循环
---

# Agent 主循环

> Agent 不是“模型自己会干活”，而是一个运行时循环：构造上下文、调用模型、解析动作、执行工具、回填结果、继续下一轮，直到完成或被拦截。

## 主循环的数据结构

最小运行状态：

```ts
type AgentRunState = {
  runId: string
  userId: string
  task: string
  messages: AgentMessage[]
  tools: ToolDefinition[]
  budget: RunBudget
  status: 'running' | 'waiting_approval' | 'completed' | 'failed'
  trace: AgentTrace
}
```

消息结构：

```ts
type AgentMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: ToolResult }
```

预算结构：

```ts
type RunBudget = {
  maxTurns: number
  remainingTurns: number
  maxToolCalls: number
  remainingToolCalls: number
  maxInputTokens: number
  maxOutputTokens: number
  deadlineMs: number
}
```

这些字段不是“高级设计”，是为了防止 Agent 无限循环、无限花钱、无限调用危险工具。

## 主循环伪代码

```ts
async function runAgent(input: UserInput): Promise<AgentResult> {
  const state = initRunState(input)

  while (state.status === 'running') {
    assertBudget(state.budget)

    const modelInput = buildModelInput(state)
    const modelOutput = await callModel(modelInput)

    appendAssistantMessage(state, modelOutput)
    recordGenerationTrace(state.trace, modelInput, modelOutput)

    if (modelOutput.finalAnswer) {
      state.status = 'completed'
      return buildFinalResult(state, modelOutput.finalAnswer)
    }

    for (const toolCall of modelOutput.toolCalls) {
      const decision = await authorizeToolCall(state, toolCall)
      if (decision.type === 'needs_approval') {
        state.status = 'waiting_approval'
        return buildApprovalResult(state, toolCall)
      }

      const toolResult = await executeToolCall(state, toolCall)
      appendToolResult(state, toolCall.id, toolResult)
      recordToolTrace(state.trace, toolCall, toolResult)
    }
  }

  throw new Error(`agent stopped with status: ${state.status}`)
}
```

关键点：

- 每一轮都检查预算。
- 模型输出不能直接执行，必须先解析和校验。
- 工具调用前有授权。
- 工具结果要回填给模型。
- 生成和工具调用都要进 trace。

## 模型输出的三种形态

| 输出 | 处理 |
| --- | --- |
| 普通文本 | 如果满足任务，作为最终答案 |
| 工具调用 | 校验参数、执行工具、回填结果 |
| 结构化结果 | 按 schema 校验，不通过则重试或失败 |

工具调用输出要和普通文本分开处理：

```json
{
  "toolCalls": [
    {
      "id": "call_001",
      "name": "search_docs",
      "arguments": {
        "query": "Spring transaction propagation"
      }
    }
  ]
}
```

不要让模型输出一段自然语言：

```text
我准备调用 search_docs("MCP Streamable HTTP")
```

然后你用正则猜它要干什么。工具调用必须结构化。

## 工具结果回填

工具结果不是直接给用户，而是进入下一轮上下文：

```json
{
  "role": "tool",
  "toolCallId": "call_001",
  "content": {
    "ok": true,
    "data": [
      {
        "title": "Transaction Propagation",
        "url": "https://docs.spring.io/..."
      }
    ]
  }
}
```

模型下一轮看到工具结果后，再决定：

- 继续调用工具。
- 汇总答案。
- 请求用户补充。
- 进入人工审批。

## 终止条件

Agent 必须有明确终止条件。

| 条件 | 说明 |
| --- | --- |
| `finalAnswer` | 模型给出最终答案 |
| `maxTurns` | 超过最大轮数 |
| `maxToolCalls` | 工具调用过多 |
| `deadlineMs` | 超过时间上限 |
| `waiting_approval` | 高风险工具需要人工审批 |
| `fatal_tool_error` | 工具失败且不可重试 |
| `guardrail_blocked` | 输入/输出/工具被规则拦截 |

没有终止条件的 Agent，生产里一定会遇到无限循环。

## 工具执行前的检查

工具调用不能直接执行。

```text
1. tool name 是否存在
2. arguments 是否符合 schema
3. 当前用户是否有权限
4. 这个工具是否有副作用
5. 是否需要人工审批
6. 是否超过调用频率
7. 是否命中敏感路径或危险参数
```

例子：

```ts
async function authorizeToolCall(state: AgentRunState, call: ToolCall) {
  const tool = findTool(call.name)
  validateJsonSchema(tool.inputSchema, call.arguments)

  if (tool.riskLevel === 'high') {
    return {
      type: 'needs_approval',
      reason: 'high risk tool',
      toolCall: call
    }
  }

  return { type: 'approved' }
}
```

## 上下文构造

每一轮模型调用都不是简单拼接全量历史。

推荐顺序：

```text
system instructions
developer/runtime rules
task brief
available tools
short-term history
retrieved context
compressed prior state
latest user/tool messages
```

上下文构造要做：

- token 预算估算。
- 工具结果裁剪。
- 历史摘要。
- 高优先级规则保留。
- 低价值日志剔除。

如果上下文超过窗口，不能粗暴从开头截断，因为可能把系统约束、任务目标、工具调用因果关系截掉。

## Trace 记录

一次运行至少记录：

```text
run started
model input summary
model output summary
tool call requested
tool call approved / rejected
tool execution result
guardrail result
final answer
run completed / failed
```

Trace 不是给用户看的流水账，而是给开发者排查：

- 为什么选了这个工具。
- 参数从哪里来的。
- 工具为什么失败。
- 哪一轮开始跑偏。
- 成本和延迟花在哪里。

## 错误处理

常见错误：

| 错误 | 处理 |
| --- | --- |
| 模型超时 | 重试一次或降级 |
| 工具参数不合法 | 把错误回填给模型，让它修正 |
| 工具不存在 | 终止并记录配置错误 |
| 工具 5xx | 按工具策略重试 |
| 工具权限不足 | 拒绝并解释 |
| 输出不符合 schema | 让模型按错误修复，限制次数 |
| 预算耗尽 | 返回部分结果和失败原因 |

工具参数错误示例：

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_ARGUMENTS",
    "message": "field `query` is required",
    "retryable": true
  }
}
```

把这个结果回填给模型，比你直接报错更容易让 Agent 自修复。

## 主循环和工作流的边界

简单任务用主循环就够：

```text
用户问题 -> 模型选择工具 -> 工具结果 -> 模型回答
```

复杂任务才需要工作流/图：

- 固定步骤很多。
- 需要人工审批。
- 需要持久化恢复。
- 需要多个角色协作。
- 需要并行执行。
- 有明确状态机。

不要一开始就上复杂图框架。先把单 Agent 主循环写稳。

## 去空话检查

- [ ] 有明确 `RunState`。
- [ ] 有最大轮数、工具次数、时间预算。
- [ ] 模型输出结构化解析，不用正则猜动作。
- [ ] 工具执行前做 schema 校验和权限判断。
- [ ] 工具结果回填给模型。
- [ ] 每轮模型调用和工具调用都有 trace。
- [ ] 有明确终止条件。
- [ ] 错误能区分可重试和不可重试。

## 参考

- [OpenAI Agents SDK](https://platform.openai.com/docs/guides/agents-sdk/)
- [OpenAI Agents SDK Agents](https://openai.github.io/openai-agents-python/agents/)
- [OpenAI Agents SDK Tracing](https://openai.github.io/openai-agents-python/tracing/)
