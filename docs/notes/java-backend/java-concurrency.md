---
title: Java 并发深度
sidebarTitle: 并发深度
---

# Java 并发深度

> 并发的两块地基是 **JMM（Java 内存模型）** 和 **JUC 工具集**。锁升级和 AQS 在 [synchronized](/notes/java-backend/synchronized) 和 [Java Lock](/notes/java-backend/java-lock) 里讲过，这篇补上另一半：JMM 理论、`volatile`、CAS 与原子类、`ConcurrentHashMap`、`CompletableFuture`。理解了这些，"为什么线程不安全"和"怎么安全"才有完整答案。

## 1. JMM：Java 内存模型

### 1.1 为什么需要内存模型

CPU 有多级缓存，每个核心有自己的 L1/L2，多核共享 L3 和主内存。线程运行时不会每次都读写主内存，而是先操作工作内存（CPU 缓存 / 寄存器），再择机刷回。

```
线程 A ─→ 工作内存 A ─┐
                        ├─→ 主内存
线程 B ─→ 工作内存 B ─┘
```

问题：线程 A 写了变量到自己的工作内存，线程 B 看不到，各自缓存不一致。JMM 就是定义**什么情况下一个线程的写对另一个线程可见**的规范。

### 1.2 JMM 的抽象结构

JMM 规定：

- 每个线程有自己的**工作内存**（抽象概念，对应 CPU 缓存 + 寄存器）。
- 所有共享变量存在**主内存**。
- 线程不能直接读写主内存，必须经过工作内存：
  - `read` + `load`：主内存 → 工作内存。
  - `use` + `assign`：工作内存内操作变量。
  - `store` + `write`：工作内存 → 主内存。

这不是 Java 的真实实现（HotSpot 直接操作硬件内存），而是一个**一致性约定**，用来推导线程安全。

### 1.3 happens-before：可见性的核心规则

JMM 用 **happens-before** 关系保证：如果 A happens-before B，那么 A 的操作结果对 B 可见。这不是说 A 一定先执行，而是 A 的效果对 B 可见。

八条规则（前四条最常考）：

| 规则 | 含义 |
| --- | --- |
| **程序顺序规则** | 同一线程内，前面的操作 happens-before 后面的操作（同线程内的代码顺序） |
| **锁规则（monitor lock）** | 一个锁的 unlock happens-before 后续对同一把锁的 lock |
| **volatile 规则** | 对 volatile 变量的写 happens-before 后续对它的读 |
| **线程启动规则** | `Thread.start()` happens-before 该线程内的所有操作 |
| **线程终止规则** | 线程内的所有操作 happens-before `Thread.join()` 返回 |
| **线程中断规则** | `Thread.interrupt()` happens-before 被中断线程检测到中断 |
| **对象终结规则** | 构造函数执行完毕 happens-before `finalize()` |
| **传递性** | 如果 A happens-before B，B happens-before C，则 A happens-before C |

::: tip 面试关键
问到"为什么 `synchronized` 能保证可见性"，答案不是"锁了"，而是**锁规则**：unlock happens-before 后续 lock，所以持锁线程看到的共享变量是最新的。`volatile` 同理，靠的是 volatile 规则。
:::

### 1.4 内存屏障

JMM 底层靠**内存屏障**（Memory Barrier）禁止指令重排序，保证可见性：

| 屏障类型 | 作用 |
| --- | --- |
| LoadLoad | 确保 Load1 先于 Load2 完成 |
| StoreStore | 确保 Store1 先于 Store2 完成（且刷回主内存） |
| LoadStore | 确保 Load1 先于 Store2 完成 |
| StoreLoad | 确保 Store1 先于 Load2 完成（全能屏障，开销最大） |

`volatile` 写之前插入 StoreStore 屏障，写之后插入 StoreLoad 屏障；`volatile` 读之后插入 LoadLoad 和 LoadStore 屏障。这就是 volatile 禁止重排序、保证可见性的底层实现。

---

## 2. volatile 深度

### 2.1 volatile 保证什么

