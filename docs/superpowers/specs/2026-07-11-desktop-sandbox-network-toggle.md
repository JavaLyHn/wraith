# 桌面「命令沙箱联网」开关(roadmap #9)

**日期:** 2026-07-11 **状态:** 设计定稿 **依赖:** roadmap #9;并入既有「安全」面板(`2026-07-11-desktop-policy-audit-viewer.md`)

## 目标

补齐 CLI 的 `-Dwraith.sandbox.network=on` —— 桌面在「安全」面板加一个开关:控制 agent 执行的 shell 命令(`execute_command`)是否可联网。当前桌面 spawn app-server 不传该 `-D` → 恒禁网、且无从开启。

**放置**:并入「安全」面板(PolicyPanel),不新增侧栏项。

## 后端事实基线(已核验)

- `CommandSandbox(boolean networkAllowed)` + `.networkAllowed()`;静态 `CommandSandbox.available()`(macOS Seatbelt 可用性)。
- `ToolRegistry.setCommandSandbox(cs)` 存字段;`execute_command` 每次读 `this.commandSandbox`(`ToolRegistry.java:1451`)→ **热切即时生效,无需重启**。
- app-server 启动时 `registry.setCommandSandbox(buildAppServerSandbox())`(默认 off,`Main.java:1147`)。
- 桌面 🛡️ 徽标 = `capabilities.sandbox`(availability),与「联网」是不同轴,不动。

## 设计决策:session 级运行时开关

热切当前 app-server 的 commandSandbox;**不持久化**——重启后恢复默认禁网。理由:联网是放松安全的设置,重启回到安全默认(禁网)是好属性;避免改 spawn 参数/config 的额外复杂度。UI 明确标注「本次运行有效,重启恢复禁网」。

## RPC 设计(2 个)

| method | params | result |
|---|---|---|
| `sandbox.get` | — | `{ available, networkAllowed }` |
| `sandbox.set` | `{ networkAllowed }` | `{ available, networkAllowed }`(热切后回读) |

**实现:**
1. `ToolRegistry`:加 `public CommandSandbox getCommandSandbox()`(读字段)。
2. `AppServer.Session`:`sandboxGet()` / `sandboxSet(boolean)` default。
3. `AppServer` dispatch:`sandbox.get` / `sandbox.set` case。
4. `Main.java` 匿名类:override;get 读 `agent.getToolRegistry().getCommandSandbox()`(null→networkAllowed false)+ `CommandSandbox.available()`;set 调 `setCommandSandbox(new CommandSandbox(allowed))` 再回读。

## 桌面接线

- IPC `wraith:sandboxGet/sandboxSet`;preload 2 方法。
- shared:`SandboxState { available, networkAllowed }`。
- `PolicyPanel.tsx`:策略区加一行「命令沙箱联网」开关(About 页同款 toggle 样式)+ 说明「关=Seatbelt 禁止命令联网(默认);开=本次运行放行,重启恢复」。`available=false` 时开关禁用 + 注「当前无沙箱,命令不受限」。

## 测试隔离铁律

sandbox.set 改运行时状态、不写文件/config;Java 侧不写单测,靠 mvn package + 眼验。桌面无新增纯函数。

## 验证

`mvn -q clean package` ✓ + 同步 `~/.wraith/wraith.jar` · typecheck · vitest 全绿 · build ✓ · 红线 CLEAN。手动:桌面重启 → 「安全」→ 切开关 → 让 agent 跑个联网命令验证放行/拦截。
