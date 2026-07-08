---
title: Harness Engineering
sidebarTitle: Harness Engineering
---

# Harness Engineering

一个 Agent 做事老出错，最常见的反应是改 prompt。prompt 改了十遍，还是错。

问题往往不在 prompt。Agent 之所以出错，是因为它缺少可读的上下文、可控的工具、受控的执行环境和可验证的结果检查。这些东西不在 prompt 里，而在 prompt 外面的一层工程系统里。

这层系统叫 Harness——Agent 运行支架。

```text
Prompt Engineering 关注怎么问。
Context Engineering 关注给什么上下文。
Harness Engineering 关注整个 Agent 怎么被约束、执行、验证和改进。
```

OpenAI 的 Harness Engineering 文章里强调过一个关键点：当 Agent 做不成事时，问题往往不是"模型不够努力"，而是缺少可读、可执行、可验证的环境和能力。

## 没有 Harness 时 Agent 会怎样

给 Agent 一个任务"给项目加一个用户登录功能"，不做任何 harness，直接让模型自由发挥：

```text
模型：好的，我来实现。
  -> 看了一眼项目目录（但看的是旧缓存，不知道有 auth 模块）
  -> 自己写了一个 LoginController（和已有的 AuthController 冲突）
  -> 调用了 npm install jsonwebtoken（项目用的是 Java + JWT，不需要 npm）
  -> 写完了说"完成"
  -> 但没有跑测试，没有跑构建
  -> 实际上编译不过，而且改了 3 个无关文件
```

每一步出错都不是因为模型"笨"，而是因为缺少 harness：

- 看了旧缓存 -> 缺少 Context 管理，没有给模型最新的项目状态。
- 和已有代码冲突 -> 缺少 Context 管理，没有告诉模型项目里已有 AuthController。
- 调了 npm install -> 缺少 Tools 控制，没有限制工具能做什么。
- 没跑测试 -> 缺少 Evaluation，没有在"完成"前强制跑构建。
- 改了无关文件 -> 缺少 Control，没有限制文件修改范围。

Harness 就是把这些缺失的环节补上。

## Harness 是什么

Harness 不是一个单独工具，而是一层包住 Agent 的工程系统：

```text
User / Task
  -> Specification        （任务规范）
  -> Context Pipeline     （上下文供给）
  -> Agent Runtime        （运行循环）
  -> Tool Layer           （工具层）
  -> Middleware / Guardrails （拦截和审批）
  -> Execution Environment（沙箱环境）
  -> Evaluation / Sensors （验证和监控）
  -> Trace / Audit        （记录和审计）
  -> Feedback / Harness Update （失败回流为规则）
```

它让 Agent：

- 知道任务边界。
- 能拿到必要上下文。
- 只能调用允许的工具。
- 在受控环境执行。
- 出错时能被检测。
- 完成后能被验证。
- 失败经验能回流为规则。

## 五个核心模块

业界对 Harness 模块没有唯一标准。这里按工程落地拆成五块：

```text
1. Context：上下文供给
2. Control：控制与约束
3. Tools：工具与能力
4. Runtime：执行与恢复
5. Evaluation：评测与反馈
```

下面逐块展开。每块都先说"管什么"，再说"不做到位会怎样"，最后说"怎么落地"。

## 1. Context：上下文供给

Context 管的是"Agent 看到什么"。

Agent 做决策完全依赖上下文。如果上下文里有过时信息、缺失信息或噪声信息，Agent 就会做错决策。

### 不做到位会怎样

```text
场景：让 Agent 给项目加缓存功能

上下文没给项目当前的 Redis 配置：
  -> Agent 自己假设用 Jedis（项目实际用 Lettuce）
  -> 写出来的代码引用了 Jedis 的 API
  -> 编译不过

上下文给了整个项目的所有文件（3000 个）：
  -> Agent 被噪声淹没，抓不住重点
  -> 在不相关的文件里改了几行
  -> 真正要改的 RedisConfig 反而没动
```

### 怎么落地

