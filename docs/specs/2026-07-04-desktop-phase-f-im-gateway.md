# Wraith 桌面端 Phase F：IM 网关(QQ)配置与管理 spec

状态：**草案，待评审**（spec-first；评审通过后再实现）
分支建议：`feat/desktop-im-gateway`

## 0. 背景与关键事实

- Java 侧 IM 网关 v1 已**真机端到端验证**：openclaw 扫码绑定 → WS 认证 → C2C 单聊收发 → ReAct+工具 → HITL 审批（真写盘）→ 短抖动自愈重连。已在 `main`（`e92e68a`）。
- 但网关**配置/运维目前只有两条路**：命令行 `wraith gateway bind`（扫码，写 `~/.wraith/config.json` 的 `gateway.qq`）+ 手编 `config.json`；`wraith gateway` 常驻守护进程也只能手动在终端起。
- **桌面端对网关一无所知**：`desktop/` 全仓 0 处引用 gateway/qq/openclaw；设置只管自己的 `settings.json`（项目列表）+ 经 IPC 配 Java 的 model/provider/mcp。
- **但桥已存在**：`main/backend.ts` 用 `java -jar ~/.wraith/wraith.jar app-server` spawn Java + `shared/jsonRpcClient.ts` 通信；`index.ts` 已有 40+ 个 `ipcMain.handle('wraith:*')`，其中 `setModel`/`setDefaultProvider`/`mcpConfigUpsert`（改 `~/.wraith/mcp.json`）/`automation*`（Electron 管后台任务）都是「桌面端配/管 Java 侧」的现成先例。

⇒ Phase F 不是从零打通，而是**复用既有 spawn+IPC+配置模式**，给网关加一屏「配置 + 启停 + 状态」。

## 1. 目标与非目标

### 1.1 目标（F 交付）
1. **绑定**：一屏展示当前绑定状态（未绑定 / 已绑定 appId 打码），一键「扫码绑定」——**复用 Java 的 `wraith gateway bind`**，解析其 stdout 的 openclaw connect URL，用 `shell.openExternal` 打开 QQ 扫码页（页面自带二维码，无需 Node 侧渲染 QR）；进程退出即刷新状态。
2. **secret 手填兜底**：openclaw 偶发返回失效 secret（已知问题，Java 侧已加落盘前验证），提供一个「机器人密钥」输入框，直接写 `gateway.qq.clientSecret`。
3. **守护进程管理**：启动/停止/重启 `wraith gateway`；实时状态灯（stopped / starting / connected / error）+ 最近错误 + 日志尾。
4. **配置落盘**：`gateway.qq`（appId/clientSecret/ownerOpenid/workspace）读写 `~/.wraith/config.json`。

### 1.2 关键约束（红线）
- **密钥红线**：`clientSecret` 等**绝不回显明文、绝不进渲染层日志/DevTools**；渲染层只拿到「已配置/未配置 + 打码 appId」；明文只在 main↔config.json 之间流动。config.json 仍是唯一密钥落点。
- **复用 Java，不在 Node 重写密码学**：openclaw 的 AES-GCM 解密 + 验证 + 落盘全走 Java `wraith gateway bind`，Electron 只做 spawn/解析 stdout/开浏览器/等退出。
- 网关语义不变：deny-all、单聊-only、HITL-over-QQ。
- 复用现有 spawn（`resolveBackendCommand` 同思路）+ IPC + settings 模式，不引入新框架。

### 1.3 非目标（推迟）
- 多账号 / 多平台（仅 QQ 单账号单聊）。
- 频道推送 / cron 投递（Spec-2）。
- 在 Node 侧重实现 openclaw/AES（明确复用 Java）。
- 网关与 app-server 后端的深度融合（二者是并存的两个 Java 进程，F 只做进程级管理）。

## 2. 架构

```
渲染层 (React)  ──IPC──►  main 进程                         ►  Java jar (~/.wraith/wraith.jar)
  ImGatewayPanel            gatewayManager.ts (新)              ├─ `... gateway`      (常驻守护进程, spawn)
   - 状态卡/启停/日志         - spawn/kill `java -jar jar gateway`  └─ `... gateway bind` (一次性, spawn, 解析 stdout)
   - 扫码/手填 secret         - 解析 bind stdout → connect URL
                            - 读写 config.json 的 gateway.qq (Node fs)
                            - 状态推送 (webContents.send)
```

