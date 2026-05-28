---
title: 工具调用
sidebarTitle: 工具调用
---

# 工具调用

Agent 接工具时，不要把重点放在“模型能不能调函数”。真正要做的是一层可控的执行系统：

```text
Model tool call
  -> Tool Registry
  -> Tool Gate
  -> Tool Dispatcher
  -> Tool Execute
  -> Result Normalize
  -> Agent Loop
```

这篇只记工程实现：工具怎么定义、怎么拦截、怎么执行、怎么回填给模型。

## 先给结论

一个最小可维护工具系统至少要有这些东西：

| 层 | 作用 |
| --- | --- |
| `ToolDefinition` | 定义工具名、描述、参数、风险和执行函数 |
| `ToolRegistry` | 统一注册和按名字查找工具 |
| `ToolGate` | 决定允许、拒绝，还是需要用户确认 |
| `ToolDispatcher` | 统一做参数校验、权限判断、执行、异常捕获 |
| `NormalizedToolResult` | 把不同工具结果归一成模型容易理解的格式 |
| `ToolEvent` | 记录工具开始、成功、失败，方便 UI 和排查 |

原则很简单：

**模型只负责提出工具调用；Host 负责决定能不能执行以及怎么执行。**

## 先分清 3 类工具

工具要按风险分层，不要都当成普通函数。

| 类型 | 示例 | 策略 |
| --- | --- | --- |
| `read` | 读文件、搜索代码、查文档 | 默认可放行，但仍要限制范围 |
| `write` | 写文件、改配置、创建分支 | 需要工作区边界和模式控制 |
| `external` | 发 Slack、部署、调用生产接口 | 通常需要确认、审计、鉴权 |

后面的 Gate、日志、确认流程都依赖这个风险等级。

## 最小类型定义

可以先把工具合同写成这样：

```ts
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z, type ZodTypeAny } from 'zod'

export type ToolRisk = 'read' | 'write' | 'external'

export type ToolMode = 'read-only' | 'safe-write' | 'full-access'

export type ToolContext = {
  workspaceRoot: string
  sessionId: string
  userId?: string
  mode: ToolMode
  allowNetwork: boolean
}

export type ToolDefinition<TSchema extends ZodTypeAny, TResult> = {
  name: string
  description: string
  risk: ToolRisk
  inputSchema: TSchema
  execute: (args: z.infer<TSchema>, context: ToolContext) => Promise<TResult>
}
```

这里要注意两件事：

- `inputSchema` 是模型可见的参数合同。
- `execute` 是 Host 执行逻辑，不能直接暴露给模型。

## 路径工具先写边界

读写文件类工具最容易出事故，先把路径限制写清楚：

```ts
export function resolveWorkspacePath(workspaceRoot: string, inputPath: string) {
  const root = path.resolve(workspaceRoot)
  const fullPath = path.resolve(root, inputPath)
  const relative = path.relative(root, fullPath)

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`path is outside workspace: ${inputPath}`)
  }

  return fullPath
}
```

只读工具：

```ts
const readFileInput = z.object({
  path: z.string().min(1)
})

export const readFileTool: ToolDefinition<
  typeof readFileInput,
  { path: string; content: string }
> = {
  name: 'read_file',
  description: 'Read a UTF-8 text file from the current workspace.',
  risk: 'read',
  inputSchema: readFileInput,
  async execute(args, context) {
    const fullPath = resolveWorkspacePath(context.workspaceRoot, args.path)
    const content = await fs.readFile(fullPath, 'utf-8')

    return {
      path: args.path,
      content
    }
  }
}
```

写工具：

