---
title: Java ThreadLocal
sidebarTitle: ThreadLocal
---

# Java ThreadLocal

> `ThreadLocal` 不是把变量“变成线程安全”，而是让每个线程都有自己的一份变量副本。它常用于请求上下文、traceId、用户信息、事务上下文。源码题里高频问的是 `ThreadLocalMap` 的结构、弱引用、内存泄漏和跨线程传递，而不是它怎么用。

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
- Spring 事务上下文（`TransactionSynchronizationManager` 内部就是 ThreadLocal）。

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

## 数据存在哪：不是存在 ThreadLocal 里

这是最常被答错的点。数据不是存在 `ThreadLocal` 对象里，而是存在**每个 Thread 自己**的 `ThreadLocalMap` 里：

```text
Thread
  -> ThreadLocalMap threadLocals     // 线程的成员变量
      -> Entry[] table
          -> Entry.key   : ThreadLocal 弱引用
          -> Entry.value : 业务对象强引用
```

源码里 `Thread` 有这么个字段：

```java
ThreadLocal.ThreadLocalMap threadLocals = null;
```

`ThreadLocal` 自己不持有任何线程的数据，它只是 `ThreadLocalMap` 里的一把 **key**。所以：

- 一个线程内放多个不同的 `ThreadLocal`，都进同一个 `ThreadLocalMap`，用不同 key 区分。
- 同一个 `ThreadLocal` 在不同线程里，对应各自线程 map 里的不同 entry，天然隔离。

`get()` 的大致流程：

```java
public T get() {
    Thread t = Thread.currentThread();
    ThreadLocalMap map = getMap(t);          // 返回 t.threadLocals
    if (map != null) {
        ThreadLocalMap.Entry e = map.getEntry(this);  // this 作为 key
        if (e != null) {
            return (T) e.value;
        }
    }
    return setInitialValue();                // 没有就走初始化
}
```

## ThreadLocalMap 是开放寻址，不是链表

这是和 `HashMap` 的关键区别，面试常对比着问：

| | HashMap | ThreadLocalMap |
| --- | --- | --- |
| 冲突解决 | 链表 + 红黑树（拉链法） | 线性探测（开放寻址法） |
| key | 强引用 | 弱引用（`Entry extends WeakReference`） |
| 用途 | 通用 | 只服务 ThreadLocal，量小 |

`Entry` 定义：

```java
static class Entry extends WeakReference<ThreadLocal<?>> {
    Object value;
    Entry(ThreadLocal<?> k, Object v) {
        super(k);     // key 是弱引用
        value = v;    // value 是强引用
    }
}
```

定位下标用 `ThreadLocal` 自己的 hash：

```java
int i = key.threadLocalHashCode & (len - 1);
```

每个 `ThreadLocal` 实例的 hash 由一个原子计数器按固定步长递增生成：

```java
private static final int HASH_INCREMENT = 0x61c88647;
```

`0x61c88647` 是和黄金分割相关的魔数，作用是让连续创建的 `ThreadLocal` 的 hash 在 2 的幂大小的数组里**散得尽量均匀**，减少线性探测的冲突。

`set` 时如果下标被占，就向后线性探测找空位或同 key 位；`get` 没命中也向后探测。所以 ThreadLocalMap 的冲突不是挂链表，而是“往后挪一格”。

## 为什么 key 用弱引用

设计意图：尽量让 `ThreadLocal` 对象能被回收，避免泄漏扩大。

引用链是这样的：

```text
ThreadLocal 静态引用 --强--> ThreadLocal 对象 <--弱-- Entry.key
                                                Entry.value --强--> 业务对象
Thread --强--> ThreadLocalMap --强--> Entry[] --强--> Entry
```

假设某个 `ThreadLocal` 不再被外部强引用（比如局部变量用完了）：

- 如果 key 是**强引用**，Entry 一直引着它，`ThreadLocal` 永远回收不掉。
- key 用**弱引用**，下次 GC 就能回收这个 `ThreadLocal`，Entry 的 key 变成 `null`。

但这里有个关键：**key 被回收了，value 还是强引用，依然挂在 map 里**。这就是内存泄漏的根源。

