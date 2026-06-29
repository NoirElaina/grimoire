---
title: JDK 常见线程池
sidebarTitle: JDK 线程池
---

# JDK 常见线程池

> 面试里常说“JDK 四个线程池”，通常指 `Executors` 里最常见的工厂方法。但工程里更重要的是底层参数和风险，源码题里更重要的是 `ThreadPoolExecutor` 的状态机、`execute` 流程和线程回收，而不是只背名字。

## 常见线程池

| 工厂方法 | 底层特点 | 典型风险 |
| --- | --- | --- |
| `newFixedThreadPool` | 固定线程数，无界队列 | 任务堆积导致内存压力 |
| `newSingleThreadExecutor` | 单线程，无界队列 | 单线程阻塞后任务全堆积 |
| `newCachedThreadPool` | 线程数可无限增长，`SynchronousQueue` | 高并发下创建大量线程 |
| `newScheduledThreadPool` | 定时/周期任务，延迟队列 | 周期任务阻塞导致堆积 |
| `newWorkStealingPool` | JDK 8+，基于 `ForkJoinPool` 的工作窃取 | 不保证顺序，不适合强依赖顺序的任务 |

前四个基于 `ThreadPoolExecutor`，最后一个基于 `ForkJoinPool`。它们都是学习入口。

项目里不建议无脑直接用 `Executors`，更推荐显式创建 `ThreadPoolExecutor`，把核心线程数、最大线程数、队列长度、拒绝策略都写清楚。

## `newFixedThreadPool`

```java
ExecutorService executor = Executors.newFixedThreadPool(8);
```

大致等价：

```java
new ThreadPoolExecutor(
        8,
        8,
        0L,
        TimeUnit.MILLISECONDS,
        new LinkedBlockingQueue<>()
);
```

特点：

- 核心线程数 = 最大线程数。
- 线程数量固定。
- 多余任务进入队列。
- 队列默认近似无界（`LinkedBlockingQueue` 容量 `Integer.MAX_VALUE`）。

风险：

```text
线程数固定，不会爆线程。
但任务提交太快、执行太慢时，队列会不断堆积。
最终可能 OOM。
```

适合：

- 稳定并发。
- 任务耗时可控。
- 队列长度有监控或自己显式限制。

## `newSingleThreadExecutor`

```java
ExecutorService executor = Executors.newSingleThreadExecutor();
```

大致等价：

```java
new ThreadPoolExecutor(
        1,
        1,
        0L,
        TimeUnit.MILLISECONDS,
        new LinkedBlockingQueue<>()
);
```

特点：

- 永远只有一个工作线程。
- 任务按提交顺序串行执行。
- 某个任务异常结束后，会补一个新线程继续跑后续任务。
- 外层用 `FinalizableDelegatedExecutorService` 包了一层，所以不能强转回 `ThreadPoolExecutor` 改参数。

适合：

- 需要串行执行的后台任务。
- 单资源写入。
- 避免并发修改本地状态。

风险：

```text
一个任务卡住，后面的任务全部等待。
队列无界，任务堆积时也会 OOM。
```

## `newCachedThreadPool`

```java
ExecutorService executor = Executors.newCachedThreadPool();
```

大致等价：

```java
new ThreadPoolExecutor(
        0,
        Integer.MAX_VALUE,
        60L,
        TimeUnit.SECONDS,
        new SynchronousQueue<>()
);
```

特点：

- 没有核心线程。
- 空闲线程 60 秒后回收。
- `SynchronousQueue` 不存任务，是“直接交接”队列。
- 来一个任务，如果没有空闲线程，就新建线程。

风险：

```text
任务来得快、执行得慢时，会创建大量线程。
线程太多会带来上下文切换、内存占用，甚至把机器打爆。
```

适合：

- 短任务。
- 突发但可控。
- 不适合核心业务高并发入口。

## `newScheduledThreadPool`

```java
ScheduledExecutorService executor = Executors.newScheduledThreadPool(4);
```

用于延迟任务和周期任务：

```java
executor.schedule(this::closeTimeoutOrder, 30, TimeUnit.MINUTES);
```

```java
executor.scheduleWithFixedDelay(this::syncMetrics, 10, 10, TimeUnit.SECONDS);
```

底层是 `ScheduledThreadPoolExecutor`，队列用的是 `DelayedWorkQueue`（按到期时间排序的延迟队列），所以最大线程数其实没意义，调度靠队列出队时机控制。

