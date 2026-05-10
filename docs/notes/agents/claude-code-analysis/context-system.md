---
title: Claude 源码解析 03：上下文系统是怎么工作的
sidebarTitle: 03 上下文系统
---

# Claude 源码解析 03：上下文系统是怎么工作的

Claude Code 的上下文系统，真正值得看的不是“它有 system prompt、user context、system context”这三个词，而是这三块到底怎么生成、什么时候跳过、怎么缓存、怎么进入 API。

把 `context.ts`、`utils/queryContext.ts`、`query.ts` 连起来看，比较准确的结论是：

**Claude Code 的上下文不是一个大 prompt，而是一套分层前缀构造器。它先构建缓存友好的前缀，再把会话视图和工具结果接到后面。**

## 先看最关键的入口：`fetchSystemPromptParts()`

`utils/queryContext.ts` 已经把问题说透了：它是专门用来构建 API cache-key prefix 的。

它返回三块：

- `defaultSystemPrompt`
- `userContext`
- `systemContext`

而且是并行取的：

```ts
const [defaultSystemPrompt, userContext, systemContext] = await Promise.all([
  customSystemPrompt !== undefined ? [] : getSystemPrompt(...),
  getUserContext(),
  customSystemPrompt !== undefined ? {} : getSystemContext(),
])
```

这里最重要的不是并行，而是这两个条件分支：

1. 如果用户给了 `customSystemPrompt`，默认 system prompt 不再构建。
2. 同样在这种情况下，`systemContext` 也直接跳过。

为什么？

因为 `systemContext` 本来就是要 append 到默认 system prompt 上的。  
既然默认 prompt 整块被替换了，就没必要再往一个不存在的默认骨架上贴 git 状态和 cache breaker。

这说明 Claude Code 对上下文前缀的理解很严格：

- 前缀不是“有啥都塞进去”
- 而是先定义语义归属，再决定哪些块能一起缓存

## `systemContext` 其实很克制，不是什么环境全家桶

`context.ts` 里的 `getSystemContext()` 只负责两类东西：

- `gitStatus`
- `cacheBreaker`

而且这两样都不是无条件存在。

### 1. `gitStatus` 什么时候会被跳过

源码里直接写了两个条件：

- `CLAUDE_CODE_REMOTE` 开着时跳过
- `shouldIncludeGitInstructions()` 返回 false 时跳过

也就是说，Claude Code 很明确地认为 git 状态是一种**有成本的辅助环境信息**，不是每个入口、每个场景都必须带上。

### 2. `gitStatus` 里到底放了什么

`getGitStatus()` 不是只跑一条 `git status`。

它并行拿这几项：

- 当前分支 `getBranch()`
- 主分支 `getDefaultBranch()`
- `git status --short`
- 最近 5 条 commit
- `git config user.name`

最后拼成一段带边界说明的文本：

- 这是会话开始时的快照
- 当前分支
- 主分支
- git 用户名
- 当前工作树状态
- 最近提交

而且 `status` 超过 `2000` 个字符会被截断，并明确提示：

- 如果需要更多，请自己再运行 `git status`

这说明 Claude Code 不追求“把仓库状态尽可能塞满”，它追求的是：

- 首轮给一个足够有用的快照
- 但不要让这块上下文无限膨胀

### 3. `cacheBreaker` 不是业务上下文，而是缓存控制信号

`getSystemContext()` 还会在 feature gate 打开时注入：

```ts
cacheBreaker: `[CACHE_BREAKER: ${injection}]`
```

这个字段没什么业务意义，但工程意义很强：

- 它说明 prompt cache 不是“顺便有”
- 而是系统显式控制的对象
- 需要时可以强行打断缓存前缀

如果一个系统根本不在乎缓存命中，它不会专门留这种注入位。

## `userContext` 也不是一坨“用户资料”，而是两块稳定前缀

`getUserContext()` 返回的内容非常克制：

- `claudeMd`
- `currentDate`

### 1. `CLAUDE.md` 的启用条件比想象中更严格

它会先判断：

- `CLAUDE_CODE_DISABLE_CLAUDE_MDS` 是否开启
- 当前是否 `--bare`
- 如果是 `--bare`，是否还显式传了 `--add-dir`

源码注释写得很清楚：

- `--bare` 的含义是“跳过我没明确要的东西”
- 不是“连我显式加进来的目录也忽略掉”

这个细节很成熟，因为它说明 Claude Code 没把 `CLAUDE.md` 当神圣固定注入，而是把它当成一种可以关闭、可以局部恢复的项目记忆源。

### 2. `CLAUDE.md` 的真实加载路径

它会走：

- `getMemoryFiles()`
- `filterInjectedMemoryFiles(...)`
- `getClaudeMds(...)`

也就是说，这不是“读当前目录一个文件”那么简单，而是一套 memory 文件发现和过滤流程。

### 3. 为什么 `CLAUDE.md` 还会被缓存到 `bootstrap/state`

`getUserContext()` 在生成后会做一件额外的事：

- `setCachedClaudeMdContent(claudeMd || null)`

原因源码也写了：

- auto-mode classifier 需要这份内容
- 但它不能直接 import `claudemd.ts`
- 否则会打出 `yoloClassifier -> claudemd -> filesystem -> permissions -> yoloClassifier` 的循环依赖

