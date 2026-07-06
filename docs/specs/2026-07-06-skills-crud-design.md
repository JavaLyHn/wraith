# 技能增删改查(桌面面板内建/改/删 + 复制内置)— 设计

日期:2026-07-06
状态:待用户复核
分支:`feat/skills-crud`

## 1. 背景与现状

上一期(`feat/skills-panel`,已合并)把 Skill 系统接进了 app-server,并新增桌面「技能」面板:按来源(内置/用户/项目)分组**只读展示** + **启停** + **重新扫描**。当前用户想新建/编辑一个技能,只能去文件系统手写 `~/.wraith/skills/<name>/SKILL.md`。本期补上桌面内的**增删改查**。

**已核实的关键约束(决定实现路径)**:

- **无 SKILL.md 序列化器**。`SkillFrontmatterParser`(`skill/SkillFrontmatterParser.java`)只解析、无写回,且刻意「不引入 SnakeYAML」。要写文件必须新增一个**镜像该解析器 YAML 子集的极简序列化器**。
- **解析器块标量 `|` 会折叠空白**:`sb.toString().replaceAll("\\s+", " ").trim()`(第 135 行)。即多行 description 解析回来是单行、单空格。这不是本期引入的行为,序列化器据此设计即可稳定 round-trip。
- **`SkillRegistry` 无写/删操作**,只有 `reload/allSkills/enabledSkills/findSkill/findAnySkill/stateStore`。`findAnySkill(name)` 忽略禁用态,适合 fork/get 取源。
- **内置技能只读**:由 `SkillBuiltinExtractor` 从 jar 解压到 `~/.wraith/skills-cache`,每次启动覆盖;写进去会被下次解压冲掉,且概念上不该改。
- **name 即目录名**:`~/.wraith/skills/<name>/SKILL.md`。必须做**目录安全校验**防路径穿越。
- app-server SessionRunner 作用域内已有 `skUserDir`(`~/.wraith/skills`)、`skProjectDir`(`<root>/.wraith/skills`)、`skillRegistry`(`Main.java:1164-1183`);dispatch 现有模式 `IllegalArgumentException→-32602`、`UnsupportedOperationException→-32000`。

## 2. 目标 / 非目标

**目标**
- **建/改**:桌面面板内**全字段编辑**(name/description/version/author/tags + body)新建或修改**用户/项目**技能,写回 `SKILL.md`。
- **删**:删除用户/项目技能(二次确认)。
- **复制内置**:内置技能只读,提供「复制为用户技能」→ fork 到 `~/.wraith/skills/<同名>/`(用户层覆盖内置,即「定制内置」)。
- 新增序列化器 + 文件写/删操作(原子写 + name 校验 + reload)。
- RPC:`skills.get`、`skills.upsert`、`skills.delete`、`skills.fork`;桥接;`SkillDetail` 类型。

**非目标(YAGNI)**
- 不做 references/ 附件的桌面内管理(只管 `SKILL.md` 主文件;用户仍手工放附件目录)。
- 不做技能市场/远程安装/导入导出。
- 不改三层覆盖、`load_skill` 注入、启停(`skills.list`/`skills.setEnabled`)等既有逻辑。
- 不做版本历史/回滚/冲突合并。保存即覆盖。
- gateway daemon 的技能写操作不在本期(仅 app-server)。
- 不支持 frontmatter 里的嵌套对象/anchor 等解析器本就不支持的语法。

## 3. 后端:SKILL.md 序列化器(新,核心)

新增 `skill/SkillFrontmatterWriter.java`(纯静态,镜像 `SkillFrontmatterParser` 的 YAML 子集,不引 SnakeYAML):

