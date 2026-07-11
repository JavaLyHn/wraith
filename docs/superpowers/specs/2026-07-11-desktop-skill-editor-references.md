# 桌面技能编辑器:支持附加文件(references)

- 日期:2026-07-11
- 状态:draft → 实现中
- 关联:`SkillEditor`、`skills.upsert` RPC、`SkillStore.upsert`、上一步的 SkillViewer/references

## 背景

上一步让技能面板能**查看** references,并修了 fork 丢 references 的 bug。但**新建/编辑技能时仍无法设置附加文件**——`SkillEditor` 只有正文 textarea,`skills.upsert` 只写 SKILL.md。用户想在建技能时一并加 references。

## 目标

`SkillEditor` 增加「参考文件 references/」区:可**新增 / 编辑 / 删除**文本参考文件(每个 = 相对路径 + 内容);保存时随 SKILL.md 一起落盘到 `references/`。编辑已有技能时预填其现有 references(getSkill 已返回)。

## 非目标

- 只支持**文本文件**(md/txt 等);不做二进制导入(references 基本都是 markdown 手册)。
- 不做子目录 UI 树,但路径允许含 `/`(如 `site-patterns/github.com.md`),按相对路径写入。

## 设计

### 前端
- `SkillUpsertPayload` + `SkillFormState` 加 `references: {path, content}[]`。
- `initForm` 从 `initial.references` 预填;`toUpsertPayload` 带上(过滤空 path)。
- `SkillEditor` 新增区块:每条一行(path 输入框 + 可折叠 content textarea)+「＋ 添加参考文件」+ 每条「删除」。
- 纯函数 `lib/skillEditor`:`normalizeReferences(refs)`(去空 path、trim、去重后者胜)+ 单测。

### 后端
- `skills.upsert` dispatch:解析 params.references 数组 → `List<Map<String,String>>`。
- `SessionRunner.skillsUpsert` 签名加 `references` 参数;`Main.java` 实现调
  `skillStore.upsert(...)` 后 `skillStore.writeReferences(scope, name, references)`。
- `SkillStore.writeReferences(scope, name, refs)`:**replace 模式**——先清空该技能 `references/`,
  再按 refs 写入(UI 是权威集,支持删除)。路径安全:拒绝 `..` / 绝对路径 / 空;
  各段过 SAFE 段校验;原子写(temp+move)。

### 安全红线
- 路径穿越防护(references 相对路径逐段校验,禁 `..`、禁绝对路径)。
- 内容不含密钥;异常只报简单类名。
- 测试隔离:纯函数单测,不碰真实 skills 目录。

## 测试
- `desktop/test/skillEditor.test.ts` 补 `normalizeReferences`(去空/去重/trim)。
- typecheck / vitest / build 全绿;**改 Java → 重打 jar + 同步 + 重启桌面**。

## 验收
- 新建技能加 2 个参考文件(含 `site-patterns/x.md` 这种带子目录路径)→ 保存 → 「查看」能看到。
- 编辑该技能删掉一个参考文件 → 保存 → 「查看」里对应文件消失。
