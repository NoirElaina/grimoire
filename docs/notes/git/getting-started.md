---
title: Git 入门
sidebarTitle: Git 入门
---

# Git 入门

> Git 的核心不是背命令，而是理解三个东西：文件现在在哪里、改动有没有暂存、提交历史有没有移动。

## Git 是什么

Git 是一个版本控制工具。

它解决的问题是：

```text
我改了什么？
什么时候改的？
谁改的？
能不能回到之前？
能不能和别人一起改？
能不能把一个功能单独放在分支里？
```

如果没有 Git，项目很容易变成：

```text
项目-final
项目-final-改
项目-final-真的最终版
项目-final-别删这个
```

Git 把这些“版本”变成一条可以追踪、可以回退、可以合并的提交历史。

## Git 管什么

Git 管的是仓库里的文件变化。

它关心：

- 新增了什么文件。
- 删除了什么文件。
- 哪些文件内容变了。
- 哪些改动被提交了。
- 当前分支指向哪个提交。
- 本地分支和远端分支有什么差异。

它不关心：

- 你的代码能不能跑。
- 你的需求对不对。
- 你的依赖是否安装。
- 你的数据库是否正确。

所以：

```text
Git 提交成功 ≠ 项目验证通过。
```

合并和提交前仍然要跑构建、测试、lint。

## Git 的三个区域

先记住 Git 最重要的模型：

```text
工作区
  -> 暂存区
  -> 本地仓库
```

### 工作区

工作区就是你当前编辑器里看到的项目文件。

比如你改了：

```text
src/main.js
README.md
```

这些文件的变化一开始都在工作区。

查看工作区状态：

```bash
git status
git status --short
```

### 暂存区

暂存区是下一次 commit 的候选清单。

你用：

```bash
git add README.md
```

表示：

```text
把 README.md 当前这份改动放进暂存区。
下一次 commit 会包含它。
```

注意：

```text
git add 不是提交。
git add 只是把改动放到暂存区。
```

### 本地仓库

本地仓库保存已经提交的历史。

你用：

```bash
git commit -m "更新 README"
```

表示：

```text
把暂存区里的改动保存成一个新的提交。
```

提交之后，这次改动就进入本地仓库历史。

## 一次提交怎么形成

完整流程：

```text
编辑文件
  -> git status 查看改动
  -> git diff 查看具体差异
  -> git add 放入暂存区
  -> git diff --cached 查看将要提交的内容
  -> git commit 生成提交
```

命令：

```bash
git status --short
git diff
git add src/main.js
git diff --cached
git commit -m "实现首页数据加载"
```

这就是 Git 最基本的日常循环。

## 提交是什么

一次 commit 可以理解成：

```text
项目在某个时间点的一张快照。
```

每个提交都有：

- 提交 ID。
- 作者。
- 时间。
- 提交说明。
- 父提交。
- 文件变化。

查看历史：

```bash
git log --oneline --decorate -n 8
```

更直观看分支图：

```bash
git log --oneline --decorate --graph --all -n 30
```

## 分支是什么

分支本质上是一个指针。

比如：

```text
main -> abc123
```

表示：

```text
main 分支当前指向 abc123 这个提交。
```

创建功能分支：

```bash
git switch -c feat/login
```

或者旧命令：

```bash
git checkout -b feat/login
```

意思是：

```text
从当前提交创建一个新分支，并切过去。
```

查看当前分支：

```bash
git branch --show-current
```

查看所有本地分支：

```bash
git branch
```

## 为什么要用分支

分支让你把不同工作隔离开。

比如：

```text
main:
    稳定主线。

feat/login:
    登录功能开发。

feat/order:
    订单功能开发。

fix/navbar:
    修复导航栏问题。
```

好处：

- 不同功能不会互相污染。
- 功能没完成也不影响 main。
- 可以单独合并某个功能。
- 出问题时更容易回滚。

## HEAD 是什么

`HEAD` 表示你当前所在的位置。

通常它指向当前分支：

```text
HEAD -> main -> abc123
```

意思是：

```text
你当前在 main 分支。
main 指向 abc123。
```

