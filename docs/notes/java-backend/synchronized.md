---
title: Java synchronized
sidebarTitle: synchronized
---

# Java synchronized

> 多线程同时读写同一个共享变量时，"读-改-写"不是原子操作，会丢失更新。`synchronized` 是 Java 内建的锁机制，用来保证同一时刻只有一个线程能进入临界区。它只在一个 JVM 内有效，不是分布式锁。本篇从问题出发，逐步展开锁机制、锁升级和底层实现。

## 解决什么问题

先看一个最典型的并发问题："读-改-写"不是原子操作：

```java
private int count = 0;

public void increment() {
    count++;
}
```

`count++` 看似一行，实际包含三步：

```text
读取 count。
加 1。
写回 count。
```

多线程同时执行会丢失更新——两个线程都读到了同一个旧值，各自加 1 后写回，结果只加了 1 而不是 2。加锁后同一时刻只有一个线程能进临界区：

```java
private int count = 0;

public synchronized void increment() {
    count++;
}
```

这就是 `synchronized` 解决的核心问题：同一 JVM 内多个线程访问共享数据时的竞态条件。

## 它锁的是什么

`synchronized` 锁的是对象监视器，也就是 monitor。

三种常见写法：

```java
public synchronized void updateStock() {
    // 锁当前对象 this
}
```

```java
public static synchronized void refreshConfig() {
    // 锁当前 Class 对象
}
```

```java
private final Object lock = new Object();

public void updateStock() {
    synchronized (lock) {
        // 锁指定对象
    }
}
```

锁对象不同，就不是同一把锁。

```java
public void wrong() {
    synchronized (new Object()) {
        // 每次都是新锁，等于没锁
    }
}
```

## 字节码：monitorenter / monitorexit

同步代码块编译后是一对 monitor 指令：

```text
monitorenter      // 进入：获取对象 monitor
...临界区...
monitorexit       // 正常退出释放
monitorexit       // 异常路径也释放（编译器额外生成）
```

有两个 `monitorexit` 是为了保证抛异常时也能释放锁，这就是 `synchronized` "自动释放、不会忘 unlock"的来源。

同步**方法**没有 monitor 指令，而是在方法的 access flags 上打了 `ACC_SYNCHRONIZED`，JVM 调用时隐式做加锁解锁，本质一样。

## 锁信息存在对象头的 Mark Word

每个 Java 对象在堆里都有对象头，其中 **Mark Word** 存着锁状态。它会随锁状态复用同一块空间存不同内容：

| 锁状态 | 锁标志位 | Mark Word 主要存什么 |
| --- | --- | --- |
| 无锁 | 01 | 对象 hashCode、分代年龄 |
| 偏向锁 | 01（偏向位 1） | 持有偏向的线程 ID、epoch |
| 轻量级锁 | 00 | 指向栈中 Lock Record 的指针 |
| 重量级锁 | 10 | 指向 ObjectMonitor 的指针 |
| GC 标记 | 11 | — |

这就解释了一个常见追问：**为什么调用了 `hashCode()` 的对象不能用偏向锁**——因为偏向锁要用 Mark Word 那块空间存线程 ID，而 identity hashCode 也占同一块，已经算出 hashCode 就没地方放偏向信息了，只能直接走轻量级锁。

## 锁升级

为了在"几乎没竞争"到"激烈竞争"的不同场景下都不太亏，`synchronized` 的锁会升级，且**只升不降**：

```text
无锁 -> 偏向锁 -> 轻量级锁 -> 重量级锁
```

### 偏向锁

只有一个线程反复进同一把锁时，连 CAS 都嫌贵。偏向锁第一次获取时用 CAS 把线程 ID 写进 Mark Word，之后该线程再进来，只要发现 Mark Word 里是自己的 ID，**不做任何同步操作**直接进。

代价是一旦有别的线程来竞争，要先"撤销偏向"，撤销需要到安全点 stop 持有线程，有成本。所以 **偏向锁在 JDK 15（JEP 374）已被废弃并默认关闭**，新版本里基本不用纠结它，有竞争直接走轻量级锁。

### 轻量级锁

竞争不激烈（以交替执行为主）时用。线程在自己栈帧里建一个 Lock Record，把对象的 Mark Word 复制进去（叫 Displaced Mark Word），再用 CAS 把对象 Mark Word 指向这个 Lock Record：

