---
title: JWT 鉴权设计笔记
sidebarTitle: JWT 鉴权
---

# JWT 鉴权设计笔记

> JWT 不是“登录后发个字符串”这么简单，重点是签发、校验、续期、吊销、权限变更。

## 先给结论

一套后端 JWT 鉴权至少要有：

- 登录接口：校验账号密码，签发 `accessToken` 和 `refreshToken`。
- 鉴权过滤器：解析 `Authorization: Bearer xxx`，写入 `SecurityContext`。
- 刷新接口：用 refresh token 换新的 access token。
- 退出接口：吊销 refresh token，必要时拉黑 access token。
- 密钥管理：不要把签名密钥硬编码在代码里。
- 权限版本：改密码、禁用账号、改角色后让旧 token 失效。

JWT 能减少每次查 session，但不等于永远不用查 Redis / DB。

## JWT 长什么样

一个 JWT 是三段用 `.` 连接的字符串：`header.payload.signature`。

```text
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9   header
.eyJzdWIiOiIxMDAwMSIsImV4cCI6MTcxNzIwMDkwMH0   payload
.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c   signature
```

- **header**：声明签名算法，如 `{"alg":"HS256","typ":"JWT"}`。
- **payload**：放 claims（`sub`、`exp` 等业务和标准字段）。
- **signature**：对前两段做签名，`HMACSHA256(base64Url(header) + "." + base64Url(payload), secret)`。

关键认知：**header 和 payload 只是 Base64URL 编码，不是加密**，任何人都能解码看到内容。签名只保证“没被篡改”，不保证“看不见”。所以：

- 不要往 payload 放敏感信息（密码、身份证、银行卡）。
- 服务端校验的核心是验签——内容被改了，签名就对不上。

## 登录链路

```text
1. POST /auth/login
2. 校验用户名和密码
3. 查询用户状态、角色、权限版本
4. 生成 access token，短有效期
5. 生成 refresh token，长有效期，落库或落 Redis
6. 返回 token pair
```

返回示例：

```json
{
  "accessToken": "eyJhbGciOi...",
  "accessTokenExpiresIn": 900,
  "refreshToken": "f7c3d6...",
  "refreshTokenExpiresIn": 1209600,
  "tokenType": "Bearer"
}
```

建议有效期：

- `accessToken`：10～30 分钟。
- `refreshToken`：7～30 天。
- 管理后台比普通用户更短。
- 高风险操作可以要求重新登录或二次验证。

## 请求鉴权链路

```text
1. 前端带 Authorization: Bearer <accessToken>
2. 过滤器提取 token
3. 校验签名、过期时间、issuer、audience、tokenType
4. 读取 userId、tenantId、rolesVersion、jti
5. 必要时查用户状态 / token 版本 / 黑名单
6. 构造 Authentication
7. 放入 SecurityContextHolder
8. 进入 Controller
```

失败时：

- token 缺失：走匿名或返回 `401`。
- token 过期：返回 `401 TOKEN_EXPIRED`。
- token 签名错误：返回 `401 TOKEN_INVALID`。
- 权限不足：返回 `403 FORBIDDEN`。

## claims 放什么

推荐：

```json
{
  "iss": "mall-auth",
  "aud": "mall-api",
  "sub": "10001",
  "typ": "access",
  "jti": "01HX...",
  "tenantId": "t_001",
  "rolesVersion": 3,
  "iat": 1717200000,
  "exp": 1717200900
}
```

字段含义：

| 字段 | 用法 |
| --- | --- |
| `iss` | 签发方，防止拿别的系统 token 混用 |
| `aud` | 接收方，防止 token 被别的服务误收 |
| `sub` | 用户 ID |
| `typ` | `access` 或 `refresh` |
| `jti` | token 唯一 ID，做黑名单或审计 |
| `tenantId` | 租户隔离 |
| `rolesVersion` | 权限版本，用于权限变更后失效旧 token |
| `iat` | 签发时间 |
| `exp` | 过期时间 |

