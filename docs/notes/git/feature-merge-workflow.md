---
title: 功能分支合并流程
sidebarTitle: 功能分支合并
---

# 功能分支合并流程

> 功能分支合并不是直接 `git merge`，而是：先确认现场、合并前验证、同步 main、合并、合并后验证、最后推送。

## 适用场景

这篇笔记适合这种情况：

```text
你在一个功能分支上开发完成。
现在要把它合并到 main。
合并后直接推送 main。
```

比如：

```text
feat/story-elements-ai
```

要合并到：

```text
main
```

## 标准流程

完整流程：

```text
1. 看当前分支和工作区。
2. 在功能分支先验证。
3. fetch 远端。
4. 切回 main。
5. 快进同步远端 main。
6. merge --no-ff 功能分支。
7. 合并后再验证。
8. diff 检查。
9. push main。
```

这个顺序不要随便省。

尤其是：

```text
功能分支验证一次。
合并后 main 再验证一次。
```

这是两件不同的事。

## 第一步：看当前现场

进入项目：

```bash
cd D:\Issue\MicrosoftVSCode\temp\Xengineer\ScriptCraft
```

查看当前分支、工作区和最近提交：

```bash
git status --short --branch
git branch --show-current
git log --oneline --decorate -n 8
```

分别看什么：

| 命令 | 作用 |
| --- | --- |
| `git status --short --branch` | 看当前分支、是否有未提交改动、是否领先或落后远端 |
| `git branch --show-current` | 只输出当前分支名，避免看错分支 |
| `git log --oneline --decorate -n 8` | 看最近提交和分支指针位置 |

重点：

```text
确认自己真的在要合并的功能分支上。
确认工作区是干净的。
确认最近提交符合预期。
```

如果 `git status --short` 里有：

```text
 M file
?? file
```

说明还有未提交改动。

这时不要急着切分支或合并。

先决定：

- 这些改动是否要提交。
- 是否要丢弃。
- 是否要 stash。

## 第二步：合并前验证功能分支

为什么要先验证功能分支？

因为如果功能分支自己都构建不过，合进 `main` 后问题只会更难定位。

你的实际流程里，后端先做 Python 编译检查：

```bash
cd backend
uv run python -m py_compile main.py chapter_parser.py story_elements.py script_yaml.py llm\base.py llm\env_loader.py llm\factory.py llm\providers\common.py llm\providers\openai.py llm\providers\anthropic.py
```

这一步检查：

```text
Python 文件有没有语法错误。
模块能不能被编译。
基础导入路径有没有明显问题。
```

然后前端构建：

```bash
cd ..\frontend
npm run build
```

这一步检查：

```text
TypeScript / Vite / 前端依赖 / 打包流程是否正常。
```

回到项目根目录：

```bash
cd ..
```

到这里回答的是：

```text
功能分支当前能不能跑过基础验证？
```

## 第三步：同步远端信息

```bash
git fetch origin
```

`fetch` 做的事：

```text
从远端拉取最新引用。
更新 origin/main、origin/其他分支。
不改你当前工作区。
不自动合并。
```

为什么合并前要 `fetch`？

因为你要基于最新的远端状态判断：

- `main` 有没有新提交。
- 功能分支远端有没有变化。
- 旧分支是否已经被合并。

## 第四步：切回 main

```bash
git checkout main
```

或者新版本 Git 也可以：

```bash
git switch main
```

切换前必须确保工作区干净。

否则可能出现：

```text
未提交改动被带到 main。
切换失败。
合并时混入无关文件。
```

## 第五步：快进同步远端 main

```bash
git pull --ff-only origin main
```

这里不用普通 `git pull`，而是用 `--ff-only`。

原因：

```text
只允许 fast-forward。
如果本地 main 和远端 main 分叉，就直接失败。
```

这样可以避免在同步 main 时意外生成一个 merge commit。

`--ff-only` 的好处：

```text
main 的同步过程保持干净。
真正的合并提交只留给功能分支合并。
```

如果失败，说明：

```text
本地 main 和 origin/main 不是简单前后关系。
```