Context 供给不是"把所有东西都塞给模型"，而是给相关、最新、可信、不过量的信息。

一个 Context Pipeline 大概长这样：

```text
输入：用户任务 "给商品详情接口加 Redis 缓存"

Context Pipeline 做的事：
  1. 读取项目规则（AGENTS.md）
     -> "后端用 Spring Boot 3 + MyBatis-Plus + Redis (Lettuce)"
     -> "缓存 key 必须统一前缀，TTL 必须明确"

  2. 读取相关文件
     -> ProductController.java（商品接口）
     -> ProductService.java（商品业务逻辑）
     -> RedisConfig.java（Redis 配置，确认用的是 Lettuce）
     -> application.yml（Redis 连接配置）

  3. 读取相关历史
     -> git log 里最近改过 ProductService 的 commit
     -> 看看有没有人尝试过加缓存

  4. RAG 检索
     -> 搜索项目文档里"缓存"相关的笔记
     -> 搜索团队缓存设计规范

  5. 组装上下文（带 source tag）
     [项目规则] AGENTS.md: "缓存 key 必须统一前缀"
     [当前代码] ProductController.java: ...
     [当前代码] RedisConfig.java: ...
     [团队规范] cache-design.md: "先查 Redis，未命中查 MySQL，再写 Redis"
     [git 历史] 2024-01-15: "商品接口性能优化，暂不加缓存"

  6. 检查上下文长度
     -> 超过预算 -> 压缩或裁剪低优先级内容
```

关键设计点：

- **相关**：不是给所有文件，只给和任务相关的文件。怎么判断相关？用任务关键词匹配、git diff、import 关系。
- **最新**：每次从文件系统实时读，不用缓存。给模型看的代码必须和磁盘上一致。
- **可信**：每条上下文带 source tag，标明来源。模型不应该把"可能相关"的检索结果当成"确定事实"。
- **不过量**：上下文有预算。超预算时按优先级裁剪。项目规则 > 当前代码 > 历史决策 > RAG 检索结果。

常见机制：Context Builder、RAG 检索、三级压缩、metadata 过滤、source tagging、context firewall（低信任内容隔离）。

## 2. Control：控制与约束

Control 管的是"Agent 能做什么、不能做什么"。

### 不做到位会怎样

```text
场景：让 Agent 修一个 bug

没有 Control：
  -> Agent 修完 bug 后觉得代码"不够优雅"，顺手重构了 3 个文件
  -> Agent 发现测试跑不过，不停重试，循环了 20 轮
  -> Agent 调用了 rm -rf 清理临时文件，删错了目录
  -> Agent 改了 pom.xml 加了一个新依赖（但项目不允许引入新依赖）
```

### 怎么落地

Control 的核心原则：**真正可靠的约束要能机械执行，不能只靠 prompt 里写"请不要这样做"。**

```text
约束类型         实现方式

文件修改范围     程序检查：只允许改 src/main/java/com/example/product/ 下的文件
                 Agent 想改别的文件 -> 直接拒绝，返回错误

工具白名单       程序控制：只暴露 read_file、write_file、search_code
                 不暴露 shell、delete_file、git push

高风险动作       执行前审批：
                 write_file -> 允许
                 git commit -> 需要人工确认
                 npm install -> 需要人工确认
                 rm -> 禁止

最大轮数         程序计数：Agent 循环超过 15 轮 -> 强制停止
                 防止无限重试

预算限制         程序统计：token 用量超过 100k -> 停止
                 防止成本失控

规范检查         程序验证：
                 改完后跑 lint -> 不通过就回去修
                 改完后跑测试 -> 不通过就回去修
                 不允许引入新依赖 -> 扫描 pom.xml diff
```

关键区别：

```text
不可靠的约束（只写在 prompt 里）：
  "请不要修改无关文件。"
  "请不要引入新依赖。"
  "请不要无限重试。"

可靠的约束（程序机械执行）：
  不在白名单内的文件 -> write_file 返回 permission denied
  pom.xml 出现新 dependency -> lint 报错
  循环超过 15 轮 -> runtime 强制停止
```

