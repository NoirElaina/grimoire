---
title: Spring Boot Flyway 数据库迁移
sidebarTitle: Flyway 数据库迁移
---

# Spring Boot Flyway 数据库迁移

> Flyway 的核心作用是：把数据库结构变更也纳入版本控制，让建表、加字段、建索引、初始化基础数据这些动作按固定顺序自动执行。

## 先说结论

如果项目里数据库表结构是手动改的，很容易出现这些问题：

```text
本地有字段，测试库没有。
测试库有索引，生产库没有。
A 同学执行了 SQL，B 同学不知道。
上线时忘了执行某个 ALTER TABLE。
旧脚本被人改了，历史数据库和新数据库对不上。
```

Flyway 要解决的就是：

```text
数据库结构变更也像代码一样有版本、有顺序、有记录。
```

Spring Boot 集成 Flyway 后，应用启动时会自动检查数据库当前迁移版本，然后执行还没执行过的迁移脚本。

默认脚本目录：

```text
src/main/resources/db/migration
```

典型脚本：

```text
V1__init_schema.sql
V2__add_user_table.sql
V3__add_order_pay_expire_time.sql
```

启动后，Flyway 会在数据库里维护一张历史表：

```text
flyway_schema_history
```

这张表记录：

- 哪个版本执行过。
- 执行时间。
- 脚本名称。
- checksum。
- 是否成功。

## Flyway 解决什么问题

### 不靠人肉执行 SQL

没有 Flyway 时，常见流程是：

```text
开发写一个 sql 文件。
发给测试同学。
测试库手动执行。
上线时 DBA 或后端手动执行。
```

问题是：

```text
人会忘。
顺序会错。
环境会漏。
脚本会被改。
```

Flyway 把它变成：

```text
SQL 脚本提交到 Git。
应用启动时自动按版本执行。
执行过的版本写入 flyway_schema_history。
```

### 让数据库结构和代码版本绑定

比如代码里新增字段：

```java
private LocalDateTime payExpireTime;
```

如果数据库没有：

```sql
pay_expire_time
```

应用可能启动失败，或者接口运行时报错。

Flyway 的做法是：

```text
代码改动和数据库迁移脚本一起提交。
部署应用时，数据库先迁移到代码需要的结构。
```

### 让新环境一键初始化

新同事拉项目后，不需要问：

```text
我应该先执行哪个 SQL？
这个库现在到哪个版本？
测试数据怎么插？
```

只要：

```text
建一个空库。
启动应用。
Flyway 自动执行 V1、V2、V3...
```

## 和 `ddl-auto` 的区别

Spring JPA / Hibernate 有：

```yaml
spring:
  jpa:
    hibernate:
      ddl-auto: update
```

它可以根据实体类自动改表。

但工程项目里不建议依赖它管理生产数据库结构。

原因：

| 对比 | `ddl-auto=update` | Flyway |
| --- | --- | --- |
| 变更来源 | Java 实体推导 | 明确 SQL 脚本 |
| 变更顺序 | 不够清晰 | 按版本执行 |
| 审核 | 不方便 review | SQL 可以 code review |
| 历史记录 | 弱 | `flyway_schema_history` |
| 生产可控性 | 差 | 强 |
| 回滚设计 | 不清晰 | 需要显式设计 |

开发阶段可以短暂用 `ddl-auto` 探索模型。

但正式工程更推荐：

```yaml
spring:
  jpa:
    hibernate:
      ddl-auto: validate
```

或者不用 JPA 自动建表，让 Flyway 负责表结构。

## 依赖配置

### Spring Boot 3 常见写法

Maven：

```xml
<dependency>
    <groupId>org.flywaydb</groupId>
    <artifactId>flyway-core</artifactId>
</dependency>

<dependency>
    <groupId>org.flywaydb</groupId>
    <artifactId>flyway-mysql</artifactId>
</dependency>
```

MySQL、PostgreSQL 等数据库在新版本 Flyway 里可能需要对应数据库模块。

比如 MySQL 用：

```text
flyway-mysql
```

PostgreSQL 用：