这时不要硬来。

先看：

```bash
git status --short --branch
git log --oneline --decorate --graph -n 20
```

确认是本地 main 有提交，还是远端 main 有新提交。

## 第六步：合并功能分支

```bash
git merge --no-ff feat/story-elements-ai -m "合并 AI 剧本 YAML 生成与预览功能"
```

这一步是真正把功能分支代码合进 `main`。

`--no-ff` 的意思是：

```text
即使可以快进，也创建一个 merge commit。
```

好处：

- 历史里能看到“这个功能分支在这里合入”。
- 方便以后回滚整个功能。
- 团队协作时主线更清楚。

合并成功后，`main` 会包含功能分支的文件改动。

如果出现冲突：

```text
Git 会暂停合并。
你需要解决冲突。
git add 冲突文件。
git commit 完成合并。
```

冲突没解决前不要跑 `git push`。

## 第七步：合并后再验证

合并后重复跑后端编译：

```bash
cd backend
uv run python -m py_compile main.py chapter_parser.py story_elements.py script_yaml.py llm\base.py llm\env_loader.py llm\factory.py llm\providers\common.py llm\providers\openai.py llm\providers\anthropic.py
```

再跑前端构建：

```bash
cd ..\frontend
npm run build
```

回到根目录：

```bash
cd ..
```

为什么合并后还要验证？

因为合并可能引入：

- 文件冲突解决错误。
- main 上的新改动和功能分支不兼容。
- 依赖版本变化。
- 类型错误。
- 构建配置变化。

合并前验证的是：

```text
功能分支自己没问题。
```

合并后验证的是：

```text
main 合并后的整体没问题。
```

## 第八步：检查 diff 空白问题

```bash
git diff --check
```

它主要检查：

- 行尾多余空格。
- 空白错误。
- 某些 patch 层面的格式问题。

这个命令不会替代测试和构建。

它只是最后一道轻量检查。

## 第九步：推送 main

```bash
git push origin main
```

推送前确认：

```bash
git status --short --branch
git log --oneline --decorate -n 5
```

应该看到：

```text
当前分支是 main。
工作区干净。
最近提交包含你的 merge commit。
```

推送后远端 `main` 就包含合并结果。

## 一套可复用模板

把分支名和验证命令替换成当前项目即可：

```bash
git status --short --branch
git branch --show-current
git log --oneline --decorate -n 8

# 在功能分支验证
cd backend
uv run python -m py_compile main.py chapter_parser.py story_elements.py script_yaml.py llm\base.py llm\env_loader.py llm\factory.py llm\providers\common.py llm\providers\openai.py llm\providers\anthropic.py

cd ..\frontend
npm run build

cd ..
git fetch origin
git checkout main
git pull --ff-only origin main
git merge --no-ff feat/story-elements-ai -m "合并 AI 剧本 YAML 生成与预览功能"

# 合并后验证
cd backend
uv run python -m py_compile main.py chapter_parser.py story_elements.py script_yaml.py llm\base.py llm\env_loader.py llm\factory.py llm\providers\common.py llm\providers\openai.py llm\providers\anthropic.py

cd ..\frontend
npm run build

cd ..
git diff --check
git push origin main
```

## 常见错误

### 没验证功能分支就合并

这样合并后出错，不知道问题来自功能分支本身，还是来自合并过程。

### 不同步远端 main

如果远端 main 已经有别人提交，你基于旧 main 合并，推送时可能失败，或者历史变复杂。

### 使用普通 `git pull`

普通 `git pull` 可能自动生成 merge commit。

同步 main 时推荐：

```bash
git pull --ff-only origin main
```

### 合并后不再验证

功能分支能构建，不代表合并后的 main 能构建。

尤其多人协作时，合并后验证是必须的。

### 在错误分支推送

推送前一定看：

```bash
git branch --show-current
git status --short --branch
```

不要在功能分支上误推，或者把 main 推错远端。

## 记忆版

```text
先看现场。
先测分支。
同步 main。
no-ff 合并。
再测 main。
检查 diff。
最后 push。
```
