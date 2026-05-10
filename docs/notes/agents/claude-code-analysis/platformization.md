---
title: Claude 源码解析 06：插件、MCP、bridge 为什么说明它在做平台化
sidebarTitle: 06 平台化
---

# Claude 源码解析 06：插件、MCP、bridge 为什么说明它在做平台化

Claude Code 到这里最容易被低估的一点，是大家会把：

- MCP
- plugins
- bridge
- remote / daemon

看成四个分散 feature。

但从源码结构看，这四条线其实在做同一件事：

**把能力来源、运行入口、会话宿主逐步从“单体 CLI”里拆出来。**

这就是平台化的开始。

## `tools.ts` 已经先把能力来源统一成同一类对象

Claude Code 的平台化不是从 plugin 目录开始的，而是从工具池抽象开始的。

`assembleToolPool(permissionContext, mcpTools)` 做的事情很关键：

1. built-in tools 先过 `getTools()`
2. MCP tools 再过 deny rules
3. 最后 built-in 和 MCP 合并、排序、去重

这里最重要的不是“支持 MCP”，而是：

- MCP tool 在运行时和 built-in tool 属于同一类对象
- 进同一套 permission 过滤
- 进同一套 prompt 前缀
- 进同一套 cache 稳定性约束

这意味着 Claude Code 的能力层已经不是“内部工具 + 外挂插件”，而是统一的 capability pool。

## built-in 和 MCP 要分区排序，说明平台化已经压到缓存层了

`assembleToolPool()` 里有一段特别有代表性的注释：

- built-ins 必须保持连续前缀
- 否则 MCP tools 插进中间，会破坏 server 的 cache policy

也就是说，Claude Code 不是只在产品层统一工具，而是连：

- 工具顺序
- prompt cache 命中

都一起考虑了。

这就是平台化系统和拼接式系统的差别：

- 前者会关心统一抽象如何影响底层性能
- 后者通常只关心“功能能不能跑通”

## plugin 系统不是“多几个命令”，而是完整能力包加载器

`utils/plugins/` 目录本身就很能说明问题。能看到的模块包括：

- `pluginLoader`
- `dependencyResolver`
- `marketplaceManager`
- `pluginAutoupdate`
- `pluginBlocklist`
- `pluginPolicy`
- `loadPluginCommands`
- `loadPluginHooks`
- `loadPluginOutputStyles`
- `loadPluginAgents`
- `lspPluginIntegration`
- `mcpPluginIntegration`

这已经不是一个“顺手支持脚本”的系统，而是完整的 plugin substrate。

## `loadAllPlugins()` 说明它是多来源装载，不是单目录扫描

`pluginLoader.ts` 的主入口 `loadAllPlugins()` 注释写得很清楚，插件来源至少有三种：

1. session-only plugins，来自 `--plugin-dir`
2. marketplace plugins
3. built-in plugins

而且有非常明确的 precedence：

- session plugin 默认覆盖已安装插件
- 但 enterprise managed settings 可以反过来压过 `--plugin-dir`

这说明 Claude Code 的 plugin 系统已经不是“本地开发方便一下”，而是考虑了：

- 临时本地覆盖
- 官方 / 市场分发
- 企业策略托管

这就是标准的平台治理问题。

## plugin loader 甚至区分 fresh load 和 cache-only load

`pluginLoader.ts` 里还有一组很像平台基础设施的设计：

- `loadAllPlugins()`
- `loadAllPluginsCacheOnly()`

两者的区别不是小优化，而是明确区分：

- 什么时候允许 hit network / clone fresh source
- 什么时候 startup 只能走本地 cache，不能阻塞首轮交互

源码注释直接说明了使用场景：

- interactive startup 不要因为 git clone 卡住
- `/plugins`、refresh、显式安装路径才允许 fresh load

这说明它把 plugin system 当成正式运行时的一部分，而不是可有可无的辅助功能。

## 插件不只加载命令，还加载 hooks、agents、output styles

这点在 `commands.ts` 和 `utils/plugins/` 目录里都能看到。

### `commands.ts` 会把多种命令源拼在一起

`loadAllCommands(cwd)` 会并行加载：

- skills
- plugin commands
- workflow commands

最终拼成：

