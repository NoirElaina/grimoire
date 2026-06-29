---
title: Java 常用集合
sidebarTitle: Java 集合
---

# Java 常用集合

> 集合不是只背 `List`、`Set`、`Map`。每个常用实现都要能讲清三件事：底层是什么结构、由此决定了什么性能特征、项目里什么时候用。下面每个集合都按这个思路一次说透，而不是把原理和用法分开列。

## 集合体系

常用集合先按接口分：

| 接口 | 典型实现 | 解决的问题 |
| --- | --- | --- |
| `List` | `ArrayList`、`LinkedList` | 有序、可重复、按下标访问 |
| `Set` | `HashSet`、`LinkedHashSet`、`TreeSet` | 去重 |
| `Map` | `HashMap`、`LinkedHashMap`、`TreeMap`、`ConcurrentHashMap` | key/value 查询 |
| `Queue` | `ArrayDeque`、`PriorityQueue`、`ConcurrentLinkedQueue` | 队列、优先级、生产消费 |
| `Deque` | `ArrayDeque`、`LinkedList` | 双端队列、栈 |

选型先问五个问题：要不要有序、要不要去重、要不要按 key 快速查、会不会并发读写、大概多大。把这五点想清楚，集合基本就定了。

## ArrayList：动态数组

`ArrayList` 底层就是一个 `Object[] elementData`。因为是连续数组，所以**按下标读 `get(i)` 是 O(1)**，遍历也快、缓存友好；但**中间插入或删除是 O(n)**，因为要把后面的元素整体 `System.arraycopy` 挪位。

它的容量是动态增长的，理解扩容才能用好它：

- 无参构造时 `elementData` 是一个**空数组**，并不分配 16 个位置。直到第一次 `add` 才初始化成默认容量 **10**（懒加载，省内存）。
- 装满后扩容，新容量是旧的 **1.5 倍**：`newCapacity = oldCapacity + (oldCapacity >> 1)`，再 `Arrays.copyOf` 把老数据复制过去。每次扩容都要复制一遍，所以能预估大小时一定要指定初始容量：

```java
List<Long> ids = new ArrayList<>(records.size());   // 避免反复扩容 + 复制
for (ProductDO record : records) {
    ids.add(record.getId());
}
```

日常用 Stream 收集：

```java
List<Long> productIds = orderItems.stream()
        .map(OrderItemDO::getProductId)
        .toList();
```

一个常见坑是**在循环里按下标删**，每删一个后面元素就左移，索引会错位还可能漏删：

```java
// 不推荐
for (int i = 0; i < list.size(); i++) {
    if (shouldRemove(list.get(i))) {
        list.remove(i);
    }
}
```

直接用 `removeIf`（它内部用迭代器，安全且高效）：

```java
list.removeIf(this::shouldRemove);
```

`ArrayList` 不是线程安全的，每次结构性修改会让内部的 `modCount` 加一，迭代时校验它来实现 fail-fast（见后文）。

## LinkedList：双向链表

`LinkedList` 是双向链表，每个节点 `Node` 持有前后两个指针。很多人以为“链表增删一定比 ArrayList 快”，其实不一定：

- 它的**头尾增删确实是 O(1)**。
- 但按下标 `get(i)` 要从头或尾遍历到第 i 个，是 **O(n)**。
- 每个节点多两个指针，内存占用更高，遍历时缓存局部性也差。

它同时实现了 `List` 和 `Deque`，理论上能当队列、栈用。但实际项目里：普通列表优先 `ArrayList`，队列/栈优先 `ArrayDeque`，`LinkedList` 真正适合的场景非常少。

## HashSet：基于 HashMap 的去重

`HashSet` 用来去重和快速判断存在，底层其实就是一个 `HashMap`——元素作为 key，value 是一个固定的占位对象 `PRESENT`：

```java
public boolean add(E e) {
    return map.put(e, PRESENT) == null;
}
```

所以它的去重、扩容、树化逻辑全部复用 `HashMap`，自然也**依赖元素的 `hashCode` 和 `equals`**。对自定义对象去重时如果不重写这两个方法，去重会失效：

```java
Set<ProductKey> keys = new HashSet<>();
keys.add(new ProductKey(1L, 2L));
keys.contains(new ProductKey(1L, 2L)); // 没重写 equals/hashCode 时返回 false
```

