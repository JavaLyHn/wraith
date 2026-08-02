# Windows 命令沙箱 —— 设计说明

- 日期：2026-08-02
- 状态：设计确认，待实现
- 分支：`feat/windows-parity-block1`
- 触发：用户在 Windows 安全面板看到「当前无沙箱(非 macOS 或不可用)，命令不受网络限制」，要求解决

---

## 0. 一句话

Windows 上给 `execute_command` 补上真实的**断网 + 写围栏**（AppContainer），并先修好它下面三个被遮住的地基缺陷。

---

## 1. 现状盘点（读码确认，非推测）

### 1.1 macOS 沙箱到底做了什么

`SeatbeltProfile.workspaceWrite()` 生成的 SBPL 只做两件事，其余 `(allow default)`：

| 语义 | 规则 |
|---|---|
| 写围栏 | `deny file-write*` → 放行 `WORKSPACE` / `TMPDIR` / 少量 `/dev/*` |
| `.git` 只读 | `deny file-write* (subpath GIT_DIR)`，写在 workspace allow **之后**（SBPL 后匹配优先） |
| 断网 | `networkAllowed=false` 时 `deny network*` |

所以 Windows 对等目标就是这三条，**不多不少**。

### 1.2 三个被「没沙箱」遮住的缺陷

**缺陷 ①：`execute_command` 全平台写死 `bash -c`**

- `ToolRegistry.java:2147` — `return List.of("bash", "-c", normalized)`
- `CommandSandbox.java:56` — 非 macOS 分支同样 `List.of("bash", "-c", command)`

两处都**没有任何平台分支**。Windows 上能否执行完全取决于 `bash.exe` 恰好在 PATH——而 Git for Windows 默认只把 `<install>\cmd` 加进 PATH（内含 `git.exe`），`bash.exe` 在 `<install>\bin`，**默认不在 PATH**。

与 `ddc46e6` 修的 `npx` 是同一病根：**把 POSIX 进程/shell 假设直接套到 Windows**。

**缺陷 ②：`CommandGuard` 九条规则全是 POSIX 形状**

`sudo` / `rm -rf` / `mkfs` / `dd of=/dev/` / fork bomb / `curl|sh` / `find /` / `chmod 777` / `shutdown`。

Windows 上真正破坏性的命令**一条都不拦**：

```
rd /s /q C:\        del /f /s /q C:\*      format C:
diskpart            reg delete HKLM\...    takeown /f C:\ /r
Remove-Item -Recurse -Force C:\   icacls C:\ /grant Everyone:F /T
vssadmin delete shadows           bcdedit /set ...
```

而 fail-open 时给用户看的文案是「仅 CommandGuard 黑名单生效」——**在 Windows 上这句承诺基本是空的**。这是本设计里最廉价、收益最高的一块。

**缺陷 ③：超时只杀直接子进程**

`executeCommand` 超时走 `process.destroyForcibly()`。Windows 上杀 `cmd.exe` **不会**杀它的子孙进程，留下无人管的孤儿——而 Windows 上又没有沙箱兜着。macOS 上 Seatbelt 至少还圈着。

### 1.3 判据现状

`CommandSandbox.available()` 返回 `boolean`，语义硬编码为「macOS 且 sandbox-exec 可执行」。它一路传到：

- `Main.buildInitializeResult(model, sandboxAvailable)` → `initialize` 的 capabilities
- `sandboxGet()` / `sandboxSet()` RPC → `{available, networkAllowed}`
- 桌面 `topBar.ts:sandboxChipView(sandbox, platform)` —— 因为后端只回 `none`，前端**只能靠 platform 反推**语义

**boolean 不够用了**。加了 AppContainer 之后有三种真实状态，前端不该继续靠 platform 猜。

---

## 2. 目标与非目标

### 目标