不要放：

- 密码。
- 手机号、身份证、银行卡。
- 超大的权限列表。
- 用户完整资料。
- 会频繁变化的数据。

JWT payload 只是 Base64URL 编码，不是加密。

## access token 和 refresh token 分工

### access token

特点：

- 每次访问接口携带。
- 有效期短。
- 可以不落库。
- 主要用于鉴权和解析用户身份。

适合放：

- `userId`。
- `tenantId`。
- `rolesVersion`。
- 少量角色标识。

### refresh token

特点：

- 只在刷新 token 时使用。
- 有效期长。
- 必须服务端可控。
- 建议落库或 Redis。

建议只存 hash：

```text
refresh_token_hash = sha256(raw_refresh_token + server_salt)
```

表结构示例：

```sql
create table auth_refresh_token (
    id bigint primary key,
    user_id bigint not null,
    token_hash varchar(128) not null,
    device_id varchar(64),
    expires_at datetime not null,
    revoked_at datetime null,
    created_at datetime not null,
    unique key uk_token_hash(token_hash),
    key idx_user_id(user_id)
);
```

## 刷新链路

```text
1. POST /auth/refresh
2. 校验 refresh token 是否存在
3. 校验是否过期、是否吊销、用户是否可用
4. 吊销旧 refresh token
5. 生成新的 access token
6. 生成新的 refresh token
7. 返回新的 token pair
```

推荐 refresh token 轮换：

```java
@Transactional(rollbackFor = Exception.class)
public TokenPair refresh(String rawRefreshToken) {
    RefreshToken token = refreshTokenRepository.getValid(rawRefreshToken);
    User user = userRepository.getActiveUser(token.userId());

    refreshTokenRepository.revoke(token.id());

    String accessToken = jwtTokenService.createAccessToken(user);
    String refreshToken = refreshTokenService.createAndSave(user.id(), token.deviceId());

    return new TokenPair(accessToken, refreshToken);
}
```

如果旧 refresh token 被重复使用，可能是泄漏，建议吊销该设备所有 refresh token。

## 退出登录

退出不是只让前端删 token。

标准动作：

```text
1. 删除前端本地 token
2. 服务端吊销 refresh token
3. access token 剩余时间很短，可以自然过期
4. 高安全场景，把 access token 的 jti 加入黑名单直到 exp
```

黑名单 key：

```text
jwt:blacklist:{jti} -> 1
ttl = access token 剩余秒数
```

如果用户改密码、账号禁用、角色变化：

- 提升 `rolesVersion` / `tokenVersion`。
- 鉴权时比较 token 里的版本和用户当前版本。
- 不一致直接 `401`。

## Spring Security 配置

依赖：

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-security</artifactId>
</dependency>
```

过滤器配置：

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http,
                                                   JwtAuthenticationFilter jwtAuthenticationFilter)
            throws Exception {
        return http
            .csrf(AbstractHttpConfigurer::disable)
            .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/auth/login", "/auth/refresh").permitAll()
                .requestMatchers("/actuator/health").permitAll()
                .anyRequest().authenticated()
            )
            .addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class)
            .build();
    }
}
```

注意：

- 前后端分离 API 一般用无状态 session：`STATELESS`。
- 只把登录、刷新、健康检查放开。
- 如果是浏览器 Cookie 鉴权，不要随便关 CSRF。

## JWT 过滤器