当你切换分支时，`HEAD` 会移动到另一个分支。

查看：

```bash
git log --oneline --decorate -n 3
```

你会看到类似：

```text
abc123 (HEAD -> main, origin/main) 更新 Git 笔记
```

## 远端是什么

本地仓库只在你电脑上。

远端仓库通常是 GitHub、GitLab、Gitee 上的仓库。

默认远端名常叫：

```text
origin
```

查看远端：

```bash
git remote -v
```

常见结果：

```text
origin  https://github.com/user/project.git (fetch)
origin  https://github.com/user/project.git (push)
```

## 本地和远端的关系

常见分支：

```text
main
origin/main
```

区别：

| 名称 | 含义 |
| --- | --- |
| `main` | 本地 main 分支 |
| `origin/main` | 你上次 fetch 后看到的远端 main 状态 |

`origin/main` 不是实时自动更新的。

你需要：

```bash
git fetch origin
```

它才会更新。

## fetch、pull、push

### fetch

```bash
git fetch origin
```

作用：

```text
更新远端引用。
不改当前工作区。
不自动合并。
```

适合合并前先看远端变化。

### pull

```bash
git pull --ff-only origin main
```

作用：

```text
从远端拉取 main，并尝试更新本地 main。
```

推荐加 `--ff-only`。

这样只有可以快进时才更新，避免意外生成 merge commit。

### push

```bash
git push origin main
```

作用：

```text
把本地 main 的提交推到远端 main。
```

推送前要确认：

```bash
git status --short --branch
git branch --show-current
```

不要在错误分支上推送。

## `.gitignore` 是什么

`.gitignore` 用来告诉 Git：

```text
这些文件不要纳入版本控制。
```

常见内容：

```text
node_modules/
dist/
.env
*.log
__pycache__/
.venv/
```

注意：

```text
.gitignore 只对还没被 Git 跟踪的文件生效。
```

如果文件已经被提交过，再写进 `.gitignore`，Git 仍然会继续跟踪它。

这时要用：

```bash
git rm --cached 文件名
```

表示：

```text
从 Git 跟踪里移除，但保留本地文件。
```

## 新项目怎么开始

### 从零开始

```bash
mkdir my-project
cd my-project
git init
git status
```

配置用户：

```bash
git config --global user.name "你的名字"
git config --global user.email "你的邮箱"
```

第一次提交：

```bash
git add .
git commit -m "初始化项目"
```

### 克隆已有项目

```bash
git clone https://github.com/user/project.git
cd project
git status --short --branch
```

克隆后，本地会有：

```text
工作区
.git 目录
默认分支
origin 远端
```

## 日常最小流程

个人开发时，最小循环：

```bash
git status --short
git diff
git add 文件
git diff --cached
git commit -m "说明这次改了什么"
```

多人协作时，开始前先同步：

```bash
git fetch origin
git pull --ff-only origin main
```

开发功能时，新建分支：

```bash
git switch -c feat/功能名
```

完成后合并：

```bash
git checkout main
git pull --ff-only origin main
git merge --no-ff feat/功能名 -m "合并某某功能"
```

## 初学者最容易混的点

### `git add` 不是提交

`git add` 只是暂存。

真正进入历史的是：

```bash
git commit
```

### `git fetch` 不会改本地代码

它只更新远端引用。

想更新当前分支要用 `pull`、`merge` 或 `rebase`。

### `origin/main` 不是本地 main

`origin/main` 是远端 main 的跟踪引用。

本地 `main` 需要你自己更新。

### Git 提交成功不等于代码正确

Git 只负责版本。

代码正确性要靠：

- build。
- test。
- lint。
- 人工 review。

### 不要在 main 上乱开发

更稳的习惯：

```text
main 保持稳定。
新功能开 feature 分支。
验证后再合回 main。
```

## 记忆版

```text
工作区：我正在改。
暂存区：我准备提交。
本地仓库：我已经提交。
远端仓库：团队共享。

status 看状态。
diff 看改了什么。
add 放进暂存区。
commit 保存历史。
fetch 看远端。
pull 更新本地。
push 推到远端。
branch / switch 管分支。
merge 合并分支。
```
