---
title: MCP 协议
sidebarTitle: MCP 协议
---

# MCP 协议

MCP 不是“某家模型的工具调用格式”，它更像一层**给 Agent/LLM 应用接外部能力的通用协议层**。

它想解决的核心问题不是：

- 某个模型怎么调某个工具

而是：

- Agent 宿主怎么和外部能力提供方建立稳定会话
- 工具、资源、提示模板怎么统一暴露
- 调用结果怎么通过标准消息往返
- 多个服务器怎么被一个宿主统一接入

如果你把 MCP 只理解成“tool calling JSON”，会低估它很多。

## 先说结论

从实现角度看，MCP 更稳的理解方式通常是：

1. 把它看成 `JSON-RPC + 生命周期 + 能力协商 + 工具/资源/Prompt 原语`。
2. 把 Agent 应用看成 `host`，而不是把模型本身看成 MCP client。
3. 把工具调用流程拆成“发现 -> 选择 -> 执行 -> 回填 -> 继续推理”。
4. 把 `stdio` 理解成本地子进程接法，把 `SSE/HTTP` 理解成远程服务接法。
5. 记住一点：**MCP 定义了协议和原语，不定义你的 agentic loop。**

最后这句最重要。  
很多人一上来就问“MCP 的 agent loop 怎么跑”，其实 loop 大部分是宿主应用自己设计的。

## MCP 里到底有哪些角色

根据官方架构，MCP 是 `host -> client -> server` 这套关系。

### Host

Host 是真正的 Agent 应用或宿主容器，例如：

- AI IDE
- Claude Code 这类 coding agent 宿主
- 聊天应用
- 桌面工作台

它负责：

- 管多个 MCP 连接
- 管权限
- 管上下文聚合
- 决定什么时候把什么能力暴露给模型

### Client

Client 通常是 host 里针对某个 MCP server 的连接实例。  
也就是说，host 可以连多个 server，每个连接都是独立 session。

### Server

Server 是能力提供方。  
它可以暴露：

- tools
- resources
- prompts

你可以把它理解成“外部能力适配器”。

## MCP 的三类核心原语

这一点特别重要，因为很多人会把所有东西都叫工具。

### 1. Tools

工具是**模型可调用**的执行能力。  
官方文档里，tools 被设计成 model-controlled。

典型例子：

- 搜索
- 读数据库
- 调 HTTP API
- 写文件
- 运行命令

### 2. Resources

资源更像“可挂给模型的上下文数据”，通常是 application-controlled。

典型例子：

- 文件内容
- schema
- 文档片段
- git 历史

### 3. Prompts

Prompts 是服务器暴露出的提示模板，通常是 user-controlled。

典型例子：

- `/review_pr`
- `/generate_release_note`

这三类原语不要混：

- tool 是执行
- resource 是上下文
- prompt 是模板入口

## MCP 消息层本质上是什么

官方规范把 MCP 建在 JSON-RPC 2.0 之上。  
所以从底层看，来回传的还是三类消息：

- request
- response
- notification

这意味着 MCP 并不是“聊天消息格式”，而是标准 RPC 风格协议。

一个请求大致长这样：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "search_docs",
    "arguments": {
      "query": "SSE heartbeat"
    }
  }
}
```

服务端再返回：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "..."
      }
    ]
  }
}
```

## 工具调用流程到底怎么跑

如果只看“工具被调用”这一瞬间，会觉得它和普通 function calling 差不多。  
但从宿主实现看，完整链路通常至少有 6 步。

### 1. 建立连接并初始化

host/client 先和 server 建立会话，完成初始化、协议协商、能力声明。

这一步的重点不是“连通了”，而是双方知道：

- 彼此支持什么能力
- 这个 session 是什么状态

### 2. 发现能力

host 会去拿 server 暴露的：

- tools 列表
- resources 列表
- prompts 列表

对于模型来说，最常进上下文的是 tool schema 和相关资源摘要。

### 3. 模型决定要不要调