## 内存泄漏到底怎么发生

泄漏链路：

```text
ThreadLocal 对象被 GC -> Entry.key == null
但 Entry.value 仍被 Entry 强引用
Entry 被 Entry[] 强引用
Entry[] 被 ThreadLocalMap 强引用
ThreadLocalMap 被 Thread 强引用
=> 只要这个线程不死，value 就一直释放不了
```

普通线程执行完就结束，`Thread` 被回收，整条链跟着断，没事。

问题出在**线程池**：线程长期存活、反复复用，`ThreadLocalMap` 一直在，泄漏的 value 会越积越多。

ThreadLocal 自己有“被动清理”机制：`get`、`set`、`remove` 过程中遇到 key 为 null 的 stale entry（`expungeStaleEntry` / `cleanSomeSlots`）会顺手清掉。但它**只清探测过程中碰到的那些**，不保证清干净。如果你 set 之后再也不碰这个 ThreadLocal，泄漏的 value 可能永远等不到被动清理。

所以结论只有一句：

```java
try {
    THREAD_LOCAL.set(value);
    doWork();
} finally {
    THREAD_LOCAL.remove();   // 唯一可靠的清理
}
```

`remove()` 会把 entry 的弱引用 key 清掉并调 `expungeStaleEntry` 把 value 也置 null，彻底断开。

## 为什么在线程池里特别危险

不只是泄漏，还有**脏上下文**：

```text
请求 A 在线程 worker-1 设置 userId=1001。
请求 A 结束但没 remove。
线程 worker-1 被复用处理请求 B。
请求 B 没 set 就 get -> 读到上一个请求残留的 userId=1001。
```

这不是理论问题，是后端项目里很常见的越权 / 数据串号事故。线程池场景下，忘记 `remove` 既漏内存又串数据。

## 扩容与 rehash

简单了解即可：

- `threshold = len * 2 / 3`，size 达到阈值触发 `rehash()`。
- `rehash()` 先 `expungeStaleEntries()` 清理所有 stale entry，清完后如果 size 仍 `>= threshold * 3/4` 才真正 `resize()`（容量翻倍）。
- 数组长度始终是 2 的幂，所以能用 `& (len-1)` 取下标。

这套设计是为了在小数据量下尽量靠清理 stale entry 来腾空间，而不是急着扩容。

## ThreadLocal 不会自动跨线程

```java
UserContextHolder.set(userContext);

CompletableFuture.runAsync(() -> {
    UserContext context = UserContextHolder.get(); // 通常是 null
});
```

原因很直接：ThreadLocal 绑定的是 `Thread.currentThread()`，异步任务换了线程，新线程的 `ThreadLocalMap` 里没有这份数据。

要传递有几种方式，从简单到复杂：

- 显式把参数传给异步任务（最清楚，首选）。
- `InheritableThreadLocal`（只能在**新建子线程**时继承）。
- `TransmittableThreadLocal`（解决线程池复用场景）。
- 提交任务时手动复制上下文到任务包装器里。

## InheritableThreadLocal

它让**子线程在被创建时**继承父线程的值：

```java
private static final InheritableThreadLocal<String> CTX = new InheritableThreadLocal<>();
```

原理：`Thread` 除了 `threadLocals`，还有一个 `inheritableThreadLocals`。在 `Thread.init`（创建线程）时，如果父线程的 `inheritableThreadLocals` 不为空，就把它复制给子线程：

```java
if (parent.inheritableThreadLocals != null)
    this.inheritableThreadLocals =
        ThreadLocal.createInheritedMap(parent.inheritableThreadLocals);
```

`InheritableThreadLocal` 重写了 `getMap` / `createMap`，让它操作的是 `inheritableThreadLocals` 这个字段。

**为什么线程池里失效**：复制只发生在线程“创建”那一刻。线程池的线程是早就建好并复用的，提交任务时不会再触发 `Thread.init`，所以拿到的是线程**第一次创建时**继承的旧上下文，而不是当前提交任务的父线程上下文。在线程池里用它传请求上下文，结果几乎一定是错的。

## TransmittableThreadLocal（跨线程池传递）

