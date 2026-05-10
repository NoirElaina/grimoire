---
title: Claude 源码解析 07：Claude Code 到底是不是一个“操作系统式 Agent Runtime”
sidebarTitle: 07 Agent Runtime 总结
---

# Claude 源码解析 07：Claude Code 到底是不是一个“操作系统式 Agent Runtime”

写到这里，再继续只盯某个模块其实已经不够了。

因为把前面几篇真正连起来之后，Claude Code 暴露出来的不是几个好点子，而是一套很稳定的系统边界：

- `query.ts` 负责主循环
- `fetchSystemPromptParts()` 负责前缀构造
- `assembleToolPool()` 负责能力池
- permission mode / classifier / sync 负责控制面
- `runAgent()` 负责子会话
- `replBridge.ts` 负责会话宿主和 transport 抽象

所以这篇不再问“它有多少功能”，而是问：

**这些能力连在一起以后，它到底像不像一个操作系统式的 agent runtime？**

我的答案是：

**像，而且已经很像；但更准确地说，它现在像一个面向软件工程场景的 agent runtime 内核，而不是完全通用的 Agent OS。**

## 为什么我现在愿意用“runtime 内核”这个词

不是因为它有很多工具，而是因为它已经满足了 runtime 的几个硬条件。

### 1. 有统一执行循环

`query.ts` 不是简单的 API wrapper。

它在一轮执行里同时负责：

- 从 compact boundary 后裁当前视图
- 给 tool result 做预算
- 跑 `snip`
- 跑 `microcompact`
- 跑 `collapse`
- 按阈值做 `autocompact`
- 进入模型流
- 流式捕获 `tool_use`
- 回写 `tool_result`
- 必要时再继续下一轮

这已经不是“问一次模型”，而是很像 runtime event loop。

### 2. 有统一前缀与环境装配

`fetchSystemPromptParts()` 把 API cache-key prefix 固定拆成：

- `defaultSystemPrompt`
- `userContext`
- `systemContext`

再由 `query.ts` 决定：

- `systemContext` append 到 system 层
- `userContext` prepend 到 message 层

这和普通 agent 最大的区别在于：

- prompt 不再是随手拼一坨文本
- 而是 runtime 级的环境装配过程

### 3. 有统一能力池

`getAllBaseTools()`、`getTools()`、`assembleToolPool()` 把：

- built-in tools
- MCP tools
- mode 过滤
- deny rules
- prompt cache 稳定性排序

都统一到了一套 capability pool 里。

所以 Claude Code 不是“模型会调一些函数”，而是 runtime 对外暴露了一组动作空间。

### 4. 有统一控制面

权限系统不是 UI 细节，而是：

- `PermissionMode`
- 文件系统防绕过
- shell 规则语言
- auto-mode classifier
- worker-leader permission sync

统一起来的一套 control plane。

一个系统如果没有这层，功能再多也更像 demo；有了这层，才开始像可长期运行的 runtime。

### 5. 有子会话模型

`runAgent()` 说明子 agent 不是普通函数调用，而是：

- 独立 promptMessages
- 独立 toolUseContext
- 独立 user/system context 裁剪
- 独立 permission mode
- 独立 availableTools / allowedTools

这已经很像“进程 / 子进程”语义，而不是简单的递归调用。

## 为什么它开始有一点“操作系统味道”

如果把“操作系统味道”拆开，不要把它理解成字面 OS，而是理解成“统一调度和统一治理”，Claude Code 至少有四个很像 OS 的地方。

### 1. 它在调度的是资源，不只是文本

它一直在管理这些资源：

- 上下文窗口
- 工具结果体积
- tool pool 可见性
- worker 生命周期
- prompt cache 前缀
- task budget

这和 OS 管 CPU / 内存 / I/O 的味道很像，只不过它管理的是 agent runtime 里的高层资源。

### 2. 它在做权限域和模式切换

`default`、`plan`、`acceptEdits`、`bypassPermissions`、`auto`  
这些 mode 本质上就是不同执行域。

再加上：

- `allowedTools`
- session rules
- CLI arg rules
- worker permission sync

它已经在处理“进程能做什么、不能做什么、谁来批准”的问题了。