注意两个周期方法：

| 方法 | 含义 |
| --- | --- |
| `scheduleAtFixedRate` | 按固定频率触发，以上一次开始时间为基准 |
| `scheduleWithFixedDelay` | 上一次执行结束后，再等待固定延迟 |

如果任务可能执行很久，更推荐：

```java
scheduleWithFixedDelay
```

避免任务重叠压力。

风险：

- 周期任务执行太慢。
- 异常未捕获导致后续调度停止（周期任务抛出未捕获异常后，该任务不再被调度，且不会有任何提示）。
- 定时任务没有分布式互斥，多实例重复跑。

## 为什么不建议直接用 `Executors`

问题不在 `Executors` 本身，而在它隐藏了关键参数。

典型风险：

| 方法 | 隐藏风险 |
| --- | --- |
| `newFixedThreadPool` | 无界队列 |
| `newSingleThreadExecutor` | 无界队列 |
| `newCachedThreadPool` | 最大线程数接近无限 |
| `newScheduledThreadPool` | 延迟队列和任务异常容易被忽略 |

工程里更推荐：

```java
ThreadPoolExecutor executor = new ThreadPoolExecutor(
        8,
        16,
        60L,
        TimeUnit.SECONDS,
        new ArrayBlockingQueue<>(1000),
        new ThreadFactoryBuilder().setNameFormat("order-worker-%d").build(),
        new ThreadPoolExecutor.CallerRunsPolicy()
);
```

要明确：

- 核心线程数。
- 最大线程数。
- 队列长度。
- 线程名。
- 拒绝策略。
- 监控指标。

## 线程池核心参数

| 参数 | 作用 |
| --- | --- |
| `corePoolSize` | 核心线程数，默认不会因空闲被回收 |
| `maximumPoolSize` | 最大线程数 |
| `keepAliveTime` | 空闲线程存活时间 |
| `workQueue` | 任务队列 |
| `threadFactory` | 线程创建工厂，决定线程名、是否守护线程 |
| `handler` | 拒绝策略 |

七个参数里，最容易被忽略却最影响行为的是 `workQueue` 和 `handler`，它俩决定了“扛不住的时候怎么办”。

## 线程池状态机

`ThreadPoolExecutor` 用一个 `AtomicInteger ctl` 同时存了两件事：

```text
高 3 位：运行状态 runState
低 29 位：工作线程数 workerCount
```

用一个变量存两个值，是为了用一次 CAS 同时保证状态和线程数的原子性，避免两个字段之间出现中间态。

五个状态：

| 状态 | 含义 |
| --- | --- |
| `RUNNING` | 接收新任务，处理队列任务 |
| `SHUTDOWN` | 不接收新任务，但处理完队列里的任务 |
| `STOP` | 不接收新任务，不处理队列，中断正在执行的任务 |
| `TIDYING` | 所有任务结束，workerCount 为 0，即将执行 `terminated()` |
| `TERMINATED` | `terminated()` 执行完毕 |

流转方向（只增不减）：

```text
RUNNING --shutdown()--> SHUTDOWN ----+
RUNNING --shutdownNow()--> STOP -----+--> TIDYING --> TERMINATED
```

## `execute` 流程

`execute` 是整个线程池的入口，源码简化后：

```java
public void execute(Runnable command) {
    if (command == null) throw new NullPointerException();
    int c = ctl.get();
    // 1. 线程数 < 核心数：直接建核心线程
    if (workerCountOf(c) < corePoolSize) {
        if (addWorker(command, true)) return;
        c = ctl.get();
    }
    // 2. 还在 RUNNING 且入队成功
    if (isRunning(c) && workQueue.offer(command)) {
        int recheck = ctl.get();
        // 二次检查：入队后状态变了就回滚并拒绝
        if (!isRunning(recheck) && remove(command)) {
            reject(command);
        } else if (workerCountOf(recheck) == 0) {
            // 兜底：池子里一个线程都没有，补一个
            addWorker(null, false);
        }
    }
    // 3. 入队失败（队列满）：尝试建非核心线程
    else if (!addWorker(command, false)) {
        reject(command);   // 4. 建不出来：拒绝
    }
}
```

对应那句经典流程：

```text
提交任务
  -> 工作线程数 < corePoolSize：创建核心线程
  -> 否则尝试进入队列
  -> 队列满 且 工作线程数 < maximumPoolSize：创建非核心线程
  -> 还处理不了：触发拒绝策略
```

