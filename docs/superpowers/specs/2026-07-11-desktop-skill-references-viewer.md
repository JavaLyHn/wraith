# 桌面技能面板:显示 references + 内置技能可查看

- 日期:2026-07-11
- 状态:draft → 实现中
- 关联:`Skill.referencesDir`、`SkillRegistry:137`、桌面 `SkillsPanel`/`SkillEditor`、`skillsGet` RPC

## 背景

技能不止 `SKILL.md`,还有 `references/`(如 web-access 有 cdp-cheatsheet.md + site-patterns/*.md)。
但桌面面板:
1. `skillsGet` 只回 `body`(SKILL.md 正文),**不含 references**;
2. **内置技能行只有「复制为用户技能」,没有「查看」** → 用户根本看不到内置技能的 SKILL.md 和 references。

## 目标

1. `skillsGet` 增加 `references: [{path, content}]`(遍历 `referencesDir`,含子目录,相对路径)。
2. 面板给**每个技能**加「查看」按钮(内置技能尤其需要),打开**只读** `SkillViewer`:
   显示元信息 + SKILL.md 正文 + references 文件列表(可展开看内容)。

## 非目标

- 不做 references 的编辑/新增(v1 只读展示)。
- SkillEditor(编辑用户/项目技能)本次不改。

## 设计

### 后端(Main.java `skillsGet`)
- 现有返回后追加:遍历 `s.referencesDir()`(可能 null)递归收集文件:
  `references = [{ path: <相对 referencesDir 的路径,用 / 分隔>, content }]`
- 护栏:referencesDir null/不存在 → 空列表;单文件 >256KB 截断并标注;跳过隐藏文件/`.version`;
  文件按 path 排序,稳定输出。异常只报简单类名。

### 桌面
- `SkillDetail` 加 `references?: { path: string; content: string }[]`。
- **`SkillViewer.tsx`**(只读):
  - 头:返回 + 技能名 + source 徽标 + version/author/tags
  - SKILL.md 正文:等宽 `<pre>`(与 markdown 代码块同风格)
  - 「参考资料 references/」区:每个文件一行(path),点击展开/收起内容(mono)
- `SkillsPanel`:
  - `Mode` 增加 `{ kind: 'view'; detail }`
  - 每行加「查看」按钮(所有 source);内置行「查看」+「复制为用户技能」;用户/项目行「查看」+「编辑」+「删除」
  - 点「查看」→ `getSkill(name)` → `setMode({kind:'view', detail})`

### 安全红线
- references 内容是技能文档,不含密钥;回包不带敏感字段。异常只报类名。
- 测试隔离:纯函数单测(如 references 排序/路径),不碰真实 skills 目录。

## 测试
- 若抽纯函数(如把后端 references 组装逻辑对应的前端排序/展示),补 vitest。
- typecheck / vitest / build 全绿;**改了 Java → 重打 jar + 同步 + 重启桌面**。

## 验收
- 内置 web-access 行点「查看」→ 看到 SKILL.md 正文 + references(cdp-cheatsheet、site-patterns/*)可展开。
- 无 references 的技能:查看页只显示正文,不显示空的 references 区。
