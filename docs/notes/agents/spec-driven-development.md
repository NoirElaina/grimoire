---
title: SDD 规范驱动开发
sidebarTitle: SDD 规范驱动开发
---

# SDD 规范驱动开发

AI Agent 写代码时最常见的问题不是"写不出来"，而是"写出来了但不对"：

```text
需求只说了"实现用户登录"，Agent 就直接写代码。
密码规则没定、token 有效期没说、失败次数限制没写、错误码没设计。
代码看起来能跑，但边界、权限、异常、验收全是空的。
```

SDD（Spec-Driven Development，规范驱动开发）解决的就是这个问题：

```text
先把需求、约束、设计、任务和验收标准写成可执行规范，
再让人或 AI Agent 按规范实现，
最后用测试和审查证明实现符合规范。
```

核心不是"多写文档"，而是让 Agent 拿到结构化上下文，而不是一句随意 prompt。

## 没有 SDD 时 Agent 怎么写代码

给 Agent 一句"实现用户登录"，它大概会这样干：

```text
1. 建一个 User 实体类，字段自己猜：id, phone, password, username。
2. 写个 LoginController，一个 POST 接口。
3. 密码直接 MD5 或明文比对。
4. 生成一个 UUID 当 token，存内存或直接不存。
5. 没有失败次数限制。
6. 没有错误码，统一返回 500。
7. 没有验收标准，"能跑"就算完成。
```

问题出在哪？不是 Agent 能力不够，而是输入不够。它不知道：

- 密码该用什么加密算法。
- token 用 JWT 还是 UUID，有效期多久，怎么吊销。
- 失败 3 次要不要锁定。
- 错误码怎么设计。
- 什么算"完成"。

SDD 的做法是在写代码之前，把这些全部写成 Spec，Agent 拿到 Spec 后按规范实现，而不是猜。

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

每一步有明确的输入和输出，不是走形式。

### 1. Spec：写需求和行为

Spec 阶段只管"做什么"，不管"怎么做"。

重点写清：

- 用户目标。
- 使用场景。
- 功能范围。
- 非目标（暂不实现什么）。
- 业务规则。
- 边界情况。
- 验收标准。

一个反例：

```text
实现用户登录功能。
```

这不叫 spec。Agent 看到这句只会自由发挥。

至少要写到这种程度：

```text
功能：用户登录

登录方式：手机号 + 密码
密码规则：至少 8 位，包含字母和数字
token 有效期：2 小时
刷新机制：token 过期前 30 分钟可刷新
失败限制：同一手机号 5 分钟内失败 3 次，锁定 15 分钟
错误码：
  40001 手机号格式错误
  40002 密码错误
  40003 账号锁定
  40004 账号不存在

验收标准：
  - 正确手机号 + 正确密码 -> 返回 token
  - 错误密码 -> 返回 40002
  - 连续 3 次错误 -> 返回 40003
  - 不存在的手机号 -> 返回 40004
  - token 过期后请求 -> 返回 401
```

### 2. Plan：写技术方案

Spec 回答"做什么"，Plan 回答"怎么做"。

Plan 的作用是让 Agent 在写代码之前就知道：代码放哪个目录、数据怎么流、表长什么样、接口怎么定义、哪些东西要先建好。不是写设计文档，而是写工程输入。

以上面"用户登录"的 Spec 为例，一份 Plan 大概长这样：

