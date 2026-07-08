---
title: Java 设计模式实战
sidebarTitle: 设计模式
---

# Java 设计模式实战

> 设计模式不是背 23 个名字，而是解决"对象怎么创建、怎么组合、怎么交互"的套路。大厂面试不会问"请背诵开闭原则"，而是给一个支付场景问你怎么加新渠道、给一个 Filter 链问你是什么模式、问 `Integer.valueOf(127) == Integer.valueOf(127)` 为什么是 `true`。每个模式都要能说清"原理 + 代码 + JDK/Spring 里的真实例子 + 什么时候不用"。

## 六大设计原则（SOLID + LKP）

所有模式的底层都是这六个原则。面试问"你了解哪些设计原则"，不能只说开闭原则。

### 单一职责原则（SRP）

一个类只做一件事，只有一个引起它变化的原因。

反面例子：

```java
// 一个类既管数据访问又管业务逻辑又管发送邮件
public class OrderService {

    public void createOrder(OrderRequest req) {
        // 1. 数据校验
        // 2. 落库
        orderMapper.insert(req.toDO());
        // 3. 发邮件
        sendEmail(req.getUserEmail());
        // 4. 发短信
        sendSms(req.getUserPhone());
    }
}
```

订单逻辑变了改这里、邮件格式变了也改这里、短信渠道变了还改这里——多个变化原因耦合在一个类里。

拆成：

```text
OrderService        → 订单业务逻辑
OrderMapper         → 数据访问
OrderMailNotifier   → 邮件通知
OrderSmsNotifier    → 短信通知
```

### 开闭原则（OCP）

**对扩展开放，对修改关闭**——加新行为不改老代码。

反面例子——`if-else` 堆砌的支付逻辑：

```java
public class PayService {

    public void pay(String channel, BigDecimal amount) {
        if ("alipay".equals(channel)) {
            System.out.println("支付宝支付 " + amount);
        } else if ("wechat".equals(channel)) {
            System.out.println("微信支付 " + amount);
        } else if ("unionpay".equals(channel)) {
            System.out.println("银联支付 " + amount);
        }
        // 每加一个渠道，都要改这个方法
    }
}
```

问题：

- 每加一个支付渠道，都要修改 `PayService`，改错可能影响已有渠道。
- 方法越来越长，不同渠道逻辑混在一起。
- 测试时要覆盖所有分支，改动牵一发动全身。

用策略模式重构后，加新渠道 = 新建一个类，不改任何已有代码。

### 里氏替换原则（LSP）

子类可以替换父类，程序行为不变。

经典违反场景：

```java
public class Rectangle {
    public void setWidth(int w) { ... }
    public void setHeight(int h) { ... }
    public int getArea() { return width * height; }
}

public class Square extends Rectangle {
    @Override
    public void setWidth(int w) {   // 正方形：宽高必须一致
        super.setWidth(w);
        super.setHeight(w);         // 覆盖了父类行为
    }
    @Override
    public void setHeight(int h) {
        super.setWidth(h);
        super.setHeight(h);
    }
}
```

调用方拿着 `Rectangle` 操作，设宽高后算面积，传 `Square` 时结果完全不同——子类改变了父类的行为契约，违反 LSP。

工程意义：**继承不要为了复用代码而继承，要满足 is-a 关系且不破坏父类契约**。

### 接口隔离原则（ISP）

客户端不应该依赖它用不到的方法。接口要小而专。

反面例子：

```java
public interface SmartDevice {
    void call();
    void takePhoto();
    void playMusic();
    void browseWeb();
}

// 智能音箱只需要 playMusic 和 browseWeb，但被迫实现了 call 和 takePhoto
public class SmartSpeaker implements SmartDevice {
    @Override public void call() { throw new UnsupportedOperationException(); }
    @Override public void takePhoto() { throw new UnsupportedOperationException(); }
    @Override public void playMusic() { /* ... */ }
    @Override public void browseWeb() { /* ... */ }
}
```

拆成小接口：

```java
public interface Phone { void call(); }
public interface Camera { void takePhoto(); }
public interface MusicPlayer { void playMusic(); }
public interface WebBrowser { void browseWeb(); }

public class SmartSpeaker implements MusicPlayer, WebBrowser { ... }
```

### 依赖倒置原则（DIP）

高层模块不依赖低层模块，二者都依赖抽象。抽象不依赖细节，细节依赖抽象。

```java
// 反面：高层依赖低层具体实现
public class OrderService {
    private final MysqlOrderMapper orderMapper = new MysqlOrderMapper();  // 直接依赖具体类
}

// 正面：都依赖抽象
public class OrderService {
    private final OrderRepository orderMapper;  // 依赖接口
    public OrderService(OrderRepository orderMapper) {
        this.orderMapper = orderMapper;  // 注入
    }
}
```

Spring 的 DI 就是 DIP 的标准落地：容器负责把抽象和具体实现绑起来。

### 迪米特法则（Law of Demeter / LKP）

一个对象只和直接朋友说话，不和"朋友的朋友"说话。

```java
// 反面：链式调用深入到第三层
user.getDepartment().getManager().approve(request);

// 正面：让 User 提供方法
user.approveByManager(request);
```

核心思想：减少耦合，一个模块变化时影响面尽量小。Spring 的分层架构（Controller → Service → Repository）就是在践行这个法则——Controller 不直接碰 Repository。

## 创建型模式

### 单例模式

**简单来说，全局只有一个实例，谁都用这一个。**

#### 什么时候用

- 对象创建成本高（连接池、配置加载）。
- 全局共享状态（配置管理器）。
- 无状态工具类。

#### 饿汉式

类加载时就创建：

```java
public class Singleton {

    private Singleton() {}
    private static final Singleton INSTANCE = new Singleton();
    public static Singleton getInstance() {
        return INSTANCE;
    }
}
```

线程安全（JVM 保证类加载 `<clinit>` 的原子性），但不支持延迟加载。如果创建实例很重且不一定用，浪费资源。

#### 懒汉式（双重检查锁）

第一次用时才创建，线程安全：

```java
public class Singleton {

    private Singleton() {}
    private static volatile Singleton instance;   // volatile 防止指令重排

    public static Singleton getInstance() {
        if (instance == null) {                    // 第一次检查：避免不必要的加锁
            synchronized (Singleton.class) {
                if (instance == null) {            // 第二次检查：防止重复创建
                    instance = new Singleton();
                }
            }
        }
        return instance;
    }
}
```

面试高频追问：**为什么必须加 `volatile`？**

`new Singleton()` 不是原子操作，JVM 分三步：

```text
① 分配内存空间
② 初始化对象（调用构造方法）
③ 将引用指向内存地址
```

如果没有 `volatile`，JVM 可能重排序为 ① → ③ → ②。线程 A 执行到 ③（引用已赋值但对象未初始化），线程 B 在第一次检查时看到 `instance != null`，直接返回了一个**半成品对象**。`volatile` 通过内存屏障禁止 ②③ 重排序。

为什么两次 `if` 检查：

```text
第一次检查：如果已创建，直接返回，避免每次都加锁——性能
第二次检查：线程 A 和 B 同时通过第一次检查，A 拿到锁创建实例后释放，
           B 拿到锁，如果不检查就会再创建一个——正确性
```

#### 静态内部类（推荐）

兼顾懒加载和线程安全，代码简洁：

```java
public class Singleton {

    private Singleton() {}

    private static class Holder {
        private static final Singleton INSTANCE = new Singleton();
    }

    public static Singleton getInstance() {
        return Holder.INSTANCE;
    }
}
```

原理：`Holder` 是内部类，只有在 `getInstance()` 被调用时才会被加载。JVM 保证类加载的 `<clinit>` 方法是同步的，天然线程安全。既实现了懒加载，又不需要手动加锁。

#### 枚举单例（Effective Java 推荐）

```java
public enum Singleton {
    INSTANCE;

    public void doSomething() { /* ... */ }
}
```

用法：`Singleton.INSTANCE.doSomething()`。

枚举单例为什么最好：

- **线程安全**：枚举实例的创建在 JVM 层面保证，和饿汉式一样。
- **防反射攻击**：`Constructor.newInstance()` 对枚举类会抛 `IllegalArgumentException`。
- **防反序列化破坏**：枚举的序列化/反序列化由 JVM 特殊处理，保证每次返回同一个实例。

其他写法怎么被反射破坏：

```java
Constructor<Singleton> constructor = Singleton.class.getDeclaredConstructor();
constructor.setAccessible(true);              // 突破 private
Singleton fakeInstance = constructor.newInstance();  // 创建了第二个实例！
```

枚举类在 JVM 层面禁止通过反射创建实例，所以枚举单例天然防御。

#### 四种写法对比

| 方式 | 线程安全 | 懒加载 | 防反射 | 防序列化 | 复杂度 |
| --- | --- | --- | --- | --- | --- |
| 饿汉式 | ✅ | ❌ | ❌ | ❌ | 低 |
| 双重检查锁 | ✅ | ✅ | ❌ | ❌ | 高 |
| 静态内部类 | ✅ | ✅ | ❌ | ❌ | 低 |
| 枚举 | ✅ | ❌ | ✅ | ✅ | 最低 |

#### Spring Bean 默认就是单例

Spring 容器管理的 Bean 默认是单例的，不需要自己写单例模式。`@Service`、`@Component`、`@Repository` 标注的类，Spring 保证每个 `ApplicationContext` 里只有一个实例。

