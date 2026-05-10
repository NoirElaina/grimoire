---
title: Claude 源码解析 02：QueryEngine 主循环
sidebarTitle: 02 QueryEngine 主循环
---

# Claude 源码解析 02：QueryEngine 主循环

前面那篇把 `Claude Code` 看成一个成熟 agent 产品，这一篇就不再讲抽象层次了，而是直接看主循环到底怎么跑。

看完 `QueryEngine.ts` 和 `query.ts` 之后，一个更准确的结论是：

**`Claude Code` 的主循环不是“拼 prompt -> 调模型 -> 收答案”，而是“裁剪消息视图 -> 预算工具结果 -> 多阶段压缩 -> 调模型流 -> 执行工具 -> 回写结果 -> 继续下一轮”。**

这也是为什么前面如果只说“有 compact、有 tools”，其实没什么用。真正有价值的是它把这两件事都内建进了主循环。

## 先看一版接近源码的执行顺序

把 `query.ts` 里最重要的阶段抽掉实现细节，主循环大概是这样：

```ts
messagesForQuery = getMessagesAfterCompactBoundary(messages)
messagesForQuery = applyToolResultBudget(messagesForQuery)

if (HISTORY_SNIP) {
  messagesForQuery = snipCompactIfNeeded(messagesForQuery)
}

messagesForQuery = microcompact(messagesForQuery)
messagesForQuery = contextCollapse.applyCollapsesIfNeeded(messagesForQuery)

const { compactionResult } = autocompact(messagesForQuery)
if (compactionResult) {
  messagesForQuery = buildPostCompactMessages(compactionResult)
}

toolUseContext.messages = messagesForQuery

for await (const streamEvent of callModel(...)) {
  collectAssistantBlocks()
  collectToolUseBlocks()
  maybeStartStreamingToolExecutor()
}

if (toolUseBlocks.length > 0) {
  toolResults = runTools(toolUseBlocks)
  messages = messages + assistantMessages + toolResults
  continue
}

return finalAnswer
```

如果只记一句话，我会建议记这个：

**QueryEngine 真正维护的不是一次回答，而是一段持续运转的会话状态机。**

## 入口先裁消息，不是全量回放

主循环一上来先做的不是调模型，而是：

- `getMessagesAfterCompactBoundary(messages)`
- `applyToolResultBudget(...)`

这两个动作已经说明 Claude Code 不会无条件把整段历史原样丢给模型。

第一步是从最近一次 `compact boundary` 之后开始取当前有效视图。  
第二步是给工具结果施加单条消息预算，把过大的工具输出先做内容替换。

这里的设计非常关键，因为它把“上下文窗口控制”提前到了模型调用之前，而不是等 API 报错了再救火。

## compact 不是补丁，而是主循环固定阶段

`query.ts` 里压缩相关阶段的真实顺序非常明确：

1. `applyToolResultBudget`
2. `snipCompactIfNeeded`
3. `microcompact`
4. `contextCollapse.applyCollapsesIfNeeded`
5. `autocompact`
6. 如果 API 真报 `prompt too long`，再走 `reactive compact`

这里最值得注意的不是“它有很多 compact”，而是**每一种 compact 负责的范围不同**。

### 1. `applyToolResultBudget`

这是最前面的一层预算控制。它不是总结对话，而是限制单次工具结果的体积。

源码注释写得很直白：它运行在 `microcompact` 之前，而且两者可以组合，因为 cached microcompact 只看 `tool_use_id`，不看具体内容。

也就是说，Claude Code 先做的是“别让某个工具结果单独炸掉上下文”，再做“整段会话如何压缩”。

### 2. `snipCompactIfNeeded`

`snip` 的定位不是总结本轮，而是裁掉长期历史。

源码里还有一条很关键的注释：`snip` 要跑在 `microcompact` 前面，因为它删除的是长期上下文，而且 `autocompact` 需要知道 `snip` 究竟释放了多少 token。

所以 `snip` 的输出不是只有新消息，还包括：

- `messages`
- `tokensFreed`
- 可能的 `boundaryMessage`

这里的 `tokensFreed` 后面会直接进入自动压缩阈值计算。

### 3. `microcompact`

`microcompact` 不是“生成摘要”，而是**优先清工具结果**。

从 `microCompact.ts` 可以看出，它只处理一组明确列出来的工具：

- `FileRead`
- shell 工具
- `Grep`
- `Glob`
- `WebSearch`
- `WebFetch`
- `FileEdit`
- `FileWrite`

也就是说，它假设最容易占爆上下文的不是抽象推理文本，而是这些高体积工具输出。

它至少有两条路径：

- `cached microcompact`
- `time-based microcompact`

`cached microcompact` 的特点是：