### 3. 它有消息总线和协议化内部事件

内部不是只有 user / assistant 文本。

系统里还有：

- `compact_boundary`
- `tool_use`
- `tool_result`
- `<task-notification>`
- permission request / response
- control request / response

这意味着 Claude Code 的内部世界已经不是聊天消息流，而是协议化 runtime 事件流。

### 4. 它开始区分“内核”和“宿主”

`replBridge.ts` 这条线非常说明问题。

当系统开始显式抽出：

- session ingress
- transport
- daemon caller
- REPL wrapper
- control plane callbacks

它就已经不再把自己绑定死在单一终端前端上了。

这正是平台内核和单体产品的分水岭。

## 但为什么我还不直接叫它“通用 Agent OS”

尽管它已经很像，我还是不想直接说“Claude Code 就是 Agent OS”，原因有三个。

### 1. 它的任务域还是强烈偏软件工程

整个工具池、权限系统、上下文设计，几乎都围绕：

- 文件
- git
- shell
- PR / review / tests
- worker coding flow

所以更准确的说法是：

- 它是 software engineering agent runtime
- 不是通用世界任务的 agent OS

### 2. 它的产品表面和内核还没有完全剥离

虽然 bridge / daemon 已经在抽离宿主，但现在很多地方仍然和：

- REPL
- terminal
- Claude Code 自家 CLI 体验

绑定得很深。

也就是说，它已经有内核形态，但还没完全脱离主产品壳。

### 3. 很多抽象仍然服务于 Anthropic 自家体系

从 feature flags、marketplace、某些 classifier 模板、某些 bridge 假设都能看出来：

- 这是一套非常强的自家 runtime
- 但不完全是中立、通用、可移植的“操作系统”

所以我更愿意把它叫：

**面向软件工程场景的 agent runtime 平台内核。**

## 如果把前面几篇压成一张图，Claude Code 的主梁其实很清楚

我现在会把它压成下面这五根主梁：

### 第一根：执行循环

- `QueryEngine`
- `query.ts`
- tool loop
- compact loop

负责的是“这一轮怎么活着跑完”。

### 第二根：上下文前缀

- `fetchSystemPromptParts()`
- `getUserContext()`
- `getSystemContext()`

负责的是“模型进入这一轮之前，世界长什么样”。

### 第三根：能力池

- `getAllBaseTools()`
- `getTools()`
- `assembleToolPool()`

负责的是“当前这轮到底能做哪些动作”。

### 第四根：控制面

- `PermissionMode`
- filesystem rules
- shell rules
- yolo classifier
- permission sync

负责的是“哪些动作虽然理论可做，但当前不该做”。

### 第五根：子会话与宿主

- `runAgent()`
- coordinator mode
- `replBridge.ts`

负责的是“这套 runtime 怎样分裂出更多执行体，以及怎样被不同宿主复用”。

一旦这五根主梁都立住，Claude Code 就已经超过了“强 assistant”的范围。

## Claude Code 真正的护城河，不是单点，而是这些主梁互相咬合

这也是我现在最想强调的一点。

Claude Code 真正难学的不是某个点子，而是这些点子已经互相对齐了：

- compact 和 token 统计是对齐的
- tool pool 和 prompt cache 是对齐的
- `CLAUDE.md` 和 auto-mode classifier 是对齐的
- worker tool scope 和 permission mode 是对齐的
- bridge control plane 和本地 permission mode 切换也是对齐的

这就是系统化。

很多团队能很快补出其中一两块，但真正难的是把这些块之间的 contract 设计好。

## 最后的判断

如果只让我留一句总判断，我会写：

**Claude Code 已经明显不是“带工具的聊天产品”，而是一套面向软件工程的 agent runtime 内核；它还不是完全通用的 Agent OS，但已经具备了非常强的 OS 式结构特征。**

这也是为什么“看到源码”不等于“拿到能力”。

真正难复制的不是某段 prompt、某个工具名、某个 worker XML，而是：

- 这些模块之间的边界
- 这些边界长期跑稳的方式
- 这些边界如何一起支撑产品继续长大

这才是 Claude Code 这份源码里最值钱的部分。
