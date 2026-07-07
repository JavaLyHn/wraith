# 设计：编辑技能时可改来源（移动作用域，后端冲突检测）

日期：2026-07-07
范围：Java 后端 + 桌面渲染层。需重建 jar。分支 `feat/skill-scope-move`（off main）。

## 背景 / 目标

Skills 编辑器编辑态锁死"来源"（`lockScope`），无法把已有技能从 user↔project 移动。本设计放开：编辑时可改来源，保存即把技能**移动**到目标作用域目录（写新 + 删旧）。为防覆盖目标层隐藏的同名技能（如 fork 后 user/project 同名并存），加**后端冲突检测**：移动前查目标作用域是否已有同名，有则拒绝、不写不删。

## 目标

- 编辑态"来源"下拉可选（user/project）；`name` 仍锁（改名另论，YAGNI）。
- 改来源保存 = 移动：`upsert` 到新作用域 + `delete` 旧作用域。
- 移动前后端检测目标作用域是否已有同名技能，冲突则拒绝并提示，绝不静默覆盖。
- 同作用域保存（未改来源）行为不变（沿用原 upsert，不检测/不删）。

## 非目标（YAGNI）

- 不支持改名（rename）。
- 不做 builtin 移动（builtin 只读、只能 fork）。
- 不做批量移动。

## 现有结构（锚点）

- Java `SkillStore`（`src/main/java/com/lyhn/wraith/skill/SkillStore.java`）：`upsert(scope,name,…)`、`delete(scope,name)`；私有 `resolveScopeDir(scope)`（user/project→目录，非法抛 IAE）、`requireSafeName(name)`（正则 + 路径安全）。
- Java `AppServer`（`.../runtime/appserver/AppServer.java`）：`SessionRunner` 接口含 default `skillsUpsert/…`；`dispatch` 里 `case "skills.upsert" -> {…}` 等按方法名路由。
- Java `Main.java`：匿名 `SessionRunner` override `skillsUpsert`→`skillStore.upsert(...)`、`skillsDelete`→`skillStore.delete(...)`。
- 桌面 `preload/index.ts`：`upsertSkill(payload)`、`deleteSkill(scope,name): Promise<{ok}>`。
- 桌面 `main/index.ts`：`ipcMain.handle('wraith:deleteSkill', …)`→`client.request('skills.delete', {scope,name})` 等。
- 桌面 `SkillEditor.tsx`：`onSave` → `upsertSkill(toUpsertPayload(form))` → `onSaved()`；`lockScope` 控制"来源"下拉 `disabled`；`initial: SkillDetail`（含 `source`/`name`）。
- 桌面 `SkillsPanel.tsx`：编辑分支 `<SkillEditor initial={mode.detail} lockName lockScope …>`；新建分支 `lockName={false} lockScope={false}`。
- `SkillDetail extends SkillView`（`shared/types.ts`），有 `source: 'builtin'|'user'|'project'`、`name`。

## 设计

### 1. 后端：SkillStore.existsInScope（只读检测）

`SkillStore` 加：
```java
/** 目标作用域下是否已存在该技能(<scopeDir>/<name>/SKILL.md)。scope 非法/name 非法抛 IAE。 */
public boolean existsInScope(String scope, String name) {
    Path dir = resolveScopeDir(scope);
    String safe = requireSafeName(name);
    return Files.isRegularFile(dir.resolve(safe).resolve("SKILL.md"));
}
```
复用 `resolveScopeDir` + `requireSafeName`，路径安全一致；不写盘。

### 2. 后端：RPC skills.existsInScope

- `AppServer.SessionRunner` 加 default 方法：
  ```java
  default java.util.Map<String,Object> skillsExistsInScope(String scope, String name) {
      throw new UnsupportedOperationException("skillsExistsInScope not implemented");
  }
  ```