- **gatewayManager.ts（main，新）**：持有网关子进程句柄 + 运行态；`start()/stop()/restart()/status()`；spawn 命令复用 `resolveBackendCommand` 同款（`java -jar <jar> gateway`，可 `WRAITH_GATEWAY_CMD` 覆盖）。
- **配置读写**：main 侧 Node `fs` 直接读写 `~/.wraith/config.json` 的 `gateway.qq`（扁平 JSON，低风险）；schema 与 Java `WraithConfig.GatewayQqConfig` 对齐（appId/clientSecret/ownerOpenid/workspace）。**不**在渲染层碰 config.json。
- **绑定**：`gatewayManager.bind()` spawn `java -jar <jar> gateway bind`，逐行读 stdout，正则抽取 `https://q.qq.com/qqbot/openclaw/connect.html?task_id=...` → `shell.openExternal(url)` + 通知渲染层「已打开扫码页，请用手机 QQ 扫码」；等子进程退出：exit 0 且 config 有 gateway.qq → 成功；否则把 Java 打印的错误（如「secret 无法换取 token，请手填」）转给渲染层。

## 3. 数据模型

**config.json（Java 侧已存在，main 读写）：**
```
gateway.qq = { appId, clientSecret, ownerOpenid, workspace }
```

**网关运行态（main 内存，推给渲染层，不落盘）：**
```ts
type GatewayStatus =
  | { state: 'stopped' }
  | { state: 'starting' }
  | { state: 'connected' }                     // 见到 "WS opened" 且无后续 4004
  | { state: 'error'; code?: number; message: string }  // 4004 / 缺 jar / 缺 provider / 进程退出
type GatewayConfigView = {                     // 给渲染层的安全视图，绝不含明文 secret
  bound: boolean
  appIdMasked: string | null                   // 如 "1905****4340"
  ownerOpenidMasked: string | null
  workspace: string | null
  hasSecret: boolean
}
```

## 4. 绑定流程（reuse Java `gateway bind`）

1. 渲染层点「扫码绑定」→ `wraith:gatewayBindStart`。
2. main spawn `java -jar jar gateway bind`；监听 stdout。
3. 抽到 connect URL → `shell.openExternal(url)`；`webContents.send('wraith:gatewayBindProgress', {phase:'scanning'})`。
4. 子进程退出：
   - exit 0 + config.gateway.qq.clientSecret 非空 → `{phase:'bound'}` + 刷新 GatewayConfigView。
   - exit 0 但 secret 空（Java 侧 validate 失败留空）→ `{phase:'secret-invalid'}`：提示到 q.qq.com 复制机器人密钥手填。
   - 非 0 / 超时 → `{phase:'failed', message}`。
5. 「取消」→ `wraith:gatewayBindCancel` → kill 子进程。

> 复用 Java 意味着：openclaw 端点、AES-GCM 解密、落盘前 secret 验证（`e92e68a`）全部自动继承，Node 侧零密码学。

## 5. 守护进程管理

- `wraith:gatewayStart` → 若已 running 忽略；否则 spawn `java -jar jar gateway`，state=starting。
- 状态判定（**开放问题，见 §10**）：v1 先**解析日志**——tail `~/.wraith/logs/wraith.log`（Java 侧日志路径已在 `e92e68a`+本地 .env 修正回 `~/.wraith/logs`），命中 `WS opened`→connected；`code=4004`/`giving up`→error；进程退出→stopped/error。
- `wraith:gatewayStop` → kill 子进程，state=stopped。
- 日志尾：`wraith:gatewayLogs` 返回最近 N 行（脱敏，日志本就不含密钥）。
- 应用退出时：main `before-quit` 里 kill 网关子进程（不留孤儿）。

## 6. 前端（desktop/renderer）

### 6.1 视图与 Sidebar
- Sidebar 加入口「IM 网关」（图标沿用现有风格）。整页 `ImGatewayPanel`，版式沿用 E-2 AutomationsPanel / E-1 PluginsPanel。

