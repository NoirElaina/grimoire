---
title: Java HashMap 结构
sidebarTitle: HashMap 结构
---

# Java HashMap 结构

> `HashMap` 的重点不是“数组 + 链表 + 红黑树”这句口号，而是一整条链路能不能讲透：key 怎么算 hash、怎么定位到桶、冲突了怎么挂、什么时候树化、什么时候扩容、扩容时元素怎么搬、并发为什么会出事。下面按这条链路一步步展开。

## 整体结构

`HashMap` 的主体是一个数组，源码里叫 `table`，每个格子叫一个**桶（bucket）**。元素是 `Node<K,V>`：

```java
static class Node<K,V> {
    final int hash;   // key 扰动后的 hash，存下来避免反复计算
    final K key;
    V value;
    Node<K,V> next;   // 指向同桶的下一个节点，形成链表
}
```

不同的 key 经过计算可能落到同一个桶（hash 冲突）。冲突的元素先用 `next` 串成**链表**挂在桶后面；当某个桶的链表太长，查询退化成 O(n)，这时把链表转成**红黑树**，把最坏查询压到 O(log n)。

```text
table
 ├─ [0] null
 ├─ [1] -> Node(k1) -> Node(k9) -> Node(k17)        链表
 ├─ [2] -> TreeNode(...) 红黑树根                     树
 └─ [3] -> Node(k3)
```

所以**数组定位桶，链表/红黑树解决同一个桶里的冲突。**

默认参数：

```text
初始容量 DEFAULT_INITIAL_CAPACITY = 16
负载因子 DEFAULT_LOAD_FACTOR     = 0.75
扩容阈值 threshold = capacity * loadFactor  // 16 * 0.75 = 12
```

## 第一步：算 hash（扰动函数）

`put` / `get` 的第一步，是把 key 的 `hashCode()` 再加工一次：

```java
static final int hash(Object key) {
    int h;
    return (key == null) ? 0 : (h = key.hashCode()) ^ (h >>> 16);
}
```

为什么要 `h ^ (h >>> 16)`？因为定位桶用的是 `(n - 1) & hash`，`n`（容量）通常很小（16、32），`n - 1` 只有低几位是 1，**只有 hash 的低位参与了运算，高位完全没用上**。

举个例子，容量 16，`n - 1 = 0000...1111`。如果两个 key 的 hashCode 高位差别很大、低 4 位却相同，不扰动的话它们会落到同一个桶：

```text
hashCode A = 0001 0000 0000 0101   低4位 0101
hashCode B = 1111 0000 0000 0101   低4位 0101
& 1111 都得到 0101 -> 同一个桶，冲突
```

扰动把高 16 位异或到低 16 位，让高位信息也能影响桶下标，A、B 大概率就分开了。这不是加密，纯粹是为了让分布更均匀、减少冲突。key 为 null 时 hash 固定为 0，所以 null 永远落在 0 号桶。

## 第二步：定位桶（为什么容量必须是 2 的幂）

```java
index = (table.length - 1) & hash;
```

这里用按位与代替取模。前提是 `length` 必须是 2 的幂：此时 `length - 1` 的二进制是低位全 1（16-1=`1111`，32-1=`11111`），`(n-1) & hash` 的结果恰好等于 `hash % n`，但位运算比取模快得多。

所以即使你 `new HashMap<>(20)`，它也不会真的用 20，而是用 `tableSizeFor` 向上取整到最近的 2 的幂 **32**：

```java
new HashMap<>(20);   // 实际初始容量 32
```

容量是 2 的幂还有第二个好处，在扩容那一节才看得出来。

## put 完整流程

`put` 实际调 `putVal`，主干如下（去掉细节）：

```java
final V putVal(int hash, K key, V value, ...) {
    Node<K,V>[] tab; Node<K,V> p; int n, i;

    // 1. table 还没初始化，先 resize 建表（懒加载）
    if ((tab = table) == null || (n = tab.length) == 0)
        n = (tab = resize()).length;

    // 2. 目标桶为空，直接放新节点
    if ((p = tab[i = (n - 1) & hash]) == null) {
        tab[i] = new Node<>(hash, key, value, null);
    } else {
        // 3. 桶不为空，处理冲突
        Node<K,V> e; K k;
        if (p.hash == hash && ((k = p.key) == key || key.equals(k))) {
            e = p;                          // 3a. 第一个节点就是同一个 key
        } else if (p instanceof TreeNode) {
            e = ((TreeNode)p).putTreeVal(...); // 3b. 已是红黑树，走树插入
        } else {
            // 3c. 链表，尾部遍历
            for (int binCount = 0; ; ++binCount) {
                if ((e = p.next) == null) {
                    p.next = new Node<>(hash, key, value, null);  // 尾插
                    if (binCount >= TREEIFY_THRESHOLD - 1)        // 链表达到 8
                        treeifyBin(tab, hash);                    // 尝试树化
                    break;
                }
                if (e.hash == hash && ((k = e.key) == key || key.equals(k)))
                    break;                  // 找到相同 key
                p = e;
            }
        }
        if (e != null) {                    // key 已存在，覆盖 value 并返回旧值
            V oldValue = e.value;
            e.value = value;
            return oldValue;
        }
    }
    // 4. 新增了元素，size 超阈值就扩容
    if (++size > threshold)
        resize();
    return null;
}
```

