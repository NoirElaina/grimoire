---
title: 工具调用协议
sidebarTitle: 工具调用协议
---

# 工具调用协议

> 工具调用不是“模型想调什么就调什么”。工程里要把工具定义、参数校验、权限、执行、错误、幂等、观测都协议化。

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

## Function Calling 底层流程

Function Calling 不是模型直接执行函数。

模型不会访问你的数据库、文件系统或 HTTP API。

它只是在响应里生成一个结构化的“工具调用请求”。

真正执行在应用代码里。

完整流程：

```text
1. 应用把用户问题和 tools 定义发给模型。
2. 模型判断是否需要工具。
3. 如果需要，模型返回 tool_call。
4. 应用解析 tool_call。
5. 应用校验工具名、参数、权限和风险。
6. 应用执行真实函数 / API / MCP tool。
7. 应用把 tool result 作为新消息回填给模型。
8. 模型基于 tool result 生成最终回答，或继续请求工具。
```

关键边界：

```text
模型负责选择工具和生成参数。
应用负责校验、执行、授权、超时、审计和回填。
```

### 模型到底输出什么

抽象结构类似：

```json
{
  "type": "tool_call",
  "id": "call_01",
  "name": "get_order",
  "arguments": {
    "orderNo": "O10086"
  }
}
```

这不是函数执行结果。

这只是模型说：

```text
我需要调用 get_order，参数是 orderNo=O10086。
```

### 应用怎么处理

应用层要做分发：

```python
def handle_tool_call(tool_call):
    name = tool_call["name"]
    arguments = tool_call["arguments"]

    tool = tool_registry.get(name)
    if tool is None:
        return tool_error(tool_call["id"], "UNKNOWN_TOOL", "工具不存在")

    validated_args = validate_json_schema(tool.input_schema, arguments)
    check_permission(tool, validated_args)
    check_risk_and_approval(tool, validated_args)

    try:
        result = tool.execute(validated_args)
        return tool_success(tool_call["id"], result)
    except Exception as error:
        return tool_error(tool_call["id"], "TOOL_EXECUTION_ERROR", str(error))
```

模型给的参数不能直接信。

必须按 JSON Schema 校验。

高风险工具还要做人工审批。

### 为什么要二次请求模型

工具结果不是自动进入模型脑子里。

应用必须把工具结果回填：

```json
{
  "type": "tool_result",
  "toolCallId": "call_01",
  "content": {
    "orderNo": "O10086",
    "status": "PAID"
  }
}
```

然后再次请求模型。

模型看到工具结果后，才能回答：

```text
订单 O10086 当前状态是已支付。
```

如果工具结果不回填，模型只能猜。

### 多工具调用

一次模型响应可能有多个 tool call：

```text
get_user(userId)
get_order(orderNo)
get_refund_policy(orderType)
```

应用可以：

- 串行执行。
- 并行执行。
- 按依赖关系执行。
- 对高风险工具暂停审批。

注意：

```text
工具 A 的结果如果是工具 B 的参数，就不能盲目并行。
```

### 工具调用循环

Function Calling 通常是循环：

```text
model -> tool_call -> app executes -> tool_result -> model
```

直到：

- 模型输出最终文本。
- 达到最大轮数。
- 工具失败。
- 用户取消。
- 风险审批拒绝。

伪代码：

```python
for step in range(max_tool_rounds):
    response = call_model(messages, tools)

    if not response.tool_calls:
        return response.final_text

    for tool_call in response.tool_calls:
        tool_result = handle_tool_call(tool_call)
        messages.append(tool_result)

raise RuntimeError("超过最大工具调用轮数")
```

必须设置最大轮数。

否则模型可能陷入反复查工具的循环。

### Structured Outputs

如果工具定义启用严格 schema，模型生成的参数会更贴近 JSON Schema。

但这不等于可以跳过校验。

原因：

- schema 只能约束形状，不懂业务权限。
- schema 不能判断用户是否有权操作。
- schema 不能判断删除、支付、发消息是否需要审批。
- schema 不能替你处理超时和重试。

所以：

```text
strict schema 是第一层。
应用校验和权限控制是第二层。
人工审批是高风险动作的第三层。
```

### Function Calling 和 MCP

Function Calling 是模型侧工具调用机制。

MCP 是工具服务协议。

它们可以串起来：

```text
模型输出 tool_call
  -> Host 找到这个工具来自 MCP Server
  -> Host 发送 MCP tools/call
  -> MCP Server 执行
  -> Host 把结果包装成 tool_result
  -> 回填给模型
```

不要把 MCP Server 暴露的工具结果原样塞给模型。

仍然要做：

- 输出长度限制。
- 敏感字段脱敏。
- 错误结构化。
- 来源和可信度标记。

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

- [OpenAI Function Calling](https://platform.openai.com/docs/guides/function-calling)
- [OpenAI Agents SDK Tools](https://openai.github.io/openai-agents-python/agents/)
- [OpenAI Agents SDK Tracing](https://openai.github.io/openai-agents-python/tracing/)
