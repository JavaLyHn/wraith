# 技能系统接通 app-server + 桌面「技能」面板 — 设计

日期:2026-07-06
状态:待用户复核
分支:`feat/skills-panel`

## 1. 背景与现状

Wraith 有完整的 Skill 系统(`com.lyhn.wraith.skill.*`):一个 Skill 是「决策/经验复用单元」,由 `SKILL.md`(frontmatter:name/description/version/author/tags + body)解析而来,`load_skill` 工具在运行时把 body 注入下一轮消息;技能索引(名+描述)注入系统提示让 LLM 知道有哪些技能。三层来源(覆盖顺序):

1. **BUILTIN**:jar 内置,`SkillBuiltinExtractor` 解压到 `~/.wraith/skills-cache`。
2. **USER**:`~/.wraith/skills/<name>/SKILL.md`。
3. **PROJECT**:`<projectDir>/.wraith/skills/<name>/SKILL.md`。

启停:`SkillStateStore`(`~/.wraith/skills.json`)只持久化 **disabled 列表**,启用为隐式默认(新技能不会被漏)。当前内置 1 个:`web-access`。

**关键缺口(已核实)**:`startAppServer()`(`Main.java:1113` 起)**完全没有接线 Skill 系统** —— 该区间无任何 `skill` 字样;`ToolRegistry` 未 `setSkillRegistry` 时 `load_skill` 直接返回「**Skill 系统未初始化**」。即:**桌面 app / gateway 里技能压根没通**,`load_skill` 会报错,LLM 也拿不到技能索引。交互式 CLI(`Main.java:325-346`)才有完整接线。

且桌面无任何技能相关 UI。

## 2. 目标 / 非目标

**目标**
- **接通**:把 Skill 系统接进 app-server 的 SessionRunner(复刻交互路径),使桌面里 `load_skill` 真能用、技能索引进系统提示。
- **展示 + 管理**:新增桌面「技能」面板 —— 按来源(内置/用户/项目)分组列出技能(名/描述/tags/版本/作者/来源),支持**启停**与**重新扫描**。
- RPC:`skills.list`、`skills.setEnabled`;桥接;`SkillView` 类型。

**非目标(YAGNI)**
- 不做桌面内**新建/编辑 SKILL.md**(用户仍在文件系统里放 SKILL.md;面板给放置路径引导)。
- 不做技能市场/远程安装。
- 不改技能解析、三层覆盖、`load_skill` 注入等既有逻辑。
- gateway daemon 的技能接线不在本期(仅 app-server;可后续同法补)。

## 3. 后端接通(app-server SessionRunner)

`Main.startAppServer()` 的 `SessionRunnerFactory`(`Main.java:1130` 起,每会话构造一次)内,在建好 `HitlToolRegistry registry` 与 `Agent agent` 之后、复刻交互路径(`Main.java:325-346`)的技能初始化:

```java
java.nio.file.Path home = java.nio.file.Path.of(System.getProperty("user.home"));
java.nio.file.Path skillsCacheDir = home.resolve(".wraith/skills-cache");
java.nio.file.Path userSkillsDir = home.resolve(".wraith/skills");
java.nio.file.Path projectSkillsDir = java.nio.file.Path.of(root).resolve(".wraith/skills"); // root=会话工作目录
try {
    new com.lyhn.wraith.skill.SkillBuiltinExtractor(skillsCacheDir).extractAll();
} catch (Exception e) {
    System.err.println("内置 skill 解压失败: " + e.getMessage());
}
com.lyhn.wraith.skill.SkillStateStore skillStateStore =
        new com.lyhn.wraith.skill.SkillStateStore(home.resolve(".wraith/skills.json"));
com.lyhn.wraith.skill.SkillRegistry skillRegistry = new com.lyhn.wraith.skill.SkillRegistry(
        skillsCacheDir, userSkillsDir, projectSkillsDir, skillStateStore);
skillRegistry.reload();
com.lyhn.wraith.skill.SkillContextBuffer skillContextBuffer =
        new com.lyhn.wraith.skill.SkillContextBuffer();
registry.setSkillRegistry(skillRegistry);       // 让 load_skill 可用
registry.setSkillContextBuffer(skillContextBuffer);
agent.setSkillRegistry(skillRegistry);          // 让技能索引进系统提示
agent.setSkillContextBuffer(skillContextBuffer);
```

SessionRunner 持有 `skillRegistry`(final 引用),供下面两个 RPC 读取/操作。

- **projectSkillsDir 用会话 root**(不是 CWD):与交互式差异点(交互式用 `Path.of(".wraith/skills").toAbsolutePath()` = CWD;app-server 每会话有明确 `root`,更正确)。
- 每会话独立 registry(project 目录随 root 变),与既有"每会话独立 agent/store"一致。

## 4. RPC 面(AppServer 分发 + Main SessionRunner 实现)

新增 SessionRunner default 方法 + AppServer dispatch case(照 `config.*` 模式):

| 方法 | 参数 | 结果 | 实现 |
|---|---|---|---|
| `skills.list` | `{}` | `{ skills: SkillView[] }` | 遍历 `skillRegistry.allSkills()`,每条映射为 view;`enabled = !stateStore.disabled().contains(name)` |
| `skills.setEnabled` | `{ name, enabled }` | `{ ok: true }` | `enabled ? stateStore.enable(name) : stateStore.disable(name)` → `skillRegistry.reload()` |

