---
title: Claude 源码解析 04：权限系统为什么是 Claude Code 的核心护城河
sidebarTitle: 04 权限系统
---

# Claude 源码解析 04：权限系统为什么是 Claude Code 的核心护城河

Claude Code 的权限系统，真正强的地方不是“会弹确认框”，而是它把权限拆成了四层：

1. 模式层：当前会话处在什么执行模式。
2. 规则层：文件、命令、工具各自怎么匹配和收窄。
3. 分类层：auto mode 里哪些动作该被第二个模型挡住。
4. 协同层：多 worker 时权限怎么经 leader 同步。

如果少了其中任何一层，这套系统都很难长期跑稳。

## 权限先被做成“模式”，而不是零碎布尔值

`PermissionMode.ts` 里已经把会话模式显式列出来了：

- `default`
- `plan`
- `acceptEdits`
- `bypassPermissions`
- `dontAsk`
- `auto`（受 feature gate 控制）

而且每个模式不只是一个枚举值，还绑定了：

- `title`
- `shortTitle`
- `symbol`
- `color`
- `external` 映射

这说明 Claude Code 不是把权限当作底层标志位，而是把它当作：

- 会话级状态
- UI 级状态
- SDK 级状态

三者共享的一种运行模式。

也正因为如此，后面的工具池、弹框策略、classifier、worker 行为都能围绕 mode 来转。

## 权限拒绝不是副作用，而是主循环的正式输出

`QueryEngine.ts` 里在进入主循环前，会先包一层 `canUseTool`：

- 真正去调用权限判断
- 如果 `behavior !== 'allow'`
- 就把这次拒绝记录进 `permissionDenials`

记录的字段包括：

- `tool_name`
- `tool_use_id`
- `tool_input`

这件事很关键，因为它说明权限系统并不是“阻止一下就完了”，而是：

- 要把拒绝变成结构化结果
- 要让 SDK、UI、审计层都能看到这次阻塞

很多 agent 系统只有“拦住”，Claude Code 还有“可观测”。

## 文件系统权限做的不是路径匹配，而是防绕过

`utils/permissions/filesystem.ts` 里一上来就列出了高风险对象：

### 高风险文件

- `.gitconfig`
- `.gitmodules`
- `.bashrc`
- `.zshrc`
- `.mcp.json`
- `.claude.json`

### 高风险目录

- `.git`
- `.vscode`
- `.idea`
- `.claude`

这些并不是“业务文件”，而是：

- 能影响代码执行
- 能影响工具加载
- 能影响编辑器 / git / Claude 自身行为

这说明 Claude Code 的权限系统不只是关心“会不会改仓库代码”，还关心“会不会改运行环境本身”。

### 它先统一做大小写归一

源码专门写了：

```ts
export function normalizeCaseForComparison(path: string): string {
  return path.toLowerCase()
}
```

目的也写得很清楚：

- 防止在大小写不敏感文件系统上用混合大小写绕过检查

比如：

- `.cLauDe/Settings.locaL.json`

这种细节说明它不是随便做了个路径判断，而是认真在防 bypass。

### 它还专门为 `.claude/skills/{name}` 做了更窄的授权范围

`getClaudeSkillScope()` 会判断：

- 当前路径是否位于 `.claude/skills/{name}/`
- 如果是，返回只覆盖这个 skill 的 allow pattern

也就是：

- 不是让用户一次放开整个 `.claude/`
- 而是尽量收窄到“这个 skill 目录”

这是很成熟的授权设计，因为它不是只会“开/不开”，而是会主动生成更小的授权面。

## shell 规则不是字符串 contains，而是完整匹配语言

`shellRuleMatching.ts` 把 shell 权限规则抽成了三类：

- `exact`
- `prefix`
- `wildcard`

### 1. `prefix` 兼容老语法 `:*`

例如：

- `npm:*`
- `git:*`

源码会把这类规则解析成 prefix rule。

### 2. `wildcard` 支持真正的 `*`

而且不是粗糙的 glob 替换，它还处理了：

- `\*` 匹配字面量星号
- `\\` 匹配字面量反斜杠
- dotAll 模式，支持换行命令
- 大小写选项

### 3. 尾部 ` *` 有特殊语义

源码还有一条很值得注意的逻辑：

- 如果模式只包含一个尾部 wildcard，而且是 `git *` 这种形式
- 会把它改成“尾部空格和参数可选”

所以：

- `git *` 既能匹配 `git add`
- 也能匹配裸 `git`

这说明 Claude Code 的 shell 权限规则已经不是“临时 if-else”，而是一套认真维护的规则语言。

