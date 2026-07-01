# Wraith 桌面端 P3b(Electron 壳 + 较全流式 UI)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在同仓 `desktop/` 子目录建一个 Electron + React + TypeScript 桌面壳:spawn 并守护本地 `java -jar wraith.jar app-server` 子进程、用 JSON-RPC over stdio 与之通信,渲染较全的流式对话(markdown 正文 + 可折叠思考块 + 工具卡片实时 stdout/结果 + 最小审批弹窗 + 断连横幅 + 工作目录选择)。测试金字塔:纯模块 vitest 单测 + Playwright-electron GUI E2E(打确定性 mock 后端)。

**Architecture:**
```
┌──────────────── Electron ────────────────┐
│ Renderer (React/TS)   preload(contextBridge)   Main (Node/TS)        │
│  Transcript/ToolCard  ── window.wraith ──►  spawn+守护 java app-server │
│  ThinkingBlock         (typed IPC)           JsonRpcClient over child  │
│  ApprovalModal        ◄── events ───────     stdin/stdout (JSONL)      │
└───────────────────────────────────────────────────────────────────────┘
```
Renderer 永不直接碰子进程或 LLM;所有后端交互经 preload 暴露的 `window.wraith` IPC。Main 持有 `JsonRpcClient`,把后端通知经 IPC 推给 renderer,把 renderer 的动作(submit/approve/interrupt)转成 JSON-RPC 请求。**核心可测逻辑(JSON-RPC 编解码、通知→视图状态 reducer)抽成纯 TS 模块,与 Electron 解耦、vitest 覆盖。**

**Tech Stack:** Electron + React 18 + TypeScript + **electron-vite**(集成 Vite/HMR/构建)+ **vitest**(单测)+ **@playwright/test**(`_electron` GUI E2E)+ react-markdown(正文渲染)。包管理器 **npm**。

## Global Constraints

- 位置:同仓 **`desktop/`** 子目录;独立 npm 项目,**不进 Maven**。`node_modules/`、`desktop/out/`、`desktop/dist/`、Playwright 产物加入 `.gitignore`。
- **决策(已定)**:UI = 较全(markdown 正文 + 可折叠思考块 + 工具卡片实时输出 + 最小审批[允许/拒绝]+ 断连横幅 + 工作目录选择);验收 = 全自动 Playwright-electron GUI E2E(打 mock 后端)+ 纯模块 vitest;包管理器 = npm;基础守护(子进程退出/EOF → 断连横幅 + 重启入口,重启建新会话;`session.resume` 后端未实现,留后续)。
- **Renderer 隔离**:`contextIsolation: true`、`nodeIntegration: false`;renderer 只能通过 preload 的 `contextBridge` API 访问后端。**不得**在 renderer 直接 `require('child_process')` 或 spawn。
- **后端命令可配置**:Main spawn 的后端命令来自环境变量 `WRAITH_APPSERVER_CMD`(空格分隔)或默认 `java -jar <resolved wraith.jar> app-server`。测试用它注入 mock 后端。这样 GUI E2E 不依赖真 LLM。
- **协议契约以 spec §5 + 后端实际实现为准**(见下「协议事件目录」);字段名必须与后端 `EventStreamRenderer`/`AppServer` 完全一致。
- **不改 Java 后端**:P3b 纯前端 + 测试夹具;若发现后端缺口,记录留后续,不在本计划改 Java(P3a 已交付协议)。
- 富审批(改参/放行网络)、Monaco per-hunk diff、状态栏富化、diff 查看器、会话侧边栏、嵌入式终端、打包分发 —— 归 **P4/P5**,不在 P3b。
- P2 遗留 **I1**(`sandbox.unavailable` 事件):后端目前不发该事件(P3a 未加);P3b 的 reducer 预留处理位,但真正发事件需后端改动,归后续。P3b 只需在 UI 侧对未知通知**安全忽略**。

## 协议事件目录(后端 → 壳,notification;字段精确)