单例 Bean 的注意事项和 `ThreadLocal` 线程安全问题见 [Java ThreadLocal](/notes/java-backend/threadlocal)。

#### 单例 Bean 不是真正的单例

严格来说 Spring 单例 Bean 是"每个 `ApplicationContext` 里一个实例"，如果有父子容器（如 Spring MVC 的 `ContextLoaderListener` + `DispatcherServlet`），可能存在多个实例。跨 JVM（分布式）更是无法保证。所以不要依赖"全局绝对唯一"的假设。

### 工厂模式（简单工厂 / 工厂方法 / 抽象工厂）

**简单来说，把对象的创建逻辑收敛到工厂里，调用方不 `new` 具体类。**

#### 简单工厂

一个工厂方法靠参数决定造哪个对象：

```java
public interface Weapon {
    void shoot();
}

public class AK47 implements Weapon {
    @Override
    public void shoot() { System.out.println("AK47 射击"); }
}

public class Sniper implements Weapon {
    @Override
    public void shoot() { System.out.println("Sniper 射击"); }
}

public class WeaponFactory {
    public static Weapon create(String type) {
        return switch (type.toLowerCase()) {
            case "ak47"   -> new AK47();
            case "sniper" -> new Sniper();
            default -> throw new IllegalArgumentException("未知武器类型: " + type);
        };
    }
}
```

优点：调用方不用 `new`，不用知道具体类名。
缺点：加新产品要改工厂的 `switch`，**违反开闭原则**。

适合：产品种类少且稳定，创建逻辑简单。

#### 工厂方法

每种产品配一个专属工厂，加新产品只加新工厂类：

```java
public interface WeaponFactory {
    Weapon create();
}

public class AK47Factory implements WeaponFactory {
    @Override
    public Weapon create() { return new AK47(); }
}

public class SniperFactory implements WeaponFactory {
    @Override
    public Weapon create() { return new Sniper(); }
}
```

调用：

```java
WeaponFactory factory = new AK47Factory();
Weapon w = factory.create();
```

加新武器 `UZI`：新建 `UZIFactory` 和 `UZI`，不改任何已有代码。

#### 简单工厂 vs 工厂方法

| | 简单工厂 | 工厂方法 |
| --- | --- | --- |
| 工厂数量 | 一个 | 每个产品一个 |
| 加新产品 | 改工厂代码 | 新建工厂类 |
| 开闭原则 | 违反 | 符合 |
| 复杂度 | 低 | 类多 |

产品经常变用工厂方法，稳定就用简单工厂。

#### 抽象工厂

工厂方法创建**一种**产品，抽象工厂创建**一族**产品。

场景：一个游戏有"现代武器族"和"古代武器族"，每族都有枪和刀。

```java
// 产品族接口
public interface Gun { void shoot(); }
public interface Sword { void slash(); }

// 现代族
public class ModernGun implements Gun {
    public void shoot() { System.out.println("步枪射击"); }
}
public class ModernSword implements Sword {
    public void slash() { System.out.println("军刀劈砍"); }
}

// 古代族
public class AncientGun implements Gun {
    public void shoot() { System.out.println("弩箭发射"); }
}
public class AncientSword implements Sword {
    public void slash() { System.out.println("青铜剑劈砍"); }
}

// 抽象工厂——创建一族产品
public interface WeaponFactory {
    Gun createGun();
    Sword createSword();
}

public class ModernWeaponFactory implements WeaponFactory {
    public Gun createGun() { return new ModernGun(); }
    public Sword createSword() { return new ModernSword(); }
}

public class AncientWeaponFactory implements WeaponFactory {
    public Gun createGun() { return new AncientGun(); }
    public Sword createSword() { return new AncientSword(); }
}
```

区别：

| | 工厂方法 | 抽象工厂 |
| --- | --- | --- |
| 创建产品数 | 一个 | 一族（多个） |
| 扩展方式 | 加新工厂类 | 加新工厂族 |
| 产品维度 | 产品种类 | 产品族 × 产品等级 |

抽象工厂适合"多个维度组合"的场景，如"不同数据库 + 不同 ORM"、"不同主题 + 不同组件"。

#### Spring 里的工厂

Spring 的 `@Bean` 方法本质上就是工厂方法。`FactoryBean` 是 Spring 提供的标准工厂接口，适合创建逻辑复杂的第三方对象：

```java
@Component
public class HttpClientFactoryBean implements FactoryBean<HttpClient> {

    @Override
    public HttpClient getObject() {
        return HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .version(HttpClient.Version.HTTP_2)
                .build();
    }

    @Override
    public Class<?> getObjectType() {
        return HttpClient.class;
    }
}
```

注入时直接拿 `HttpClient`，不用关心它怎么被创建的。MyBatis 的 `SqlSessionFactoryBean` 就是典型的 `FactoryBean`。

### 建造者模式

**简单来说，把复杂对象的构造过程拆成一步步链式调用，避免构造器参数爆炸。**

#### 什么时候用

- 对象有很多可选参数，构造器组合爆炸。
- 需要分步构建、最终一次性创建不可变对象。

#### 构造器参数爆炸问题

```java
// 5 个参数，3 个可选，要写多少个构造器？
public class Order {
    public Order(String orderId) { ... }
    public Order(String orderId, BigDecimal amount) { ... }
    public Order(String orderId, BigDecimal amount, String coupon) { ... }
    public Order(String orderId, BigDecimal amount, String coupon, String address) { ... }
    public Order(String orderId, BigDecimal amount, String coupon, String address, String remark) { ... }
}
```

调用方还容易传错参数位置：

```java
new Order("ORD-001", null, null, "北京", null);  // 哪个 null 是哪个参数？
```

#### Builder 写法

```java
public class Order {

    private final String orderId;        // 必填
    private final BigDecimal amount;     // 必填
    private final String coupon;         // 可选
    private final String address;        // 可选
    private final String remark;         // 可选

    private Order(Builder builder) {
        this.orderId = builder.orderId;
        this.amount = builder.amount;
        this.coupon = builder.coupon;
        this.address = builder.address;
        this.remark = builder.remark;
    }

    public static Builder builder(String orderId, BigDecimal amount) {
        return new Builder(orderId, amount);
    }

    public static class Builder {

        private final String orderId;
        private final BigDecimal amount;
        private String coupon;
        private String address;
        private String remark;

        public Builder(String orderId, BigDecimal amount) {
            this.orderId = orderId;
            this.amount = amount;
        }

        public Builder coupon(String coupon) { this.coupon = coupon; return this; }
        public Builder address(String address) { this.address = address; return this; }
        public Builder remark(String remark) { this.remark = remark; return this; }

        public Order build() {
            return new Order(this);
        }
    }
}
```

使用：

```java
Order order = Order.builder("ORD-001", new BigDecimal("99.00"))
        .coupon("SAVE10")
        .address("北京")
        .remark("加急")
        .build();
```

每个参数有名字，可读性强；可选参数随意组合；`build()` 返回不可变对象。

#### Lombok @Builder

实际项目用 Lombok 一行注解搞定：

```java
@Builder
public class Order {
    private String orderId;
    private BigDecimal amount;
    private String coupon;
    private String address;
    private String remark;
}
```

```java
Order order = Order.builder()
        .orderId("ORD-001")
        .amount(new BigDecimal("99.00"))
        .coupon("SAVE10")
        .build();
```

#### JDK 里的 Builder

`StringBuilder` / `StringBuffer` 是建造者模式的体现——逐步 append 字符片段，最终 `toString()` 生成完整字符串。

`Stream.Builder` 也是：

```java
Stream.Builder<String> builder = Stream.builder();
builder.add("a").add("b").add("c");
Stream<String> stream = builder.build();
```

### 原型模式

**简单来说，通过克隆已有对象来创建新对象，不走构造器。**

#### 什么时候用

- 创建对象成本高（需要查数据库、调远程接口），但已有类似对象。
- 需要保留对象当前状态副本。

#### 怎么做

```java
public class Order implements Cloneable {

    private String orderId;
    private List<Item> items;

    @Override
    public Order clone() {
        try {
            return (Order) super.clone();  // 浅拷贝
        } catch (CloneNotSupportedException e) {
            throw new RuntimeException(e);
        }
    }
}
```

#### 浅拷贝 vs 深拷贝

```java
Order original = new Order("ORD-001", List.of(new Item("苹果", 2)));
Order copy = original.clone();

// 浅拷贝：copy.items 和 original.items 指向同一个 List
// 改 copy 的 items 会影响 original
```

| | 浅拷贝 | 深拷贝 |
| --- | --- | --- |
| 基本类型 | 复制值 | 复制值 |
| 引用类型 | 复制引用（共享） | 递归复制对象 |
| 实现方式 | `super.clone()` | 手动递归 clone 或序列化 |

深拷贝的实现：

```java
// 方式1：手动递归 clone
@Override
public Order clone() {
    Order copy = (Order) super.clone();
    copy.items = new ArrayList<>(this.items.stream()
            .map(Item::clone)
            .toList());
    return copy;
}

// 方式2：序列化（适合复杂嵌套对象）
@SuppressWarnings("unchecked")
public Order deepCopy() {
    ByteArrayOutputStream bos = new ByteArrayOutputStream();
    try (ObjectOutputStream oos = new ObjectOutputStream(bos)) {
        oos.writeObject(this);
    }
    ByteArrayInputStream bis = new ByteArrayInputStream(bos.toByteArray());
    try (ObjectInputStream ois = new ObjectInputStream(bis)) {
        return (Order) ois.readObject();
    }
}
```