## auto mode 不是放权，而是引入第二个分类器

权限系统里最容易被误读的一块就是 `auto`。

很多人会把它理解成：

- 少弹框
- 更自动

但 `yoloClassifier.ts` 说明得很清楚，auto mode 的本质是：

**把一部分权限判断外包给一个单独的分类模型流程。**

### classifier 的 system prompt 不是常量，而是模板拼装

`buildYoloSystemPrompt(context)` 会做这些事：

1. 选择外部模板还是 Anthropic 内部模板。
2. 从 `settings.autoMode` 里拿：
   - `allow`
   - `soft_deny`
   - `environment`
3. 如果打开了对应 gate，还会追加：
   - bash prompt allow/deny 描述
   - PowerShell deny guidance
4. 最后替换模板里的三个 `<user_*_to_replace>` section

也就是说，classifier 自己也有一套 prompt 编排系统。

### classifier 读的不是整段 transcript，而是裁过的版本

`buildTranscriptForClassifier()` 只保留：

- user 文本
- assistant 的 `tool_use` block

assistant 的普通文本不会进入 classifier transcript。

这个设计很合理，因为权限判断真正关心的是：

- 用户提出了什么意图
- agent 想执行什么动作

而不是 assistant 中间说过多少分析话。

### `CLAUDE.md` 还会被喂给 classifier

`buildClaudeMdMessage()` 会从 `bootstrap/state` 的缓存里取 `CLAUDE.md` 内容，然后包成：

- 一个 user-role message
- 带 cache_control
- 明确告诉 classifier：这些是用户提供给 agent 的配置，应被视为用户意图的一部分

这说明 Claude Code 的权限判断不是脱离项目记忆的，它会把 `CLAUDE.md` 也当作意图证据。

### classifier 还会比较自己和主循环的上下文体积

`classifyYoloAction()` 里会计算：

- `classifierChars`
- `classifierTokensEst`
- `mainLoopTokens = tokenCountWithEstimation(messages)`

然后专门记录两边的差值。

源码注释说得很直白：

- classifier prompt 应该始终比主循环上下文更小
- 这样 auto-compact 会先于 classifier overflow 触发

这说明 auto mode 不是一个“旁路小功能”，它甚至和主循环的 context budget 在互相校准。

### 两阶段 XML classifier 说明它不是一条小 prompt

`yoloClassifier.ts` 里还有完整的 2-stage XML classifier：

- Stage 1：快速给 `<block>yes/no</block>`
- Stage 2：再带 `<thinking>` 和 `<reason>`

它还专门做了：

- `stripThinking()`
- `parseXmlBlock()`
- `parseXmlReason()`
- usage 聚合
- request id 提取

这已经不是“模型顺手帮忙判断一下”，而是一个正式的权限决策子系统。

## worker 的权限不是各管各的，而是通过 leader 同步

`utils/swarm/permissionSync.ts` 里，权限协同流程写得非常完整：

1. worker 遇到需要授权的工具调用
2. 写入 `permission_request`
3. leader 轮询 mailbox / pending dir 读到请求
4. 用户在 leader 侧批准或拒绝
5. leader 把 `permission_response` 回给 worker
6. worker 再继续执行

### 请求体本身就很完整

`SwarmPermissionRequestSchema` 里包括：

- `workerId`
- `workerName`
- `workerColor`
- `toolName`
- `toolUseId`
- `description`
- `input`
- `permissionSuggestions`
- `status`
- `resolvedBy`
- `feedback`
- `updatedInput`
- `permissionUpdates`

这意味着 leader 做的不是“给个 yes/no”，而是可以：

- 改写输入
- 回退反馈
- 下发 always-allow 规则
- 记录到底是 leader 还是 worker 自己解决的

这层设计非常关键，因为没有它，多 worker 一多，权限面会立刻失控。

## 这套权限系统最值得学的地方

如果把 Claude Code 的权限系统压成几个硬结论，我会留这六条：

1. 权限先被做成会话模式，而不是散布在每个工具里。
2. 文件权限最重要的不是“匹配”，而是“防绕过”和“收窄授权”。
3. shell 权限需要规则语言，不能只靠字符串包含。
4. auto mode 不是放开权限，而是增加一个权限分类模型。
5. 权限拒绝本身必须进入结果对象，方便上层观察。
6. 多 worker 场景下，权限必须能走 leader 协同链路。

这也是为什么我会把权限系统看成 Claude Code 的核心护城河之一。  
不是因为它有“权限”两个字，而是因为它把权限真正做成了 runtime control plane。