```java
@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final JwtTokenService jwtTokenService;

    public JwtAuthenticationFilter(JwtTokenService jwtTokenService) {
        this.jwtTokenService = jwtTokenService;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain)
            throws ServletException, IOException {
        String token = resolveBearerToken(request);
        if (!StringUtils.hasText(token)) {
            filterChain.doFilter(request, response);
            return;
        }

        try {
            LoginUser loginUser = jwtTokenService.parseAccessToken(token);
            UsernamePasswordAuthenticationToken authentication =
                new UsernamePasswordAuthenticationToken(
                    loginUser,
                    null,
                    loginUser.authorities()
                );
            authentication.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));
            SecurityContextHolder.getContext().setAuthentication(authentication);
            filterChain.doFilter(request, response);
        } catch (JwtAuthException exception) {
            SecurityContextHolder.clearContext();
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.getWriter().write("{\"code\":\"TOKEN_INVALID\",\"message\":\"登录已失效\"}");
        }
    }

    private String resolveBearerToken(HttpServletRequest request) {
        String authorization = request.getHeader(HttpHeaders.AUTHORIZATION);
        if (!StringUtils.hasText(authorization) || !authorization.startsWith("Bearer ")) {
            return null;
        }
        return authorization.substring(7);
    }
}
```

过滤器只做鉴权，不做业务：

- 不创建用户。
- 不刷新 token。
- 不查复杂权限树。
- 不写业务日志流水。

## JwtTokenService 分层

接口：

```java
public interface JwtTokenService {

    String createAccessToken(User user);

    LoginUser parseAccessToken(String token);
}
```

解析时至少校验：

```text
签名
exp
iss
aud
typ == access
jti 是否黑名单
user 是否存在且启用
rolesVersion 是否一致
```

伪代码：

```java
public LoginUser parseAccessToken(String token) {
    JwtClaims claims = jwtSigner.verify(token);

    if (!"access".equals(claims.tokenType())) {
        throw new JwtAuthException("token type invalid");
    }

    if (blacklistService.contains(claims.jti())) {
        throw new JwtAuthException("token revoked");
    }

    User user = userRepository.getActiveUser(claims.userId());
    if (!Objects.equals(user.rolesVersion(), claims.rolesVersion())) {
        throw new JwtAuthException("permission changed");
    }

    return LoginUser.from(user, claims);
}
```

如果每次都查 DB，JWT 的性能收益会降低；可以折中：

- 用户状态 / 权限版本放 Redis。
- 黑名单只存剩余有效期。
- access token 有效期缩短，减少强校验频率。

## 权限怎么接

`LoginUser`：

```java
public record LoginUser(
    Long userId,
    String tenantId,
    List<String> permissions
) {

    public Collection<? extends GrantedAuthority> authorities() {
        return permissions.stream()
            .map(SimpleGrantedAuthority::new)
            .toList();
    }
}
```

接口权限：

```java
@PreAuthorize("hasAuthority('user:create')")
@PostMapping("/users")
public ApiResult<Long> create(@Valid @RequestBody CreateUserRequest request) {
    return ApiResult.ok(userService.createUser(request.toCommand()));
}
```

数据权限仍然要在 Service 校验：

```java
if (!Objects.equals(order.getTenantId(), loginUser.tenantId())) {
    throw new BizException(ErrorCode.COMMON_FORBIDDEN);
}
```

方法权限只解决“能不能进这个接口”，不自动解决“能不能操作这条数据”。

## token 放哪里

### 前后端分离

常见：

```text
Authorization: Bearer <accessToken>
```

refresh token 更推荐：

- HttpOnly Cookie。
- Secure。
- SameSite 合理配置。
- 或移动端安全存储。

如果 access token 存 `localStorage`，要意识到 XSS 风险。

### 浏览器后台系统

可以考虑：

- access token 放内存。
- refresh token 放 HttpOnly Cookie。
- 刷新页面后用 refresh token 换 access token。
- 配合 CSRF 防护。

### App / 小程序

放系统安全存储，不要明文日志打印。

## 签名算法

### HS256

对称密钥：

- 签发和校验用同一个密钥。
- 单体项目简单。
- 多服务共享密钥时泄漏风险更高。

适合：

- 单应用。
- 内部系统。
- 服务数量少。

### RS256

非对称密钥：

- 私钥签发。
- 公钥校验。
- 多个资源服务只需要公钥。

适合：