- bundled skills
- builtin plugin skills
- skill dir commands
- workflow commands
- plugin commands
- plugin skills
- built-in commands

这说明 plugin 已经进入命令系统主路径，不是边缘入口。

### hooks / agents / output styles 也都是单独 loader

目录里明确有：

- `loadPluginHooks.ts`
- `loadPluginAgents.ts`
- `loadPluginOutputStyles.ts`

这意味着 plugin 能扩的不是一个点，而是多条产品表面：

- 命令
- agent 定义
- hooks
- 输出风格

到这一步，plugin 就已经不是“装一个工具”，而是“装一个产品能力包”。

## bridge 真正拆出来的是“会话宿主”和“传输层”

`bridge/replBridge.ts` 是另一条非常强的平台化信号。

`BridgeCoreParams` 里可以看到，它显式把一堆原本 REPL 独占的东西参数化了：

- `dir`
- `machineName`
- `branch`
- `gitRepoUrl`
- `title`
- `baseUrl`
- `sessionIngressUrl`
- `workerType`
- `getAccessToken`
- `createSession`
- `archiveSession`
- `toSDKMessages`
- `onAuth401`
- `getPollIntervalConfig`
- `onSetPermissionMode`

这说明 bridge core 的目标已经不是“在 REPL 里多一条连接”，而是：

**把会话注册、环境标识、权限控制、消息映射、重连策略都从具体宿主里抽出来。**

## transport 层也被抽成独立接口了

`replBridge.ts` 还显式依赖：

- `HybridTransport`
- `createV1ReplTransport`
- `createV2ReplTransport`

这特别说明问题，因为如果只是“联网”，根本不需要把 transport 分层做成这样。

一旦出现这些抽象，通常意味着系统已经在准备：

- 不同协议版本
- 不同宿主接入方式
- transport swap
- reconnect / replay / sequence number 管理

这就是平台 runtime 才会关心的事情。

## bridge core 还在处理 control plane，不只是消息转发

`ReplBridgeHandle` 暴露的不只有写消息：

- `writeMessages`
- `writeSdkMessages`
- `sendControlRequest`
- `sendControlResponse`
- `sendControlCancelRequest`
- `sendResult`
- `teardown`

这说明 bridge 不只是“把消息从 A 发到 B”，它还承担：

- control request / response
- 中断
- 权限模式切换
- 结果回送

也就是说，会话控制面也被一起桥接了。

这比普通 remote logging 或 websocket chat 复杂得多。

## daemon / remote caller 的存在，说明同一个 runtime 可以挂多个宿主

`BridgeCoreParams` 注释里多次提到：

- REPL wrapper
- daemon caller
- Agent SDK
- remote session

这说明 Claude Code 的设计意图已经不是：

- “终端里跑一个 assistant”

而是：

- “同一套 session runtime 能被不同外壳复用”

一旦系统开始出现这种宿主分离，平台化就已经不是猜测，而是实际架构方向了。

## 这几条线为什么必须放在一起看

如果只单看其中任何一条，都会低估 Claude Code：

### 只看 MCP

你会觉得它只是“工具接得多”。

### 只看 plugin

你会觉得它只是“扩展能力包多”。

### 只看 bridge

你会觉得它只是“支持远程 / daemon”。

但三条线放到一起看，结构就非常清楚了：

1. `tools + MCP` 统一的是能力来源。
2. `plugins` 统一的是产品扩展面。
3. `bridge + daemon + transport` 统一的是运行入口和宿主。

这三者合在一起，才叫平台化。

## 为什么它能往平台走，不是因为功能多，而是因为底座早就统一了

Claude Code 能往平台方向长，有个前提条件前面几篇已经看到了：

- `QueryEngine` 是统一执行主循环
- `fetchSystemPromptParts` 是统一前缀构造器
- `assembleToolPool` 是统一能力池
- permission modes / classifier / sync 是统一控制面
- `runAgent` 是统一子会话构造器

如果这些没统一，plugin、MCP、bridge 再多也只是拼盘。

所以 Claude Code 平台化真正厉害的地方不是“功能已经很多”，而是：

**这些功能已经能挂在同一套 runtime contract 上。**

这才是最难复制的部分。
