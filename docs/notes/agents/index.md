---
title: Agents 总览
sidebarTitle: 专题首页
---

# Agents 总览

这一组内容用来沉淀你写 Agent 系统时最常复用的东西：角色设计、提示词结构、工具调用协议、上下文拼装方式。

## 建议拆法

- `设计页`：这个 Agent 负责什么，不负责什么
- `Prompt 页`：System Prompt、约束、输入输出格式
- `工具页`：工具定义、参数、错误处理、回退策略
- `案例页`：真实任务里的调用链和问题复盘

## 先写这三类模板

- [Agent 设计](/notes/agents/agent-design-template)
- [System Prompt](/notes/agents/system-prompt-template)
- [工具调用](/notes/agents/tooling-template)

## 源码解析

- [Claude 源码解析](/notes/agents/claude-code-analysis/)
- [01 Claude Code 泄露事件与架构启示](/notes/agents/claude-code-analysis/first-look)
- [02 QueryEngine 主循环](/notes/agents/claude-code-analysis/query-engine-main-loop)
- [03 上下文系统](/notes/agents/claude-code-analysis/context-system)
- [04 权限系统](/notes/agents/claude-code-analysis/permission-system)
- [05 多 worker 编排](/notes/agents/claude-code-analysis/coordinator-and-workers)
- [06 平台化](/notes/agents/claude-code-analysis/platformization)
- [07 Agent Runtime 总结](/notes/agents/claude-code-analysis/agent-runtime-os)
- [08 上下文压缩机制](/notes/agents/claude-code-analysis/compaction-mechanics)
- [09 工具系统与运行时能力池](/notes/agents/claude-code-analysis/tool-system)

## 以后可以继续补

- 多 Agent 编排模板
- 记忆 / 上下文窗口策略
- Agent 评测模板
- Agent 失败案例库
