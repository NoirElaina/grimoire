---
title: Java synchronized
sidebarTitle: synchronized
---

# Java synchronized

> `synchronized` 解决的是同一 JVM 内多个线程同时访问共享数据的问题。它不是分布式锁，也不能保护多台机器之间的并发。

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

## 解决什么问题

典型问题是“读-改-写”不是原子操作：

```java
private int count = 0;

public void increment() {
    count++;
}
```

`count++` 大致包含：

```text
读取 count。
加 1。
写回 count。
```

多线程同时执行会丢失更新。

加锁：

```java
private int count = 0;

public synchronized void increment() {
    count++;
}
```

同一时刻只有一个线程能进入这个方法。

## 可重入

`synchronized` 是可重入锁。

同一个线程已经拿到锁后，可以再次进入同一把锁保护的代码。

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

前提是读写都使用同一把锁。

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
| 字符串 | 字符串常量池可能被其他代码复用 |
| 包装类型 | 缓存对象可能被复用 |
| `this` | 外部代码也可能拿到这个对象加锁 |
| `Class` | 锁范围过大，影响整个类 |

推荐：

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

如果服务部署两台，`synchronized` 不能防止两个实例同时处理同一个请求。

接口幂等要靠：

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
| 多个条件队列 | `Condition` |
| 读多写少 | `ReadWriteLock` |

## 检查清单

- [ ] 锁对象是否稳定且私有。
- [ ] 锁粒度是否足够小。
- [ ] 锁内是否避免数据库慢查询和远程调用。
- [ ] 读写共享变量是否使用同一把锁。
- [ ] 是否误把单机锁当成分布式锁。
- [ ] 是否需要 `tryLock`，如果需要就不要硬用 `synchronized`。

## 关联笔记

- [Java Lock](/notes/java-backend/java-lock)
- [Redis 分布式锁](/notes/redis/distributed-lock)

