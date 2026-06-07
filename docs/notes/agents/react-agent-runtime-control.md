---
title: ReAct Agent 与运行控制
sidebarTitle: ReAct 与运行控制
---

# ReAct Agent 与运行控制

这里的 `ReAct` 不是 React 前端框架。

它指的是：

```text
Reasoning + Acting
```

也就是让模型在任务中交替进行：

```text
思考下一步
  -> 选择动作
  -> 调用工具
  -> 观察结果
  -> 更新计划
  -> 继续或结束
```

现代 tool-calling agent、coding agent、browser agent 很多都可以看成 ReAct 思路的工程化版本。

## ReAct 基本结构

论文里的经典格式常写成：

```text
Thought: 我需要查询订单状态
Action: get_order_status(orderNo="O10086")
Observation: 订单状态是 PAID
Thought: 已支付订单不应该取消
Answer: 该订单已支付，不会被超时取消。
```

工程里不会一定把 `Thought` 明文暴露出来。

但运行结构仍然类似：

```text
Model call
  -> tool call
  -> tool result
  -> model call
  -> final answer
```

## ReAct Agent 架构

```text
User Input
  -> Context Builder
  -> Model
      -> final answer
      -> tool call
  -> Tool Router
  -> Middleware / Guardrail
  -> Tool Executor
  -> Observation
  -> State / Trace
  -> Next Model Call
```

核心模块：

| 模块 | 作用 |
| --- | --- |
| Context Builder | 组装 system、history、RAG、memory、工具定义 |
| Model | 选择回答或请求工具 |
| Tool Registry | 保存工具名、描述、schema、风险等级 |
| Tool Router | 根据 tool name 找到真实执行器 |
| Middleware | 在模型调用和工具调用前后做控制 |
| Tool Executor | 执行真实函数、API、MCP tool |
| State Store | 保存消息、工具结果、任务状态 |
| Trace | 记录每轮模型调用、工具参数、结果、耗时 |
| Stop Controller | 控制最大轮数、超时、取消和失败退出 |

## 模型怎么选择工具

模型并不是“知道”你的函数。

应用把工具定义发给模型：

```json
{
  "name": "search_docs",
  "description": "搜索项目技术笔记，适合查询已有文档中的概念、配置和实现步骤。",
  "input_schema": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "要搜索的问题或关键词"
      }
    },
    "required": ["query"]
  }
}
```

模型根据这些信息判断：

- 用户意图是否需要外部信息。
- 哪个工具 description 最匹配。
- 需要填哪些参数。
- 是否已有足够信息直接回答。

所以工具选择质量取决于：

```text
工具名是否清楚。
description 是否具体。
schema 字段是否明确。
工具数量是否过多。
工具之间是否重叠。
系统提示是否说明使用边界。
历史上下文是否污染了判断。
```

## 工具描述怎么写

差的描述：

```text
search: useful for search
```

好的描述：

```text
search_docs:
用于搜索本项目文档和技术笔记。
适合回答“已有笔记里怎么写”“某个配置是什么意思”“某个实现流程在哪里”。
不适合查询实时新闻、外部网页或执行代码。
```

工具描述要写：

- 什么时候用。
- 什么时候不用。
- 输入是什么。
- 输出是什么。
- 风险是什么。

模型选择工具不是靠玄学，靠的是这些可见信息。

## 工具太多会怎样

工具太多会让模型选择困难。

表现：

- 选错工具。
- 多次尝试相似工具。
- 参数填错。
- 能直接回答却调用工具。
- 高风险工具被误选。

解决：

```text
按任务动态暴露工具。
把相似工具合并。
用 router 先选择工具组。
给工具加风险等级。
给高风险工具加审批。
用 middleware 过滤不可用工具。
```

不要把所有工具一次性塞给模型。

## 什么是 Middleware

Agent Middleware 是插在 agent 主循环中的控制层。

它不是业务工具。

它负责改造或拦截运行过程。

常见位置：

```text
before_agent
before_model
wrap_model_call
after_model
wrap_tool_call
after_agent
```

类比 Web 中间件：

```text
请求进入
  -> 鉴权中间件
  -> 日志中间件
  -> 业务处理
  -> 响应中间件
  -> 返回
```

Agent 里：

```text
用户任务进入
  -> 上下文中间件
  -> 模型调用中间件
  -> 工具审批中间件
  -> 工具执行
  -> 结果压缩中间件
  -> 返回
```

## Middleware 能做什么

| 类型 | 位置 | 作用 |
| --- | --- | --- |
| 动态提示词 | `before_model` | 根据任务注入 system prompt |
| 上下文压缩 | `before_model` | 压缩历史和工具结果 |
| 模型路由 | `wrap_model_call` | 按任务选择大模型或小模型 |
| 重试 | `wrap_model_call` | 模型调用失败时重试 |
| PII 脱敏 | `before_model` / `after_model` | 输入输出脱敏 |
| 工具审批 | `wrap_tool_call` | 高风险工具人工确认 |
| 工具限流 | `wrap_tool_call` | 限制调用次数和频率 |
| 工具参数校验 | `wrap_tool_call` | 校验 schema、权限、范围 |
| 观测 | 全部 hook | 记录 trace、token、耗时 |
| 失败检测 | `after_model` / `wrap_tool_call` | 检测循环、重复失败 |

OpenAI Agents SDK 里常见对应概念是 hooks、guardrails、tool guardrails。