来自 `EventStreamRenderer`/`AppServer`,每条通知 params 均含 `sessionId`、`turnId`(除 initialize/session 级):

| method | params | 用途 |
|---|---|---|
| `turn.started` | `{sessionId, turnId}` | 轮开始 |
| `thinking.begin` | `{…, label}` | 思考块开始 |
| `thinking.delta` | `{…, text}` | 思考增量 |
| `thinking.end` | `{…}` | 思考结束 |
| `message.delta` | `{…, text}` | 正文增量(累加渲染 markdown) |
| `message.end` | `{…}` | 正文结束 |
| `tool.call` | `{…, callId, name, argsJson}` | 工具调用卡片 |
| `tool.output.delta` | `{…, callId, stream, chunk}` | 命令实时输出(按 callId 归卡) |
| `tool.result` | `{…, callId, ok, exitCode}` | 工具卡片收尾 |
| `diff` | `{…, file, before, after}` | 文件 diff(P3b 仅存,不渲染富 diff) |
| `todos` | `{…, items}` | 待办(P3b 可选简单列出) |
| `status` | `{…, status}` | 状态(P3b 可忽略/简单显示) |
| `approval.requested` | `{…, approvalId, toolName, argsJson, dangerLevel, riskDescription, suggestion}` | 审批弹窗 |
| `turn.completed` | `{…, status}` | 轮完成 |
| `turn.failed` | `{…, error}` | 轮失败 |

请求(壳 → 后端):`initialize {clientInfo, workspaceDir}` → `{serverInfo, protocol, model, capabilities}`;`session.start {workspaceDir}` → `{sessionId}`(无效目录 -32602);`turn.submit {sessionId, input}` → `{turnId, status}`(进行中再 submit → -32000);`approval.respond {approvalId, decision}`(decision ∈ APPROVED/REJECTED/…);`turn.interrupt {sessionId, turnId}`;`shutdown {}`.

## IPC 契约(preload 暴露 `window.wraith`)

```ts
interface WraithApi {
  initialize(workspaceDir: string | null): Promise<InitializeResult>;
  startSession(workspaceDir: string | null): Promise<{ sessionId: string }>;
  submitTurn(input: string): Promise<{ turnId: string; status: string }>;
  respondApproval(approvalId: string, decision: 'APPROVED' | 'REJECTED'): Promise<void>;
  interrupt(): Promise<void>;
  pickWorkspace(): Promise<string | null>;   // 原生目录选择对话框
  restartBackend(): Promise<void>;
  onEvent(cb: (evt: BackendEvent) => void): () => void;   // 后端通知 + 连接状态
}
// BackendEvent = { kind: 'notification', method: string, params: any }
//              | { kind: 'connection', state: 'connected' | 'disconnected' }
```

## 视图状态(reducer 目标)

```ts
type ToolCard = { callId: string; name: string; argsJson: string; output: string; ok?: boolean; exitCode?: number; done: boolean };
type Item = { type: 'message'; text: string } | { type: 'thinking'; label: string; text: string; done: boolean } | { type: 'tool'; card: ToolCard };
interface TranscriptState {
  items: Item[];              // 按到达顺序(message 累加到当前 assistant 气泡)
  pendingApproval: { approvalId: string; toolName: string; argsJson: string; dangerLevel: string; riskDescription: string } | null;
  turn: 'idle' | 'running';
  connection: 'connected' | 'disconnected';
  model: string;
}
function reduce(state: TranscriptState, evt: BackendEvent): TranscriptState  // 纯函数
```

---

## 文件结构(全部在 `desktop/`)