```text
技术栈：Spring Boot 3 + MyBatis-Plus + MySQL + Redis

目录结构：
  controller/
    AuthController.java          # 登录、刷新 token、登出
  service/
    LoginService.java            # 登录业务逻辑、失败计数、锁定判断
    TokenService.java            # token 生成、校验、刷新
  mapper/
    UserMapper.java              # 用户表读写
  entity/
    User.java                    # 用户实体
  dto/
    LoginRequest.java            # 登录请求
    LoginResponse.java           # 登录响应（token、过期时间）
  config/
    SecurityConfig.java          # JWT 过滤器、白名单路径
    RedisConfig.java             # RedisTemplate 序列化配置

数据流：
  请求 -> AuthController -> LoginService -> UserMapper -> MySQL
                                            -> Redis（失败计数、token 缓存）
  响应 <- LoginResponse <- LoginService <- TokenService

表结构：
  t_user
    id            bigint       主键
    phone         varchar(11)  唯一索引
    password_hash varchar(255) BCrypt 加密
    status        tinyint      0 禁用 1 正常
    fail_count    int          连续失败次数
    lock_until    datetime     锁定截止时间，null 表示未锁定
    created_at    datetime
    updated_at    datetime

Redis key 设计：
  login:fail:{phone}     失败计数  TTL 5 分钟
  login:lock:{phone}     锁定标记  TTL 15 分钟
  auth:token:{token}     token 缓存 TTL 2 小时，登出时主动删除

接口设计：
  POST /api/auth/login
    请求: { phone, password }
    响应: { token, expireAt }
    错误: 40001 / 40002 / 40003 / 40004

  POST /api/auth/refresh
    Header: Authorization: Bearer {token}
    响应: { token, expireAt }

  POST /api/auth/logout
    Header: Authorization: Bearer {token}
    响应: 204

事务边界：
  登录本身不需要事务（只读用户 + 写 Redis）。
  如果需要记录登录日志，登录日志写入放在 afterCommit。

关键决策：
  密码用 BCrypt，不用 MD5 + salt。
  token 用 JWT，但吊销靠 Redis 黑名单，不只靠过期时间。
  失败计数放 Redis，不放数据库，避免每次失败都写 MySQL。
  账号锁定判断在 LoginService 里做，不依赖数据库锁。
```

Plan 写到这种程度，Agent 就不会猜"密码用什么加密""token 存哪里""失败计数放数据库还是 Redis"。每个决策都写清楚了，Agent 只需要按方案落地。

写 Plan 时容易犯的错：

```text
只写"用 MySQL 存用户"，不写表结构。
只写"用 Redis 做缓存"，不写 key 设计和 TTL。
只写"用 JWT"，不写 token 怎么吊销。
只写"分层架构"，不写每层放什么类。
```

Agent 看到这些空洞描述，只能自己猜，猜错了就要返工。Plan 的价值就是把猜变成执行。

### 3. Tasks：拆成可执行任务

每个任务要有：

- 修改哪些文件。
- 修改原因。
- 前置依赖。
- 验证方式。
- 完成标准。

示例：

```text
Task 1: 创建用户表和索引
  文件: src/main/resources/db/migration/V1__init_user.sql
  原因: 登录依赖用户表
  依赖: 无
  验证: 启动应用，检查 flyway_schema_history
  完成: 表结构包含 id, phone, password_hash, status, fail_count, lock_until, created_at, updated_at

Task 2: 实现 LoginService
  文件: src/main/java/.../service/LoginService.java
  原因: 处理登录业务逻辑
  依赖: Task 1
  验证: 单元测试覆盖正常登录、密码错误、账号锁定、账号不存在
  完成: 所有验收标准通过
```

### 4. Implement：按任务实现

不要让 Agent 跳过 Plan 和 Tasks 直接改代码。

正确的做法是 Agent 拿到任务列表后，一个一个执行：

```text
读取 Task 1
  -> 确认前置依赖已满足
  -> 按任务描述修改文件
  -> 运行任务里写的验证方式
  -> 验证通过 -> 标记完成，进入 Task 2
  -> 验证失败 -> 修复，不跳到下一个任务
```

常见的坑：

- Agent 做完 Task 1 还没验证就跳到 Task 2，结果 Task 1 的 bug 污染了 Task 2。
- Agent 觉得 Task 3 和 Task 4 差不多，一次性全改了，但验收标准混在一起没法定位。
- Agent 中途发现 Plan 里有决策不合理，不通知就直接改方案，导致 Spec 和实现对不上。

遇到 Plan 不合理时，正确做法是停下来更新 Plan，而不是悄悄偏离方案。

### 5. Verify：验证

验收不是"代码能跑"，而是"Spec 里写的每条验收标准都通过"。

以用户登录为例，Verify 阶段要做的事：

```text
单元测试：
  LoginService 的测试是否覆盖了 Spec 里所有验收标准？
  - 正确手机号 + 正确密码 -> 返回 token     ✓
  - 错误密码 -> 返回 40002                  ✓
  - 连续 3 次错误 -> 返回 40003              ✓
  - 不存在的手机号 -> 返回 40004            ✓
  - token 过期后请求 -> 返回 401             ✓

构建：mvn clean package 是否成功？

lint：是否有未使用的 import、命名规范是否通过？

迁移：flyway migrate 是否正常执行？flyway_schema_history 里有没有 V1？

安全：
  - 密码是否 BCrypt 加密，不是明文？
  - token 是否不包含敏感信息？
  - 登录日志是否不记录密码？

手工验收：
  用 Postman 调一次登录接口，确认返回的 token 能用于后续接口。
```

