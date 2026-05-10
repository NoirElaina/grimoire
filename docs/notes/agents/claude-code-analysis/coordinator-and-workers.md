---
title: Claude 源码解析 05：coordinator mode 和多 worker 编排
sidebarTitle: 05 多 worker 编排
---

# Claude 源码解析 05：coordinator mode 和多 worker 编排

Claude Code 的多 worker 系统，真正值得看的不是“它能开子 agent”，而是：

- coordinator 自己被重新定义成什么角色
- worker 到底拿到什么上下文和工具
- 结果如何协议化回流
- 什么时候继续旧 worker，什么时候新开

把 `coordinatorMode.ts`、`runAgent.ts`、`permissionSync.ts` 连起来看，结论会很明确：

**Claude Code 的 swarm 不是多开几个会话，而是在单 agent runtime 上再叠一层调度语义。**

## coordinator 不是“普通 agent + spawn 能力”，而是换了身份

`getCoordinatorSystemPrompt()` 第一段就把角色写死了：

- 你是 coordinator
- 帮用户达成目标
- 指挥 workers 去 research / implement / verify
- 你自己负责 synthesize 和对用户沟通
- 能直接回答时就别委派

这里最重要的是最后两条。

它说明 Claude Code 并不把多 worker 当成“默认更高级”的路线，而是把 coordinator 定义成：

- 只在真正需要 fan-out 时才调度
- 不把本来自己能做的事硬塞给 worker

这其实非常成熟，因为很多多 agent 系统一旦有了 delegation，就会过度使用 delegation。

## coordinator 自己会明确告诉用户“我刚刚发了什么任务”

system prompt 里还有一条很细但很重要的要求：

- launch 完 worker 后，briefly tell the user what you launched
- 然后就结束当前响应
- 不要预测 worker 结果

这说明 Claude Code 把 worker 生命周期当成正式的对话状态，而不是藏在后台的黑盒。

## worker 结果不是普通聊天消息，而是 `<task-notification>`

`coordinatorMode.ts` 里给 worker 回报定义了完整 XML 协议：

- `<task-id>`
- `<status>`
- `<summary>`
- `<result>`
- `<usage>`

而且 prompt 明确警告 coordinator：

- 这些消息看起来是 user-role
- 但它们不是用户
- 必须靠 `<task-notification>` 开头识别

这层设计非常关键，因为一旦多 worker 进入同一消息流，没有协议化结构，coordinator 很容易把：

- 用户追问
- worker 完成通知
- 系统事件

混成一堆文本。

Claude Code 的做法是直接把 worker 回报变成 runtime 事件消息。

## coordinator 的调度流程是显式分阶段的

system prompt 里不是笼统地写“让 worker 帮你干活”，而是给出了固定阶段：

- `Research`
- `Synthesis`
- `Implementation`
- `Verification`

对应职责也写死了：

- Research：workers 并行调研
- Synthesis：coordinator 自己读结果、理解问题、写实现规格
- Implementation：workers 去改
- Verification：workers 去验

这里最值钱的不是阶段名，而是：

**synthesis 明确不委派。**

也就是说，Claude Code 认为：

- 研究可以分布式
- 实现可以并发
- 验证可以独立
- 但“把研究结果整理成一条高质量实现规格”必须由 coordinator 自己做

这是多 agent 体系里最关键的认知中枢。

## 并行不是口号，而是带约束的调度策略

system prompt 里直接写了：

- Parallelism is your superpower.

但后面不是空喊，而是给了具体策略：

- 只读 research 可以自由并行
- 写密集 implementation，同一组文件一次只让一个 worker 改
- verification 有时可以和 implementation 在不同文件域并行

也就是说，Claude Code 已经不只是“支持并行”，而是在显式处理：

- 文件写冲突
- 上下文重叠
- 验证独立性

这才是真正像调度器的地方。

## `continue` 还是 `spawn fresh`，在 Claude Code 里是正式决策

`coordinatorMode.ts` 最成熟的一段之一，就是它没有硬规定“研究完一定继续原 worker”。

它给了一个上下文重叠驱动的决策表：

- 研究正好覆盖要改的文件：继续
- 研究太宽、实现很窄：新开
- 修失败后的修正：继续
- 验另一个 worker 刚写的代码：新开
- 第一次实现完全走错路：新开

这里的底层判断其实只有一句话：

**看旧 worker 的上下文现在是资产，还是噪声。**

这就是成熟多 agent 系统该有的判断，而不是默认把所有 follow-up 都发回原 worker。

## worker prompt 必须自包含，不能“把理解外包回去”

system prompt 里还专门把反模式写出来了：

- 不要说 `based on your findings`
- 不要说 `fix the bug we discussed`
- workers 看不到 coordinator 和用户之前的对话

它要求 coordinator 写 prompt 时必须给出：

- 具体文件路径
- 具体行号
- 具体错误信息
- 明确的 done 条件

这不是 prompt 小技巧，而是多 agent 系统的核心纪律：