- **不修改本地消息内容**
- 通过 `cache_edits` 在 API 层删除老 `tool_result`
- 依赖服务端 prompt cache 仍然是热的

`time-based microcompact` 的特点正相反：

- 直接改本地消息
- 把旧 `tool_result` 内容替换成固定占位文本
- 触发条件是距离上一次主线程 assistant 消息间隔太久，说明缓存已经冷掉

所以这里其实不是一种机制，而是两套不同假设下的压缩策略。

### 4. `context collapse`

`context collapse` 和 `autocompact` 不是一回事。

`query.ts` 里的注释已经把关系讲得很清楚：

- collapse 在 autocompact 之前跑
- 如果 collapse 已经把上下文压到阈值以下，autocompact 就不必再把整段会话压成单一 summary
- collapse 的 summary 不直接写回 REPL 主数组，而是存在自己的 collapse store 里

这意味着 collapse 的目标是：

**尽量保留颗粒度，只在读取视图时投影出压缩后的上下文。**

相比之下，autocompact 更像一次真正的会话重写。

### 5. `autocompact`

`autocompact` 才是那种大家直觉里的“把旧对话总结掉”。

而它也不是简单判断“token 大了没有”，而是用一套明确公式。

## 自动压缩阈值到底怎么算

`services/compact/autoCompact.ts` 里可以直接还原出它的核心公式。

### 第一步：先算有效上下文窗口

```ts
effectiveContextWindow =
  min(modelContextWindow, CLAUDE_CODE_AUTO_COMPACT_WINDOW?)
  - min(getMaxOutputTokensForModel(model), 20_000)
```

几个意思：

- 它先拿模型本身的 context window
- 如果设了 `CLAUDE_CODE_AUTO_COMPACT_WINDOW`，还能再人为压小
- 然后预留最多 `20_000` token 给 compact summary 输出

也就是说，压缩阈值不是基于“模型总窗口”，而是基于**扣掉输出保留后的有效窗口**。

### 第二步：自动压缩阈值

```ts
autoCompactThreshold = effectiveContextWindow - 13_000
```

这里 `13_000` 是 `AUTOCOMPACT_BUFFER_TOKENS`。

另外还有两条相关 buffer：

- `WARNING_THRESHOLD_BUFFER_TOKENS = 20_000`
- `MANUAL_COMPACT_BUFFER_TOKENS = 3_000`

所以它大体上形成了三层线：

- 提前预警线
- 自动 compact 线
- 手动 compact 预留阻塞线

### 第三步：真正参与比较的 token 数

```ts
tokenCount = tokenCountWithEstimation(messages) - snipTokensFreed
```

这一步很重要。

因为 `tokenCountWithEstimation(messages)` 不是简单累加消息长度，而是：

- 先找到最近一次带真实 API usage 的 assistant 响应
- 如果这个响应被拆成多个 sibling message，还会往前回溯到同一个 `message.id` 的第一条
- 然后在真实 usage 基础上，再估算那之后新增消息的 token

换句话说，它不是纯估算，也不是纯 API usage，而是两者混合。

这套算法是为了避免并行 tool call 场景下漏算 interleaved 的 `tool_result`。

### 第四步：为什么 collapse 会压制 autocompact

源码里还有一段很关键的注释：

- collapse 的 commit-start 大约在 90%
- blocking-spawn 大约在 95%
- autocompact 的 effective 阈值大约落在 93% 左右

所以如果 collapse 开着，而 autocompact 也不让路，后者通常会抢先触发，把原本还能保留颗粒度的上下文直接总结成大摘要。

这就是为什么 `shouldAutoCompact()` 里会在 `context collapse` 启用时直接返回 `false`。

## full compact 后会话会被怎么重写

一旦 `autocompact` 成功，QueryEngine 不会“在原数组里打个标记就算了”，而是会重建消息视图。

`buildPostCompactMessages(result)` 的顺序是固定的：

1. `boundaryMarker`
2. `summaryMessages`
3. `messagesToKeep`
4. `attachments`
5. `hookResults`

这个顺序很关键，因为它决定了 compact 之后上下文里还保留什么。

另外，`compact.ts` 里还专门算了一个 `truePostCompactTokenCount`，它不是 compact API 调用本身的 token，而是**压缩后新上下文本身的大致体积**。

源码注释还提醒了一点：

> 下一轮 `shouldAutoCompact` 看到的会是这个结果，再加上大约 `20K-40K` 的 system prompt、tools、userContext。

这也是为什么 Claude Code 会记录：

- `preCompactTokenCount`
- `postCompactTokenCount`
- `truePostCompactTokenCount`
- `willRetriggerNextTurn`

它不是只想知道“这次 compact 成功了没有”，而是要知道“这次 compact 之后会不会马上又超”。

