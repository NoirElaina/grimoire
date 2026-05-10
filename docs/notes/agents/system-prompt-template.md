---
title: System Prompt
sidebarTitle: System Prompt
---

# System Prompt

System Prompt 最大的问题通常不是“写得不够强”，而是**写得太混**。

很多项目会把下面这些全塞进去：

- 角色定义
- 当前任务步骤
- 工具参数说明
- 输出格式
- 某次事故后的补丁规则

最后 prompt 越来越长，但系统越来越不稳。  
所以这篇不讲抽象理念，而是直接讲：**System Prompt 在工程里怎么拆、怎么组装、怎么维护。**

## 先说结论

一个可维护的 System Prompt，通常应该满足这 4 个条件：

1. 只承载跨任务稳定成立的长期规则。
2. 运行时变化的内容不要直接写死在 prompt 文本里。
3. Prompt 最好由代码拼装，而不是只在一个 markdown 里手改。
4. 角色规则、工具原则、输出协议要分段，便于做 diff 和评审。

一句话就是：

**System Prompt 更像“长期规则模板”，不是“本轮任务说明书”。**

## 先把 3 层输入分开

我更推荐把提示体系硬拆成这三层：

### 1. System Prompt

放长期规则：

- 角色身份
- 优先级
- 边界
- 输出习惯
- 工具原则

### 2. Runtime / Developer Instructions

放当前环境事实：

- 当前工作目录
- 工具权限
- 项目约定
- 只读/可写模式

### 3. User Prompt

只放这次任务：

- 用户目标
- 当前输入
- 选中的内容

只要这三层没分开，调 Prompt 的过程就会越来越像打补丁。

## 一个稳定的 System Prompt 通常长什么样

比较推荐固定为 5 段：

1. 角色定义
2. 优先级
3. 边界和禁止项
4. 输出协议
5. 工具使用原则

## 1. 角色定义要写任务，不要写气质

错误写法通常是：

```text
你是一个专业、严谨、友好的 AI 助手。
```

这种句子几乎没有工程约束力。  
更稳的写法应该直接描述工作对象和成功标准：

```text
你是一个面向代码仓库工作的 coding agent。
你的目标是在用户指定范围内完成修改、验证结果，并清楚解释关键变更。
```

这才是真正能约束行为的内容。

## 2. 优先级一定要显式写出来

Prompt 稳不稳，很多时候取决于冲突时怎么取舍。

例如：

```text
优先级从高到低：
1. 避免高风险或越权操作
2. 保证结论和修改的正确性
3. 按用户要求完成任务
4. 保持输出简洁
```

如果这部分不写，模型遇到冲突时只能自己猜。

## 3. 边界和禁止项必须可执行

不要只写“注意安全”。  
要直接写成能落地判断的规则：

```text
- 不要对未读取过的文件做具体断言
- 未经确认不要执行高风险写操作
- 当缺少关键信息时，应先说明缺口再继续
- 不要编造外部来源或命令执行结果
```

这类规则才是真正能进 runtime 的。

## 4. 输出协议最好和前端/调用方契合

Prompt 不是作文要求，而是接口协议的一部分。

例如你可以明确：

```text
- 先给结论，再给关键依据
- 提到文件时给出具体路径
- 若未完成，明确说明阻塞原因
- 若做了工具调用，结论必须基于调用结果
```

如果前端要吃结构化结果，还可以直接要求模型输出 JSON：

```text
输出必须符合以下 JSON 结构：
{
  "summary": string,
  "actions": string[],
  "risks": string[]
}
```

## 5. 工具原则写策略，不写 schema

System Prompt 里最常见的过度设计，是把一大段工具参数说明也塞进去。

更稳的做法是只写工具使用原则：

```text
- 时间敏感或外部事实相关的问题应优先查证
- 有副作用的工具调用前应先确认必要性
- 工具失败时应说明失败类型，并决定是否重试或回退
```

具体 schema 让工具层自己提供。

## Prompt 最好不要手写死，应该让代码参与组装

真正上线后，System Prompt 很少是一整段完全固定文本。  
更常见的是：

- 固定主模板
- 再拼接当前 Agent 定义
- 再拼接权限模式

一个简单的写法可以是：