#### Spring 里的原型 Bean

Spring 的 `@Scope("prototype")` 就是原型模式：每次从容器获取都创建新实例。

```java
@Component
@Scope("prototype")
public class OrderContext {
    // 每次注入或 getBean 都拿到新实例
}
```

注意：单例 Bean 注入 prototype Bean 时，注入只发生一次，prototype 被"固定"成单例。要每次拿新的，用 `@Lookup` 或 `ObjectProvider`。

## 结构型模式

### 适配器模式

**简单来说，让接口不兼容的类能一起工作——加一层转换。**

#### 什么时候用

- 系统升级，旧接口和新接口不兼容。
- 第三方 SDK 接口和自己的接口不匹配。
- 复用已有类但接口不兼容。

#### 怎么做

```java
// 目标接口——系统期望的接口
public interface MessageSender {
    void send(String to, String content);
}

// 第三方 SDK——接口不兼容
public class DingTalkSdk {
    public void pushMessage(String chatId, String text, String type) {
        System.out.println("钉钉消息: " + chatId + " - " + text);
    }
}

// 适配器——把 DingTalkSdk 适配成 MessageSender
public class DingTalkAdapter implements MessageSender {

    private final DingTalkSdk sdk = new DingTalkSdk();

    @Override
    public void send(String to, String content) {
        // 参数转换：把 (to, content) 转成 (chatId, text, type)
        sdk.pushMessage(to, content, "text");
    }
}
```

使用：

```java
MessageSender sender = new DingTalkAdapter();
sender.send("group-123", "部署完成");
```

#### 适配器 vs 装饰器 vs 代理

| 模式 | 目的 | 接口关系 |
| --- | --- | --- |
| 适配器 | 接口转换 | 适配器实现目标接口，持有被适配者 |
| 装饰器 | 加功能 | 装饰器和被装饰者实现同一接口 |
| 代理 | 控制访问 | 代理和被代理者实现同一接口 |

#### Spring 里的适配器

Spring MVC 的 `HandlerAdapter` 是经典适配器：

```text
DispatcherServlet 不直接调用 Controller
  → Controller 有多种形式：@RequestMapping 方法、SimpleController、HttpRequestHandler
  → 每种 Controller 的调用方式不同
  → HandlerAdapter 做适配
```

```java
// DispatcherServlet 里
HandlerAdapter ha = getHandlerAdapter(handler);
ModelAndView mv = ha.handle(request, response, handler);
```

`RequestMappingHandlerAdapter` 适配 `@RequestMapping` 方法，`SimpleControllerHandlerAdapter` 适配 `Controller` 接口。DispatcherServlet 不需要知道每种 Controller 怎么调，交给适配器。

### 装饰器模式

**简单来说，不改原类，给它"套壳"加新功能，还能层层套。**

#### 什么时候用

- 想给对象加额外行为，又不想修改原类、不想用继承。
- 多种增强可以自由组合（如日志 + 缓存 + 重试）。
- 如果用继承，子类数量会组合爆炸。

#### 怎么做

核心思路：装饰器和被装饰对象**实现同一个接口**，装饰器内部持有被装饰对象的引用，调用时先委托再增强。

```java
// ① 核心接口
public interface Weapon {
    void shoot();
}

// ② 被装饰的核心对象
public class AK47 implements Weapon {
    @Override
    public void shoot() {
        System.out.println("AK47 普通射击");
    }
}

// ③ 装饰器基类——实现同一接口，持有一个被装饰对象
public abstract class WeaponDecorator implements Weapon {

    protected Weapon weapon;

    public WeaponDecorator(Weapon weapon) {
        this.weapon = weapon;
    }

    @Override
    public void shoot() {
        weapon.shoot();
    }
}

// ④ 具体装饰器——在委托前后加料
public class FireDecorator extends WeaponDecorator {

    public FireDecorator(Weapon weapon) { super(weapon); }

    @Override
    public void shoot() {
        super.shoot();
        System.out.println("附加火焰伤害");
    }
}

public class IceDecorator extends WeaponDecorator {

    public IceDecorator(Weapon weapon) { super(weapon); }

    @Override
    public void shoot() {
        super.shoot();
        System.out.println("附加冰冻效果");
    }
}
```

层层套娃：

```java
Weapon w = new FireDecorator(new IceDecorator(new AK47()));
w.shoot();
// AK47 普通射击
// 附加冰冻效果
// 附加火焰伤害
```

装饰器能组合的原因是：装饰器和核心对象**类型一致**（都实现 `Weapon`），所以装饰器可以包装饰器。

#### 装饰器 vs 继承

想给 AK47 同时加火焰和冰冻效果：

| 方式 | 类数量 |
| --- | --- |
| 继承 | `AK47`、`FireAK47`、`IceAK47`、`FireIceAK47`、`IceFireAK47`... 组合爆炸 |
| 装饰器 | `AK47`、`FireDecorator`、`IceDecorator`，任意组合 |

#### JDK 里的经典例子

```java
InputStream fis = new FileInputStream("data.txt");       // 文件流
InputStream bis = new BufferedInputStream(fis);           // 加缓冲
InputStream dis = new DataInputStream(bis);               // 加读取基本类型
```

`BufferedInputStream` 和 `DataInputStream` 都继承 `FilterInputStream`（装饰器基类），都持有 `InputStream` 引用，层层包装。

#### Spring 里的装饰器

Spring 的 `TransactionAwareCacheDecorator` 给 `Cache` 加了事务感知能力——事务提交后才写缓存。

`BeanWrapper`、`WebRequest` 也有装饰器实现。

#### 装饰器 vs 代理

两者结构几乎一样（都持有一个同类型对象并委托），但**目的不同**：

| | 装饰器 | 代理 |
| --- | --- | --- |
| 目的 | 给对象**加功能** | **控制访问** |
| 谁创建被装饰/被代理对象 | 调用方传进来 | 代理自己创建或管理 |
| 典型场景 | 加日志、加缓存、加重试 | 权限校验、远程代理、延迟加载 |
| 使用者是否知道内部对象 | 知道（自己包的） | 不知道（透明替换） |

一句话区分：**装饰器是"加料"，代理是"控制"**。

### 代理模式

**简单来说，不直接访问目标对象，中间加一层代理，代理控制访问或加额外逻辑。**

#### 什么时候用

- 想在不改原类的前提下加横切逻辑（日志、权限、事务、监控）。
- 想控制对象访问（延迟加载、远程调用、权限校验）。
- 想在访问前后插入逻辑，但调用方不应该感知代理的存在。

#### 静态代理

手动写代理类，和目标对象实现同一接口：

```java
public interface UserService {
    void login(String username);
}

public class UserServiceImpl implements UserService {
    @Override
    public void login(String username) {
        System.out.println("用户 " + username + " 登录");
    }
}

public class UserServiceProxy implements UserService {

    private final UserService target;

    public UserServiceProxy(UserService target) {
        this.target = target;
    }

    @Override
    public void login(String username) {
        System.out.println("[日志] 开始登录: " + username);
        target.login(username);
        System.out.println("[日志] 登录完成");
    }
}
```

问题：每个接口都要手写一个代理类，接口方法多时极其繁琐。

#### JDK 动态代理

用 `Proxy.newProxyInstance` 在运行时生成代理类，不需要手写：

```java
UserService real = new UserServiceImpl();

UserService proxy = (UserService) Proxy.newProxyInstance(
        real.getClass().getClassLoader(),
        real.getClass().getInterfaces(),
        new InvocationHandler() {
            @Override
            public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
                System.out.println("[日志] 开始: " + method.getName());
                Object result = method.invoke(real, args);
                System.out.println("[日志] 结束: " + method.getName());
                return result;
            }
        }
);

proxy.login("admin");
```

JDK 动态代理的原理：运行时通过字节码生成技术创建一个实现了目标接口的代理类（`$Proxy0`），代理类的方法体调用 `InvocationHandler.invoke()`。

**限制：目标类必须实现接口。** `Proxy.newProxyInstance` 的第二个参数就是接口列表，没有接口就没法用。

#### CGLIB 动态代理

没有接口时用 CGLIB，通过**继承**生成子类代理：

```java
Enhancer enhancer = new Enhancer();
enhancer.setSuperclass(UserServiceImpl.class);   // 继承目标类
enhancer.setCallback(new MethodInterceptor() {
    @Override
    public Object intercept(Object obj, Method method, Object[] args, MethodProxy proxy) throws Throwable {
        System.out.println("[日志] 开始: " + method.getName());
        Object result = proxy.invokeSuper(obj, args);  // 调用父类（原始）方法
        System.out.println("[日志] 结束: " + method.getName());
        return result;
    }
});

UserServiceImpl proxy = (UserServiceImpl) enhancer.create();
proxy.login("admin");
```

CGLIB 的限制：

- 不能代理 `final` 类（不能继承）。
- 不能代理 `final` 方法（不能覆盖）。
- 不能代理 `private` 方法（不可见）。

#### JDK 动态代理 vs CGLIB

| | JDK 动态代理 | CGLIB |
| --- | --- | --- |
| 原理 | 实现接口 | 继承生成子类 |
| 要求 | 目标类必须实现接口 | 目标类不能是 `final` |
| 性能 | 创建快，调用略慢 | 创建慢，调用快 |
| Spring 默认 | 有接口时用 JDK | 无接口时用 CGLIB |
| Spring Boot 2.x+ | — | 默认全部用 CGLIB |

Spring Boot 2.x 之后，`spring.aop.proxy-target-class=true` 默认为 `true`，即默认用 CGLIB，即使目标类实现了接口。