注意这一步不是 MCP 做的，而是 host 应用自己的 agent loop 在做。

常见流程是：

1. 宿主把用户任务和可用工具描述交给模型
2. 模型决定：
   - 直接回答
   - 还是请求调用某个 tool

### 4. Host 发 `tools/call`

真正的 MCP 调用通常是 host/client 发 JSON-RPC 到 server。

也就是说：

- 模型不是直接连 MCP server
- 模型只是“建议调用”
- 真正执行调用的是 host

这点很关键，因为权限控制、人类确认、审计日志，通常都在 host 这一层。

### 5. Server 执行并返回结构化结果

server 执行完后，把结果返回给 host。

这个结果最好是：

- 结构明确
- 错误可识别
- 文本和二进制边界清楚

### 6. Host 把结果回填给模型，继续 loop

然后 agent loop 再继续：

- 要不要继续调别的工具
- 要不要整理答案
- 要不要问用户确认

所以你可以把 MCP 看成“工具调用的标准管道”，但不是“完整代理决策系统”。

## 如果我们自己做，host 里的代码通常怎么写

这一块才是工程实现里最容易卡住的地方。

你真正要写的不是“理解工具是什么”，而是下面这 4 层代码：

1. 连接 MCP server
2. 拉工具定义
3. 把工具定义转换成模型可见 schema
4. 跑 agent loop：模型决策 -> 调工具 -> 回填结果 -> 再决策

## 先看 host 侧的最小骨架

下面用 TypeScript 举例。  
如果你走官方较新的 SDK，这套写法通常是：

```ts
import { Client, StdioClientTransport } from '@modelcontextprotocol/client'

const client = new Client({
  name: 'grimoire-agent-host',
  version: '1.0.0'
})

const transport = new StdioClientTransport({
  command: 'node',
  args: ['./build/server.js']
})

await client.connect(transport)
```

这一步只做了一件事：

- host 连上一个 MCP server

但注意，这还没有开始跑 Agent。  
它只是把一条能力通道接进来了。

## 连上以后第一件事不是调工具，而是拉能力表

```ts
const tools = await client.listTools()
const resources = await client.listResources()
const prompts = await client.listPrompts()
```

这一步的意义是：

- host 知道这个 server 能干什么
- host 才能决定哪些能力应该暴露给模型

这里最容易犯的错是：  
把全部 tool 原样丢给模型。

更稳的做法应该是先做一层过滤：

```ts
const visibleTools = tools.tools.filter(tool =>
  ['search_docs', 'read_file', 'run_sql'].includes(tool.name)
)
```

也就是说，**MCP server 暴露了什么，不等于模型当前就一定能看到什么。**

## 怎么把 MCP tools 转成模型可见 schema

如果你在 host 里调用的是支持工具调用的模型，一般要把 MCP tools 转成模型自己的 tool schema。

例如可以先统一成内部结构：

```ts
type ModelTool = {
  name: string
  description?: string
  inputSchema?: unknown
}

function mapMcpToolsToModelTools(mcpTools: Array<any>): ModelTool[] {
  return mcpTools.map(tool => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema
  }))
}
```

这个转换层非常重要，因为你后面很可能会同时接：

- OpenAI 风格工具
- Anthropic 风格工具
- 你自己的内部 planner

如果没有中间层，host 很快就会和某一家模型 SDK 耦死。

## 真正的 agentic loop 应该怎么写

这部分我建议直接按“可停、可控、可观测”的方式写。

一个很实用的最小版本可以长这样：

