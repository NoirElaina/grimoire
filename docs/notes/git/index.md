---
title: Git 总览
sidebarTitle: 专题首页
---

# Git 总览

> 这组 Git 笔记先补基础，再讲合并。先知道工作区、暂存区、提交、分支、远端是什么，再去看功能分支怎么安全合并到 main。

## 内容入口

| 笔记 | 重点 |
| --- | --- |
| [Git 入门](/notes/git/getting-started) | 工作区、暂存区、本地仓库、分支、远端 |
| [Git 基础命令](/notes/git/basic-commands) | `status`、`diff`、`add`、`commit`、`restore`、`push` |
| [功能分支合并流程](/notes/git/feature-merge-workflow) | 从功能分支验证、同步 main、合并到推送 |
| [合并策略：`--no-ff` 与 `-s ours`](/notes/git/merge-strategies) | 真实合并和记录合并的区别 |
| [判断分支是否已经合并](/notes/git/branch-merged-check) | `branch --no-merged`、`cherry -v` 判断补丁关系 |
| [合并前后的验证清单](/notes/git/merge-verification) | 构建、编译、`diff --check` 和推送前确认 |

## 这组笔记先解决什么

| 笔记 | 解决的问题 |
| --- | --- |
| Git 入门 | Git 是什么，工作区、暂存区、本地仓库、分支、远端分别是什么 |
| 基础命令 | `status`、`diff`、`add`、`commit`、`restore`、`branch`、`switch`、`push` 怎么用 |
| 功能分支合并流程 | 一个功能分支从验证、同步 main、合并、再验证到推送的标准流程 |
| 合并策略 | `git merge --no-ff` 和 `git merge -s ours` 分别是什么意思，什么时候能用 |
| 分支合并判断 | `git branch --no-merged`、`git cherry -v` 怎么判断旧分支是否真的已经吸收 |
| 验证清单 | 合并前后为什么都要跑构建、编译、`git diff --check` |

## 先记住主线

Git 日常开发先按这个模型理解：

```text
工作区
  -> git add
  -> 暂存区
  -> git commit
  -> 本地仓库
  -> git push
  -> 远端仓库
```

正常合并功能分支，再按这条线：

```text
确认当前分支和工作区
  -> 在功能分支先验证
  -> 切回 main
  -> 同步远端 main
  -> merge --no-ff 功能分支
  -> 合并后再验证
  -> push main
```

对应命令：

```bash
git status --short --branch
git branch --show-current
git log --oneline --decorate -n 8

git checkout main
git pull --ff-only origin main
git merge --no-ff feature-branch -m "中文合并说明"

npm run build
git diff --check
git push origin main
```

## 最重要的原则

### 合并前先验证功能分支

不要把一个自己都没验证过的分支合进 `main`。

合并前验证能回答：

```text
这个功能分支自己是不是好的？
```

### 合并后再验证 main

功能分支自己能跑，不代表合进 `main` 后还能跑。

合并后验证能回答：

```text
main 当前整体是不是好的？
```

### `-s ours` 不能乱用

`git merge -s ours` 的意思不是“解决冲突时选择我们的文件”。

它的意思是：

```text
保留当前分支内容。
把对方分支记录成已合并。
不拿对方分支的文件改动。
```

所以必须先确认：

```text
对方分支的有效改动已经等价进入 main。
```

否则就是把没合进去的功能假装合并了。

## 后面可以继续补

- rebase 和 merge 的区别。
- reset、revert、restore 的区别。
- 冲突解决流程。
- cherry-pick 使用场景。
- tag、release、版本回滚。
- GitHub PR 合并策略。
