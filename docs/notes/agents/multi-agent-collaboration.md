---
title: 多 Agent 协作模式
sidebarTitle: 多 Agent 协作
---

# 多 Agent 协作模式

多 Agent 不是“多建几个角色聊天”。

它解决的是：一个 Agent 难以同时处理多个专业边界、多个执行阶段、多个工具权限或多个并行任务。

如果一个 Agent + 工具能稳定完成，就不要拆多 Agent。

拆 Agent 会带来额外成本：

- 上下文传递。
- 状态同步。
- 权限隔离。
- 结果合并。
- 调试复杂度。
- 评测复杂度。

## 什么时候需要多 Agent

适合：

- 任务天然分阶段：规划、执行、审核、发布。
- 任务需要不同专业能力：后端、前端、测试、安全。
- 工具权限不同：读文件、写文件、执行命令、访问外部 API。
- 可以并行处理：多个文档摘要、多个候选方案、多个测试环境。
- 需要独立复核：生成者和审查者分离。
- 需要跨系统协作：本地 Agent 调远程 Agent。

不适合：

- 简单问答。
- 单步工具调用。
- 只是为了“看起来智能”。
- 没有状态管理和 trace。
- 没有办法评测每个 Agent 的贡献。

## 常见模式总览

| 模式 | 核心结构 | 适用场景 | 风险 |
| --- | --- | --- | --- |
| 单 Agent + 多工具 | 一个 Agent 调多个工具 | 大多数普通任务 | 工具太多会选择混乱 |
| Handoff | 一个 Agent 转交给另一个 Agent | 专业分流、客服、领域专家 | 上下文传递不当 |
| Sequential Pipeline | Agent 按顺序执行 | 规划 -> 执行 -> 审核 | 前面错会传染后面 |
| Supervisor / Manager | 管理者分派任务给专家 | 复杂任务拆解 | 管理者判断错 |
| Parallel Fan-out | 多 Agent 并行处理 | 多文档、多方案、多测试 | 合并困难、成本高 |
| Debate / Review | 生成者和批评者对抗 | 代码审查、方案评估 | 循环争论、无收敛 |
| Group Chat | 多 Agent 共享会话 | 头脑风暴、协商 | 上下文爆炸、角色漂移 |
| Blackboard | 共享状态板读写 | 长任务、多阶段协作 | 状态污染、写入冲突 |
| A2A | 远程 Agent 协议互操作 | 跨组织、跨产品、跨平台 | 鉴权、任务状态和责任边界 |

## 模式一：单 Agent + 多工具

结构：

```text
User
  -> Agent
      -> tool A
      -> tool B
      -> tool C
```

这不是多 Agent，但应该是默认起点。

如果只是需要查数据库、读文件、调接口，一个 Agent 加工具通常够。

适合：

- 查询 + 总结。
- 代码修改。
- 数据分析。
- 简单业务自动化。

不适合：

- 多个专家必须独立判断。
- 工具权限要严格隔离。
- 任务要并行跑。

判断标准：

```text
如果只是“能力多”，用工具。
如果是“责任边界不同”，再考虑多 Agent。
```

## 模式二：Handoff

Handoff 是“转交控制权”。

```text
Triage Agent
  -> Billing Agent
  -> Refund Agent
  -> Tech Support Agent
```

OpenAI Agents SDK 里的 handoff 会被表示成模型可调用的工具，例如 `transfer_to_refund_agent`。

适合：

- 客服分流。
- 不同业务领域专家。
- 一个 Agent 判断意图，另一个 Agent 深入处理。

关键设计：

```text
handoff_name
handoff_description
input_filter
handoff_payload
handoff_reason
```

不要把全部历史无脑传给下一个 Agent。

应该传：

```json
{
  "userGoal": "申请退款",
  "knownFacts": {
    "orderId": "O10086",
    "reason": "未收到货"
  },
  "previousActions": [
    "已查询订单状态"
  ],
  "handoffReason": "需要退款政策判断"
}
```

