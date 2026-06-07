---
title: Harness Engineering
sidebarTitle: Harness Engineering
---

# Harness Engineering

Harness Engineering 可以翻成“Agent 运行支架工程”。

它关注的不是模型本身，而是模型外面的系统：

```text
上下文
工具
权限
运行时
反馈
评测
审计
回滚
```

一句话：

```text
Prompt Engineering 关注怎么问。
Context Engineering 关注给什么上下文。
Harness Engineering 关注整个 Agent 怎么被约束、执行、验证和改进。
```

OpenAI 的 Harness Engineering 文章里强调过一个关键点：当 Agent 做不成事时，问题往往不是“模型不够努力”，而是缺少可读、可执行、可验证的环境和能力。

## Harness 是什么

Harness 不是一个单独工具。

它是一层包住 Agent 的工程系统：

```text
User / Task
  -> Specification
  -> Context Pipeline
  -> Agent Runtime
  -> Tool Layer
  -> Middleware / Guardrails
  -> Execution Environment
  -> Evaluation / Sensors
  -> Trace / Audit
  -> Feedback / Harness Update
```

它让 Agent：

- 知道任务边界。
- 能拿到必要上下文。
- 只能调用允许的工具。
- 在受控环境执行。
- 出错时能被检测。
- 完成后能被验证。
- 失败经验能回流为规则。

## 五个核心模块

业界对 Harness 模块没有唯一标准。

这里按工程落地拆成五块：

```text
1. Context：上下文供给
2. Control：控制与约束
3. Tools：工具与能力
4. Runtime：执行与恢复
5. Evaluation：评测与反馈
```

## 1. Context：上下文供给

负责让 Agent 看到“该看的东西”。

包含：

- AGENTS.md / 项目规则。
- Spec / PRD / 任务计划。
- 代码结构。
- 相关文件。
- RAG 检索结果。
- 历史决策。
- 当前 git diff。
- 测试和构建结果。

关键不是越多越好。

关键是：

```text
相关
最新
可信
可追溯
不过量
```

常见机制：

- Context Builder。
- RAG 检索。
- 三级压缩。
- metadata 过滤。
- source tagging。
- context firewall。

失败表现：

- Agent 改错模块。
- 忽略项目规则。
- 使用旧接口。
- 把临时猜测当事实。
- 上下文过长后开始跑偏。

## 2. Control：控制与约束

负责定义 Agent 能做什么、不能做什么。

包含：

- 系统指令。
- 规范驱动开发。
- 权限策略。
- 工具白名单。
- 最大轮数。
- 风险分级。
- 人工审批。
- 预算限制。
- 安全策略。

Control 不是只写 prompt。

真正可靠的约束要能机械执行：

```text
禁止工具直接不暴露。
高风险工具执行前审批。
最大调用次数由程序计数。
危险命令由 sandbox 拦截。
规范违反由测试或 lint 检出。
```

失败表现：

- Agent 扩需求。
- Agent 调了不该调的工具。
- Agent 无限重试。
- Agent 修改无关文件。
- Agent 绕过验证。

## 3. Tools：工具与能力

负责让 Agent 能行动。

包含：

- 文件读写。
- shell。
- 搜索。
- 浏览器。
- 数据库。
- MCP Server。
- GitHub / Slack / Jira。
- 测试工具。
- 构建工具。
- 子 Agent。

工具层要设计：

- 工具名。
- 工具描述。
- 输入 schema。
- 输出协议。
- 错误结构。
- 超时。
- 重试。
- 幂等。
- 权限。
- 审计。

工具越多不一定越好。

好的 harness 会动态暴露工具：

```text
当前任务需要什么，就暴露什么。
当前 Agent 有什么权限，就给什么工具。
```

失败表现：

- 模型选错工具。
- 工具参数错。
- 工具输出太长。
- 工具失败后模型不会修正。
- 高风险工具没有审批。

## 4. Runtime：执行与恢复

负责让 Agent 在可控环境中运行。

包含：

- workspace / worktree。
- sandbox。
- 依赖安装。
- 环境变量。
- 超时控制。
- 取消任务。
- checkpoint。
- retry。
- rollback。
- 并发控制。
- 任务队列。