1. Windows 上 `execute_command` 能正确执行（不依赖 Git Bash 碰巧在 PATH）
2. `CommandGuard` 覆盖 Windows / PowerShell 破坏性命令
3. 超时清理整棵进程树
4. Windows 上提供**内核级断网 + 写围栏**（AppContainer）
5. 沙箱状态从 boolean 升级为**三态**，前端不再靠 platform 反推

### 非目标

- 不追求与 Seatbelt 逐条等价（AppContainer 是能力模型，不是路径规则模型）
- 不支持 Windows Server Core / Win8.1 以下
- 不做 Linux 沙箱（bubblewrap 另议）
- 不签名安装包（沿用既有限制）

---

## 3. 关键决策

### 决策 1：AppContainer，而不是别的

| 方案 | 写围栏 | 断网 | 需管理员 | 判定 |
|---|---|---|---|---|
| **AppContainer** | 靠 ACL 授权 | **免费**（不给 `internetClient` 能力即无网） | 否 | ✅ 采用 |
| 受限令牌 `WRITE_RESTRICTED` | 部分 | 否 | 否 | 断网做不到 |
| Job Object | 否 | 否 | 否 | 只有资源限额 |
| Windows Sandbox (`.wsb`) | 是 | 是 | **Pro/企业版 + Hyper-V** | 整机 VM，秒级启动，拿不到 stdout |
| WFP / 防火墙规则 | 否 | 是 | **要管理员** | 且规则按 exe 走，会误伤全局 `cmd.exe` |
| Docker / WSL | 是 | 是 | 要装 | 换掉了宿主工具链，编程 agent 不能用 |

AppContainer 是唯一「免管理员 + 内核强制 + 不换工具链」的选项。

关键事实：`ALL APPLICATION PACKAGES`（`S-1-15-2-1`）**默认**已对 `C:\Windows`、`C:\Program Files` 有读+执行权限（UWP 应用靠这个读系统 DLL），所以大部分工具链开箱可读，ACL 工作量远小于直觉。

### 决策 2：PowerShell 发射器，不引 JNA

用户选型时接受了「引 JNA」，但实现手段是工程判断——**这里不需要 JNA，而且不用更好**。

AppContainer 的真正难点不是调 Win32，是 **stdio**：

- `CreateProcessAsUser` 之后要自建管道、把 Win32 `HANDLE` 桥回 Java `InputStream`（得循环 `ReadFile`），`ProcessBuilder` 的流处理全部作废
- 那部分原生代码量最大、最易错，而且**我一行都验不了**

绕开的办法：**PowerShell 当发射器**。

```
Java ProcessBuilder
  └─ powershell.exe -NoProfile -ExecutionPolicy Bypass -File appcontainer-run.ps1
       └─ (Add-Type 就地编译 C# P/Invoke)
            └─ CreateProcessAsUser → AppContainer 内的 cmd.exe /c <command>
```

- `Add-Type` 用的是 Windows 自带的 .NET Framework 编译器，**不需要 MSVC / node-gyp**（与桌宠选 koffi 同一条理由）
- PowerShell 自己的 stdout/stderr 就是 Java 给的管道，**Java 侧一行不用改**
- 零新依赖，不用交付编译产物（我没有 Windows，也编不出来）

代价：首次 `Add-Type` 编译约 1–2 秒；PowerShell 启动本身约 200–400ms。

### 决策 3：管道要显式授权给 AppContainer

**这是最容易翻车的一点，先记下来。**

AppContainer 进程的令牌被严格削过。Java 建的匿名管道句柄，其默认 DACL **不包含** AppContainer SID——直接继承下去，子进程可能读写被拒。

所以发射器**自己建管道**，用显式 `PipeSecurity` 授权 `ALL APPLICATION PACKAGES`，把这对句柄给子进程，再由 PowerShell 把子进程输出泵回自己的 stdout。

```
[System.IO.Pipes.AnonymousPipeServerStream] + PipeSecurity(S-1-15-2-1: FullControl)
  → 子进程 STARTF_USESTDHANDLES
  → PowerShell 侧 CopyTo(Console.OpenStandardOutput())
```

