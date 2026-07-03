# Task 12 实施报告:B5 严格并发1——旧子进程退净后再 fire

## 实施日期
2026-07-03

## 改动摘要

### Step 1: AutomationRunner.exited Promise

**文件:** `desktop/src/main/automationRunner.ts`

新增两个字段:
```ts
private exitedResolve: (() => void) | null = null
readonly exited: Promise<void> = new Promise(res => { this.exitedResolve = res })
```

`proc.on('exit')` 回调首行:
```ts
this.exitedResolve?.(); this.exitedResolve = null
```

`proc.on('error')` 回调重构为显式函数体并首行:
```ts
this.exitedResolve?.(); this.exitedResolve = null
```

**幂等机制:** `exitedResolve` 置 null 后后续调用 `?.()` 为 no-op,两条路径(exit/error)不会双重 resolve。

**未调用 run() 时的行为:** `exited` promise 永不 resolve(Promise 构造但 exitedResolve 从不触发) ——调用方只在 run() 后使用,符合规范。

### Step 2: AutomationScheduler.fire() 尾链改造

**文件:** `desktop/src/main/automationScheduler.ts`

旧:
```ts
}).finally(() => {
  this.current = null
  this.drainQueue()
})
```

新:
```ts
}).finally(() => {
  // B5: 终态(settle)后等子进程真正退净(SIGKILL 升级 ≤2s 兜底),保证任意时刻至多一个自动化子进程
  void runner.exited.then(() => {
    this.current = null
    this.drainQueue()
  })
})
```

### current 占位期语义推演

`run()` settle(终态)后、`runner.exited` resolve 前存在窗口(SIGTERM 忽略子进程情况下约 2s):
- `this.current` 保持非 null → `runNow()` 检测 `this.current` → 拒绝重复(返回 `{ ok: false }`)
- `activeTaskIds()` 从 `this.current.taskId` 取活跃任务 → `decideTick()` 视为 active → 调度侧 miss 而非再排队
- `tick()` 兜底 drain 的 `!this.current` 守卫 → 自然等待,不会绕过

即:current 在 exited 前充当占位符,防止 runNow 重复入队或 decideTick 并发 fire,语义正确。

`stopAll()` 不受影响:同步清队列+finishRun,exited 迟到时 current 已由 stopAll 语义废弃。

### Step 3: 失败测试(+1)

**文件:** `desktop/test/automationRunner.test.ts`
**文件:** `desktop/test/fixtures/fake-child.mjs`(新增 `complete-then-hang` 和 `record-timestamps` flag)

**新增测试 describe:** `B5: 严格并发1——exited 在子进程真正退净后才 resolve`

**测试场景:** `complete-then-hang` + `ignore-sigterm` 组合:
- fake-child 收到 `turn.submit` 后立即发 `turn.completed`,使 `run()` 快速 settle 为 `success`
- 同时 fake-child 挂起并拒绝 SIGTERM(强制 2s SIGKILL)
- `run()` settle 后,子进程仍存活(SIGKILL 约在 2s 后)

**先红后绿语义:**
- **改动前:**`exited` 字段不存在,`npx tsc --noEmit` 报 `Property 'exited' does not exist on type 'AutomationRunner'`→ 无法通过门禁。
- **改动后:**`exited` 存在且仅在 `proc.on('exit')` 首行 resolve → `run()` settle 后 exited 仍 pending → race(100ms) 断言通过。

**核心断言:**
1. `run()` settle 后立即 race `exited` vs 100ms timeout → `timeout-sentinel` 胜(exited 仍 pending)
2. `await runner.exited` 后时刻 > settle 时刻(证明不同步)
3. 再次 race → `exited` 胜(幂等已 resolve)

## 门禁输出

### tsc --noEmit
```
(无输出,退出码 0)
```

### npx vitest run
```
Test Files  20 passed (20)
     Tests  154 passed (154)
  Duration  9.37s
```
新增 1 个测试:153 → 154。

### npm run build
```
✓ built in 7.88s
```