风险：

- 转错 Agent。
- 新 Agent 看不到关键上下文。
- 旧 Agent 的错误结论污染新 Agent。
- 循环 handoff。

## 模式三：Sequential Pipeline

顺序流水线：

```text
Planner
  -> Executor
  -> Reviewer
  -> Publisher
```

适合：

- 代码生成。
- 文档写作。
- 数据处理。
- 工作流审批。

优点：

- 结构清晰。
- 每一步可验收。
- 容易加人工审核。

缺点：

- 上游错误会传到下游。
- 每一步都要定义输入输出。
- 总延迟变长。

工程要求：

```text
每个 Agent 输出结构化结果。
下一步只消费必要字段。
每一步写 trace。
每一步可以失败和重试。
```

示例：

```json
{
  "stage": "review",
  "input": {
    "planId": "plan-001",
    "changedFiles": ["OrderService.java"]
  },
  "output": {
    "approved": false,
    "issues": [
      "缺少事务回滚测试"
    ]
  }
}
```

## 模式四：Supervisor / Manager

一个管理 Agent 负责拆任务、分配、收敛。

```text
Supervisor
  -> Frontend Agent
  -> Backend Agent
  -> Test Agent
  -> Security Agent
```

适合：

- 大任务拆解。
- 多专业协同。
- 多文件、多模块工作。

管理者要做：

- 拆子任务。
- 选择 Agent。
- 分配上下文。
- 合并结果。
- 判断是否需要返工。

风险：

- Supervisor 成为单点错误。
- 拆分太粗或太细。
- 子 Agent 输出互相冲突。
- 合并结果没有验证。

不要让 Supervisor “凭感觉满意”。

要让它基于检查项收敛：

```text
功能是否完成。
测试是否通过。
接口是否一致。
权限是否正确。
成本是否超预算。
是否需要人工审批。
```

## 模式五：Parallel Fan-out / Fan-in

并行扇出再合并：

```text
          -> Agent A
User -> Router -> Agent B -> Aggregator
          -> Agent C
```

适合：

- 多文档摘要。
- 多方案生成。
- 多候选检索。
- 多测试并行。
- 不同模型交叉验证。

关键问题是 fan-in。

Aggregator 不能只是拼接结果。

它要做：

- 去重。
- 冲突检测。
- 证据合并。
- 置信度排序。
- 输出统一格式。

风险：

- 成本成倍增加。
- 并行结果互相矛盾。
- 聚合器遗漏少数但正确的结果。
- trace 更难读。

## 模式六：Debate / Review

生成者和审查者分离：

```text
Writer
  -> Critic
  -> Writer revision
  -> Final Reviewer
```

适合：

- 代码审查。
- 安全审计。
- 方案评估。
- 高风险回答。

注意：

Critic 不应该只说“有问题”。

应该输出结构化问题：

```json
{
  "severity": "high",
  "claim": "库存扣减已保证幂等",
  "evidence": "代码中没有 idempotency_key",
  "fix": "增加唯一索引或 Redis 去重"
}
```

风险：

- 互相说服而不是验证。
- 无限循环。
- Critic 幻觉问题。
- 修复引入新问题。

必须设置最大轮数和退出条件。

## 模式七：Group Chat

多个 Agent 在一个共享对话中讨论。

适合：

- 创意讨论。
- 需求澄清。
- 多角度评估。

不适合：

- 严格生产流程。
- 权限敏感任务。
- 长任务。

问题：

- 上下文很快爆炸。
- 每个 Agent 都看到所有信息。
- 角色边界容易漂移。
- 难以确定谁对结果负责。

生产系统一般不把 group chat 当核心执行架构。

更常见做法是：用结构化流程替代自由聊天。

## 模式八：Blackboard / Shared State

多个 Agent 不直接对话，而是读写共享状态。