```java
public final class SkillFrontmatterWriter {
    private SkillFrontmatterWriter() {}

    /**
     * 生成完整 SKILL.md 文本:--- frontmatter --- + body。
     * 产物必须能被 SkillFrontmatterParser.parse 读回同样的字段(round-trip)。
     */
    public static String serialize(String name, String description, String version,
                                   String author, java.util.List<String> tags, String body) {
        StringBuilder sb = new StringBuilder();
        sb.append("---\n");
        sb.append("name: ").append(name).append('\n');           // name 已过目录安全校验,inline 安全
        // description 用块标量 |,规避冒号/方括号/引号/前导特殊字符的转义问题;
        // 解析器会折叠空白,故先把内部换行折成单行写在一条缩进行上,round-trip 稳定。
        String descOneLine = description == null ? "" : description.replaceAll("\\s+", " ").trim();
        sb.append("description: |\n");
        sb.append("  ").append(descOneLine).append('\n');
        if (version != null && !version.isBlank()) {
            sb.append("version: \"").append(version.trim()).append("\"\n"); // 引号包裹,允许含点/冒号
        }
        if (author != null && !author.isBlank()) {
            sb.append("author: \"").append(author.trim()).append("\"\n");   // 引号包裹,允许含空格/冒号
        }
        java.util.List<String> cleanTags = tags == null ? java.util.List.of()
                : tags.stream().map(String::trim).filter(t -> !t.isEmpty()).toList();
        if (!cleanTags.isEmpty()) {
            sb.append("tags: [").append(String.join(", ", cleanTags)).append("]\n");
        }
        sb.append("---\n\n");
        sb.append(body == null ? "" : body);
        return sb.toString();
    }
}
```

**序列化决策与解析器行为的对应**:

| 字段 | 写法 | 为什么 round-trip 成立 |
|---|---|---|
| name | `name: <值>` inline | name 过 `^[A-Za-z0-9_-]+$` 校验,无冒号/引号/特殊字符 |
| description | 块标量 `\|` + 2 空格缩进单行 | 解析器 `|` 分支折叠 `\s+`→空格并 trim;先折成单行写入,读回一致;规避前导 `[`/`{`/`"`/`\|`/冒号歧义 |
| version | `version: "值"` | 解析器剥配对引号;引号内允许点/冒号 |
| author | `author: "值"` | `findKeyColonIndex` 跳过引号内冒号;引号内允许空格/冒号 |
| tags | `tags: [a, b]` inline 数组 | 解析器逗号切分 + trim;空 tags 省略字段 |
| body | `---\n\n` 后原样 | 解析器 `substring(endIdx+4)` 跳 `---\n`,再 strip 一个前导 `\n` |

**已知边界(不支持,与解析器一致)**:字段值含**英文双引号**(version/author 无转义)、tag 含**逗号**、description 保留**换行**——均不支持,交由 name 校验之外的输入清洗(tags 去空/去空项;description 折行)兜底。round-trip 测试覆盖典型值。

## 4. 后端:文件写/删(新 `SkillStore`)

新增 `skill/SkillStore.java`,持有两个可写目录,把「校验 + 原子写 + 删」收敛到一处(`SkillRegistry` 保持只读不动):

```java
public final class SkillStore {
    private static final java.util.regex.Pattern SAFE_NAME =
            java.util.regex.Pattern.compile("^[A-Za-z0-9_-]+$");

    private final Path userSkillsDir;
    private final Path projectSkillsDir;

    public SkillStore(Path userSkillsDir, Path projectSkillsDir) { ... }

    /** scope: "user" | "project"。校验 name/scope → 建目录 → 原子写 SKILL.md。 */
    public void upsert(String scope, String name, String description, String version,
                       String author, java.util.List<String> tags, String body) throws IOException {
        Path dir = resolveScopeDir(scope);                 // 非法 scope → IllegalArgumentException
        String safe = requireSafeName(name);               // 非法 name → IllegalArgumentException
        Path skillDir = dir.resolve(safe);
        Files.createDirectories(skillDir);
        String content = SkillFrontmatterWriter.serialize(safe, description, version, author, tags, body);
        Path target = skillDir.resolve("SKILL.md");
        Path tmp = skillDir.resolve("SKILL.md.tmp");        // 同目录 temp,保证同盘原子 move
        Files.writeString(tmp, content);
        Files.move(tmp, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
    }

    /** 删除 <scopeDir>/<name>/ 整个技能目录(含 SKILL.md 与 references/),幂等。 */
    public void delete(String scope, String name) throws IOException {
        Path dir = resolveScopeDir(scope);
        String safe = requireSafeName(name);
        Path skillDir = dir.resolve(safe);
        if (Files.exists(skillDir)) deleteRecursively(skillDir);
    }

    private Path resolveScopeDir(String scope) {
        return switch (scope == null ? "" : scope) {
            case "user" -> userSkillsDir;
            case "project" -> projectSkillsDir;
            default -> throw new IllegalArgumentException("非法 scope: " + scope);
        };
    }
    private static String requireSafeName(String name) {
        if (name == null || !SAFE_NAME.matcher(name).matches())
            throw new IllegalArgumentException("非法技能名(仅允许字母/数字/下划线/连字符): " + name);
        return name;
    }
    // deleteRecursively:Files.walk 倒序删;仅作用于已校验的 skillDir 内。
}
```