两个容易被追问的细节：

- 第 2 步入队后还要 **recheck**，因为入队和判断状态之间，线程池可能已经被 `shutdown`，必须把任务移除并拒绝，避免任务永远卡在队列里没人处理。
- `workerCountOf(recheck) == 0` 的兜底：核心数设为 0 时（比如 `newCachedThreadPool` 风格），任务入队后可能没有任何线程来取，所以要补一个非核心线程。

## 为什么是“核心 → 队列 → 最大”这个顺序

这是面试高频追问：为什么不是核心满了直接扩到最大线程，而是先入队？

设计意图是**优先复用已有线程，把创建线程当作最后手段**：

- 线程创建和销毁有成本（栈内存、内核调度）。
- 队列起到缓冲削峰作用，短时抖动用队列扛，不用频繁扩线程。
- 只有队列也满了，才说明持续过载，这时才扩到最大线程数。

这也解释了一个常见的“坑”：

```text
用无界队列（如默认 LinkedBlockingQueue）时，队列永远不会满，
所以 maximumPoolSize 永远不会生效，线程数永远停在 corePoolSize。
```

所以 `newFixedThreadPool` 的 max 设多少都没用——它的队列是无界的。

## Worker 为什么继承 AQS

每个工作线程被包成一个 `Worker`，它 `extends AbstractQueuedSynchronizer implements Runnable`，自己实现了一把**不可重入**的锁。

为什么需要这把锁：

- 用 `tryLock` 能判断一个 Worker 是**空闲**还是**正在执行任务**。
- `shutdown()` 调 `interruptIdleWorkers()`，只中断能拿到锁的（空闲）线程，不会粗暴打断正在跑的任务。

为什么是**不可重入**：

- 防止任务执行过程中，调用 `setCorePoolSize` 等方法时重新拿到锁，从而被错误地中断。
- 正在执行任务的 Worker 处于 locked 状态，`interruptIdleWorkers` 拿不到锁，就不会中断它。

Worker 构造时还会把 AQS 的 state 设为 `-1`，在 `runWorker` 真正开始前禁止中断（避免线程还没开始干活就被 `interruptIdleWorkers` 中断）。

## `getTask` 与线程回收

Worker 启动后在 `runWorker` 里循环调 `getTask()` 取任务，取不到就退出、线程结束。空闲回收就发生在这里：

```java
private Runnable getTask() {
    boolean timedOut = false;
    for (;;) {
        int c = ctl.get();
        int wc = workerCountOf(c);
        // 是否对该线程启用超时回收
        boolean timed = allowCoreThreadTimeOut || wc > corePoolSize;
        // ... 各种边界判断后
        Runnable r = timed
                ? workQueue.poll(keepAliveTime, TimeUnit.NANOSECONDS)  // 超时取，取不到返回 null
                : workQueue.take();                                    // 阻塞取，一直等
        if (r != null) return r;
        timedOut = true;   // poll 超时，说明该线程该被回收了
    }
}
```

要点：

- 线程数 > 核心数时，多出来的线程用 `poll` 带超时取任务，超时取不到就回收，这就是非核心线程的“空闲 60 秒被回收”。
- 核心线程默认用 `take` 永久阻塞，不会被回收。
- `allowCoreThreadTimeOut(true)` 可以让核心线程也参与超时回收，适合空闲期想把线程数降到 0 的场景。
- 线程池不区分“这个线程是核心还是非核心”，它只看当前 `workerCount` 和 `corePoolSize` 的关系来决定谁该被回收。

预热相关：

- `prestartCoreThread()`：提前创建一个核心线程。
- `prestartAllCoreThreads()`：提前把核心线程全建好，避免冷启动第一批请求慢。

## 阻塞队列怎么选

`workQueue` 直接决定线程池行为：

| 队列 | 特点 | 适合 |
| --- | --- | --- |
| `ArrayBlockingQueue` | 有界，数组，需指定容量 | 生产推荐，能反压 |
| `LinkedBlockingQueue` | 默认无界，链表 | 任务量可控时用，否则有 OOM 风险 |
| `SynchronousQueue` | 不存任务，直接交接 | 配合大 max，做 cached 风格 |
| `PriorityBlockingQueue` | 无界，按优先级出队 | 任务有优先级 |
| `DelayedWorkQueue` | 延迟队列 | 定时/延迟任务，调度线程池专用 |

