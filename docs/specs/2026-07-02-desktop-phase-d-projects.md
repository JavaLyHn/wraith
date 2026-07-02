# Wraith 桌面端 Phase D：项目工作区 设计 spec

> 日期:2026-07-02 · 前置:Phase C 已合并(b6d6447) · 决策人:LyHn
> 形态决策:项目列表 + 单活跃切换;项目切换器(Popover);切换自动恢复最近会话;
> 管理操作 = 添加/移出/重命名别名/最近使用排序;Composer「重选目录」保留但汇流。

## 0. 背景与关键事实

- 后端 `session.start {workspaceDir}` 已支持任意目录(校验非目录报 -32602),`SessionStore`
  按 workspace 路径 hash 隔离落盘——**多项目的存储地基已在,Java 侧本阶段零改动**。
- `SessionStore.list()` 按 `updatedAt` 倒序(`SessionStore.java:162`),第一条即最近会话,
  「切换自动恢复最近会话」纯前端可做。
- `SessionStore.persist()` 跳过 system-only 历史:切换项目时 `session.start` 建的空会话
  若用户没发消息,不会落盘残留垃圾文件。
- 现状缺口:`settings.json` 只记 **一个** `workspace`;侧栏「项目」是禁用占位;
  Composer「重选目录」(`pickWorkspace`)选完只 persist 不入任何列表。

## 1. 目标与非目标

### 1.1 目标(Phase D 交付)

1. **项目列表持久化**:`settings.json` 新增 `projects` 数组(路径/别名/lastUsedAt),
   打开过的目录都被记住,按最近使用倒序。
2. **项目切换器**:侧栏 logo 下方 `📁 项目名 ▾` 按钮 + Popover 面板(列表 + ＋添加项目)。
3. **切换 = 激活 + 自动恢复**:点击项目 → 该目录开新 session → 有历史则 resume 最近一条,
   无历史落欢迎空态;会话列表跟着换。
4. **管理操作**:移出列表(无损,单击生效)、重命名别名(内联输入)、最近使用自动排序。
5. **入口汇流**:Composer「重选目录」保留,但选中目录同样进项目列表并激活(同一条代码路)。
6. **迁移**:老用户首启动用现有 `workspace` 播种列表,无感升级。

### 1.2 关键约束(沿用)

- **Java 后端零改动、协议零新增**(跨阶段红线的本阶段特化)。
- 单活跃:同一时刻只有一个项目在跑;turn running 时切换被守卫忽略(同现有惯例)。
- 密钥永不入库;`.superpowers/sdd/` 不入库;测试金字塔沿用(vitest 纯函数 + Playwright E2E)。

### 1.3 非目标(推迟)

- 多窗口/多活跃并行(形态决策已排除)。
- 跨项目会话搜索、树形「项目包会话」视图(需要后端跨工作区 session.list,Phase E 后再议)。
- 项目级配置(每项目模型/审批模式记忆)。

## 2. 架构

所有权:**Electron main 持有项目列表**(`settings.json`,与现有 `workspace` 同文件),
renderer 纯展示。方案对比时排除了 renderer localStorage(持久化裂成两处、无法 fs 校验)
和后端 `~/.wraith/projects.json`(纯 UI 偏好推进协议层,YAGNI)。

```
renderer ProjectSwitcher ──IPC──▶ main settings.ts(纯函数) ──▶ userData/settings.json
        │ 激活成功后
        └─▶ 既有链路:session.start {workspaceDir} → session.list → session.resume(最近)
```

## 3. 数据模型与迁移(`desktop/src/main/settings.ts`)

```ts
export interface ProjectEntry {
  path: string        // 绝对路径,唯一键(去重依据)
  name?: string       // 显示别名;缺省 UI 用 baseName(path)
  lastUsedAt: number  // epoch ms,驱动最近使用排序
}
export interface Settings {
  workspace?: string        // 现有字段语义不变:当前活跃项目
  projects?: ProjectEntry[]
}
```

新增纯函数(全部注入 `userDataDir`;时间由调用方注入 `now` 以便单测):

