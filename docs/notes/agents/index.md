# Agents 总览

这一组内容用来沉淀你写 Agent 系统时最常复用的东西：角色设计、提示词结构、工具调用协议、上下文拼装方式。

## 建议拆法

- `设计页`：这个 Agent 负责什么，不负责什么
- `Prompt 页`：System Prompt、约束、输入输出格式
- `工具页`：工具定义、参数、错误处理、回退策略
- `案例页`：真实任务里的调用链和问题复盘

## 先写这三类模板

- [Agent 设计模板](/notes/agents/agent-design-template)
- [System Prompt 模板](/notes/agents/system-prompt-template)
- [工具调用模板](/notes/agents/tooling-template)

## 以后可以继续补

- 多 Agent 编排模板
- 记忆 / 上下文窗口策略
- Agent 评测模板
- Agent 失败案例库
