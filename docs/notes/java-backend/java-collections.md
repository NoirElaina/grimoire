---
title: Java 常用集合
sidebarTitle: Java 集合
---

# Java 常用集合

> 集合不是只背 `List`、`Set`、`Map`。后端项目里真正要会的是：查询快不快、是否去重、是否有顺序、是否线程安全、能不能承受频繁扩容。

## 集合体系

常用集合先按接口分：

| 接口 | 典型实现 | 解决的问题 |
| --- | --- | --- |
| `List` | `ArrayList`、`LinkedList` | 有序、可重复、按下标访问 |
| `Set` | `HashSet`、`LinkedHashSet`、`TreeSet` | 去重 |
| `Map` | `HashMap`、`LinkedHashMap`、`TreeMap`、`ConcurrentHashMap` | key/value 查询 |
| `Queue` | `ArrayDeque`、`PriorityQueue`、`ConcurrentLinkedQueue` | 队列、优先级、生产消费 |
| `Deque` | `ArrayDeque`、`LinkedList` | 双端队列、栈 |

常见选择：

```text
需要按下标读：
    ArrayList

需要去重：
    HashSet

需要按插入顺序遍历：
    LinkedHashMap / LinkedHashSet

需要排序：
    TreeMap / TreeSet

需要并发读写：
    ConcurrentHashMap

需要队列：
    ArrayDeque / ConcurrentLinkedQueue
```

## `ArrayList`

`ArrayList` 底层是数组。

优点：

- 按下标读取快。
- 遍历快。
- 内存连续，缓存友好。

缺点：

- 中间插入、删除要移动元素。
- 扩容会创建新数组并复制旧元素。
- 不是线程安全集合。

项目用法：

```java
List<Long> productIds = orderItems.stream()
        .map(OrderItemDO::getProductId)
        .toList();
```

如果能估算大小，初始化容量：

```java
List<Long> ids = new ArrayList<>(records.size());
for (ProductDO record : records) {
    ids.add(record.getId());
}
```

不要在循环里频繁 `remove(index)`：

```java
// 不推荐：每次删除都可能移动后面的元素
for (int i = 0; i < list.size(); i++) {
    if (shouldRemove(list.get(i))) {
        list.remove(i);
    }
}
```

更稳：

```java
list.removeIf(this::shouldRemove);
```

## `LinkedList`

`LinkedList` 底层是双向链表。

它不是“插入删除一定比 `ArrayList` 快”。

原因：

- 如果要先按下标找到节点，查找本身就是 O(n)。
- 节点对象有额外指针，内存占用更高。
- 遍历时缓存局部性差。

项目里多数列表优先 `ArrayList`。

`LinkedList` 适合的场景很少，通常可以用 `ArrayDeque` 替代。

## `HashSet`

`HashSet` 底层依赖 `HashMap`。

用途：

- 去重。
- 快速判断是否存在。
- 做集合交集、差集前的预处理。

示例：

```java
Set<Long> productIdSet = new HashSet<>(productIds);
if (!productIdSet.contains(productId)) {
    throw new BusinessException("商品不在订单中");
}
```

注意：

- 对自定义对象去重时，必须正确实现 `equals` 和 `hashCode`。
- `HashSet` 不保证遍历顺序。
- 顺序敏感时使用 `LinkedHashSet`。

错误例子：

```java
Set<ProductKey> keys = new HashSet<>();
keys.add(new ProductKey(1L, 2L));
keys.contains(new ProductKey(1L, 2L)); // 如果没重写 equals/hashCode，可能是 false
```

## `HashMap`

`HashMap` 是后端最常用的集合。

典型用途：

- 按 ID 组装数据。
- 批量查询后回填 VO。
- 统计计数。
- 临时索引。

示例：

```java
Map<Long, ProductDO> productMap = productList.stream()
        .collect(Collectors.toMap(ProductDO::getId, Function.identity()));

for (OrderItemVO item : items) {
    ProductDO product = productMap.get(item.getProductId());
    item.setProductName(product.getName());
}
```

`Collectors.toMap` 的坑：

```java
// 如果 key 重复，会抛 IllegalStateException
Collectors.toMap(ProductDO::getCategoryId, Function.identity());
```

有重复 key 时要写合并规则：

```java
Map<Long, ProductDO> latestProductMap = productList.stream()
        .collect(Collectors.toMap(
                ProductDO::getCategoryId,
                Function.identity(),
                (oldValue, newValue) -> newValue
        ));
```

## `LinkedHashMap`

`LinkedHashMap` 保留插入顺序。

适合：