- `upsertProject(userDataDir, path, now)`:按 path 去重,刷 `lastUsedAt=now`;新条目 append。
- `removeProject(userDataDir, path)`:仅移出数组;磁盘目录与 `~/.wraith` 会话历史不动。
- `renameProject(userDataDir, path, name)`:`name.trim()`;空串删除 `name` 字段(回退目录名)。
- `projectViews(userDataDir): ProjectView[]`:读取 + 按 `lastUsedAt` 倒序 + 逐条附
  `exists: boolean`(`fs.statSync` isDirectory,异常算 false)。**不过滤失踪条目**——
  外置盘拔了目录暂时不在,静默过滤会让列表"莫名少一个";UI 置灰由 `exists` 驱动。

迁移(main 启动时执行一次):`projects` 为空 **且** `resolvePersistedWorkspace` 非 null
→ `upsertProject(workspace)`。workspace 无效则不播种(列表空,首次添加时再进)。

## 4. Electron main IPC 与 preload API

| IPC(preload 方法名同名去前缀) | 行为 |
|---|---|
| `wraith:listProjects` → `{ projects: ProjectView[] }` | `projectViews()` 直出 |
| `wraith:activateProject(path)` → `{ ok: boolean }` | 目录不存在/非目录 → `{ok:false}`(不 throw);否则 `upsertProject` + `persistWorkspace(path)` → `{ok:true}` |
| `wraith:addProject()` → `string \| null` | 弹目录选择框(defaultPath=当前 workspace);取消 → null;选中 → 内部走 activateProject 同一 upsert+persist 路径,返回 path。E2E:复用 `WRAITH_E2E_PICK`(unset→null) |
| `wraith:removeProject(path)` → `void` | `removeProject()` |
| `wraith:renameProject(path, name)` → `void` | `renameProject()` |

- **`wraith:pickWorkspace` 退役删除**:Composer「重选目录」按钮保留,但 renderer 改调
  `addProject()` + 统一切换流,旧 IPC 无调用方后移除(preload/`WraithApi`/E2E 同步更新)。
- E2E 注入:`WRAITH_E2E_PROJECTS`(JSON 数组,`ProjectEntry[]`)存在时,main 启动**播种式**
  写入 settings.json 作初始状态(此时跳过 §3 迁移),之后读写全走正常路径——这样移出/重命名
  用例能观察到列表真实变化;exists 仍按真实 fs 判(E2E 的 userData 是临时目录)。

## 5. 前端(desktop/renderer)

### 5.1 ProjectSwitcher.tsx(新组件)

- 触发钮:`📁 {name ?? baseName(path)} ▾`,truncate,`title` 全路径,`data-testid="project-switcher"`。
- 面板:Radix Popover(**新依赖 `@radix-ui/react-popover`**,与现有 tooltip 同族);
  列表条目 `data-testid="project-item"`:名称 + ✓(当前) + `title` 全路径;
  `exists=false` 置灰禁点(title 提示「目录不存在」);
  hover 露两图标钮:重命名(`project-rename`,内联输入,Enter 提交/Esc 取消,
  复用 UserMessage 编辑模式手法)、移出(`project-remove`,单击生效——无损操作不做二次确认);
  **当前活跃项目的移出钮禁用**(避免"我现在在哪"空悬);
  底部「＋ 添加项目…」(`project-add`)。
- busy(turn running)时:条目激活被守卫忽略且置灰;**添加钮禁用**(添加成功会触发切换);
  重命名/移出不受限(纯 settings 操作,不碰运行中的会话)。

### 5.2 App.tsx 切换流

```
switchToProject(path):
  state.turn === 'running' → return
  activateProject(path) → ok:false → fetchProjects()(条目置灰)后 return
  startSession(path) → dispatch resetSession(ws=path)
  fetchSessions() 取回该项目会话列表
    非空 → 复用 handleSelectSession(第一条)   // resume + loadHistory + markStarted
    空   → 停在欢迎空态
  fetchProjects()(排序浮顶)
```