```text
flyway-database-postgresql
```

具体要看当前 Spring Boot 和 Flyway 版本。

### Spring Boot 4 写法

当前 Spring Boot 文档已经出现：

```text
spring-boot-starter-flyway
```

如果项目使用 Spring Boot 4，可以按官方 starter 方式接入。

但很多 Spring Boot 3 项目仍然是：

```text
flyway-core + 对应数据库模块
```

所以写依赖时不要死背，要看项目版本。

## 基础配置

`application.yml`：

```yaml
spring:
  flyway:
    enabled: true
    locations: classpath:db/migration
    baseline-on-migrate: false
    validate-on-migrate: true
```

常用配置解释：

| 配置 | 作用 |
| --- | --- |
| `enabled` | 是否启用 Flyway |
| `locations` | 迁移脚本位置 |
| `baseline-on-migrate` | 旧库接入时是否自动生成基线 |
| `validate-on-migrate` | 迁移前是否校验历史脚本 checksum |

默认情况下，Spring Boot 会在启动时调用 Flyway 执行迁移。

也就是说：

```text
应用启动
  -> 创建 DataSource
  -> Flyway 检查 flyway_schema_history
  -> 执行未执行过的 migration
  -> 后续 Bean 继续初始化
```

如果迁移失败，应用通常会启动失败。

这是好事。

因为：

```text
数据库结构不对，应用不应该假装正常启动。
```

## 脚本目录结构

推荐：

```text
src/main/resources/db/migration
  V1__init_schema.sql
  V2__insert_basic_data.sql
  V3__add_order_payment_deadlines.sql
  V4__create_payment_order.sql
```

测试专用脚本可以放：

```text
src/test/resources/db/migration
```

生产脚本和测试脚本不要混。

否则可能出现：

```text
测试数据被带到生产。
```

## 脚本命名规则

### Versioned Migration

最常见：

```text
V版本号__描述.sql
```

注意中间是两个下划线：

```text
__
```

示例：

```text
V1__init_schema.sql
V2__add_user_avatar.sql
V3__create_order_tables.sql
V4_1__add_order_index.sql
```

含义：

```text
V:
    versioned migration。

1 / 2 / 3:
    版本号。

__:
    固定分隔符。

init_schema:
    描述。
```

### Repeatable Migration

命名：

```text
R__refresh_view.sql
R__rebuild_report_function.sql
```

Repeatable migration 没有版本号。

当脚本内容变化，checksum 变化时，Flyway 会重新执行。

适合：

- 视图。
- 存储过程。
- 函数。
- 某些可重复生成的对象。

不适合：

- 普通建表。
- 普通加字段。
- 普通业务数据变更。

### Undo Migration

Flyway 有 undo migration 概念，但通常属于付费能力或特定版本能力。

工程里不要默认依赖它。

更实际的做法是：

```text
上线前认真 review migration。
生产变更尽量向前兼容。
出问题时写新的修复 migration。
```

## `flyway_schema_history`

Flyway 第一次运行时会创建：

```text
flyway_schema_history
```

这张表大概记录：

| 字段 | 含义 |
| --- | --- |
| `installed_rank` | 安装顺序 |
| `version` | 版本号 |
| `description` | 描述 |
| `type` | SQL、JDBC 等类型 |
| `script` | 脚本文件名 |
| `checksum` | 脚本内容校验 |
| `installed_by` | 执行用户 |
| `installed_on` | 执行时间 |
| `execution_time` | 耗时 |
| `success` | 是否成功 |

它的作用是：

```text
告诉 Flyway 哪些脚本已经执行过。
```

不要手动乱改这张表。

除非你非常清楚自己在做什么，比如修复本地开发库。

生产库更不能随便改。

## checksum 是什么

Flyway 会对 migration 脚本计算 checksum。

如果一个脚本已经执行过，比如：

```text
V3__add_order_payment_deadlines.sql
```

后来你又修改了这个文件内容。

下一次启动时，Flyway 会发现：

```text
数据库记录的 checksum 和当前文件 checksum 不一致。
```

然后报错。

