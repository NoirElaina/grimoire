---
title: MCP 实战
sidebarTitle: MCP 实战
---

# MCP 实战

> MCP 的价值不是“又多一种插件格式”，而是把 Agent 访问外部工具、资源和提示词的方式协议化。

## 先给结论

MCP 可以理解为：

```text
Agent Client
  -> MCP Transport
  -> MCP Server
  -> Tools / Resources / Prompts
  -> 外部系统
```

常用传输：

| 传输 | 场景 |
| --- | --- |
| `stdio` | 本地工具，客户端启动子进程 |
| `Streamable HTTP` | 远程服务，多客户端连接 |
| HTTP + SSE | 旧版本兼容，不建议新项目优先选 |

当前标准传输是 `stdio` 和 `Streamable HTTP`。`Streamable HTTP` 替代了旧的 HTTP+SSE 方案。

## MCP 里有什么

| 能力 | 含义 | 例子 |
| --- | --- | --- |
| Tools | 可执行动作 | 查询数据库、搜索文档、发请求 |
| Resources | 可读取资源 | 文件、文档、schema、日志 |
| Prompts | 可复用提示模板 | 代码审查模板、排障模板 |
| Sampling | 服务端请求模型能力 | 某些场景由客户端代模型调用 |

先把 Tools 写稳，再考虑 Resources 和 Prompts。

## stdio 模式

流程：

```text
1. Client 启动 MCP Server 子进程
2. Client 往 stdin 写 JSON-RPC 消息
3. Server 从 stdin 读取
4. Server 往 stdout 写 JSON-RPC 响应
5. stderr 只写日志
```

关键约束：

- stdout 只能写 MCP 消息。
- 日志写 stderr。
- 消息用 UTF-8。
- JSON-RPC 消息按换行分隔。
- stdout 里混入普通日志会打坏协议。

适合：

- 本地文件系统工具。
- 本地 Git 工具。
- 本地数据库只读查询。
- 开发环境私有工具。

## Streamable HTTP 模式

流程：

```text
Client -> POST /mcp 发送 JSON-RPC 请求
Client -> GET /mcp 可建立流
Server -> 可用 SSE 返回多条服务端消息
```

适合：

- 远程 MCP 服务。
- 多用户共享工具。
- 需要鉴权。
- 需要部署和监控。

安全重点：

- 校验 `Origin`，防 DNS rebinding。
- 本地服务绑定 `127.0.0.1`，不要随便 `0.0.0.0`。
- 远程服务必须有认证。
- 工具内部仍要做权限校验。

## 初始化流程

典型 JSON-RPC：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-06-18",
    "capabilities": {},
    "clientInfo": {
      "name": "my-agent-client",
      "version": "0.1.0"
    }
  }
}
```

Server 返回：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-06-18",
    "capabilities": {
      "tools": {},
      "resources": {},
      "prompts": {}
    },
    "serverInfo": {
      "name": "project-docs-server",
      "version": "0.1.0"
    }
  }
}
```

初始化后 Client 才应该调用工具列表。

## tools/list

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list",
  "params": {}
}
```

响应：

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "tools": [
      {
        "name": "search_notes",
        "description": "Search notes by keyword.",
        "inputSchema": {
          "type": "object",
          "properties": {
            "query": {
              "type": "string"
            }
          },
          "required": ["query"]
        }
      }
    ]
  }
}
```

`description` 要写清楚什么时候用，不要只写工具名翻译。

## tools/call

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "search_notes",
    "arguments": {
      "query": "Redis 缓存一致性"
    }
  }
}
```

响应：

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "找到 3 篇相关笔记..."
      }
    ],
    "isError": false
  }
}
```

工具失败也要返回结构化错误，不要让进程崩掉。

## Resource

Resource 适合暴露可读数据：

```text
notes://java-backend/index
schema://mysql/order_info
log://app/latest
```

资源读取：

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "resources/read",
  "params": {
    "uri": "notes://java-backend/index"
  }
}
```

Resource 适合：

- 文档。
- schema。
- 配置。
- 日志摘要。

不适合：

- 会修改状态的动作。
- 大文件一次性返回。
- 未授权敏感数据。

## Prompt

Prompts 用来暴露可复用模板：

```text
prompts/list
prompts/get
```

例子：

```json
{
  "name": "review_java_service",
  "description": "Review a Java service implementation for transaction and error handling issues.",
  "arguments": [
    {
      "name": "filePath",
      "required": true
    }
  ]
}
```

Prompt 不应该藏业务权限。它只是模板，不能替代运行时校验。

## MCP Server 设计

一个项目文档 MCP Server 可以这样设计：

```text
tools:
  search_notes(query, limit)
  get_note(path)
  list_topics()

resources:
  notes://agents/index
  notes://java-backend/index

prompts:
  write_engineering_note
  review_note_for_fluff
```

目录：

```text
mcp-server
  src
    server.ts
    tools
      searchNotes.ts
      getNote.ts
    resources
      notesResource.ts
    prompts
      writeNotePrompt.ts
```

## 安全边界

MCP 只是协议，不自动安全。

你仍然要做：

- 工具参数校验。
- 用户权限校验。
- 路径限制。
- SQL 白名单。
- 速率限制。
- 日志审计。
- 敏感字段脱敏。
- 高危工具人工审批。

本地 stdio 工具尤其要小心：

```text
Agent 能调用本地工具 = 可能读写本机文件 / 执行命令
```

不要把“接了 MCP”理解成“工具就安全了”。

## MCP 和普通工具函数的区别

| 对比 | 普通工具函数 | MCP |
| --- | --- | --- |
| 调用边界 | 应用内函数 | 跨进程/远程协议 |
| 工具发现 | 写死 | `tools/list` |
| 资源暴露 | 自己约定 | `resources/*` |
| 传输 | 内存调用 | stdio / HTTP |
| 复用 | 绑定当前应用 | 多客户端可复用 |

如果只是一个应用内部的小工具，普通函数就够。

如果你想让多个 Agent 客户端复用同一套工具，MCP 更合适。

## 去空话检查

- [ ] 知道 stdio 和 Streamable HTTP 的区别。
- [ ] stdout 只输出协议消息，日志写 stderr。
- [ ] 新项目优先 Streamable HTTP，不再优先旧 HTTP+SSE。
- [ ] tools/list 的 description 能指导模型选择。
- [ ] tools/call 有参数校验和错误结构。
- [ ] 资源只读，动作放工具。
- [ ] MCP Server 仍然做鉴权、限流和审计。

## 参考

- [MCP Transports](https://modelcontextprotocol.io/docs/concepts/transports)