```ts
const writeFileInput = z.object({
  path: z.string().min(1),
  content: z.string()
})

export const writeFileTool: ToolDefinition<
  typeof writeFileInput,
  { path: string; bytes: number }
> = {
  name: 'write_file',
  description: 'Write a UTF-8 text file inside the current workspace.',
  risk: 'write',
  inputSchema: writeFileInput,
  async execute(args, context) {
    if (context.mode === 'read-only') {
      throw new Error('write is not allowed in read-only mode')
    }

    const fullPath = resolveWorkspacePath(context.workspaceRoot, args.path)
    await fs.writeFile(fullPath, args.content, 'utf-8')

    return {
      path: args.path,
      bytes: Buffer.byteLength(args.content, 'utf-8')
    }
  }
}
```

注意：schema 只能证明参数形状对，不能证明路径安全。路径安全必须在 Host 侧做。

## Tool Registry

不要在 Agent Loop 里手写 `if toolName === ...`。工具应该统一注册：

```ts
export type AnyToolDefinition = ToolDefinition<ZodTypeAny, unknown>

export class ToolRegistry {
  private readonly tools = new Map<string, AnyToolDefinition>()

  register(tool: AnyToolDefinition) {
    if (this.tools.has(tool.name)) {
      throw new Error(`duplicate tool: ${tool.name}`)
    }

    this.tools.set(tool.name, tool)
  }

  get(name: string) {
    const tool = this.tools.get(name)
    if (!tool) {
      throw new Error(`unknown tool: ${name}`)
    }

    return tool
  }

  list() {
    return [...this.tools.values()]
  }

  pick(names: string[]) {
    return names.map((name) => this.get(name))
  }
}
```

Registry 的作用：

- Agent 可以按名字拿工具。
- UI 可以展示当前可用工具。
- Dispatcher 可以统一找到执行函数。
- 不同 Agent 可以共享同一批工具，只是暴露列表不同。

## 模型只应该看到工具描述

模型不应该看到 `execute`，只需要看到工具名、描述和参数：

```ts
export function toModelTool(tool: AnyToolDefinition) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema
  }
}
```

这个映射层很重要。
工具定义是 Host 内部对象，模型可见的是工具合同。

## Tool Gate

Gate 只回答一个问题：这个工具调用现在能不能执行？

```ts
export type ToolDecision =
  | { action: 'allow' }
  | { action: 'deny'; reason: string }
  | { action: 'confirm'; reason: string }

export function checkToolPermission(
  tool: AnyToolDefinition,
  context: ToolContext
): ToolDecision {
  if (tool.risk === 'read') {
    return { action: 'allow' }
  }

  if (tool.risk === 'write') {
    if (context.mode === 'read-only') {
      return { action: 'deny', reason: 'current mode is read-only' }
    }

    if (context.mode === 'safe-write') {
      return { action: 'confirm', reason: 'write tool requires confirmation' }
    }

    return { action: 'allow' }
  }

  if (tool.risk === 'external') {
    if (!context.allowNetwork) {
      return { action: 'deny', reason: 'network access is disabled' }
    }

    return { action: 'confirm', reason: 'external side effect requires confirmation' }
  }

  return { action: 'deny', reason: 'unknown tool risk' }
}
```

常见策略：

- `read`：可直接执行。
- `write + read-only`：直接拒绝。
- `write + safe-write`：需要确认。
- `external`：默认确认。
- 生产环境副作用：最好再加审计和二次鉴权。

## 统一工具结果

不同工具返回的数据结构一定不同，所以要先归一：

```ts
export type ToolErrorType =
  | 'invalid_args'
  | 'permission_denied'
  | 'needs_confirmation'
  | 'execution_failed'

export type NormalizedToolResult =
  | {
      ok: true
      summary: string
      data?: unknown
    }
  | {
      ok: false
      errorType: ToolErrorType
      summary: string
      data?: unknown
    }

function summarizeResult(result: unknown) {
  if (typeof result === 'string') {
    return result.slice(0, 1000)
  }

  return JSON.stringify(result).slice(0, 1000)
}
```

给模型回填时，不要把几万行日志或大 JSON 原样塞回上下文。

## Tool Event

事件用于 UI 时间线、调试和审计：