这是 Flyway 最重要的保护机制之一。

它在提醒你：

```text
已经执行过的历史脚本不能随便改。
```

## 历史脚本能不能改

原则：

```text
已经提交并在任何共享环境执行过的 V 脚本，不要改。
```

比如：

```text
V1__init_schema.sql
V2__add_user_table.sql
V3__add_order_field.sql
```

如果 `V3` 已经在测试库或生产库执行过，后来发现字段类型写错了，不要直接改 `V3`。

应该新增：

```text
V4__fix_order_field_type.sql
```

原因：

```text
别人数据库里的 V3 已经执行完了。
你改 V3 只会造成 checksum 不一致。
```

只有一种情况可以改历史脚本：

```text
这个脚本还没进入共享环境，只在你本地执行过。
```

这时可以清理本地库或 repair 后重来。

但一旦进入团队共享环境，就不要改。

## 第一个脚本怎么写

`V1__init_schema.sql`：

```sql
create table users (
    id bigint primary key auto_increment,
    username varchar(64) not null,
    password varchar(128) not null,
    create_time datetime not null,
    update_time datetime not null,
    unique key uk_users_username (username)
);

create table orders (
    id bigint primary key auto_increment,
    order_no varchar(64) not null,
    user_id bigint not null,
    status varchar(32) not null,
    pay_expire_time datetime not null,
    close_deadline_time datetime not null,
    create_time datetime not null,
    update_time datetime not null,
    unique key uk_orders_order_no (order_no),
    key idx_orders_user_id (user_id),
    key idx_orders_status_close_deadline (status, close_deadline_time)
);
```

建表脚本要注意：

- 主键。
- 唯一约束。
- 必要索引。
- 字段是否允许 null。
- 时间字段。
- 状态字段长度。
- 金额字段精度。

## 后续加字段怎么写

比如订单新增支付截止时间。

不要直接改 `V1__init_schema.sql`，而是新增：

```text
V3__add_order_payment_deadlines.sql
```

内容：

```sql
alter table orders
    add column pay_expire_time datetime null after status,
    add column close_deadline_time datetime null after pay_expire_time;

update orders
set pay_expire_time = date_add(create_time, interval 15 minute),
    close_deadline_time = date_add(create_time, interval 16 minute)
where pay_expire_time is null
   or close_deadline_time is null;

alter table orders
    modify column pay_expire_time datetime not null,
    modify column close_deadline_time datetime not null;

create index idx_orders_status_close_deadline
    on orders (status, close_deadline_time);
```

为什么不一上来就：

```sql
add column pay_expire_time datetime not null
```

因为旧表里可能已经有数据。

如果直接加 `not null`，数据库可能不知道旧数据该填什么。

更稳的顺序是：

```text
先加 nullable 字段。
回填旧数据。
再改 not null。
最后加索引。
```

这就是生产迁移思维。

## 初始化数据怎么写

初始化基础数据可以写在 migration 里：

```text
V2__insert_basic_data.sql
```

示例：

```sql
insert into roles (id, role_code, role_name, create_time, update_time)
values
    (1, 'ADMIN', '管理员', now(), now()),
    (2, 'USER', '普通用户', now(), now());
```

但要注意：

```text
业务测试数据不要放到生产 migration。
```

比如：

- demo 用户。
- demo 商品。
- 测试订单。

这些更适合：

- 本地 profile。
- 测试环境专用脚本。
- `src/test/resources/db/migration`。
- 单独 demo data 初始化命令。

## 多环境配置

开发环境可以：

```yaml
spring:
  flyway:
    enabled: true
    locations: classpath:db/migration
```

测试环境：

```yaml
spring:
  flyway:
    enabled: true
    locations: classpath:db/migration
```

生产环境：

```yaml
spring:
  flyway:
    enabled: true
    locations: classpath:db/migration
    validate-on-migrate: true
```

有些团队生产不允许应用自动迁移，而是由发布流水线执行 Flyway。

这也可以。

关键是：

```text
不能完全靠人手动复制 SQL。
```

生产迁移应该有：