不这么做的话症状是「命令跑了但一个字都没输出」，而且极难归因。

### 决策 4：两个 profile，不做运行时改能力

AppContainer 的能力集在**创建 profile 时**定死，之后不能改。所以：

| profile 名 | 能力 | 用途 |
|---|---|---|
| `wraith-sandbox-nonet` | 无 | 默认（断网） |
| `wraith-sandbox-net` | `internetClient` + `privateNetworkClientServer` | 面板开关打开 / 单次放行 |

`networkAllowed` 只是选哪个 profile，语义与 macOS 完全一致。

### 决策 5：fail-open，但要喊出来

沿用 macOS 现有语义：沙箱不可用 → 裸跑 + warning，**不阻断用户**。

但现在 warning 只进 `log.warn` 且带 `sandboxWarningLogged` 去重——桌面用户根本看不到。本次把 warning 提升为 UI 可见状态（见 §4.4）。

理由：一个「因为没授权 npm 缓存目录就默默掐掉 `npm install`」的沙箱，排查成本极高。宁可明确降级并说清楚。

### 决策 6：Windows 用 `cmd.exe`，不用 PowerShell 当命令 shell

`execute_command` 在 Windows 上走 `%ComSpec%`（即 `cmd.exe`）`/c`：

- `cmd.exe` **必然存在**，PowerShell 理论上可被移除
- 启动快（PowerShell 每条命令多 200–400ms）
- 引号地狱比 `powershell -Command` 轻

**必须同步做的事**：系统提示要告诉模型当前 shell 是 `cmd.exe`，否则它会照着习惯吐 `ls -la`。

> 发射器脚本用 PowerShell 是另一回事——那是我们自己写的固定脚本，不是模型生成的命令。

### 决策 7：`available()` 从 boolean 升为三态

```java
public enum SandboxKind { SEATBELT, APPCONTAINER, NONE }
```

`CommandSandbox.available()` 保留（`detect() != NONE`）以免一次性改爆调用点，但 RPC 与前端改吃 `kind`。

前端 `sandboxChipView` 此后**按 kind 判定，不再靠 platform 反推**——platform 那套是当初后端只能回 `none` 时的补丁，根因消失了就该拆掉。这与上次「同一个 `none` 在两边意思不同」的结论并不矛盾：那次的正确解就是让后端说清楚自己是哪种 `none`。

---

## 4. 设计

### 4.1 新增：`ShellCommand`（纯函数，可注入）

```
src/main/java/com/lyhn/wraith/policy/sandbox/ShellCommand.java
```

```java
/** 把一条命令包成平台正确的 shell 调用。纯函数,os.name / ComSpec 全注入,便于在 mac 上测 Windows 分支。 */
static List<String> wrap(String osName, String comSpec, String command)
```

- Windows：`[comSpec 或 "cmd.exe", "/c", command]`
- 其它：`["bash", "-c", command]`

`ToolRegistry.resolveProcessCommand` 与 `CommandSandbox.buildCommand` 的 fail-open 分支**都改走这里**——两处重复的 `bash -c` 是这次缺陷能同时存在于两个地方的原因。

### 4.2 `CommandGuard` 补 Windows 规则

新增规则（与现有 POSIX 规则并存，全平台都跑——命令文本里出现 `format C:` 在 mac 上也没有放行的理由）：

