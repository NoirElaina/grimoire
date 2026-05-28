---
title: MCP 协议
sidebarTitle: MCP 协议
---

# MCP 协议

MCP（Model Context Protocol）不是“模型函数调用格式”，而是一套让 Agent Host 接入外部能力的协议层。

从实现角度看，它可以拆成 4 层：

```text
Host / Agent Runtime
  -> MCP Client
  -> Transport(stdio / Streamable HTTP / legacy SSE)
  -> MCP Server(tools / resources / prompts)
```

这篇只记实现重点：消息怎么走、传输怎么选、`stdio`、`SSE`、`Streamable HTTP` 到底差在哪，以及 Host 需要补哪些内部逻辑。

## 先给结论

做 MCP 集成时，先记住这几件事：

1. MCP 消息层是 `JSON-RPC 2.0`，不是聊天消息格式。
2. 官方标准传输主要是 `stdio` 和 `Streamable HTTP`。
3. 老版本 `HTTP + SSE` 是 legacy transport，新实现优先用 `Streamable HTTP`。
4. `stdio` 适合本地子进程，`Streamable HTTP` 适合远程服务。
5. SSE 在最新 `Streamable HTTP` 里仍会出现，但它是 HTTP 响应里的流式承载方式，不等于旧的双端点 `HTTP + SSE`。
6. MCP 只定义协议、生命周期和能力原语，不替你实现 Agent Loop、权限系统、工具确认和上下文裁剪。

一句话：

**MCP 是 Agent Host 和外部能力 Server 之间的标准 RPC 会话，不是模型自己直接联网调工具。**

## 角色关系

MCP 里有 3 个角色：

| 角色 | 作用 |
| --- | --- |
| `Host` | 真正的应用，例如 IDE、聊天应用、Agent Runtime |
| `Client` | Host 内部针对某个 MCP Server 的连接实例 |
| `Server` | 外部能力提供方，暴露 tools、resources、prompts |

一个 Host 可以连多个 Server：

```text
Host
  ├─ MCP Client -> filesystem server
  ├─ MCP Client -> git server
  └─ MCP Client -> database server
```

模型通常不会直接连 MCP Server。模型只看到 Host 暴露给它的工具描述。真正建立连接、发请求、做权限判断、回填结果的是 Host。

## MCP 消息层

MCP 底层使用 JSON-RPC 2.0。消息主要有 3 类：

| 类型 | 有没有 `id` | 需要响应吗 | 示例 |
| --- | --- | --- | --- |
| Request | 有 | 需要 | `initialize`、`tools/list`、`tools/call` |
| Response | 有 | 对应请求 | 成功 `result` 或失败 `error` |
| Notification | 无 | 不需要 | `notifications/initialized`、`notifications/tools/list_changed` |

请求：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "search_docs",
    "arguments": {
      "query": "streamable http"
    }
  }
}
```

成功响应：

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
    ],
    "isError": false
  }
}
```

错误响应：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32602,
    "message": "Invalid params"
  }
}
```

Host 侧实现时，要有一个 pending request map：

```ts
type JsonRpcId = string | number

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  method: string
  startedAt: number
}

const pendingRequests = new Map<JsonRpcId, PendingRequest>()
```

收到消息时按规则分流：

```ts
function handleIncomingMessage(message: any) {
  if ('id' in message && ('result' in message || 'error' in message)) {
    handleResponse(message)
    return
  }

  if ('id' in message && message.method) {
    handleServerRequest(message)
    return
  }

  if (!('id' in message) && message.method) {
    handleNotification(message)
    return
  }

  throw new Error('invalid JSON-RPC message')
}
```

这就是 MCP Client 内部最核心的一层：**按 `id` 对齐响应，按 `method` 路由请求和通知。**

## 生命周期

连接建立后，不是马上调用工具，而是先初始化。

### 1. `initialize`

Client 先告诉 Server：

- 自己支持的协议版本
- client capabilities
- client info

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-11-25",
    "capabilities": {
      "roots": {},
      "sampling": {},
      "elicitation": {}
    },
    "clientInfo": {
      "name": "my-agent-host",
      "version": "1.0.0"
    }
  }
}
```

Server 返回：

- 最终协商出来的协议版本
- server capabilities
- server info
- 可选 instructions

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-11-25",
    "capabilities": {
      "tools": {
        "listChanged": true
      },
      "resources": {
        "subscribe": true,
        "listChanged": true
      },
      "prompts": {
        "listChanged": true
      },
      "logging": {}
    },
    "serverInfo": {
      "name": "example-server",
      "version": "1.0.0"
    }
  }
}
```

### 2. `notifications/initialized`

初始化成功后，Client 再发通知：

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/initialized"
}
```