- `AppServer.dispatch` 加 `case "skills.existsInScope" -> { 解析 scope/name → writer.result(id, session.skillsExistsInScope(scope,name)); }`，参数缺失/非法照既有 skills.* 风格返 -32602；IAE→-32602、其它→-32000（与既有一致）。
- `Main.java` 匿名 SessionRunner override：
  ```java
  public java.util.Map<String,Object> skillsExistsInScope(String scope, String name) {
      return java.util.Map.of("exists", skillStore.existsInScope(scope, name));
  }
  ```

### 3. 桌面 IPC 管线

- `preload/index.ts`：加 `skillExistsInScope(scope: 'user'|'project', name: string): Promise<{ exists: boolean }>`（类型声明 + 实现 `ipcRenderer.invoke('wraith:skillExistsInScope', scope, name)`）。
- `main/index.ts`：加 `ipcMain.handle('wraith:skillExistsInScope', (_e, scope, name) => client.request('skills.existsInScope', { scope, name }))`。

### 4. 桌面纯函数 scopeToCleanup

`src/renderer/lib/skillEditor.ts` 加：
```ts
/** 移动作用域后需删除的旧 scope;未移动/新建/builtin 源→null(无需删)。 */
export function scopeToCleanup(
  initialSource: 'builtin' | 'user' | 'project' | undefined,
  formScope: 'user' | 'project',
): 'user' | 'project' | null {
  if (initialSource !== 'user' && initialSource !== 'project') return null
  return initialSource === formScope ? null : initialSource
}
```

### 5. 桌面编辑器解锁 + 移动流

- `SkillsPanel.tsx` 编辑分支：`lockScope` → `lockScope={false}`（`lockName` 保持）。
- `SkillEditor.onSave`（`initial` 存在=编辑态）：
  ```
  const cleanup = scopeToCleanup(initial?.source, form.scope)
  if (cleanup) { // 发生移动
    const { exists } = await window.wraith.skillExistsInScope(form.scope, form.name)
    if (exists) { setError(`目标作用域「${form.scope}」已存在同名技能「${form.name}」，无法移动`); return }
  }
  await window.wraith.upsertSkill(toUpsertPayload(form))
  if (cleanup) await window.wraith.deleteSkill(cleanup, form.name)
  onSaved()
  ```
  - 未改来源（cleanup=null）：只 upsert，与原行为一致。
  - 冲突：提示 + 中止，不写不删。
  - 无冲突：写新 + 删旧。错误经既有保存错误展示位显示。

## 错误处理 / 边界

- `fromScope==toScope`：cleanup=null，不检测/不删，纯 upsert（回归安全）。
- builtin 源：编辑态不会出现（builtin 只 fork 不编辑），且 `scopeToCleanup` 对非 user/project 源返回 null 兜底。
- 非原子（检测→upsert→delete）：单用户本地，检测与写之间的竞态可忽略；若 delete 旧失败→两作用域各留一份（无数据丢失，可再删）。
- upsert/delete 失败：走既有 try/catch 错误提示，不 onSaved。

## 测试 / 门禁

- **Java**：`SkillStoreTest` 加 `existsInScope`——目标存在→true、不存在→false、跨 scope 独立（user 有不代表 project 有）、非法 scope/name 抛 IAE。`mvn -DskipTests=false -Dtest=SkillStoreTest test`。
- **前端 vitest**：`skillEditor` 测 `scopeToCleanup`——同 scope→null、跨 scope→旧 scope、builtin/undefined→null。
- **typecheck + build**：IPC 管线 + 编辑器接线。
- **眼验**：编辑态来源可选；user→project 移动成功（旧目录消失、新目录出现）；制造冲突（目标已有同名）→被拒提示；未改来源编辑照常。
- jar 重建部署 `~/.wraith/wraith.jar` 后重启 App 眼验。

## 交付链路

`feat/skill-scope-move`（off main）→ SDD/inline → Java 测试 + 前端 typecheck/vitest/build 全绿 → `mvn -q -DskipTests package` 重建 jar → 部署 → 眼验 → FF-merge + 推送（推送前用户点头）。

## 安全

无密钥面。`existsInScope` 只读、复用 `requireSafeName` 防路径穿越。提交前 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`。
