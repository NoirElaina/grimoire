---
title: Agents 总览
sidebarTitle: 专题首页
---

# Agents 总览

这一组只写 Agent 工程落地：产品规范提示词、SDD、Harness、主循环、工具协议、上下文、记忆、RAG、MCP、编排、人工审批、评测和跨 Agent 通信。

## 学习路径

先读“系统怎么跑”，再读“怎么接工具”，最后读“怎么稳定上线”。

```text
产品规范提示词
  -> SDD 规范驱动开发
  -> Harness Engineering
  -> Agent 主循环
  -> 工具调用协议
  -> ReAct 与运行控制
  -> 上下文与记忆
  -> RAG 向量检索
  -> RAG 长文档切片
  -> RAG Rerank
  -> RAG 系统评测
  -> MCP 实战
  -> LangGraph 工作流
  -> 多 Agent 协作
  -> Human-in-the-loop
  -> Agent 评测
  -> A2A 协议
```

## AI 协作

| 笔记 | 重点 |
| --- | --- |
| [产品规范提示词](/notes/agents/product-spec-prompt) | 产品背景、技术栈、架构约束、接口/表结构、任务拆分、验收标准 |
| [SDD 规范驱动开发](/notes/agents/spec-driven-development) | Spec、Plan、Tasks、Implement、验收标准、Spec-kit、OpenSpec |
| [Harness Engineering](/notes/agents/harness-engineering) | Context、Control、Tools、Runtime、Evaluation 五个核心模块 |

## Agent 地基

| 笔记 | 重点 |
| --- | --- |
| [Agent 主循环](/notes/agents/agent-main-loop) | run state、模型调用、工具执行、结果回填、终止条件、trace |
| [工具调用协议](/notes/agents/tool-calling-protocol) | tool schema、tool_call_id、参数校验、错误协议、重试与权限 |
| [ReAct 与运行控制](/notes/agents/react-agent-runtime-control) | ReAct、工具选择、middleware、工具限制、最大轮数、循环检测 |
| [上下文与记忆](/notes/agents/context-memory) | system、history、RAG、workspace state、memory write、压缩策略 |
| [RAG 向量检索](/notes/agents/rag-vector-retrieval-basics) | 向量数据库、Embedding、ES 切换、Recall@5、过拟合、评测集更新 |
| [RAG 长文档切片](/notes/agents/rag-chunking-strategy) | chunk 粒度、overlap、结构化切片、父子切片、rerank、评估指标 |
| [RAG Rerank](/notes/agents/rag-rerank-cross-encoder) | bi-encoder、cross-encoder、两阶段检索、rerank 指标、延迟成本取舍 |
| [RAG 系统评测](/notes/agents/rag-evaluation-metrics) | Recall@K、MRR、Context Precision、Faithfulness、引用、拒答、线上监控 |
| [MCP 实战](/notes/agents/mcp-practice) | stdio、Streamable HTTP、initialize、tools/list、tools/call、资源与安全 |

## 编排与协作

| 笔记 | 重点 |
| --- | --- |
| [LangGraph 工作流](/notes/agents/langgraph-workflow) | StateGraph、node、edge、checkpoint、thread_id、durable execution |
| [多 Agent 协作](/notes/agents/multi-agent-collaboration) | handoff、supervisor、流水线、并行、review、blackboard、A2A 与挑战 |
| [Human-in-the-loop](/notes/agents/human-in-the-loop) | 审批点、interrupt、审批状态、审计日志、超时与恢复 |
| [Agent 评测](/notes/agents/agent-evaluation) | 任务成功率、工具选择、参数准确率、安全、成本、trace replay |
| [A2A 协议](/notes/agents/a2a-protocol) | Agent Card、Message、Part、Task、Artifact、远程 Agent 协作 |

## 协议参考

| 笔记 | 重点 |
| --- | --- |
| [工具调用](/notes/agents/tooling-template) | 基础函数工具模板、入参、出参、错误处理 |
| [SSE 流式响应](/notes/agents/sse-streaming) | `text/event-stream`、事件格式、断线重连、前后端接法 |
| [MCP 协议](/notes/agents/mcp-protocol) | stdio、Streamable HTTP、tools/resources/prompts、协议生命周期 |
| [MCP vs Skills](/notes/agents/mcp-vs-skills) | MCP、Skills、Function Calling、A2A 的边界和组合方式 |

## 工程判断

写 Agent 不要先追框架名，先把这些问题拆清楚：

- **主循环**：一次用户请求会触发几轮模型调用，什么时候停。
- **工具边界**：模型只能提出调用意图，真正执行必须由程序校验、授权、超时和记录。
- **上下文预算**：哪些内容必须进 prompt，哪些只进检索库，哪些应该压缩或丢弃。
- **人工审批**：写文件、执行命令、发消息、扣款、删数据这类动作不能默认放行。
- **可观测性**：每轮模型输入、工具入参、工具结果、错误、token、耗时都要能回放。
- **评测闭环**：上线前不能只看 demo，要用固定案例集测工具调用、结果质量和安全拒答。

## 后续可补

- **Agent Runtime 安全**：sandbox、权限模型、网络访问、文件访问、命令执行。
- **Agent 观测**：trace/span、成本统计、失败归类、线上 replay。
- **生产部署**：队列、并发、幂等、限流、取消任务、任务恢复。

## 参考

- [OpenAI Agents SDK](https://platform.openai.com/docs/guides/agents-sdk/)
- [OpenAI Agents SDK Tracing](https://openai.github.io/openai-agents-python/tracing/)
- [LangGraph Overview](https://docs.langchain.com/oss/python/langgraph)
- [LangGraph Durable Execution](https://docs.langchain.com/oss/python/langgraph/durable-execution)
- [MCP Transports](https://modelcontextprotocol.io/docs/concepts/transports)
- [OpenAI Function Calling](https://platform.openai.com/docs/guides/function-calling)
- [OpenAI Agent Skills](https://developers.openai.com/codex/skills)
- [Pinecone Rerankers](https://www.pinecone.io/learn/series/rag/rerankers/)
- [Agent2Agent Protocol Specification](https://google-a2a.github.io/A2A/specification/)
- [CrewAI Documentation](https://docs.crewai.com/)
- [Microsoft Agent Framework](https://learn.microsoft.com/en-us/agent-framework/overview/)