| 保证 | 说明 |
| --- | --- |
| **可见性** | 写 volatile 变量后，其他线程立刻能看到新值（强制刷主内存 + 读时强制从主内存加载） |
| **有序性** | 禁止编译器和 CPU 对 volatile 变量前后的指令做特定重排序（靠内存屏障） |
| **不保证原子性** | `volatile int count; count++` 仍然不安全 |

### 2.2 为什么不保证原子性

`count++` 是三步操作：读 → 加 1 → 写。volatile 只保证每次读都从主内存读、每次写都刷回主内存，但**读-改-写不是原子的**：

```
线程 A 读到 count=0
线程 B 读到 count=0      ← 此时 A 还没写回
线程 A 写回 count=1
线程 B 写回 count=1      ← 丢失了 A 的更新
```

### 2.3 volatile 的经典用法

**场景一：状态标志位**

```java
private volatile boolean running = true;

public void run() {
    while (running) {
        doWork();
    }
}

public void shutdown() {
    running = false;
}
```

不用 volatile 的话，`shutdown()` 在另一个线程修改了 `running`，工作线程可能永远看不到（JIT 可能把它优化成读一次缓存到寄存器），导致无法停止。

**场景二：DCL 单例**

```java
public class Singleton {
    private static volatile Singleton instance;

    public static Singleton getInstance() {
        if (instance == null) {                    // 第一次检查
            synchronized (Singleton.class) {
                if (instance == null) {            // 第二次检查
                    instance = new Singleton();    // 非原子操作
                }
            }
        }
        return instance;
    }
}
```

`new Singleton()` 实际是三步：

1. 分配内存。
2. 调用构造函数初始化。
3. 把引用指向内存地址。

如果不用 volatile，指令可能重排成 1 → 3 → 2。线程 A 执行到 3（还没执行 2），线程 B 在第一次检查时看到 `instance != null`，直接返回一个**未完全初始化**的对象。volatile 的 StoreStore 屏障禁止了 2 和 3 的重排序。

**场景三：发布安全对象（配合 final）**

```java
// volatile 引用 + 不可变对象 = 安全发布
private volatile Configuration config;

public void updateConfig(Configuration newConfig) {
    this.config = newConfig;  // volatile 写，对其他线程可见
}
```

### 2.4 volatile 不适用的场景

- 复合操作（`++`、`+=`、`check-then-act`）→ 用 `synchronized` 或原子类。
- 需要互斥的临界区 → 用锁。

---

## 3. CAS 与原子类

### 3.1 CAS 原理

CAS（Compare And Swap）是一条 CPU 原子指令（x86 的 `cmpxchg`）。语义：

```
比较内存值 V 和预期值 A：
  如果 V == A，把 V 更新为新值 B，返回 true
  如果 V != A，说明被别人改过了，返回 false（什么都不做）
```

Java 的 CAS 通过 `Unsafe` 类实现（底层调 native）：

```java
// Unsafe.compareAndSwapInt(Object, offset, expected, new)
//    成功返回 true，失败返回 false
```

`AtomicInteger.incrementAndGet()` 的核心：

```java
public final int incrementAndGet() {
    int prev, next;
    do {
        prev = get();          // 读当前值
        next = prev + 1;       // 计算新值
    } while (!compareAndSet(prev, next));  // CAS 自旋，直到成功
    return next;
}
```

CAS 是**乐观锁**思想：先操作，提交时检查有没有冲突，冲突了就重试。

### 3.2 CAS 的三个问题

**问题一：ABA**

线程 1 读到 A，线程 2 把 A 改成 B 再改回 A，线程 1 的 CAS 仍然成功，但它不知道中间发生过变化。

解决：`AtomicStampedReference`，给值加一个版本号，CAS 同时比较值和版本号。

```java
AtomicStampedReference<Integer> ref = new AtomicStampedReference<>(100, 0);

// 线程 1
int[] stamp = new int[1];
int value = ref.get(stamp);     // value=100, stamp[0]=0
// 做些事...
ref.compareAndSet(value, 200, stamp[0], stamp[0] + 1);
```

**问题二：自旋开销**

CAS 失败后不断重试（自旋），竞争激烈时大量 CPU 空转。

解决：`LongAdder` 用分段 CAS（见 3.4），减少热点竞争。