`HashSet` 不保证遍历顺序；要按插入顺序遍历用 `LinkedHashSet`（它基于 `LinkedHashMap`）。典型用法是把列表转成 Set 做存在性判断或求交集差集：

```java
Set<Long> productIdSet = new HashSet<>(productIds);
if (!productIdSet.contains(productId)) {
    throw new BusinessException("商品不在订单中");
}
```

## HashMap：最常用的查询结构

`HashMap` 是后端最常用的集合，底层是**数组 + 链表 + 红黑树**，默认容量 16、负载因子 0.75，线程不安全。它的扩容 rehash、8/64 树化阈值、JDK 7 死链等是源码题重灾区，单独成篇细讲，见 [HashMap 结构](/notes/java-backend/hashmap-structure)。这里只看项目里怎么用。

最常见的用法是**把列表转成 Map 做 O(1) 回填**，避免双层 for 的 N×M：

```java
Map<Long, ProductDO> productMap = productList.stream()
        .collect(Collectors.toMap(ProductDO::getId, Function.identity()));

for (OrderItemVO item : items) {
    ProductDO product = productMap.get(item.getProductId());
    item.setProductName(product.getName());
}
```

`Collectors.toMap` 有个必知的坑：**key 重复会抛 `IllegalStateException`**。只要 key 可能重复，就必须给第三个参数写合并规则：

```java
Map<Long, ProductDO> latestProductMap = productList.stream()
        .collect(Collectors.toMap(
                ProductDO::getCategoryId,
                Function.identity(),
                (oldValue, newValue) -> newValue   // 重复时保留后者
        ));
```

## LinkedHashMap：有序，还能当 LRU

`LinkedHashMap` 继承自 `HashMap`，在哈希结构之上**额外维护了一条贯穿所有节点的双向链表**，所以它能保证遍历顺序。它有两种顺序模式：

- `accessOrder = false`（默认）：按**插入顺序**。
- `accessOrder = true`：按**访问顺序**，每次 get/put 都把该节点移到链表尾部。

后者正是实现 LRU 的关键。再配合重写 `removeEldestEntry`，插入新元素后如果超过容量就自动淘汰链表头部（最久未访问）的元素，一个 LRU 缓存就成了，这也是面试手写 LRU 最简洁的写法：

```java
class LruCache<K, V> extends LinkedHashMap<K, V> {
    private final int capacity;

    LruCache(int capacity) {
        super(capacity, 0.75f, true);   // accessOrder = true
        this.capacity = capacity;
    }

    @Override
    protected boolean removeEldestEntry(Map.Entry<K, V> eldest) {
        return size() > capacity;       // 超容量则淘汰最久未访问的
    }
}
```

日常用它保持顺序，比如批量查询后按原始 ID 顺序返回：

```java
Map<Long, ProductDO> productMap = productList.stream()
        .collect(Collectors.toMap(
                ProductDO::getId,
                Function.identity(),
                (left, right) -> left,
                LinkedHashMap::new));
```

## TreeMap / TreeSet：有序 + 范围查询

`TreeMap` 底层是**红黑树**（自平衡二叉搜索树），key 按大小有序排列，增删查都是 O(log n)。它相对 `HashMap` 的独特价值是**范围查询和找最近的 key**：

```java
NavigableMap<Integer, String> levelMap = new TreeMap<>();
levelMap.put(10, "普通");
levelMap.put(50, "白银");
levelMap.put(100, "黄金");

Map.Entry<Integer, String> level = levelMap.floorEntry(score); // 找 <= score 的最大档位
```

`NavigableMap` 提供 `floorEntry`、`ceilingEntry`、`headMap`、`tailMap`、`subMap` 这些 `HashMap` 没有的操作。代价是 key 必须可比较：要么实现 `Comparable`，要么构造时传 `Comparator`，否则插入第二个元素就抛 `ClassCastException`。如果只是去重、不需要排序，别用 `TreeSet`，用 `HashSet` 更快。

## ConcurrentHashMap：并发安全的 Map

多线程读写一定不能用 `HashMap`，要用 `ConcurrentHashMap`。它的实现随版本变化很大，是高频题：

