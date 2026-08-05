---
name: git-workflow
description: |
  复杂 Git 操作的决策手册：冲突解决、交互式 rebase、cherry-pick、bisect 定位回归、分支策略、恢复误操作、提交消息规范、合并策略选择。
  触发场景：用户说「帮我解决冲突 / rebase 到 main / cherry-pick 某个提交 / 用 bisect 找引入 bug 的提交 / 恢复误删的分支 / squash 提交 / 提交消息怎么写 / merge 还是 rebase / 回滚上次发布 / git 历史乱了怎么清理」。先 load_skill。
version: "1.0.0"
author: Wraith
tags: [process, git, workflow]
---

# Git 工作流（Git Workflow）

## 概述

Git 操作不可逆的比想象中多。**动手前先确认安全网在不在。**

**核心原则：先备份、再操作、后验证。破坏性操作前永远先确认 reflog 可回溯。**

## 操作前检查清单

每次做破坏性 Git 操作（rebase / reset / force push / filter-branch）前：

```bash
# 1. 确认当前位置
git status
git log --oneline -5

# 2. 备份当前分支
git branch backup-$(date +%Y%m%d-%H%M%S)

# 3. 确认 stash 干净（有未提交改动先 stash）
git stash list
```

## 场景速查

### 冲突解决

```
merge/rebase 冲突时：

1. 看冲突文件列表：git status
2. 逐文件解决：
   - read_file 查看冲突标记（<<<<< / ===== / >>>>>）
   - 理解双方意图，不要机械选一边
   - 冲突区域之外的代码不要动
3. 解决后：git add <file>
4. 继续：git rebase --continue 或 git merge --continue
5. 验证：mvn compile / tsc --noEmit
```

**原则：**
- 先理解双方改了什么、为什么改，再决定保留哪些
- 不确定时 `git log --oneline --all -- <冲突文件>` 看历史
- 解决完跑测试，不要只编译通过就算

### 交互式 Rebase

```bash
# 整理最近 N 个提交
git rebase -i HEAD~N

# 常用操作：
# pick   = 保留
# squash = 合并到上一个（保留消息）
# fixup  = 合并到上一个（丢弃消息）
# reword = 只改提交消息
# edit   = 暂停让你修改
# drop   = 丢弃
```

**纪律：**
- 只整理未推送的提交
- 已推送的分支用 `--force-with-lease`（不是 `--force`）
- 公共分支（main/develop）永不 force push

### Cherry-pick

```bash
# 挑选单个提交
git cherry-pick <sha>

# 挑选但不立即提交（用于合并多个）
git cherry-pick --no-commit <sha1> <sha2>
git commit -m "feat: combined cherry-pick"

# 冲突时
git cherry-pick --continue   # 解决后继续
git cherry-pick --abort       # 放弃
```

### Bisect 定位回归

```bash
# 启动
git bisect start
git bisect bad                 # 当前版本有 bug
git bisect good <已知好的sha>  # 某个已知没 bug 的版本

# Git 会自动 checkout 中间版本，你测试后告诉它：
git bisect good   # 这个版本没问题
git bisect bad    # 这个版本有问题

# 找到后
git bisect reset  # 回到原分支
```

**自动化：** 如果能用一条命令判断好坏：
```bash
git bisect run mvn test -Dtest=XxxTest -DskipTests=false
```

### 恢复误操作

| 误操作 | 恢复方式 |
|--------|----------|
| 误删分支 | `git reflog` → `git checkout -b <名> <sha>` |
| 误 reset --hard | `git reflog` → `git reset --hard <sha>` |
| 误 commit（未 push） | `git reset --soft HEAD~1`（保留改动） |
| 误 push | 先修本地再 `git push --force-with-lease` |
| 误 merge | `git reset --hard ORIG_HEAD` |
| 误删文件 | `git checkout HEAD -- <file>` |

**`git reflog` 是最后防线** —— 默认保留 90 天，足够恢复几乎任何误操作。

### 提交消息规范

```
<type>(<scope>): <简述>

<正文（可选）>

<脚注（可选）>
```

**type：**
- `feat`: 新功能
- `fix`: 修 bug
- `refactor`: 重构（不改行为）
- `docs`: 文档
- `test`: 测试
- `chore`: 构建/工具
- `perf`: 性能

**好的提交消息：**
```
feat(skill): 新增 git-workflow skill

添加 Git 复杂操作的决策手册，覆盖冲突解决、rebase、
cherry-pick、bisect 等场景。
```

**坏的提交消息：** `fix bug` / `update` / `WIP` / `misc`

### 合并策略选择

| 场景 | 策略 | 原因 |
|------|------|------|
| 功能分支 → main | Squash merge | 保持主干历史干净 |
| 长期分支互合 | Merge commit | 保留完整历史 |
| 整理本地提交 | Interactive rebase | 提交粒度可控 |
| 紧急热修复 | Cherry-pick | 只取需要的改动 |
| 持续同步上游 | Rebase | 线性历史，减少噪音 merge |

## 危险操作清单

以下操作**不可逆或难以恢复**，执行前必须二次确认：

- `git push --force`（用 `--force-with-lease` 替代）
- `git reset --hard`（未提交改动永久丢失）
- `git clean -fd`（未跟踪文件永久删除）
- `git filter-branch` / `git filter-repo`（重写历史）
- 删除远端分支 `git push origin --delete <branch>`

## 不要做的事

- ❌ 在 main/master 上直接 force push
- ❌ rebase 已经被多人使用的公共分支
- ❌ 不看 diff 就解决冲突（机械选 ours/theirs）
- ❌ 用 `git add .` 盲目暂存所有改动（先 `git diff --cached` 检查）
- ❌ 在不理解历史的情况下做 filter-branch

## wraith 说明

- Wraith 的 Side-Git 快照（SnapshotService）独立于用户的 git 操作，不会被 rebase/reset 影响
- `revert_turn` 工具是 Wraith 级别的操作撤销，与 `git revert` 无关
- `execute_command` 跑 git 命令时，破坏性操作（reset --hard / push --force）会被 HITL 拦截
- 多人协作场景建议先 `git fetch --all` 再 `git log --oneline --all --graph` 看全貌

