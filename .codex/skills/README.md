# Codex 项目级 skills

Codex CLI 进入本仓库时会自动加载 `.codex/skills/` 下的 skill（个人级则在 `~/.codex/skills/`）。

## 为什么有这个目录

`docs/superpowers/plans/` 下的实施计划，第一行都写着：

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended)
> or `executing-plans` to implement this plan task-by-task.

那两个原本是 **Claude Code 的 superpowers 插件** skill。Codex 装不到它们 ——
**官方 skill 目录（`openai/plugins`）里没有任何「按计划逐任务实施」这类流程 skill**，
它收的是 Figma / Notion / Expo / Netlify 这类产品集成。

所以这里把 superpowers **6.2.0** 的五个流程 skill 原样搬了过来，只做一处改动：
去掉 `superpowers:` 命名空间前缀（Codex 没有 plugin 命名空间）。

## 装了哪五个，各解决什么

| skill | 何时用 |
|---|---|
| `executing-plans` | 有写好的实施计划要按任务执行（无子 agent 时用这个） |
| `subagent-driven-development` | 同上，但**派子 agent 并行做独立任务**——计划里推荐的就是它 |
| `test-driven-development` | 写任何实现之前。本仓库的硬规矩「RED 证明」就出自这里 |
| `verification-before-completion` | **宣称「做完了 / 修好了 / 测试过了」之前**，必须先跑验证命令并确认输出 |
| `systematic-debugging` | 遇到 bug / 测试失败 / 非预期行为时，先走它再提修法 |

后两个对本仓库尤其重要 —— 项目历史上反复出现过**「假绿」**：空断言、
实际是空操作的脚本却全测试通过、测试替身不像真环境。
`AGENTS.md` 与 `docs/superpowers/plans/*.md` 的 Global Constraints 里都记着这条。

## 已知的小瑕疵

`executing-plans/SKILL.md` 里有一句指向 `../using-superpowers/references/`，
那个目录没搬过来（它是 Claude Code 的平台适配说明，对 Codex 无意义）。
读到那句忽略即可，不影响 skill 本身。

`subagent-driven-development` 会把评审产物写进 `<repo>/.superpowers/sdd/<计划名>/`。
该目录已在 `.gitignore:44`，与本仓库既有用法一致。

## 更新方式

这些是**快照**，不是软链。superpowers 升级后要手动重新同步：

```bash
S=~/.claude/plugins/cache/claude-plugins-official/superpowers/<版本>/skills
for k in executing-plans subagent-driven-development test-driven-development \
         verification-before-completion systematic-debugging; do
  rm -rf .codex/skills/$k && cp -R "$S/$k" .codex/skills/
done
find .codex/skills -name '*.md' -exec sed -i '' 's/superpowers://g' {} +
```
