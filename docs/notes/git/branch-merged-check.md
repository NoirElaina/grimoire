---
title: 判断分支是否已经合并
sidebarTitle: 分支合并判断
---

# 判断分支是否已经合并

> `git branch --no-merged` 看的是提交历史关系；`git cherry -v` 看的是补丁内容是否等价进入目标分支。两个要一起看。

## 为什么会出现“看起来没合并”

有时候你会看到：

```bash
git branch -r --no-merged main
```

输出一些旧分支：

```text
origin/chore/setup-shadcn-tailwind
origin/feat/workspace-ui
```

直觉上会以为：

```text
这些分支还有代码没合到 main。
```

但不一定。

Git 判断“是否合并”有两个视角：

```text
历史关系：
    这个分支的提交是不是 main 历史上的祖先？

补丁内容：
    这个分支的改动内容是不是已经等价出现在 main？
```

`--no-merged` 主要看历史关系。

`git cherry -v` 可以帮助看补丁内容。

## `git branch --no-merged`

命令：

```bash
git branch -r --no-merged main
```

含义：

```text
列出远端分支里，尚未被 main 历史包含的分支。
```

参数解释：

| 部分 | 含义 |
| --- | --- |
| `branch` | 查看分支 |
| `-r` | 只看远端跟踪分支 |
| `--no-merged main` | 列出没有合并进 `main` 的分支 |

它适合用来发现：

- 还有哪些远端功能分支没并入主线。
- 哪些旧分支可能需要清理。
- 哪些分支可能遗漏合并。

但它不能单独证明：

```text
分支代码一定没进入 main。
```

## 为什么 `--no-merged` 会有误导

比如一个分支的提交是：

```text
C---D   old-branch
```

后来你没有直接 merge 这个分支，而是通过其他方式把改动带进了 main：

- cherry-pick。
- 手动重新提交。
- squash merge。
- 另一个分支包含了同样改动并合入。

这时 main 里有等价代码，但历史关系不是：

```text
old-branch 是 main 的祖先
```

所以 `--no-merged` 仍然可能显示它未合并。

## `git cherry -v`

命令：

```bash
git cherry -v main origin/chore/setup-shadcn-tailwind
git cherry -v main origin/feat/workspace-ui
```

含义：

```text
比较旧分支上的提交补丁是否已经等价存在于 main。
```

输出前缀很重要：

```text
- abc1234 commit message
+ def5678 commit message
```

含义：

| 前缀 | 意思 |
| --- | --- |
| `-` | 这个提交的补丁已经等价进入 `main` |
| `+` | 这个提交的补丁还没有进入 `main` |

所以：

```text
全是 -：
    说明有效改动基本已经被 main 吸收。

出现 +：
    说明还有补丁没有进入 main。
```

出现 `+` 时，不要直接 `merge -s ours`。

## 为什么 `git cherry` 更适合看补丁

Git 提交有两个层面：

```text
commit id:
    这次提交在历史里的唯一 ID。

patch:
    这次提交造成的内容变化。
```

同样的改动，如果用 cherry-pick 或 squash 进入 main，commit id 会变。

但 patch 可能相同。

`git cherry` 就是用来判断：

```text
虽然 commit id 不同，但这个补丁是不是已经有了。
```

## 推荐检查流程

### 第一步：看远端未合并分支

```bash
git fetch origin
git branch -r --no-merged main
```

得到候选分支列表。

### 第二步：逐个看补丁是否已进入 main

```bash
git cherry -v main origin/分支名
```

如果全是 `-`：

```text
有效补丁已经在 main。
可以考虑 merge -s ours 补历史关系。
```

如果有 `+`：

```text
还有改动没进 main。
需要继续判断这些改动是否要合并、丢弃、重做。
```

### 第三步：人工看日志和 diff

```bash
git log --oneline --decorate main..origin/分支名
git diff main...origin/分支名
```

这里看：

- 分支上还有哪些提交。
- 文件差异是不是有价值。
- 有没有新代码、新配置、新资源文件。
- 有没有只是历史关系未连接。

### 第四步：决定处理方式

| 情况 | 处理 |
| --- | --- |
| 补丁已进入 main，只是历史没连上 | `git merge -s ours --no-ff origin/分支名` |
| 补丁没进入 main，确实要合 | 正常 `git merge --no-ff origin/分支名` |
| 补丁没进入 main，但确认废弃 | 不合并，删除或保留分支按团队规范 |
| 分支太旧且冲突多 | 先评估需求，再 cherry-pick 或重做 |

## `main..branch` 和 `main...branch`

这两个也容易混。

### `main..branch`

```bash
git log main..origin/feat/workspace-ui
```

意思是：

```text
列出 branch 有、main 没有的提交。
```

适合看：

```text
这个分支上还有哪些提交不在 main 历史里。
```

### `main...branch`

```bash
git diff main...origin/feat/workspace-ui
```

三点 diff 通常表示：

```text
从 main 和 branch 的共同祖先开始，看 branch 相对共同祖先的改动。
```

适合看：

```text
这个分支想带来的整体内容变化是什么。
```

## 旧分支被 `-s ours` 后会发生什么

执行：

```bash
git merge -s ours --no-ff origin/chore/setup-shadcn-tailwind -m "记录合并 shadcn-vue 与工作台界面分支"
```

之后：

```text
main 会多一个 merge commit。
这个 merge commit 的内容等于当前 main。
但它的父提交包含 origin/chore/setup-shadcn-tailwind。
```

于是 Git 历史上认为：

```text
这个旧分支已经被 main 合并。
```

再运行：

```bash
git branch -r --no-merged main
```

这个分支通常就不会再出现。

## 常见坑

### 只看 `--no-merged`

它只能说明历史没有包含，不一定说明代码没进去。

### 只看 `git cherry`

`git cherry` 看补丁等价，但实际项目还要看文件、配置、分支语义。

最好配合 `git diff` 和人工判断。

### 有 `+` 也用 `-s ours`

这会把没合进去的改动假装合并。

非常危险。

### 没有先 `git fetch`

远端引用可能是旧的。

先：

```bash
git fetch origin
```

再判断。

## 记忆版

```text
branch --no-merged：
    看历史关系。

git cherry -v：
    看补丁是否等价进入。

全是 -：
    可以考虑 ours 补历史。

出现 +：
    不要 ours，先看差异。
```