- **name 校验是硬性安全点**:`^[A-Za-z0-9_-]+$` 拒 `/`、`..`、`.`、空格、空串 → `dir.resolve(name)` 恒在受管目录内,杜绝路径穿越。
- **scope 只认 `user`/`project`**;`builtin` 传进来直接 `IllegalArgumentException`(内置不可写/删)。
- **原子写**:同目录 temp + `ATOMIC_MOVE`(REPLACE_EXISTING),避免半写文件被 reload 读到。
- upsert 天然兼「建」与「改」(同名覆盖)。删幂等(不存在即 no-op)。
- 写/删后由**调用方(SessionRunner)触发 `skillRegistry.reload()`**,与启停一致。

## 5. RPC 面(AppServer 分发 + Main SessionRunner 实现)

新增 4 个 SessionRunner default 方法(照现有 `skillsList` 抛 `UnsupportedOperationException` 模式)+ AppServer dispatch case:

| 方法 | 参数 | 结果 | 实现要点 |
|---|---|---|---|
| `skills.get` | `{ name }` | `SkillDetail`(单条,含 body) | `skillRegistry.findAnySkill(name)`(含禁用/内置);null → `IllegalArgumentException("技能不存在")`→-32602 |
| `skills.upsert` | `{ scope, name, description, version, author, tags, body }` | `{ ok: true }` | `store.upsert(...)` → `skillRegistry.reload()` |
| `skills.delete` | `{ scope, name }` | `{ ok: true }` | `store.delete(scope, name)` → `reload()` |
| `skills.fork` | `{ name }` | `{ ok: true, name }` | 读 `findAnySkill(name)`(null→-32602)→ `store.upsert("user", src全字段)` → `reload()` |

**SessionRunner 实现**(`Main.java` 匿名类,`skillsList`/`skillsSetEnabled` 旁):构造一次 `SkillStore store = new SkillStore(skUserDir, skProjectDir)`(工厂作用域);

```java
public java.util.Map<String,Object> skillsGet(String name) {
    com.lyhn.wraith.skill.Skill s = skillRegistry.findAnySkill(name);
    if (s == null) throw new IllegalArgumentException("技能不存在: " + name);
    java.util.Map<String,Object> v = new java.util.LinkedHashMap<>();
    v.put("name", s.name());
    v.put("description", s.description());
    v.put("version", s.version() != null ? s.version() : "");
    v.put("author", s.author() != null ? s.author() : "");
    v.put("tags", s.tags());
    v.put("source", s.displaySource());
    v.put("enabled", !skillRegistry.stateStore().disabled().contains(s.name()));
    v.put("body", s.body());
    return v;
}
public java.util.Map<String,Object> skillsUpsert(String scope, String name, String description,
        String version, String author, java.util.List<String> tags, String body) {
    try { store.upsert(scope, name, description, version, author, tags, body); }
    catch (java.io.IOException e) { throw new RuntimeException("写入技能失败: " + e.getMessage(), e); }
    skillRegistry.reload();
    return java.util.Map.of("ok", true);
}
public java.util.Map<String,Object> skillsDelete(String scope, String name) {
    try { store.delete(scope, name); }
    catch (java.io.IOException e) { throw new RuntimeException("删除技能失败: " + e.getMessage(), e); }
    skillRegistry.reload();
    return java.util.Map.of("ok", true);
}
public java.util.Map<String,Object> skillsFork(String name) {
    com.lyhn.wraith.skill.Skill s = skillRegistry.findAnySkill(name);
    if (s == null) throw new IllegalArgumentException("技能不存在: " + name);
    try { store.upsert("user", s.name(), s.description(), s.version(), s.author(), s.tags(), s.body()); }
    catch (java.io.IOException e) { throw new RuntimeException("复制技能失败: " + e.getMessage(), e); }
    skillRegistry.reload();
    return java.util.Map.of("ok", true, "name", s.name());
}
```