## `task_budget` 也内建在 compact 边界里

这是前面比较容易漏掉，但其实很工程化的一点。

`query.ts` 里在 compact 成功之后，会用：

- `finalContextTokensFromLastResponse(messagesForQuery)`

去扣减 `taskBudgetRemaining`。

这里扣的不是 billing spend，也不是 top-level total usage，而是**最后一次响应实际最终上下文窗口的大小**。

源码注释写得很明确：这和服务端 `task_budget.remaining` 的语义一致，所以 compact 过边界时必须把这个值正确 carry over。

这说明 Claude Code 在做的不是“UI 侧大概显示个预算”，而是和服务端 token 预算机制对齐。

## 工具不是附属功能，而是主循环的另一半

前面说完 compact，再看 tools 才比较完整。

Claude Code 的主循环里，工具不是“模型回答里可选的插件”，而是主循环继续下去的必要条件。

`query.ts` 里会明确维护：

- `assistantMessages`
- `toolUseBlocks`
- `toolResults`

而 streaming 过程中，`tool_use` block 一到，就可以尽早进入 `StreamingToolExecutor`。

这意味着它不是：

1. 等模型整段说完
2. 再扫一遍有没有工具
3. 最后统一执行

而是更像：

1. 流式接收 assistant block
2. 看到 `tool_use` 就登记
3. 能并发就提前执行
4. 工具结果回流后再继续下一轮

主循环真正的闭环因此变成了：

- `messagesForQuery`
- `callModel(streaming)`
- `toolResults`

## 工具池怎么装配，不是随手 `[]` 拼一下

`tools.ts` 已经把工具系统做成了一个正式装配层。

最核心的两个函数是：

- `getAllBaseTools()`
- `assembleToolPool(permissionContext, mcpTools)`

### `getAllBaseTools()` 是内建工具真相源

它返回的不是三五个工具，而是一整套运行时能力，包括：

- 文件与搜索：`FileRead`、`FileEdit`、`FileWrite`、`NotebookEdit`、`Glob`、`Grep`
- 执行：`Bash`、`PowerShell`
- 网络：`WebFetch`、`WebSearch`
- 协作与任务：`Agent`、`SendMessage`、`TaskCreate/Get/Update/List/Stop/Output`、`TodoWrite`
- 模式与工作区：`EnterPlanMode`、`ExitPlanMode`、`EnterWorktree`、`ExitWorktree`
- 生态入口：`SkillTool`、`ToolSearchTool`、`ListMcpResources`、`ReadMcpResource`

此外还有一堆 feature gate 控制的能力，比如：

- `SleepTool`
- `RemoteTriggerTool`
- `WorkflowTool`
- `REPLTool`
- `LSPTool`
- `TeamCreateTool / TeamDeleteTool`

也就是说，Claude Code 的 tool layer 不是“几个核心工具 + 若干插件”，而是一套带 feature flag 的运行时能力矩阵。

### `assembleToolPool()` 负责真正合池

这个函数做三件事：

1. 先拿 built-in tools
2. 再按 deny rules 过滤 MCP tools
3. 最后按名字排序并去重

这里最值得注意的是排序逻辑。

源码专门写了注释：**built-in tools 必须保持为连续前缀**，这样服务端的 system prompt cache policy 才能稳定命中。

如果把 built-in 和 MCP tools 平铺后全局排序，某个 MCP 工具一旦插进 built-in 中间，就会把后面整个缓存前缀打碎。

这已经不是“工具能不能用”的问题，而是“工具列表如何影响 prompt cache 命中率”的问题。

## 为啥说它是 runtime，而不是聊天壳

把前面这些拼起来，就更容易理解 Claude Code 的复杂度到底长在哪：

- 输入先过本地层，不是所有话都直通模型
- 消息先过 budget、snip、microcompact、collapse、autocompact
- token 阈值不是拍脑袋，而是有效窗口减 buffer
- 工具不是外挂，而是流式主循环的一半
- 工具池不是静态数组，而是 permission + MCP + cache aware 的装配结果

所以 `QueryEngine` 真正维护的是一套 runtime invariants：

- 当前有效上下文是什么
- 当前还能不能继续塞消息
- 哪些工具对当前模式可见
- 工具结果多大才需要先削
- compact 后还剩多少预算
- 接下来该继续调模型，还是先跑工具

如果不把这些都看见，就很容易把 Claude Code 误读成“一个 prompt 写得比较好的 IDE 助手”。

## 这一篇之后怎么继续看

如果你现在想继续往深处走，最值得接的不是再讲抽象结论，而是这两篇：

- `08：上下文压缩机制`
- `09：工具系统与运行时能力池`

因为 `QueryEngine` 的真正重量，基本就压在这两条线里。