LangChain / LangGraph 里会直接称为 middleware 或 graph node。

## 限制工具调用怎么做

限制工具调用不能只靠 prompt。

要用硬规则。

### 1. 工具白名单

每个任务只暴露必要工具：

```text
写文档任务：
  read_file
  search_docs
  apply_patch

不要暴露：
  delete_database
  send_email
  deploy_prod
```

### 2. 风险分级

```text
read：可直接执行
write：需要权限检查
external：需要审批
destructive：默认禁止或强审批
```

### 3. 调用次数上限

按 run 统计：

```json
{
  "maxToolCallsPerRun": 20,
  "maxCallsPerTool": {
    "search_docs": 5,
    "shell": 8,
    "send_email": 1
  }
}
```

### 4. 参数范围限制

例如 shell：

```text
允许：npm test、git diff、rg
禁止：rm -rf、格式化磁盘、上传密钥
```

例如 SQL：

```text
允许：SELECT
禁止：DROP、TRUNCATE、UPDATE 无 where
```

### 5. 人工审批

高风险工具进入审批：

```json
{
  "toolName": "send_email",
  "arguments": {
    "to": "customer@example.com",
    "subject": "退款处理结果"
  },
  "risk": "external",
  "approvalRequired": true
}
```

审批结果：

```text
approve：执行原参数
edit：修改参数后执行
reject：不执行，给模型一个拒绝结果
```

### 6. 循环检测

检测：

- 同一个工具同一参数重复调用。
- 连续工具失败。
- 模型反复搜索同一个 query。
- 工具调用超过最大轮数。

处理：

```text
停止执行。
总结失败原因。
让模型换策略。
必要时交给用户。
```

## 为什么限制五轮

“五轮”不是标准答案。

它通常是一个工程默认值：

```text
max_tool_rounds = 5
```

原因：

- 大多数简单任务 1-3 轮就能完成。
- 复杂任务 5 轮还没有收敛，通常需要换策略或人工介入。
- 轮数越多，token、成本、延迟和错误累积越高。
- 工具失败循环经常在 3-5 轮内暴露。

一个经验配置：

| 场景 | 最大轮数 |
| --- | --- |
| 普通问答 + 检索 | 2-3 |
| RAG + rerank + 引用 | 3-5 |
| coding agent 小改动 | 5-10 |
| 长任务工作流 | 不靠单 run 轮数，拆阶段和 checkpoint |

所以五轮的含义是：

```text
它是默认保护阈值，不是能力上限。
```

超过五轮时，不应该只是继续让模型试。

要做：

- 输出当前状态。
- 归纳卡住原因。
- 换工具或换策略。
- 请求用户确认。
- 拆成子任务。

## 运行控制伪代码

```python
def run_agent(user_input, tools, max_rounds=5):
    state = init_state(user_input)

    for round_index in range(max_rounds):
        model_request = build_context(state, tools)
        model_response = call_model(model_request)

        trace_model_call(model_request, model_response)

        if model_response.final_answer:
            return model_response.final_answer

        for tool_call in model_response.tool_calls:
            if not tool_policy.allow(tool_call, state):
                state.add_tool_result(reject_tool_call(tool_call))
                continue

            if approval_required(tool_call):
                decision = request_approval(tool_call)
                if decision.reject:
                    state.add_tool_result(reject_tool_call(tool_call))
                    continue
                tool_call = decision.edited_tool_call

            result = execute_tool_with_timeout(tool_call)
            state.add_tool_result(result)

        if loop_detector.detect(state):
            return summarize_stuck_state(state)

    return ask_user_or_handoff(state)
```

## 常见坑

### 1. 让模型自己限制自己

```text
请你最多调用 3 次工具。
```

这不够。

必须在应用层计数。

### 2. 工具描述太泛

模型会乱选工具。

工具描述必须包含使用边界。

### 3. 错误结果原样回填

工具报错如果只是：

```text
Error
```

模型不知道怎么修。

应该返回：

```json
{
  "ok": false,
  "errorCode": "INVALID_ARGUMENT",
  "message": "limit must be <= 20",
  "retryable": true
}
```

### 4. 没有 trace

没有 trace 就不知道：

- 模型为什么选这个工具。
- 参数从哪里来。
- 工具结果是什么。
- 哪一轮开始跑偏。

## 去空话检查

- [ ] 是否区分 ReAct 思路和 React 前端框架。
- [ ] 是否知道模型只是产生 tool call，不执行工具。
- [ ] 是否知道工具选择依赖 name、description、schema 和上下文。
- [ ] 是否用 middleware / guardrail 做硬限制。
- [ ] 是否限制工具次数、工具范围和参数范围。
- [ ] 是否为高风险工具加人工审批。
- [ ] 是否设置最大轮数和循环检测。
- [ ] 是否知道“五轮”是保护阈值，不是标准答案。

## 参考

- [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629)
- [LangGraph create_react_agent](https://reference.langchain.com/python/langgraph.prebuilt/chat_agent_executor/create_react_agent)
- [LangChain Middleware](https://docs.langchain.com/oss/python/langchain/middleware)
- [OpenAI Agents SDK Lifecycle Hooks](https://openai.github.io/openai-agents-python/ref/lifecycle/)
- [OpenAI Agents SDK Guardrails](https://openai.github.io/openai-agents-python/guardrails/)
- [工具调用协议](/notes/agents/tool-calling-protocol)
