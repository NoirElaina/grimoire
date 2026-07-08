---
title: LangGraph 工作流
sidebarTitle: LangGraph 工作流
---

# LangGraph 工作流

> LangGraph 适合“有状态、有分支、可恢复、要人工介入”的 Agent 工作流。不是所有 Agent 都需要图，简单工具循环不要强行上图。

## 核心概念

| 概念 | 含义 |
| --- | --- |
| State | 工作流状态 |
| Node | 处理状态的步骤 |
| Edge | 节点之间的流转 |
| Conditional Edge | 根据状态选择下一步 |
| Checkpointer | 保存状态，用于恢复 |
| Thread ID | 一次可恢复运行的标识 |
| Interrupt | 暂停等待人工输入 |

直觉：

```text
StateGraph = 有状态的流程图
```

## 一个最小图

```python
from typing import TypedDict
from langgraph.graph import StateGraph, START, END

class AgentState(TypedDict):
    task: str
    plan: str
    result: str

def plan_node(state: AgentState):
    return {"plan": f"Plan for: {state['task']}"}

def execute_node(state: AgentState):
    return {"result": f"Executed: {state['plan']}"}

builder = StateGraph(AgentState)
builder.add_node("plan", plan_node)
builder.add_node("execute", execute_node)
builder.add_edge(START, "plan")
builder.add_edge("plan", "execute")
builder.add_edge("execute", END)

graph = builder.compile()
```

运行：

```python
graph.invoke({"task": "write Redis note"})
```

## State 设计

State 不要写成大杂烩。

推荐：

```python
class CodingState(TypedDict):
    task: str
    plan: list[str]
    current_step: int
    files_touched: list[str]
    tool_results: list[dict]
    approval: dict | None
    final_answer: str | None
```

State 要表达：

- 当前目标。
- 已完成什么。
- 下一步是什么。
- 工具结果。
- 人工审批状态。
- 最终输出。

不要把所有对话原文都塞进 State。大文本应该裁剪或存引用。

## Node 设计

Node 应该小而明确。

```python
def review_plan(state: CodingState):
    if len(state["plan"]) == 0:
        return {"approval": {"required": True, "reason": "empty plan"}}
    return {}
```

好的 Node：

- 输入是 State。
- 输出是 State 的局部更新。
- 副作用明确。
- 可测试。
- 可重放。

坏的 Node：

- 什么都做。
- 里面无限调用外部系统。
- 状态更新不清楚。
- 出错后不知道恢复到哪。

## Conditional Edge

根据状态选择下一步：

```python
def route_after_plan(state: CodingState):
    if state.get("approval", {}).get("required"):
        return "approval"
    return "execute"

builder.add_conditional_edges(
    "plan",
    route_after_plan,
    {
        "approval": "approval",
        "execute": "execute"
    }
)
```

适合：

- 是否需要审批。
- 是否继续搜索。
- 是否重试。
- 是否结束。
- 是否转人工。

## Checkpoint

LangGraph 的关键价值之一是 durable execution。

生产里要给每次运行一个稳定 thread id：

```python
config = {"configurable": {"thread_id": "task-20260607-001"}}
graph.invoke(input_state, config=config)
```

Checkpoint 能解决：

- 运行中断后恢复。
- 人工审批等待。
- 长任务分阶段执行。
- 调试时回看状态。

不要只用内存 checkpointer 做生产持久化。生产应使用可持久化存储。

## Durable Execution

可恢复执行的关键要求：

```text
1. 有 checkpointer
2. 每次运行有 thread_id
3. 副作用放进 task 或有幂等保护
4. 节点尽量确定性
5. 恢复时不要重复执行不可重复动作
```

典型副作用：

- 发邮件。
- 写文件。
- 写数据库。
- 调第三方 API。

这些动作必须有幂等键或状态记录。

## Durability 模式

LangGraph 有不同持久化策略，工程上按风险选：

| 模式 | 直觉 | 适合 |
| --- | --- | --- |
| `exit` | 退出时保存 | 低风险短流程 |
| `async` | 异步保存 | 性能和可靠性折中 |
| `sync` | 每步前同步保存 | 高可靠长流程 |

可靠性越高，性能成本越高。

不要所有流程都无脑 `sync`，也不要高风险流程只在退出时保存。

## Human-in-the-loop

LangGraph 的 interrupt 可以在节点里暂停：

```python
from langgraph.types import interrupt, Command

def approval_node(state: CodingState):
    decision = interrupt({
        "question": "是否允许删除这些文件？",
        "files": state["files_touched"]
    })

    if decision["approved"]:
        return Command(goto="execute_delete")
    return Command(goto="cancel")
```

恢复：

```python
graph.invoke(Command(resume={"approved": True}), config=config)
```

这比“最后给一个确认按钮”更稳，因为状态已经 checkpoint，流程可以等人很久再恢复。

## 什么时候不用 LangGraph

不要用在这些场景：

- 只有一轮工具调用。
- 没有分支。
- 不需要恢复。
- 没有人工介入。
- Agent 自己循环就能完成。
- 团队还没搞懂普通主循环。

图框架会带来：

- 状态设计成本。
- 节点拆分成本。
- 持久化成本。
- 调试复杂度。

## 去空话检查

- [ ] 写清楚为什么需要图，而不是为了框架而框架。
- [ ] State 字段可解释。
- [ ] Node 小而可测试。
- [ ] 条件分支显式。
- [ ] 有 thread_id 和 checkpointer。
- [ ] 副作用幂等或可恢复。
- [ ] HITL 用 interrupt，不只是最后确认。

## 参考

- [LangGraph Overview](https://docs.langchain.com/oss/python/langgraph)
- [LangGraph Durable Execution](https://docs.langchain.com/oss/python/langgraph/durable-execution)
- [LangGraph Interrupts](https://docs.langchain.com/oss/python/langgraph/human-in-the-loop)
