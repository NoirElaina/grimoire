---
title: 用户登录鉴权案例
sidebarTitle: 登录鉴权案例
---

# 用户登录鉴权案例

> 这是一个项目案例：用注册、登录、刷新 token、退出登录串起接口设计、密码存储、JWT、Redis、拦截器和用户上下文。

## 要解决的问题

登录系统不是“用户名密码对了就返回 token”这么简单。

至少要处理：

- 密码不能明文存储。
- 登录成功后怎么签发 token。
- token 过期后怎么刷新。
- 用户退出后 token 怎么失效。
- 请求进来怎么识别当前用户。
- 登录失败次数怎么限制。
- 被封禁用户怎么拒绝访问。

## 推荐方案

学习型电商项目可以用：

```text
Access Token：JWT，短 TTL，比如 30 分钟
Refresh Token：随机字符串，长 TTL，比如 7 天，存 Redis
Redis：保存 refresh token、登录失败计数、用户 token 版本
拦截器：解析 access token，写入 UserContext
```

为什么不只用一个长期 JWT：

- 退出登录后不好立即失效。
- token 泄露后风险时间太长。
- 用户权限变化不容易及时生效。

## 表设计

用户表：

```sql
create table user_account (
    id bigint primary key auto_increment,
    username varchar(64) not null,
    mobile varchar(32) not null,
    password_hash varchar(100) not null,
    status varchar(32) not null,
    token_version int not null default 0,
    created_at datetime not null,
    updated_at datetime not null,
    unique key uk_user_account_username (username),
    unique key uk_user_account_mobile (mobile)
);
```

重点：

- `password_hash` 存哈希，不存明文。
- `status` 控制正常、禁用、注销。
- `token_version` 用于批量让旧 token 失效。
- 用户名、手机号要有唯一索引兜底。

## 注册接口

```text
POST /api/auth/register
```

请求：

```json
{
  "username": "alice",
  "mobile": "13800138000",
  "password": "Passw0rd!"
}
```

Controller：

```java
@PostMapping("/register")
public ApiResult<Long> register(@Valid @RequestBody RegisterRequest request) {
    Long userId = authService.register(request.toCommand());
    return ApiResult.success(userId);
}
```

Service：

```java
@Transactional(rollbackFor = Exception.class)
public Long register(RegisterCommand command) {
    if (userMapper.existsByUsername(command.username())) {
        throw new BizException(ErrorCode.USERNAME_EXISTS);
    }
    if (userMapper.existsByMobile(command.mobile())) {
        throw new BizException(ErrorCode.MOBILE_EXISTS);
    }

    UserAccountDO user = new UserAccountDO();
    user.setUsername(command.username());
    user.setMobile(command.mobile());
    user.setPasswordHash(passwordEncoder.encode(command.password()));
    user.setStatus(UserStatus.NORMAL.name());
    user.setTokenVersion(0);
    userMapper.insert(user);
    return user.getId();
}
```

业务校验之外，还要靠数据库唯一索引防并发重复注册。

## 登录接口

```text
POST /api/auth/login
```

请求：

```json
{
  "account": "alice",
  "password": "Passw0rd!"
}
```

返回：

```json
{
  "accessToken": "eyJhbGciOi...",
  "accessTokenExpireSeconds": 1800,
  "refreshToken": "9a0e0e6a0f...",
  "refreshTokenExpireSeconds": 604800
}
```

Service：

```java
public LoginTokenVO login(LoginCommand command) {
    checkLoginRateLimit(command.account());

    UserAccountDO user = userMapper.selectByAccount(command.account());
    if (user == null || !passwordEncoder.matches(command.password(), user.getPasswordHash())) {
        recordLoginFailure(command.account());
        throw new BizException(ErrorCode.ACCOUNT_OR_PASSWORD_ERROR);
    }

    if (!UserStatus.NORMAL.name().equals(user.getStatus())) {
        throw new BizException(ErrorCode.USER_DISABLED);
    }

    clearLoginFailure(command.account());
    return issueTokens(user);
}
```

不要告诉前端是“用户名不存在”还是“密码错误”，避免被枚举账号。

## 签发 token

Access Token 放用户 ID 和版本号：

```java
public String createAccessToken(UserAccountDO user) {
    Instant now = Instant.now();
    return jwtBuilder
        .subject(user.getId().toString())
        .claim("tokenVersion", user.getTokenVersion())
        .issuedAt(Date.from(now))
        .expiration(Date.from(now.plus(accessTokenTtl)))
        .signWith(secretKey)
        .compact();
}
```

Refresh Token 用随机字符串：

```java
private LoginTokenVO issueTokens(UserAccountDO user) {
    String accessToken = jwtTokenProvider.createAccessToken(user);
    String refreshToken = UUID.randomUUID().toString().replace("-", "");

    String refreshKey = AuthRedisKeys.refreshToken(refreshToken);
    stringRedisTemplate.opsForValue().set(
        refreshKey,
        user.getId().toString(),
        refreshTokenTtl
    );

    return new LoginTokenVO(accessToken, accessTokenTtl.toSeconds(), refreshToken, refreshTokenTtl.toSeconds());
}
```

Redis key：

```java
public final class AuthRedisKeys {

    private static final String APP = "flashmart";

    private AuthRedisKeys() {
    }

    public static String refreshToken(String refreshToken) {
        return APP + ":auth:refresh-token:" + refreshToken;
    }

    public static String loginFailure(String account) {
        return APP + ":auth:login-failure:" + account;
    }
}
```

## 请求鉴权