### 6.2 ImGatewayPanel（新）
- **绑定状态卡**：未绑定 → 「扫码绑定」按钮；已绑定 → 打码 appId + owner + workspace + 「重新绑定」。
- **扫码流程**：点击后进度态（已打开扫码页→等待→成功/失败）；失败/secret-invalid 时展示「机器人密钥」输入框 + 「保存」（写 clientSecret）。
- **workspace 选择**：目录选择器（复用 `dialog.showOpenDialog` 现成模式）。
- **网关开关**：启动/停止 toggle + 状态灯（灰/黄/绿/红）+ 最近错误。
- **日志尾**：折叠区，展示最近若干行。

### 6.3 IPC 面（main↔renderer，全部新增）
```
wraith:gatewayConfigGet      → GatewayConfigView            (安全视图)
wraith:gatewayConfigSetSecret(secret)  → { ok }             (只接收、写盘、不回显)
wraith:gatewayConfigSetWorkspace(path) → { ok }
wraith:gatewayBindStart      → 启动 bind 子进程
wraith:gatewayBindCancel     → kill bind
wraith:gatewayStart / gatewayStop / gatewayRestart
wraith:gatewayStatus         → GatewayStatus
wraith:gatewayLogs           → { lines: string[] }
事件(main→renderer): wraith:gatewayStatusChanged / wraith:gatewayBindProgress
```

## 7. 错误处理
- 缺 `~/.wraith/wraith.jar` → 提示先安装。
- 缺 LLM provider（Java 侧 `无可用 LLM provider`）→ 引导先配 provider（已有 model/provider 设置）。
- secret 无效（4004 / bind 验证失败）→ 走手填兜底。
- 网关子进程崩溃 → state=error + stderr 尾（脱敏）。

## 8. 测试策略
- **纯函数单测**（Java 风格的 pure-helper 优先）：connect-URL 解析、appId/openid 打码、config.json gateway.qq 读写、spawn 命令解析（同 `resolveBackendCommand` 的可测风格）、日志状态判定（给若干行 → 期望 state）。
- **进程管理**：mock child_process，验证 start/stop/退出→状态转换。
- **renderer**：ImGatewayPanel 组件测试（状态渲染、按钮 → IPC 调用），vitest（沿用现有）。
- **红线回归**：断言渲染层拿到的 GatewayConfigView 永不含明文 secret；断言 secret 只经 setSecret 单向流入。

## 9. 范围边界（红线复述）
- 明文密钥只在 main↔config.json；渲染层零明文、DevTools 零明文。
- openclaw/AES 全走 Java bind，Node 侧不写密码学。
- 单聊-only / deny-all / HITL 语义不变。
- 频道/cron/多账号不在本期。

## 10. 风险与开放问题
1. **网关状态上报靠日志解析偏脆**：`WS opened`/`4004` 字符串一旦改就失准。**候选改进**：Java 侧 `gateway` 增加一个稳定的状态信号——如往 `~/.wraith/gateway-status.json` 写 `{state,ts}`，或 stdout 打印机器可读状态行（`GATEWAY_STATUS connected`）。建议 F 期先日志解析、同时在 Java 侧加一行结构化状态输出作为长期方案。
2. **两个 Java 进程并存**（app-server + gateway）：内存/端口/token 是否冲突？token 各自 `ensureToken`，无共享状态，应无冲突；需确认无单例文件锁。
3. **`shell.openExternal` 的 connect URL**：需确认桌面默认浏览器能正常渲染 QQ 扫码页；否则回退到 Node 侧 QR 渲染（内联 QR 库，注意 CSP）。
4. **Windows/Linux**：spawn `java` 路径、kill 语义差异（F 先保 macOS，跨平台随桌面端整体节奏）。
5. **workspace 语义**：网关会话的工作目录 = gateway.qq.workspace；需在 UI 明确「bot 在这个目录里跑工具/写文件」，避免误配到敏感目录。

## 附：实现拆分建议（评审后）
- F-1：main `gatewayManager`（spawn/status/config 读写）+ IPC + pure-helper 单测。
- F-2：绑定流程（bind spawn + connect URL + openExternal + 手填兜底）。
- F-3：`ImGatewayPanel` 前端 + Sidebar 入口 + 状态/日志。
- F-4（可选，长期）：Java 侧结构化状态输出，替换日志解析。