**dispatch(AppServer.java)** 照 `skills.setEnabled` 写法:

- `skills.get`:缺 `name`→-32602;`try/catch IllegalArgumentException→-32602 / UnsupportedOperationException→-32000`。
- `skills.upsert`:缺 `name`/`scope`→-32602;`tags` 从 JSON 数组读为 `List<String>`(缺省空列表);其余字段缺省空串。同 catch。
- `skills.delete`:缺 `name`/`scope`→-32602。同 catch。
- `skills.fork`:缺 `name`→-32602。同 catch。

**RPC 层不做 name 正则校验**——统一由 `SkillStore.requireSafeName` 抛 `IllegalArgumentException`,dispatch 映射 -32602(单一真源)。

- 无密钥/敏感数据。body 会随 `skills.get` 回传(编辑回填需要),但仅本机 IPC,不外传、不入日志。

## 6. 桥 + 类型

- 类型(`desktop/src/shared/types.ts`):新增 `SkillDetail`(= `SkillView` + `body`);upsert 载荷类型。
  ```ts
  export interface SkillDetail extends SkillView { body: string }
  export interface SkillUpsertPayload {
    scope: 'user' | 'project'
    name: string
    description: string
    version: string
    author: string
    tags: string[]
    body: string
  }
  ```
- preload(`desktop/src/preload/index.ts`)+ `WraithApi`:
  ```ts
  getSkill(name: string): Promise<SkillDetail>
  upsertSkill(payload: SkillUpsertPayload): Promise<{ ok: boolean }>
  deleteSkill(scope: 'user' | 'project', name: string): Promise<{ ok: boolean }>
  forkSkill(name: string): Promise<{ ok: boolean; name: string }>
  ```
- IPC(`desktop/src/main/index.ts`):`wraith:getSkill`→`skills.get {name}`;`wraith:upsertSkill`→`skills.upsert {…payload}`;`wraith:deleteSkill`→`skills.delete {scope,name}`;`wraith:forkSkill`→`skills.fork {name}`;`!client` 抛 "Backend not connected"(照现有 handler)。

## 7. 桌面 UI(SkillsPanel 扩展 + 编辑器)

**纯逻辑抽到 `desktop/src/renderer/lib/skillEditor.ts`(可 vitest)**:
- `parseTagsInput(raw: string): string[]` —— 逗号或换行分隔 → trim → 去空 → 去重(保序)。
- `validateSkillName(name: string): string | null` —— 前端即时反馈,规则镜像后端 `^[A-Za-z0-9_-]+$`;合法返回 `null`,否则返回中文错误串。**后端仍是最终裁决**(前端只是体验)。
- `toUpsertPayload(form): SkillUpsertPayload` —— 表单态 → RPC 载荷(tags 经 `parseTagsInput`)。

**`SkillEditor.tsx`(新组件)**:表单
- `name`:新建可填(带 `validateSkillName` 即时校验提示);编辑时**只读展示**(改名 = 删旧建新,本期不做)。
- `scope`:新建时选 用户 / 项目(默认用户);编辑/复制时锁定为该技能来源对应 scope。
- `description`(多行 textarea,小)、`version`、`author`(单行)、`tags`(单行,逗号分隔,占位「用逗号分隔」)、`body`(大 textarea,等宽字体)。
- 底部:保存(调 `upsertSkill` → 成功后回列表并 `skillsList()` 重拉)/ 取消。保存中禁用按钮;失败弹错误文案。

**`SkillsPanel.tsx` 扩展**:
- 顶部操作区加「＋ 新建技能」→ 打开空 `SkillEditor`(scope 默认 user)。
- 每行按来源分能力:
  - **用户 / 项目** 行:加「编辑」(→ `getSkill(name)` 取 body 回填 `SkillEditor`)、「删除」(二次确认 → `deleteSkill(scope,name)` → 重拉)。
  - **内置** 行:保持只读;加「复制为用户技能」(→ `forkSkill(name)`;若用户层已存在同名,先 `confirm` 覆盖提示 → 成功后重拉,新用户技能出现在「用户」组)。