`SkillView`(每条):`{ name, description, version, author, tags: string[], source: "builtin"|"user"|"project", enabled: boolean }`。source 取 `skill.displaySource()`。缺失字段回落空串/空数组。

- `name` 缺失 → `-32602`(照现有 dispatch 守卫)。
- 无密钥/敏感数据,无红线问题;SKILL.md body 不在 list 里回传(只回元数据;详情/预览按需另议,本期不做 body 回传)。
- SessionRunner 无 skillRegistry(理论不该发生,因已在工厂接线)→ default 抛 `UnsupportedOperationException` → `-32000`(照现有模式)。

## 5. 桥 + 类型

- 类型(`desktop/src/shared/types.ts`):
  ```ts
  export interface SkillView {
    name: string
    description: string
    version: string
    author: string
    tags: string[]
    source: 'builtin' | 'user' | 'project'
    enabled: boolean
  }
  export interface SkillListResult { skills: SkillView[] }
  ```
- preload(`desktop/src/preload/index.ts`):`skillsList(): Promise<SkillListResult>`、`setSkillEnabled(name: string, enabled: boolean): Promise<{ ok: boolean }>`。
- IPC(`desktop/src/main/index.ts`):`wraith:skillsList` → `client.request('skills.list', {})`;`wraith:setSkillEnabled` → `client.request('skills.setEnabled', { name, enabled })`;`!client` 抛 "Backend not connected"(照现有 handler)。

## 6. 桌面「技能」面板

- **nav**:`App.tsx` view union 加 `'skills'`;`Sidebar` 加 `📚 技能` 导航项(样式/`activeNav` 与 🧩插件/⏰自动化/💬IM网关/🔌Provider配置 一致);`onOpenSkills` 回调 → `setView('skills')`;面板分支渲染 `<SkillsPanel onBack={() => setView('chat')} />`。
- **SkillsPanel**(`desktop/src/renderer/components/SkillsPanel.tsx`):
  - 顶部:标题「技能」+ 副文案(简述技能是什么)+「重新扫描」按钮(重新 `skillsList()`)。
  - 进面板 `skillsList()` 拉全量。
  - 按来源分组渲染:**内置 / 用户 / 项目**(纯函数 `groupSkillsBySource`);每组标题 + 该组技能行。
  - 每行:名称、描述(截断)、tags(小徽标)、`版本 · 作者`、来源徽标、**启停开关**(调 `setSkillEnabled` 后本地更新 + 重拉)。
  - 空组:内置组一般非空(web-access);用户/项目空 → 引导「把 `SKILL.md` 放到 `~/.wraith/skills/<名>/` 或 `<项目>/.wraith/skills/<名>/`」。
  - 禁用态视觉:enabled=false 的行降透明 + 开关关。
- 只读展示 + 启停;不做 body 详情(本期)。

## 7. 测试策略

**Java**
- `AppServerSkillsTest`(仿 `AppServerProviderConfigTest`):测试双 SessionRunner 实现 `skillsList`/`skillsSetEnabled`;断言 `skills.list` 回包结构(含 source/enabled)、`skills.setEnabled` 调用生效、缺 name → `-32602`。
- skill→view 映射 + enabled 计算(`enabled = !disabled.contains(name)`)可在同测试内以真实 `SkillRegistry`(临时目录建 SKILL.md + disabled 列表)覆盖一条。

**桌面**
- `skillsView` 纯函数:`groupSkillsBySource`(按 builtin/user/project 分组、组序固定、空组省略、组内保序)—— vitest。
- 面板/桥:typecheck + `npm run build` + 眼验(无 RTL)。

## 8. 触点清单

| 层 | 文件 | 改动 |
|---|---|---|
| 后端接线 | `cli/Main.java`(startAppServer SessionRunner) | 复刻技能初始化 + 持有 skillRegistry |
| RPC | `runtime/appserver/AppServer.java` | SessionRunner +`skillsList`/`skillsSetEnabled` default + 分发 `skills.list`/`skills.setEnabled` |
| RPC 实现 | `cli/Main.java`(SessionRunner 匿名类) | 实现两方法(读 registry / 改 stateStore + reload) |
| 桥 | `desktop/src/preload/index.ts`、`desktop/src/main/index.ts` | +`skillsList`/`setSkillEnabled` + 2 handler |
| 类型 | `desktop/src/shared/types.ts` | +`SkillView`/`SkillListResult` |
| 纯函数 | `desktop/src/renderer/lib/skillsView.ts` | `groupSkillsBySource`(+ 测试) |
| 面板 | `desktop/src/renderer/components/SkillsPanel.tsx`(新) | 列表/分组/启停/重扫 |
| nav | `desktop/src/renderer/App.tsx`、`desktop/src/renderer/components/Sidebar.tsx` | view 'skills' + `📚 技能` 导航项 |

## 9. 门禁

- Java `mvn -DskipTests=false test` 0F/0E;桌面 `npm run typecheck` + `npx vitest run` + `npm run build` 全绿。
- 提交前红线扫描 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`(本特性不涉密钥,应只命中字段名/自指)。
- commit trailer:`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` + `Claude-Session: …`。
- 分支:`feat/skills-panel`。
- 接通后需 **重建 jar + 眼验**:桌面对话里 `load_skill web-access` 应成功(不再「Skill 系统未初始化」);「技能」面板列出 web-access(内置)并可启停。