- CAS 成功：拿到轻量级锁。
- CAS 失败：说明有竞争，线程**自旋**重试一会儿（自适应自旋）。

轻量级锁的好处是在没竞争或短竞争时，避免了操作系统级的线程阻塞。

### 重量级锁

自旋还拿不到，说明竞争激烈，升级为重量级锁，Mark Word 指向一个 `ObjectMonitor`。拿不到锁的线程被**真正阻塞**（park），由操作系统的 mutex 调度，不再空转 CPU。

```text
竞争程度低  -> 偏向 / 轻量级，尽量不阻塞，省上下文切换
竞争程度高  -> 重量级，阻塞挂起，省 CPU 空转
```

## 底层 Monitor（ObjectMonitor）

重量级锁背后是 HotSpot 的 `ObjectMonitor`，关键字段：

| 字段 | 作用 |
| --- | --- |
| `_owner` | 当前持有锁的线程 |
| `_recursions` | 重入次数 |
| `_EntryList` | 等待获取锁的线程队列 |
| `_WaitSet` | 调用了 `wait()` 被挂起的线程队列 |

`wait()` 把线程放进 `_WaitSet`，`notify()` 从 `_WaitSet` 挑一个挪回竞争队列。这也是为什么 `wait/notify` 必须在 `synchronized` 里调用——它们操作的就是这个 monitor 的内部队列。

## 可重入

`synchronized` 是可重入锁，靠 monitor 的 `_recursions` 计数实现：同一线程再次进入计数加一，退出减一，归零才真正释放。

```java
public synchronized void outer() {
    inner();
}

public synchronized void inner() {
    // 同一个线程可以再次进入
}
```

如果不可重入，`outer()` 调 `inner()` 会把自己锁死。

## 可见性和 happens-before

`synchronized` 不只保证互斥，也保证可见性。

规则：

```text
一个线程释放锁之前的写入，
对另一个随后获取同一把锁的线程可见。
```

所以这类代码能看到最新值：

```java
private boolean running = true;

public synchronized void stop() {
    running = false;
}

public synchronized boolean isRunning() {
    return running;
}
```

前提是读写都使用同一把锁。底层靠的是释放锁时把工作内存刷回主内存、获取锁时从主内存重新读。

这只是 happens-before 八条规则中的「锁规则」一条。完整的 JMM 模型、happens-before 全部规则、内存屏障、`volatile` 的可见性机制见 [Java 并发深度](/notes/java-backend/java-concurrency)，本篇不重复。

## JIT 的两个优化

面试加分项：

- **锁消除**：JIT 通过逃逸分析发现锁对象不可能被多线程共享（比如方法内的局部 `StringBuffer`），直接把锁去掉。
- **锁粗化**：连续多次对同一对象加解锁（比如循环里反复 append），JIT 把锁的范围合并成一个大锁，减少反复加解锁的开销。

## 锁粒度

不要把大段耗时代码都放进锁里。

不推荐：

```java
public synchronized OrderVO createOrder(CreateOrderRequest request) {
    ProductDO product = productMapper.selectById(request.getProductId());
    paymentClient.prepay(request);
    return saveOrder(request, product);
}
```

问题：

- 数据库查询期间持锁。
- 远程调用期间持锁。
- 锁竞争会被放大。

更稳：

```java
public OrderVO createOrder(CreateOrderRequest request) {
    ProductDO product = productMapper.selectById(request.getProductId());

    synchronized (stockLock(request.getProductId())) {
        checkAndReserveStock(product, request.getCount());
    }

    return saveOrder(request, product);
}
```

真实项目里，跨 JVM 的库存扣减不能靠 `synchronized`，要用数据库条件更新、Redis 分布式锁或 MQ 串行化。

## 不要锁这些对象

不推荐锁：

```java
synchronized (String.valueOf(userId)) {}
synchronized (Integer.valueOf(id)) {}
synchronized (this) {}
synchronized (SomeService.class) {}
```

原因：

| 锁对象 | 风险 |
| --- | --- |
| 字符串 | 字符串常量池可能被其他代码复用成同一把锁 |
| 包装类型 | `Integer` 缓存（-128~127）等对象会被复用 |
| `this` | 外部代码也可能拿到这个对象加锁 |
| `Class` | 锁范围过大，影响整个类 |