Prompt 里的约束是"建议"，程序里的约束是"强制"。Harness 的 Control 层要把"建议"变成"强制"。

## 3. Tools：工具与能力

Tools 管的是"Agent 能用什么工具行动"。

### 不做到位会怎样

```text
场景：让 Agent 做代码审查

工具太多，全暴露：
  -> 模型看到 30 个工具，选了一个不太合适的
  -> 用 search_full_text 搜索，但其实用 grep 更精准
  -> 工具输出 5000 行，把上下文撑爆了

工具没有限制：
  -> Agent 用 shell 跑了 npm install
  -> Agent 用 git push 推了代码到远程
  -> Agent 用 delete_file 删了"看起来没用"的文件
```

### 怎么落地

工具层设计不只是"有哪些工具"，每个工具都要定义清楚：

```text
工具定义示例：

名称：search_code
描述：在项目代码中搜索关键词，返回匹配的文件和行号
输入 schema：
  {
    pattern: string (必填，搜索关键词),
    file_type: string (可选，文件类型过滤，如 "java"),
    max_results: number (可选，默认 20)
  }
输出协议：
  {
    matches: [{ file, line, content }],
    total: number
  }
错误结构：
  { error: "pattern is required" }
  { error: "search timeout after 10s" }
超时：10 秒
重试：不重试（搜索是只读操作，超时直接返回错误）
权限：read（只读，不需要审批）
审计：记录调用时间、参数、返回行数
```

好的 harness 会动态暴露工具，不是把所有工具一股脑全给模型：

```text
任务类型：代码审查
  暴露工具：read_file, search_code, grep, git_diff
  不暴露：write_file, shell, git_commit, delete_file

任务类型：修复 bug
  暴露工具：read_file, write_file, search_code, run_tests
  不暴露：git_push, delete_file, npm_install

任务类型：文档写作
  暴露工具：read_file, write_file, search_code, web_search
  不暴露：shell, git_commit, delete_file
```

工具越多不一定越好。工具多了模型选错的概率反而变大。按任务类型和 Agent 权限动态暴露，模型的选择空间小了，准确率反而高。

## 4. Runtime：执行与恢复

Runtime 管的是"Agent 在哪里跑、能碰什么、出错了怎么办"。

### 不做到位会怎样

```text
场景：让 Agent 跑测试

没有沙箱：
  -> Agent 跑了一个测试，测试里有 System.exit(0)
  -> Agent 进程直接退出了，状态全丢

没有回滚：
  -> Agent 改了 5 个文件，发现方向错了
  -> 但没有 checkpoint，不知道改之前是什么样
  -> 只能手动 git stash 往回找

没有超时控制：
  -> Agent 跑 mvn test，测试里有个死循环
  -> Agent 一直等，30 分钟后用户手动取消
```

### 怎么落地

Runtime 要回答这些问题：

```text
Agent 在哪里运行？
  -> 在 Docker 容器里？在 git worktree 里？在当前工作目录？

能访问哪些文件？
  -> 只能访问项目目录？能访问 ~/.ssh 吗？能访问 /etc 吗？

能访问网络吗？
  -> 能调外部 API 吗？能 npm install 吗？能 curl 任意 URL 吗？

命令超时怎么办？
  -> 每个命令最多跑 120 秒，超时自动 kill。

执行失败怎么恢复？
  -> 每个 task 开始前做 checkpoint。
  -> 失败后从 checkpoint 恢复，不是从头开始。

改坏了怎么回滚？
  -> 用 git worktree 隔离。
  -> 改坏了直接丢弃 worktree，不影响主分支。

长任务怎么保存进度？
  -> Agent 状态序列化到文件或数据库。
  -> 恢复时反序列化，继续上次的状态。
```

一个具体的 Runtime 配置：