**问题三：只能保证一个变量的原子性**

CAS 一次只能操作一个内存位置。多个变量需要原子操作时，要么用锁，要么把它们封装成一个对象用 `AtomicReference`。

### 3.3 JUC 原子类一览

| 类 | 用途 |
| --- | --- |
| `AtomicInteger` / `AtomicLong` | 基本类型原子操作 |
| `AtomicBoolean` | 布尔标志位 |
| `AtomicReference<V>` | 引用类型原子操作 |
| `AtomicStampedReference<V>` | 带版本号，解决 ABA |
| `AtomicIntegerArray` | 数组元素的原子操作 |
| `LongAdder` | 高并发计数器，性能优于 `AtomicLong` |
| `LongAccumulator` | 支持自定义累加函数 |
| `DoubleAdder` | double 版本的 LongAdder |

### 3.4 LongAdder：分段 CAS

`AtomicLong` 在高并发下所有线程都 CAS 同一个 value，竞争激烈导致大量自旋。`LongAdder` 的思路是**分而治之**：

```
LongAdder 内部：
  base（long）       ─→ 无竞争时直接 CAS base
  Cell[] cells       ─→ 有竞争时，每个线程 CAS 自己的 Cell
```

`sum()` 时把 base + 所有 Cell 累加。空间换时间：N 个 Cell 把竞争分散到 N 个槽位，每个槽位竞争概率降低。

```
AtomicLong：  N 个线程竞争 1 个 value  ─→ 高冲突
LongAdder：   N 个线程分散到 N 个 Cell ─→ 低冲突
```

适用场景：高并发计数器（如统计 QPS、调用次数）。不适合需要精确实时值的场景（`sum()` 不是原子快照，遍历 Cell 期间可能变化）。

### 3.5 Unsafe

`Unsafe` 是 CAS 的底层入口，提供直接内存操作：

```java
public native boolean compareAndSwapInt(Object o, long offset, int expected, int x);
public native void putOrderedObject(Object o, long offset, Object x);  // 延迟写屏障
public native long objectFieldOffset(Field f);  // 获取字段偏移量
```

JDK 9+ 提供了 `VarHandle` 作为 Unsafe 的安全替代，但 Unsafe 仍是大量 JUC 源码的基础。面试知道"CAS 靠 Unsafe 调 native，底层是 CPU 的 cmpxchg 指令"即可。

---

## 4. ConcurrentHashMap

### 4.1 为什么不用 HashMap + synchronized

`HashMap` 多线程 put 可能导致链表成环（JDK 7 头插法）或丢数据（JDK 8 虽然尾插，但仍非线程安全）。`Collections.synchronizedMap` 和 `Hashtable` 用一把全局锁，并发度低。`ConcurrentHashMap` 的目标是**读不加锁、写细粒度锁、高并发**。

### 4.2 JDK 7：分段锁（Segment）

```
ConcurrentHashMap
  └─ Segment[]（默认 16 段，继承 ReentrantLock）
       └─ HashEntry[]（每个 Segment 内部的桶数组）
            └─ HashEntry 链表
```

- 每个 Segment 是一把独立的锁，不同 Segment 的写操作互不影响，并发度 = Segment 数量（默认 16）。
- 读操作不加锁，靠 `volatile` 修饰 HashEntry 的 value 和 next 保证可见性。

### 4.3 JDK 8：CAS + synchronized

JDK 8 抛弃了 Segment，结构回归到 `Node[]` 数组 + 链表 / 红黑树，和 HashMap 类似，但线程安全：

```
ConcurrentHashMap
  └─ Node[] table（桶数组）
       └─ Node 链表 / TreeBin（红黑树代理）
```

**put 流程**（核心逻辑）：