- 审核。
- 执行记录。
- 失败告警。
- 回滚或修复预案。

## 旧项目怎么接入 Flyway

旧项目已经有表了，不能直接从 `V1__init_schema.sql` 开始跑。

因为数据库里已经有对象。

常见做法：

```yaml
spring:
  flyway:
    baseline-on-migrate: true
    baseline-version: 1
```

意思是：

```text
把当前已有数据库状态视为基线版本。
后续从更高版本开始迁移。
```

比如：

```text
当前旧库已有所有基础表。
把它标记为 version 1。
后续新增脚本从 V2 开始。
```

注意：

```text
baseline-on-migrate 不要长期无脑开。
```

它适合旧库首次接入 Flyway。

新项目空库不需要开。

## 常用命令

如果使用 Flyway CLI，常见命令：

```bash
flyway info
flyway validate
flyway migrate
flyway repair
flyway clean
```

含义：

| 命令 | 作用 |
| --- | --- |
| `info` | 查看迁移状态 |
| `validate` | 校验脚本和历史记录 |
| `migrate` | 执行迁移 |
| `repair` | 修复历史表里的 checksum 等元数据 |
| `clean` | 清空数据库对象 |

`clean` 非常危险。

生产环境通常要禁用：

```yaml
spring:
  flyway:
    clean-disabled: true
```

不要在生产库执行：

```bash
flyway clean
```

它可能删除整个 schema。

## 常见报错

### 找不到迁移脚本

现象：

```text
No migrations found
```

检查：

- 文件是否在 `src/main/resources/db/migration`。
- `locations` 是否写错。
- 文件是否被打进 jar。
- 文件名是否符合 `V1__xxx.sql`。

### 文件名格式错误

错误示例：

```text
V1_init.sql
V1_init_schema.sql
V1--init.sql
```

正确：

```text
V1__init_schema.sql
```

重点：

```text
版本号和描述中间是两个下划线。
```

### checksum 不一致

现象：

```text
Validate failed: Migration checksum mismatch
```

原因：

```text
已经执行过的脚本被修改了。
```

处理：

```text
如果是本地开发库：
    可以清库重跑，或者确认后 repair。

如果是测试或生产：
    不要直接改历史脚本。
    新增一个修复版本。
```

### 版本号重复

比如同时有：

```text
V3__add_order.sql
V3__add_user.sql
```

Flyway 不知道哪个才是 V3。

处理：

```text
改成不同版本号。
```

比如：

```text
V3__add_order.sql
V4__add_user.sql
```

团队协作时很容易多人都写 `V10`。

合并前要检查 migration 版本。

### 脚本执行失败

常见原因：

- SQL 语法错。
- 表已存在。
- 字段已存在。
- 索引名重复。
- 旧数据不满足新约束。
- 外键约束失败。
- 默认值不合法。

处理：

```text
本地：
    可以修脚本后清库重跑。

共享环境：
    看 flyway_schema_history。
    按失败状态修复。
    不要随便改已成功脚本。
```

## 团队协作规则

### 每个数据库结构变更都写 migration

比如：

- 建表。
- 加字段。
- 改字段类型。
- 加索引。
- 加唯一约束。
- 初始化基础字典。

都应该有对应 Flyway 脚本。

### 已执行脚本不要改

共享环境执行过的脚本不要改。

修复用新版本。

### 版本号要排队

多人协作时，合并前检查：

```bash
ls src/main/resources/db/migration
```

或者在 IDE 里看是否有重复版本。

如果两个分支都新增了：

```text
V8__xxx.sql
```

合并时必须改一个。

### 大变更拆小

不要把一堆不相关改动塞进一个 migration。

错误：

```text
V10__big_update.sql
```

里面同时：

- 建订单表。
- 改用户表。
- 插权限数据。
- 加支付索引。

更好：

```text
V10__create_order_tables.sql
V11__add_user_avatar.sql
V12__insert_permission_data.sql
V13__add_payment_indexes.sql
```

这样失败时更好定位。

## 生产迁移规则

生产数据库迁移要保守。

### 向前兼容

上线经常不是瞬间完成，可能出现：

