---
title: Claude 源码解析 09：工具系统与运行时能力池
sidebarTitle: 09 工具系统
---

# Claude 源码解析 09：工具系统与运行时能力池

看 Claude Code 的源码时，最容易低估的一层就是 tools。

很多人一开始会把它理解成：

- 有几个文件工具
- 有个 shell 工具
- 再挂一点 MCP

但 `tools.ts` 真正暴露出来的不是“几个工具”，而是**一套运行时能力池**。

如果不用这个角度看，很容易把后面的 prompt、权限、swarm、cache 全看散。

## 先给结论

Claude Code 的 tools 层至少同时承担四个职责：

1. 给模型定义动作空间。
2. 给权限系统定义可控制的边界。
3. 给 prompt cache 定义稳定前缀。
4. 给多 agent / MCP / workflow 提供统一能力装配口。

所以它不是“模型会调用哪些函数”，而是“runtime 对外暴露了哪些系统调用”。

## `getAllBaseTools()` 是内建工具总表

`tools.ts` 里最重要的函数之一就是：

- `getAllBaseTools()`

源码注释直接写了：

- 这是当前环境下所有可能可用工具的完整真相源
- 还必须和某个 statsig 动态配置保持同步，以便跨用户缓存 system prompt

这已经说明一个事实：

**工具列表不仅影响功能，还影响 system prompt 缓存。**

### 从源码能看到的 built-in tools

按目录和注册表看，至少能确认这些：

#### 文件与搜索

- `FileReadTool`
- `FileEditTool`
- `FileWriteTool`
- `NotebookEditTool`
- `GlobTool`
- `GrepTool`
- `LSPTool`

#### 执行

- `BashTool`
- `PowerShellTool`
- `REPLTool`
- `SleepTool`

#### 网络与远端

- `WebFetchTool`
- `WebSearchTool`
- `RemoteTriggerTool`

#### 任务与协作

- `AgentTool`
- `SendMessageTool`
- `TaskCreateTool`
- `TaskGetTool`
- `TaskListTool`
- `TaskUpdateTool`
- `TaskStopTool`
- `TaskOutputTool`
- `TodoWriteTool`
- `TeamCreateTool`
- `TeamDeleteTool`

#### 模式与工作区

- `EnterPlanModeTool`
- `ExitPlanModeTool`
- `EnterWorktreeTool`
- `ExitWorktreeTool`
- `ConfigTool`

#### 生态与扩展

- `SkillTool`
- `ToolSearchTool`
- `ListMcpResourcesTool`
- `ReadMcpResourceTool`
- `MCPTool`
- `McpAuthTool`

#### 其他 feature-gated 能力

- `WorkflowTool`
- `BriefTool`
- `ScheduleCron` 相关工具

这一层已经能说明问题了：Claude Code 并不是“几个 coding 工具”的组合，而是把搜索、读写、执行、协作、扩展、计划、工作区都纳入同一套工具语义。

## `ToolSelector` 里暴露了它对工具的心智模型

`components/agents/ToolSelector.tsx` 里，Claude Code 自己给工具做了分桶：

- `READ_ONLY`
- `EDIT`
- `EXECUTION`
- `MCP`
- `OTHER`

这很有意思，因为它不是按“文件/网络/浏览器”这种技术分类，而是按**风险与动作类型**分类。

比如 `READ_ONLY` 里放的有：

- `Glob`
- `Grep`
- `FileRead`
- `WebFetch`
- `WebSearch`
- `TodoWrite`
- `TaskOutput`
- MCP 资源读取工具

而 `EDIT` 和 `EXECUTION` 明显是权限风险更高的两类。

这说明 Claude Code 在产品层面看工具时，核心轴不是“工具属于哪个模块”，而是：

- 它会不会改东西
- 它会不会执行东西
- 它会不会跨越系统边界

## `assembleToolPool()` 才是真正的运行时合池

第二个关键函数是：

- `assembleToolPool(permissionContext, mcpTools)`

源码注释已经把职责写死了：

1. 先通过 `getTools()` 拿 built-in tools
2. 再按 deny rules 过滤 MCP tools
3. 最后按 tool name 去重，built-in 优先

也就是说，工具池不是静态数组，而是按当前运行时状态动态装出来的。

### `getTools()` 已经先做了一层 mode 过滤

它不是直接返回 `getAllBaseTools()`。

里面至少做了这些事：

- `CLAUDE_CODE_SIMPLE` 下只保留极简工具集
- REPL 模式下隐藏 primitive tools，让它们只在 VM 里可用
- 根据 deny rules 先把被 blanket deny 的工具从“可见工具池”里移除
- 最后再跑每个工具自己的 `isEnabled()`

这点非常关键：

**Claude Code 不只是“调用工具时再拒绝”，而是会在 prompt 形成前就先决定模型能不能看见这个工具。**

这会直接影响模型的行为分布。

## 为什么 built-in 和 MCP 要分区排序

`assembleToolPool()` 里有一段特别值钱的注释：

- built-in tools 要保持连续前缀
- 因为服务端有一条 system cache policy，会在最后一个 prefix-matched built-in tool 后面打全局 cache breakpoint
- 如果把 MCP tools 插进 built-in 中间，会导致后面的 cache key 全失稳

所以它最终不是把所有工具简单 `sort()`，而是：

