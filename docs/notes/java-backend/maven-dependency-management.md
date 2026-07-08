---
title: Maven 依赖管理
sidebarTitle: Maven 依赖管理
---

# Maven 依赖管理

> Maven 不只是“下载 jar 包”。后端项目依赖冲突、版本不一致、构建失败、线上类找不到，很多都是 Maven 地基没打好。

## 最小 POM

常见 Spring Boot 项目：

```xml
<parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.5.0</version>
    <relativePath/>
</parent>

<dependencies>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-web</artifactId>
    </dependency>

    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-validation</artifactId>
    </dependency>
</dependencies>
```

这里 starter 不写版本，因为 Spring Boot parent 已经管理。

不要这样：

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
    <version>3.4.1</version>
</dependency>
```

除非你非常明确要覆盖版本，否则容易和 Boot 管理的版本矩阵冲突。

## dependencyManagement

`dependencyManagement` 只管版本，不会自动引入依赖。

```xml
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>com.baomidou</groupId>
            <artifactId>mybatis-plus-bom</artifactId>
            <version>3.5.14</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>
```

真正引入：

```xml
<dependencies>
    <dependency>
        <groupId>com.baomidou</groupId>
        <artifactId>mybatis-plus-spring-boot3-starter</artifactId>
    </dependency>
</dependencies>
```

理解：

```text
dependencyManagement：版本表
dependencies：实际依赖
```

## BOM 是什么

BOM 是一张版本清单。

Spring Boot BOM 会帮你统一：

- Spring Framework
- Jackson
- Tomcat
- Hibernate Validator
- Micrometer
- Logback
- 常见第三方依赖

好处：

- 少写版本。
- 降低冲突。
- Spring Boot 升级时一起升级兼容版本。

不要同时混用多个互相冲突的 BOM。

## scope

| scope | 含义 | 例子 |
| --- | --- | --- |
| `compile` | 编译、运行都需要，默认 | 业务依赖 |
| `runtime` | 编译不需要，运行需要 | MySQL 驱动 |
| `test` | 只测试需要 | JUnit |
| `provided` | 编译需要，运行环境提供 | Servlet API |
| `import` | 导入 BOM | Spring Cloud BOM |

MySQL 驱动：

```xml
<dependency>
    <groupId>com.mysql</groupId>
    <artifactId>mysql-connector-j</artifactId>
    <scope>runtime</scope>
</dependency>
```

测试依赖：

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-test</artifactId>
    <scope>test</scope>
</dependency>
```

## 传递依赖

引入 A，A 又依赖 B，B 就是传递依赖。

查看依赖树：

```bash
mvn dependency:tree
```

只看某个依赖：

```bash
mvn dependency:tree -Dincludes=com.fasterxml.jackson.core
```

常见问题：

```text
项目引入了两个不同版本的 jackson-databind
编译能过，运行时报 NoSuchMethodError
```

排查：

```bash
mvn dependency:tree -Dverbose
```

## exclusions

排除传递依赖：

```xml
<dependency>
    <groupId>some.group</groupId>
    <artifactId>some-client</artifactId>
    <exclusions>
        <exclusion>
            <groupId>commons-logging</groupId>
            <artifactId>commons-logging</artifactId>
        </exclusion>
    </exclusions>
</dependency>
```

不要为了“看起来干净”随手排除。

排除前先确认：

- 谁引入了它。
- 它是否运行时需要。
- 是否有替代实现。
- 排除后测试和启动是否正常。

## 多模块项目

父 POM：

```xml
<packaging>pom</packaging>

<modules>
    <module>flashmart-common</module>
    <module>flashmart-api</module>
    <module>flashmart-order</module>
</modules>

<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-dependencies</artifactId>
            <version>${spring-boot.version}</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>
```

子模块：

```xml
<parent>
    <groupId>org.example</groupId>
    <artifactId>flashmart</artifactId>
    <version>1.0.0</version>
</parent>
```

规则：

- 版本统一放父 POM。
- 子模块只声明自己需要的依赖。
- common 不要反向依赖业务模块。
- api 模块不要依赖所有实现细节。

## 插件管理

插件也要管版本。

```xml
<build>
    <pluginManagement>
        <plugins>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-compiler-plugin</artifactId>
                <version>3.13.0</version>
                <configuration>
                    <release>21</release>
                </configuration>
            </plugin>
        </plugins>
    </pluginManagement>
</build>
```

常见插件：

- `maven-compiler-plugin`
- `maven-surefire-plugin`
- `spring-boot-maven-plugin`
- `flyway-maven-plugin`

构建问题不要只看依赖，也要看插件版本。

## 常见报错

| 报错 | 常见原因 |
| --- | --- |
| `ClassNotFoundException` | 运行时依赖没进包，scope 错了 |
| `NoSuchMethodError` | 版本冲突，编译和运行不是同一个版本 |
| `NoClassDefFoundError` | 编译有，运行缺 |
| `Dependency convergence error` | 多版本依赖冲突 |
| `UnsupportedClassVersionError` | JDK 编译版本和运行版本不一致 |

排查顺序：

```text
1. 看报错类属于哪个 jar
2. mvn dependency:tree 查版本
3. 看是否被 exclusions 排掉
4. 看 scope 是否正确
5. 看 Spring Boot / Spring Cloud 版本矩阵
6. clean 后重新构建
```

## 去空话检查

- [ ] Spring Boot starter 不乱写版本。
- [ ] 第三方版本集中在 `dependencyManagement`。
- [ ] 知道 `dependencyManagement` 不等于实际引入。
- [ ] 会用 `mvn dependency:tree` 查冲突。
- [ ] 不随手 exclusions。
- [ ] 多模块版本由父 POM 管。
- [ ] JDK 编译版本和运行版本一致。

## 参考

- [Maven Dependency Mechanism](https://maven.apache.org/guides/introduction/introduction-to-dependency-mechanism.html)