Runtime 要回答：

```text
Agent 在哪里运行？
能访问哪些文件？
能访问网络吗？
命令超时怎么办？
执行失败怎么恢复？
改坏了怎么回滚？
长任务怎么保存进度？
```

失败表现：

- 环境不一致。
- Agent 修改了错误目录。
- 测试跑不起来。
- 任务失败后状态丢失。
- 无法复现 Agent 做过什么。

## 5. Evaluation：评测与反馈

负责判断 Agent 做得对不对，并把失败经验变成 harness 改进。

包含：

- 单元测试。
- 构建。
- lint。
- 类型检查。
- 端到端测试。
- RAG 评测。
- Agent trace。
- 人工审核。
- 失败归因。
- 回归测试。

Evaluation 不是最后才跑。

它应该贯穿整个循环：

```text
before：任务开始前检查上下文和规范
during：工具调用、预算、风险和中间结果监控
after：测试、构建、评测和审查
feedback：把失败写回规则、测试或工具
```

失败表现：

- Agent 说完成但构建失败。
- 没有测试证明。
- 同样错误反复发生。
- 失败原因没有沉淀。
- 线上问题没有回流到评测集。

## Harness 和 SDD 的关系

SDD 是 Harness 的 Control + Context 部分。

```text
SDD 提供：
  spec
  plan
  tasks
  acceptance criteria

Harness 负责：
  让 Agent 按 spec 运行
  给工具和上下文
  做权限控制
  执行验证
  记录 trace
  失败后改进系统
```

SDD 是“做什么和怎么验收”。

Harness 是“让 Agent 可靠执行这件事的整个系统”。

## Harness 和 Middleware 的关系

Middleware 是 Harness 的一部分。

它通常处在 Control / Runtime 层：

```text
before_model：控制上下文
wrap_model_call：控制模型调用
wrap_tool_call：控制工具执行
after_model：检查模型输出
after_agent：记录和清理
```

Middleware 是实现 harness 规则的常用手段。

## Harness 设计示例

一个文档写作 Agent 的 harness：

```text
Context：
  - 读取 docs 目录结构
  - 检索相关旧笔记
  - 读取官方资料

Control：
  - 禁止空话
  - 必须写工程实现
  - 必须接入 VitePress 侧边栏

Tools：
  - rg
  - apply_patch
  - web search
  - pnpm docs:build

Runtime：
  - 在当前 git workspace 执行
  - 不自动提交
  - 构建超时 120s

Evaluation：
  - 扫占位符 / 旧引用
  - git diff --check
  - pnpm run docs:build
```

这就是一个小型 harness。

## Harness 改进循环

Harness Engineering 的重点是：

```text
Agent 犯一次错，就把错误变成系统改进。
```

例子：

| 错误 | Harness 改进 |
| --- | --- |
| 经常忘记跑构建 | completion 前强制 build gate |
| 经常误删文件 | 写操作前检查 path scope |
| 经常写空话 | 文档 lint 增加禁用词扫描 |
| 经常工具无限循环 | 增加 max tool rounds 和 loop detector |
| 经常引用过期资料 | RAG metadata 加版本和更新时间 |

不是每次都骂模型。

要问：

```text
这次失败是哪个 harness 模块没设计好？
```

## 去空话检查

- [ ] 是否把 Harness 理解成模型外部系统，而不是一个 prompt。
- [ ] 是否能说出 Context、Control、Tools、Runtime、Evaluation 五块。
- [ ] 是否知道 SDD 只是 Harness 的一部分。
- [ ] 是否有工具权限、运行环境和验证门禁。
- [ ] 是否有 trace 和失败归因。
- [ ] 是否把重复失败沉淀成规则、测试或工具。

## 参考

- [OpenAI: Harness engineering](https://openai.com/index/harness-engineering)
- [Harness Engineering for AI Coding Agents](https://harn.app/)
- [LangChain Middleware](https://docs.langchain.com/oss/python/langchain/middleware)
- [SDD 规范驱动开发](/notes/agents/spec-driven-development)
- [ReAct Agent 与运行控制](/notes/agents/react-agent-runtime-control)