- **JDK 7 用分段锁（Segment）**：内部是 `Segment[]`，每段管一个小 `HashEntry[]`，每个 Segment 是一把 `ReentrantLock`。锁的粒度是“段”，并发度约等于段数（默认 16）——也就是最多 16 个线程同时写不冲突。
- **JDK 8 改成 CAS + synchronized**：抛弃 Segment，结构和 HashMap 一样是 `Node[]` + 链表 + 红黑树，锁粒度细化到**单个桶**：
  - 目标桶为空时，用一次 **CAS** 放入头节点，无锁。
  - 桶非空时，`synchronized` 只锁**这个桶的头节点**，其它桶完全不受影响，并发度大大提高。
  - `get` 全程**不加锁**，靠 `Node` 的 `val` 和 `next` 都用 `volatile` 修饰来保证可见性。
  - `size` 不是一个变量，而是 `baseCount + CounterCell[]` 分散计数（思路类似 `LongAdder`），减少高并发下对单个计数器的 CAS 争抢，`size()` 把它们求和得到近似值。
  - 扩容时多个线程可以**协助迁移**，迁移完的桶放一个 `ForwardingNode` 标记，其它线程读到它就知道去新表查。

它和 HashMap 还有个关键区别：**key、value 都不允许为 null**。因为并发下 `get` 返回 null 有二义性——分不清是“没这个 key”还是“值就是 null”，而 HashMap 单线程下可以再 `containsKey` 确认，并发时这两步之间状态可能变，所以干脆禁止 null。

最后要记住：它只保证**单个方法**原子，复合操作仍然不安全：

```java
// 错误：检查和写入之间可能被别的线程插入
if (!map.containsKey(key)) {
    map.put(key, value);
}
```

要用它提供的原子方法：

```java
map.putIfAbsent(key, value);
map.computeIfAbsent(key, this::loadValue);  // 注意：loadValue 内不要再操作同一个 map，可能死锁
map.merge(key, 1L, Long::sum);              // 原子累加计数
```

典型场景是本地缓存、运行时注册表、计数器：

```java
private final ConcurrentHashMap<Long, ProductSnapshot> localCache = new ConcurrentHashMap<>();

public ProductSnapshot getSnapshot(Long productId) {
    return localCache.computeIfAbsent(productId, this::loadSnapshot);
}
```

## ArrayDeque：队列和栈都用它

`ArrayDeque` 底层是**循环数组**，用 head / tail 两个指针标记队首队尾，容量是 2 的幂、不够就翻倍。头尾增删都是均摊 O(1)，比 `LinkedList` 缓存友好，是做队列和栈的首选：

```java
Deque<Long> stack = new ArrayDeque<>();   // 当栈
stack.push(1L);
Long top = stack.pop();

Deque<Long> queue = new ArrayDeque<>();   // 当队列
queue.offerLast(1L);
Long first = queue.pollFirst();
```

它**不允许 null 元素**（内部用 null 表示空槽），也不是线程安全的——并发队列用 `ConcurrentLinkedQueue` 或 `LinkedBlockingQueue`。

不要再用 `Stack` 做栈：它继承自 `Vector`，方法都带 `synchronized` 有同步开销，而且“栈底在数组头”的语义很别扭，是个历史遗留类。

## CopyOnWriteArrayList：读多写极少

`CopyOnWriteArrayList` 是“写时复制”容器，底层是 `volatile Object[]` 加一把 `ReentrantLock`。它的核心机制是：

- **写**（add/set/remove）先加锁，复制出一个新数组，在新数组上改完，再把 `volatile` 引用指向新数组。
- **读**完全不加锁，直接读当前数组引用。

所以读写不互斥、读读并发，特别适合**读极多、写极少**且列表不大的场景，比如监听器列表、白名单：

```java
private final List<OrderListener> listeners = new CopyOnWriteArrayList<>();
```

代价是每次写都要复制整个数组，所以**高频写或大列表绝对不要用**。它的迭代器基于创建那一刻的数组快照，因此是 **fail-safe**——遍历时别的线程改了也不会抛异常，但也看不到新改动。

## fail-fast 与 fail-safe

遍历集合时直接改它的结构，常会抛 `ConcurrentModificationException`，这就是 **fail-fast**：

```java
for (Long id : ids) {        // 增强 for 底层是迭代器
    if (id <= 0) ids.remove(id);   // 抛 ConcurrentModificationException
}
```

原理是 `ArrayList`、`HashMap` 等内部有个 `modCount`，每次结构性修改就加一。创建迭代器时记下 `expectedModCount = modCount`，每次 `next()` 都校验两者是否相等：

```java
final void checkForComodification() {
    if (modCount != expectedModCount)
        throw new ConcurrentModificationException();
}
```

