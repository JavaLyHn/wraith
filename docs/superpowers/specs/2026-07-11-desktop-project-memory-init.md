# 桌面「项目记忆 WRAITH.md」生成(roadmap #8)

**日期:** 2026-07-11 **状态:** 设计定稿 **依赖:** roadmap #8;并入既有「记忆」面板(`2026-07-10-desktop-memory-viewer.md`)

## 目标

补齐 CLI 的 `/init [--force]` —— 桌面在「记忆」面板加一个「项目记忆 WRAITH.md」小节:显示 WRAITH.md 是否存在,一键**生成/重写**。WRAITH.md 会注入后续 system prompt 的 Project Context。

**放置决策**:不新增侧栏项(现已 8 个入口偏挤);WRAITH.md 是项目级记忆,并入「记忆」面板最贴题。

## 后端事实基线(已核验)

- `ProjectMemoryInitializer.initialize(Path root, boolean force) → InitResult(written, path, message)`(`cli/ProjectMemoryInitializer.java`)。**同步、模板式**(读 README.md/AGENTS.md 推断项目名/描述/dos/donts,**不调 LLM**);已存在且 !force → written=false。
- 与 AppServer Session 匿名类**同包**(`com.lyhn.wraith.cli`),可直接调用(package-private OK)。
- 现存 WRAITH.md 检测:`Files.exists(Path.of(getProjectPath()).resolve("WRAITH.md"))`。

## RPC 设计

- **扩展** `memory.list` 回包:加 `wraithMdExists`(bool)、`wraithMdPath`(string)—— 只读,面板加载即知状态,无副作用。
- **新增** `memory.initProject {force}` → `{ written, path, message }`。

**实现三处:**
1. `AppServer.Session`:加 `memoryInitProject(boolean force)` default。
2. `AppServer` dispatch:`memory.initProject` case(force 默认 false)。
3. `Main.java` 匿名类:`memoryList()` 补 wraithMd 两字段;新增 `memoryInitProject` 委托 `ProjectMemoryInitializer.initialize`。

## 桌面接线

- IPC `wraith:memoryInitProject`;preload `memoryInitProject(force)`。
- shared:`MemoryListResult` 补 `wraithMdExists?`/`wraithMdPath?`;新增 `ProjectMemoryInitResult { written, path, message }`。
- `MemoryPanel.tsx` 顶部加「项目记忆 WRAITH.md」小节:状态行(存在 ✓ / 未生成 + 路径)+ 按钮「生成」(不存在)或「重写」(存在→force,带确认)→ 结果 toast + 刷新。

## 测试隔离铁律

`memory.initProject` **会写工作区文件**(WRAITH.md);Java 侧不写单测(避免污染真实工作区),靠 mvn package + 眼验。桌面无新增纯函数(复用既有)。

## 验证

`mvn -q clean package` ✓ + 同步 `~/.wraith/wraith.jar` · typecheck · vitest 全绿 · build ✓ · 红线 CLEAN。手动:桌面重启 → 「记忆」→ WRAITH.md 小节 → 生成/重写。
