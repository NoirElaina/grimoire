---
title: Agent 设计
sidebarTitle: Agent 设计
---

# Agent 设计

Agent 设计最容易犯的错，是一上来就写 prompt，而不是先设计 runtime 里的角色边界。

如果一个 Agent 没有明确的职责、输入、输出和权限，它后面无论接：

- System Prompt
- 工具
- 记忆
- MCP
- SSE

都会慢慢失控。  
所以这篇不讲“抽象人格”，而是直接讲：**一个可落地的 Agent，在工程里应该怎么设计。**

## 先说结论

一个能长期维护的 Agent，通常至少要先定清这 6 件事：

1. 它解决什么任务，不解决什么任务。
2. 它拿到哪些输入，哪些输入必须靠工具补。
3. 它最终输出什么结构，而不是“随便回一段话”。
4. 它能调用哪些工具，哪些工具需要门控。
5. 它在 runtime 里是单角色，还是编排器。
6. 它失败时怎么停、怎么问、怎么回退。

一句话就是：

**Agent 不是一个 prompt 文件，而是一个带边界的工作单元。**

## 第一步：先定义这个 Agent 的“核心承诺”

我更推荐先写一行最短定义：

```text
这个 Agent 负责 ______ ，不负责 ______ 。
```

例如：

- 代码评审 Agent：负责识别风险、回归、测试缺口，不负责直接改代码。
- Coding Agent：负责在给定范围内改代码并验证结果，不负责擅自扩需求。
- 检索 Agent：负责查资料、比对来源、总结结论，不负责替用户做业务拍板。

这个定义非常重要，因为它会直接决定：

- System Prompt 怎么写
- 工具给到什么级别
- 前端怎么展示它的行为
- 评测标准怎么定

## 第二步：不要只定义“会做什么”，还要定义“不会做什么”

这一步非常工程化，因为后面很多事故都来自“它以为自己可以做”。

比较常见的“不负责”包括：

- 不做未经确认的高风险写操作
- 不在上下文不足时给确定性结论
- 不替用户决定高代价架构选择
- 不对未读取过的文件做具体断言
- 不在越权场景下调用生产工具

如果这部分没写，后面的 guardrail 基本只能靠临时补丁救火。

## 第三步：把输入边界写成 runtime 真会收到的东西

Agent 输入不是一句“用户问题”，而是一组运行时上下文。

更稳的设计通常会把输入拆成 4 层：

### 1. 用户显式输入

例如：

- 当前问题
- 上传附件
- 选中的文本
- 指定路径

### 2. 宿主注入上下文

例如：

- 当前工作目录
- 打开的文件
- 会话历史
- 团队约定
- 当前权限模式

### 3. 工具可补充上下文

例如：

- 文件内容
- Git diff
- Web 搜索结果
- 数据库查询结果

### 4. Agent 内部状态

例如：

- 当前第几轮 loop
- 已调过哪些工具
- 是否已经被用户拒绝过一次高风险操作

很多 Agent 之所以显得“笨”，不是模型不行，而是输入模型设计得像 demo。

## 第四步：输出一定要先协议化

工程上最怕的不是输出不好看，而是不可消费。

一个成熟 Agent 的输出最好先定义成结构，而不是靠 prompt 临场发挥。  
例如可以先定义统一结果：

```ts
type AgentResult =
  | {
      type: 'final'
      summary: string
      details?: string
      citations?: string[]
    }
  | {
      type: 'need_user_input'
      question: string
      reason: string
    }
  | {
      type: 'blocked'
      reason: string
      missing: string[]
    }
```

然后再决定最终渲染成：

- 页面文本
- CLI 输出
- API JSON

这会比“先让模型自由输出，再靠正则补救”稳很多。

## 单 Agent 和编排型 Agent 要分开设计

很多人会把所有能力都塞给一个 Agent，但工程上其实至少有两类。

### 单 Agent

适合：

- 代码评审
- 文档总结
- 简单查询
- 单步写作

特点是：

- 职责单一
- 工具集合可控
- loop 较短

### 编排型 Agent

适合：

- 多阶段研究
- planner -> worker
- 多工具串联
- 多子任务汇总

特点是：

- 自己不一定产出最终业务结果
- 更像 runtime orchestration layer

如果你现在做的是 coding agent、research agent、multi-step agent，它通常已经更接近编排器了，不该再用“一个人格提示词”去理解。

## 一个更实际的工程拆法

如果要自己实现，我建议至少拆成这 4 层：

```text
agent/
├─ definition/
│  └─ coding-agent.ts
├─ runtime/
│  ├─ agent-runner.ts
│  ├─ tool-gate.ts
│  └─ context-builder.ts
├─ prompts/
│  └─ coding-agent-system.ts
└─ contracts/
   └─ agent-result.ts
```

也就是说：

- `definition`
  放角色定义
- `runtime`
  放 loop 和策略
- `prompts`
  放系统级规则文本
