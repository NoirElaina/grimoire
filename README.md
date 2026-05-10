# Grimoire

`Grimoire` 是一个基于 VitePress 搭建的程序员笔记站，用来持续整理代码笔记、计算机知识和可复用模板。

当前内容主体先围绕两条主线展开：

- `Agents`：多 Agent 设计、System Prompt、工具调用、上下文编排
- `Java 后端`：Spring Boot、接口设计、服务实现、问题排查

## 技术栈

- VitePress
- Vue 3
- pnpm

## 本地启动

```bash
pnpm install
pnpm run docs:dev
```

## 常用命令

```bash
pnpm run docs:dev
pnpm run docs:build
pnpm run docs:preview
```

## 项目结构

```text
grimoire/
├─ docs/
│  ├─ .vitepress/
│  ├─ notes/
│  │  ├─ agents/
│  │  └─ java-backend/
│  ├─ about.md
│  ├─ api-examples.md
│  ├─ index.md
│  └─ markdown-examples.md
├─ package.json
└─ pnpm-lock.yaml
```

## 当前内容入口

- `docs/notes/agents/`
  Agent 设计模板、System Prompt 模板、工具调用模板
- `docs/notes/java-backend/`
  Spring Boot 项目模板、接口设计模板、问题排查模板

## 维护方式

- 首页只保留一个简单入口
- 主要知识内容沉淀在 `docs/notes/`
- 通用写作规范和发布说明放在文档页中持续维护

## 说明

项目使用 `pnpm` 作为包管理器，`npm` 不适合直接用于这个仓库。