拦截器：

```java
public class AuthInterceptor implements HandlerInterceptor {

    private final JwtTokenProvider jwtTokenProvider;
    private final UserMapper userMapper;

    public AuthInterceptor(JwtTokenProvider jwtTokenProvider, UserMapper userMapper) {
        this.jwtTokenProvider = jwtTokenProvider;
        this.userMapper = userMapper;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        String token = resolveBearerToken(request);
        if (!StringUtils.hasText(token)) {
            throw new BizException(ErrorCode.UNAUTHORIZED);
        }

        JwtUser jwtUser = jwtTokenProvider.parse(token);
        UserAccountDO user = userMapper.selectById(jwtUser.userId());
        if (user == null || !UserStatus.NORMAL.name().equals(user.getStatus())) {
            throw new BizException(ErrorCode.UNAUTHORIZED);
        }
        if (!Objects.equals(user.getTokenVersion(), jwtUser.tokenVersion())) {
            throw new BizException(ErrorCode.UNAUTHORIZED);
        }

        UserContext.set(new CurrentUser(user.getId(), user.getUsername()));
        return true;
    }
}
```

`afterCompletion` 里清理上下文：

```java
@Override
public void afterCompletion(HttpServletRequest request,
                            HttpServletResponse response,
                            Object handler,
                            Exception ex) {
    UserContext.clear();
}
```

否则线程池复用时可能串用户。

## 刷新 token

```text
POST /api/auth/refresh
```

流程：

```text
1. 前端提交 refreshToken
2. 查 Redis
3. Redis 不存在：刷新失败，重新登录
4. 查用户状态
5. 签发新 accessToken 和 refreshToken
6. 删除旧 refreshToken
7. 写入新 refreshToken
```

代码：

```java
public LoginTokenVO refresh(String refreshToken) {
    String oldKey = AuthRedisKeys.refreshToken(refreshToken);
    String userIdText = stringRedisTemplate.opsForValue().get(oldKey);
    if (!StringUtils.hasText(userIdText)) {
        throw new BizException(ErrorCode.UNAUTHORIZED);
    }

    UserAccountDO user = userMapper.selectById(Long.valueOf(userIdText));
    if (user == null || !UserStatus.NORMAL.name().equals(user.getStatus())) {
        stringRedisTemplate.delete(oldKey);
        throw new BizException(ErrorCode.UNAUTHORIZED);
    }

    stringRedisTemplate.delete(oldKey);
    return issueTokens(user);
}
```

更严格时，可以用 Lua 保证旧 refresh token 只被刷新一次。

## 退出登录

```text
POST /api/auth/logout
```

如果前端带 refresh token：

```java
public void logout(String refreshToken) {
    if (StringUtils.hasText(refreshToken)) {
        stringRedisTemplate.delete(AuthRedisKeys.refreshToken(refreshToken));
    }
}
```

如果要让所有 access token 也立即失效：

```java
@Transactional(rollbackFor = Exception.class)
public void logoutAll(Long userId) {
    userMapper.increaseTokenVersion(userId);
}
```

因为 access token 里带了 `tokenVersion`，版本号变化后旧 token 解析成功也会被拒绝。

## 登录失败限流

Redis 记录失败次数：

```java
private void recordLoginFailure(String account) {
    String key = AuthRedisKeys.loginFailure(account);
    Long count = stringRedisTemplate.opsForValue().increment(key);
    if (count != null && count == 1) {
        stringRedisTemplate.expire(key, Duration.ofMinutes(10));
    }
}
```

检查：

```java
private void checkLoginRateLimit(String account) {
    String key = AuthRedisKeys.loginFailure(account);
    String countText = stringRedisTemplate.opsForValue().get(key);
    int count = StringUtils.hasText(countText) ? Integer.parseInt(countText) : 0;
    if (count >= 5) {
        throw new BizException(ErrorCode.LOGIN_TOO_FREQUENT);
    }
}
```

生产里可以用 Lua 保证 `INCR + EXPIRE` 原子性。

## 安全检查

- 密码必须哈希存储，不能明文。
- 登录失败不要暴露账号是否存在。
- access token TTL 不要太长。
- refresh token 要能服务端失效。
- 退出登录要删除 refresh token。
- 用户禁用后要拒绝继续访问。
- 用户上下文必须请求结束后清理。
- 密钥从配置注入，不提交 Git。
- 接口日志不要打印 token 和密码。

## 测试用例

至少测：

- 注册成功。
- 重复用户名注册失败。
- 重复手机号注册失败。
- 密码错误登录失败。
- 禁用用户登录失败。
- 登录成功返回 access token 和 refresh token。
- access token 过期后不能访问。
- refresh token 可以换新 token。
- refresh token 使用后旧值失效。
- logout 后 refresh token 失效。
- tokenVersion 增加后旧 access token 失效。

## 去空话检查

- [ ] 密码只存 hash。
- [ ] JWT 是短期 access token，不是无限期登录凭证。
- [ ] refresh token 存 Redis 并可删除。
- [ ] 拦截器写入用户上下文，并在请求结束清理。
- [ ] 用户禁用、token 版本变化能让旧 token 失效。
- [ ] 登录失败有限流。

## 关联笔记

- [JWT 鉴权设计笔记](/notes/java-backend/jwt-auth)
- [过滤器与拦截器](/notes/java-backend/filter-interceptor)
- [RedisTemplate JSON 序列化配置](/notes/redis/redis-template-json)
- [Spring MVC 请求链路](/notes/java-backend/spring-mvc-request-flow)