1. built-in tools 各自按名字排序
2. MCP tools 各自按名字排序
3. built-in 整块在前
4. MCP 整块在后
5. `uniqBy(name)` 去重，built-in 胜出

这件事透露出一个很成熟的工程判断：

**工具清单本身是 prompt 前缀的一部分，而 prompt 前缀本身又是缓存对象。**

很多 agent 系统把 tool schema 当普通元数据，Claude Code 已经在为 tool ordering 做 cache optimization。

## 为什么说 tool system 其实就是“动作空间管理”

把上面的注册、过滤、排序放在一起看，就会发现 Claude Code 的 tools 层在做的不是简单函数暴露，而是：

- 哪些动作可做
- 哪些动作当前模式下可见
- 哪些动作当前权限下可见
- 哪些动作需要保留在 prompt cache 稳定前缀里
- 哪些动作只能在主线程 / in-process teammate / async agent 里用

这才是 agent runtime 真正需要管理的“动作空间”。

## async agent、coordinator、teammate 的工具边界也被编码了

`constants/tools.ts` 非常值得看，因为它把不同 agent 形态的工具边界明确定义出来了。

### `ALL_AGENT_DISALLOWED_TOOLS`

默认会挡掉一批工具，比如：

- `TaskOutput`
- `ExitPlanMode`
- `AskUserQuestion`
- `TaskStop`
- 某些 workflow 递归执行能力

这说明 subagent 不是主线程的完全复制体。

### `ASYNC_AGENT_ALLOWED_TOOLS`

异步 agent 被允许的主要是：

- 读
- 搜索
- web
- shell
- 编辑
- `SkillTool`
- `ToolSearch`
- worktree 切换

这其实已经很接近“执行型 worker”的画像了。

### `IN_PROCESS_TEAMMATE_ALLOWED_TOOLS`

in-process teammate 额外允许：

- `TaskCreate`
- `TaskGet`
- `TaskList`
- `TaskUpdate`
- `SendMessage`
- 某些 cron 工具

这说明“队友 agent”不是只有执行能力，还有任务协调能力。

### `COORDINATOR_MODE_ALLOWED_TOOLS`

协调者模式下则只保留极少数：

- `AgentTool`
- `TaskStopTool`
- `SendMessageTool`
- `SyntheticOutputTool`

这特别重要，因为它说明 coordinator 的职责被限制成：

- 派活
- 收结果
- 停任务
- 结构化输出

而不是自己下场做所有执行。

## `PowerShellTool` 能说明 tools 不是 schema，而是安全边界

如果只看工具名，你会觉得 `PowerShellTool` 只是 “Windows 版 BashTool”。  
但翻一下 `PowerShellTool.tsx`，会发现它其实自带一整套行为约束：

- `maxResultSizeChars = 30_000`
- `strict = true`
- `isConcurrencySafe()` 只对只读命令放行
- `isReadOnly()` 会先跑同步安全启发式
- `validateInput()` 会挡掉被禁止的 sleep / blocking 用法
- `checkPermissions()` 会走单独的 PowerShell 权限判定

再往旁边看还有：

- `modeValidation.ts`
- `pathValidation.ts`
- `powershellPermissions.ts`
- `readOnlyValidation.ts`

这说明 Claude Code 对一个“执行工具”的理解不是：

- 给模型一个 `command: string`

而是：

- 一个带输入校验
- 带安全分类
- 带权限判定
- 带路径规则
- 带并发语义
- 带结果压缩与后台化行为

的系统调用对象。

这也是为什么我会说，tools 在 Claude Code 里更像 syscall layer，而不是函数清单。

## 工具和 compact 是直接耦合的

这一点也很容易被漏掉。

`microCompact.ts` 里写死了 compactable tools 的集合，这意味着：

- 并不是所有工具结果都被等价对待
- 文件读取、shell、搜索、web、编辑类工具被视为上下文膨胀主因

同时 `compact.ts` 在 full compact 后还会重建：

- tools delta attachment
- agent listing delta attachment
- MCP instructions delta attachment

这说明 compact 之后，Claude Code 认为“当前可用工具集”本身也需要重新宣告。

换句话说：

**工具不是上下文外的东西，工具就是上下文的一部分。**

## MCP 为什么不是“外挂插件”，而是同一能力池的一支

`assembleToolPool()` 对 built-in 和 MCP 做的是：

- 同一 permission 过滤
- 同一去重逻辑
- 同一缓存稳定性排序体系

这说明从 runtime 视角看，MCP 不是另一套系统，而是：

- 进入同一 tool pool
- 参与同一 prompt 构造
- 受同一 deny rules 控制

也正因为这样，Claude Code 才可能往“平台化 agent runtime”走，而不是把插件永远挂在侧边当附属功能。

## 对我们自己做 agent 最该学什么

如果只摘最实用的经验，我会保留这六条：

1. 工具系统必须有真相源，不要到处散注册。
2. 工具可见性要在 prompt 前决定，不要只在调用时拒绝。
3. built-in 和外部工具最好分区排序，别把缓存稳定性搞没了。
4. agent、worker、coordinator 应该用不同工具白名单。
5. 执行工具一定要内建安全语义，而不是只暴露字符串命令。
6. compact 设计时要把工具结果当头号膨胀源看待。

如果没有这些，agent 很容易只剩下“模型会调几个函数”的表面样子。