- 批量查询后按原始 ID 顺序返回。
- 构造有序 JSON。
- 简单 LRU 结构。

按请求顺序组装商品：

```java
Map<Long, ProductDO> productMap = productList.stream()
        .collect(Collectors.toMap(
                ProductDO::getId,
                Function.identity(),
                (left, right) -> left,
                LinkedHashMap::new
        ));
```

## `TreeMap` 和 `TreeSet`

`TreeMap`、`TreeSet` 底层是有序树结构。

特点：

- 按 key 排序。
- 插入、删除、查询通常是 O(log n)。
- 可以做范围查询。

示例：

```java
NavigableMap<Integer, String> levelMap = new TreeMap<>();
levelMap.put(10, "普通");
levelMap.put(50, "白银");
levelMap.put(100, "黄金");

Map.Entry<Integer, String> level = levelMap.floorEntry(score);
```

如果只是去重，不需要排序，不要用 `TreeSet`。

## `ConcurrentHashMap`

`ConcurrentHashMap` 用于多线程并发读写。

常见场景：

- 本地缓存。
- 运行时注册表。
- 防重复提交的本地临时标记。
- 统计指标。

示例：

```java
private final ConcurrentHashMap<Long, ProductSnapshot> localCache = new ConcurrentHashMap<>();

public ProductSnapshot getSnapshot(Long productId) {
    return localCache.computeIfAbsent(productId, this::loadSnapshot);
}
```

注意：

- `ConcurrentHashMap` 只能保证单个 map 操作的并发安全。
- 复合业务逻辑仍然可能不安全。
- 本地缓存要考虑容量、过期、节点间一致性。

错误理解：

```java
if (!map.containsKey(key)) {
    map.put(key, value);
}
```

这不是原子逻辑。

更稳：

```java
map.putIfAbsent(key, value);
```

或者：

```java
map.computeIfAbsent(key, this::loadValue);
```

## `ArrayDeque`

`ArrayDeque` 适合做队列和栈。

```java
Deque<Long> stack = new ArrayDeque<>();
stack.push(1L);
stack.push(2L);
Long top = stack.pop();
```

```java
Deque<Long> queue = new ArrayDeque<>();
queue.offerLast(1L);
queue.offerLast(2L);
Long first = queue.pollFirst();
```

不要再用 `Stack` 做栈，它是老类，而且方法带同步开销。

## `CopyOnWriteArrayList`

`CopyOnWriteArrayList` 写时复制。

适合：

- 读多写少。
- 元素数量不大。
- 遍历时不希望被并发修改影响。

例如监听器列表：

```java
private final List<OrderListener> listeners = new CopyOnWriteArrayList<>();
```

不适合：

- 高频写。
- 大列表。
- 每秒大量 add/remove。

因为每次写都会复制数组。

## fail-fast

普通集合遍历时修改集合，可能触发 `ConcurrentModificationException`。

错误：

```java
for (Long id : ids) {
    if (id <= 0) {
        ids.remove(id);
    }
}
```

正确：

```java
ids.removeIf(id -> id <= 0);
```

或者使用迭代器：

```java
Iterator<Long> iterator = ids.iterator();
while (iterator.hasNext()) {
    Long id = iterator.next();
    if (id <= 0) {
        iterator.remove();
    }
}
```

## 集合选择表

| 需求 | 推荐集合 | 不推荐 |
| --- | --- | --- |
| 普通列表 | `ArrayList` | `LinkedList` |
| 去重并快速判断存在 | `HashSet` | `List.contains` |
| 按 ID 组装数据 | `HashMap` | 双层 for 循环 |
| 保持插入顺序 | `LinkedHashMap` | `HashMap` |
| 按 key 排序 | `TreeMap` | 手动排序 map |
| 并发读写 map | `ConcurrentHashMap` | `HashMap` + 侥幸心理 |
| 栈/队列 | `ArrayDeque` | `Stack` |
| 读多写少监听器 | `CopyOnWriteArrayList` | `ArrayList` 加锁乱改 |

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

## 检查清单

- [ ] 是否真的需要有序。
- [ ] 是否允许重复。
- [ ] 是否需要按 key 快速查询。
- [ ] 是否会并发读写。
- [ ] 是否需要排序或范围查询。
- [ ] 是否估算过集合大小，避免频繁扩容。
- [ ] 自定义对象作为 key 时是否实现 `equals` 和 `hashCode`。
- [ ] 是否避免了双层 for 组装数据。

## 关联笔记

- [Java Stream 使用笔记](/notes/java-backend/java-stream)
- [MySQL 多表联查](/notes/mysql/multi-table-join)