**理解必须在 coordinator 端完成，不能再偷塞回 worker。**

## `runAgent()` 说明 worker 是独立子会话，不是轻量线程

`tools/AgentTool/runAgent.ts` 非常关键，因为它暴露了 worker 真正拿到的东西。

输入包括：

- `agentDefinition`
- `promptMessages`
- `toolUseContext`
- `forkContextMessages`
- `availableTools`
- `allowedTools`
- `querySource`
- 可选 `override.userContext/systemContext/systemPrompt`

这已经说明 worker 不是“共享父上下文的一小段 call stack”，而是一个完整的子会话构造过程。

### 1. worker 会先 fork 消息，但会过滤不完整工具调用

它不是直接 `contextMessages = forkContextMessages`，而是：

- 先 `filterIncompleteToolCalls(forkContextMessages)`

这说明 Claude Code 很清楚，父会话里如果正好有没闭合的 tool call，直接复制给子 agent 会打坏 API 请求。

### 2. worker 的 read file state 也会区分“继承”还是“新建”

- 如果有 `forkContextMessages`，会 clone 父级 `readFileState`
- 否则就新建一个带 size limit 的 file cache

这说明它连文件读取缓存都按“fork 还是 fresh”区分了。

### 3. 有些 worker 会主动删掉 `claudeMd`

`runAgent.ts` 里写得很直接：

- `Explore` / `Plan` 这类只读 agent 可以不带 `claudeMd`
- 因为 commit / PR / lint 规则对它们是噪声

而且这个优化是有 token 节省目的的，不只是为了简洁。

### 4. `Explore` / `Plan` 还会去掉 `gitStatus`

理由也很清楚：

- 父会话的 git status 是会话开始时快照，而且可能很大
- 这类 worker 真需要 git 信息，自己跑命令会更准

所以 worker 的上下文不是全继承，而是按角色裁剪。

## worker 的 permission mode 也能被单独覆盖

`runAgent.ts` 里会先看父会话当前 mode，再决定是否应用 `agentDefinition.permissionMode`。

但它还有两个保护：

- 如果父级已经是 `bypassPermissions`
- 或者 `acceptEdits`
- 或者 `auto`

就不让子 agent 随便把它改掉。

也就是说，worker 可以有自己的 mode，但不能胡乱推翻更强的父级会话语义。

这体现了很好的“子 agent 局部自由，父会话全局优先”原则。

## `allowedTools` 不是附加白名单，而是会覆盖父会话 session 规则

`runAgent.ts` 对 `allowedTools` 的处理也很讲究：

- 保留 SDK 传进来的 `cliArg` allow rules
- 但用 `allowedTools` 完整替换 session-level allow rules

这意味着：

- 父会话临时批准过的 session 规则不会自动泄漏给 worker
- worker 只拿到显式允许给它的那部分

这点很重要，因为如果 session allow rules 直接继承，多 worker 很容易越跑越宽。

## worker 的工具池也是单独装的

`runAgent.ts` 明确区分：

- `availableTools`
- `resolvedTools`

如果 `useExactTools` 打开，就直接用传进来的 `availableTools`。  
否则再经过 `resolveAgentTools(agentDefinition, availableTools, isAsync)` 做一次角色过滤。

这说明 worker 的 tool pool 不是天然等于父 agent 的 tool pool，而是：

- 调用方先预计算
- 运行时再按 agent 定义决定最终暴露哪些

这和前面权限系统、工具系统是紧密咬合的。

## scratchpad 说明它在给 worker 提供“共享知识面”

`getCoordinatorUserContext()` 里，如果 scratchpad gate 打开，会把目录路径注入给 coordinator：

- workers can read and write here without permission prompts
- use this for durable cross-worker knowledge

这说明 Claude Code 不满足于“coordinator 人肉转述 worker 结论”，而是开始提供一个持久化的 cross-worker 协作面。

这已经不是聊天链路，而是接近团队工作区的设计。

## 多 worker 权限请求会走 leader mailbox，不会各弹各的

这条线和上一章权限系统连在一起。

`permissionSync.ts` 已经把流程写死：

1. worker 写 `permission_request`
2. leader 读 pending 请求
3. leader UI 批准 / 拒绝
4. leader 回 `permission_response`
5. worker 恢复执行

也就是说，多 worker 不是“谁想弹权限框谁自己弹”，而是：

- 控制面回收到 leader
- 执行面留在 worker

这才是能规模化的多 agent 权限模型。

## 这一层真正升级了什么

把这些源码细节放在一起看，Claude Code 的 coordinator mode 真正升级的不是“多开几个 agent”，而是这四件事：

1. 主 agent 的角色从执行者变成调度者。
2. worker 结果从自然语言变成协议化通知。
3. 子 agent 拥有独立上下文裁剪、权限模式和工具池。
4. 权限、任务、上下文三条线都能跨 worker 协同。

所以我更愿意把它理解成：

**Claude Code 在单 agent runtime 上，长出了一套真正的任务编排层。**

这和普通“子任务工具”已经不是一个量级了。