- `handleAddProject`:`addProject()` 非 null → `switchToProject(path)`。
  Composer「重选目录」onSwitchWorkspace 改指向 `handleAddProject`(旧 `handleSwitchWorkspace` 删除)。
- projects 状态放 App(`useState<ProjectView[]>`),启动 effect 与每次切换后 `fetchProjects()`。
- 启动/重连 effect 不动(已读 `state.workspace`)。

### 5.3 Sidebar.tsx

- logo 行下方插 `<ProjectSwitcher …/>`;NAV 数组删除 `projects` 占位项(Phase D 兑现)。
- footer 删 `📁 目录名` 行(与切换器重复);sandbox 徽标保留。

## 6. 数据流(端到端,mock 与真后端一致)

1. 启动:migration 播种 → `listProjects` → 切换器显示当前 workspace 对应条目。
2. 点击项目 B → `activateProject` 落盘 → `session.start {workspaceDir:B}`(后端建新 runner,
   SessionStore 指向 B 的 hash 目录)→ `session.list` 返回 B 的历史 → `session.resume` 最近一条
   → transcript 静态回放;Composer/status chip 复位(resetSession 既有语义)。
3. 下轮 `turn.submit` 即在 B 内跑,持久化进 B 的 SessionStore。

## 7. 错误处理

- `activateProject` 遇目录失踪:返回 `{ok:false}`,renderer 仅刷项目列表(条目置灰),
  不弹窗不 toast(与现有 console.error 惯例一致)。
- `startSession` 对失踪目录的兜底(list 与点击之间目录被删的竞态):后端本就报
  `-32602 workspaceDir 不是有效目录`,renderer catch 后 console.error + 刷项目列表,状态不变。
- settings.json 读写:沿用现有 best-effort(坏 JSON → `{}`,写失败吞掉不崩)。
- 重命名提交空串:清别名回目录名(不是报错)。

## 8. 测试策略

- **vitest(settings 纯函数,@TempDir 式临时目录)**:upsert 去重/刷时间戳、remove、
  rename(含空串清除)、projectViews 排序与 exists、迁移播种(workspace 有效/无效两分支)、
  坏 JSON 回退。组件行为不上 vitest,归 E2E。
- **Playwright E2E(mock 后端,续 T21 编号)**:
  - T22 切换器:`WRAITH_E2E_PROJECTS` 注入两项目 → 打开面板列出;点击项目 B → record
    `session.start` 带 B 的 workspaceDir → 自动 resume:transcript 出现 B 的回放消息。
  - T23 空项目切换 → 欢迎空态(mock 对该 workspace 返回空 list)。
  - T24 重命名内联提交后列表显示别名;移出后列表少一条。
  - T25 running 中(MOCK_SLOW_TURN)点击项目条目被忽略(record 无新 session.start)。
  - 既有走 `WRAITH_E2E_PICK` 的用例改走 addProject 路径,断言不变。
- **mock-appserver 小改**:`session.start` 记住 workspaceDir;`session.list` 按最近一次
  workspaceDir 返回不同列表,数据来自 env `MOCK_SESSIONS_BY_WS`(JSON map:
  `{ [workspaceDir]: SessionMeta[] }`,未命中的 workspace 返回空数组;env 未设时维持现状)。
- **Java**:零改动零新测;合并前全量回归(`-DskipTests=false`)确认 3F/38E 基线不动。

## 9. 范围边界(红线)

- 不动 Java/协议;不动 transcriptReducer(resetSession/loadHistory 既有 action 够用)。
- 不做项目级配置、跨项目搜索、树形视图、多窗口。
- 不动沙箱/审批链路。

## 10. 风险与开放问题

- **Radix Popover 新依赖**:与既有 @radix-ui/react-tooltip 同族同版本线,风险低。
- **auto-resume 的取舍**:恢复"最近"依赖 `session.list` 排序,已核实按 updatedAt 倒序;
  若该项目最近会话很长,静态回放即 Phase B 既有路径,无新增性能面。
- **待眼验(真后端)**:两真实目录来回切,验证会话隔离 + 自动恢复 + `~/.wraith/sessions/<hash>`
  不串;沿用「重建 jar 前先征求同意」流程。
