---
title: Java ThreadLocal
sidebarTitle: ThreadLocal
---

# Java ThreadLocal

> `ThreadLocal` 不是把变量“变成线程安全”，而是让每个线程都有自己的一份变量副本。它常用于请求上下文、traceId、用户信息、事务上下文，但在线程池里必须及时清理。

## 它解决什么问题

普通共享变量：

```java
private static UserContext currentUser;
```

多个线程同时读写会互相覆盖。

`ThreadLocal`：

```java
private static final ThreadLocal<UserContext> CURRENT_USER = new ThreadLocal<>();
```

每个线程访问 `CURRENT_USER.get()` 时，拿到的是当前线程自己的值。

典型场景：

- 请求 traceId。
- 当前登录用户。
- 租户 ID。
- 数据源路由上下文。
- Spring 事务上下文。

## 基本用法

```java
public final class UserContextHolder {
    private static final ThreadLocal<UserContext> HOLDER = new ThreadLocal<>();

    private UserContextHolder() {
    }

    public static void set(UserContext context) {
        HOLDER.set(context);
    }

    public static UserContext get() {
        return HOLDER.get();
    }

    public static void clear() {
        HOLDER.remove();
    }
}
```

过滤器里使用：

```java
try {
    UserContextHolder.set(parseUserContext(request));
    filterChain.doFilter(request, response);
} finally {
    UserContextHolder.clear();
}
```

重点是：

```text
set 之后必须 remove。
```

## 内部结构

结构可以这样理解：

```text
Thread
  -> ThreadLocalMap threadLocals
      -> Entry[]
          -> key: ThreadLocal 弱引用
          -> value: 业务对象强引用
```

不是 `ThreadLocal` 自己持有所有线程的数据。

而是每个 `Thread` 对象内部有一个 `ThreadLocalMap`。

`ThreadLocal.get()` 大致流程：

```text
拿到当前线程 Thread.currentThread()
  -> 找当前线程的 ThreadLocalMap
  -> 用当前 ThreadLocal 对象作为 key
  -> 找到当前线程自己的 value
```

## key 弱引用，value 强引用

`ThreadLocalMap.Entry` 的 key 是弱引用。

也就是：

```text
key 指向 ThreadLocal 对象，但不阻止 ThreadLocal 被 GC。
```

value 是强引用。

这会带来经典问题：

```text
ThreadLocal 对象没有强引用了。
key 被 GC，变成 null。
但 value 还在 ThreadLocalMap 里。
如果线程一直活着，value 可能一直释放不了。
```

在线程池里，线程会复用，生命周期很长。

所以必须：

```java
try {
    THREAD_LOCAL.set(value);
    doWork();
} finally {
    THREAD_LOCAL.remove();
}
```

## 为什么在线程池里危险

普通线程执行完会结束：

```text
线程结束 -> ThreadLocalMap 跟着线程一起回收
```

线程池线程不会频繁结束：

```text
请求 A 在线程 worker-1 设置 userId=1001。
请求 A 结束但没 remove。
线程 worker-1 被复用处理请求 B。
请求 B 可能读到旧 userId。
```

这不是理论问题，是后端项目里很常见的脏上下文问题。

## ThreadLocal 不会自动跨线程

```java
UserContextHolder.set(userContext);

CompletableFuture.runAsync(() -> {
    UserContext context = UserContextHolder.get(); // 通常是 null
});
```

原因：

```text
ThreadLocal 绑定当前线程。
异步任务换了线程。
新线程没有这份上下文。
```

如果需要传递：

- 显式把参数传给异步任务。
- 使用任务包装器复制上下文。
- 使用框架提供的上下文传播能力。
- 谨慎使用 `InheritableThreadLocal`，它在线程池里也容易出问题。

最清楚的方式通常是显式传参。

## 常见项目用法

### traceId

```java
public class TraceContext {
    private static final ThreadLocal<String> TRACE_ID = new ThreadLocal<>();

    public static void set(String traceId) {
        TRACE_ID.set(traceId);
    }

    public static String get() {
        return TRACE_ID.get();
    }

    public static void clear() {
        TRACE_ID.remove();
    }
}
```

过滤器：

```java
try {
    TraceContext.set(traceId);
    MDC.put("traceId", traceId);
    filterChain.doFilter(request, response);
} finally {
    MDC.remove("traceId");
    TraceContext.clear();
}
```

### 当前用户

```java
Long userId = UserContextHolder.get().userId();
```

这种写法方便，但不要滥用。

核心业务方法最好仍然显式传入 `userId`：

```java
orderService.createOrder(userId, request);
```

否则方法依赖隐藏上下文，测试和排查都会变差。

## 常见坑

### 忘记 remove

这是最大坑。

尤其是：

- Web 请求线程池。
- MQ 消费线程池。
- 自定义异步线程池。

### 用 ThreadLocal 藏业务参数

如果一个方法必须依赖 `userId`，优先显式传参。

`ThreadLocal` 适合横切上下文，不适合替代方法参数。

### 以为它解决并发共享对象

`ThreadLocal` 让每个线程有自己的引用。

如果多个线程放进去的是同一个可变对象，仍然可能并发不安全。

### 异步任务读不到上下文

线程变了，ThreadLocal 就变了。

### InheritableThreadLocal 滥用

它只适合新建子线程时继承父线程值。

线程池里线程早就创建好了，不适合靠它传请求上下文。

## 回答模板

可以这样讲：

```text
ThreadLocal 的数据不是存在 ThreadLocal 对象里，而是存在每个 Thread 自己的 ThreadLocalMap 里。

ThreadLocalMap 的 Entry 里，key 是 ThreadLocal 的弱引用，value 是业务对象强引用。
所以如果在线程池里 set 后不 remove，线程一直存活，value 可能无法释放，还可能被后续请求误读。

项目里一般用它存 traceId、当前用户、租户 ID、事务上下文。
用法必须是 try-finally remove。
异步换线程时 ThreadLocal 不会自动传递，需要显式传参或做上下文传播。
```

## 检查清单

- [ ] 是否只把它用于上下文，而不是替代业务参数。
- [ ] 是否 `set` 后一定 `remove`。
- [ ] 是否考虑线程池复用。
- [ ] 是否考虑异步换线程。
- [ ] value 是否可能是大对象。
- [ ] 是否避免滥用 `InheritableThreadLocal`。

## 参考

- [Java ThreadLocal API](https://docs.oracle.com/javase/8/docs/api/java/lang/ThreadLocal.html)
- [OpenJDK ThreadLocal source](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/lang/ThreadLocal.java)

