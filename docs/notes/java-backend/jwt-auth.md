---
title: JWT 鉴权设计笔记
sidebarTitle: JWT 鉴权
---

# JWT 鉴权设计笔记

JWT 不是“登录功能”，它只是**登录成功后携带身份的一种令牌格式**。  
真正要设计的是整套鉴权链路：

- 用户怎么登录
- 服务端怎么签发 token
- 下游接口怎么校验 token
- token 过期后怎么续签
- 用户登出、封禁、改密后怎么让旧 token 失效

如果这些没想清楚，只是“返回一个 JWT 字符串”，系统后面一定会越来越乱。

## 先说结论

在普通 Java 后端项目里，JWT 最稳的落地方式通常是：

1. `access token` 短期有效，比如 `30min - 2h`
2. `refresh token` 更长，比如 `7d - 30d`
3. `access token` 只放身份和鉴权必要信息，不放敏感业务数据
4. 接口层无状态校验 `access token`
5. `refresh token` 走单独续签接口，并保存在服务端可控存储里
6. 需要“强制失效”能力时，不要迷信纯无状态 JWT，要配合 Redis / DB 做版本或黑名单

也就是说，**生产里真正稳定的 JWT 方案，通常不是纯无状态。**

## JWT 到底是什么

JWT 全称 `JSON Web Token`，本质上是三段字符串：

```text
header.payload.signature
```

### `header`

声明令牌类型和签名算法，例如：

```json
{
  "alg": "HS256",
  "typ": "JWT"
}
```

### `payload`

放业务声明，也就是 claims，例如：

```json
{
  "sub": "10001",
  "username": "alice",
  "roles": ["ADMIN"],
  "iat": 1715400000,
  "exp": 1715403600,
  "jti": "8f8c0f2d-..."
}
```

### `signature`

服务端用密钥或私钥对前两段签名，防止内容被篡改。

这里一定要记住一件事：

**JWT 默认只是防篡改，不是防查看。**  
payload 经过 Base64URL 编码，不是加密。拿到 token 的人可以直接解开看内容。

## 常见标准字段

JWT 里最常用的 claims 有这些：

- `sub`
  主体，一般放用户 ID 或登录主体 ID
- `iat`
  签发时间
- `exp`
  过期时间
- `nbf`
  生效时间，早于这个时间不能用
- `iss`
  签发者
- `aud`
  接收方
- `jti`
  token 唯一 ID，适合做撤销、审计、幂等关联

项目里最推荐保留的是：

- `sub`
- `iat`
- `exp`
- `jti`

其余像 `username`、`roles`、`tenantId`，按业务需要再放。

## payload 里到底该放什么

这块是很多项目的第一个坑。

JWT payload 适合放：

- 用户主键 `userId`
- 账号标识 `username`
- 当前租户 `tenantId`
- 简短角色集合 `roles`
- 权限版本号 `tokenVersion`

不适合放：

- 手机号、邮箱、身份证号
- 太长的权限列表
- 会频繁变动的用户资料
- 敏感配置
- 大块业务对象

原因很简单：

1. JWT 会跟着每次请求走，太大浪费带宽。
2. JWT 默认可读，不该放敏感字段。
3. 放太多动态字段，会让 token 很快过时。

经验上，payload 越小越稳。

## 为什么很多人用了 JWT 还是要查 Redis / DB

因为 JWT 只解决了“服务端能不能验证这串 token 是我签的”，没有天然解决下面这些问题：

- 用户主动退出后，旧 token 怎么失效
- 管理员封号后，旧 token 怎么立刻失效
- 用户改密码后，旧 token 怎么立刻失效
- 某台设备踢下线后，旧 token 怎么失效

如果你完全纯无状态，就只能等 `exp` 到期。  
所以生产里常见的做法是配一层“服务端可控状态”。

## 三种常见 JWT 失效方案

### 1. 黑名单

把要失效的 `jti` 放进 Redis，接口校验通过后再查一遍是否在黑名单里。

优点：

- 容易理解
- 适合少量强制踢下线场景

缺点：

- 重新引入状态
- 需要处理黑名单过期和清理

### 2. 用户级版本号

用户表里维护 `token_version`。签发 token 时把版本写入 JWT，校验时对比当前用户版本。

优点：

- 适合“改密码后让所有旧 token 一次失效”
- 不需要存每个 token

缺点：

- 每次请求通常需要查缓存或数据库
- 只能做用户级失效，不能精确到单 token

### 3. refresh token 持久化

`access token` 短效无状态，`refresh token` 记录在 Redis / DB 里，支持续签、撤销、设备管理。

优点：

- 兼顾性能和可控性
- 最适合 App / Web 长登录场景

缺点：

- 实现复杂度更高

如果让我在业务系统里选，我通常优先推荐第 3 种。

## 典型登录链路

一个比较稳的链路一般长这样：

### 1. 登录

- 用户提交账号密码
- 服务端校验密码
- 生成 `access token`
- 生成 `refresh token`
- 把 `refresh token` 存 Redis / DB
- 返回给前端

### 2. 访问接口

- 前端带 `Authorization: Bearer <access_token>`
- 网关或应用过滤器解析 JWT
- 校验签名、过期时间、必要 claims
- 构造登录态放入上下文
- 业务接口继续执行

### 3. access token 过期

- 前端调用刷新接口
- 服务端校验 `refresh token`
- 校验通过后重新签发新的 `access token`
- 必要时轮换 `refresh token`

### 4. 退出登录

- 删除服务端存储的 `refresh token`
- 如果要立即让当前 `access token` 失效，再写黑名单或提升版本号

## access token 和 refresh token 怎么分工

最稳的思路是把职责拆开：

### access token