```ts
type Message =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string }
  | { role: 'tool'; toolName: string; content: string }

type ModelResult =
  | { type: 'final'; text: string }
  | { type: 'tool_call'; toolName: string; arguments: Record<string, unknown> }

async function runAgentLoop(params: {
  userInput: string
  client: Client
  maxTurns?: number
}) {
  const maxTurns = params.maxTurns ?? 8
  const history: Message[] = [{ role: 'user', content: params.userInput }]

  const toolListResult = await params.client.listTools()
  const modelTools = mapMcpToolsToModelTools(toolListResult.tools)

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const modelResult: ModelResult = await callModel({
      messages: history,
      tools: modelTools
    })

    if (modelResult.type === 'final') {
      return modelResult.text
    }

    const toolResult = await params.client.callTool({
      name: modelResult.toolName,
      arguments: modelResult.arguments
    })

    history.push({
      role: 'assistant',
      content: `calling tool ${modelResult.toolName}`
    })

    history.push({
      role: 'tool',
      toolName: modelResult.toolName,
      content: normalizeToolResult(toolResult)
    })
  }

  throw new Error('agent loop exceeded max turns')
}
```

这里最关键的不是语法，而是这 4 个控制点：

- `maxTurns`
- `history`
- `callTool()`
- `normalizeToolResult()`

这才是 host 真正的运行时骨架。

## 为什么 `normalizeToolResult()` 一定要有

因为 MCP tool 返回的内容可能是：

- text
- structuredContent
- embedded resource
- error result

如果你不做归一化，后面模型上下文会很乱。

一个够用的版本可以先这样：

```ts
function normalizeToolResult(result: any): string {
  if (result.isError) {
    return `tool_error: ${JSON.stringify(result.content ?? [])}`
  }

  if (result.structuredContent) {
    return JSON.stringify(result.structuredContent)
  }

  const texts = (result.content ?? [])
    .filter((item: any) => item.type === 'text')
    .map((item: any) => item.text)

  return texts.join('\n')
}
```

这层的作用是：

- 把协议返回变成模型易消费的稳定输入

## 一个更像产品的 host 还要补“事件回调”

如果你要把 Agent 执行过程推给前端，就不要让 loop 只返回最终文本。

可以把 loop 改成带回调的形式：

```ts
async function runAgentLoop(params: {
  userInput: string
  client: Client
  onToolStart?: (toolName: string, args: Record<string, unknown>) => void
  onToolResult?: (toolName: string, result: string) => void
}) {
  // ...
  params.onToolStart?.(modelResult.toolName, modelResult.arguments)

  const toolResult = await params.client.callTool({
    name: modelResult.toolName,
    arguments: modelResult.arguments
  })

  const normalized = normalizeToolResult(toolResult)
  params.onToolResult?.(modelResult.toolName, normalized)
  // ...
}
```

这样后面你就能非常自然地接到：

- SSE 输出
- WebSocket 日志
- 控制台调试
- trace 记录

## Server 侧又该怎么写

如果你自己实现 MCP server，最小可用版本通常先从 `stdio` 开始。  
因为本地开发时，它最简单，也最贴合 coding agent / desktop agent 形态。

下面是一个最小 server：

```ts
import { McpServer } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import * as z from 'zod/v4'

const server = new McpServer({
  name: 'grimoire-tools',
  version: '1.0.0'
})

server.registerTool(
  'search_docs',
  {
    title: 'Search Docs',
    description: 'Search internal documents by keyword',
    inputSchema: z.object({
      query: z.string().min(1)
    })
  },
  async ({ query }) => {
    const rows = await searchDocs(query)

    return {
      content: [
        {
          type: 'text',
          text: rows.map(row => `- ${row.title}`).join('\n')
        }
      ],
      structuredContent: {
        results: rows
      }
    }
  }
)

const transport = new StdioServerTransport()
await server.connect(transport)
```

这个例子里最值得注意的其实不是 `registerTool()` 本身，而是：

- `inputSchema` 明确
- 文本结果给模型看
- `structuredContent` 给 host/客户端进一步消费

## 真正上线时，server 不要只注册工具

如果你做的是成熟 Agent 能力层，一般应该同时考虑：

- `tool`
  执行动作
- `resource`
  暴露上下文
- `prompt`
  暴露模板入口

例如文档问答场景里，比较自然的拆法是：

- `search_docs` 做 tool
- `docs://article/{id}` 做 resource
- `summarize_doc` 做 prompt