直接 `ids.remove` 改了 `modCount`，下次 `next()` 就发现对不上、抛异常。而**迭代器自己的 `it.remove()` 会同步更新 `expectedModCount`**，所以安全：

```java
Iterator<Long> it = ids.iterator();
while (it.hasNext()) {
    if (it.next() <= 0) it.remove();
}
// 或更简洁：
ids.removeIf(id -> id <= 0);
```

两点要清楚：fail-fast 是“尽力检测”的保护，**不保证一定抛出，更不是并发安全机制**；真要边遍历边并发改，用 `CopyOnWriteArrayList`、`ConcurrentHashMap` 这类 fail-safe 容器。

## 集合选择表

| 需求 | 推荐集合 | 不推荐 |
| --- | --- | --- |
| 普通列表 | `ArrayList` | `LinkedList` |
| 去重并快速判断存在 | `HashSet` | `List.contains` |
| 按 ID 组装数据 | `HashMap` | 双层 for 循环 |
| 保持插入顺序 | `LinkedHashMap` | `HashMap` |
| LRU 缓存 | `LinkedHashMap(accessOrder)` | 手写易错 |
| 按 key 排序 / 范围查询 | `TreeMap` | 手动排序 / 全量过滤 |
| 并发读写 map | `ConcurrentHashMap` | `HashMap` + 侥幸心理 |
| 栈 / 队列 | `ArrayDeque` | `Stack` |
| 读多写极少 | `CopyOnWriteArrayList` | `ArrayList` 加锁乱改 |

## 后端项目里的常见用法

批量查询避免 N+1：

```java
List<Long> productIds = orderItems.stream()
        .map(OrderItemDO::getProductId)
        .distinct()
        .toList();

List<ProductDO> products = productMapper.selectBatchIds(productIds);

Map<Long, ProductDO> productMap = products.stream()
        .collect(Collectors.toMap(ProductDO::getId, Function.identity()));
```

按状态分组：

```java
Map<OrderStatus, List<OrderDO>> statusMap = orders.stream()
        .collect(Collectors.groupingBy(OrderDO::getStatus));
```

统计数量：

```java
Map<Long, Long> countMap = orderItems.stream()
        .collect(Collectors.groupingBy(OrderItemDO::getProductId, Collectors.counting()));
```

## 回答模板

```text
集合分 List、Set、Map、Queue 四大类，选型先看：有序？去重？查询？并发？多大？

ArrayList 是动态数组，按下标 O(1)、中间增删 O(n)，扩容 1.5 倍并复制；
LinkedList 双向链表，头尾增删 O(1) 但按下标 O(n)，项目里优先 ArrayList。

HashMap 数组 + 链表 + 红黑树，默认容量 16、负载因子 0.75，线程不安全；
LinkedHashMap 继承它多维护一条双向链表，accessOrder + removeEldestEntry 能实现 LRU；
TreeMap 红黑树，按 key 有序，支持范围查询。

并发用 ConcurrentHashMap：JDK7 分段锁，JDK8 改成 CAS + synchronized 锁单个桶，
get 无锁，不允许 null，复合操作要用 putIfAbsent/compute/merge。

遍历时改结构会因为 modCount 触发 fail-fast，要用迭代器 remove 或 removeIf。
```

## 检查清单

- [ ] 选集合先想：有序？去重？查询？并发？大小？
- [ ] 能讲清 ArrayList 默认容量 10、1.5 倍扩容、按下标 O(1) / 中间增删 O(n)。
- [ ] 能讲清 LinkedList 为什么不一定比 ArrayList 快。
- [ ] 能讲清 fail-fast 靠 modCount/expectedModCount，是检测不是并发安全。
- [ ] 能讲清 ConcurrentHashMap JDK7 分段锁 → JDK8 CAS+synchronized 锁桶、get 无锁、不允许 null。
- [ ] 能讲清 LinkedHashMap accessOrder + removeEldestEntry 实现 LRU。
- [ ] 知道 ConcurrentHashMap 复合操作要用 putIfAbsent/compute/merge。
- [ ] 自定义对象作为 key/元素时实现 `equals` 和 `hashCode`。
- [ ] 大集合估算大小，避免频繁扩容；避免双层 for 组装数据。

## 关联笔记

- [Java HashMap 结构](/notes/java-backend/hashmap-structure)
- [Java Stream 使用笔记](/notes/java-backend/java-stream)
- [MySQL 多表联查](/notes/mysql/multi-table-join)