| 规则 | 拦截 |
|---|---|
| 递归强删系统盘/用户目录 | `rd /s /q C:\`、`rmdir /s /q %USERPROFILE%`、`del /f /s /q C:\*` |
| PowerShell 递归强删 | `Remove-Item -Recurse -Force` 指向盘符根 / `$env:USERPROFILE` / `~` |
| 磁盘格式化 / 分区 | `format <盘符>:`、`diskpart` |
| 注册表删除 | `reg delete HK(LM\|CU\|CR\|U\|CC)` |
| 夺取所有权 / 改 ACL | `takeown /f ... /r`、`icacls <根> /grant ... /t` |
| 删除卷影副本 | `vssadmin delete shadows` |
| 引导配置 | `bcdedit` |
| 关机 | `Stop-Computer`、`Restart-Computer`、`shutdown /s`（`shutdown` 已被 POSIX 规则覆盖） |
| 远端脚本直执行 | `iwr\|iex`、`Invoke-WebRequest ... \| Invoke-Expression`、`irm ... \| iex` |

注意 `curl` / `wget` 在 Windows PowerShell 里是 `Invoke-WebRequest` 的别名，现有 `curl|sh` 规则匹配不到 `curl x | iex`——新规则要按 PowerShell 形状写。

### 4.3 超时杀进程树

`executeCommand` 超时分支改为：先 `process.descendants()` 收集，再 `destroyForcibly()` 自身，然后逐个 `destroyForcibly()` 后代。

`ProcessHandle.descendants()` 是 Java 9+ 跨平台 API，mac 上同样有收益（Seatbelt 不阻止 fork）。**必须先收集再杀**——杀了父进程之后 `descendants()` 就查不到了。

### 4.4 沙箱三态与 UI

**后端**

```java
CommandSandbox.detect() -> SandboxKind
Wrapped { List<String> command, SandboxKind kind, String warning }
```

`sandboxGet()` / `sandboxSet()` 回包加字段（`available` 保留以兼容旧前端）：

```json
{ "available": true, "kind": "appcontainer", "networkAllowed": false, "degradedReason": null }
```

**前端**

- `SandboxState` 增加 `'windows-appcontainer'`
- `sandboxChipView` 按 kind 分派；`platform` 参数**保留但降级为仅 `none` 时使用**（Linux 仍需它区分「不支持」与「可修」）
- `PolicyPanel` 的联网开关：`kind !== 'none'` 时可用（当前是 `!sandbox.available`）
- 降级时把 `degradedReason` 显示出来，而不是只留一行灰字

### 4.5 AppContainer 发射器

```
scripts/windows/appcontainer-run.ps1
```

参数：`-ProfileName` `-Workspace` `-GitDir` `-Command` `[-PrepareAcl]` `[-SelfTest]`

流程：

1. `Add-Type` 编译 P/Invoke 壳（`CreateAppContainerProfile` / `DeriveAppContainerSidFromAppContainerName` / `InitializeProcThreadAttributeList` / `UpdateProcThreadAttribute` / `CreateProcessAsUserW` / `WaitForSingleObject` / `GetExitCodeProcess`）
2. 确保 profile 存在（`CreateAppContainerProfile`，已存在的 `HRESULT_FROM_WIN32(ERROR_ALREADY_EXISTS)` 视为成功 → `Derive...` 拿 SID）
3. 确保 ACL（幂等，写标记文件避免每条命令都跑 `icacls`）：
   - `icacls <workspace> /grant *S-1-15-2-1:(OI)(CI)(M) /T`
   - `icacls <gitDir> /deny *S-1-15-2-1:(OI)(CI)(W) /T` ← `.git` 只读，对齐 Seatbelt
4. 建带 `PipeSecurity` 的管道（§决策 3）
5. `CreateProcessAsUserW` 拉起 `cmd.exe /c <command>`，`EXTENDED_STARTUPINFO_PRESENT | CREATE_NO_WINDOW`
6. 泵输出、等待、透传退出码

**Java 侧只负责拼命令行**（纯函数，可测）：

```
src/main/java/com/lyhn/wraith/policy/sandbox/AppContainerCommand.java
```

**AppContainer 的临时目录**由系统自动重定向到 `%LOCALAPPDATA%\Packages\<profile>\AC\Temp`，无需额外授权——这点比 Seatbelt 省事。

### 4.6 可用性判定

`detect()` 在 Windows 上返回 `APPCONTAINER` 需同时满足：

1. `os.name` 含 `win`
2. Windows 10+（`os.version` ≥ 10）
3. `powershell.exe` 可解析 —— **复用 `StdioCommand`**（上次修 `npx` 的产物，正好是同一类问题）
4. `appcontainer-run.ps1` 存在

任一不满足 → `NONE` + `degradedReason`。

### 4.7 自检命令

```
wraith sandbox doctor
```

逐项打印并给出修复建议：平台/版本、PowerShell 解析结果、脚本存在、profile 创建、ACL 授权、**实跑三条探针**：

| 探针 | 期望（断网 profile） |
|---|---|
| `echo ok` | 输出 `ok` ← 证明 stdio 管道通了 |
| 写工作区文件 | 成功 |
| 写工作区外（如 `%USERPROFILE%\x`） | 失败 |
| `curl -s https://example.com` | **失败** ← 证明断网生效 |

