---
title: 工具调用协议
sidebarTitle: 工具调用协议
---

# 工具调用协议

> 工具调用不是“模型想调什么就调什么”。工程里要把工具定义、参数校验、权限、执行、错误、幂等、观测都协议化。

## 先给结论

一个工具协议至少包括：

```text
tool name
description
input schema
risk level
permission policy
timeout
retry policy
idempotency key
result schema
error schema
trace metadata
```

如果只定义：

```json
{
  "name": "delete_file",
  "description": "delete a file"
}
```

那不是工具协议，只是危险函数暴露。

## Tool Definition

```json
{
  "name": "search_docs",
  "description": "Search project documentation by keyword.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "minLength": 1,
        "maxLength": 200
      },
      "limit": {
        "type": "integer",
        "minimum": 1,
        "maximum": 20,
        "default": 5
      }
    },
    "required": ["query"],
    "additionalProperties": false
  },
  "riskLevel": "low",
  "timeoutMs": 3000
}
```

工具描述要写：

- 工具做什么。
- 什么时候该用。
- 输入字段含义。
- 输出是什么。
- 明确限制。

不要写：

```text
Useful tool.
```

这会让模型乱选。

## Tool Call

模型发出的工具调用应该是结构化的：

```json
{
  "id": "call_01HZX",
  "name": "search_docs",
  "arguments": {
    "query": "MCP Streamable HTTP",
    "limit": 5
  }
}
```

运行时用 `id` 把请求和结果关联。

不要只靠工具名关联，因为同一轮可能并行调用多个同名工具。

## 参数校验

执行前必须校验：

```ts
function validateToolCall(tool: ToolDefinition, call: ToolCall) {
  if (tool.name !== call.name) {
    throw new ToolProtocolError('TOOL_NAME_MISMATCH')
  }
  validateJsonSchema(tool.inputSchema, call.arguments)
}
```

校验失败返回给模型：

```json
{
  "toolCallId": "call_01HZX",
  "ok": false,
  "error": {
    "code": "INVALID_ARGUMENTS",
    "message": "`limit` must be <= 20",
    "retryable": true
  }
}
```

让模型有机会修正参数，但要限制修正次数。

## 风险分级

工具按风险分级：

| 等级 | 例子 | 策略 |
| --- | --- | --- |
| `read` | 搜索文档、读取公开数据 | 可直接执行 |
| `write` | 写文件、创建记录 | 需要权限检查 |
| `external` | 发邮件、发消息、调用第三方 | 通常需要审批 |
| `destructive` | 删除文件、删库、付款 | 强制人工审批 |
| `privileged` | 改配置、改权限 | 默认禁用或管理员审批 |

工具定义里要写风险：

```json
{
  "name": "send_email",
  "riskLevel": "external",
  "approvalRequired": true
}
```

## 权限策略

权限不是只靠 prompt 告诉模型“不要乱用”。

运行时要检查：

```ts
async function authorize(user: User, tool: ToolDefinition, args: unknown) {
  if (!user.permissions.includes(tool.requiredPermission)) {
    return deny('PERMISSION_DENIED')
  }
  if (tool.approvalRequired) {
    return requestApproval(tool, args)
  }
  return allow()
}
```

高危工具要有审批 payload：

```json
{
  "tool": "delete_file",
  "arguments": {
    "path": "docs/notes/agents/old.md"
  },
  "risk": "destructive",
  "reason": "Delete obsolete note after replacement",
  "dryRun": {
    "filesAffected": 1
  }
}
```

人应该看到“将要发生什么”，而不是只看到“是否同意 Agent 继续”。

## 工具结果协议

统一结果：

```json
{
  "toolCallId": "call_01HZX",
  "ok": true,
  "data": {
    "items": [
      {
        "title": "MCP Transports",
        "url": "https://modelcontextprotocol.io/docs/concepts/transports"
      }
    ]
  },
  "metadata": {
    "latencyMs": 83,
    "source": "docs-index"
  }
}
```

错误结果：

```json
{
  "toolCallId": "call_01HZX",
  "ok": false,
  "error": {
    "code": "TIMEOUT",
    "message": "search_docs timed out after 3000ms",
    "retryable": true
  }
}
```

错误也要回填给模型，但敏感错误不要原样暴露。

## 幂等

有副作用的工具要支持幂等。

例如创建订单：

```json
{
  "name": "create_order",
  "arguments": {
    "userId": "10001",
    "skuId": "20001",
    "count": 1,
    "idempotencyKey": "run_123:call_456"
  }
}
```

服务端用唯一键兜底：

```sql
create unique index uk_agent_tool_idempotency
on agent_tool_execution (idempotency_key);
```

如果 Agent 因超时重试，不能重复创建订单、重复发邮件、重复扣款。

## 超时和重试

工具必须有超时：

```json
{
  "timeoutMs": 5000,
  "retryPolicy": {
    "maxAttempts": 2,
    "backoffMs": 300
  }
}
```

重试只适合：

- 网络抖动。
- 读操作。
- 幂等写操作。

不适合：

- 未做幂等的支付。
- 未做幂等的发邮件。
- 删除操作。
- 人工审批动作。

## 工具结果裁剪

工具返回不能无限大。

策略：

```text
1. 工具内部分页
2. 结果字段白名单
3. 大文本摘要
4. 附件或文件只返回引用
5. 超过预算时返回可继续查询的 cursor
```

坏例子：

```json
{
  "data": "整个数据库导出内容..."
}
```

好例子：

```json
{
  "items": [...],
  "nextCursor": "cursor_abc",
  "truncated": true
}
```

## Tool Guardrail

工具执行前后都可以加 guardrail。

执行前：

- 参数是否越权。
- 路径是否在允许目录。
- SQL 是否只读。
- 收件人是否白名单。

执行后：

- 返回内容是否含敏感数据。
- 结果是否过大。
- 外部动作是否成功。
- 是否需要脱敏。

比如 SQL 工具：

```text
只允许 SELECT
禁止 information_schema
必须带 limit
禁止 select *
最长执行 3 秒
```

## Trace 字段

每次工具调用记录：

```json
{
  "runId": "run_123",
  "toolCallId": "call_456",
  "toolName": "search_docs",
  "argumentsHash": "sha256:...",
  "approvedBy": null,
  "startedAt": "2026-06-07T12:00:00Z",
  "latencyMs": 83,
  "ok": true,
  "errorCode": null
}
```

敏感参数不要直接打日志。可以记录 hash、字段摘要或脱敏值。

## 去空话检查

- [ ] 工具有 JSON Schema。
- [ ] `additionalProperties` 明确关闭或说明原因。
- [ ] 工具调用有唯一 `toolCallId`。
- [ ] 执行前校验参数和权限。
- [ ] 高风险工具有人工审批。
- [ ] 写操作有幂等键。
- [ ] 工具有超时和重试策略。
- [ ] 工具结果可裁剪、可分页。
- [ ] 工具调用全量进入 trace。

## 参考

- [OpenAI Agents SDK Tools](https://openai.github.io/openai-agents-python/agents/)
- [OpenAI Agents SDK Tracing](https://openai.github.io/openai-agents-python/tracing/)