```text
运行环境：Docker 容器
  镜像：openjdk:17 + node:20 + maven:3.9
  工作目录：/workspace
  挂载：项目目录（只读挂载到 /workspace/src，写操作通过 worktree）

文件访问：
  允许：/workspace/src/**
  禁止：/workspace/.git, ~/.ssh, /etc, /var

网络访问：
  允许：maven central, npm registry（白名单域名）
  禁止：其他所有外部地址

超时控制：
  单个命令：120 秒
  单个任务：30 分钟
  整个 session：2 小时

Checkpoint：
  每个 task 开始前保存 state snapshot
  state 包含：messages, tool_results, run_state, completed_tasks

恢复策略：
  命令超时 -> kill 进程，标记失败，Agent 决定是否重试
  任务失败 -> 从上一个 checkpoint 恢复
  session 超时 -> 保存状态，通知用户
```

## 5. Evaluation：评测与反馈

Evaluation 管的是"Agent 做得对不对，错了怎么改进"。

### 不做到位会怎样

```text
场景：Agent 说"完成了"

没有验证门禁：
  -> Agent 说完成，用户信了，直接合并
  -> 上线后发现编译不过

没有 trace：
  -> Agent 改了 8 个文件，做了 15 次工具调用
  -> 出了问题，不知道哪一步引入的 bug

没有失败回流：
  -> Agent 这次犯了一个错：忘记跑 flyway migrate
  -> 下次又犯了同样的错
  -> 下下次又犯了
  -> 每次都是"改 prompt"，但 prompt 改了也管不住
```

### 怎么落地

Evaluation 不是最后才跑，而是贯穿整个循环：

```text
before（任务开始前）：
  检查上下文是否完整 -> 缺关键文件？先补。
  检查规范是否加载 -> AGENTS.md 读了吗？
  检查依赖是否就绪 -> 数据库连上了吗？Redis 连上了吗？

during（执行过程中）：
  工具调用监控 -> 工具参数合理吗？输出异常吗？
  预算监控 -> token 用了多少？还剩多少？
  风险监控 -> 要执行 write_file？检查路径在白名单内吗？
  循环检测 -> 同一个工具连续调了 5 次？可能卡住了。

after（任务完成后）：
  构建 -> mvn clean package 通过了吗？
  测试 -> 所有测试用例跑过了吗？
  lint -> 代码风格检查通过了吗？
  类型检查 -> TypeScript / Java 类型检查通过了吗？
  规范检查 -> 引入了新依赖吗？改了不该改的文件吗？
  验收标准 -> Spec 里的每条验收标准都通过了吗？

feedback（失败回流）：
  Agent 忘记跑 flyway migrate
    -> 在 completion gate 里加一步：检查 flyway_schema_history
    -> 下次 Agent "完成"前，程序自动跑 flyway migrate 验证

  Agent 总是改无关文件
    -> 在 write_file 前加 path scope 检查
    -> 不在白名单内的路径，直接拒绝

  Agent 引入了新依赖
    -> 在 lint 里加 pom.xml diff 检查
    -> 发现新 dependency 就报错
```

关键设计：**每犯一次错，就把防住这个错的规则加到 harness 里。** 不是每次都骂模型，而是问"这次失败是哪个 harness 模块没设计好"。

## Harness 和 SDD 的关系

SDD 是 Harness 的 Control + Context 部分。

```text
SDD 提供：
  spec        -> 告诉 Agent "做什么"
  plan        -> 告诉 Agent "怎么做"
  tasks       -> 告诉 Agent "分几步做"
  验收标准     -> 告诉 Agent "什么算完成"

Harness 负责：
  把 spec 塞进 Context Pipeline
  用 spec 约束 Agent 的行为范围（Control）
  给 Agent 工具去执行 tasks（Tools）
  在受控环境里运行（Runtime）
  用验收标准做验证门禁（Evaluation）
  记录每一步（Trace）
  失败后改进系统（Feedback）
```

SDD 是"做什么和怎么验收"。Harness 是"让 Agent 可靠执行这件事的整个系统"。

## 完整示例：一个文档写作 Agent 的 Harness