#### Spring AOP 底层就是动态代理

Spring 的 `@Transactional`、`@Async`、`@Cacheable`、`@Retryable` 底层全是动态代理：

```java
@Service
public class OrderService {

    @Transactional
    public void createOrder(OrderRequest req) {
        orderMapper.insert(req.toDO());
        inventoryMapper.deduct(req.getSkuId(), req.getQty());
    }
}
```

`@Transactional` 的效果等价于代理类：

```java
public class OrderServiceProxy extends OrderService {

    private final TransactionManager txManager;

    @Override
    public void createOrder(OrderRequest req) {
        TransactionStatus tx = txManager.begin();   // 开事务
        try {
            super.createOrder(req);                  // 调用真实方法
            txManager.commit(tx);                    // 提交
        } catch (Exception e) {
            txManager.rollback(tx);                  // 回滚
            throw e;
        }
    }
}
```

Spring AOP 代理创建流程：

```text
Bean 实例化后
  → BeanPostProcessor（AbstractAutoProxyCreator）介入
  → 检查是否匹配切面（@Transactional / @Aspect / Pointcut）
  → 匹配则创建代理对象（JDK 或 CGLIB）
  → 容器里存的是代理对象，不是原始对象
```

#### 代理失效的经典场景

| 场景 | 原因 | 解决方案 |
| --- | --- | --- |
| 同类自调用 `this.method()` | `this` 是原始对象不是代理 | 注入自身代理、拆到另一个 Bean |
| 方法是 `private` | 代理无法覆盖 private 方法 | 改为 public 或用 AspectJ 编译时织入 |
| 方法是 `final` | 代理无法覆盖 final 方法 | 去掉 final 或用 AspectJ |
| 在构造器里调用被代理方法 | 代理还没创建完 | 移到 `@PostConstruct` |
| 通过 `new` 创建不走容器 | 不经过 BeanPostProcessor | 用容器获取 |

自调用失效的例子：

```java
@Service
public class OrderService {

    @Transactional
    public void createOrder(OrderRequest req) { /* ... */ }

    public void batchCreate(List<OrderRequest> list) {
        for (OrderRequest req : list) {
            this.createOrder(req);  // ❌ this 是原始对象，不走代理，没有事务！
        }
    }
}
```

解决方案——注入自身代理：

```java
@Service
public class OrderService {

    @Autowired
    @Lazy
    private OrderService self;  // 注入的是代理对象

    @Transactional
    public void createOrder(OrderRequest req) { /* ... */ }

    public void batchCreate(List<OrderRequest> list) {
        for (OrderRequest req : list) {
            self.createOrder(req);  // ✅ 走代理，有事务
        }
    }
}
```

详见 [Spring 事务失效场景](/notes/java-backend/transaction-failure-scenarios)。

### 外观模式

**简单来说，给复杂子系统提供一个统一入口，调用方不用直接和多个子系统交互。**

#### 什么时候用

- 子系统复杂，调用方需要和很多类交互。
- 需要给子系统分层，只暴露简化接口。
- 老系统重构，用外观封装旧接口。

#### 怎么做

```java
// 子系统：库存、支付、物流、通知——各自独立的 Service
public class InventoryService {
    public boolean deduct(String skuId, int qty) { /* ... */ return true; }
}
public class PaymentService {
    public boolean pay(String orderId, BigDecimal amount) { /* ... */ return true; }
}
public class LogisticsService {
    public String ship(String orderId) { /* ... */ return "TRACK-001"; }
}
public class NotificationService {
    public void notify(String userId, String message) { /* ... */ }
}

// 外观——提供简化入口
public class OrderFacade {

    private final InventoryService inventory;
    private final PaymentService payment;
    private final LogisticsService logistics;
    private final NotificationService notification;

    public OrderFacade(InventoryService inventory, PaymentService payment,
                       LogisticsService logistics, NotificationService notification) {
        this.inventory = inventory;
        this.payment = payment;
        this.logistics = logistics;
        this.notification = notification;
    }

    // 调用方只需要调一个方法
    public String placeOrder(OrderRequest req) {
        inventory.deduct(req.getSkuId(), req.getQty());
        payment.pay(req.getOrderId(), req.getAmount());
        String trackingNo = logistics.ship(req.getOrderId());
        notification.notify(req.getUserId(), "订单已发货: " + trackingNo);
        return trackingNo;
    }
}
```

调用方：

```java
// 不需要知道库存、支付、物流、通知的存在
String trackingNo = orderFacade.placeOrder(req);
```

#### Spring 里的外观模式

- `JdbcTemplate` 是 JDBC 的外观——隐藏 Connection、Statement、ResultSet 的管理。
- `RestTemplate` / `RestClient` 是 HTTP 客户端的外观。
- `ApplicationContext` 本身就是 Spring 容器的外观——隐藏了 BeanFactory、资源加载、事件发布等子系统。

### 组合模式

**简单来说，把对象组合成树形结构，叶子和树枝统一对待——调用方不用区分。**

#### 什么时候用

- 树形结构（文件系统、组织架构、菜单、商品分类）。
- 需要统一处理树中所有节点，不关心是叶子还是枝干。

#### 怎么做

```java
// 统一接口——叶子 和 组合 都实现它
public interface FileSystemNode {
    String getName();
    long getSize();
    void print(String indent);
}

// 叶子——文件
public class File implements FileSystemNode {

    private final String name;
    private final long size;

    public File(String name, long size) {
        this.name = name;
        this.size = size;
    }

    @Override
    public String getName() { return name; }

    @Override
    public long getSize() { return size; }

    @Override
    public void print(String indent) {
        System.out.println(indent + "📄 " + name + " (" + size + "B)");
    }
}

// 组合——文件夹，持有子节点列表
public class Directory implements FileSystemNode {

    private final String name;
    private final List<FileSystemNode> children = new ArrayList<>();

    public Directory(String name) {
        this.name = name;
    }

    public void add(FileSystemNode node) {
        children.add(node);
    }

    @Override
    public String getName() { return name; }

    @Override
    public long getSize() {
        // 递归：子节点大小之和
        return children.stream().mapToLong(FileSystemNode::getSize).sum();
    }

    @Override
    public void print(String indent) {
        System.out.println(indent + "📁 " + name + "/");
        for (FileSystemNode child : children) {
            child.print(indent + "  ");
        }
    }
}
```

使用：

```java
Directory root = new Directory("project");
Directory src = new Directory("src");
src.add(new File("Main.java", 1024));
src.add(new File("Utils.java", 512));
Directory test = new Directory("test");
test.add(new File("MainTest.java", 256));
root.add(src);
root.add(test);
root.add(new File("README.md", 128));

root.print("");
// 📁 project/
//   📁 src/
//     📄 Main.java (1024B)
//     📄 Utils.java (512B)
//   📁 test/
//     📄 MainTest.java (256B)
//   📄 README.md (128B)

root.getSize();  // 1920
```

调用方对 `File` 和 `Directory` 调用 `getSize()`、`print()` 的方式完全一样，不需要 `instanceof` 判断。

#### MyBatis 里的组合模式

MyBatis 的动态 SQL 解析用到了组合模式。`<if>`、`<where>`、`<foreach>`、`<choose>` 都被解析成 `SqlNode` 接口的实现：

```java
public interface SqlNode {
    boolean apply(DynamicContext context);
}
```

- `TextSqlNode`：叶子节点，纯文本。
- `IfSqlNode`：组合节点，包含子 `SqlNode` 列表，条件成立时递归 apply。
- `MixedSqlNode`：组合节点，按顺序 apply 所有子节点。

`<where>` 标签里可以嵌套 `<if>`，`<if>` 里可以嵌套 `<foreach>`——就是组合模式的树形递归。详见 [MyBatis 动态 SQL](/notes/java-backend/mybatis-xml-dynamic-sql)。

### 享元模式

**简单来说，共享细粒度对象，减少内存——相同对象只创建一份。**

#### 什么时候用

- 大量相似对象，创建成本高或占内存。
- 对象大部分状态可以外部化（不变的内部状态共享，变化的外部状态传入）。

#### 经典面试题

```java
Integer a = Integer.valueOf(127);
Integer b = Integer.valueOf(127);
System.out.println(a == b);   // true

Integer c = Integer.valueOf(128);
Integer d = Integer.valueOf(128);
System.out.println(c == d);   // false
```

为什么 127 相等、128 不等？因为 `Integer` 内部有一个享元池（`IntegerCache`），缓存了 `-128 ~ 127` 的 `Integer` 对象：

```java
// Integer.IntegerCache（JDK 源码简化）
private static class IntegerCache {
    static final Integer[] cache;
    static {
        cache = new Integer[256];
        for (int i = 0; i < cache.length; i++) {
            cache[i] = new Integer(i - 128);  // -128 ~ 127
        }
    }
}

public static Integer valueOf(int i) {
    if (i >= IntegerCache.low && i <= IntegerCache.high)
        return IntegerCache.cache[i + (-IntegerCache.low)];  // 从缓存取
    return new Integer(i);  // 超出范围才 new
}
```

这就是享元模式：`-128 ~ 127` 的 Integer 对象全局共享，不重复创建。

#### 其他享元例子

| 来源 | 共享对象 |
| --- | --- |
| `String` 字符串常量池 | `"abc"` 字面量只存一份 |
| `Integer.valueOf` | -128 ~ 127 |
| `Boolean.TRUE` / `Boolean.FALSE` | 全局只有一个实例 |
| 线程池 | 线程对象复用 |
| 数据库连接池 | 连接对象复用 |

