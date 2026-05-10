---
title: Claude 源码解析 08：上下文压缩机制
sidebarTitle: 08 上下文压缩机制
---

# Claude 源码解析 08：上下文压缩机制

如果说 `QueryEngine` 是 Claude Code 的心脏，那 `compact` 基本就是它的循环系统。

这套源码最值得学的地方，不是“它也会摘要历史”，而是它把上下文压缩拆成了多层机制，而且每一层解决的问题都不一样。

前面如果只说“上下文压缩是内建能力”，其实还不够。真正有用的是回答下面这几个问题：

- 到底有哪些压缩阶段
- 它们按什么顺序触发
- 阈值怎么算
- 压完之后上下文会变成什么
- 为什么它不是简单的 `/compact`

## 一条请求进主循环后，会先经历哪几层压缩

`query.ts` 里的顺序是：

1. `applyToolResultBudget`
2. `snipCompactIfNeeded`
3. `microcompact`
4. `contextCollapse.applyCollapsesIfNeeded`
5. `autocompact`
6. API 真正报溢出时再走 `reactive compact`

这个顺序本身就很有信息量。

它不是“一超了就做完整总结”，而是：

- 先控制巨大的工具结果
- 再裁长期历史
- 再清理历史工具结果
- 再尝试用 collapse 保住更细的上下文颗粒度
- 最后才做全量 compact summary

这是一套非常“runtime first”的设计。

## 第 0 层：为什么先做 `applyToolResultBudget`

这一步非常容易被忽略，但它其实是整条压缩链的第一层防线。

`query.ts` 里有两条关键信号：

- 它运行在 `microcompact` 之前
- 它专门约束 aggregate tool result size

这说明 Claude Code 先防的是一种非常现实的坏情况：

**不是整个会话太长，而是某个工具一次吐了太多东西。**

比如：

- `cat` 大文件
- `grep` 大范围结果
- shell 命令长日志
- 网页抓取正文

如果不先限制这些结果，后面的所有 compact 都会更被动。

## 第 1 层：`snip` 先裁长期历史，不碰当前轮核心内容

`snip` 的定位很清楚：它不是生成总结，而是删掉一部分长历史。

`query.ts` 里有一句很重要的注释：

- `snip` 放在 `microcompact` 前面
- 它专注于删除长期上下文
- `autocompact` 需要知道它释放了多少 token

因此 `snip` 的输出不只是 `messages`，还有：

- `tokensFreed`
- `boundaryMessage`

这个 `tokensFreed` 后面会进入自动压缩阈值判断，避免出现“明明 snip 已经省下 token，但统计层还按旧 usage 算”的假阳性。

## 第 2 层：`microcompact` 专门清工具结果，不做会话总结

`microCompact.ts` 最值得看的不是函数名，而是那组 `COMPACTABLE_TOOLS`：

- `FileRead`
- shell 工具
- `Grep`
- `Glob`
- `WebSearch`
- `WebFetch`
- `FileEdit`
- `FileWrite`

也就是说，它瞄准的是最容易爆 token 的那些“外部世界回流内容”。

这背后有个很强的判断：

**真正占上下文的，很多时候不是模型自己说的话，而是工具返回的大块内容。**

### `microcompact` 有两条路径

#### 1. cached microcompact

这条路默认优先。

特点是：

- 不改本地消息数组
- 用 `cache_edits` 在 API 层删除老 tool results
- 依赖 prompt cache 还热着
- 只在主线程启用，避免 forked agents 污染全局 cached MC 状态

它的核心思路是：

**既然旧前缀已经被缓存了，那就不要重写 prompt 内容，直接在 API 层告诉服务端“这些 tool_result 你当作删了”。**

这比本地直接篡改消息更省 cache。

#### 2. time-based microcompact

这条路是另一种假设：

- 如果距离上一次 assistant 消息已经很久
- 服务端 cache 大概率已经冷了

那 cached microcompact 的前提就不成立了。

这时源码会：

- 只保留最近 `N` 个 compactable tool results
- 其余旧 tool result 的 `content` 直接改成固定文案
- 并累计 `tokensSaved`

它的保底策略也很稳：

- `keepRecent = Math.max(1, config.keepRecent)`

哪怕配置给出 0，它也强制至少保留最后一个，不会把工作上下文全清空。

## 第 3 层：`context collapse` 是投影视图，不是整段重写

这部分最容易和 full compact 混在一起。

但 `query.ts` 的注释已经把差别说透了：

- collapse 在 autocompact 前执行
- 它的 summary 存在 collapse store，不在 REPL 主数组里
- 每次进入主循环时再 `projectView()`

这意味着 collapse 做的不是：

- “把旧会话物理改写成摘要”

而是：

- “在读取当前上下文时，投影出一份折叠过的视图”

这个设计很高级，因为它尽量保留了历史颗粒度和可恢复性。

可以把它理解成：

- full compact 更像 checkpoint
- collapse 更像 read-time materialized view

## 第 4 层：`autocompact` 才是完整摘要重写

`autocompact` 的逻辑集中在 `autoCompact.ts` 和 `compact.ts`。

它的真正问题不是“要不要压缩”，而是“什么时候该触发 full compact”。

### 有效窗口先扣输出保留

