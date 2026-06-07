---
title: Git 基础命令
sidebarTitle: 基础命令
---

# Git 基础命令

> Git 基础命令要按场景记：看状态、看差异、暂存提交、撤销修改、管理分支、同步远端、临时保存。

## 命令地图

| 场景 | 常用命令 |
| --- | --- |
| 看状态 | `git status --short --branch` |
| 看差异 | `git diff`、`git diff --cached` |
| 暂存 | `git add`、`git add -p` |
| 提交 | `git commit -m` |
| 看历史 | `git log --oneline --decorate --graph` |
| 撤销工作区修改 | `git restore 文件` |
| 取消暂存 | `git restore --staged 文件` |
| 切分支 | `git switch 分支` |
| 新建分支 | `git switch -c 分支` |
| 合并分支 | `git merge 分支` |
| 拉远端信息 | `git fetch origin` |
| 更新本地分支 | `git pull --ff-only origin main` |
| 推送 | `git push origin 分支` |
| 临时保存 | `git stash push -m` |

## 看状态

最常用：

```bash
git status --short --branch
```

示例：

```text
## main...origin/main
 M docs/notes/git/index.md
?? docs/notes/git/basic-commands.md
```

含义：

| 标记 | 含义 |
| --- | --- |
| `M` | 文件被修改 |
| `A` | 新增文件已暂存 |
| `D` | 文件被删除 |
| `??` | 未跟踪文件 |
| `## main...origin/main` | 当前本地分支和远端跟踪关系 |

普通版：

```bash
git status
```

适合看详细提示。

短版：

```bash
git status --short
```

适合快速扫一眼。

## 看差异

### 看工作区改动

```bash
git diff
```

含义：

```text
看工作区里还没暂存的改动。
```

### 看暂存区改动

```bash
git diff --cached
```

含义：

```text
看下一次 commit 准备提交什么。
```

### 看某个文件

```bash
git diff docs/notes/git/index.md
git diff --cached docs/notes/git/index.md
```

### 看两个提交差异

```bash
git diff abc123 def456
```

### 合并前看分支差异

```bash
git diff main...feat/story-elements-ai
```

含义：

```text
看功能分支相对它和 main 的共同祖先改了什么。
```

## 暂存改动

### 暂存单个文件

```bash
git add docs/notes/git/basic-commands.md
```

### 暂存多个文件

```bash
git add file1 file2 file3
```

### 暂存当前目录全部改动

```bash
git add .
```

注意：

```text
git add . 会把当前目录下新增、修改、删除都放进暂存区。
```

提交前一定看：

```bash
git diff --cached
```

### 交互式暂存

```bash
git add -p
```

适合这种情况：

```text
一个文件里有两处修改。
一处属于功能 A。
一处属于功能 B。
你只想提交功能 A。
```

`git add -p` 可以按块选择是否暂存。

## 提交改动

### 普通提交

```bash
git commit -m "新增 Git 基础命令笔记"
```

提交说明建议写清楚：

```text
这次提交做了什么。
为什么做。
```

不要写：

```text
update
fix
改一下
```

### 提交前检查

```bash
git status --short
git diff --cached
```

要确认：

```text
暂存区只有这次想提交的内容。
没有无关文件。
没有敏感信息。
```

### 修改上一次提交

```bash
git commit --amend
```

适合：

- 刚提交完发现漏了一个文件。
- 提交说明写错了。
- 提交还没推送远端。

如果提交已经推送，`amend` 会改提交 ID。

团队协作时不要随便 amend 已推送提交。

## 看历史

### 简洁历史

```bash
git log --oneline --decorate -n 8
```

### 图形历史

```bash
git log --oneline --decorate --graph --all -n 30
```

### 看某个文件历史

```bash
git log --oneline -- docs/notes/git/index.md
```

### 看某次提交内容

```bash
git show abc123
```

只看文件列表：

```bash
git show --name-status abc123
```

## 撤销修改

撤销命令最容易误伤，先分清楚改动在哪里。

```text
工作区：
    文件改了，但还没 git add。

暂存区：
    已经 git add，但还没 commit。

本地提交：
    已经 commit。
```

### 撤销工作区单个文件

```bash
git restore 文件名
```

含义：

```text
丢弃这个文件在工作区里的未暂存修改。
```

危险点：

```text
这个修改会消失。
```

执行前先看：

```bash
git diff 文件名
```

### 取消暂存

```bash
git restore --staged 文件名
```

含义：

```text
把文件从暂存区拿出来。
文件内容还保留在工作区。
```

这个相对安全。

### 撤销所有工作区修改

```bash
git restore .
```

这会丢弃当前目录下所有未暂存修改。

不要随手用。

先看：

```bash
git status --short
git diff
```

### 删除未跟踪文件

查看会删除什么：

```bash
git clean -nd
```

真正删除：

```bash
git clean -fd
```

这个会删除未跟踪文件。

比如：

```text
?? temp.txt
?? dist/
```

执行前一定先用 `-n` 预览。

## reset 的基础理解