这样模型和宿主都更容易理解职责。

## 一个 `resource` 落地例子

如果某些大文本不适合每次工具都整段返回，更适合注册成 resource：

```ts
server.registerResource(
  'doc-article',
  'docs://article/123',
  {
    title: 'Article 123',
    mimeType: 'text/markdown'
  },
  async uri => ({
    contents: [
      {
        uri: uri.href,
        text: await loadArticleMarkdown('123')
      }
    ]
  })
)
```

这样 host 可以：

- 先把 article 摘要给模型
- 需要时再读完整 resource

比“一切都塞进 tool result”稳很多。

## 如果要做远程 server，代码怎么变

从工程角度，通常只需要把 transport 换成远程模式，不需要重写工具本身。

按照官方较新的 TypeScript SDK 文档，远程推荐的是 **Streamable HTTP**。  
一个最小心智模型可以理解成：

1. `McpServer` 还是照样注册 tools/resources/prompts
2. transport 改成 HTTP transport
3. host 改用 `StreamableHTTPClientTransport`

也就是说，**工具实现和传输层应该解耦。**

这也是为什么我前面一直强调：

- tool handler 里只写业务逻辑
- 不要把 HTTP 细节写死在工具里

## `stdio` 和远程传输在代码结构上最大的差异

不是工具逻辑，而是这几件事：

- `stdio`
  要管子进程生命周期
- `HTTP`
  要管鉴权、会话、部署、CORS、重试

所以如果你现在只是本地开发 Agent，真的没必要一开始就上远程传输。

## 我们自己实现时，最应该补齐的不是协议，而是这 5 个工程点

### 1. Tool 可见性过滤

不要把所有 tool 永远暴露给模型。

### 2. 高风险工具门控

例如：

- shell
- write_file
- send_message
- prod_api_call

这些应该先过 host 策略层，再决定是否真的发 `tools/call`。

### 3. Tool 结果裁剪

大结果不要整段塞回模型。  
要做：

- 截断
- 摘要
- 结构抽取

### 4. Loop 上限和停止条件

否则一个错误规划会无限转。

### 5. 可观测事件

至少把这些打出来：

- 选了哪个 tool
- 参数是什么
- 返回多长
- 是否报错
- 当前第几轮

后面你做前端日志或 SSE 状态流时，这些都会直接复用。

## 一个更贴近实现的 agentic loop

如果你在做自己的 Agent，实际常见的是下面这个循环：

1. 收到用户任务
2. 选择可见的 MCP servers / tools / resources
3. 把任务 + 工具描述 + 必要资源喂给模型
4. 模型输出：
   - final answer，或
   - tool request
5. host 执行 MCP 调用
6. 将 tool result 追加回对话上下文
7. 再次调用模型
8. 直到模型给出 final answer

也就是说：

**agentic loop 跑在 host 里，MCP 只是 loop 中“外部能力调用和上下文交换”的标准接口。**

## 这也是 MCP 最容易被误解的地方

很多人会问：

- MCP 能不能自己跑 Agent？

更准确的回答是：

- 不能，协议本身不替你决定任务分解、重试、并行、停止条件

它做的是：

- 把外部能力接进来
- 把上下文交换标准化

至于：

- 什么时候调
- 调几次
- 是否并行
- 是否让用户确认

这都是宿主应用自己的 runtime 策略。

## `stdio` 和 `SSE/HTTP` 传输怎么理解

这一块很多教程容易讲乱。

## 先说版本变化

如果你看到很多旧资料写：

- `stdio`
- `HTTP + SSE`

那是因为较早的 MCP 规范明确写的是这两个。

较新的官方规范已经把远程传输抽象成 **Streamable HTTP**。  
它本质上仍然可以用到 SSE 来做服务端到客户端的流式消息，只是语义上不再把整个远程传输简单叫成“HTTP+SSE”。

所以现在更稳的理解是：

- 本地：`stdio`
- 远程：`Streamable HTTP`
- 而远程流式下行里，经常会出现 SSE

