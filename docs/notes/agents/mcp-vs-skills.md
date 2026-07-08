---
title: MCP 和 Skills 区别
sidebarTitle: MCP vs Skills
---

# MCP 和 Skills 区别

MCP 和 Skills 经常被放在一起讨论，但它们解决的问题不一样。

简单来说：

```text
MCP 解决"Agent 怎么连接外部工具和数据源"。
Skills 解决"Agent 遇到某类任务时应该按什么方法做"。
```

MCP 是协议层。

Skills 是能力说明和工作流层。

## 对比总览

| 维度 | MCP | Skills |
| --- | --- | --- |
| 本质 | 标准通信协议 | 可复用任务说明包 |
| 解决问题 | 连接工具、资源、提示词 | 固化任务流程、经验、脚本和参考资料 |
| 运行方式 | Host / Client 通过协议调用 Server | Agent 读取 `SKILL.md` 后按说明执行 |
| 典型内容 | `tools/list`、`tools/call`、`resources/read` | 触发条件、操作步骤、脚本、资产、引用资料 |
| 是否执行外部动作 | 可以，通过 MCP tool | 本身不一定执行，通常指导 Agent 调工具或运行脚本 |
| 是否跨应用复用 | 强，协议标准化 | 中，依赖 Agent 是否支持 Skills |
| 安全重点 | 鉴权、权限、工具调用确认、输出净化 | 技能来源可信度、指令注入、脚本安全 |
| 类比 | USB-C / API 协议 | 操作手册 / SOP / 插件说明 |

## MCP 解决什么

MCP Server 暴露三类能力：

```text
Tools：可执行动作
Resources：可读取上下文
Prompts：可复用提示词模板
```

典型场景：

```text
Agent 需要查数据库。
Agent 需要读 GitHub issue。
Agent 需要调用企业 CRM。
Agent 需要访问本地文件索引。
Agent 需要通过统一协议发现工具。
```

MCP 的关键是协议：

```text
initialize
  -> capabilities
  -> tools/list
  -> tools/call
  -> resources/list
  -> resources/read
```

例如一个 MCP tool：

```json
{
  "name": "get_order",
  "description": "根据订单号查询订单详情",
  "inputSchema": {
    "type": "object",
    "properties": {
      "orderNo": {
        "type": "string"
      }
    },
    "required": ["orderNo"]
  }
}
```

Agent 看到这个工具后，可以发起 `tools/call`。

真正执行发生在 MCP Server。

## Skills 解决什么

Skills 更像“任务工作流说明书”。

一个 Skill 通常包含：

```text
SKILL.md
  -> 技能名称
  -> 什么时候使用
  -> 操作步骤
  -> 注意事项
  -> 可选脚本
  -> 参考资料
  -> 资产文件
```

典型场景：

```text
写技术笔记时应该如何组织结构。
做代码评审时应该先看哪些文件。
生成 PPT 时应该使用哪些脚本和模板。
处理 GitHub PR 评论时应该按什么流程。
安装某类工具时要遵循哪些约束。
```

Skill 不一定提供新工具。

它更多是告诉 Agent：

```text
这类任务怎么做。
哪些步骤不能漏。
哪些文件可以参考。
哪些脚本优先使用。
完成前怎么验证。
```

## 一个具体例子

需求：

```text
帮我把公司知识库接入 Agent，并回答员工制度问题。
```

MCP 做什么：

```text
提供知识库检索工具。
提供文档读取资源。
提供权限过滤。
提供员工身份鉴权。
```

Skills 做什么：

```text
规定回答员工制度问题的流程。
要求先检索最新制度文档。
要求回答必须带来源。
要求无来源时拒答。
要求涉及薪酬、合规、离职时提醒用户咨询 HR。
```

组合起来：

```text
Skill 决定怎么做。
MCP 提供能调用什么。
```

## MCP 和 Function Calling 的关系

Function Calling 是模型和应用之间的工具调用机制。