几个要点：

- **懒加载**：第一次 put 才真正分配数组（`resize`），`new HashMap<>()` 时数组还是 null。
- **尾插**：JDK 8 链表是往尾部加（注意，JDK 7 是头插，这是死链问题的根源，后面讲）。
- **相同 key 覆盖**：判断条件是 `hash 相等 && (key == 节点key || key.equals(节点key))`，先比 hash 是为了快速排除，再用 equals 精确比较。
- **先插入后扩容**：是先把节点放进去、`size++`，再判断是否超阈值扩容。

## 链表什么时候转红黑树

链表尾插后，如果该桶链表长度达到 `TREEIFY_THRESHOLD = 8`，调用 `treeifyBin`。但 `treeifyBin` 里还有一道门槛：

```java
final void treeifyBin(Node<K,V>[] tab, int hash) {
    if (tab == null || tab.length < MIN_TREEIFY_CAPACITY)   // 容量 < 64
        resize();                                           // 优先扩容，不树化
    else
        // 真正把链表转成红黑树
}
```

三个常量：

```text
TREEIFY_THRESHOLD   = 8    链表长度到 8，尝试树化
MIN_TREEIFY_CAPACITY = 64  但容量不到 64，先扩容而不是树化
UNTREEIFY_THRESHOLD = 6    扩容拆分后树节点降到 6，退化回链表
```

为什么容量不到 64 先扩容：容量小本身就容易冲突，先扩容让元素重新分散，往往比急着树化更划算（树节点 `TreeNode` 内存约是普通 `Node` 的两倍，还要维护红黑树平衡）。

## 为什么阈值偏偏是 8

不要背“8 好记”。HashMap 源码注释给的真正依据是**泊松分布**：在负载因子 0.75、hashCode 分布良好的前提下，一个桶里恰好有 k 个元素的概率服从 λ=0.5 的泊松分布，源码注释里直接列了概率：

```text
0:    0.60653066
1:    0.30326533
2:    0.07581633
3:    0.01263606
4:    0.00157952
5:    0.00015795
6:    0.00001316
7:    0.00000094
8:    0.00000006     约千万分之六
```

也就是说，hash 正常的情况下，一个桶里挂到 8 个几乎不可能发生。所以树化不是常规路径，而是**给“hashCode 写得很烂”或“被故意构造大量碰撞攻击”兜底**的。设计取舍：

- 链表短（绝大多数情况）：维护链表足够，简单省内存。
- 真的长到 8 了：说明 hash 分布出了问题，这时转红黑树把 O(n) 救成 O(log n)。

树化用 8、退化用 6（中间隔了个 7），是为了避免在临界点反复树化又退化、来回抖动。

## get 流程

```java
final Node<K,V> getNode(int hash, Object key) {
    // 1. 定位桶，桶非空且第一个节点命中直接返回
    // 2. 链表：沿 next 逐个比较 hash + equals
    // 3. 红黑树：按树查找
}
```

命中判断和 put 一致：`hash 相等 && (key == node.key || key.equals(node.key))`。

这就引出自定义 key 的硬性要求——必须正确实现 `hashCode` 和 `equals`，而且要满足契约：

```text
两个对象 equals 为 true  ->  hashCode 必须相等
hashCode 相等            ->  equals 不一定为 true（允许冲突）
```

如果只重写 `equals` 没重写 `hashCode`，两个“相等”的 key 算出不同 hash，落到不同桶，`get` 自然找不到。

## 扩容：threshold、翻倍、高低位拆分

当 `size > threshold`（默认 12）触发 `resize`：容量翻倍（16→32），阈值也翻倍（12→24），然后把旧数组的元素搬到新数组。

JDK 8 搬迁的精妙之处：**不重新计算 hash**。容量从 `oldCap` 翻到 `2*oldCap`，桶下标的掩码从 `oldCap-1` 多出最高一位。一个元素的新下标，只取决于它 hash 在这一位上是 0 还是 1：

```text
oldCap = 16 (10000)
某元素 hash 低 5 位 = 0 1010
  hash & oldCap = hash & 10000 = 0   -> 留在原位 j
另一元素 hash 低 5 位 = 1 1010
  hash & oldCap = hash & 10000 = 1   -> 移到 j + oldCap
```

所以源码把每个桶的链表拆成两条：

```java
if ((e.hash & oldCap) == 0) {
    // 低位链表 lo：新下标还是 j
} else {
    // 高位链表 hi：新下标是 j + oldCap
}
```

拆完把 lo 挂到 `newTab[j]`，hi 挂到 `newTab[j + oldCap]`。这样既省掉了重新算 hash，又用 lo/hi 两条链保持了元素的相对顺序（不像 JDK 7 会逆序）。这就是“容量是 2 的幂”的第二个好处。

预估大小时设初始容量能避免反复 resize：

