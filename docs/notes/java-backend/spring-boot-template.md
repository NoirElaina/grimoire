# Spring Boot 项目模板

这页作为你未来记录 Java 后端项目骨架的起始模板。

## 项目定位

- 项目名称：
- 业务目标：
- 技术栈：
- JDK 版本：
- 框架版本：

## 推荐目录

```text
src/main/java/com/example/app
├─ controller
├─ service
├─ service/impl
├─ repository
├─ model
├─ dto
├─ config
├─ common
└─ exception
```

## 常用依赖

- `spring-boot-starter-web`
- `spring-boot-starter-validation`
- `spring-boot-starter-actuator`
- `spring-boot-starter-aop`
- `lombok`
- 数据库驱动
- ORM 或 SQL 框架

## 分层约定

- `controller`：接请求、做参数校验、返回统一结果
- `service`：放业务逻辑
- `repository / mapper`：访问数据库
- `dto`：请求响应对象
- `common`：通用返回、枚举、工具类

## 配置项

- 数据库连接
- 日志级别
- 环境区分
- 线程池配置
- 缓存配置

## 统一返回示例

```json
{
  "code": 0,
  "message": "success",
  "data": {}
}
```

## 初始化检查清单

- 是否有统一异常处理
- 是否有参数校验
- 是否有日志 traceId
- 是否有健康检查
- 是否有开发/测试/生产环境区分