- 微服务。
- 认证中心独立。
- 多系统共享登录态。

生产建议：

- 密钥从配置中心 / KMS / 环境变量加载。
- 支持密钥轮换。
- 不把密钥提交到 Git。

### 一定要固定校验算法

JWT 的 `header.alg` 是 token 自己带的，**绝不能信它来决定怎么验签**，否则有两类经典攻击：

- **`alg: none` 攻击**：攻击者把 alg 改成 `none`、去掉签名，如果库默认接受 none，就等于不验签直接放行。
- **算法混淆（RS256 → HS256）**：服务端用 RS256，公钥是公开的。攻击者把 alg 改成 HS256，用你的**公钥当对称密钥**去签名。如果服务端按 token 里的 alg 选验签方式，就会用公钥去做 HMAC 校验，攻击成功。

所以校验时必须在服务端**写死预期算法**，不接受 token 指定的算法：

```java
// 只接受 HS256，拒绝其它（包括 none）
Jwts.parser()
    .verifyWith(secretKey)
    .sig().add(Jwts.SIG.HS256).and()   // 固定算法
    .build()
    .parseSignedClaims(token);
```

## 什么时候用内置 Resource Server

如果系统是“认证中心签发 JWT，业务服务只校验 Bearer Token”，优先考虑 Spring Security OAuth2 Resource Server：

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-oauth2-resource-server</artifactId>
</dependency>
```

配置：

```java
@Bean
SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
    return http
        .authorizeHttpRequests(auth -> auth
            .requestMatchers("/actuator/health").permitAll()
            .anyRequest().authenticated()
        )
        .oauth2ResourceServer(oauth2 -> oauth2.jwt(Customizer.withDefaults()))
        .build();
}
```

这时一般不自己写 `JwtAuthenticationFilter`，而是配置 `JwtDecoder`、`JwtAuthenticationConverter`。

## 常见坑

### access token 有效期太长

一旦泄漏，很久都有效。后台系统尤其不要搞几天有效期。

### 只校验签名

还要校验：

- `exp`。
- `iss`。
- `aud`。
- `typ`。
- `jti`。
- 用户状态。
- 权限版本。

### 权限列表塞太大

权限变更后旧 token 不会自动变，token 也会变大。更稳的是放 `rolesVersion`，权限从缓存读取。

### 退出只删前端 token

refresh token 必须服务端吊销；access token 需要看安全等级决定是否黑名单。

### refresh token 不轮换

长期不变的 refresh token 泄漏后风险很高。刷新时建议旧的作废，新的继续用。

### 在日志里打印 token

请求日志、异常日志、网关日志都要脱敏：

```text
Authorization: Bearer eyJ...<masked>
```

### 按 token 里的 alg 验签

`alg: none`、RS256→HS256 算法混淆都源于此。服务端必须固定预期算法，不能信 token 自带的 alg（见上文“一定要固定校验算法”）。

## 检查清单

- [ ] 知道 JWT 是 header.payload.signature 三段，payload 只是编码不是加密。
- [ ] access token 有效期短。
- [ ] refresh token 服务端可吊销。
- [ ] refresh token 存 hash，不存明文。
- [ ] claims 校验了 `iss`、`aud`、`typ`、`exp`。
- [ ] 验签固定预期算法，不接受 token 自带的 alg（防 none / 算法混淆）。
- [ ] 改密码、禁用账号、改角色能让旧 token 失效。
- [ ] 过滤器成功时写入 `SecurityContext`，失败时清理上下文。
- [ ] 登录、刷新、退出接口边界清楚。
- [ ] token 没有打印到日志。
- [ ] 密钥没有提交到 Git。
- [ ] 数据权限在 Service 再校验一次。

## 参考

- [Spring Security Servlet Architecture](https://docs.enterprise.spring.io/spring-security/reference/6.2/servlet/architecture.html)
- [Spring Security OAuth2 Resource Server](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/index.html)
