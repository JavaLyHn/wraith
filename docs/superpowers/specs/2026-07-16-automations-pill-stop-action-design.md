# 自动化面板网关胶囊「停止网关」动作 设计稿

日期:2026-07-16
状态:设计已与用户确认(对齐 IM 面板语义),待用户审阅
背景:网关感知胶囊(8962937)能启动但运行中无停止入口,想停只能去「IM 网关」屏。本改动给胶囊补停止动作。

## 目标

胶囊在网关 `running`/`starting` 时显示「停止网关」按钮(调 `gatewayStop()`),与 `ImGatewayPanel` 的 toggle 语义(`running||starting → stop`,否则 start)对齐;不弹 confirm。

## 确认的决策(用户)

- **对齐 IM 面板**:`running` 和 `starting` 都给「停止网关」;`stopped`→启动、`error`→重试不变。
- **不弹 confirm**(与 IM 面板 `handleToggleDaemon` 一致)。
- 按钮文案「停止网关」。

## 全局约束

- 复用既有 `window.wraith.gatewayStop()` 桥(preload:522 → ipc index.ts:970 → `gatewayManager.stop()`,已存在);`gatewayManager.stop()` 幂等(非运行时安全)。
- 纯函数改动可单测;desktop typecheck 0;vitest 基线不降;不碰后端/IM 面板/调度器。

## 设计

### `desktop/src/renderer/lib/gatewayGate.ts`
- `GatewayPillView.action` 类型由 `'start' | 'retry' | null` 增为 `'start' | 'retry' | 'stop' | null`。
- `gatewayPillView`:
  - `running` → `{ text: '网关运行中', tone: 'ok', action: 'stop' }`(原 `action: null`)
  - `starting` → `{ text: '网关启动中…', tone: 'muted', action: 'stop' }`(原 `action: null`)
  - `error` / `stopped`(default)分支不变(`retry` / `start` + hint)。

### `desktop/src/renderer/components/AutomationsPanel.tsx`
- 胶囊 action 按钮当前 label 三元 `pill.action === 'start' ? '启动网关' : '重试'`、onClick 硬编码 `gatewayStart()`。改为按 action 派 label + onClick:
  - label:`{ start: '启动网关', retry: '重试', stop: '停止网关' }[pill.action]`
  - onClick:`pill.action === 'stop' ? window.wraith.gatewayStop() : window.wraith.gatewayStart()`
- 其余(胶囊文案/tone/glyph/hint、任务卡标签、toast、轮询)不变。

## 测试

- `gatewayGate.test.ts`:更新 `running`/`starting` 断言为 `action: 'stop'`(原 `toEqual` 断言 `action: null` 会因此变更,须同步改);`stopped`/`error` 用例不变。断言仍完整对象比较。
- typecheck 0;`npx vitest run test/gatewayGate.test.ts` 绿;全量 vitest 基线不降。
- 眼验:网关运行中,自动化面板胶囊显示「● 网关运行中 停止网关」,点「停止网关」→ 网关停、胶囊转「⚠ 网关未运行 · 启动网关」+ 任务卡转「已启用 · 网关未运行」;无需再去 IM 面板。

## 不做(YAGNI)

- 不弹 confirm;不改 IM 面板;不改 `gatewayStop` 桥/`gatewayManager`;`starting` 停止即取消连接(复用 stop 幂等,不新增取消逻辑)。