这之后才进入正常操作阶段。

### 3. 能力发现

Host 通常会拉：

```text
tools/list
resources/list
prompts/list
```

然后把工具描述转成模型可见 schema，把资源和 prompt 作为可选上下文入口。

### 4. 正常调用

最常见的是：

```text
tools/list -> 模型看到工具 -> 模型提出 tool call -> Host 发 tools/call -> Server 返回 result -> Host 回填给模型
```

### 5. 关闭

- `stdio`：关闭子进程 stdin，等待进程退出，必要时 kill。
- HTTP：如果有 session，可以用 `DELETE` 请求显式结束 session。

## 核心原语

MCP Server 可以暴露 3 类东西：

| 原语 | 控制方 | 用途 |
| --- | --- | --- |
| `tools` | model-controlled | 模型可请求调用的动作 |
| `resources` | application-controlled | Host 选择提供给模型的上下文 |
| `prompts` | user-controlled | 用户可触发的提示模板 |

不要把所有东西都做成 tool。  
能作为上下文读取的，用 resource；能作为固定任务入口的，用 prompt；真的需要执行动作的，才做 tool。

## Tools 内部细节

### `tools/list`

Client 拉取工具列表：

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list"
}
```

Server 返回工具定义：

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "tools": [
      {
        "name": "get_weather",
        "title": "Get Weather",
        "description": "Get current weather for a location.",
        "inputSchema": {
          "type": "object",
          "properties": {
            "location": {
              "type": "string"
            }
          },
          "required": ["location"]
        }
      }
    ]
  }
}
```

Host 再把它转成模型可见工具：

```ts
function toModelTool(tool: McpTool) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema
  }
}
```

### `tools/call`

调用工具：

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "get_weather",
    "arguments": {
      "location": "Shanghai"
    }
  }
}
```

返回结果：

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Shanghai: cloudy, 21°C"
      }
    ],
    "isError": false
  }
}
```

工具失败有两种：

| 类型 | 表达方式 | 该不该回填给模型 |
| --- | --- | --- |
| 协议错误 | JSON-RPC `error` | 通常少回填，偏系统问题 |
| 工具执行错误 | `result.isError: true` | 应该回填，模型可能能自我修正 |

例如参数业务不合法，更适合：

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "location is required"
      }
    ],
    "isError": true
  }
}
```

未知 method、非法 JSON-RPC、请求结构错误，才走 JSON-RPC `error`。

### `notifications/tools/list_changed`

如果 Server 声明了 `tools.listChanged`，工具列表变化时可以发通知：

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/tools/list_changed"
}
```

Host 收到后要刷新工具缓存。  
否则模型看到的工具 schema 可能已经过期。

## 传输层总览

现在重点来了：MCP 的“协议消息”是 JSON-RPC，但 JSON-RPC 要通过某种传输层发送。

常见有 3 种：

| 传输 | 状态 | 适合场景 |
| --- | --- | --- |
| `stdio` | 标准传输 | 本地工具、本地插件、子进程 Server |
| `Streamable HTTP` | 标准传输 | 远程 MCP Server、云服务、多客户端 |
| `HTTP + SSE` | legacy | 兼容旧 Server，不建议新实现优先选 |

很多文章会把 `SSE` 和 `Streamable HTTP` 混在一起讲。这里要分开：

- 旧 `HTTP + SSE`：两个端点，一个 SSE 收消息，一个 POST 发消息。
- 新 `Streamable HTTP`：一个 MCP endpoint，同时支持 POST 和 GET；响应可以是 JSON，也可以是 SSE 流。

## `stdio` 传输

`stdio` 是最适合本地 MCP Server 的方式。

### 连接模型

```text
Host process
  └─ spawn MCP Server process
       ├─ stdin  <- client writes JSON-RPC
       ├─ stdout -> server writes JSON-RPC
       └─ stderr -> server writes logs
```

Client 启动一个子进程：

```ts
import { spawn } from 'node:child_process'
import readline from 'node:readline'

const child = spawn('node', ['server.js'], {
  cwd: workspaceRoot,
  env: {
    ...process.env,
    MCP_WORKSPACE: workspaceRoot
  },
  stdio: ['pipe', 'pipe', 'pipe']
})
```