```java
// 期望放 expectedSize 个，给 expectedSize / 0.75 + 1，再被取整到 2 的幂
Map<Long, ProductDO> map = new HashMap<>((int) (expectedSize / 0.75f) + 1);
```

## 为什么线程不安全：JDK 7 的死链

`HashMap` 没有任何并发控制，多线程同时 put 会丢数据、size 不准、读到扩容中间状态。最经典的事故是 **JDK 7 的扩容死链**。

JDK 7 用**头插法**，扩容 `transfer` 时把旧桶每个节点重新算下标、头插到新桶。单线程没问题，但两个线程同时扩容时，头插会**反转链表**，可能让两个节点互相指向，形成环：

```text
旧链表: A -> B -> null

线程1 执行到一半挂起，此时它的局部变量: e=A, next=B
线程2 完整扩容完成，头插使新链表变成: B -> A -> null

线程1 恢复，继续用过期的 e=A、next=B 头插：
  搬 A: 新桶 -> A
  搬 B: 新桶 -> B -> A
  再处理 A.next（线程2 已让 A.next = ... 指回 B）
  -> A 和 B 互相指向 -> 环形链表
```

一旦成环，后续某次 `get` 命中这个桶就会**无限循环遍历，CPU 飙到 100%**。

JDK 8 改成**尾插 + lo/hi 拆分**，保持顺序，**消除了死链**。但务必强调：JDK 8 只是不会死循环了，`HashMap` **依然线程不安全**——并发 put 照样丢数据、size 错乱。并发场景一律用 `ConcurrentHashMap`：

```java
// 错误：多线程随便读写
private static final Map<Long, ProductDO> CACHE = new HashMap<>();
```

## 和 HashSet 的关系

`HashSet` 内部就是一个 `HashMap`，元素当 key，value 是固定占位对象 `PRESENT`：

```java
public boolean add(E e) {
    return map.put(e, PRESENT) == null;
}
```

所以 `HashSet` 的去重、扩容、树化全部复用 `HashMap`，去重同样依赖 `hashCode` 和 `equals`。

## 常见项目坑

### 自定义 key 没重写 equals/hashCode

```java
Map<ProductKey, ProductDO> map = new HashMap<>();
map.put(new ProductKey(1L, 2L), product);
map.get(new ProductKey(1L, 2L)); // 没重写 hashCode/equals 时拿不到
```

### 可变对象当 key

```java
ProductKey key = new ProductKey(1L, 2L);
map.put(key, product);
key.setSkuId(3L);     // 改了参与 hashCode 的字段
map.get(key);         // hash 变了，定位到别的桶，拿不到
```

key 应当不可变。

### 没预估容量

批量装 10 万条不设容量，会经历多次扩容 + 复制，浪费 CPU。

### Collectors.toMap key 重复

```java
products.stream()
        .collect(Collectors.toMap(ProductDO::getCategoryId, Function.identity()));
```

`categoryId` 重复会抛 `IllegalStateException`，要给第三个参数写合并函数：

```java
.collect(Collectors.toMap(ProductDO::getCategoryId, Function.identity(), (a, b) -> b));
```

## 回答模板

```text
HashMap 是数组 + 链表 + 红黑树。put 时先把 hashCode 异或高 16 位做扰动，
再用 (n-1) & hash 定位桶，所以容量必须是 2 的幂，让按位与等价于取模。

冲突时 JDK 8 尾插成链表，链表长度到 8 且容量到 64 转红黑树，容量不够则先扩容；
树节点降到 6 退化回链表。8 这个阈值来自泊松分布——正常 hash 几乎不会到 8，树化是给坏 hash 兜底的。

默认容量 16、负载因子 0.75、阈值 12。size 超阈值扩容翻倍，
JDK 8 不重算 hash，按 (hash & oldCap) 把每个桶拆成 lo/hi 两条，分别放到 j 和 j+oldCap。

JDK 7 头插法在并发扩容时会形成环形链表导致死循环，JDK 8 改尾插解决了死链，
但 HashMap 仍线程不安全，并发要用 ConcurrentHashMap。
自定义 key 必须正确实现 equals/hashCode 且不可变。
```

## 检查清单

- [ ] 能解释扰动函数为什么异或高 16 位，并举例说明低位冲突。
- [ ] 能解释 (n-1)&hash 为什么要求容量是 2 的幂。
- [ ] 能讲清 putVal 主干：定位桶、冲突处理、尾插、覆盖、先插后扩容。
- [ ] 能讲清树化的双重条件（链表 8 + 容量 64）和 8/6/64 含义。
- [ ] 能用泊松分布解释 8 这个阈值的来历。
- [ ] 能讲清扩容的 lo/hi 高低位拆分，且不重算 hash。
- [ ] 能用具体过程讲清 JDK 7 头插死链，知道 JDK 8 尾插后仍不线程安全。
- [ ] 知道 equals/hashCode 契约，key 要不可变。
- [ ] 大 map 预估容量；处理 toMap 重复 key。

## 参考

- [Java HashMap API](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/HashMap.html)
- [OpenJDK HashMap source](https://github.com/openjdk/jdk/blob/master/src/java.base/share/classes/java/util/HashMap.java)