```ts
export type ToolEvent =
  | {
      type: 'tool_start'
      toolCallId: string
      toolName: string
      args: unknown
    }
  | {
      type: 'tool_success'
      toolCallId: string
      toolName: string
      summary: string
    }
  | {
      type: 'tool_error'
      toolCallId: string
      toolName: string
      errorType: ToolErrorType
      summary: string
    }

export type ToolEventSink = (event: ToolEvent) => void
```

后面要接 SSE 时，这些事件可以直接映射成：

- `tool_start`
- `tool_result`
- `error`

## Tool Dispatcher

Dispatcher 是工具系统的统一入口。它负责：

1. 找工具
2. 校验参数
3. 走 Gate
4. 执行工具
5. 捕获异常
6. 归一结果
7. 发事件

```ts
export type ToolDispatchInput = {
  toolCallId: string
  toolName: string
  args: unknown
  context: ToolContext
}

export class ToolDispatcher {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly emit?: ToolEventSink
  ) {}

  async dispatch(input: ToolDispatchInput): Promise<NormalizedToolResult> {
    let tool: AnyToolDefinition

    try {
      tool = this.registry.get(input.toolName)
    } catch (error) {
      return {
        ok: false,
        errorType: 'execution_failed',
        summary: error instanceof Error ? error.message : String(error)
      }
    }

    const parsed = tool.inputSchema.safeParse(input.args)

    if (!parsed.success) {
      return {
        ok: false,
        errorType: 'invalid_args',
        summary: parsed.error.message
      }
    }

    const decision = checkToolPermission(tool, input.context)

    if (decision.action === 'deny') {
      return {
        ok: false,
        errorType: 'permission_denied',
        summary: decision.reason
      }
    }

    if (decision.action === 'confirm') {
      return {
        ok: false,
        errorType: 'needs_confirmation',
        summary: decision.reason,
        data: {
          toolName: input.toolName,
          args: parsed.data
        }
      }
    }

    this.emit?.({
      type: 'tool_start',
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      args: parsed.data
    })

    try {
      const result = await tool.execute(parsed.data, input.context)
      const summary = summarizeResult(result)

      this.emit?.({
        type: 'tool_success',
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        summary
      })

      return {
        ok: true,
        summary,
        data: result
      }
    } catch (error) {
      const summary = error instanceof Error ? error.message : String(error)

      this.emit?.({
        type: 'tool_error',
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        errorType: 'execution_failed',
        summary
      })

      return {
        ok: false,
        errorType: 'execution_failed',
        summary
      }
    }
  }
}
```

Agent Loop 不应该自己做 schema parse、权限判断和异常捕获。
这些都应该收口到 Dispatcher。

## Agent Loop 怎么接

先约定模型返回结构：

```ts
export type ChatMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string }
  | { role: 'tool'; toolCallId: string; content: string }

export type ModelResponse =
  | { type: 'final'; text: string }
  | {
      type: 'tool_call'
      toolCallId: string
      toolName: string
      args: unknown
    }

export type ModelGateway = {
  generate: (input: {
    messages: ChatMessage[]
    tools: Array<ReturnType<typeof toModelTool>>
  }) => Promise<ModelResponse>
}
```

再把 Dispatcher 接进循环：

```ts
export async function runToolAwareAgent(params: {
  model: ModelGateway
  dispatcher: ToolDispatcher
  tools: AnyToolDefinition[]
  context: ToolContext
  userInput: string
}) {
  const messages: ChatMessage[] = [
    { role: 'user', content: params.userInput }
  ]

  for (let turn = 0; turn < 8; turn += 1) {
    const response = await params.model.generate({
      messages,
      tools: params.tools.map(toModelTool)
    })

    if (response.type === 'final') {
      return {
        type: 'final' as const,
        text: response.text
      }
    }

    const toolResult = await params.dispatcher.dispatch({
      toolCallId: response.toolCallId,
      toolName: response.toolName,
      args: response.args,
      context: params.context
    })

    if (!toolResult.ok && toolResult.errorType === 'needs_confirmation') {
      return {
        type: 'needs_confirmation' as const,
        toolCallId: response.toolCallId,
        toolName: response.toolName,
        summary: toolResult.summary,
        args: response.args
      }
    }

    messages.push({
      role: 'assistant',
      content: `Tool call: ${response.toolName}`
    })

    messages.push({
      role: 'tool',
      toolCallId: response.toolCallId,
      content: JSON.stringify(toolResult)
    })
  }

  throw new Error('tool loop exceeded max turns')
}
```