### npx playwright test
```
39 passed (43.1s)
```
T33-T37 真链路(automation 功能)全绿,接线无回归。

## 变更文件清单

- `desktop/src/main/automationRunner.ts` — 新增 exited/exitedResolve 字段,exit/error 回调首行 resolve
- `desktop/src/main/automationScheduler.ts` — fire() .finally 链改为等 runner.exited 后再清 current + drainQueue
- `desktop/test/automationRunner.test.ts` — 新增 B5 describe,+1 测试
- `desktop/test/fixtures/fake-child.mjs` — 新增 complete-then-hang 和 record-timestamps flag

---

## 评审补测:scheduler 级端到端时序用例(B spawn 不早于 A exit)

### 实施日期
2026-07-03(评审 Approved 后补测)

### 新增文件

- `desktop/test/automationScheduler.shell.test.ts` — 追加 describe `AutomationScheduler B5 时序端到端`
- `desktop/test/fixtures/seq-child-dispatch.mjs` — 顺序调度包装器(首次调用→A flags,二次调用→B flags,信号透传)

### 用例设计

两个真实任务入库(store upsertTask,projectPath 用真实临时目录通过 statSync 校验):

- **Task A**: fake-child 使用 `complete-then-hang + ignore-sigterm + record-timestamps <aSpawnFile> <aExitFile>`
  - run() 快速 settle(turn.completed),但子进程拒绝 SIGTERM,约 2s SIGKILL 后写 a-exit 文件
- **Task B**: fake-child 使用 `complete-then-hang + record-timestamps <bSpawnFile>`(无 ignore-sigterm)
  - 收到 SIGTERM 即退出,spawn 后立即写 b-spawn 文件

调用顺序:
1. `scheduler.runNow('task-a')` → 立即 fire(current 为 null)
2. `scheduler.runNow('task-b')` → A 占位中,B 入队

等待 bSpawnFile 和 aExitFile 均出现后,断言:`bSpawnTs >= aExitTs`。

vitest timeout: 20s(A 的 2s SIGKILL + B 全程 + 余量)。

### 技术实现要点

`seq-child-dispatch.mjs` 使用异步 `spawn`(非 `spawnSync`)+ SIGTERM 信号透传:
- 用 `stdio: 'inherit'` 透明代理 JSON-RPC stdin/stdout/stderr
- `process.on('SIGTERM', () => child.kill('SIGTERM'))` 转发信号到 fake-child
- 自身安装 ignore-sigterm 以便 fake-child 能通过 ignore-sigterm flag 真正拒绝死
- child exit 后 `process.exit(code)` 退出包装器

env 透传:runner spawn 时不带显式 env 选项,子进程继承测试进程 `process.env`,故在测试里同时写 `process.env.SEQ_*` 和 `deps.env` 中的 `WRAITH_APPSERVER_CMD`。

### 判别力自证(红绿)

**RED(旧语义)**:临时将 `automationScheduler.ts` 的 `.finally` 改为:
```ts
}).finally(() => {
  this.current = null
  this.drainQueue()
})
```
运行结果:
```
× AutomationScheduler B5 时序端到端 > B spawn 时间戳 ≥ A exit 时间戳 2162ms
AssertionError: expected 1783063226654 to be greater than or equal to 1783063228549
```
B spawn(226654)早于 A exit(228549)约 **1895ms**,证明 B 在 A 子进程退净前已被 spawn。

**GREEN(B5 修复)**:恢复正确语义后:
```
✓ AutomationScheduler B5 时序端到端 > B spawn 时间戳 ≥ A exit 时间戳 2319ms
```
B spawn(时间戳 T+2s 量级)晚于 A exit 约 **100ms**,接线护栏生效。

### 门禁结果

```
npx tsc --noEmit: 0(无输出)
npx vitest run:
  Test Files  20 passed (20)
       Tests  155 passed (155)    ← 154 → 155(+1 新用例)
    Duration  9.50s
```

### git status 核查

`automationScheduler.ts` 无残留改动(git diff 无输出),满足"还原核查"要求。