这很重要，因为它说明 `CLAUDE.md` 不只是主 agent prompt 的一部分，还是权限分类器的一部分用户意图来源。

### 4. `currentDate` 为什么也进前缀

`currentDate` 看着不起眼，但源码这里是直接塞进缓存前缀的：

```ts
currentDate: `Today's date is ${getLocalISODate()}.`
```

而 `constants/common.ts` 旁边还有一条注释，解释为什么 date 也要 memoize：

- 避免一到午夜就把整个 cached prefix 打爆

这说明连“日期”这种简单字段，Claude Code 也在按缓存成本去设计。

## 这三块不是平行文本，而是不同注入位置

真正进入模型前，`query.ts` 做了两件事：

- `appendSystemContext(systemPrompt, systemContext)`
- `prependUserContext(messagesForQuery, userContext)`

这意味着：

- `systemContext` 是追加到 system 层的
- `userContext` 是前置到 message 层的

这不是实现细节，而是很明确的语义划分：

1. git 快照、cache breaker 更接近“系统环境”
2. `CLAUDE.md`、日期更接近“用户/项目意图”

如果这两类东西都混进同一段 prompt，后面做 cache 和调试都会更糊。

## `customSystemPrompt` 会改变整套拼装逻辑

在 `QueryEngine.ts` 里，真正的 system prompt 组装顺序是：

1. `customPrompt` 或 `defaultSystemPrompt`
2. `memoryMechanicsPrompt`（有条件）
3. `appendSystemPrompt`

也就是：

```ts
const systemPrompt = asSystemPrompt([
  ...(customPrompt !== undefined ? [customPrompt] : defaultSystemPrompt),
  ...(memoryMechanicsPrompt ? [memoryMechanicsPrompt] : []),
  ...(appendSystemPrompt ? [appendSystemPrompt] : []),
])
```

这说明 Claude Code 不是只有一个“自定义 system prompt”开关，而是把 system 层拆成了：

- 基础骨架
- 记忆机制补丁
- 用户附加补丁

而且 `memoryMechanicsPrompt` 只有在这两个条件同时成立时才会注入：

- 调用方显式传了 `customSystemPrompt`
- `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE` 开着

也就是说，记忆机制提示不是所有人默认带的，而是专门给显式接入 memory 目录的调用方补的一层协议说明。

## coordinator mode 会继续往 `userContext` 里加东西

`QueryEngine.ts` 在拿到 `baseUserContext` 后，还会继续 merge：

- `getCoordinatorUserContext(...)`

里面至少能注入：

- worker tools 说明
- MCP server 说明
- scratchpad 目录说明

这说明 coordinator 模式并不是“换一套全新的 prompt 系统”，而是在原有的 `userContext` 层上继续叠加多 worker 语义。

这也是 Claude Code 架构比较稳的地方：

- 单 agent 和 coordinator 共享同一套前缀构造机制
- 只是某些模式会在 user context 上增加额外块

## subagent 还会主动裁剪上下文，而不是整包继承

`runAgent.ts` 里有两段特别值钱：

### 1. `Explore` / `Plan` 可去掉 `claudeMd`

源码注释写得很直接：

- 这类只读 agent 不需要吃主线程里的 commit / PR / lint 规则
- 主 agent 会解释它们的输出
- 去掉 `claudeMd` 能省大量 token

所以当 `agentDefinition.omitClaudeMd` 成立时，子 agent 真的会把 `claudeMd` 从 `userContext` 里裁掉。

### 2. `Explore` / `Plan` 也会去掉 `gitStatus`

理由也很直白：

- 这类 agent 是只读搜索 worker
- 父会话的 `gitStatus` 既大又是 stale snapshot
- 它们如果真要 git 信息，自己跑 `git status` 会更准

这说明 Claude Code 的上下文系统不是“父上下文复制到每个子 agent”，而是：

- 先继承
- 再按 agent 角色裁剪

这比很多多 agent 系统成熟得多。

## `compact boundary` 决定了“当前 API 视图”到底从哪开始

上下文系统还有一个经常被忽略的事实：

Claude Code 真正发给 API 的 message view，并不等于本地 transcript 全量历史。

`query.ts` 开头就先做：

- `getMessagesAfterCompactBoundary(messages)`

而 `/context` 相关命令也会说明：

- 还要经过 `projectView`
- 还要经过 `microcompact`

换句话说，Claude Code 维护的其实一直是两套视图：

1. 本地完整历史
2. 当前轮真正送进 API 的上下文视图

这也是为什么我更愿意把它叫“上下文系统”，而不是“prompt 拼接器”。

## 这一层真正解决的是什么问题

把这些细节放在一起，Claude Code 的上下文系统实际在解决四个非常具体的问题：

1. 哪些东西属于可缓存前缀，哪些不属于。
2. 哪些环境信息该放在 system 层，哪些该放在 user 层。
3. 哪些上下文对某类 subagent 是噪声，应该裁掉。
4. 本地会话历史和 API 实际上下文视图如何分离。

所以它的难点根本不在“写一条好 prompt”，而在于：

**怎样让每一轮 API 调用都拿到足够、稳定、可缓存、可裁剪的前缀。**

这才是 Claude Code 的上下文系统真正高级的地方。
