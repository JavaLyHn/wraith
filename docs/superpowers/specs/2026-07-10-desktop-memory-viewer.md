# 桌面「记忆查看」面板(roadmap #1)

**日期:** 2026-07-10 **状态:** 设计定稿,准备实现 **依赖:** roadmap `2026-07-10-desktop-cli-capability-gap-roadmap.md` #1

## 目标

补齐 CLI 的 `/memory list/search/delete` + `/save` —— 桌面新增「记忆」侧栏视图,可**查看**(列表 + 搜索)、**删除**单条、**手动保存**长期记忆。跨栈:Java 加 `memory.*` RPC → 桌面 IPC/preload → renderer 面板。

**范围裁定**:以「查看」为中心 + 删除(剪除陈旧记忆)+ 手动保存(补全回路)。**不做**批量清空(`/memory clear` 是脚枪,UI 不给一键;需要时逐条删)。

## 后端事实基线(已核验)

- `MemoryManager`(`memory/MemoryManager.java`):`listLongTerm()`、`searchLongTerm(query, limit)`、`deleteLongTerm(id)→boolean`、`storeFact(fact, scope)`、`getCurrentProject()`;scope ∈ `project|global`。
- `MemoryEntry`(`memory/MemoryEntry.java`):`getId/getContent/getType(枚举)/getTimestamp(Instant)/getMetadata/getTokenCount`;scope 存在 `metadata.get("scope")`。
- AppServer:dispatch `switch` 调 `session.xxx()`(`AppServer.java`);`Session` 是 `Main.java` app-server 引导里的匿名类,持 `Agent agent`,`agent.getMemoryManager()` 可用(1496/1584 已在用)。
- dispatch 惯用法:`if (session==null) error(-32000,"no session")` → `textParam(p,"k")` 取参 → `writer.result / writer.error` + `catch UnsupportedOperationException`。

## RPC 设计(4 个)

| method | params | result |
|---|---|---|
| `memory.list` | — | `{ project: string, entries: Entry[] }` |
| `memory.search` | `{ query }` | `{ project, entries }`(limit 50) |
| `memory.delete` | `{ id }` | `{ ok: boolean }` |
| `memory.save` | `{ fact, scope? }` | `{ ok: boolean }`(scope 默认 project) |

`Entry = { id, content, scope, type, timestampMs, tokenCount }`。

**实现三处:**
1. `AppServer.Session` 接口:加 4 个 `default` 方法(默认抛 `UnsupportedOperationException`)。
2. `AppServer` dispatch:加 4 个 case,照 skills 惯用法。
3. `Main.java` Session 匿名类:override 4 方法,用 `agent.getMemoryManager()`;私有 helper `memoryEntryJson(MemoryEntry)` 序列化(scope 从 metadata 取,type 用枚举名,timestamp→epochMilli)。

## 桌面接线

- IPC(`main/index.ts`):`wraith:memoryList/memorySearch/memoryDelete/memorySave` → `client.request('memory.*', …)`。
- preload:4 个方法。
- shared 类型:`MemoryEntryView { id; content; scope; type; timestampMs; tokenCount }`。

## UI(renderer)

- 侧栏新增视图 `'memory'`,图标 lucide `Brain`(1.5px 单色,对齐克制风)。
- `MemoryPanel.tsx`:
  - 挂载即 `memoryList`;顶部搜索框(输入即 `memorySearch`,空则回到 list)。
  - 条目卡:内容 + scope 徽标(`项目`/`全局`)+ 相对时间 + 删除按钮(确认后 `memoryDelete` → 刷新)。
  - 底部「添加记忆」输入 + scope 切换(项目/全局)→ `memorySave` → 清空刷新。
  - 空态:「暂无长期记忆。对话中 agent 会用 save_memory 自动记录,你也可在此手动添加。」

## 纯函数 + 测试(沿用既有范式)

`renderer/lib/memoryView.ts`:
- `scopeLabel(scope) → '项目' | '全局' | 原值`
- `relativeTime(timestampMs, nowMs) → '刚刚'/'N 分钟前'/'N 小时前'/'N 天前'/'YYYY-MM-DD'`
配 `desktop/test/memoryView.test.ts`。

## 测试隔离铁律

Java 侧 RPC 是薄委托,**不写触碰真实 memory store 的单测**(遵循企微事故教训),靠 `mvn compile`/`build` + 用户眼验。桌面纯函数走 vitest。

## 验证

`mvn -q clean package -DskipTests` 编译过 · typecheck · vitest 全绿 · build ✓ · 红线 CLEAN。手动:桌面重启(preload 改过)→ 侧栏「记忆」→ 列表/搜索/删除/保存四动作。