MCP 是工具来源和工具执行的标准协议。

可以这样接：

```text
LLM
  -> 产生 function/tool call
  -> Host 判断要调用哪个工具
  -> 如果工具来自 MCP Server
  -> Host 发 MCP tools/call
  -> MCP Server 执行
  -> Host 把结果回填给 LLM
```

所以 MCP 不是替代 Function Calling。

MCP 可以成为 Function Calling 背后的工具提供方。

## Skills 和 Function Calling 的关系

Skill 不等于工具调用。

Skill 影响的是 Agent 的策略：

```text
遇到文档任务
  -> 读取相关 Skill
  -> 按 Skill 里的步骤行动
  -> 可能调用 shell
  -> 可能调用 MCP
  -> 可能调用普通 function tool
```

Skill 是“怎么想、怎么做”的流程约束。

Function Calling 是“模型如何请求执行某个工具”的接口机制。

## 什么时候用 MCP

用 MCP：

- 多个 Agent / 客户端要复用同一套工具。
- 工具在独立进程或远程服务里。
- 需要工具发现、资源读取和协议化调用。
- 需要把企业系统接给不同模型或 Agent。
- 需要标准化鉴权、审计和传输。

不要用 MCP：

- 只是应用内部一个小函数。
- 工具只给当前代码用。
- 没有跨进程或跨应用复用需求。
- 用普通函数工具更简单。

## 什么时候用 Skills

用 Skills：

- 某类任务经常重复。
- 你希望 Agent 严格按流程做。
- 任务需要特定脚本、模板、参考资料。
- 想把经验固化成可复用说明。
- 想减少每次手写长 prompt。

不要用 Skills：

- 只是一次性任务。
- 没有固定流程。
- 只是想暴露一个 API。
- 技能说明不可信或维护不了。

## 能不能一起用

可以，而且很常见。

例如“写 RAG 评测报告”：

```text
Skill：
  - 规定评测流程
  - 定义指标
  - 要求输出格式
  - 要求构建验证

MCP：
  - 读取评测数据集
  - 查询向量库
  - 拉取线上 trace
  - 写入评测结果
```

组合后的执行：

```text
Agent 读取 Skill
  -> 按流程选择评测数据
  -> 调 MCP 工具跑检索
  -> 计算指标
  -> 输出报告
```

## 安全差异

### MCP 安全重点

- Server 鉴权。
- tool 输入校验。
- 敏感 tool 人工确认。
- tool 输出净化。
- 超时、限流、审计。
- 防止工具组合导致数据外泄。

### Skills 安全重点

- Skill 来源可信。
- `SKILL.md` 不能夹带恶意指令。
- 可执行脚本要审查。
- 不要让 Skill 越权改变系统规则。
- 不要自动信任第三方技能。

MCP 的风险偏“工具执行”。

Skills 的风险偏“行为诱导”。

## 选型口诀

```text
要接外部系统：MCP。
要固化工作流程：Skills。
要让模型请求执行函数：Function Calling。
要让多个远程 Agent 协作：A2A。
```

## 去空话检查

- [ ] 是否区分协议层和工作流层。
- [ ] 是否知道 MCP 暴露 tools、resources、prompts。
- [ ] 是否知道 Skills 主要是 `SKILL.md` 指令、资源和脚本。
- [ ] 是否知道 MCP 可以作为 Function Calling 背后的工具提供方。
- [ ] 是否知道 Skill 本身不等于工具。
- [ ] 是否区分工具执行风险和技能指令风险。
- [ ] 是否知道二者可以组合使用。

## 参考

- [MCP Tools](https://modelcontextprotocol.io/docs/concepts/tools)
- [MCP Resources](https://modelcontextprotocol.io/docs/concepts/resources)
- [MCP Prompts](https://modelcontextprotocol.io/docs/concepts/prompts)
- [Agent Skills – Codex](https://developers.openai.com/codex/skills)
- [Function Calling](/notes/agents/tool-calling-protocol)