`reset` 会移动当前分支指针，也可能影响暂存区和工作区。

初学阶段先记三个：

### `--soft`

```bash
git reset --soft HEAD~1
```

含义：

```text
撤销最近一次 commit。
改动保留在暂存区。
```

适合：

```text
刚提交完，想重新组织提交。
```

### `--mixed`

```bash
git reset HEAD~1
```

默认就是 mixed。

含义：

```text
撤销最近一次 commit。
改动保留在工作区。
暂存区清空。
```

### `--hard`

```bash
git reset --hard HEAD~1
```

含义：

```text
撤销提交。
同时丢弃工作区和暂存区改动。
```

危险。

如果已经推送到远端，尤其是 `main`，不要随便 `reset --hard` 后强推。

## 分支命令

### 查看分支

```bash
git branch
git branch -a
```

### 查看当前分支

```bash
git branch --show-current
```

### 新建并切换

```bash
git switch -c feat/login
```

### 切换已有分支

```bash
git switch main
```

旧命令：

```bash
git checkout main
git checkout -b feat/login
```

现在更推荐用 `switch` 表达“切分支”。

### 删除本地分支

```bash
git branch -d feat/login
```

`-d` 会检查分支是否已合并。

如果强制删除：

```bash
git branch -D feat/login
```

要谨慎。

## 合并命令

### 合并功能分支

```bash
git checkout main
git pull --ff-only origin main
git merge --no-ff feat/login -m "合并登录功能"
```

这里的 `--no-ff` 会保留一个 merge commit。

适合功能分支合并。

### 合并时出现冲突

Git 会提示冲突文件。

流程：

```bash
git status
# 手动编辑冲突文件
git add 冲突文件
git commit
```

冲突区域大概长这样：

```text
[当前分支内容开始]
当前分支内容
[冲突分隔线]
被合并分支内容
[被合并分支 feat/login 结束]
```

解决冲突时不要只删除标记。

要理解两边代码，然后留下正确结果。

## 远端同步命令

### 查看远端

```bash
git remote -v
```

### 拉取远端引用

```bash
git fetch origin
```

`fetch` 不会改工作区。

### 更新 main

```bash
git checkout main
git pull --ff-only origin main
```

### 推送当前分支

```bash
git push origin 当前分支名
```

比如：

```bash
git push origin feat/login
```

### 推送 main

```bash
git push origin main
```

推 main 前要确认：

```bash
git branch --show-current
git status --short --branch
```

## stash 临时保存

`stash` 适合临时把工作区改动收起来。

比如你正在改功能，突然要切分支修 bug。

保存：

```bash
git stash push -m "临时保存登录页修改"
```

查看：

```bash
git stash list
```

恢复：

```bash
git stash pop
```

或者只应用不删除 stash：

```bash
git stash apply stash@{0}
```

注意：

```text
stash 不是长期存储。
重要改动不要长期只放在 stash 里。
```

## 标签 tag

tag 通常用来标记版本。

创建标签：

```bash
git tag v1.0.0
```

推送标签：

```bash
git push origin v1.0.0
```

查看标签：

```bash
git tag
```

带说明的标签：

```bash
git tag -a v1.0.0 -m "发布 1.0.0"
```

## 配置命令

查看配置：

```bash
git config --list
```

配置用户名：

```bash
git config --global user.name "你的名字"
```

配置邮箱：

```bash
git config --global user.email "你的邮箱"
```

查看某项配置：

```bash
git config user.name
git config user.email
```

## 常见日常流程

### 开始一天工作

```bash
git status --short --branch
git checkout main
git pull --ff-only origin main
git switch -c feat/new-feature
```

### 提交一次改动

```bash
git status --short
git diff
git add 文件
git diff --cached
git commit -m "实现某某功能"
```

### 推送功能分支

```bash
git push origin feat/new-feature
```

### 合并回 main

```bash
git checkout main
git pull --ff-only origin main
git merge --no-ff feat/new-feature -m "合并某某功能"
npm run build
git diff --check
git push origin main
```

## 危险命令提醒

这些命令不是不能用，但要知道后果。

| 命令 | 风险 |
| --- | --- |
| `git reset --hard` | 丢弃提交之后的工作区和暂存区改动 |
| `git clean -fd` | 删除未跟踪文件 |
| `git push --force` | 改写远端历史，可能影响别人 |
| `git branch -D` | 强制删除本地分支 |
| `git checkout .` | 旧式丢弃工作区修改，容易误用 |

执行危险命令前先看：

```bash
git status --short --branch
git log --oneline --decorate -n 8
```

能不用 `--force` 就不用。

如果必须强推个人功能分支，优先用：

```bash
git push --force-with-lease
```

它比 `--force` 更安全，会检查远端是否被别人更新过。

## 记忆版

```text
看状态：
    git status --short --branch

看差异：
    git diff
    git diff --cached

提交：
    git add
    git commit -m

撤销：
    git restore
    git restore --staged

分支：
    git branch
    git switch
    git merge

远端：
    git fetch
    git pull --ff-only
    git push

临时保存：
    git stash
```
