---
title: 合并验证清单
sidebarTitle: 合并验证
---

# 合并验证清单

> 合并不是 Git 命令成功就结束。真正要确认的是：合并前功能分支可用，合并后 main 也可用。

## 为什么要验证两次

你这次流程里做得最好的点是：

```text
合并前验证功能分支。
合并后验证 main。
```

这是两个不同问题。

| 阶段 | 回答的问题 |
| --- | --- |
| 合并前验证 | 功能分支自己是不是好的 |
| 合并后验证 | main 合并后整体是不是好的 |

不要省掉第二次。

因为合并可能引入：

- 冲突解决错误。
- main 上新代码和功能分支不兼容。
- 依赖版本不一致。
- 构建脚本变化。
- 类型和语法问题。
- 文件路径和大小写问题。

## 合并前检查

### 当前分支

```bash
git status --short --branch
git branch --show-current
```

要确认：

```text
当前在功能分支。
工作区干净。
没有未提交改动。
```

### 最近提交

```bash
git log --oneline --decorate -n 8
```

要确认：

```text
最近提交就是你准备合并的功能提交。
没有奇怪的临时提交。
没有误提交敏感信息。
```

### 功能分支验证

后端：

```bash
cd backend
uv run python -m py_compile main.py chapter_parser.py story_elements.py script_yaml.py llm\base.py llm\env_loader.py llm\factory.py llm\providers\common.py llm\providers\openai.py llm\providers\anthropic.py
```

前端：

```bash
cd ..\frontend
npm run build
```

回根目录：

```bash
cd ..
```

如果这里失败：

```text
不要合并。
先在功能分支修复。
```

## 合并时检查

同步 main：

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
```

如果 `pull --ff-only` 失败：

```text
说明本地 main 和远端 main 分叉。
不要强行 pull。
先看历史。
```

查看：

```bash
git status --short --branch
git log --oneline --decorate --graph -n 20
```

正常合并：

```bash
git merge --no-ff feat/story-elements-ai -m "合并 AI 剧本 YAML 生成与预览功能"
```

合并后先看：

```bash
git status --short --branch
git log --oneline --decorate -n 5
```

要确认：

```text
当前仍然是 main。
没有未解决冲突。
最近提交是 merge commit。
```

## 合并后验证

后端再跑一次：

```bash
cd backend
uv run python -m py_compile main.py chapter_parser.py story_elements.py script_yaml.py llm\base.py llm\env_loader.py llm\factory.py llm\providers\common.py llm\providers\openai.py llm\providers\anthropic.py
```

前端再跑一次：

```bash
cd ..\frontend
npm run build
```

回根目录：

```bash
cd ..
```

再检查 diff：

```bash
git diff --check
```

`git diff --check` 常见会发现：

- trailing whitespace。
- 空白格式问题。
- patch 层面的错误。

如果失败，修掉再提交或 amend 合并提交。

## 推送前检查

推送前再看：

```bash
git status --short --branch
git log --oneline --decorate -n 5
```

期望状态：

```text
## main
工作区干净
最近提交是合并提交或后续修复提交
```

然后：

```bash
git push origin main
```

如果 push 失败，常见原因是：

```text
远端 main 又有新提交了。
```

处理：

```bash
git fetch origin
git status --short --branch
git log --oneline --decorate --graph --all -n 30
```

不要直接乱用 `--force`。

`main` 上一般不要 force push。

## 旧分支处理前验证

如果你看到旧分支没合并：

```bash
git branch -r --no-merged main
```

不要直接处理。

先：

```bash
git cherry -v main origin/chore/setup-shadcn-tailwind
git cherry -v main origin/feat/workspace-ui
```

如果全是：

```text
-
```

再考虑：

```bash
git merge -s ours --no-ff origin/chore/setup-shadcn-tailwind -m "记录合并 shadcn-vue 与工作台界面分支"
git merge -s ours --no-ff origin/feat/workspace-ui -m "记录合并工作台界面修复分支"
```

然后再：

```bash
git push origin main
```

如果有：

```text
+
```

不要 `-s ours`。

先看差异：

```bash
git log --oneline --decorate main..origin/分支名
git diff main...origin/分支名
```

## 验证命令怎么选

不同项目验证命令不同。

### Python 后端

基础语法：

```bash
uv run python -m py_compile 文件列表
```

如果有测试：

```bash
uv run pytest
```

如果有类型检查：

```bash
uv run mypy .
```

### Node 前端

构建：

```bash
npm run build
```

如果有 lint：

```bash
npm run lint
```

如果有测试：

```bash
npm test
```

### 文档项目

VitePress：

```bash
pnpm run docs:build
```

通用 diff 检查：

```bash
git diff --check
```

## 验证失败怎么办

### 合并前失败

说明功能分支本身有问题。

处理：

```text
留在功能分支。
修复问题。
重新提交。
重新跑验证。
再合并。
```

### 合并后失败

说明可能是：

- merge 冲突解决错。
- main 上已有改动和功能分支冲突。
- 合并引入整体构建问题。

处理：

```text
先不要 push。
在 main 上修复合并后的问题。
提交修复。
重新跑完整验证。
再 push。
```

如果刚合并完就发现严重问题，也可以在未推送前回退：

```bash
git reset --hard HEAD~1
```

但这个命令会丢弃当前分支最新提交和工作区改动。

使用前必须确认：

```bash
git status --short --branch
git log --oneline --decorate -n 5
```

如果已经 push 了，不要随便 reset main。

更推荐：

```bash
git revert -m 1 <merge-commit>
```

## 最小清单

正常合并前后至少做：

```text
合并前：
  - git status --short --branch
  - git branch --show-current
  - git log --oneline --decorate -n 8
  - 后端编译 / 测试
  - 前端 build

合并中：
  - git fetch origin
  - git checkout main
  - git pull --ff-only origin main
  - git merge --no-ff 分支名

合并后：
  - 后端编译 / 测试
  - 前端 build
  - git diff --check
  - git status --short --branch
  - git push origin main
```

## 记忆版

```text
没验证，不合并。
没同步，不合并。
合并后，不立刻推。
先构建，再 diff。
main 不乱 force push。
```