严格来说线程池和连接池不是标准享元（它们是对象池，对象会被借出和归还），但核心思想一致：**复用对象，避免重复创建**。

#### 手写享元

场景：棋盘游戏有大量棋子，颜色只有黑白两种。

```java
// 享元对象——内部状态（颜色）共享
public class ChessPiece {
    private final Color color;  // 内部状态：不变

    public ChessPiece(Color color) {
        this.color = color;
    }

    public void display(int x, int y) {  // 外部状态：位置，使用时传入
        System.out.println(color + " 棋子放在 (" + x + ", " + y + ")");
    }
}

// 享元工厂——确保每种颜色只创建一个
public class ChessPieceFactory {

    private static final Map<Color, ChessPiece> cache = new EnumMap<>(Color.class);

    public static ChessPiece get(Color color) {
        return cache.computeIfAbsent(color, ChessPiece::new);
    }
}
```

使用：

```java
ChessPiece black1 = ChessPieceFactory.get(Color.BLACK);  // 第一次创建
ChessPiece black2 = ChessPieceFactory.get(Color.BLACK);  // 复用同一个
black1 == black2;  // true
```

1000 个黑子共享同一个 `ChessPiece` 实例，只有外部状态（位置）不同。

### 桥接模式

**简单来说，把抽象和实现分离，两个维度独立变化——用组合代替继承。**

#### 什么时候用

- 两个维度独立变化，继承会导致类爆炸。
- 想在运行时切换实现。

#### 经典例子

消息发送有两个维度：消息类型（普通/加急）× 发送渠道（邮件/短信/钉钉）。

用继承：`EmailNormalMessage`、`EmailUrgentMessage`、`SmsNormalMessage`、`SmsUrgentMessage`... 3 × 4 = 12 个类。

用桥接：消息类型和发送渠道分开，组合使用：

```java
// 维度1：发送渠道（实现）
public interface MessageChannel {
    void deliver(String to, String content);
}

public class EmailChannel implements MessageChannel {
    @Override
    public void deliver(String to, String content) {
        System.out.println("邮件发给 " + to + ": " + content);
    }
}

public class SmsChannel implements MessageChannel {
    @Override
    public void deliver(String to, String content) {
        System.out.println("短信发给 " + to + ": " + content);
    }
}

// 维度2：消息类型（抽象），持有渠道引用——这就是"桥"
public abstract class Message {

    protected MessageChannel channel;  // 桥：连接抽象和实现

    public Message(MessageChannel channel) {
        this.channel = channel;
    }

    public abstract void send(String to, String content);
}

public class NormalMessage extends Message {

    public NormalMessage(MessageChannel channel) { super(channel); }

    @Override
    public void send(String to, String content) {
        channel.deliver(to, content);
    }
}

public class UrgentMessage extends Message {

    public UrgentMessage(MessageChannel channel) { super(channel); }

    @Override
    public void send(String to, String content) {
        channel.deliver(to, "【加急】" + content);
    }
}
```

使用：

```java
Message msg = new UrgentMessage(new SmsChannel());
msg.send("13800138000", "服务器告警");
// 短信发给 13800138000: 【加急】服务器告警
```

加新渠道：加一个 `MessageChannel` 实现。加新类型：加一个 `Message` 子类。两个维度独立扩展，互不影响。

#### JDBC 里的桥接

JDBC 的 `DriverManager` 和 `Connection` 就是桥接：

```text
抽象：java.sql.Connection（接口）
实现：各数据库驱动（MySQL Driver、Oracle Driver、PostgreSQL Driver）
桥：DriverManager.getConnection() 把抽象和具体实现连起来
```

换数据库只换驱动（实现），`Connection` 接口（抽象）不变。

## 行为型模式

### 策略模式

**简单来说，把"做事的方式"抽成接口，运行时换实现，消除 `if-else` 分支。**

#### 什么时候用

- 同一件事有多种做法，运行时根据条件选一种。
- 新做法可能不断加入。
- 不同做法之间没有耦合。

典型场景：支付渠道、折扣计算、消息发送方式、导出格式。

#### 怎么做

```java
// ① 策略接口
public interface PaymentStrategy {
    void pay(BigDecimal amount);
}

// ② 具体策略
public class AlipayStrategy implements PaymentStrategy {
    @Override
    public void pay(BigDecimal amount) {
        System.out.println("支付宝支付 " + amount);
    }
}

public class WechatPayStrategy implements PaymentStrategy {
    @Override
    public void pay(BigDecimal amount) {
        System.out.println("微信支付 " + amount);
    }
}
```

调用方：

```java
public class PayService {

    private final PaymentStrategy strategy;

    public PayService(PaymentStrategy strategy) {
        this.strategy = strategy;
    }

    public void pay(BigDecimal amount) {
        strategy.pay(amount);
    }
}
```

#### Spring 里怎么用（标准用法）

利用 Spring 的依赖注入自动收集策略：

```java
@Component
public class AlipayStrategy implements PaymentStrategy { /* ... */ }

@Component
public class WechatPayStrategy implements PaymentStrategy { /* ... */ }
```

Spring 会把所有 `PaymentStrategy` 实现按 beanName 注入 `Map`：

```java
@Service
public class PayRouter {

    // Spring 自动注入：key = beanName, value = 对应策略实例
    private final Map<String, PaymentStrategy> strategyMap;

    public PayRouter(Map<String, PaymentStrategy> strategyMap) {
        this.strategyMap = strategyMap;
    }

    public void pay(String channel, BigDecimal amount) {
        PaymentStrategy strategy = strategyMap.get(channel + "Strategy");
        if (strategy == null) {
            throw new BizException(ErrorCode.PAY_CHANNEL_NOT_SUPPORTED);
        }
        strategy.pay(amount);
    }
}
```

加新渠道时：新建 `UnionPayStrategy` 并标 `@Component`，`PayRouter` 一行不用改。

也可以用 `List<PaymentStrategy>` 注入所有策略，配合策略内部的 `supports()` 方法做匹配：

```java
public interface PaymentStrategy {
    boolean supports(String channel);
    void pay(BigDecimal amount);
}

@Service
public class PayRouter {

    private final List<PaymentStrategy> strategies;

    public PayRouter(List<PaymentStrategy> strategies) {
        this.strategies = strategies;
    }

    public void pay(String channel, BigDecimal amount) {
        strategies.stream()
                .filter(s -> s.supports(channel))
                .findFirst()
                .orElseThrow(() -> new BizException("不支持的支付渠道: " + channel))
                .pay(amount);
    }
}
```

#### 策略 + 工厂组合

策略负责"怎么做"，工厂负责"怎么创建"。实际项目中经常组合使用：

```java
public class PaymentStrategyFactory {

    public static PaymentStrategy create(String channel) {
        return switch (channel) {
            case "alipay"   -> new AlipayStrategy();
            case "wechat"   -> new WechatPayStrategy();
            default -> throw new IllegalArgumentException("未知渠道: " + channel);
        };
    }
}
```

Spring 项目里工厂由容器替代（`@Component` 自动注册），不需要手写工厂类。

#### 策略 vs 模板方法

| | 策略 | 模板方法 |
| --- | --- | --- |
| 实现方式 | 组合（持有策略引用） | 继承（子类覆盖步骤） |
| 灵活度 | 运行时换策略 | 编译时确定 |
| 粒度 | 整个算法替换 | 替换算法中的个别步骤 |
| 耦合 | 低（接口依赖） | 高（继承关系） |

### 模板方法模式

**简单来说，父类定义算法骨架，子类实现具体步骤——流程固定，步骤可变。**

#### 什么时候用

- 算法的整体流程固定，但某些步骤的实现可变。
- 多个子类有公共流程，只是个别步骤不同。
- 想控制子类的扩展点（哪些步骤可以改，哪些不能改）。

#### 怎么做

```java
// 模板——定义流程骨架
public abstract class AbstractOrderProcessor {

    // 模板方法——final 防止子类改流程
    public final void process(OrderRequest req) {
        validate(req);        // 步骤1：校验（子类实现）
        Order order = create(req);  // 步骤2：创建订单（子类实现）
        afterCreate(order);   // 步骤3：后置处理（钩子，可选覆盖）
        log(order);           // 步骤4：日志（公共实现）
    }

    // 抽象方法——子类必须实现
    protected abstract void validate(OrderRequest req);
    protected abstract Order create(OrderRequest req);

    // 钩子方法——子类可选覆盖，有默认实现
    protected void afterCreate(Order order) {
        // 默认空实现，子类按需覆盖
    }

    // 公共方法——子类直接用，不需要覆盖
    private void log(Order order) {
        System.out.println("订单处理完成: " + order.getOrderId());
    }
}

// 具体子类——只实现可变步骤
public class PhysicalOrderProcessor extends AbstractOrderProcessor {

    @Override
    protected void validate(OrderRequest req) {
        if (req.getAddress() == null) {
            throw new BizException("实物订单需要收货地址");
        }
    }

    @Override
    protected Order create(OrderRequest req) {
        return new Order(req.getOrderId(), OrderType.PHYSICAL);
    }

    @Override
    protected void afterCreate(Order order) {
        System.out.println("预约仓库发货");
    }
}

public class VirtualOrderProcessor extends AbstractOrderProcessor {

    @Override
    protected void validate(OrderRequest req) {
        if (req.getEmail() == null) {
            throw new BizException("虚拟商品需要邮箱");
        }
    }

    @Override
    protected Order create(OrderRequest req) {
        return new Order(req.getOrderId(), OrderType.VIRTUAL);
    }
    // afterCreate 不覆盖，走默认空实现
}
```