工程默认选 `ArrayBlockingQueue` 并设一个合理容量，让线程池在过载时能通过“队列满 → 扩线程 → 拒绝”形成反压，而不是用无界队列把压力悄悄憋成内存。

## 拒绝策略

| 策略 | 行为 | 风险 |
| --- | --- | --- |
| `AbortPolicy` | 直接抛 `RejectedExecutionException`（默认） | 调用方必须处理 |
| `CallerRunsPolicy` | 调用线程自己执行 | 能反压，但会拖慢调用方 |
| `DiscardPolicy` | 直接丢任务，不报错 | 容易无感丢数据 |
| `DiscardOldestPolicy` | 丢队列里最老的任务再提交 | 可能丢关键任务 |

`CallerRunsPolicy` 是很实用的反压策略：提交任务的线程被迫自己跑任务，自然就慢下来、停止往池子里灌，给线程池喘息时间。但如果提交者是 Web 容器线程（如 Tomcat 线程），要注意它会拖慢接口响应。

核心业务不要静默丢任务。如果任务必须执行，要：

- 入库。
- MQ 异步。
- 重试。
- 告警。

也可以自定义拒绝策略实现这些兜底：

```java
public class PersistRejectedHandler implements RejectedExecutionHandler {
    @Override
    public void rejectedExecution(Runnable r, ThreadPoolExecutor executor) {
        log.warn("task rejected, fallback to db, queueSize={}", executor.getQueue().size());
        // 落库 / 发 MQ / 告警
    }
}
```

而不是丢给内存线程池赌运气。

## `execute` 和 `submit` 的区别

这是异常处理的高频坑：

| 方法 | 返回 | 任务抛异常时 |
| --- | --- | --- |
| `execute` | 无返回 | 异常抛到线程的 `UncaughtExceptionHandler`，该 Worker 线程死掉后被新线程替换 |
| `submit` | `Future` | 异常被包进 `Future`，**不调用 `get()` 就永远看不到** |

`submit` 内部把任务包成 `FutureTask`，异常被 `setException` 存起来，只有 `future.get()` 时才以 `ExecutionException` 抛出。

错误写法（异常被悄悄吞掉）：

```java
executor.submit(() -> {
    doRiskyWork();   // 这里抛异常，外面毫无感知
});
```

正确做法：

- 用 `submit` 就一定要处理 `Future`，或在任务内部 try-catch 兜底并打日志。
- 用 `execute` 的话，给线程工厂设 `UncaughtExceptionHandler` 统一捕获。

```java
new ThreadFactoryBuilder()
        .setNameFormat("order-worker-%d")
        .setUncaughtExceptionHandler((t, e) -> log.error("thread {} crashed", t.getName(), e))
        .build();
```

## `shutdown` 和 `shutdownNow`

| 方法 | 状态 | 队列里的任务 | 正在执行的任务 |
| --- | --- | --- | --- |
| `shutdown()` | SHUTDOWN | 继续执行完 | 不中断，等其跑完 |
| `shutdownNow()` | STOP | 不执行，返回剩余任务列表 | 发中断信号 |

优雅关闭的标准姿势：

```java
executor.shutdown();
try {
    if (!executor.awaitTermination(30, TimeUnit.SECONDS)) {
        executor.shutdownNow();
    }
} catch (InterruptedException e) {
    executor.shutdownNow();
    Thread.currentThread().interrupt();
}
```

注意 `shutdownNow` 只是发中断信号，任务里如果不响应中断（没有 `InterruptedException` 检查点、没判断 `isInterrupted`），照样停不下来。

## 运行期动态调参

`ThreadPoolExecutor` 的几个 set 方法支持运行时改参数，不用重启：

```java
executor.setCorePoolSize(16);
executor.setMaximumPoolSize(32);
executor.setKeepAliveTime(30, TimeUnit.SECONDS);
```

这是“动态线程池”的基础思路（如美团 Hippo4j、动态线程池组件）：

```text
线程池参数放配置中心（Nacos / Apollo）
  -> 监听配置变更
  -> 调用 set 方法热更新
  -> 配合监控告警观察队列堆积、拒绝次数
```

好处是线上压力变化时，能不发版调参，而不是把队列写死后只能干等。但队列容量 `ArrayBlockingQueue` 本身不支持动态扩容，要动态改队列长度得用自定义队列（动态线程池组件通常重写了一个可变容量队列）。

## Spring 线程池与 `@Async`

