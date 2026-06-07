---
title: SDD 规范驱动开发
sidebarTitle: SDD 规范驱动开发
---

# SDD 规范驱动开发

SDD 是 `Spec-Driven Development`，规范驱动开发。

核心不是“多写文档”。

核心是：

```text
先把需求、约束、设计、任务和验收标准写成可执行规范，
再让人或 AI Agent 按规范实现，
最后用测试和审查证明实现符合规范。
```

它解决 AI 编程里的一个常见问题：

```text
需求没说清楚，Agent 直接写代码。
代码看起来能跑，但边界、权限、异常、验收都缺。
```

## SDD 和普通文档的区别

| 普通文档 | SDD 规范 |
| --- | --- |
| 写给人看 | 写给人和 AI Agent 执行 |
| 描述愿景 | 定义边界、行为和验收 |
| 容易过期 | 和任务、测试、实现绑定 |
| 可选阅读 | 进入实现前必须消费 |
| 不一定可测试 | 每条关键要求应能验证 |

SDD 的规范要回答：

- 做什么。
- 不做什么。
- 为什么做。
- 谁使用。
- 输入输出是什么。
- 数据模型是什么。
- 接口契约是什么。
- 失败场景是什么。
- 验收标准是什么。
- 实现过程中不能破坏什么。

## SDD 的基本流程

```text
Idea
  -> Spec
  -> Plan
  -> Tasks
  -> Implement
  -> Verify
  -> Review
```

### 1. Spec

写需求和行为。

重点：

- 用户目标。
- 使用场景。
- 功能范围。
- 非目标。
- 业务规则。
- 边界情况。
- 验收标准。

### 2. Plan

写技术方案。

重点：

- 架构。
- 模块划分。
- 数据流。
- 表结构。
- API。
- 事务。
- 缓存。
- MQ。
- 权限。
- 迁移策略。

### 3. Tasks

拆成可执行任务。

每个任务要有：

- 修改文件。
- 修改原因。
- 前置依赖。
- 验证方式。
- 完成标准。

### 4. Implement

按任务实现。

不要让 Agent 跳过计划直接改代码。

### 5. Verify

验证：

- 测试。
- 构建。
- lint。
- 迁移。
- 安全检查。
- 手工验收用例。

### 6. Review

检查实现是否符合 spec。

不是只看代码能不能跑。

## Spec-kit 是什么

Spec Kit 是 GitHub 开源的 SDD 工具包。

它提供：

- SDD 工作流模板。
- `Spec -> Plan -> Tasks -> Implement` 阶段。
- Markdown 规范产物。
- 不同 AI coding agent 的集成。
- 命令行工具和项目脚手架。

它的价值不是“替你想需求”。

它的价值是把 AI 编程流程固定下来：

```text
先写 spec
再写 plan
再拆 tasks
最后实现
```

这样 Agent 拿到的是结构化上下文，而不是一句随意 prompt。

适合：

- 新功能开发。
- 大改动。
- 多人协作。
- 需要审查和验收的需求。
- 希望减少 vibe coding 的项目。

不适合：

- 一行修复。
- 临时试验。
- 需求还没方向。
- 没有人愿意维护规范。

## OpenSpec 是什么

OpenSpec 是另一类 SDD 工具/框架思路。

它强调把系统能力和设计意图维护成一个持续演进的规范。

可以把它理解成：

```text
Spec 是系统的活文档。
实现要跟 Spec 对齐。
变更要先更新 Spec。
```

OpenSpec 更强调：

- 当前系统能力。
- 功能边界。
- 设计约束。
- 变更提案。
- 规范和实现一致性。

如果 Spec Kit 更像“生成一条功能开发流水线”，OpenSpec 更像“维护一个系统级规范源”。

## OpenSpec 和 Spec-kit 的区别

| 维度 | Spec Kit | OpenSpec |
| --- | --- | --- |
| 重点 | 功能从想法到实现的阶段化流程 | 系统规范作为长期事实源 |
| 产物 | spec、plan、tasks、implementation artifacts | living spec、变更提案、系统约束 |
| 使用方式 | 每个 feature 走一轮 SDD | 围绕系统规范持续演进 |
| 更适合 | 新功能开发、AI coding 流水线 | 长期维护、能力边界、架构一致性 |
| 风险 | spec 变成流程模板，实际没人审 | living spec 过大、维护成本高 |

简单记：

```text
Spec Kit：帮你把“一个需求”拆成规范化开发流程。
OpenSpec：帮你把“一个系统”的规范长期维护起来。
```

两者可以组合：

```text
OpenSpec 保存系统当前事实。
Spec Kit 为每个新功能生成 spec / plan / tasks。
实现后再把系统事实回写到 OpenSpec。
```

## SDD 不是瀑布

SDD 容易被误解成瀑布。

区别在于：

```text
瀑布：长周期大文档，写完才开发。
SDD：短周期可验证规范，随实现迭代。
```

一个好的 SDD 循环可以很短：

```text
30 分钟写 spec
20 分钟写 plan
10 分钟拆 tasks
实现一个小阶段
跑测试
回写规范
```

重点不是文档厚。

重点是每一步有明确输入输出。

## AI Agent 中 SDD 的价值

AI Agent 很容易出现：

- 自己扩需求。
- 漏异常。
- 漏权限。
- 改无关文件。
- 忘记验收。
- 写出看似合理但不符合业务的代码。

SDD 可以约束：

```text
需求范围
技术栈
目录结构
接口契约
数据模型
安全边界
验收标准
禁止事项
```

对 Agent 来说，Spec 是上下文，不是摆设。

## 一份 SDD Spec 应该包含什么

```text
1. 背景和目标
2. 用户角色
3. 使用场景
4. 必须实现
5. 暂不实现
6. 业务规则
7. 数据模型
8. 接口契约
9. 权限规则
10. 异常场景
11. 非功能要求
12. 验收标准
13. 测试策略
14. 风险和未知点
```

每条验收标准要能测试。

不要写：

```text
系统要稳定可靠。
```

要写：

```text
创建订单失败时，订单记录和库存扣减必须同时回滚。
```

## SDD 的常见失败

### 1. Spec 太空

```text
实现用户登录功能。
```

这不叫 spec。

至少要写：

- 登录方式。
- 密码规则。
- token 有效期。
- 错误码。
- 登录失败次数。
- 接口请求响应。
- 验收用例。

### 2. Spec 太大

一个 spec 覆盖整个系统，Agent 很难执行。

应该按 feature 或能力拆。

### 3. Spec 不更新

实现变了，spec 不变。

下次 Agent 读到旧 spec，会按旧事实行动。

### 4. 没有验收

没有验收标准，Agent 只会“看起来完成”。

### 5. 没有限制非目标

不写“暂不实现”，Agent 可能扩展需求。

## 去空话检查

- [ ] 是否把 spec、plan、tasks、implement 分清楚。
- [ ] 是否明确非目标。
- [ ] 是否每条验收都可测试。
- [ ] 是否限制技术栈和目录结构。
- [ ] 是否能从 spec 推出测试用例。
- [ ] 是否避免把 spec 写成愿景文档。
- [ ] 是否有规范更新机制。

## 参考

- [GitHub Spec Kit](https://github.github.io/spec-kit/)
- [Spec Kit GitHub Repository](https://github.com/github/spec-kit)
- [OpenSpec](https://openspec.dev/)
- [Spec-Driven Development: From Code to Contract in the Age of AI Coding Assistants](https://arxiv.org/abs/2602.00180)
- [产品规范提示词](/notes/agents/product-spec-prompt)