发送消息：

```ts
function send(message: unknown) {
  child.stdin.write(`${JSON.stringify(message)}\n`)
}
```

接收消息：

```ts
const lines = readline.createInterface({
  input: child.stdout
})

lines.on('line', (line) => {
  const message = JSON.parse(line)
  handleIncomingMessage(message)
})
```

### `stdio` 的硬规则

| 规则 | 原因 |
| --- | --- |
| 每条 JSON-RPC 消息一行 | newline 是消息分隔符 |
| stdout 只能写 MCP 消息 | Host 会按 JSON-RPC 解析 stdout |
| 日志必须写 stderr | 避免污染协议流 |
| 不要在消息里嵌入原始换行分隔多条消息 | 会破坏 framing |
| Host 要监听进程退出 | Server 挂了要清理 pending request |

Server 如果这样写日志，会出事：

```ts
console.log('server started')
```

因为 `console.log` 默认走 stdout，会被 Host 当成 JSON-RPC 解析。应该写：

```ts
console.error('server started')
```

### `stdio` 的优点

- 不需要开放端口。
- 不需要 HTTP 鉴权。
- 生命周期跟 Host 绑定。
- 很适合文件系统、Git、本地命令这类本地能力。

### `stdio` 的缺点

- 不适合多客户端共享。
- Server 崩溃会直接影响当前连接。
- 远程部署不方便。
- 权限主要靠 Host 的启动参数、环境变量和本地沙箱。

## `Streamable HTTP` 传输

`Streamable HTTP` 是现在远程 MCP Server 的主线。

它的核心是一个 MCP endpoint，例如：

```text
https://example.com/mcp
```

这个 endpoint 同时支持：

- `POST`：客户端给服务端发送 JSON-RPC 消息。
- `GET`：客户端打开服务端到客户端的 SSE 流。
- `DELETE`：客户端结束 session，服务端可选择支持。

## `Streamable HTTP`：POST 怎么发

Client 每次发送 JSON-RPC 消息，都发一个新的 HTTP POST：

```http
POST /mcp HTTP/1.1
Accept: application/json, text/event-stream
Content-Type: application/json
MCP-Protocol-Version: 2025-11-25
MCP-Session-Id: session_abc

{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"get_weather","arguments":{"location":"Shanghai"}}}
```

注意：

- `Accept` 要同时包含 `application/json` 和 `text/event-stream`。
- body 是单个 JSON-RPC request、response 或 notification。
- 初始化后的 HTTP 请求要带 `MCP-Protocol-Version`。
- 如果 Server 建立了 session，后续请求要带 `MCP-Session-Id`。

Server 对 POST 的响应分两类。

### 返回普通 JSON

适合短请求：

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"jsonrpc":"2.0","id":10,"result":{"content":[{"type":"text","text":"..."}],"isError":false}}
```

### 返回 SSE 流

适合长任务，或者 Server 需要在最终 response 前插入通知 / 请求：

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream

id: stream_1:0
data:

id: stream_1:1
event: message
data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":0.5}}

id: stream_1:2
event: message
data: {"jsonrpc":"2.0","id":10,"result":{"content":[{"type":"text","text":"done"}],"isError":false}}

```

这里 SSE 里承载的 `data` 仍然是 JSON-RPC 消息。  
所以不要把 `event: message` 当成业务事件类型。真正的 MCP 语义在 `data.method` 或 `data.result` 里。

## `Streamable HTTP`：GET SSE 怎么用

Client 也可以主动发 GET 打开一个服务端到客户端的 SSE 通道：

```http
GET /mcp HTTP/1.1
Accept: text/event-stream
MCP-Protocol-Version: 2025-11-25
MCP-Session-Id: session_abc
```

Server 可以在这个流里发：

- notifications
- server-to-client requests

但有一条很重要：

**GET SSE 流里不要随便发某个 POST 请求的 response，除非是在恢复之前断开的流。**

也就是说：

- POST 请求对应的 response，通常走这个 POST 的 HTTP response。
- GET SSE 是额外的 server-to-client 通道。

## `Streamable HTTP`：Session

如果 Server 想维护状态，可以在初始化响应里返回 session id：

```http
HTTP/1.1 200 OK
Content-Type: application/json
MCP-Session-Id: session_abc

{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-11-25","capabilities":{"tools":{}}}}
```

Client 后续所有请求都带：

```http
MCP-Session-Id: session_abc
```

常见规则：