使用：

```java
AbstractOrderProcessor processor = new PhysicalOrderProcessor();
processor.process(req);  // 流程一样，步骤不同
```

#### 钩子方法

`afterCreate` 是钩子方法（Hook）——有默认实现（通常是空），子类**可选**覆盖。父类通过钩子方法给子类留扩展点，但子类不覆盖也不影响主流程。

和抽象方法的区别：

| | 抽象方法 | 钩子方法 |
| --- | --- | --- |
| 是否必须实现 | 必须 | 可选 |
| 父类有没有实现 | 没有 | 有（通常空实现） |
| 作用 | 强制子类完成步骤 | 给子类留可选扩展 |

#### Spring 里的模板方法

模板方法是 Spring 源码里用得最多的模式之一：

| 模板类 | 骨架 | 可变步骤 |
| --- | --- | --- |
| `JdbcTemplate` | 连接获取 → 执行 SQL → 处理结果 → 关连接 | `RowMapper`（结果映射） |
| `RestTemplate` | 构建 → 执行 → 错误处理 | `ResponseExtractor` |
| `TransactionTemplate` | 开事务 → 执行 → 提交/回滚 | `TransactionCallback` |
| `JpaTransactionManager` | 事务流程 | 具体数据源操作 |

`JdbcTemplate` 的核心流程：

```java
// JdbcTemplate.execute 简化
public <T> T execute(StatementCallback<T> action) {
    Connection con = DataSourceUtils.getConnection(getDataSource());  // 1. 获取连接
    Statement stmt = null;
    try {
        stmt = con.createStatement();
        T result = action.doInStatement(stmt);  // 2. 可变步骤：执行 SQL + 处理结果
        return result;
    } finally {
        JdbcUtils.closeStatement(stmt);  // 3. 关闭
        DataSourceUtils.releaseConnection(con, getDataSource());  // 4. 释放连接
    }
}
```

调用方只关心 SQL 和结果映射（`RowMapper`），连接管理、异常翻译、资源释放全由模板搞定。

Spring 还有一个最顶级的模板方法：`AbstractApplicationContext.refresh()`——定义了容器启动的完整流程（十几个步骤），子类 `GenericWebApplicationContext`、`AnnotationConfigServletWebServerApplicationContext` 在 `onRefresh()` 等步骤里做自己的事情。详见 [Spring IoC 与依赖注入](/notes/java-backend/spring-ioc-di)。

#### 模板方法 vs 策略

| | 模板方法 | 策略 |
| --- | --- | --- |
| 实现方式 | 继承 | 组合 |
| 粒度 | 整个流程，个别步骤可变 | 整个算法替换 |
| 编译/运行 | 编译时确定（子类） | 运行时可换 |
| 耦合 | 高（继承） | 低（接口） |

原则：**优先用组合（策略），只有流程骨架确实固定时才用继承（模板方法）**。

### 观察者模式

**简单来说，一个对象状态变了，自动通知所有订阅者——发布 / 订阅。**

#### 什么时候用

- 一个对象变化后，其他多个对象需要做出响应，但不想硬编码依赖。
- 事件驱动架构。
- 消息广播。

#### 怎么做

```java
// ① 观察者接口
public interface Observer {
    void update(String event, Object data);
}

// ② 主题接口
public interface Subject {
    void subscribe(Observer observer);
    void unsubscribe(Observer observer);
    void publish(String event, Object data);
}

// ③ 具体主题
public class EventPublisher implements Subject {

    private final List<Observer> observers = new CopyOnWriteArrayList<>();  // 线程安全

    @Override
    public void subscribe(Observer observer) {
        observers.add(observer);
    }

    @Override
    public void unsubscribe(Observer observer) {
        observers.remove(observer);
    }

    @Override
    public void publish(String event, Object data) {
        for (Observer o : observers) {
            o.update(event, data);
        }
    }
}

// ④ 具体观察者
public class InventoryObserver implements Observer {
    @Override
    public void update(String event, Object data) {
        if ("order_created".equals(event)) {
            System.out.println("扣减库存: " + data);
        }
    }
}
```

注意用 `CopyOnWriteArrayList` 而不是 `ArrayList`——通知过程中可能有观察者动态注册/注销，`ArrayList` 在遍历时修改会 `ConcurrentModificationException`。

#### Spring 事件机制

Spring 内置了观察者模式的实现：`ApplicationEventPublisher` + `@EventListener`。

定义事件：

```java
public class OrderCreatedEvent {
    private final String orderId;
    public OrderCreatedEvent(String orderId) { this.orderId = orderId; }
    public String getOrderId() { return orderId; }
}
```

发布事件：

```java
@Service
public class OrderService {

    private final ApplicationEventPublisher publisher;

    public OrderService(ApplicationEventPublisher publisher) {
        this.publisher = publisher;
    }

    public void createOrder(OrderRequest req) {
        orderMapper.insert(req.toDO());
        publisher.publishEvent(new OrderCreatedEvent(req.getOrderId()));
    }
}
```

监听事件：

```java
@Component
public class InventoryListener {

    @EventListener
    public void onOrderCreated(OrderCreatedEvent event) {
        inventoryService.deduct(event.getOrderId());
    }
}

@Component
public class PointsListener {

    @EventListener
    @Async("eventExecutor")  // 异步执行，不阻塞主流程
    public void onOrderCreated(OrderCreatedEvent event) {
        pointsService.award(event.getOrderId());
    }
}
```

#### `@EventListener` vs `@TransactionalEventListener`

| | `@EventListener` | `@TransactionalEventListener` |
| --- | --- | --- |
| 触发时机 | 事件发布时立即触发 | 事务提交后（或回滚后）触发 |
| 默认同步 | 是 | 是（但通常配 `@Async`） |
| 事务上下文 | 在当前事务中执行 | 在新事务或无事务中执行 |
| 典型场景 | 内部模块联动 | 事务提交后才发 MQ / 通知 |

```java
@Component
public class MqMessageListener {

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    @Async("eventExecutor")
    public void onOrderCreated(OrderCreatedEvent event) {
        // 只有订单事务提交成功后才会执行
        mqProducer.send("order.exchange", event.getOrderId());
    }
}
```

如果不这么做：订单回滚了但消息已经发出去了，下游消费时会找不到订单。详见 [本地事务与外部副作用](/notes/java-backend/transaction-outbox-side-effects)。

#### 观察者 vs MQ

| | 进程内观察者 | 消息队列 |
| --- | --- | --- |
| 范围 | 同一个 JVM | 跨进程 / 跨系统 |
| 可靠性 | 进程崩了事件丢失 | 持久化、ACK 保证 |
| 性能 | 微秒级 | 毫秒级 |
| 一致性 | 强一致（同步） | 最终一致 |
| 适合 | 模块解耦、内部联动 | 分布式事件驱动 |

项目里的选择：同一个微服务内用 Spring 事件，跨服务用 MQ。两者不互斥——可以先发 Spring 事件，监听器里再发 MQ。

### 责任链模式

**简单来说，请求沿着处理器链传递，每个处理器决定处理还是传给下一个。**

#### 什么时候用

- 一个请求需要经过多个处理步骤，顺序处理。
- 每个处理器决定是否处理或传给下一个。
- 处理器顺序可能变化，或需要动态增减。

典型场景：Servlet Filter、Spring Interceptor、参数校验、审批流、Sentinel 限流链。

#### 怎么做

```java
// 处理器接口
public abstract class Handler {

    protected Handler next;  // 下一个处理器

    public Handler setNext(Handler next) {
        this.next = next;
        return next;  // 链式调用
    }

    public void handle(Request request) {
        if (canHandle(request)) {
            doHandle(request);
        }
        if (next != null) {
            next.handle(request);  // 传给下一个
        }
    }

    protected abstract boolean canHandle(Request request);
    protected abstract void doHandle(Request request);
}
```

具体处理器——订单校验链：

```java
public class AuthHandler extends Handler {

    @Override
    protected boolean canHandle(Request request) {
        return true;  // 总是执行
    }

    @Override
    protected void doHandle(Request request) {
        if (request.getToken() == null) {
            throw new BizException("未登录");
        }
        System.out.println("认证通过");
    }
}

public class ParamValidateHandler extends Handler {

    @Override
    protected boolean canHandle(Request request) {
        return true;
    }

    @Override
    protected void doHandle(Request request) {
        if (request.getOrderId() == null) {
            throw new BizException("订单ID不能为空");
        }
        System.out.println("参数校验通过");
    }
}

public class RiskCheckHandler extends Handler {

    @Override
    protected boolean canHandle(Request request) {
        return true;
    }

    @Override
    protected void doHandle(Request request) {
        if (isHighRisk(request)) {
            throw new BizException("风控拦截");
        }
        System.out.println("风控检查通过");
    }
}
```

组装链：

```java
Handler chain = new AuthHandler();
chain.setNext(new ParamValidateHandler())
     .setNext(new RiskCheckHandler());

chain.handle(request);
// 认证通过
// 参数校验通过
// 风控检查通过
```

#### 变体：纯责任链 vs 非纯责任链

| | 纯责任链 | 非纯责任链 |
| --- | --- | --- |
| 处理方式 | 只有一个处理器处理，其余不碰 | 每个处理器都参与处理 |
| 传给下一个 | 处理完就结束 | 处理完继续传 |
| 典型场景 | 职责分派（谁来处理） | 请求增强/过滤（层层加工） |

