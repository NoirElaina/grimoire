---
title: Git 合并策略
sidebarTitle: 04 合并策略
---

# Git 合并策略

> `git merge --no-ff` 是真正合并代码并保留分支合并记录；`git merge -s ours` 是保留当前分支内容，只记录对方分支已经被吸收。

## 先说结论

这两个命令看起来都在 merge，但用途完全不同。

| 命令 | 是否拿对方代码 | 主要作用 |
| --- | --- | --- |
| `git merge --no-ff feature` | 会 | 把功能分支代码合到当前分支，并生成 merge commit |
| `git merge -s ours feature` | 不会 | 保留当前分支文件内容，只在历史上记录对方分支已合并 |

普通功能分支合并，优先用：

```bash
git merge --no-ff 分支名 -m "中文合并说明"
```

`-s ours` 只能在非常明确的场景使用：

```text
对方分支的有效改动已经等价进入当前分支。
但 Git 历史关系没有连上。
现在只想补一条“已合并”的历史记录。
```

## `git merge --no-ff`

### 它做什么

命令：

```bash
git merge --no-ff feat/story-elements-ai -m "合并 AI 剧本 YAML 生成与预览功能"
```

含义：

```text
把 feat/story-elements-ai 的代码改动合并进当前分支。
即使 Git 本来可以 fast-forward，也强制创建一个 merge commit。
```

### 为什么要 `--no-ff`

如果不用 `--no-ff`，当 `main` 没有新提交时，Git 可能直接快进：

```text
main 指针直接移动到功能分支最新提交。
```

这样历史会变成：

```text
A---B---C---D
```

看不出 `C-D` 是一个功能分支。

使用 `--no-ff` 后，历史更像：

```text
A---B-------M  main
     \     /
      C---D   feat/story-elements-ai
```

`M` 是 merge commit。

好处：

- 保留功能分支合并边界。
- 日后可以看出“这一坨提交属于一个功能”。
- 回滚整个功能更容易。
- 中文合并说明能直接描述业务功能。

### 什么时候用

适合：

- 功能分支合并到 `main`。
- 多个提交组成一个完整功能。
- 希望保留合并记录。
- 团队习惯主线有 merge commit。

不适合：

- 你想保持完全线性的历史。
- 团队约定所有 PR squash merge。
- 单个微小提交不需要分支边界。

## `git merge -s ours`

### 它做什么

命令：

```bash
git merge -s ours --no-ff origin/chore/setup-shadcn-tailwind -m "记录合并 shadcn-vue 与工作台界面分支"
```

含义：

```text
创建一个 merge commit。
这个 merge commit 有两个父提交：当前 main 和对方分支。
但文件内容完全保留当前 main。
不拿对方分支的文件改动。
```

换句话说：

```text
代码用我们的。
历史上记录你也已经合进来了。
```

### 它不是冲突解决里的 ours

这里特别容易混。

`git merge -s ours` 是一种 merge strategy。

它表示：

```text
整个合并都采用 ours 策略。
完全忽略对方分支内容。
```

它不等于冲突时的：

```bash
git checkout --ours file
```

冲突时的 `--ours` 是针对某个冲突文件选择当前分支版本。

`merge -s ours` 是整个分支合并都不拿对方代码。

## `-s ours` 的正确使用场景

你的这次场景是：

```bash
git branch -r --no-merged main
git cherry -v main origin/chore/setup-shadcn-tailwind
git cherry -v main origin/feat/workspace-ui
```

发现旧分支在：

```bash
git branch -r --no-merged main
```

里还显示“没合并”。

但用：

```bash
git cherry -v main origin/旧分支
```

确认这些分支的有效补丁已经等价进入 `main`。

这时才可以：

```bash
git merge -s ours --no-ff origin/chore/setup-shadcn-tailwind -m "记录合并 shadcn-vue 与工作台界面分支"
git merge -s ours --no-ff origin/feat/workspace-ui -m "记录合并工作台界面修复分支"
```

目的不是合代码，而是：

```text
补上历史合并关系。
让 Git 认为这些旧分支已经被 main 合并。
清理 --no-merged 的误报。
```

## `-s ours` 的危险点

不能这样想：

```text
这个分支看起来不重要，直接 merge -s ours 吧。
```

因为 `-s ours` 会把对方分支标记为已合并，但不会拿它的改动。

如果对方分支有还没进入 main 的功能，你这么做等于：

```text
把功能丢了。
还让 Git 以为它已经合了。
```

这是非常危险的。

## 使用 `-s ours` 前必须确认

至少做两类检查。

### 检查分支补丁是否等价进入 main

```bash
git cherry -v main origin/旧分支
```

如果输出前面是：

```text
-
```

说明这个提交的补丁内容已经等价存在于 `main`。

如果前面是：

```text
+
```

说明这个提交的补丁内容还没有进入 `main`。

有 `+` 就不要直接 `-s ours`。

### 人工看差异

再看一次：

```bash
git log --oneline --decorate main..origin/旧分支
git diff main...origin/旧分支
```

要确认：

```text
没有还需要合入的有效代码。
```

只有确认过，才能用 `-s ours` 记录历史吸收。

## `--no-ff` 和 `-s ours` 一起用是什么意思

```bash
git merge -s ours --no-ff origin/feat/workspace-ui -m "记录合并工作台界面修复分支"
```

这里：

```text
-s ours:
    合并结果采用当前 main 的内容。

--no-ff:
    强制创建 merge commit，留下分支合并记录。
```

如果不用 `--no-ff`，在某些情况下可能不会生成你想要的合并记录。

这里的目标本来就是“记录关系”，所以保留 merge commit 是合理的。

## 决策表

| 场景 | 用什么 |
| --- | --- |
| 正常功能分支要合进 main | `git merge --no-ff feature` |
| 功能分支只有一个小提交，团队要求线性历史 | rebase 或 squash，看团队规范 |
| 旧分支显示未合并，但补丁已等价进入 main | 确认后 `git merge -s ours --no-ff old-branch` |
| 旧分支还有 `git cherry` 显示 `+` 的提交 | 不要 `-s ours`，先判断是否真实需要合并 |
| 合并冲突中只想某个文件用当前分支版本 | 冲突解决里的 `--ours`，不是 `merge -s ours` |

## 常见误区

### `-s ours` 是解决冲突的万能办法

不是。

它会忽略整个对方分支。

### `--no-ff` 会改变代码内容

不会。

它主要影响历史形状，让 Git 创建 merge commit。

### `-s ours` 后对方代码也进来了

不会。

它只记录合并关系，不拿对方文件内容。

### 看到 `--no-merged` 就直接合

不一定。

有些分支因为历史关系没连上，看起来没合并，但补丁已经等价进入 main。

要配合 `git cherry -v` 判断。

## 记忆版

```text
--no-ff：
    真合代码，留合并记录。

-s ours：
    不拿代码，只补历史关系。

-s ours 必须先确认：
    对方有效改动已经在 main 里。
```
