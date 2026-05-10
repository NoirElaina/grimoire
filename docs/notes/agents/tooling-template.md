---
title: 工具调用
sidebarTitle: 工具调用
---

# 工具调用

工具调用真正难的地方，不是 schema 怎么写，而是：

- 什么时候调
- 调哪个
- 调完结果怎么回填
- 高风险调用怎么拦

如果这 4 件事没设计好，Agent 就算有一百个工具，也只是在一百条不稳定路径里随机试错。  
所以这篇不只讲理念，而是直接讲：**工具层在工程上应该怎么实现。**

## 先说结论

一个可维护的工具系统，通常至少要补齐这 5 层：

1. Tool schema
2. Tool registry
3. Tool gate / permission policy
4. Tool dispatcher
5. Tool result normalization

一句话就是：

**工具系统不是把函数暴露给模型，而是给 Agent 增加一层可控执行平面。**

## 先区分 3 种工具

工程上很有必要把工具按风险和用途分层，而不是一视同仁。

### 1. 只读工具

例如：

- `read_file`
- `search_code`
- `web_search`
- `query_db`

特点：

- 风险低
- 主要作用是补上下文

### 2. 本地写工具

例如：

- `edit_file`
- `write_file`
- `create_branch`

特点：

- 有副作用
- 往往需要路径范围约束

### 3. 外部副作用工具

例如：

- `send_slack_message`
- `deploy_service`
- `call_prod_api`

特点：

- 风险高
- 通常需要确认、审计、甚至额外鉴权

如果这三类不分开，后面策略层几乎没法写。

## Tool 定义不要只是一段 JSON

我更推荐先定义统一的工具合同：

```ts
export type ToolDefinition<TArgs = unknown, TResult = unknown> = {
  name: string
  description: string
  risk: 'read' | 'write' | 'external'
  inputSchema: unknown
  execute: (args: TArgs, context: ToolContext) => Promise<TResult>
}

export type ToolContext = {
  cwd?: string
  userId?: string
  sessionId: string
  allowWrite: boolean
  allowNetwork: boolean
}
```

这个定义最重要的价值有两个：

- 工具自己知道自己的风险级别
- 执行时一定带 runtime context

## 一个最小只读工具长什么样

```ts
import * as z from 'zod'

export const readFileTool: ToolDefinition<{ path: string }, { content: string }> = {
  name: 'read_file',
  description: 'Read a file from the current workspace.',
  risk: 'read',
  inputSchema: z.object({
    path: z.string().min(1)
  }),
  async execute(args, context) {
    const fullPath = resolvePath(context.cwd, args.path)
    const content = await fs.promises.readFile(fullPath, 'utf-8')
    return { content }
  }
}
```

注意这里不是直接暴露 `fs.readFile`，而是先通过工具合同包了一层。

## 一个写工具一定要先做路径约束

```ts
export const writeFileTool: ToolDefinition<
  { path: string; content: string },
  { path: string; bytes: number }
> = {
  name: 'write_file',
  description: 'Write content to a file inside the workspace.',
  risk: 'write',
  inputSchema: z.object({
    path: z.string().min(1),
    content: z.string()
  }),
  async execute(args, context) {
    if (!context.allowWrite) {
      throw new Error('write is not allowed in current mode')
    }

    const fullPath = resolvePath(context.cwd, args.path)
    ensureInsideWorkspace(context.cwd, fullPath)

    await fs.promises.writeFile(fullPath, args.content, 'utf-8')
    return { path: args.path, bytes: Buffer.byteLength(args.content, 'utf-8') }
  }
}
```

真正关键的是这两步：

- `allowWrite`
- `ensureInsideWorkspace()`

很多工具事故都不是 schema 错，而是边界没拦。

## Tool Registry 不要省

一开始很多人会直接：

```ts
const tools = [readFileTool, writeFileTool]
```

demo 可以，但工程上最好还是有 registry：

```ts
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>()

  register(tool: ToolDefinition) {
    this.tools.set(tool.name, tool)
  }

  get(name: string) {
    const tool = this.tools.get(name)
    if (!tool) throw new Error(`unknown tool: ${name}`)
    return tool
  }

  pick(names: string[]) {
    return names.map(name => this.get(name))
  }

  list() {
    return [...this.tools.values()]
  }
}
```

这个类后面会非常有用，因为：

- AgentDefinition 可以按名字挑工具
- UI 可以列出当前可见工具
- 策略层可以统一做门控

## 模型真正看到的，不应该是 execute 函数本身

模型只需要看到：

- name
- description
- inputSchema

所以通常还要做一层映射：

```ts
function toModelTool(tool: ToolDefinition) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema
  }
}
```

这个层次不要跳过。  
因为 execute 是 runtime 行为，schema 是模型可见合同，它们不是一回事。

## 真正的关键层：Tool Gate

这层决定：

- 能不能调
- 要不要确认
- 需不需要拒绝

一个最小版本可以先这样：