Servlet Filter 是非纯责任链——每个 Filter 都执行，处理完继续传：

```java
public interface Filter {
    void doFilter(Request request, Response response, FilterChain chain);
}

// FilterChain 就是责任链
public class FilterChain {

    private final List<Filter> filters;
    private int pos = 0;

    public void doFilter(Request request, Response response) {
        if (pos < filters.size()) {
            Filter filter = filters.get(pos++);
            filter.doFilter(request, response, this);  // 每个 Filter 调 chain.doFilter 继续
        }
    }
}
```

#### Spring 里的责任链

| 场景 | 链 |
| --- | --- |
| Servlet Filter | `FilterChain` → 认证、日志、CORS、编码 |
| Spring Interceptor | `HandlerExecutionChain` → 认证、权限、日志 |
| Spring Cloud Gateway | `GatewayFilterChain` → 路由、限流、改写 |
| Sentinel | `ProcessorSlotChain` → 限流、熔断、统计 |
| MyBatis 插件 | `InterceptorChain` → 拦截 SQL 执行 |

Servlet Filter 链的执行顺序：

```text
请求进来
  → Filter1.doFilter()
    → Filter2.doFilter()
      → Filter3.doFilter()
        → Servlet.service()
      ← Filter3 后置处理
    ← Filter2 后置处理
  ← Filter1 后置处理
响应出去
```

像洋葱模型——进去时正序执行，出来时逆序执行。Spring Cloud Gateway 的 Filter 也是同样的模式。

### 状态机模式

**简单来说，对象在不同状态下行为不同，切换状态时自动执行进入/退出逻辑。**

#### 什么时候用

- 对象有多个状态，状态间有明确的流转规则。
- 每个状态下允许的操作不同。
- 状态切换时需要执行副作用（回调、通知、清理）。

典型场景：订单状态（待支付 → 已支付 → 已发货 → 已完成 / 已取消）、审批流、游戏角色状态。

#### 状态机 vs `if-else`

订单状态管理，反面写法：

```java
public class OrderService {

    public void handle(Order order, String action) {
        if ("pay".equals(action)) {
            if (order.getStatus() == Status.PENDING) {
                order.setStatus(Status.PAID);
            } else {
                throw new BizException("当前状态不允许支付");
            }
        } else if ("ship".equals(action)) {
            if (order.getStatus() == Status.PAID) {
                order.setStatus(Status.SHIPPED);
            } else {
                throw new BizException("当前状态不允许发货");
            }
        } else if ("cancel".equals(action)) {
            if (order.getStatus() == Status.PENDING || order.getStatus() == Status.PAID) {
                order.setStatus(Status.CANCELLED);
            } else {
                throw new BizException("当前状态不允许取消");
            }
        }
        // 状态越多，越长
    }
}
```

问题：每个操作都要检查所有状态，状态流转规则散落在各个方法里，改一个状态要改多处。

#### 怎么做

把每个状态抽象成独立的类，状态切换由状态类自己决定：

```java
// ① 状态接口
public interface OrderState {
    void pay(OrderContext ctx);
    void ship(OrderContext ctx);
    void cancel(OrderContext ctx);
}

// ② 上下文——持有当前状态，委托给状态处理
public class OrderContext {

    private OrderState currentState;

    public OrderContext(OrderState initialState) {
        this.currentState = initialState;
    }

    public void changeState(OrderState newState) {
        this.currentState = newState;
    }

    public void pay()   { currentState.pay(this); }
    public void ship()  { currentState.ship(this); }
    public void cancel(){ currentState.cancel(this); }
}

// ③ 具体状态——每个状态决定自己允许什么操作、切到哪个状态
public class PendingState implements OrderState {

    @Override
    public void pay(OrderContext ctx) {
        System.out.println("支付成功");
        ctx.changeState(new PaidState());
    }

    @Override
    public void ship(OrderContext ctx) {
        throw new BizException("待支付状态不能发货");
    }

    @Override
    public void cancel(OrderContext ctx) {
        System.out.println("订单已取消");
        ctx.changeState(new CancelledState());
    }
}

public class PaidState implements OrderState {

    @Override
    public void pay(OrderContext ctx) {
        throw new BizException("已支付，不能重复支付");
    }

    @Override
    public void ship(OrderContext ctx) {
        System.out.println("已发货");
        ctx.changeState(new ShippedState());
    }

    @Override
    public void cancel(OrderContext ctx) {
        System.out.println("已支付订单取消，发起退款");
        ctx.changeState(new CancelledState());
    }
}
```

使用：

```java
OrderContext order = new OrderContext(new PendingState());
order.pay();     // 支付成功 → PaidState
order.ship();    // 已发货 → ShippedState
order.cancel();  // 抛异常：已发货不能取消
```

#### 通用状态机基类

如果状态切换时有统一的"退出旧状态 → 进入新状态"流程：

```java
public interface IState {
    void enter();
    void exit();
    void handleInput(String input);
    void update();
}

public abstract class StateMachine {

    protected IState currentState;

    public void changeState(IState newState) {
        currentState.exit();
        currentState = newState;
        newState.enter();
    }
}
```

#### COLA 状态机

阿里开源的 COLA 状态机更适合后端订单场景，轻量且声明式：

```java
StateMachine<Status, Event, Order> stateMachine = StateMachineBuilder
        .<Status, Event, Order>create("ORDER_SM")
        .externalTransition()
            .from(Status.PENDING).to(Status.PAID)
            .on(Event.PAY)
            .perform(ctx -> {
                Order order = ctx.getMessage();
                System.out.println("支付: " + order.getId());
            })
        .externalTransition()
            .from(Status.PAID).to(Status.SHIPPED)
            .on(Event.SHIP)
            .perform(ctx -> System.out.println("发货"))
        .externalTransition()
            .from(Status.PENDING).to(Status.CANCELLED)
            .on(Event.CANCEL)
            .perform(ctx -> System.out.println("取消"))
        .build();

// 触发
stateMachine.fireEvent(Status.PENDING, Event.PAY, order);
```

#### 状态机 vs 策略

| | 状态机 | 策略 |
| --- | --- | --- |
| 切换方式 | 状态自己决定下一个状态 | 外部决定用什么策略 |
| 状态感知 | 知道当前状态，有流转规则 | 无状态，随时可换 |
| 生命周期 | 有状态流转 | 无生命周期 |

### 命令模式

**简单来说，把"请求"封装成对象，可以排队、记录、撤销。**

#### 什么时候用

- 需要把请求参数化（不同请求 = 不同命令对象）。
- 需要排队执行、延迟执行、撤销重做。
- 需要记录操作日志。

#### JDK 里的命令模式

`Runnable` 就是最简单的命令：

```java
Runnable command = () -> System.out.println("执行任务");
executor.execute(command);  // 命令交给线程池，排队执行
```

`Callable` 是有返回值的命令：

```java
Callable<String> command = () -> {
    Thread.sleep(1000);
    return "result";
};
Future<String> future = executor.submit(command);  // 异步执行
```

#### 撤销/重做示例

```java
public interface Command {
    void execute();
    void undo();
}

public class AddTextCommand implements Command {

    private final Document doc;
    private final String text;

    public AddTextCommand(Document doc, String text) {
        this.doc = doc;
        this.text = text;
    }

    @Override
    public void execute() {
        doc.append(text);
    }

    @Override
    public void undo() {
        doc.removeLast(text.length());
    }
}

// 调用方
Stack<Command> history = new Stack<>();
Command cmd = new AddTextCommand(doc, "hello");
cmd.execute();
history.push(cmd);

// 撤销
history.pop().undo();
```

### 迭代器模式

**简单来说，提供一种方法顺序访问集合中的元素，不暴露集合内部结构。**

JDK 的集合框架全是迭代器模式的体现：

```java
List<String> list = List.of("a", "b", "c");
Iterator<String> it = list.iterator();
while (it.hasNext()) {
    System.out.println(it.next());
}

// 增强_for 循环底层也是迭代器
for (String s : list) {
    System.out.println(s);
}
```

#### fail-fast vs fail-safe

| | fail-fast | fail-safe |
| --- | --- | --- |
| 代表 | `ArrayList` / `HashMap` | `CopyOnWriteArrayList` / `ConcurrentHashMap` |
| 遍历时修改 | 抛 `ConcurrentModificationException` | 不抛异常 |
| 原理 | 遍历前记录 modCount，遍历时比较 | 遍历的是副本/快照 |
| 代价 | 及时发现问题 | 内存开销、数据非实时 |

```java
// fail-fast：遍历时修改会报错
List<String> list = new ArrayList<>(List.of("a", "b", "c"));
for (String s : list) {
    if ("b".equals(s)) {
        list.remove(s);  // ConcurrentModificationException!
    }
}

// 正确做法：用 Iterator.remove()
Iterator<String> it = list.iterator();
while (it.hasNext()) {
    if ("b".equals(it.next())) {
        it.remove();  // OK
    }
}

// fail-safe：遍历副本，不报错但可能看不到最新数据
CopyOnWriteArrayList<String> cowList = new CopyOnWriteArrayList<>(List.of("a", "b", "c"));
for (String s : cowList) {
    if ("b".equals(s)) {
        cowList.remove(s);  // OK，但遍历的是旧副本
    }
}
```

### 其他行为型模式（了解即可）

#### 中介者模式

多个对象之间的交互集中到一个中介者，对象之间不直接通信。