- 面板内视图切换:列表 ⇄ 编辑器(本地 state,不新增 App view);编辑器返回即列表。
- 启停开关、重新扫描、分组渲染沿用上期不动。

## 8. 测试策略

**Java**
- `SkillFrontmatterWriterTest`(核心):**round-trip** —— `serialize(...)` → `SkillFrontmatterParser.parse` → 字段一致。覆盖:含冒号/方括号的 description、多标签、空 version/author/tags(字段省略)、body 原样、含空格与冒号的 author。
- `SkillStoreTest`(临时目录):`upsert` 建目录 + 写 `SKILL.md` + 内容可被 parser 读回;同名 upsert 覆盖;`delete` 移除目录且幂等;`requireSafeName` 拒 `../x`、`a/b`、``、`.`;非法 scope(含 `builtin`)抛 `IllegalArgumentException`。
- `AppServerSkillsTest`(扩上期,测试双 SessionRunner):`skills.get` 回包含 body;缺 `name`→-32602;`skills.upsert`/`skills.delete` 缺 `scope`/`name`→-32602;`skills.fork` 不存在 name→-32602;非法 name/scope 经实现抛 `IllegalArgumentException`→-32602。可用真实 `SkillRegistry`+`SkillStore`(临时目录)覆盖一条 upsert→list 出现、delete→消失、fork→user 出现。

**桌面**
- `skillEditor` 纯函数:`parseTagsInput`(逗号/换行/去空/去重/保序)、`validateSkillName`(合法 + 拒 `../`/空/含斜杠/含点)、`toUpsertPayload` —— vitest。
- `SkillEditor`/`SkillsPanel`:typecheck + `npm run build` + 眼验(无 RTL)。

## 9. 触点清单

| 层 | 文件 | 改动 |
|---|---|---|
| 序列化器 | `skill/SkillFrontmatterWriter.java`(新) | frontmatter+body 序列化(镜像解析器子集) |
| 文件写/删 | `skill/SkillStore.java`(新) | upsert/delete + name 校验 + 原子写 + scope 解析 |
| RPC 接口 | `runtime/appserver/AppServer.java` | SessionRunner +`skillsGet`/`skillsUpsert`/`skillsDelete`/`skillsFork` default + 分发 4 个 case |
| RPC 实现 | `cli/Main.java`(SessionRunner 匿名类) | 构 `SkillStore` + 实现 4 方法(读 registry / 写 store + reload) |
| 桥 | `desktop/src/preload/index.ts`、`desktop/src/main/index.ts` | +4 API + 4 handler |
| 类型 | `desktop/src/shared/types.ts` | +`SkillDetail`/`SkillUpsertPayload` |
| 纯函数 | `desktop/src/renderer/lib/skillEditor.ts`(新) | tags 解析 / name 校验 / payload(+ 测试) |
| 编辑器 | `desktop/src/renderer/components/SkillEditor.tsx`(新) | 表单(字段 + body) |
| 面板 | `desktop/src/renderer/components/SkillsPanel.tsx` | ＋新建 / 编辑 / 删除 / 复制为用户技能 + 列表⇄编辑器 |

## 10. 门禁

- Java `mvn -DskipTests=false test` 0F/0E(基线之外无新增失败);桌面 `npm run typecheck` + `npx vitest run` + `npm run build` 全绿。
- 提交前红线扫描 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`(本特性不涉密钥,应只命中字段名/自指/测试金丝雀)。
- commit trailer:`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` + `Claude-Session: …`。
- 分支:`feat/skills-crud`。
- 落地后需 **重建 jar + 眼验**:面板内新建一个用户技能 → 出现在「用户」组;编辑其 body → `getSkill` 回填正确、保存后 `load_skill <name>` 注入新 body;删除 → 消失;内置 web-access「复制为用户技能」→ 用户组出现同名可编辑副本。
- **安全**:name 只走 `^[A-Za-z0-9_-]+$`;写/删仅限 `~/.wraith/skills` 或 `<root>/.wraith/skills`;内置(builtin scope)永不被 upsert/delete;body 仅本机 IPC 回传,不外传不入日志。