```text
Shared State
  <- Planner
  <- Researcher
  <- Coder
  <- Reviewer
```

适合：

- 长任务。
- 多阶段任务。
- 需要持久化中间结果。
- 需要人类随时查看状态。

状态结构：

```json
{
  "goal": "补全 RAG 笔记",
  "tasks": [
    {
      "id": "rag-rerank",
      "owner": "retrieval-agent",
      "status": "done",
      "artifacts": ["rag-rerank-cross-encoder.md"]
    }
  ],
  "decisions": [
    "Rerank 单独成篇"
  ],
  "openIssues": []
}
```

风险：

- 状态写入冲突。
- 旧状态污染新任务。
- Agent 把草稿当事实。
- 没有版本和审计。

需要：

- 状态版本。
- 写入权限。
- 事实和假设分离。
- 决策记录。
- 过期清理。

## 模式九：A2A 远程协作

A2A 解决的是跨 Agent 系统互操作。

```text
Client Agent
  -> 读取远程 Agent Card
  -> 创建 Task
  -> 发送 Message / Part
  -> 接收 Artifact
```

适合：

- 跨产品协作。
- 远程专业 Agent。
- 不同厂商 Agent 互调。
- Agent 市场或企业内 Agent 服务目录。

它和框架内多 Agent 不一样。

框架内多 Agent 通常共享运行时。

A2A 面向远程协议、身份、任务状态和产物交换。

## 主要挑战

### 1. 上下文隔离

每个 Agent 不应该看到全部历史。

要按任务给最小上下文：

```text
目标
约束
必要事实
可用工具
输入产物
输出格式
```

### 2. 状态一致性

多 Agent 会同时产生中间状态。

必须定义：

- 谁能写。
- 写什么。
- 怎么合并。
- 冲突怎么处理。
- 状态何时过期。

### 3. 责任边界

每个 Agent 要有明确输入输出。

不要写：

```text
你负责把事情做好。
```

要写：

```text
输入：接口设计文档。
输出：后端实现任务列表。
禁止：修改前端方案。
验收：每个任务包含文件、原因、验证方式。
```

### 4. 成本和延迟

多 Agent 会放大 token 和模型调用。

要记录：

- 每个 Agent 的输入 token。
- 输出 token。
- 工具调用次数。
- 失败重试次数。
- 总耗时。

### 5. 评测困难

不能只评最终答案。

要评：

- 路由是否正确。
- handoff 是否正确。
- 子任务输出是否符合格式。
- 合并是否保留关键点。
- 审查是否发现真实问题。
- 是否出现上下文泄漏。

### 6. 安全和权限

不同 Agent 权限应该不同。

例如：

```text
Research Agent：只能读文档。
Coder Agent：可以写文件。
Reviewer Agent：只能读 diff。
Deploy Agent：需要人工审批后才能发布。
```

多 Agent 不是权限放大器。

它应该是权限隔离器。

## 设计检查清单

- [ ] 是否确认单 Agent + 工具不够。
- [ ] 是否明确每个 Agent 的输入、输出和权限。
- [ ] 是否限制每个 Agent 能看到的上下文。
- [ ] 是否有状态存储和版本记录。
- [ ] 是否有 trace 能看清每次 handoff 和工具调用。
- [ ] 是否有最大轮数，避免循环协作。
- [ ] 是否有冲突检测和合并规则。
- [ ] 是否评估路由、子任务、合并和最终结果。
- [ ] 是否记录成本、延迟和失败率。
- [ ] 是否为高风险工具加人工审批。

## 参考

- [OpenAI Agents SDK Handoffs](https://openai.github.io/openai-agents-python/handoffs/)
- [Microsoft Agent Framework Orchestrations](https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/)
- [CrewAI Introduction](https://docs.crewai.com/introduction)
- [A2A 协议](/notes/agents/a2a-protocol)
- [Human-in-the-loop](/notes/agents/human-in-the-loop)