Spring 项目里更常用 `ThreadPoolTaskExecutor`，它是对 `ThreadPoolExecutor` 的封装：

```java
@Bean("orderExecutor")
public ThreadPoolTaskExecutor orderExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(8);
    executor.setMaxPoolSize(16);
    executor.setQueueCapacity(1000);
    executor.setKeepAliveSeconds(60);
    executor.setThreadNamePrefix("order-worker-");
    executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
    executor.setWaitForTasksToCompleteOnShutdown(true);  // 关闭时等任务跑完
    executor.setAwaitTerminationSeconds(30);
    executor.initialize();
    return executor;
}
```

`@Async` 要显式指定线程池，否则默认用 `SimpleAsyncTaskExecutor`——它**每次都新建线程、不复用**，等于没有池化，高并发下会爆线程：

```java
@Async("orderExecutor")
public void sendOrderNotify(Long orderId) { }
```

`@Async` 还有两个常见坑（和事务失效同源）：

- 同类自调用不走代理，`@Async` 不生效。
- 方法返回值要用 `CompletableFuture` 才能拿到异步结果，`void` 方法的异常默认被吞，需要配 `AsyncUncaughtExceptionHandler`。

## 线程池大小怎么估

CPU 密集型：

```text
线程数 ≈ CPU 核心数 + 1
```

IO 密集型：

```text
线程数 ≈ CPU 核心数 * (1 + 平均等待时间 / 平均计算时间)
```

但不要只靠公式。项目里要结合：

- 任务平均耗时。
- 数据库连接池大小。
- 下游接口限流。
- MQ 消费速度。
- 队列堆积指标。

如果数据库连接池只有 20，线程池开 200 通常只会让更多线程卡在等连接。最终都要压测调参，公式只给初值。

## 监控什么

线程池不是创建完就完了。至少要看：

- `getActiveCount()`：活跃线程数。
- `getPoolSize()`：当前线程数。
- `getQueue().size()`：队列堆积。
- `getCompletedTaskCount()`：完成任务数。
- `getLargestPoolSize()`：历史峰值线程数，用来反推 max 设得够不够。
- 拒绝次数（自定义计数）。
- 任务耗时。
- 异常次数。

队列长期接近满，说明：

```text
提交速度 > 处理速度。
```

这时要扩容、限流、拆任务、优化下游，而不是只把队列改大。

## 项目使用建议

不要这样：

```java
private final ExecutorService executor = Executors.newFixedThreadPool(20);
```

更建议：

```java
@Bean
public ThreadPoolExecutor orderExecutor() {
    return new ThreadPoolExecutor(
            8,
            16,
            60L,
            TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(1000),
            new CustomizableThreadFactory("order-worker-"),
            new ThreadPoolExecutor.CallerRunsPolicy()
    );
}
```

线程名很重要。线上看到：

```text
order-worker-7
```

就知道是哪个业务线程池，排查问题和看监控都靠它区分。另外不同业务用不同线程池隔离，避免一个慢任务把整个池子拖垮（线程池隔离思想，和 Hystrix/Sentinel 的隔离一致）。

## 检查清单

- [ ] 能说出 `ctl` 同时存状态和线程数，五个状态及流转。
- [ ] 能讲清 `execute` 的“核心 → 队列 → 最大 → 拒绝”流程和入队后的 recheck。
- [ ] 知道无界队列会让 max 永远不生效。
- [ ] 知道 Worker 继承 AQS、用不可重入锁区分空闲/运行。
- [ ] 知道非核心线程靠 `getTask` 的 `poll` 超时被回收。
- [ ] 能选对阻塞队列，生产避免无界队列。
- [ ] 有明确拒绝策略，核心任务不静默丢。
- [ ] 知道 `submit` 会吞异常，`execute` 配 `UncaughtExceptionHandler`。
- [ ] 知道 `shutdown` 与 `shutdownNow` 的区别，应用关闭时优雅停。
- [ ] `@Async` 显式指定线程池，避免默认每次新建线程。
- [ ] 线程命名清晰，按业务隔离线程池。
- [ ] 有队列堆积、拒绝次数、峰值线程数监控。

## 参考

- [Java ThreadPoolExecutor API](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/concurrent/ThreadPoolExecutor.html)
- [Java Executors API](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/concurrent/Executors.html)
- [Spring ThreadPoolTaskExecutor](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/scheduling/concurrent/ThreadPoolTaskExecutor.html)