```
desktop/
  package.json                     # 依赖 + scripts(dev/build/test/e2e)
  electron.vite.config.ts          # electron-vite:main/preload/renderer 三段
  tsconfig.json / tsconfig.node.json
  .gitignore                       # node_modules out dist playwright-report test-results
  playwright.config.ts             # _electron GUI E2E 配置
  src/
    main/index.ts                  # Main:窗口 + spawn/守护 + JsonRpcClient + IPC handlers
    main/backend.ts                # spawn 后端命令解析(WRAITH_APPSERVER_CMD / 默认 jar)
    preload/index.ts               # contextBridge 暴露 window.wraith
    shared/jsonRpcClient.ts        # 纯 TS:JSONL 编解码 + 请求响应 + 通知 EventEmitter
    shared/transcriptReducer.ts    # 纯 TS:BackendEvent → TranscriptState
    shared/types.ts                # 共享类型(BackendEvent/Item/…)
    renderer/index.html
    renderer/main.tsx              # React 挂载
    renderer/App.tsx               # 顶层:IPC 订阅 + reducer + 布局
    renderer/components/Transcript.tsx
    renderer/components/ToolCard.tsx
    renderer/components/ThinkingBlock.tsx
    renderer/components/ApprovalModal.tsx
    renderer/components/DisconnectedBanner.tsx
  test/
    jsonRpcClient.test.ts          # vitest
    transcriptReducer.test.ts      # vitest
    backend.test.ts                # vitest(命令解析)
    fixtures/mock-appserver.mjs    # 确定性 JSON-RPC mock 后端(Playwright 用)
    e2e/shell.e2e.ts               # Playwright-electron GUI E2E
  ../.gitignore                    # 根 .gitignore 追加 desktop 忽略项
```

---

## Task 1: 脚手架 `desktop/`(electron-vite + React + TS + vitest + playwright)

**Files:** `desktop/package.json`, `electron.vite.config.ts`, `tsconfig*.json`, `.gitignore`, `playwright.config.ts`, 最小 `src/main/index.ts` / `src/preload/index.ts` / `src/renderer/{index.html,main.tsx,App.tsx}`,根 `.gitignore` 追加。

**Interfaces:** Produces:可 `npm install && npm run build`(typecheck 过)、`npm test`(vitest 空跑过)、`npm run dev` 能起窗口的基线工程。

- [ ] **Step 1: 写 `desktop/package.json`**