Spring MVC 的 `DispatcherServlet` 就是中介者——所有 Controller 不互相调用，都通过 DispatcherServlet 转发。

```text
没有中介者：Controller 之间互相调用，网状依赖
  A → B, A → C, B → D, C → D ...

有中介者：所有 Controller 只和 DispatcherServlet 交互
  A → DispatcherServlet → B
  B → DispatcherServlet → C
```

#### 备忘录模式

保存对象的某个状态，以便以后恢复。

Java 的序列化、`Date` 的快照、事务的 savepoint 都是备忘录的体现。文本编辑器的"撤销"功能是经典备忘录。

#### 访问者模式

在不修改类的前提下给类添加新操作。适合"数据结构稳定但操作经常变化"的场景。

Java 的 ASM 字节码操作库用访问者模式遍历 class 文件结构。`FileVisitor` 用于递归遍历文件树。

实际项目中用得很少，了解概念即可。

#### 解释器模式

定义一种语言语法，用解释器执行。

Spring SpEL（Spring Expression Language）的解析器、正则表达式引擎都是解释器模式。日常开发几乎不会自己写解释器。

## 模式之间的关系

这些模式不是孤立的，项目里经常组合使用：

```text
下单流程
  → 策略模式：选择支付方式
  → 观察者模式：下单后通知库存、积分、消息
  → 状态机模式：订单状态流转
  → 代理模式：@Transactional 控制事务
  → 工厂模式：根据渠道创建对应的支付策略
  → 责任链模式：请求经过认证 → 校验 → 风控
  → 模板方法：订单处理骨架，实物/虚拟子类实现差异
```

常见组合：

| 组合 | 场景 |
| --- | --- |
| 策略 + 工厂 | 工厂创建策略，策略执行逻辑 |
| 策略 + 模板方法 | 模板定义流程，策略替换某个步骤 |
| 观察者 + 状态机 | 状态切换时发事件，观察者响应 |
| 责任链 + 命令 | 命令对象在链上传递 |
| 装饰器 + 代理 | 先装饰增强再代理控制 |
| 工厂 + 单例 | 工厂本身是单例 |
| 外观 + 适配器 | 外观内部用适配器对接多个子系统 |

### 装饰器 vs 代理 vs 策略 vs 适配器

这四个最容易混淆，因为都涉及"包装一个对象"：

| 模式 | 目的 | 被包装对象由谁创建 | 接口关系 |
| --- | --- | --- | --- |
| 装饰器 | 加功能 | 调用方传入 | 同接口 |
| 代理 | 控制访问 | 代理自己管理 | 同接口 |
| 策略 | 替换算法 | 调用方传入 | 策略接口 |
| 适配器 | 接口转换 | 适配器持有 | 不同接口转目标接口 |

一句话区分：**装饰器是"加料"，代理是"控制"，策略是"换芯"，适配器是"转接头"**。

## 大厂面试实战

### 面试题1：设计一个支付系统，支持多渠道、可扩展

```text
考点：策略 + 工厂 + 模板方法 + 观察者
```

```java
// 1. 策略接口 + 模板方法基类
public abstract class AbstractPayStrategy implements PaymentStrategy {

    @Override
    public final PayResult pay(PayRequest req) {
        validate(req);           // 模板：校验
        PrePayResult pre = prePay(req);  // 模板：预下单（子类实现）
        PayResult result = doPay(pre);   // 模板：支付（子类实现）
        postPay(result);         // 模板：后置处理
        return result;
    }

    protected void validate(PayRequest req) { /* 公共校验 */ }
    protected abstract PrePayResult prePay(PayRequest req);
    protected abstract PayResult doPay(PrePayResult pre);
    protected void postPay(PayResult result) { /* 公共后置 */ }
}

// 2. 具体策略
@Component("alipay")
public class AlipayStrategy extends AbstractPayStrategy { /* ... */ }

@Component("wechat")
public class WechatStrategy extends AbstractPayStrategy { /* ... */ }

// 3. 路由（工厂角色由 Spring Map 注入替代）
@Service
public class PayRouter {
    private final Map<String, PaymentStrategy> strategyMap;
    public PayRouter(Map<String, PaymentStrategy> strategyMap) { this.strategyMap = strategyMap; }
    public PayResult pay(String channel, PayRequest req) {
        return strategyMap.getOrDefault(channel, throwNotSupported(channel)).pay(req);
    }
}

// 4. 支付完成后通知（观察者）
@Component
public class PayEventListener {
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    @Async("eventExecutor")
    public void onPaySuccess(PaySuccessEvent event) {
        mqProducer.send("pay.exchange", event.getOrderId());
    }
}
```

### 面试题2：Spring AOP 用了什么设计模式？原理是什么？

```text
答：动态代理（JDK / CGLIB）
```

- Spring AOP 底层是动态代理：有接口用 JDK Proxy，没接口用 CGLIB。Spring Boot 2.x 后默认 CGLIB。
- 代理对象在 BeanPostProcessor（`AbstractAutoProxyCreator`）阶段创建，替换原始对象放进容器。
- `@Transactional`、`@Async`、`@Cacheable` 都基于 AOP。
- 自调用 `this.method()` 不走代理，因为 `this` 是原始对象。
- `final` 和 `private` 方法不被代理，因为 CGLIB 无法覆盖。

### 面试题3：`Integer.valueOf(127) == Integer.valueOf(127)` 为什么是 `true`？

```text
答：享元模式
```

`Integer` 内部有 `IntegerCache`，缓存了 `-128 ~ 127` 的 Integer 实例。`valueOf` 在这个范围内直接返回缓存对象，不 `new`。超出范围才 `new` 新对象。`Long`、`Short`、`Byte`、`Character` 也有类似的缓存。

### 面试题4：JdbcTemplate 用了什么设计模式？

```text
答：模板方法
```

`JdbcTemplate.execute()` 定义了流程骨架：获取连接 → 执行 → 关闭连接 → 异常翻译。可变部分通过回调接口（`StatementCallback`、`RowMapper`）传入，调用方只关心 SQL 和结果映射，不用管资源管理。

### 面试题5：Servlet Filter 是什么设计模式？

```text
答：责任链
```

`FilterChain` 持有 `Filter` 列表，请求依次经过每个 Filter，每个 Filter 调 `chain.doFilter()` 传给下一个。像洋葱模型——进去正序、出来逆序。Spring Interceptor、Spring Cloud Gateway Filter、Sentinel SlotChain 都是同样的模式。

## 什么时候不要用模式

- **只有一个实现且不会变**：不需要策略，直接写。
- **逻辑简单**：一个 `if-else` 两行搞定，不需要状态机。
- **团队不熟悉**：引入模式但团队看不懂，反而增加维护成本。
- **过度设计**：为了"将来可能扩展"提前抽象，但那个将来可能永远不会来。

判断标准：**当前已经有 2 个以上的变化点，且第 3 个即将到来时，再引入模式**。不要为想象中的需求做设计。

## 去空话检查

- [ ] 能说清 SOLID 五大原则 + 迪米特法则。
- [ ] 能用策略模式消除 `if-else`，并知道 Spring `Map` 注入的标准用法。
- [ ] 能区分简单工厂、工厂方法、抽象工厂的区别和适用场景。
- [ ] 能写出一个装饰器，并解释为什么能层层套娃（同接口）。
- [ ] 能区分装饰器、代理、策略、适配器：加功能 / 控制访问 / 换芯 / 转接头。
- [ ] 知道 Spring AOP 底层是动态代理，能解释 JDK Proxy vs CGLIB 的区别。
- [ ] 能说出代理失效的 5 个场景（自调用、private、final、构造器、new）。
- [ ] 能用观察者模式实现事件通知，知道 `@EventListener` vs `@TransactionalEventListener`。
- [ ] 能写出线程安全的单例（静态内部类、枚举），知道 `volatile` 在双重检查锁中的作用。
- [ ] 能解释枚举单例为什么防反射、防序列化。
- [ ] 能用模板方法模式写一个流程骨架，知道 `JdbcTemplate` 为什么是模板方法。
- [ ] 能用责任链模式写一个请求处理链，知道 Servlet Filter 的洋葱模型。
- [ ] 能用状态机模式管理订单状态流转，消除状态判断的 `if-else`。
- [ ] 知道享元模式，能解释 `Integer.valueOf(127)` 的面试题。
- [ ] 能用建造者模式解决构造器参数爆炸问题。
- [ ] 能用适配器模式让不兼容接口协作，知道 Spring `HandlerAdapter`。
- [ ] 能用组合模式统一处理树形结构，知道 MyBatis `SqlNode`。
- [ ] 知道策略 + 工厂、观察者 + 状态机、责任链 + 命令的组合用法。
- [ ] 知道什么时候不该用模式——不过度设计。

## 参考

- [GoF Design Patterns](https://en.wikipedia.org/wiki/Design_Patterns)
- [Refactoring Guru - Design Patterns](https://refactoring.guru/design-patterns)
- [Spring Framework AOP](https://docs.spring.io/spring-framework/reference/core/aop.html)
- [Spring Framework Events](https://docs.spring.io/spring-framework/reference/core/beans/context-introduction.html#context-functionality-events)
- [Effective Java - Enum Singleton](https://www.oreilly.com/library/view/effective-java/9780134686097/)
- [Spring Statemachine](https://docs.spring.io/spring-statemachine/docs/current/reference/)
- [COLA Statemachine](https://github.com/alibaba/COLA/tree/master/cola-components/cola-component-statemachine)