任何一条不过，就回到 Implement 修复，不能跳到 Review。

### 6. Review：检查实现是否符合 Spec

Review 不是只看代码风格，而是拿 Spec 逐条比对实现。

具体做法：

```text
1. 拿出 Spec 里的功能清单，逐条确认是否实现。
   - 用户登录          -> AuthController.login() 存在    ✓
   - token 刷新        -> AuthController.refresh() 存在  ✓
   - 登出              -> AuthController.logout() 存在   ✓

2. 拿出 Spec 里的非目标，确认没偷偷实现。
   - 不做第三方登录    -> 代码里没有 OAuth 相关代码      ✓
   - 不做短信验证码    -> 代码里没有 SMS 相关代码        ✓

3. 拿出 Spec 里的异常场景，确认都有处理。
   - 手机号格式错误    -> 参数校验拦截                   ✓
   - 密码错误          -> 返回 40002                     ✓
   - 账号锁定          -> 返回 40003                     ✓
   - 账号不存在        -> 返回 40004                     ✓

4. 拿出 Spec 里的验收标准，确认全部通过。
   - 5 条验收标准对应的 5 个测试用例是否全绿？

5. 检查是否有 Spec 没提到但代码里出现的东西。
   - 多了一个 /api/auth/sms-code 接口？
     Spec 里说不做短信验证码，这个接口不该存在。
```

Review 发现的问题如果是实现偏离 Spec，就回到 Implement 修。如果是 Spec 本身漏了，就先更新 Spec 再修实现。

## Spec-kit 是什么

Spec Kit 是 GitHub 开源的 SDD 工具包。

它提供的不是"帮你写需求"的能力，而是把 AI 编程流程固定下来：

```text
先写 spec
再写 plan
再拆 tasks
最后实现
```

具体提供：

- SDD 工作流模板。
- `Spec -> Plan -> Tasks -> Implement` 阶段化流程。
- Markdown 规范产物。
- 不同 AI coding agent 的集成。
- 命令行工具和项目脚手架。

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

OpenSpec 是另一种 SDD 工具思路。

它强调的不是"一个功能走一轮流水线"，而是把系统能力和设计意图维护成一个持续演进的规范：

```text
Spec 是系统的活文档。
实现要跟 Spec 对齐。
变更要先更新 Spec。
```

举个例子，用 OpenSpec 管理一个电商系统时，规范里会维护：

```text
当前系统能力：
  - 用户注册、登录、登出
  - 商品列表、详情
  - 下单、支付、取消
  - 不支持退款

功能边界：
  - 库存扣减在订单创建时锁定，不实时扣减
  - 支付走第三方网关，不做自建支付
  - 不支持多仓发货

设计约束：
  - 所有写操作必须有幂等 key
  - 所有金额字段用 DECIMAL，不用 float
  - 所有对外接口必须带版本号

变更提案：
  要加退款功能时，先在 OpenSpec 里提变更提案：
  - 退款影响哪些模块？
  - 需要新增哪些表？
  - 和现有订单状态机怎么衔接？
  - 验收标准是什么？
  提案通过后，再用 Spec Kit 走一轮功能开发流程。
```

这样无论换多少个 Agent 或开发者，系统当前的能力边界都是清楚的，不会出现"新来的人不知道系统不支持退款就写了退款"的情况。

## Spec Kit 和 OpenSpec 怎么选

| 维度 | Spec Kit | OpenSpec |
| --- | --- | --- |
| 重点 | 功能从想法到实现的阶段化流程 | 系统规范作为长期事实源 |
| 产物 | spec、plan、tasks、implementation artifacts | living spec、变更提案、系统约束 |
| 使用方式 | 每个 feature 走一轮 SDD | 围绕系统规范持续演进 |
| 更适合 | 新功能开发、AI coding 流水线 | 长期维护、能力边界、架构一致性 |
| 风险 | spec 变成流程模板，实际没人审 | living spec 过大、维护成本高 |