```java
final V putVal(K key, V value, boolean onlyIfAbsent) {
    int hash = spread(key.hashCode());
    int binCount = 0;
    for (Node<K,V>[] tab = table;;) {
        Node<K,V> f; int n, i, fh;
        // 1. 表为空，初始化（CAS）
        if (tab == null || (n = tab.length) == 0)
            tab = initTable();
        // 2. 目标桶为空，CAS 放入（无锁）
        else if ((f = tabAt(tab, i = (n - 1) & hash)) == null) {
            if (casTabAt(tab, i, null, new Node<>(hash, key, value, null)))
                break;
        }
        // 3. 正在扩容（MOVED = -1），帮忙迁移
        else if ((fh = f.hash) == MOVED)
            tab = helpTransfer(tab, f);
        // 4. 桶非空，synchronized 锁住头节点
        else {
            synchronized (f) {
                if (tabAt(tab, i) == f) {  // 二次检查，防扩容
                    // 链表或树遍历，put / replace
                }
            }
            if (binCount >= TREEIFY_THRESHOLD)
                treeifyBin(tab, i);  // 链表 → 红黑树
            break;
        }
    }
    addCount(1L, binCount);  // 用 LongAdder 思路更新 size
    return null;
}
```

**关键设计**：

| 操作 | 机制 |
| --- | --- |
| 空桶写入 | CAS（无锁），竞争最小 |
| 非空桶写入 | `synchronized` 锁头节点，粒度细到一个桶 |
| 读（get） | 完全不加锁，Node 的 val 和 next 用 `volatile` 修饰 |
| size | 用类似 LongAdder 的 `baseCount` + `CounterCell[]` 分段计数 |
| 扩容 | 多线程协助迁移，每个线程负责一段桶（`transfer`） |

### 4.4 为什么 JDK 8 用 synchronized 而不是 ReentrantLock

1. **锁粒度更细**：JDK 7 锁的是 Segment（一段多个桶），JDK 8 锁的是单个桶的头节点，粒度更小。
2. **synchronized 优化**：JDK 6 之后 synchronized 经历了偏向锁、轻量级锁、锁消除等优化，在低竞争下性能不输 ReentrantLock。
3. **空桶 CAS + 非空桶 synchronized**：大部分写入落在空桶时走无锁 CAS，只有冲突时才加锁，整体更高效。

### 4.5 size 的实现

`ConcurrentHashMap` 的 `size()` 不是遍历所有桶计数（太慢），而是维护一个 `baseCount` + `CounterCell[]`：

```
put/remove 时：
  先 CAS 更新 baseCount
  CAS 失败（竞争）→ 在 CounterCell[随机槽] 上 CAS 累加

size() = baseCount + Σ CounterCell[i].value
```

这就是 `LongAdder` 的思路，高并发下把计数竞争分散到多个 Cell。代价是 `size()` 返回的是一个**近似值**（遍历期间可能变化），不是精确快照。

---

## 5. CompletableFuture：异步编排

### 5.1 为什么需要

`Future` 的局限：`get()` 是阻塞的，无法在结果就绪后自动回调，也无法链式组合多个异步任务。`CompletableFuture` 解决的是**异步任务的编排**。

### 5.2 创建与基本用法

```java
// 异步执行，使用 ForkJoinPool.commonPool()
CompletableFuture<String> future = CompletableFuture.supplyAsync(() -> {
    return queryUser(userId);
});

// 注册回调（不阻塞）
future.thenAccept(user -> {
    log.info("用户: {}", user);
});

// 铻式组合
CompletableFuture.supplyAsync(() -> queryUser(userId))       // 查用户
    .thenApply(user -> enrichUser(user))                      // 补全信息
    .thenCompose(user -> CompletableFuture.supplyAsync(       // 再异步查订单
        () -> queryOrders(user.getId())))
    .thenAccept(orders -> log.info("订单: {}", orders));
```

### 5.3 组合方法对比

| 方法 | 语义 | 输入 |
| --- | --- | --- |
| `thenApply(fn)` | 同步转换结果 | `T → U` |
| `thenAccept(con)` | 消费结果，无返回值 | `T → void` |
| `thenRun(run)` | 不关心结果，执行动作 | `Runnable` |
| `thenCompose(fn)` | 链接另一个异步（扁平化） | `T → CompletableFuture<U>` |
| `thenCombine(other, fn)` | 等两个 future 都完成，合并结果 | `(T, U) → V` |
| `allOf(f1, f2, ...)` | 等所有完成 | 无返回值（需自己 join 取值） |
| `anyOf(f1, f2, ...)` | 任一完成即返回 | 最先完成的那个值 |