- `contracts`
  放结构化输入输出

不要把这些全塞进一个 `agent.ts` 文件里。

## 一个最小 Agent 定义长什么样

下面是一个很够用的定义层例子：

```ts
export type AgentDefinition = {
  id: string
  description: string
  responsibilities: string[]
  nonResponsibilities: string[]
  visibleTools: string[]
  maxTurns: number
  outputMode: 'final_answer' | 'json' | 'stream'
}

export const codingAgent: AgentDefinition = {
  id: 'coding-agent',
  description: 'Modify code inside the current workspace and verify changes.',
  responsibilities: [
    'read repository context',
    'edit code in allowed scope',
    'run verification commands',
    'explain key changes clearly'
  ],
  nonResponsibilities: [
    'changing unrelated files',
    'making product decisions without user confirmation',
    'running destructive commands without approval'
  ],
  visibleTools: ['read_file', 'search_code', 'edit_file', 'run_command'],
  maxTurns: 8,
  outputMode: 'stream'
}
```

这个定义的价值在于：

- prompt 可读
- runtime 可读
- UI 可读
- 评测也可读

## Runtime 不要直接拿 prompt 跑，要先 build context

一个比较稳的 `AgentRunner` 通常不会直接：

```ts
model.generate(userInput)
```

而是先 build 出完整上下文：

```ts
type AgentContext = {
  userInput: string
  workingDirectory?: string
  openFiles: string[]
  selectedText?: string
  permissions: {
    allowWrite: boolean
    allowShell: boolean
  }
}

function buildAgentContext(input: AgentContext) {
  return {
    userInput: input.userInput,
    runtimeFacts: [
      `cwd=${input.workingDirectory ?? ''}`,
      `openFiles=${input.openFiles.join(',')}`,
      `allowWrite=${input.permissions.allowWrite}`,
      `allowShell=${input.permissions.allowShell}`
    ]
  }
}
```

也就是说，Agent 设计的真正骨架通常是：

- definition
- context builder
- prompt builder
- tool loop

而不是只有 prompt。

## 一个最小可用的 Runner 骨架

```ts
export class AgentRunner {
  constructor(
    private readonly model: ModelGateway,
    private readonly toolRegistry: ToolRegistry
  ) {}

  async run(definition: AgentDefinition, context: AgentContext): Promise<AgentResult> {
    const built = buildAgentContext(context)
    const tools = this.toolRegistry.pick(definition.visibleTools)
    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: buildSystemPrompt(definition, built) },
      { role: 'user', content: built.userInput }
    ]

    for (let turn = 0; turn < definition.maxTurns; turn += 1) {
      const result = await this.model.generate({
        messages,
        tools
      })

      if (result.type === 'final') {
        return {
          type: 'final',
          summary: result.text
        }
      }

      const tool = this.toolRegistry.get(result.toolName)
      const toolOutput = await tool.execute(result.arguments)

      messages.push({
        role: 'assistant',
        content: `Calling tool ${result.toolName}`
      })

      messages.push({
        role: 'tool',
        content: JSON.stringify(toolOutput)
      })
    }

    return {
      type: 'blocked',
      reason: 'agent exceeded max turns',
      missing: []
    }
  }
}
```

这才是一个“Agent 被做成系统部件”的最小形态。

## 权限边界最好在设计时就入模

不要等工具接上后才想安全问题。  
更稳的做法是在 Agent definition 里就把权限作为显式设计项。

例如：

```ts
type PermissionProfile = {
  readOnly: boolean
  requiresConfirmationForWrite: boolean
  allowsNetwork: boolean
}
```

这样你可以清楚区分：

- 研究型 Agent
- 写作型 Agent
- 执行型 Agent
- 高风险运维 Agent

## 真正的失败策略也要先写

一个可维护 Agent 一定要明确：

- 上下文不够时怎么办
- 工具报错时怎么办
- 多轮循环卡住时怎么办
- 用户拒绝高风险操作时怎么办

一个最简单的策略对象可以长这样：

```ts
type FailurePolicy = {
  askWhenUncertain: boolean
  maxToolErrors: number
  stopOnPermissionDenied: boolean
}
```

如果这层不存在，后面的行为几乎都会变成“提示词临场发挥”。

## 一种比较推荐的落地顺序

如果你接下来真的要做一个 Agent，我建议这样做：

1. 先写 `AgentDefinition`
2. 再写 `AgentResult` 合同
3. 再写 `ContextBuilder`
4. 再写 `System Prompt Builder`
5. 最后接工具 loop

顺序不要反过来。  
一上来先接工具、先写 prompt，最后通常会演变成“能跑，但说不清为什么这样跑”。

## 最后记一句话

**Agent 设计不是设计一句 prompt，而是先把这个角色做成 runtime 里可替换、可控、可观察的工作部件。**

后面的 `System Prompt`、`工具调用`、`SSE`、`MCP`，都应该建立在这个骨架上。