- 生命周期短
- 每次请求都带
- 用来给接口鉴权
- 尽量无状态

### refresh token

- 生命周期长
- 只在续签时使用
- 必须更强可控
- 最好存服务端

不要让 refresh token 也像 access token 一样到处传。  
refresh token 的暴露面越小越好。

## 签名算法怎么选

Java 里常见的是：

- `HS256`
- `RS256`

### `HS256`

同一个密钥负责签名和验签。

优点：

- 简单
- 性能好

缺点：

- 一旦密钥泄露，签发和校验都失守
- 不适合很多服务共享验签但不该共享签发能力的场景

### `RS256`

私钥签名，公钥验签。

优点：

- 更适合多服务、网关、第三方验签
- 私钥只留在认证中心

缺点：

- 配置和密钥管理更复杂

如果只是单体或小型内部服务，`HS256` 足够。  
如果是微服务、网关统一验签、后面可能接外部系统，优先考虑 `RS256`。

## Spring Boot 里 JWT 鉴权的推荐分层

一个清晰的实现通常分这几层：

### `JwtProperties`

管理配置：

- `secret` / `privateKey` / `publicKey`
- `accessExpireSeconds`
- `refreshExpireSeconds`
- `issuer`

### `JwtTokenService`

负责：

- 生成 access token
- 生成 refresh token
- 解析 token
- 校验签名和过期

### `LoginService`

负责：

- 密码校验
- 登录成功后的 token 签发
- refresh token 存储
- 登出和续签

### `JwtAuthenticationFilter`

负责：

- 从请求头拿 token
- 调 `JwtTokenService` 校验
- 构造认证对象塞进 `SecurityContext`

### `SecurityConfig`

负责：

- 放行登录、刷新接口
- 其余接口默认鉴权
- 关闭 session 或明确 session 策略

## 一个更稳的 claims 设计

后端项目里比较实用的一版可以长这样：

```json
{
  "sub": "10001",
  "username": "alice",
  "tenantId": "t01",
  "roles": ["ADMIN"],
  "tokenType": "access",
  "tokenVersion": 3,
  "jti": "2f4f9d5d-8b2e-4db0-b4b8-2ec3f4c2d4ab",
  "iat": 1715400000,
  "exp": 1715403600,
  "iss": "grimoire-auth"
}
```

这里几个字段特别实用：

- `tokenType`
  避免把 refresh token 拿去访问业务接口
- `tokenVersion`
  方便改密码、封禁后整体失效
- `jti`
  方便审计、黑名单、问题追踪

## 过滤器里要做什么，不要做什么

JWT 过滤器适合做：

- 读取请求头
- 判断是否存在 Bearer token
- 解析和校验 token
- 提取 claims
- 构造当前认证用户

JWT 过滤器不适合做：

- 登录逻辑
- 刷新 token
- 太重的数据库查询
- 太复杂的权限拼装

过滤器应该尽量薄，不然链路会越来越难排查。

## 常见坑

### 1. 把用户完整权限列表塞进 JWT

后果是：

- token 很大
- 权限一改，旧 token 全过时
- 后面很难演进

更好的做法是只放角色或权限版本号。

### 2. access token 过期时间设太长

很多系统一上来就给 `7d`、`30d`。

这会让：

- 泄露窗口变大
- 封禁和踢下线变难

更合理的是：

- access token 短
- refresh token 长

### 3. 只校验签名，不校验 tokenType / issuer / audience

至少要校验：

- 签名
- `exp`
- `tokenType`
- `iss`

跨系统或网关复杂场景，再考虑 `aud`。

### 4. 登出时只让前端删本地 token

这不是真正的登出。  
真正的登出至少应该让服务端掌握续签能力的那一层失效，也就是 refresh token 失效。

### 5. 改密码后旧 token 还能一直用

这是经典安全漏洞。  
最简单的补法就是引入 `tokenVersion`。

## Web 场景下 token 放哪

这块没有绝对答案，但可以这样记：

### 如果是前后端分离接口

常见做法：

- access token 放内存
- refresh token 放安全 cookie 或更受控存储

### 如果是浏览器业务后台

要重点考虑：

- XSS
- CSRF

如果把 token 直接长期放 `localStorage`，实现简单，但 XSS 风险更大。  
如果放 `HttpOnly Cookie`，要再认真处理 CSRF。

所以这里不是 JWT 自己的问题，而是整个前端安全模型的问题。

## 什么时候不建议用 JWT

下面这些场景，不一定适合 JWT：

- 强依赖服务端会话管理
- 频繁需要即时踢下线
- 权限变化非常频繁
- 很多内部系统其实单体部署，没必要强上无状态 token

这时候传统 session 反而可能更简单、更稳。

JWT 不是“更高级”，只是更适合某些架构形态。

## 一版比较推荐的项目实践

如果让我给一个普通 Spring Boot 业务系统定方案，我会这样选：

1. 登录成功签发 `access token + refresh token`
2. `access token` 有效期 `1h`
3. `refresh token` 有效期 `14d`
4. `access token` 放：
   - `sub`
   - `roles`
   - `tokenType`
   - `tokenVersion`
   - `jti`
5. `refresh token` 存 Redis，按用户和设备维度管理
6. 改密码、封禁、管理员踢人时，提升 `tokenVersion`
7. 关键接口再结合细粒度权限判断，不只依赖 JWT 角色

这套方案不是最轻，但对业务系统来说通常最稳。

## 最后记住一句话

**JWT 只是令牌格式，不是完整鉴权方案。**  
真正的难点从来不是“怎么生成 token”，而是：

- 怎么续签
- 怎么失效
- 怎么收权
- 怎么审计
- 怎么和 Spring Security、Redis、网关一起配合

如果这些一起设计，JWT 才会真正好用。