两者可以组合：

```text
OpenSpec 保存系统当前事实。
Spec Kit 为每个新功能生成 spec / plan / tasks。
实现后再把系统事实回写到 OpenSpec。
```

## SDD 不是瀑布

SDD 容易被误解成瀑布模型。区别在于：

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

重点不是文档厚，而是每一步有明确输入输出。

## SDD 在 AI Agent 中的价值

AI Agent 写代码时容易出现这些问题：

- 自己扩需求（Spec 没说不做，Agent 就做了）。
- 漏异常处理。
- 漏权限检查。
- 改了无关文件。
- 忘记验收。
- 写出看似合理但不符合业务的代码。

SDD 通过 Spec 约束：

```text
需求范围       -> 功能清单 + 非目标
技术栈         -> 明确框架和版本
目录结构       -> 代码放哪里
接口契约       -> 请求响应格式
数据模型       -> 表结构、字段、约束
安全边界       -> 权限、认证、敏感数据
验收标准       -> 每条可测试
禁止事项       -> 不能碰什么
```

对 Agent 来说，Spec 是上下文，不是摆设。

## 一份 Spec 应该包含什么

以"用户登录"为例，逐条展开：

```text
1. 背景和目标
   为什么做这个功能？解决什么问题？
   例：系统需要用户登录后才能下单、查看订单。当前没有登录功能。

2. 用户角色
   谁使用？有没有权限区分？
   例：普通用户（手机号登录）、管理员（后台登录，暂不实现）。

3. 使用场景
   在什么情况下用？
   例：用户打开 App -> 输入手机号和密码 -> 登录成功进入首页。

4. 必须实现
   哪些功能要做？
   例：手机号 + 密码登录、token 刷新、登出。

5. 暂不实现
   哪些功能明确不做？
   例：第三方登录、短信验证码、找回密码、多设备登录互踢。

6. 业务规则
   有哪些约束和逻辑？
   例：密码至少 8 位、失败 3 次锁定 15 分钟、token 有效期 2 小时。

7. 数据模型
   需要哪些表和字段？
   例：t_user（id, phone, password_hash, status, fail_count, lock_until...）

8. 接口契约
   有哪些 API？请求响应格式是什么？
   例：POST /api/auth/login，请求 { phone, password }，响应 { token, expireAt }

9. 权限规则
   哪些接口需要登录？哪些角色能访问？
   例：/api/auth/login 和 /api/auth/refresh 不需要登录，/api/auth/logout 需要登录。

10. 异常场景
    出错了怎么办？
    例：手机号格式错误返回 40001、密码错误返回 40002、账号锁定返回 40003。

11. 非功能要求
    性能、安全、可用性有什么要求？
    例：登录接口响应 < 200ms、密码 BCrypt 加密、登录日志不记录密码。

12. 验收标准
    怎么判断完成？每条要可测试。
    例：正确手机号 + 正确密码 -> 返回 token。

13. 测试策略
    用什么方式测？
    例：LoginService 单元测试覆盖所有验收标准，AuthController 集成测试覆盖完整 HTTP 链路。

14. 风险和未知点
    有什么不确定的？
    例：高并发下 Redis 失败计数是否会有竞态？需要在实现时验证。
```

其中验收标准的写法直接决定 Spec 质量。

不要写：

```text
系统要稳定可靠。
```

要写：

```text
创建订单失败时，订单记录和库存扣减必须同时回滚。
```

前一种无法测试。后一种可以直接写成测试用例。

## 常见失败模式

### Spec 太空

```text
实现用户登录功能。
```

这不算 spec。Agent 看到后只能猜。

至少要写清登录方式、密码规则、token 有效期、错误码、失败限制、验收用例。

### Spec 太大

一个 spec 覆盖整个系统，Agent 很难执行。

应该按 feature 或能力拆。一个 spec 对应一个可独立验收的功能单元。

### Spec 不更新

实现变了，spec 不变。下次 Agent 读到旧 spec，会按旧事实行动。

Spec 是活文档，不是一次性产物。

### 没有验收

没有验收标准，Agent 只会"看起来完成"。

验收标准是 Spec 和实现之间的契约，缺了它就无法判断完成。

### 没有限制非目标

不写"暂不实现"，Agent 可能自己扩展需求。

非目标和功能清单一样重要。

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