源码公式可以直接还原成：

```ts
effectiveContextWindow =
  min(modelContextWindow, envOverride?)
  - min(maxOutputTokensForModel(model), 20_000)
```

这里 `20_000` 不是随手写的常数，而是给 compact summary 输出预留的空间。

### 自动 compact 阈值

```ts
autoCompactThreshold = effectiveContextWindow - 13_000
```

其中：

- `AUTOCOMPACT_BUFFER_TOKENS = 13_000`
- `WARNING_THRESHOLD_BUFFER_TOKENS = 20_000`
- `ERROR_THRESHOLD_BUFFER_TOKENS = 20_000`
- `MANUAL_COMPACT_BUFFER_TOKENS = 3_000`

可以粗暴理解成：

- 20k 左右开始告警
- 再往上就进入 auto compact 区间
- 如果用户关了 auto compact，则还要再留 3k 给手动 `/compact`

### 真正比较的 token 数不是纯 usage

`shouldAutoCompact()` 用的是：

```ts
tokenCountWithEstimation(messages) - snipTokensFreed
```

这里非常重要的点有两个：

1. `tokenCountWithEstimation` 会把最近一次真实 API usage 当锚点，再估算后续新增消息。
2. `snipTokensFreed` 会被单独扣掉，因为 surviving assistant 的 usage 仍然反映的是 pre-snip context。

这说明 Claude Code 非常清楚：  
**usage 是滞后的，估算是近似的，所以要把两者拼起来用。**

## 为什么 `context collapse` 会压制 `autocompact`

`shouldAutoCompact()` 里有一段很关键的注释，基本说明了设计意图：

- collapse 的 commit-start 大约在 90%
- blocking-spawn 在 95%
- autocompact 触发大约在有效窗口的 93%

这三个阈值靠得太近。

如果 collapse 已经开着，autocompact 还不让路，往往会发生：

- collapse 本来准备保留更细粒度的上下文
- autocompact 却先一步把上下文压成单一 summary

所以源码在这种情况下直接关闭 proactive autocompact，把 headroom 问题交给 collapse 管。

## full compact 之后消息会被重组成什么

`compact.ts` 的 `buildPostCompactMessages(result)` 是最关键的结构函数之一。

重组顺序固定为：

1. `boundaryMarker`
2. `summaryMessages`
3. `messagesToKeep`
4. `attachments`
5. `hookResults`

这说明 full compact 不是“仅仅生成一段 summary”，而是把后续第一轮继续执行所需的东西重新搭起来。

里面至少包括：

- compact boundary
- 用户可见的 compact summary
- 必须保留的后缀消息
- 文件附件
- async agent 附件
- plan mode 附件
- skill 附件
- tool delta 附件
- MCP 指令附件
- hooks 结果

所以 compact 其实更接近一次**运行时重建**。

## 为什么 compact 后还要算 `truePostCompactTokenCount`

`compact.ts` 里专门区分了两种数字：

- `postCompactTokenCount`
- `truePostCompactTokenCount`

前者本质上是 compact API 这次调用自己的 token 使用量。  
后者才是**压完以后，新上下文本身大约有多大**。

源码注释还特别提醒：

- 下一轮 `shouldAutoCompact` 看到的，不止是这份消息体积
- 还会再加上约 `20K-40K` 的 system prompt、tools、userContext

所以 `truePostCompactTokenCount < threshold` 并不绝对意味着下一轮一定安全。  
它只是更接近真实剩余空间的一个强信号。

## `reactive compact` 解决的是 API 已经溢出的场景

前面几层都是 proactive。

如果 API 流里真的出了：

- withheld prompt-too-long
- withheld media size error

那 `query.ts` 会在后半段转入 `reactive compact`。

这条线的设计重点是：

- 不要被前面的 synthetic preempt 抢跑
- 让真实 API 413 先触发 collapse recovery
- 如果 collapse 兜不住，再落到 reactive compact

所以 reactive compact 不是“另一个普通 compact 模式”，而是**真实溢出后的恢复路径**。

## `task_budget` 为什么也绑在 compact 上

这点很容易被忽略，但其实很高级。

full compact 成功后，QueryEngine 会用：

- `finalContextTokensFromLastResponse(messagesForQuery)`

去更新 `taskBudgetRemaining`。

这里取的不是总 billing token，也不是 cache-inclusive total，而是：

- 如果有 `usage.iterations`，取最后一轮的 `input + output`
- 没有 server-side tool loop 时，退回 top-level `input + output`

也就是说，它关心的是：

**compact 边界前，服务端实际感知到的最后上下文窗口有多大。**

这说明 Claude Code 的预算系统和 compact 不是两套松散逻辑，而是共享同一套上下文语义。

## 这套压缩系统最值得学什么

如果把 Claude Code 的 compact 机制总结成可复用的设计原则，我觉得有五条：

1. 不要只有一种 compact。
2. 先压工具结果，再压会话历史。
3. 估算和真实 usage 要混着用，别迷信任何一边。
4. full compact 不是摘要函数，而是运行时重建过程。
5. 压缩要和 cache、budget、tool state 一起设计。

这也是为什么我会说：  
Claude Code 的 compact 不是补丁，而是主循环的骨架之一。