- 没带必需 session，Server 可以返回 `400`。
- session 过期或无效，Server 可以返回 `404`。
- Client 收到带 session 的 `404`，应该重新初始化。
- 不再需要 session，可以用 `DELETE /mcp` 请求结束。

这会影响部署：

- Stateless 模式更容易水平扩展。
- Stateful 模式需要 session 存储或粘性会话。

## `Streamable HTTP`：恢复和重投

SSE 事件可以带 `id`：

```text
id: stream_1:42
event: message
data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":0.8}}

```

连接断开后，Client 可以用 `Last-Event-ID` 恢复：

```http
GET /mcp HTTP/1.1
Accept: text/event-stream
Last-Event-ID: stream_1:42
MCP-Session-Id: session_abc
```

Server 如果保存了事件历史，可以从这个 cursor 后面继续发。  
注意不要把别的 stream 上的消息重放到当前 stream。

还有一个实现细节：断线不等于取消。  
如果要取消请求，Client 应该发 MCP 的取消通知，而不是只断开 HTTP 连接。

## 旧 `HTTP + SSE` 传输

旧版 MCP 使用 `HTTP + SSE`，它和 `Streamable HTTP` 不一样。

### 旧模式的连接模型

```text
GET /sse
  <- server sends endpoint event

POST /message?sessionId=...
  -> client sends JSON-RPC

SSE stream
  <- server sends JSON-RPC responses / notifications
```

Client 先连 SSE endpoint：

```http
GET /sse HTTP/1.1
Accept: text/event-stream
```

Server 先发一个 endpoint 事件，告诉 Client 后续往哪里 POST：

```text
event: endpoint
data: /message?sessionId=session_abc

```

Client 后续把 JSON-RPC 发到这个 endpoint：

```http
POST /message?sessionId=session_abc HTTP/1.1
Content-Type: application/json

{"jsonrpc":"2.0","id":1,"method":"tools/list"}
```

Server 再通过最开始那条 SSE stream 把响应推回来：

```text
event: message
data: {"jsonrpc":"2.0","id":1,"result":{"tools":[]}}

```

### 为什么它现在是 legacy

主要问题：

- 需要两个 endpoint。
- 请求和响应不在同一个 HTTP request / response 里。
- 客户端发 POST 后，真正结果从另一条 SSE 连接回来。
- 更依赖服务端保存 session 状态。
- 对负载均衡、回压、断线恢复都更麻烦。

所以新实现优先用 `Streamable HTTP`。  
旧 `HTTP + SSE` 主要用于兼容老客户端和老 Server。

## 传输选择

| 场景 | 推荐 |
| --- | --- |
| 本地文件、Git、本地命令 | `stdio` |
| IDE 插件启动本地 Server | `stdio` |
| 远程数据库、云服务、企业 API | `Streamable HTTP` |
| 多客户端共享同一个 Server | `Streamable HTTP` |
| 要兼容旧 MCP Server | 先探测 `Streamable HTTP`，失败再 fallback 到旧 `HTTP + SSE` |

一个比较稳的探测顺序：

```text
1. 对用户给的 URL 发 POST initialize
2. 如果成功：按 Streamable HTTP 使用
3. 如果返回 400 / 404 / 405：尝试 GET SSE
4. 如果收到 endpoint event：按旧 HTTP + SSE 使用
```

## Host 侧最小结构

Host 里最好抽一个 transport 接口：

```ts
export type TransportMessageHandler = (message: unknown) => void

export interface McpTransport {
  start(onMessage: TransportMessageHandler): Promise<void>
  send(message: unknown): Promise<void>
  close(): Promise<void>
}
```

然后 MCP Client 只依赖 transport：

```ts
export class McpClientSession {
  private nextId = 1
  private readonly pending = new Map<number, PendingRequest>()

  constructor(private readonly transport: McpTransport) {}

  async start() {
    await this.transport.start((message) => this.handleMessage(message))
    await this.initialize()
  }

  async request<T>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId++
    const message = {
      jsonrpc: '2.0',
      id,
      method,
      params
    }

    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        method,
        startedAt: Date.now()
      })
    })

    await this.transport.send(message)
    return promise
  }

  async notify(method: string, params?: unknown) {
    await this.transport.send({
      jsonrpc: '2.0',
      method,
      params
    })
  }

  private async initialize() {
    await this.request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: {
        name: 'my-host',
        version: '1.0.0'
      }
    })

    await this.notify('notifications/initialized')
  }

  private handleMessage(message: any) {
    if ('id' in message && ('result' in message || 'error' in message)) {
      const pending = this.pending.get(message.id)
      if (!pending) return

      this.pending.delete(message.id)

      if (message.error) {
        pending.reject(new Error(message.error.message))
      } else {
        pending.resolve(message.result)
      }

      return
    }

    if (message.method) {
      this.handleServerMethod(message)
    }
  }

  private handleServerMethod(message: any) {
    if (message.method === 'notifications/tools/list_changed') {
      // refresh tools/list cache
      return
    }

    // handle server-to-client requests or notifications here
  }
}
```