这是我唯一能交给用户去验证的手段——我自己验不了。

---

## 5. 我验不了什么（诚实边界）

| 项 | 谁来验 |
|---|---|
| 所有 Win32 P/Invoke 签名与调用序列 | 用户真机 |
| 管道 DACL 是否真的够（决策 3 的风险点） | 用户真机 |
| `icacls` 授权是否覆盖到 npm/pip 缓存 | 用户真机 |
| AppContainer 下工具链（git/node/mvn）能否正常跑 | 用户真机 |
| 断网是否真的生效 | `sandbox doctor` 探针 |

**可以在 mac 上验的**（注入式纯函数，与 `StdioCommandTest` 同一套路）：`ShellCommand` 分派、`CommandGuard` Windows 规则、`AppContainerCommand` 命令行拼装、`detect()` 三态判定、进程树收集、前端 `sandboxChipView` / `PolicyPanel`。

---

## 6. 分期

**Phase A —— 地基**（纯 Java + 前端，mac 全可测）

- A1 `ShellCommand` + 两处 `bash -c` 收敛
- A2 `CommandGuard` Windows 规则
- A3 超时杀进程树
- A4 `SandboxKind` 三态 + RPC 加字段
- A5 前端 chip / PolicyPanel 吃 kind
- A6 系统提示告知 shell 类型

**Phase B —— AppContainer**

- B1 `appcontainer-run.ps1`
- B2 `AppContainerCommand`（纯函数 + 测试）
- B3 `detect()` 接 Windows 分支
- B4 `wraith sandbox doctor`
- B5 打包把脚本带进 resources
- B6 文档 + `windows-dev.md` 验收项

**Phase C —— 真机验收**（用户执行，我不写结论）

---

## 7. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 管道 DACL 不足 → 无输出 | 高 | 显式 `PipeSecurity`；doctor 第一条探针就是 `echo ok` |
| 工具链读不到 → 命令大面积失败 | 高 | fail-open + 明确 reason；面板可一键关沙箱 |
| `Add-Type` 编译慢 | 中 | profile 与编译结果缓存；只在首条命令付费 |
| `icacls` 改用户机器 ACL | 中 | 只授 workspace，幂等，doctor 打印实际执行的命令；文档写明如何撤销 |
| 组策略禁用 PowerShell | 中 | detect 失败 → `NONE` + reason |
| 工作区在非 NTFS / 网络盘 | 中 | `icacls` 失败 → 降级 + reason |
| `cmd.exe` 换 shell 导致模型吐错语法 | 中 | A6 系统提示；这是必须同批做的 |

---

## 8. 撤销方式（写进文档）

```powershell
icacls "<workspace>" /remove "*S-1-15-2-1" /T
Remove-AppxPackage 不适用；用 Delete-AppContainerProfile 或:
[void][Windows.Management.Deployment...]  # 见 docs/windows-usage.md
```

面板关掉沙箱不会自动撤 ACL——**这点必须在文档里说清楚**，否则用户以为关了就干净了。
