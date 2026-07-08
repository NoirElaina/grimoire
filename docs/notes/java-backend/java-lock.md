---
title: Java Lock
sidebarTitle: Lock
---

# Java Lock

> `Lock` 比 `synchronized` 更灵活：可以尝试加锁、超时加锁、可中断加锁、公平锁、多个条件队列。代价是必须手动释放锁。源码题里的核心是它们背后的 AQS：一个 `state` 加一个等待队列，撑起了 `ReentrantLock`、`ReentrantReadWriteLock`、`Semaphore`、`CountDownLatch`。

## 最小正确写法

```java
private final ReentrantLock lock = new ReentrantLock();

public void update() {
    lock.lock();
    try {
        doUpdate();
    } finally {
        lock.unlock();
    }
}
```

重点：

- `lock()` 后必须 `finally unlock()`。
- 不要在 `try` 之前写复杂逻辑。
- 异常路径也要释放锁。

错误：

```java
lock.lock();
doUpdate();   // 抛异常则锁永远不释放
lock.unlock();
```

和 `synchronized` 自动释放不同，`Lock` 忘了 `unlock` 就是死锁源头。

## AQS：所有 Lock 的地基

`ReentrantLock` 等几乎所有 JUC 锁，内部都靠一个 `AbstractQueuedSynchronizer`（AQS）。AQS 只做两件事：

```text
1. 一个 volatile int state，表示“锁/资源”的状态
2. 一个 FCFS 双向等待队列（CLH 变体），存抢不到锁、被挂起的线程
```

- `state` 怎么解释由子类定：`ReentrantLock` 里它是重入次数，`Semaphore` 里是许可数，`CountDownLatch` 里是计数。
- 子类只需实现 `tryAcquire` / `tryRelease`（独占）或 `tryAcquireShared` / `tryReleaseShared`（共享），排队、park、唤醒这些复杂逻辑 AQS 全包了。

队列节点 `Node` 关键字段：

```text
prev / next  : 双向链表指针
thread       : 被挂起的线程
waitStatus   : SIGNAL(-1) 后继需被唤醒 / CANCELLED(1) 已取消 / CONDITION(-2) 在条件队列 ...
```

### acquire 大致流程

```java
public final void acquire(int arg) {
    if (!tryAcquire(arg) &&                 // 1. 先抢一次
        acquireQueued(addWaiter(Node.EXCLUSIVE), arg))  // 2. 抢不到入队并阻塞
        selfInterrupt();
}
```

```text
tryAcquire 成功            -> 直接拿锁返回
失败                      -> addWaiter 把当前线程包成 Node 加到队尾
acquireQueued 循环：
    前驱是 head 且再 tryAcquire 成功 -> 成为新 head，拿锁
    否则把前驱 waitStatus 置 SIGNAL -> LockSupport.park 挂起
```

### release 大致流程

```java
public final boolean release(int arg) {
    if (tryRelease(arg)) {           // state 减到 0
        Node h = head;
        if (h != null && h.waitStatus != 0)
            unparkSuccessor(h);      // 唤醒后继节点
        return true;
    }
    return false;
}
```

park/unpark 底层是 `LockSupport`（基于 `Unsafe`），靠“许可”阻塞和唤醒线程，比 `wait/notify` 更灵活（可先 unpark 再 park）。

## 重入与公平/非公平怎么实现

`ReentrantLock` 的重入：拿锁时如果发现 `owner` 就是当前线程，直接 `state++`，释放时 `state--`，归零才真正释放。

公平和非公平的差别只在 `tryAcquire` 一行：

```java
// 非公平：上来就抢，不管有没有人排队
if (c == 0) {
    if (compareAndSetState(0, acquires)) { setExclusiveOwnerThread(current); return true; }
}

// 公平：先看有没有前驱在排队
if (c == 0) {
    if (!hasQueuedPredecessors() && compareAndSetState(0, acquires)) { ... }
}
```