```ts
export type ToolDecision =
  | { action: 'allow' }
  | { action: 'deny'; reason: string }
  | { action: 'confirm'; reason: string }

export function checkToolPermission(
  tool: ToolDefinition,
  args: unknown,
  context: ToolContext
): ToolDecision {
  if (tool.risk === 'read') {
    return { action: 'allow' }
  }

  if (tool.risk === 'write' && !context.allowWrite) {
    return { action: 'deny', reason: 'current mode is read-only' }
  }

  if (tool.risk === 'external' && !context.allowNetwork) {
    return { action: 'deny', reason: 'network access is disabled' }
  }

  if (tool.risk === 'external') {
    return { action: 'confirm', reason: 'external side effect requires user confirmation' }
  }

  return { action: 'allow' }
}
```

这层才是真正把“工具很多”变成“工具可控”的关键。

## Dispatcher 应该统一处理校验、门控、执行、归一化

不要在 Agent loop 里自己一会儿 parse schema，一会儿执行工具。  
更稳的方式是让 Dispatcher 做统一入口：

```ts
export class ToolDispatcher {
  constructor(private readonly registry: ToolRegistry) {}

  async dispatch(name: string, args: unknown, context: ToolContext) {
    const tool = this.registry.get(name)

    const parsedArgs = zodParse(tool.inputSchema, args)
    const decision = checkToolPermission(tool, parsedArgs, context)

    if (decision.action === 'deny') {
      return { isError: true, errorType: 'permission_denied', message: decision.reason }
    }

    if (decision.action === 'confirm') {
      return { isError: true, errorType: 'needs_confirmation', message: decision.reason }
    }

    try {
      const result = await tool.execute(parsedArgs, context)
      return { isError: false, result }
    } catch (error) {
      return {
        isError: true,
        errorType: 'tool_execution_failed',
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }
}
```

这样你的 Agent loop 会简化很多。

## Tool result 一定要归一化

不要让模型直接吃各种工具的原始返回。  
更稳的做法是先统一格式：

```ts
type NormalizedToolResult = {
  ok: boolean
  summary: string
  data?: unknown
  errorType?: string
}

function normalizeToolResult(raw: any): NormalizedToolResult {
  if (raw.isError) {
    return {
      ok: false,
      summary: raw.message,
      errorType: raw.errorType
    }
  }

  return {
    ok: true,
    summary: JSON.stringify(raw.result).slice(0, 1000),
    data: raw.result
  }
}
```

这层非常重要，因为它决定了模型看到的是：

- 一段混乱原始输出
- 还是一份稳定可推理的工具结果

## Agent Loop 接工具时应该怎么写

一个最小可用版本可以这样：

```ts
async function runToolAwareAgent(params: {
  model: ModelGateway
  dispatcher: ToolDispatcher
  tools: ToolDefinition[]
  context: ToolContext
  userInput: string
}) {
  const messages: Array<{ role: string; content: string }> = [
    { role: 'user', content: params.userInput }
  ]

  for (let turn = 0; turn < 8; turn += 1) {
    const response = await params.model.generate({
      messages,
      tools: params.tools.map(toModelTool)
    })

    if (response.type === 'final') {
      return response.text
    }

    const rawToolResult = await params.dispatcher.dispatch(
      response.toolName,
      response.arguments,
      params.context
    )

    const toolResult = normalizeToolResult(rawToolResult)

    messages.push({
      role: 'assistant',
      content: `Tool call requested: ${response.toolName}`
    })

    messages.push({
      role: 'tool',
      content: JSON.stringify(toolResult)
    })
  }

  throw new Error('tool loop exceeded max turns')
}
```

这里真正拉开质量差距的地方不是“调用成功”，而是：

- turn 上限
- dispatcher 统一行为
- result normalization

## 工具调用日志最好一开始就记

后面你几乎一定会需要：

- 前端显示 tool timeline
- 线上排查“为什么调了这个工具”
- 评估哪个工具最常失败

所以最好一开始就定义事件：

```ts
type ToolEvent =
  | { type: 'tool_start'; toolName: string; args: unknown }
  | { type: 'tool_success'; toolName: string; summary: string }
  | { type: 'tool_error'; toolName: string; errorType: string; message: string }
```

然后 Dispatcher 每次 dispatch 时都能发事件。  
这样后面接 SSE、WebSocket、数据库日志都会很自然。

## 不要让模型直接决定“所有副作用都执行”

一个成熟系统通常会把高风险调用拆成两段：

1. 模型提出调用建议
2. Host / 用户确认后才真正执行

例如：

```ts
if (toolResult.errorType === 'needs_confirmation') {
  return {
    type: 'need_user_input',
    question: `是否允许执行工具 ${response.toolName}？`,
    reason: toolResult.summary
  }
}
```

这层如果没有，后面工具一多，风险就会上升得很快。

## 一种比较推荐的工程落地顺序

1. 先写 `ToolDefinition`
2. 再写 `ToolRegistry`
3. 再写 `ToolGate`
4. 再写 `ToolDispatcher`
5. 最后再把它接进 Agent loop

不要一开始就把工具耦进模型 SDK 调用里。

## 最后记一句话

**工程里的工具调用系统，不是“模型会调函数”这么简单，而是把“可调用能力”变成一层带权限、带日志、带回退、带结果归一化的执行平面。**

做到这一步，Agent 才不是“能调工具”，而是“会工作”。
