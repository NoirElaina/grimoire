---
title: Java Lock
sidebarTitle: Lock
---

# Java Lock

> `Lock` 比 `synchronized` 更灵活：可以尝试加锁、超时加锁、可中断加锁、公平锁、多个条件队列。但灵活的代价是必须手动释放锁。

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
- 不要忘记异常路径也要释放锁。

错误：

```java
lock.lock();
doUpdate();
lock.unlock();
```

如果 `doUpdate()` 抛异常，锁永远不释放。

## `tryLock`

`tryLock` 适合“拿不到锁就直接失败或降级”的场景。

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

适合：

- 防止线程一直阻塞。
- 热点资源保护。
- 接口快速失败。

## `lockInterruptibly`

普通 `lock()` 等锁时，不会因为线程中断而退出等待。

`lockInterruptibly()` 允许等待锁的线程响应中断。

```java
lock.lockInterruptibly();
try {
    doUpdate();
} finally {
    lock.unlock();
}
```

适合：

- 任务可取消。
- 后台任务关闭。
- 线程池优雅停机。

## 公平锁和非公平锁

```java
ReentrantLock fairLock = new ReentrantLock(true);
ReentrantLock nonFairLock = new ReentrantLock(false);
```

| 类型 | 含义 | 特点 |
| --- | --- | --- |
| 非公平锁 | 新线程可以插队抢锁 | 吞吐更高，默认选择 |
| 公平锁 | 基本按等待顺序获取锁 | 延迟更稳定，吞吐可能下降 |

项目里默认用非公平锁。

只有在明确需要减少饥饿、顺序等待很重要时，才考虑公平锁。

## `Condition`

`Condition` 类似更精细的 `wait/notify`。

一把 `ReentrantLock` 可以创建多个条件队列。

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
            notEmpty.await();
        }
        return queue.poll();
    } finally {
        lock.unlock();
    }
}
```

注意：

- `await()` 要放在 `while` 里。
- `signal()` 之前要持有同一把锁。
- 一般项目优先用 `BlockingQueue`，不要手写复杂队列。

## `ReadWriteLock`

读多写少可以用读写锁：

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

特点：

- 多个读锁可以并发。
- 写锁独占。
- 写锁和读锁互斥。

不适合：

- 写很多。
- 临界区很短，锁开销可能抵消收益。
- 已经可以用 `ConcurrentHashMap` 解决的问题。

## `StampedLock`

`StampedLock` 支持乐观读。

```java
long stamp = stampedLock.tryOptimisticRead();
ProductSnapshot snapshot = this.snapshot;

if (!stampedLock.validate(stamp)) {
    stamp = stampedLock.readLock();
    try {
        snapshot = this.snapshot;
    } finally {
        stampedLock.unlockRead(stamp);
    }
}
```

适合读非常多、写较少的场景。

但它更复杂：

- 不可重入。
- 使用 stamp 解锁，写错容易出问题。
- 普通业务不优先使用。

## 和 `synchronized` 的区别

| 点 | `synchronized` | `Lock` |
| --- | --- | --- |
| 释放方式 | JVM 自动释放 | 必须手动 `unlock` |
| 获取失败返回 | 不支持 | `tryLock` 支持 |
| 超时等待 | 不支持 | 支持 |
| 响应中断 | 等锁时不方便 | `lockInterruptibly` 支持 |
| 条件队列 | 一个 monitor wait set | 多个 `Condition` |
| 代码复杂度 | 低 | 高 |

能用 `synchronized` 简单解决，就不要硬上 `Lock`。

需要更强控制能力时，再用 `Lock`。

## 后端项目里的使用边界

可以用：

- 单 JVM 本地状态保护。
- 本地缓存刷新。
- 防止同一进程内重复执行任务。
- 后台调度任务互斥。

不能用来兜：

- 多实例部署下的订单重复创建。
- 分布式库存扣减。
- 支付回调幂等。
- MQ 重复消费。

这些要靠：

- 数据库唯一约束。
- 状态机条件更新。
- Redis 分布式锁。
- MQ 幂等表。

## 常见坑

### 忘记释放锁

```java
lock.lock();
if (invalid) {
    return;
}
lock.unlock();
```

`return` 之后锁没释放。

### 锁内做远程调用

```java
lock.lock();
try {
    paymentClient.refund(orderNo);
} finally {
    lock.unlock();
}
```

远程调用慢，会拖住所有等待线程。

### 用本地锁解决分布式问题

两台应用实例各有自己的 `ReentrantLock`，互相看不见。

### 过度使用公平锁

公平锁不是“更高级”，它通常会降低吞吐。

## 检查清单

- [ ] 是否真的需要 `Lock`，还是 `synchronized` 足够。
- [ ] 是否所有路径都在 `finally` 里释放锁。
- [ ] 是否需要 `tryLock` 超时失败。
- [ ] 是否需要响应中断。
- [ ] 是否避免锁内远程调用。
- [ ] 是否没有把本地锁当成分布式锁。
- [ ] 是否考虑了更合适的并发工具类，比如 `BlockingQueue`、`Semaphore`、`CountDownLatch`。

## 关联笔记

- [Java synchronized](/notes/java-backend/synchronized)
- [Redis 分布式锁故障场景](/notes/redis/distributed-lock-failover)