```java
ReentrantLock fairLock = new ReentrantLock(true);
ReentrantLock nonFairLock = new ReentrantLock(false);   // 默认
```

| 类型 | 含义 | 特点 |
| --- | --- | --- |
| 非公平锁 | 新线程可以插队抢锁 | 吞吐更高，默认 |
| 公平锁 | 基本按等待顺序获取 | 延迟更稳定，吞吐可能下降 |

非公平吞吐更高的原因：刚释放锁的瞬间，正好有个新线程来抢，省去了唤醒队列里线程、线程被唤醒再运行的上下文切换成本。项目里默认用非公平，只有明确要减少饥饿时才用公平。

## `tryLock`

“拿不到就失败或降级”的场景：

```java
if (!lock.tryLock()) {
    throw new BusinessException("操作太频繁，请稍后再试");
}
try {
    doUpdate();
} finally {
    lock.unlock();
}
```

带超时：

```java
if (!lock.tryLock(200, TimeUnit.MILLISECONDS)) {
    throw new BusinessException("系统繁忙，请稍后重试");
}
try {
    doUpdate();
} finally {
    lock.unlock();
}
```

注意 `tryLock()` 无参版本**总是非公平**（直接 CAS 抢一次），即使锁本身构造成公平锁。

## `lockInterruptibly`

普通 `lock()` 等锁时不响应中断，`lockInterruptibly()` 允许等待中的线程被中断退出：

```java
lock.lockInterruptibly();
try {
    doUpdate();
} finally {
    lock.unlock();
}
```

适合任务可取消、后台任务关闭、线程池优雅停机。

## `Condition`

`Condition` 是 AQS 之上更精细的 `wait/notify`，**一把锁可以有多个条件队列**：

```java
private final ReentrantLock lock = new ReentrantLock();
private final Condition notEmpty = lock.newCondition();
private final Queue<OrderEvent> queue = new ArrayDeque<>();

public void put(OrderEvent event) {
    lock.lock();
    try {
        queue.offer(event);
        notEmpty.signal();
    } finally {
        lock.unlock();
    }
}

public OrderEvent take() throws InterruptedException {
    lock.lock();
    try {
        while (queue.isEmpty()) {
            notEmpty.await();   // while 防虚假唤醒
        }
        return queue.poll();
    } finally {
        lock.unlock();
    }
}
```

原理：AQS 里同步队列和条件队列是**两个队列**。`await()` 会先完全释放锁、把节点挪到条件队列并 park；`signal()` 把条件队列的首节点**转移回同步队列**重新参与抢锁。这就是它能支持多个条件队列（如 `notEmpty`/`notFull`）的原因，`ArrayBlockingQueue` 就是这么实现的。

业务里优先用 `BlockingQueue`，不要手写复杂队列。

## `ReadWriteLock`

读多写少用读写锁。`ReentrantReadWriteLock` 巧妙地把 AQS 那个 32 位 `state` 拆成两半：

```text
高 16 位：读锁持有数量（共享）
低 16 位：写锁重入次数（独占）
```

```java
private final ReentrantReadWriteLock lock = new ReentrantReadWriteLock();
private final Map<Long, ProductSnapshot> cache = new HashMap<>();

public ProductSnapshot get(Long productId) {
    lock.readLock().lock();
    try {
        return cache.get(productId);
    } finally {
        lock.readLock().unlock();
    }
}

public void put(Long productId, ProductSnapshot snapshot) {
    lock.writeLock().lock();
    try {
        cache.put(productId, snapshot);
    } finally {
        lock.writeLock().unlock();
    }
}
```

特点：读读并发、写写互斥、读写互斥。支持锁降级（持写锁时再获取读锁，再释放写锁），但不支持锁升级（持读锁直接获取写锁会死锁）。

不适合：写很多、临界区极短、或已经能用 `ConcurrentHashMap` 解决的场景。

## `StampedLock`

`StampedLock` 支持乐观读，且**不基于 AQS**：