阿里 `transmittable-thread-local`（TTL）就是为了解决“线程池里也要传上下文”：

```java
TransmittableThreadLocal<UserContext> context = new TransmittableThreadLocal<>();

// 把线程池包一层，或用 TtlRunnable / TtlCallable 包装任务
ExecutorService ttlExecutor = TtlExecutors.getTtlExecutorService(bizExecutor);
```

思路：

```text
提交任务时（在父线程）捕获当前 TTL 的值快照
  -> 任务在 worker 线程真正执行前，把快照写入 worker 线程
  -> 任务执行完，恢复 worker 线程原来的值（避免污染下一个任务）
```

它本质是在**任务提交和执行的边界**做上下文的“抓取-回放-清理”，绕开了 `InheritableThreadLocal` 只在建线程时复制的限制。常用于全链路 traceId、压测标识透传等场景。

## 常见项目用法

### traceId

```java
public class TraceContext {
    private static final ThreadLocal<String> TRACE_ID = new ThreadLocal<>();

    public static void set(String traceId) { TRACE_ID.set(traceId); }
    public static String get() { return TRACE_ID.get(); }
    public static void clear() { TRACE_ID.remove(); }
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

顺带一提：日志框架的 `MDC` 底层也是 ThreadLocal（`MDCAdapter`），所以异步线程里 MDC 同样会丢，需要 TTL 或手动透传。

### 当前用户

```java
Long userId = UserContextHolder.get().userId();
```

这种写法方便，但不要滥用。核心业务方法最好仍然显式传入 `userId`：

```java
orderService.createOrder(userId, request);
```

否则方法依赖隐藏上下文，测试和排查都会变差。

## 常见坑

### 忘记 remove

最大坑。尤其是 Web 请求线程池、MQ 消费线程池、自定义异步线程池。既漏内存又串上下文。

### 用 ThreadLocal 藏业务参数

如果一个方法必须依赖 `userId`，优先显式传参。ThreadLocal 适合横切上下文，不适合替代方法参数。

### 以为它解决并发共享对象

ThreadLocal 让每个线程有自己的引用。如果多个线程放进去的是**同一个可变对象**，仍然可能并发不安全。

### 异步 / 线程池读不到上下文

线程变了上下文就没了。`InheritableThreadLocal` 在线程池里也不行，要用 TTL 或显式传参。

## 回答模板

```text
ThreadLocal 的数据不存在 ThreadLocal 对象里，而是存在每个 Thread 的 ThreadLocalMap 里，
ThreadLocal 只是这个 map 的 key。

ThreadLocalMap 用开放寻址（线性探测）解决冲突，Entry 的 key 是 ThreadLocal 的弱引用，value 是强引用。
key 用弱引用是为了让没人引用的 ThreadLocal 能被回收；但 value 是强引用，
所以线程池里 set 后不 remove，线程长期存活，value 释放不掉会泄漏，还可能被下一个请求误读。
get/set/remove 会被动清理 key 为 null 的 entry，但不彻底，必须 try-finally remove。

跨线程不会自动传递：InheritableThreadLocal 只在建线程时复制，线程池失效；
要在线程池里透传上下文用阿里的 TransmittableThreadLocal。
```

## 检查清单

- [ ] 能说清数据存在 Thread 的 ThreadLocalMap 里，ThreadLocal 只是 key。
- [ ] 能对比 ThreadLocalMap 开放寻址 vs HashMap 拉链。
- [ ] 能讲清 key 弱引用、value 强引用，以及内存泄漏的完整引用链。
- [ ] 知道被动清理不彻底，`remove` 才是可靠手段。
- [ ] 只把它用于上下文，而不是替代业务参数。
- [ ] `set` 后一定 `finally remove`，尤其在线程池里。
- [ ] 知道 `InheritableThreadLocal` 在线程池里失效的原因。
- [ ] 跨线程池传上下文用 TTL，或显式传参。

## 参考

- [Java ThreadLocal API](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/lang/ThreadLocal.html)
- [OpenJDK ThreadLocal source](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/lang/ThreadLocal.java)
- [alibaba/transmittable-thread-local](https://github.com/alibaba/transmittable-thread-local)