```ts
type PromptParts = {
  role: string
  priorities: string[]
  boundaries: string[]
  outputProtocol: string[]
  toolPolicy: string[]
}

export function buildSystemPrompt(parts: PromptParts): string {
  return [
    '# Role',
    parts.role,
    '',
    '# Priorities',
    ...parts.priorities.map((item, index) => `${index + 1}. ${item}`),
    '',
    '# Boundaries',
    ...parts.boundaries.map(item => `- ${item}`),
    '',
    '# Output Protocol',
    ...parts.outputProtocol.map(item => `- ${item}`),
    '',
    '# Tool Policy',
    ...parts.toolPolicy.map(item => `- ${item}`)
  ].join('\n')
}
```

这样做的好处很直接：

- 变更可 diff
- 不同 Agent 可复用结构
- 可以按权限模式切换部分内容

## 一个 Coding Agent 的实际 Prompt Builder

```ts
import type { AgentDefinition } from './agent-definition'

export function buildCodingAgentSystemPrompt(definition: AgentDefinition, runtime: {
  allowWrite: boolean
  allowShell: boolean
}) {
  return buildSystemPrompt({
    role: `You are ${definition.id}. Your job is to modify repository content only within the allowed task scope.`,
    priorities: [
      'avoid unsafe or unauthorized actions',
      'produce correct modifications and verifiable results',
      'follow user intent within the allowed scope'
    ],
    boundaries: [
      'do not claim you inspected files you did not read',
      runtime.allowWrite
        ? 'writing is allowed only for files relevant to the task'
        : 'do not modify files because current mode is read-only',
      runtime.allowShell
        ? 'shell commands are allowed only when they materially reduce uncertainty'
        : 'do not invoke shell commands in current mode'
    ],
    outputProtocol: [
      'start with the result',
      'mention touched files when relevant',
      'if blocked, state the exact blocker'
    ],
    toolPolicy: [
      'prefer reading context before making changes',
      'verify time-sensitive or external facts via tools',
      'treat tool outputs as evidence for the final answer'
    ]
  })
}
```

这个版本的价值在于：  
它把 prompt 从“文案”变成了“可维护配置”。

## Runtime 事实不要硬塞进 System Prompt 主模板

很多 prompt 发散的根源是：  
每次都把当前目录、当前文件、当前权限直接写进长期模板里。

更稳的方式是另起一段 runtime context：

```ts
export function buildRuntimeContext(input: {
  cwd: string
  openFiles: string[]
  selectedText?: string
}) {
  return [
    '# Runtime Context',
    `cwd: ${input.cwd}`,
    `openFiles: ${input.openFiles.join(', ') || '(none)'}`,
    input.selectedText ? `selectedText:\n${input.selectedText}` : ''
  ].filter(Boolean).join('\n')
}
```

然后在真正调模型时：

```ts
const messages = [
  { role: 'system', content: buildCodingAgentSystemPrompt(definition, runtimePolicy) },
  { role: 'system', content: buildRuntimeContext(runtimeFacts) },
  { role: 'user', content: userInput }
]
```

这种分法会比一大坨单文本稳定得多。

## 最常见的 4 个 Prompt 工程错误

### 1. 把短期任务写进 System Prompt

例如：

- “这次先看 `config.ts`”
- “本轮只改文档”

这些应该进 user/developer 层，不该进长期模板。

### 2. 把所有工具细节塞进去

Prompt 变长，但不会更稳，只会更吵。

### 3. 每次出问题就补一句规则

这会让 prompt 变成事故补丁堆。

### 4. 不做版本管理

Prompt 一旦是工程核心部件，就应该像代码一样：

- 可 diff
- 可 review
- 可回滚

## Prompt 最好配一层最小测试

如果你是自己做 Agent，哪怕不做完整评测，也建议至少写几条 smoke case。

例如：

```ts
const cases = [
  {
    name: 'should refuse write in read-only mode',
    runtime: { allowWrite: false, allowShell: false },
    user: 'Please edit README.md',
    expectedRule: 'do not modify files because current mode is read-only'
  }
]
```

哪怕这层只是人工 review，也比纯靠线上踩坑强很多。

## 一种比较推荐的落地顺序

1. 先写 AgentDefinition
2. 再写 PromptParts 结构
3. 再写 `buildSystemPrompt()`
4. 再写 `buildRuntimeContext()`
5. 最后接模型调用

这样后面换模型、换工具、换权限模式时，prompt 层才不会连着一起炸。

## 最后记一句话

**System Prompt 最好的状态，不是“足够长”，而是“长期规则足够稳定，运行时事实足够分层”。**

只要你把它当成 runtime contract，而不是提示词作文，后面会清楚很多。