```java
long stamp = stampedLock.tryOptimisticRead();   // 不加锁，拿一个版本戳
ProductSnapshot snapshot = this.snapshot;

if (!stampedLock.validate(stamp)) {              // 期间有写，升级为真正读锁
    stamp = stampedLock.readLock();
    try {
        snapshot = this.snapshot;
    } finally {
        stampedLock.unlockRead(stamp);
    }
}
```

乐观读连读锁都不加，只在事后校验版本戳，读极多写极少时性能最好。但它不可重入、用 stamp 解锁容易写错、不支持 Condition，普通业务不优先用。

## AQS 还撑起了这些

理解 AQS 后，这些工具就是“state 含义不同”而已：

| 类 | state 含义 | 模式 |
| --- | --- | --- |
| `ReentrantLock` | 重入次数 | 独占 |
| `ReentrantReadWriteLock` | 高 16 读 / 低 16 写 | 共享 + 独占 |
| `Semaphore` | 剩余许可数 | 共享 |
| `CountDownLatch` | 剩余计数 | 共享 |

`CountDownLatch` 的 `await` 就是共享获取（state 不为 0 就排队挂起），`countDown` 是共享释放（state 减到 0 时唤醒所有等待线程）。

## 和 `synchronized` 的区别

| 点 | `synchronized` | `Lock` |
| --- | --- | --- |
| 释放方式 | JVM 自动释放 | 必须手动 `unlock` |
| 实现 | 对象 monitor / 锁升级 | AQS（state + 队列） |
| 获取失败返回 | 不支持 | `tryLock` 支持 |
| 超时等待 | 不支持 | 支持 |
| 响应中断 | 等锁时不方便 | `lockInterruptibly` 支持 |
| 公平锁 | 只有非公平 | 可选公平 |
| 条件队列 | 一个 monitor wait set | 多个 `Condition` |
| 代码复杂度 | 低 | 高 |

能用 `synchronized` 简单解决就别硬上 `Lock`，需要更强控制时再用。

## 后端项目里的使用边界

可以用：单 JVM 本地状态保护、本地缓存刷新、防进程内重复执行任务、后台调度互斥。

不能兜：多实例下的订单重复创建、分布式库存扣减、支付回调幂等、MQ 重复消费。这些要靠数据库唯一约束、状态机条件更新、Redis 分布式锁、MQ 幂等表。

## 常见坑

### 忘记释放锁

```java
lock.lock();
if (invalid) {
    return;         // 锁没释放
}
lock.unlock();
```

### 锁内做远程调用

```java
lock.lock();
try {
    paymentClient.refund(orderNo);   // 慢调用拖住所有等待线程
} finally {
    lock.unlock();
}
```

### 用本地锁解决分布式问题

两台实例各有自己的 `ReentrantLock`，互相看不见。

### 过度使用公平锁

公平锁不是“更高级”，通常降低吞吐。

## 检查清单

- [ ] 能说清 AQS 是 state + 等待队列，子类只实现 tryAcquire/tryRelease。
- [ ] 能讲清 ReentrantLock 重入靠 state 累加，公平/非公平差在 `hasQueuedPredecessors`。
- [ ] 知道 Condition 的 await/signal 在同步队列与条件队列间转移节点。
- [ ] 知道读写锁用 state 高低 16 位分别记读写。
- [ ] 知道 Semaphore/CountDownLatch 也是 AQS 共享模式。
- [ ] 所有路径都在 `finally` 里 `unlock`。
- [ ] 需要 tryLock 超时 / 响应中断时才用 Lock。
- [ ] 锁内不做远程调用，不把本地锁当分布式锁。

## 关联笔记

- [Java synchronized](/notes/java-backend/synchronized)
- [Java 并发深度](/notes/java-backend/java-concurrency)（JMM / CAS / 并发容器的完整框架）
- [Redis 分布式锁故障场景](/notes/redis/distributed-lock-failover)