```text
老版本应用和新版本应用短时间同时存在。
```

所以 migration 要尽量向前兼容。

比如：

```text
第一版：先加 nullable 字段。
第二版：代码开始写新字段。
第三版：确认数据完整后再加 not null。
```

不要一上来删除旧字段。

### 大表加索引要谨慎

大表：

```sql
create index idx_xxx on big_table(column);
```

可能锁表或拖慢数据库。

生产要评估：

- 表大小。
- 数据库版本。
- 是否支持在线 DDL。
- 是否低峰执行。
- 是否需要分批。

### 不要在 migration 里做大量业务计算

比如：

```sql
update huge_table set ...;
```

如果数据很多，可能执行很久。

更稳做法：

- migration 只加字段。
- 后台任务分批回填。
- 回填完成后再加约束。

## 和 Spring Boot 启动顺序

Spring Boot 集成 Flyway 后，一般会在应用启动早期执行迁移。

常见顺序可以理解为：

```text
创建数据源
  -> Flyway 迁移
  -> 初始化 JPA / MyBatis 等组件
  -> 启动 Web 服务
```

这意味着：

```text
如果 migration 失败，应用启动失败。
```

这比运行一半才发现表结构不对更安全。

如果同时使用 JPA，建议：

```yaml
spring:
  jpa:
    hibernate:
      ddl-auto: validate
```

让 JPA 只校验实体和表结构是否匹配，不自动修改表。

## 和 MyBatis 的关系

MyBatis 只负责执行 SQL 映射。

比如：

```xml
<select id="selectOrderDetail">
    select id, order_no, pay_expire_time
    from orders
    where id = #{orderId}
</select>
```

如果数据库没有 `pay_expire_time` 字段，MyBatis 不会帮你创建。

Flyway 负责：

```text
在应用启动前把 orders 表迁移到包含 pay_expire_time 的结构。
```

所以 MyBatis 项目尤其适合 Flyway。

## 最小落地模板

### 1. 加依赖

Spring Boot 3 + MySQL 常见：

```xml
<dependency>
    <groupId>org.flywaydb</groupId>
    <artifactId>flyway-core</artifactId>
</dependency>
<dependency>
    <groupId>org.flywaydb</groupId>
    <artifactId>flyway-mysql</artifactId>
</dependency>
```

### 2. 建目录

```text
src/main/resources/db/migration
```

### 3. 写第一个脚本

```text
V1__init_schema.sql
```

### 4. 配置 Flyway

```yaml
spring:
  flyway:
    enabled: true
    locations: classpath:db/migration
    validate-on-migrate: true
    clean-disabled: true
```

### 5. 启动应用

观察日志里是否有：

```text
Migrating schema ...
Successfully applied ...
```

### 6. 检查历史表

```sql
select *
from flyway_schema_history
order by installed_rank;
```

确认版本执行成功。

## 常见面试讲法

可以这样讲：

```text
Flyway 是数据库迁移工具，用来把数据库结构变更纳入版本控制。

在 Spring Boot 中，只要引入 Flyway 依赖并把脚本放到 db/migration 目录，应用启动时就会自动执行未执行过的 migration。

每个 migration 文件按 V版本号__描述.sql 命名，Flyway 会用 flyway_schema_history 记录执行历史和 checksum。

工程里最重要的规则是：已经在共享环境执行过的历史脚本不要改。如果发现问题，要新增下一个版本脚本修复，而不是回头改旧脚本。

相比 ddl-auto=update，Flyway 的 SQL 是明确的、可 review 的、顺序可控的，更适合测试和生产环境。
```

## 关联笔记

- [MyBatis-Plus 使用笔记](/notes/java-backend/mybatis-plus)
- [MySQL 工程实践](/notes/mysql/mysql-engineering)
- [订单支付超时关闭](/notes/java-backend/order-timeout-close)

## 参考

- [Spring Boot Database Initialization](https://docs.spring.io/spring-boot/how-to/data-initialization.html)
- [Flyway Migrations](https://documentation.red-gate.com/fd/migrations-184127470.html)