```text
任务：给项目写一篇 Redis 缓存设计的笔记

Context：
  - 读取 docs/ 目录结构，了解已有笔记的组织方式
  - 读取最近写的 3 篇笔记，学习写作风格
  - 读取 AGENTS.md 里的写作规范（"不要先给结论""渐进式展开"）
  - RAG 检索项目里已有的 Redis 相关代码和配置
  - 读取 VitePress 侧边栏配置，确认新笔记挂在哪里

Control：
  - 文件修改范围：只允许写 docs/notes/redis/ 目录
  - 禁止修改：config.ts（侧边栏配置由人工改）
  - 禁止操作：git commit, git push
  - 最大轮数：20 轮
  - 写作规范检查：不能出现"先给结论""最后记一句话""一句话："

Tools：
  - read_file：读取文件
  - write_file：写入文件（限制在 docs/notes/redis/ 下）
  - search_code：搜索项目代码
  - grep：精确搜索
  - web_search：搜索 Redis 官方文档
  - run_command：只允许 pnpm docs:build（验证构建）
  不暴露：shell, git_commit, delete_file

Runtime：
  - 在当前 git workspace 执行
  - 不自动 git add，不自动 git commit
  - 构建超时 120 秒
  - 修改前自动 git stash 做 checkpoint

Evaluation：
  before：
    - 确认读了 AGENTS.md
    - 确认读了至少 2 篇已有笔记（学习风格）
  during：
    - 每次 write_file 前检查路径在白名单内
    - 检查内容不包含禁用词
  after：
    - pnpm docs:build 构建通过
    - 笔记内容不为空
    - 笔记结构包含至少 3 个二级标题
    - 没有残留的"TODO""占位符"
  feedback：
    - 如果构建失败，记录失败原因，下次写作前先检查同类问题
    - 如果出现禁用词，在 write_file 前增加内容扫描
```

## Harness 改进循环

Harness Engineering 的核心原则：

```text
Agent 犯一次错，就把错误变成系统改进。
```

| Agent 犯的错 | 不是改 prompt | 而是改 harness |
| --- | --- | --- |
| 忘记跑构建 | ~~"请记得跑构建"~~ | completion 前强制 build gate，构建不过不允许标记完成 |
| 误删文件 | ~~"请不要删文件"~~ | write_file 前检查 path scope，delete_file 工具不暴露 |
| 写空话 | ~~"请不要写空话"~~ | 文档 lint 增加禁用词扫描，扫到就报错 |
| 工具无限循环 | ~~"请不要重复调用"~~ | 增加 max tool rounds 和 loop detector，超过 5 次相同调用自动停止 |
| 引用过期资料 | ~~"请用最新资料"~~ | RAG metadata 加版本和更新时间，过期内容不返回 |
| 改了无关文件 | ~~"只改相关文件"~~ | 文件修改白名单，不在白名单内的路径直接拒绝 |
| 忘记跑迁移 | ~~"请跑 flyway"~~ | completion gate 加一步：检查 flyway_schema_history |

每次 Agent 出错，问的不是"模型为什么这么蠢"，而是"哪个 harness 模块没拦住这个错误"。

## 去空话检查

- [ ] 是否把 Harness 理解成模型外部系统，而不是一个 prompt。
- [ ] Context：是否给模型相关、最新、可信、不过量的上下文。
- [ ] Control：是否把约束从 prompt 里的"建议"变成程序里的"强制"。
- [ ] Tools：是否按任务类型动态暴露工具，而不是全给。
- [ ] Runtime：是否有沙箱、超时、checkpoint 和回滚。
- [ ] Evaluation：是否在 before/during/after 都有检查，不只是最后跑个测试。
- [ ] 是否有 trace 记录每一步，出了问题能回放。
- [ ] 是否把重复失败沉淀成规则，而不是每次改 prompt。

## 参考

- [OpenAI: Harness engineering](https://openai.com/index/harness-engineering)
- [Harness Engineering for AI Coding Agents](https://harn.app/)
- [LangChain Middleware](https://docs.langchain.com/oss/python/langchain/middleware)
- [SDD 规范驱动开发](/notes/agents/spec-driven-development)
- [ReAct Agent 与运行控制](/notes/agents/react-agent-runtime-control)