推荐用私有 final 锁对象：

```java
private final Object lock = new Object();
```

或者按业务 key 管理锁对象，但要防止锁对象 map 无限增长。

## `wait` 和 `notify`

`wait`、`notify` 必须在持有同一把 monitor 时调用。

```java
synchronized (lock) {
    while (!ready) {
        lock.wait();
    }
    doWork();
}
```

唤醒：

```java
synchronized (lock) {
    ready = true;
    lock.notifyAll();
}
```

注意：

- 用 `while`，不要用 `if`，因为可能虚假唤醒。
- 优先 `notifyAll`，避免只唤醒了不满足条件的线程。
- 业务项目里更常用 `BlockingQueue`、`CountDownLatch`、`Condition`，很少直接写 `wait/notify`。

## 和分布式锁的区别

`synchronized` 只在一个 JVM 内有效。

```text
单机多线程：
    synchronized 可以保护共享变量。

多实例部署：
    A 机器和 B 机器各有自己的 JVM，各有自己的锁。
```

比如两个应用实例同时扣库存：

```text
实例 A 拿到自己的 synchronized 锁。
实例 B 也拿到自己的 synchronized 锁。
两个实例仍然可能同时扣库存。
```

这种场景要靠：

- MySQL 条件更新。
- Redis 分布式锁。
- MQ 按商品维度串行消费。
- 乐观锁版本号。

## 常见坑

### 锁错对象

```java
public void update(Long productId) {
    synchronized (productId) {
        // Long 包装对象不适合作为锁
    }
}
```

### 锁太大

```java
public synchronized void exportReport() {
    // 查询、计算、写文件全部串行
}
```

### 锁里调用外部系统

```java
synchronized (lock) {
    paymentClient.refund(orderNo);
}
```

外部调用慢或超时，会拖住所有等待这把锁的线程。

### 以为它能防重复请求

如果服务部署两台，`synchronized` 不能防止两个实例同时处理同一个请求。接口幂等要靠：

- 幂等 key。
- 数据库唯一约束。
- 状态机条件更新。
- Redis key。

## 什么时候用

适合：

- 单 JVM 内保护小段临界区。
- 本地内存状态。
- 低到中等竞争。
- 不需要超时、可中断、公平锁。

不适合：

- 分布式场景。
- 长耗时业务。
- 高并发热点锁。
- 需要 `tryLock` 超时返回。
- 需要多个条件队列。

## 和 `Lock` 怎么选

| 需求 | 推荐 |
| --- | --- |
| 简单互斥 | `synchronized` |
| 自动释放锁 | `synchronized` |
| 尝试获取锁失败直接返回 | `ReentrantLock.tryLock` |
| 等锁时允许中断 | `ReentrantLock.lockInterruptibly` |
| 超时获取 | `ReentrantLock.tryLock(timeout)` |
| 多个条件队列 | `Condition` |
| 读多写少 | `ReadWriteLock` |

能用 `synchronized` 简单解决就别硬上 `Lock`，需要更强控制时再用。`Lock` 的原理（AQS）见 [Java Lock](/notes/java-backend/java-lock)。

## 检查清单

- [ ] 能说出锁信息存在对象头 Mark Word，及四种锁状态。
- [ ] 能讲清无锁 → 偏向 → 轻量级 → 重量级的升级条件和只升不降。
- [ ] 知道偏向锁在 JDK 15 已默认关闭及原因。
- [ ] 能说出重量级锁靠 ObjectMonitor，wait/notify 操作 `_WaitSet`。
- [ ] 锁对象稳定且私有，不锁字符串 / 包装类型。
- [ ] 锁粒度足够小，锁内不做慢查询和远程调用。
- [ ] 读写共享变量使用同一把锁。
- [ ] 不把单机锁当分布式锁；需要 tryLock / 超时就用 Lock。

## 关联笔记

- [Java 并发深度](/notes/java-backend/java-concurrency)（JMM / happens-before / volatile 的完整框架）
- [Java Lock](/notes/java-backend/java-lock)
- [Redis 分布式锁](/notes/redis/distributed-lock)