### 5.4 常见用法：并行查询后合并

```java
CompletableFuture<User> userFuture = CompletableFuture
        .supplyAsync(() -> userService.getById(userId), userExecutor);
CompletableFuture<List<Order>> orderFuture = CompletableFuture
        .supplyAsync(() -> orderService.listByUserId(userId), orderExecutor);
CompletableFuture<Credit> creditFuture = CompletableFuture
        .supplyAsync(() -> creditService.getByUserId(userId), creditExecutor);

// 三个并行执行，等全部完成
CompletableFuture.allOf(userFuture, orderFuture, creditFuture).join();

UserVO vo = new UserVO();
vo.setUser(userFuture.join());
vo.setOrders(orderFuture.join());
vo.setCredit(creditFuture.join());
```

三个查询并行执行，总耗时 ≈ max(三个查询耗时)，而不是串行累加。

### 5.5 注意事项

- **自定义线程池**：`supplyAsync` 不传 Executor 时用 `ForkJoinPool.commonPool()`，它的线程数 = CPU 核数 - 1，做阻塞 IO 会很快耗尽。IO 密集型任务务必传自定义线程池。
- **异常处理**：用 `exceptionally` 或 `handle` 兜底，否则异常被吞在 future 里，`join()` 时才抛出。
- **避免在 thenApply 里做阻塞调用**：阻塞会占用回调线程。如果后续是 IO，用 `thenComposeAsync` 切到异步。
- **`join()` vs `get()`**：`get()` 抛检查异常 `InterruptedException`；`join()` 抛 `CompletionException`（非检查），代码更干净。

```java
future.exceptionally(ex -> {
    log.error("异步任务失败", ex);
    return fallbackValue;
});
```

---

## 6. 并发安全速查

| 场景 | 工具 | 说明 |
| --- | --- | --- |
| 状态标志位 | `volatile` | 只需要可见性，不需要原子性 |
| 简单计数器（低并发） | `AtomicLong` | CAS 自旋 |
| 高并发计数器 | `LongAdder` | 分段 CAS，减少冲突 |
| 单变量原子操作 | `AtomicReference` | 引用级 CAS |
| 临界区互斥 | `synchronized` / `ReentrantLock` | 见 [synchronized](/notes/java-backend/synchronized) / [Lock](/notes/java-backend/java-lock) |
| 读多写少的 Map | `ConcurrentHashMap` | 读无锁、写细粒度 |
| 读多写少的缓存 | `ReentrantReadWriteLock` | 读写分离 |
| 生产-消费队列 | `BlockingQueue` | `ArrayBlockingQueue` / `LinkedBlockingQueue` |
| 异步任务编排 | `CompletableFuture` | 链式、并行、合并 |
| 线程隔离上下文 | `ThreadLocal` | 见 [ThreadLocal](/notes/java-backend/threadlocal) |
| 定时 / 周期任务 | `ScheduledExecutorService` | 见 [线程池](/notes/java-backend/java-thread-pools) |

---

## 7. 检查清单

- [ ] 能说清 JMM 的主内存 / 工作内存抽象和 happens-before 八条规则。
- [ ] 知道 volatile 保证可见性和有序性，但不保证原子性。
- [ ] 能解释 DCL 单例为什么必须加 volatile（指令重排序 + 内存屏障）。
- [ ] 能说清 CAS 的原理（Unsafe + CPU cmpxchg）和三个问题（ABA / 自旋 / 单变量）。
- [ ] 知道 LongAdder 分段 CAS 的思路和适用场景。
- [ ] 能说清 ConcurrentHashMap JDK 8 的 put 流程（空桶 CAS / 非空桶 synchronized）。
- [ ] 知道 ConcurrentHashMap 的 size 用分段计数（LongAdder 思路），返回的是近似值。
- [ ] 能用 CompletableFuture 做并行查询合并，知道要传自定义线程池。

## 关联笔记

- [Java synchronized](/notes/java-backend/synchronized)
- [Java Lock](/notes/java-backend/java-lock)
- [Java ThreadLocal](/notes/java-backend/threadlocal)
- [JDK 常见线程池](/notes/java-backend/java-thread-pools)
