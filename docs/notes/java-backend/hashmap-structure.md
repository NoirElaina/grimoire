---
title: Java HashMap 结构
sidebarTitle: HashMap 结构
---

# Java HashMap 结构

> `HashMap` 的重点不是“数组 + 链表 + 红黑树”这句口号，而是：key 怎么定位桶、冲突怎么处理、什么时候扩容、什么时候链表转红黑树。

## 基本结构

Java 8 之后，`HashMap` 可以理解成：

```text
HashMap
  -> Node<K,V>[] table
      -> bucket 0
      -> bucket 1
          -> Node 链表 / TreeNode 红黑树
      -> bucket 2
```

每个元素大致是：

```text
hash
key
value
next
```

同一个桶里发生 hash 冲突时：

```text
先用链表挂在桶后面。
链表太长并且数组容量足够时，转成红黑树。
```

## put 流程

简化流程：

```text
put(key, value)
  -> 计算 key.hashCode()
  -> 做 hash 扰动
  -> 根据数组长度算桶下标
  -> 桶为空：直接放入
  -> 桶不为空：
      -> key 相同：覆盖 value
      -> key 不同：挂到链表或红黑树
  -> size 超过阈值：扩容
```

桶下标不是简单取模。

常见逻辑是：

```text
index = (table.length - 1) & hash
```

所以数组长度通常保持 2 的幂。

## hash 扰动

如果只用原始 `hashCode()` 的低位，低位分布不好时容易冲突。

所以会做扰动：

```text
hash = h ^ (h >>> 16)
```

目的：

```text
让高位信息参与低位运算，减少桶冲突。
```

这不是加密 hash，只是为了让桶分布更均匀。

## 负载因子和扩容

默认：

```text
初始容量：16
负载因子：0.75
扩容阈值：capacity * loadFactor
```

当元素数量超过阈值：

```text
扩容为原来的 2 倍。
重新分布桶里的元素。
```

为什么默认负载因子是 0.75：

```text
太低：空间浪费。
太高：冲突变多。
0.75 是时间和空间的折中。
```

如果能预估大小，初始化容量：

```java
Map<Long, ProductDO> map = new HashMap<>(expectedSize * 4 / 3 + 1);
```

避免频繁扩容。

## 链表转红黑树

关键阈值：

```text
TREEIFY_THRESHOLD = 8
UNTREEIFY_THRESHOLD = 6
MIN_TREEIFY_CAPACITY = 64
```

意思是：

```text
当某个桶里的链表长度达到 8，并且数组容量至少 64，链表可能转成红黑树。

如果数组容量还不到 64，优先扩容，而不是树化。

当红黑树节点数量减少到 6 左右，可能退化回链表。
```

为什么容量小于 64 时优先扩容：

```text
容量小导致的冲突，扩容后可能自然分散。
没必要急着树化。
```

为什么转红黑树：

```text
链表查询是 O(n)。
红黑树查询大致是 O(log n)。
当大量 key 冲突时，红黑树能降低最坏情况查询成本。
```

## 为什么链表阈值是 8

不要死背“因为 8 好”。

可以这样理解：

```text
正常 hash 分布下，一个桶里挂很多节点的概率很低。
链表短时，链表比红黑树更简单，维护成本更低。
链表长到一定程度后，查询成本变高，才值得转树。
```

所以阈值设计是一种折中：

- 链表短：维护链表。
- 链表长：转红黑树。
- 数组小：先扩容分散冲突。

## get 流程

```text
get(key)
  -> key 计算 hash
  -> 定位桶
  -> 桶为空：返回 null
  -> 桶第一个节点 key 匹配：返回 value
  -> 如果是链表：逐个比较
  -> 如果是红黑树：按树查找
```

比较 key 时会用：

```text
hash 相等
key == node.key 或 key.equals(node.key)
```

所以自定义 key 必须正确实现：

- `hashCode`
- `equals`

## HashMap 为什么线程不安全

`HashMap` 没有并发控制。

多线程同时 put 可能导致：

- 数据覆盖。
- size 不准确。
- 扩容过程不安全。
- 读到中间状态。

并发场景用：

```java
ConcurrentHashMap
```

不要：

```java
private static final Map<Long, ProductDO> CACHE = new HashMap<>();
```

然后多个线程随便读写。

## 和 HashSet 的关系

`HashSet` 底层通常就是 `HashMap`。

可以理解为：

```text
HashSet.add(value)
  -> HashMap.put(value, PRESENT)
```

所以 `HashSet` 去重也依赖：

- `hashCode`
- `equals`

## 常见项目坑

### 自定义 key 没重写 equals/hashCode

```java
Map<ProductKey, ProductDO> map = new HashMap<>();
map.put(new ProductKey(1L, 2L), product);
map.get(new ProductKey(1L, 2L)); // 可能拿不到
```

### 可变对象当 key

```java
ProductKey key = new ProductKey(1L, 2L);
map.put(key, product);

key.setSkuId(3L);
map.get(key); // 可能拿不到
```

key 的 hash 变了，位置就乱了。

### 没预估容量

批量组装 10 万条数据时，如果不设置容量，会多次扩容。

### 并发使用 HashMap

并发读写用 `ConcurrentHashMap`。

### `Collectors.toMap` key 重复

```java
products.stream()
        .collect(Collectors.toMap(ProductDO::getCategoryId, Function.identity()));
```

如果 `categoryId` 重复，会抛异常。

要写合并函数。

## 回答模板

可以这样讲：

```text
HashMap 底层是数组加桶结构。
数组元素是 Node，冲突时先形成链表。
Java 8 以后，当某个桶链表长度达到 8 且数组容量至少 64，会转成红黑树，降低大量冲突时的查询成本。
如果容量还不到 64，优先扩容，因为扩容后冲突可能被分散。

HashMap 默认容量 16，负载因子 0.75。
put 时先对 hashCode 做扰动，再用 length - 1 与 hash 计算桶下标。
超过阈值会扩容为两倍。

它不是线程安全的，多线程并发读写要用 ConcurrentHashMap。
自定义 key 必须正确实现 equals 和 hashCode，且不要用可变对象当 key。
```

## 检查清单

- [ ] 自定义 key 是否实现 `equals` 和 `hashCode`。
- [ ] key 是否不可变。
- [ ] 大 map 是否设置初始容量。
- [ ] 是否处理 `Collectors.toMap` 重复 key。
- [ ] 并发场景是否使用 `ConcurrentHashMap`。
- [ ] 是否理解树化阈值和容量阈值。

## 参考

- [Java HashMap API](https://docs.oracle.com/javase/8/docs/api/java/util/HashMap.html)
- [OpenJDK HashMap source](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/HashMap.java)

