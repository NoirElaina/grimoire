---
title: JDK 常见线程池
sidebarTitle: JDK 线程池
---

# JDK 常见线程池

> 面试里常说“JDK 四个线程池”，通常指 `Executors` 里最常见的四种工厂方法。但工程里更重要的是知道它们底层参数和风险，而不是只背名字。

## 四个常见线程池

| 工厂方法 | 底层特点 | 典型风险 |
| --- | --- | --- |
| `newFixedThreadPool` | 固定线程数，无界队列 | 任务堆积导致内存压力 |
| `newSingleThreadExecutor` | 单线程，无界队列 | 单线程阻塞后任务全堆积 |
| `newCachedThreadPool` | 线程数可无限增长，`SynchronousQueue` | 高并发下创建大量线程 |
| `newScheduledThreadPool` | 定时/周期任务，延迟队列 | 周期任务阻塞导致堆积 |

这四个是学习入口。

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
- 队列默认近似无界。

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
- `SynchronousQueue` 不存任务。
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
- 异常未捕获导致后续调度停止。
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
| `corePoolSize` | 核心线程数 |
| `maximumPoolSize` | 最大线程数 |
| `keepAliveTime` | 非核心线程空闲存活时间 |
| `workQueue` | 任务队列 |
| `threadFactory` | 线程创建工厂 |
| `handler` | 拒绝策略 |

执行流程：

```text
提交任务
  -> 工作线程数 < corePoolSize：创建核心线程
  -> 否则尝试进入队列
  -> 队列满 且 工作线程数 < maximumPoolSize：创建非核心线程
  -> 还处理不了：触发拒绝策略
```

## 拒绝策略

| 策略 | 行为 | 风险 |
| --- | --- | --- |
| `AbortPolicy` | 直接抛异常 | 调用方必须处理 |
| `CallerRunsPolicy` | 调用线程自己执行 | 能反压，但会拖慢调用方 |
| `DiscardPolicy` | 直接丢任务 | 容易无感丢数据 |
| `DiscardOldestPolicy` | 丢最老任务再提交 | 可能丢关键任务 |

核心业务不要静默丢任务。

如果任务必须执行，要：

- 入库。
- MQ 异步。
- 重试。
- 告警。

而不是丢给内存线程池赌运气。

## 线程池大小怎么估

CPU 密集型：

```text
线程数 ≈ CPU 核心数
```

IO 密集型：

```text
线程数可以大于 CPU 核心数
```

但不要只靠公式。

项目里要结合：

- 任务平均耗时。
- 数据库连接池大小。
- 下游接口限流。
- MQ 消费速度。
- 队列堆积指标。

如果数据库连接池只有 20，线程池开 200 通常只会让更多线程卡在等连接。

## 监控什么

线程池不是创建完就完了。

至少要看：

- `activeCount`：活跃线程数。
- `poolSize`：当前线程数。
- `queue.size`：队列堆积。
- `completedTaskCount`：完成任务数。
- 拒绝次数。
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

线程名很重要。

线上看到：

```text
order-worker-7
```

就知道是哪个业务线程池。

## 检查清单

- [ ] 是否知道线程池底层参数。
- [ ] 是否避免无界队列。
- [ ] 是否避免无限创建线程。
- [ ] 是否有清晰线程名。
- [ ] 是否有拒绝策略。
- [ ] 是否有任务异常处理。
- [ ] 是否考虑数据库连接池和下游限流。
- [ ] 是否有队列堆积监控。
- [ ] 应用关闭时是否 `shutdown`。

## 参考

- [Java Executors API](https://docs.oracle.com/javase/8/docs/api/java/util/concurrent/Executors.html)