这里有几个关键点：

- 必须有 turn 上限。
- 工具结果必须作为 `tool` 消息回填。
- 需要确认的工具不要自动执行。
- 工具失败也可以回填给模型，让模型尝试修正参数或解释失败。

## 确认流程怎么做

当 Dispatcher 返回 `needs_confirmation` 时，不要继续跑模型。先把控制权交还给 Host：

```ts
const result = await runToolAwareAgent({
  model,
  dispatcher,
  tools,
  context: {
    workspaceRoot,
    sessionId,
    mode: 'safe-write',
    allowNetwork: false
  },
  userInput
})

if (result.type === 'needs_confirmation') {
  return {
    type: 'ask_user',
    question: `是否允许执行工具 ${result.toolName}？`,
    reason: result.summary,
    args: result.args
  }
}
```

用户确认后，可以用更高权限的 `context` 重新执行这一条工具调用，或者把确认结果作为消息继续交给 Agent。

## 工具日志记什么

至少记录这些字段：

| 字段 | 说明 |
| --- | --- |
| `sessionId` | 哪一次会话 |
| `toolCallId` | 哪一次工具调用 |
| `toolName` | 调了什么工具 |
| `risk` | 风险级别 |
| `decision` | allow / deny / confirm |
| `durationMs` | 执行耗时 |
| `ok` | 是否成功 |
| `errorType` | 失败类型 |
| `summary` | 给人看的摘要 |

日志不要默认记录完整参数和完整返回。
外部工具、密钥、生产数据要做脱敏。

## 常见坑

### 1. 把工具等同于函数

工具不是函数表。工具要有 schema、风险等级、权限策略、执行上下文和结果归一化。

### 2. 让模型直接控制副作用

模型可以提出“想做什么”，但不能绕过 Host 直接执行写文件、发消息、部署这类操作。

### 3. 只做参数校验，不做资源边界

`{ path: string }` 校验通过，不代表这个路径能读写。
路径、网络、数据库、外部系统都要有边界。

### 4. 工具结果原样塞回上下文

大日志、大 JSON、HTML、二进制内容都可能污染上下文。
给模型的是摘要和必要数据，不是原始垃圾桶。

### 5. 没有 tool call id

没有 `toolCallId`，前端时间线、日志排查、模型回填都会变得混乱。

### 6. 没有最大轮数

模型可能反复修参数、反复调用同一个工具。
Agent Loop 必须有 turn 上限。

### 7. Dispatcher 太薄

如果 Dispatcher 只是 `tool.execute(args)`，那后面权限、日志、确认、错误处理都会散落到各处。

## 推荐落地顺序

1. 定义 `ToolDefinition`、`ToolContext`、`ToolRisk`。
2. 写 `ToolRegistry`。
3. 写只读工具，例如 `read_file`。
4. 写路径边界，例如 `resolveWorkspacePath()`。
5. 写写入工具，例如 `write_file`。
6. 写 `ToolGate`。
7. 写 `NormalizedToolResult`。
8. 写 `ToolDispatcher`。
9. 给 Dispatcher 接 `ToolEvent`。
10. 最后接 Agent Loop。

不要一开始就把工具调用塞进模型 SDK 的调用代码里。
先把工具层做成独立执行平面，Agent 只是它的一个调用方。

## 最后记一句话

工具调用的核心不是“模型会调用函数”，而是：

**把可调用能力变成一层可注册、可拦截、可审计、可确认、可归一化的执行系统。**