```json
{
  "name": "wraith-desktop",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run",
    "e2e": "npm run build && playwright test"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-markdown": "^9.0.1"
  },
  "devDependencies": {
    "@playwright/test": "^1.47.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "electron": "^32.0.0",
    "electron-vite": "^2.3.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: 写 config 文件**

`electron.vite.config.ts`:
```ts
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  main: { build: { rollupOptions: { input: 'src/main/index.ts' } } },
  preload: { build: { rollupOptions: { input: 'src/preload/index.ts' } } },
  renderer: {
    root: 'src/renderer',
    build: { rollupOptions: { input: 'src/renderer/index.html' } },
    plugins: [react()]
  }
})
```
`tsconfig.json`(strict、bundler 模式、jsx react-jsx、包含 src+test);`tsconfig.node.json`(config 用)。`.gitignore`(desktop 内):`node_modules`、`out`、`dist`、`playwright-report`、`test-results`、`.vite`。
`playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './test/e2e',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']]
})
```
根 `.gitignore` 追加:
```
desktop/node_modules/
desktop/out/
desktop/dist/
desktop/playwright-report/
desktop/test-results/
```

- [ ] **Step 3: 最小 main/preload/renderer 骨架**

`src/main/index.ts`:创建 `BrowserWindow`(`contextIsolation:true, nodeIntegration:false, preload`),开发加载 `process.env.ELECTRON_RENDERER_URL`,生产加载打包 html。`src/preload/index.ts`:`contextBridge.exposeInMainWorld('wraith', { ping: () => 'pong' })`(Task 4 再填全)。`src/renderer/App.tsx`:渲染 `<h1>Wraith</h1>`。`main.tsx` 挂载。`index.html` 引 `main.tsx`。

- [ ] **Step 4: 装依赖 + 验证基线**

Run(from `desktop/`):
```bash
npm install
npm run typecheck
npm run build
```
Expected:install 成功(Electron 下载完成);typecheck 0 error;build 产出 `out/`。若 electron-vite 版本 API 有出入,以 `npx electron-vite build` 的报错为准微调 config(记录到 report)。

- [ ] **Step 5: 提交**
```bash
cd /Users/aa00945/Desktop/wraith
git add desktop/ .gitignore
git commit -m "feat(desktop): P3b 脚手架 electron-vite+React+TS(可 build)"
```
(注:`desktop/node_modules` 已被 .gitignore 排除;提交前 `git status` 确认无 node_modules 入库。)

---

## Task 2: `jsonRpcClient.ts`(纯 TS,JSONL 编解码 + 请求/响应 + 通知)

**Files:** `src/shared/jsonRpcClient.ts`, `src/shared/types.ts`;Test: `test/jsonRpcClient.test.ts`.

**Interfaces:** Produces:
```ts
class JsonRpcClient {
  constructor(writeLine: (line: string) => void);
  handleLine(line: string): void;                 // 喂入一行(main 从子进程 stdout 逐行调用)
  request(method: string, params: object): Promise<any>;   // 发请求,按 id 关联响应
  onNotification(cb: (method: string, params: any) => void): () => void;
  rejectAll(reason: string): void;                // 子进程断开时清理挂起请求
}
```
框架:每行一个 JSON;request 递增 id、存 pending map、writeLine 发出;handleLine 解析——有 id+result/error → resolve/reject 对应 pending;有 method(无 id 或通知)→ 派发 onNotification;畸形行忽略。

- [ ] **Step 1: 写 vitest 失败测试** `test/jsonRpcClient.test.ts`(要点):
  - `request` 写出的行是合法 JSON-RPC(jsonrpc/id/method/params);喂入匹配 id 的 result 行 → promise resolve 该 result;喂入 error 行 → reject。
  - 喂入 notification 行(有 method 无匹配 id)→ onNotification(method, params) 被调。
  - 畸形行(非 JSON)→ 不抛、不影响后续。
  - `rejectAll` → 所有挂起 request reject。
  用一个数组捕获 writeLine 输出;手动 handleLine 构造响应。
- [ ] **Step 2: 跑 `npx vitest run test/jsonRpcClient.test.ts` → RED(模块不存在)。**
- [ ] **Step 3: 实现 `jsonRpcClient.ts` + `types.ts`。** 纯 TS,无 Electron/node 依赖(仅用 JSON、Map、Promise)。
- [ ] **Step 4: 跑 vitest → GREEN。**
- [ ] **Step 5: 提交** `git commit -m "feat(desktop): JsonRpcClient JSONL 编解码 + 请求/通知(vitest)"`

---

## Task 3: `transcriptReducer.ts`(纯 TS,通知 → 视图状态)

**Files:** `src/shared/transcriptReducer.ts`;Test: `test/transcriptReducer.test.ts`.

**Interfaces:** `initialState: TranscriptState`;`reduce(state, evt: BackendEvent): TranscriptState`(纯、不可变更新)。映射规则:
- `connection` 事件 → 更新 connection;`disconnected` 时 turn 归 idle。
- `turn.started` → turn='running';`turn.completed`/`turn.failed` → turn='idle'。
- `message.delta` → 追加/累加到当前 message item 的 text;`message.end` → 封口当前 message(下条 message.delta 起新气泡)。
- `thinking.begin` → 新 thinking item(label, text='', done=false);`thinking.delta` → 累加 text;`thinking.end` → done=true。
- `tool.call` → 新 tool item(ToolCard: callId/name/argsJson, output='', done=false)。
- `tool.output.delta` → 找 callId 对应 card,`output += chunk + '\n'`。
- `tool.result` → 该 card ok/exitCode/done=true。
- `approval.requested` → pendingApproval 置为该请求;审批被应答由 UI 调用后单独 `clearApproval`(或 reduce 一个合成事件)——本 reducer 提供 `clearApproval(state)`。
- 未知 method → 原样返回(安全忽略)。
- initialize 的 model → `setModel(state, model)`。

- [ ] **Step 1: 写 vitest 失败测试**(要点,每条断言一个映射):
  - 连续两条 message.delta 累加到同一气泡;message.end 后再来 delta 起新气泡。
  - thinking.begin/delta/delta/end → 一个 thinking item,text 累加,done=true。
  - tool.call 后多条 tool.output.delta 按 callId 累加到同一卡;tool.result 置 ok/exitCode/done。
  - 两个不同 callId 的 tool.output.delta 各归各卡(不串)。
  - approval.requested → pendingApproval 有值;clearApproval → 归 null。
  - turn.started/completed 切换 turn;connection disconnected → turn idle。
  - 未知 method → 状态不变(引用可不同但内容相等)。
- [ ] **Step 2: `npx vitest run test/transcriptReducer.test.ts` → RED。**
- [ ] **Step 3: 实现 reducer(不可变更新;辅助 `clearApproval`/`setModel`/`initialState`)。**
- [ ] **Step 4: vitest → GREEN。**
- [ ] **Step 5: 提交** `git commit -m "feat(desktop): transcriptReducer 通知→视图状态(vitest)"`

---

## Task 4: Main 进程 + preload(spawn/守护 + JsonRpcClient + IPC)

**Files:** `src/main/index.ts`, `src/main/backend.ts`, `src/preload/index.ts`;Test: `test/backend.test.ts`.

**Interfaces:**
- `backend.ts`:`resolveBackendCommand(env: NodeJS.ProcessEnv, defaultJar: string): { cmd: string; args: string[] }` —— `env.WRAITH_APPSERVER_CMD` 存在则空格拆分,否则 `{cmd:'java', args:['-jar', defaultJar, 'app-server']}`。纯函数,vitest 覆盖。
- `main/index.ts`:spawn 该命令;把 child.stdout 按行喂 `JsonRpcClient.handleLine`;`client.onNotification` → `mainWindow.webContents.send('wraith:event', {kind:'notification',method,params})`;child `exit`/`error` → send `{kind:'connection',state:'disconnected'}` + `client.rejectAll`。IPC handlers(`ipcMain.handle`):`wraith:initialize/startSession/submitTurn/respondApproval/interrupt/pickWorkspace/restartBackend` → 调 `client.request(...)` 或 `dialog.showOpenDialog`/重启。
- `preload/index.ts`:`contextBridge.exposeInMainWorld('wraith', WraithApi)`,每个方法 `ipcRenderer.invoke(...)`;`onEvent` 用 `ipcRenderer.on('wraith:event', ...)` 返回取消订阅。

- [ ] **Step 1: 写 `test/backend.test.ts`(vitest)**:`resolveBackendCommand` 两分支(有/无 WRAITH_APPSERVER_CMD;含多参数的拆分)。
- [ ] **Step 2: vitest → RED。**
- [ ] **Step 3: 实现 backend.ts + main/index.ts + preload/index.ts。** main 的 spawn/IPC 逻辑不在 vitest 覆盖(由 Task 6 Playwright E2E 验证);backend.ts 纯函数覆盖。基础守护:child 退出即发 disconnected;`restartBackend` 重新 spawn 并(由 renderer)重跑 initialize/startSession。
- [ ] **Step 4: vitest → GREEN;`npm run typecheck` 过;`npm run build` 过。**
- [ ] **Step 5: 提交** `git commit -m "feat(desktop): Main spawn/守护 + JsonRpcClient 接线 + preload IPC"`

---

## Task 5: Renderer React UI(较全:markdown 正文 + 思考块 + 工具卡片 + 审批 + 断连 + 工作目录)

**Files:** `src/renderer/App.tsx` + `components/{Transcript,ToolCard,ThinkingBlock,ApprovalModal,DisconnectedBanner}.tsx`.

**Interfaces:** App 启动:`onEvent` 订阅 → 每个 event 经 `reduce` 更新 state(useReducer over transcriptReducer);启动流程:`pickWorkspace()`(或默认)→ `initialize` → `startSession` → 就绪。输入框回车 → `submitTurn`;运行中禁用/显示中断。审批弹窗 → `respondApproval`。断连横幅 → `restartBackend`。

组件要点(TDD 由 Task 6 Playwright 覆盖 DOM;本任务实现 + 通过 typecheck/build,不单独写组件单测):
- `Transcript`:遍历 `items`。message → `<ReactMarkdown>`;thinking → `<ThinkingBlock>`;tool → `<ToolCard>`。
- `ThinkingBlock`:可折叠(`<details>` 或按钮 toggle),显示 label + 累加 text;done 前显示"思考中"。**给可测的 `data-testid="thinking"`、折叠触发 `data-testid="thinking-toggle"`。**
- `ToolCard`:显示 name + argsJson(命令)+ `<pre data-testid="tool-output">` 实时 output + 收尾徽标(ok/exitCode)。`data-testid="tool-card"`。
- `ApprovalModal`:pendingApproval 非空时模态,显示 toolName/argsJson/dangerLevel/riskDescription + 允许/拒绝按钮(`data-testid="approve"`/`"reject"`)。
- `DisconnectedBanner`:connection==='disconnected' 时显示 + 重启按钮(`data-testid="restart"`)。
- 视觉沿用克制科技感(冷灰、发丝边框、JetBrains Mono);为 E2E 稳定,关键节点带 `data-testid`。

- [ ] **Step 1: 实现所有组件 + App 接线。**（本任务无单独单测;gate 是 typecheck + build，行为验证在 Task 6。）
- [ ] **Step 2: `npm run typecheck` + `npm run build` 过。**
- [ ] **Step 3: 提交** `git commit -m "feat(desktop): React UI(markdown/思考块/工具卡片/审批/断连)"`

---

## Task 6: 确定性 mock 后端 + Playwright-electron GUI E2E

**Files:** `test/fixtures/mock-appserver.mjs`, `test/e2e/shell.e2e.ts`.

**mock-appserver.mjs:** 纯 Node,读 stdin JSON-RPC 行,按 method 回响应并吐预设通知序列(无 LLM):
- `initialize` → result `{serverInfo:'mock', protocol:'1', model:'mock-model', capabilities:{}}`。
- `session.start` → `{sessionId:'sess_mock'}`。
- `turn.submit` → result `{turnId:'turn_1', status:'running'}`,随后**按固定节奏**吐:`turn.started` → `thinking.begin/delta("想一下")/end` → `message.delta("Hello ")`/`message.delta("**world**")`/`message.end` → `tool.call{callId:'c1',name:'execute_command',argsJson:'{"command":"echo hi"}'}` → `approval.requested{approvalId:'a1',toolName:'execute_command',...}`(等待 approval.respond)→ 收到 respond 后 `tool.output.delta{callId:'c1',stream:'stdout',chunk:'hi'}` → `tool.result{callId:'c1',ok:true,exitCode:0}` → `turn.completed`。
- `approval.respond` → result `{ok:true}` 并推进上面的序列。
- `shutdown` → `{ok:true}` 后退出。
（用 `WRAITH_APPSERVER_CMD="node <abs path>/mock-appserver.mjs"` 注入。）

**shell.e2e.ts(Playwright `_electron`):** 
```ts
import { test, expect, _electron as electron } from '@playwright/test'
```
- launch Electron(`electron.launch({ args: ['out/main/index.js'], env: { ...process.env, WRAITH_APPSERVER_CMD: 'node ' + mockPath } })`),`firstWindow()`。
- 触发一轮(若 App 启动即自动 initialize/startSession;E2E 里在输入框输入并回车 submit)。断言:
  - 正文 markdown 渲染:页面出现 `world` 且为 `<strong>`(markdown 加粗)。
  - 思考块存在(`data-testid="thinking"`),可折叠。
  - 工具卡片出现(`data-testid="tool-card"`,含命令 `echo hi`)。
  - 审批弹窗出现(`data-testid="approve"`);点"允许"后,工具卡片 `data-testid="tool-output"` 出现 `hi`,收尾徽标显示 exit 0。
  - turn 结束回到 idle。
- 第二个用例:mock 支持一个 `--disconnect-after-init` 变体或收到特定输入后进程退出 → 断言断连横幅(`data-testid="restart"`)出现。

- [ ] **Step 1: 写 mock-appserver.mjs + shell.e2e.ts。**
- [ ] **Step 2: `npm run build` 后跑 `npx playwright test` → 迭代到 GREEN。**（Playwright-electron 首次需确保能无头拉起 Electron;若环境需要,记录所需 flag。若某断言因时序 flaky,用 Playwright 的 `expect(...).toBeVisible()` 自动等待而非固定 sleep。）
- [ ] **Step 3: 提交** `git commit -m "test(desktop): mock 后端 + Playwright-electron GUI E2E"`

---

## Task 7: dev 脚本打磨 + 真后端接线 + README + 交付

**Files:** `desktop/README.md`,必要的 `backend.ts` 默认 jar 路径解析(定位 `~/.wraith/wraith.jar`)。

- [ ] **Step 1: 默认后端 jar 解析** —— `resolveBackendCommand` 默认用 `~/.wraith/wraith.jar`(`os.homedir()`);若不存在,main 启动即发 disconnected + 提示"未安装 wraith.jar"。加 vitest 覆盖默认路径含 `.wraith/wraith.jar`。
- [ ] **Step 2: README** —— 记录 `npm install` / `npm run dev`(真后端)/ `npm test`(vitest)/ `npm run e2e`(Playwright)/ `WRAITH_APPSERVER_CMD` 覆盖。
- [ ] **Step 3: 全量前端测试** `npm test && npm run e2e` 全绿;`npm run typecheck` 0 error。
- [ ] **Step 4: 提交** `git commit -m "docs(desktop): README + 默认 jar 解析 + 交付"`
- [ ] **Step 5: Controller 手动真后端验收(合并前,非子代理):** `npm run dev`,真 `java app-server` 起,选一个工作目录,发一句让模型跑命令的话,肉眼确认:markdown 正文流式、思考块、工具卡片实时 stdout + 结果、审批弹窗允许/拒绝生效、断连横幅(手动 kill java 触发)。记录结果。

---

## 分期收尾说明
- P3b 完成 = spec §6 的 v1 壳落地(较全流式 UI + 最小审批 + 守护)。
- 归 **P4**:Monaco per-hunk diff、富审批(改参/放行网络)、状态栏富化、diff 查看器、P2 的 I1(`sandbox.unavailable`,需后端加事件)、`session.resume`(需后端)。归 **P5**:打包分发(electron-builder + jpackage 裁剪 JRE + 签名)。

## Self-Review(计划自查)
- **spec 覆盖**:§6.1 Main spawn/守护/JSON-RPC client → Task 4;§6.2 transcript/思考块/工具卡片/审批 → Task 5(+markdown 决策);§6.3 UI 栈 → Task 1;§8 Electron 冒烟 → 升级为 Playwright GUI E2E(Task 6,用户选)。
- **契约一致性**:协议事件字段名与后端 EventStreamRenderer 逐一对齐(callId/stream/chunk/ok/exitCode/approvalId/…);IPC 契约与 reducer 视图状态在 Task 2/3/4/5 间签名一致。
- **测试策略**:纯模块 vitest(Task 2/3/4)+ Playwright GUI E2E 打确定性 mock(Task 6)+ 真后端手动(Task 7)——不拿真 LLM 跑自动化。
- **隔离/安全**:contextIsolation + preload,renderer 不碰子进程。
- **无占位**:关键模块(client/reducer/backend/mock/e2e)给了行为契约与测试要点;框架样板(config/组件 JSX)给结构 + 关键节点(data-testid),由实现者在标准栈内补全,tests 作为门。