这样 `stdio` 和 `Streamable HTTP` 只是 transport 实现不同，上层 request / response 对齐逻辑不用改。

## Agent Loop 不是 MCP 的一部分

MCP 到 `tools/call` 就结束了吗？对协议来说差不多；对 Agent 来说还没有。

Host 还要做：

```text
用户输入
  -> 组装模型上下文
  -> 注入可见工具 schema
  -> 模型提出 tool call
  -> Host 做权限判断
  -> MCP Client 发 tools/call
  -> Server 返回 result
  -> Host 裁剪 / 归一化 result
  -> 回填给模型
  -> 模型继续推理或最终回答
```

所以 MCP Server 暴露了 `delete_file`，不代表模型就应该直接执行。  
敏感工具确认、路径边界、审计日志都在 Host 这一侧做。

## 内部实现最容易漏的点

### 1. stdout 污染

`stdio` Server 只要往 stdout 打一行普通日志，协议就可能炸。

### 2. HTTP header 不完整

`Streamable HTTP` 请求要认真处理：

- `Accept`
- `Content-Type`
- `MCP-Protocol-Version`
- `MCP-Session-Id`
- `Last-Event-ID`

### 3. 把旧 SSE 当成新 HTTP

旧 `HTTP + SSE` 是 `/sse` + `/message`。  
新 `Streamable HTTP` 是单 MCP endpoint 支持 POST / GET。

### 4. 断线当取消

SSE 断开可能只是网络问题。  
取消工具调用要显式发取消通知。

### 5. 工具缓存不刷新

Server 发 `notifications/tools/list_changed` 后，Host 要重新拉 `tools/list`。

### 6. 工具结果原样塞给模型

MCP 的 tool result 可能很大。Host 要做摘要、裁剪、结构化和安全过滤。

### 7. 忽略 server-to-client 请求

MCP 不只是 client 调 server。Server 也可能向 client 发请求，例如采样、补充用户输入、读取 roots 等能力。  
Host 要么支持，要么明确返回错误，不要静默丢掉。

### 8. 没有超时和清理

pending request 要有超时。Transport close 时，要 reject 所有 pending request。

## 安全边界

### 本地 `stdio`

重点是：

- 子进程启动命令是否可信
- 工作目录是否受控
- 环境变量里有没有敏感信息
- Server 能访问哪些文件和命令
- stderr 日志会不会泄露密钥

### 远程 HTTP

重点是：

- 校验 `Origin`
- 本地 HTTP Server 只绑定 `127.0.0.1`
- 做认证和授权
- 管好 `MCP-Session-Id`
- 对工具调用做 rate limit
- 对工具输入输出做校验和脱敏

MCP 协议提供连接方式，不自动提供权限模型。

## 推荐落地顺序

如果自己写 Host，建议按这个顺序：

1. 先写 JSON-RPC pending map。
2. 抽象 `McpTransport`。
3. 实现 `stdio` transport。
4. 实现 `initialize` / `initialized`。
5. 实现 `tools/list` 和工具缓存。
6. 把 MCP tools 转成模型可见 schema。
7. 实现 `tools/call`。
8. 把 tool result 归一化后回填给模型。
9. 补 `notifications/tools/list_changed`。
10. 再实现 `Streamable HTTP`。
11. 最后考虑旧 `HTTP + SSE` 兼容。

不要第一步就写 Agent Loop。  
先把 MCP Client 会话层写稳，再把它接进 Agent。

## 参考

- [MCP Transports 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [MCP Lifecycle 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)
- [MCP Tools 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
- [MCP Transports 2024-11-05](https://modelcontextprotocol.io/specification/2024-11-05/basic/transports)

## 最后记一句话

MCP 的关键不是“多了几个工具”，而是：

**Host 用统一的 JSON-RPC 会话，把本地子进程、远程 HTTP 服务、工具、资源、Prompt 和模型工具调用连接到同一套可控执行平面里。**