## `stdio` 是什么

`stdio` 模式下：

- host/client 启动一个本地子进程
- server 从 `stdin` 读 JSON-RPC
- server 往 `stdout` 写 JSON-RPC
- `stderr` 可以打日志

这非常适合：

- 本机工具
- IDE 插件
- 本地文件系统能力
- 本地数据库、Git、shell 这类本地桥接

### `stdio` 的优点

- 简单
- 本地延迟低
- 不需要额外开 HTTP 服务
- 权限边界更清楚

### `stdio` 的缺点

- 更偏本地
- 子进程生命周期要自己管
- 不适合天然跨机器共享

## `SSE/HTTP` 或更准确说 `Streamable HTTP` 是什么

远程模式下，server 作为独立进程或服务存在。  
host/client 通过 HTTP 和它通信。

在较新的规范里：

- client 用 HTTP POST 发 JSON-RPC
- server 可以选择通过 SSE 流把服务端消息往回推

这就更适合：

- 远程 MCP server
- 团队共享服务
- 云端工具池
- 多客户端复用一个能力服务

### 远程模式的优点

- 易于部署成共享服务
- 不依赖本地子进程
- 方便统一鉴权、审计、运维

### 远程模式的缺点

- 网络复杂度更高
- 鉴权和 Origin 校验要认真做
- 断线、重试、会话恢复更复杂

## 两种传输该怎么选

### 优先选 `stdio` 的场景

- 工具是本地的
- 宿主和 server 在同一台机器
- 你想要最小系统复杂度
- 主要服务 coding / desktop agent

### 更适合远程 HTTP/SSE 的场景

- 工具能力要多客户端共享
- 你要统一部署
- 你要跨机器或云端接入
- 你要做平台型能力服务

所以它不是谁高级谁低级，而是：

- `stdio` 更像本地插件模式
- `HTTP/SSE` 更像远程服务模式

## 做工具调用时，真正需要宿主补的 4 层逻辑

MCP 不会替你做完这些，但 Agent 产品必须自己补：

### 1. 可见性控制

不是所有 server 的所有 tool 都应该对模型始终可见。  
宿主应该决定当前任务能看到哪些能力。

### 2. 权限与确认

高风险工具例如：

- 发消息
- 改文件
- 执行命令
- 调生产 API

最好都在 host 层做确认和审计。

### 3. 结果压缩与回填

工具结果不能无脑整段塞回模型。  
宿主通常要做：

- 截断
- 摘要
- 结构化抽取

### 4. loop 策略

例如：

- 最多调几轮
- 并行还是串行
- 失败是否重试
- 什么时候直接停下问用户

这部分决定了 Agent 成熟度，但不属于协议本身。

## 一个常见误区：MCP 不等于“所有工具都自动更强”

MCP 解决的是标准化接入，不是自动提升决策质量。

如果宿主做得不好，仍然会出现：

- 工具太多，模型乱选
- 结果太长，上下文爆炸
- 权限太大，风险过高
- loop 太长，成本太高

所以成熟系统真正拉开差距的地方通常是：

- 工具选择策略
- 权限治理
- 结果压缩
- 任务编排

而不只是“我支持 MCP 了”。

## 一种比较推荐的实现思路

如果你自己做 Agent，我会这样落：

1. 本地开发期优先 `stdio`。
2. 把每个 MCP server 当成单独能力边界，不混成一个超级工具包。
3. 先接少量高价值 tools，不求一口气接很多。
4. host 里实现清楚的 tool loop：
   - 选择工具
   - 执行调用
   - 结构化回填
   - 再决策
5. 高风险工具始终走确认或策略门控。
6. 真要共享能力池时，再把 server 提升到远程 HTTP/SSE 模式。

## 最后记一句话

**MCP 真正标准化的，是“Agent 和外部能力交换上下文、发现能力、执行调用”的接口层；真正决定 Agent 成熟度的，仍然是 host 里的 loop 和治理。**

这两层不要混，你后面做系统时会清楚很多。
