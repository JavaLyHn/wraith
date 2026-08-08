# Maven runtime / tool 跨平台修复报告

日期：2026-08-06  
工作树：`D:\wraith\.worktrees\desktop-git-pill`  
分支：`codex/desktop-git-pill-baseline`

## 范围与边界

- 严格按 `maven-runtime-diagnosis.md` 处理 D/F/H/I 生产边界及 B/C/E/G/J 跨平台测试夹具。
- A 组 AppServer / MCP 进程关闭链被标记为独立高风险，本次不修改，也不执行会启动内建浏览器 MCP 的相关测试。
- `JavaCodeSearchEngine.java` 与 path agent 并行共享；在对方完成前不修改，完成后只审查其 `/` 协议边界并补齐必要的 `ToolRegistry` 输出。
- 不把 Windows 正常的 `cmd.exe`、宿主路径或 CRLF 行为改成 POSIX；只在稳定对外协议或目标平台 argv 边界做归一化。

## 已完成组

### D：PromptAssembler CRLF 归一化

- RED：`mvn test "-Dtest=PromptAssemblerTest#omitsToolInstructionsWhenToolsAreDisabled" -DskipTests=false`
  - 结果：1 test / 1 failure；禁用 tools 后仍包含 `## Tools`。
- GREEN：同一命令。
  - 结果：1 test / 0 failures / 0 errors，BUILD SUCCESS。
- 修复：所有 repository prompt 文本进入 `PromptAssembler` 时统一 `\r\n` / `\r` 为 `\n`，section regex 不再依赖 checkout 换行格式。
- Commit：`3b5e2d18 fix(prompt): 统一提示词换行以兼容 CRLF`

### I：CommandSandbox macOS argv 字面量

- RED：`mvn test "-Dtest=CommandSandboxTest#sandboxAvailable_wrapsWithSandboxExecAndProfile" -DskipTests=false`
  - 结果：1 test / 1 failure；期望 `/usr/bin/sandbox-exec`，Windows 宿主生成 `\usr\bin\sandbox-exec`。
- GREEN：同一命令。
  - 结果：1 test / 0 failures / 0 errors，BUILD SUCCESS。
- 修复：macOS argv 使用固定 POSIX 字面量；仅真实可执行性探测处构造宿主 `Path`。
- Commit：`d42e8320 fix(sandbox): 保留 macOS 命令路径字面量`

### H：AppContainerSupport capability probe 注入

- 原始 RED：`mvn test "-Dtest=AppContainerSupportTest#windowsWithoutPowershellIsNotReady" -DskipTests=false`
  - 结果：1 test / 1 failure；Windows 真机读到真实 PowerShell 后错误 ready。
- seam RED：测试改为调用可注入 `CapabilityProbe` 后运行同一命令。
  - 结果：testCompile 失败，缺少 `CapabilityProbe`，证明新测试要求尚未由生产代码满足。
- GREEN：同一命令。
  - 结果：1 test / 0 failures / 0 errors，BUILD SUCCESS。
- 修复：增加 package-private `CapabilityProbe` 与 `compute(..., capabilities)` overload；原 `compute(osName, osVersion)` 委托真实探测。两个要求失败诊断的测试显式注入“PowerShell 不可用”。
- Commit：`0bc03012 test(sandbox): 注入 AppContainer 能力探测`

### B：TERM / ANSI 测试环境隔离

- RED：`mvn test "-Dtest=MainInputNormalizationTest#startupBannerUsesOpenLayoutWithoutRightBorder,TerminalCapabilitiesTest#xtermTerminalIsAnsiCapable+scrollRegionTrueOnNormalTerminal,InlineRendererTest#onAnsiTerminalEnablesStatusBar" -DskipTests=false`
  - 结果：4 tests / 4 failures；真实 `TERM=dumb` 泄漏进能力断言，banner 又把字形内部 `║` 当成右外框。
- GREEN：同一命令。
  - 结果：4 tests / 0 failures / 0 errors，BUILD SUCCESS。
- 修复：纯能力测试调用可注入 env overload；renderer 用例局部设置并恢复 `wraith.force.ansi`；banner 只检查实际信息/提示布局而非字形内容。

### C：InlineRenderer 平台换行

- RED：`mvn test "-Dtest=InlineRendererTest#streamUsesPrintAboveWhenLineReaderIsReading" -DskipTests=false`
  - 结果：1 test / 1 failure；期望 `\n`，Windows `PrintStream.println` 输出 `\r\n`。
- GREEN：同一命令。
  - 结果：1 test / 0 failures / 0 errors，BUILD SUCCESS。
- 修复：测试按 `System.lineSeparator()` 断言，生产 renderer 不变。

### E：execute_command 测试使用宿主 shell 契约

- RED：`mvn test "-Dtest=ToolRegistryCommandStreamingTest,ToolRegistryNetworkOnceTest#resolveProcessCommandConsumesGrantEvenWithoutSandbox,ToolRegistrySandboxWiringTest#noSandbox_runsPlainBash,ToolRegistryTest#shouldRunCommandInProjectDirectory+shouldTimeoutLongRunningCommandWithoutHanging" -DskipTests=false`
  - 结果：6 tests / 5 failures；`printf` / `pwd` / `sleep` 与固定 bash argv 不符合 Windows `cmd.exe` 契约。
- GREEN：同一命令。
  - 结果：6 tests / 0 failures / 0 errors，BUILD SUCCESS。
- 修复：流式夹具使用 cmd/bash 都支持的 `echo`；argv 期望委托 `ShellCommand.wrap`；cwd / timeout 使用宿主等价命令（Windows `cd` / `ping`，POSIX `pwd` / `sleep`）。

### G：SearchDetection PATH delimiter

- RED：`mvn test "-Dtest=SearchDetectionTest#findsDockerOnPath+scansEveryPathSegment" -DskipTests=false`
  - 结果：2 tests / 2 failures；固定 `:` 拆坏 Windows 盘符。
- GREEN：同一命令。
  - 结果：2 tests / 0 failures / 0 errors，BUILD SUCCESS。
- 修复：测试使用 `File.pathSeparator`，生产探测不变。

### J：Memory project key 的宿主 Path 语义

- 首次 RED：同一 worktree 的并发 Maven 清理造成一次临时 `NoClassDefFoundError: LongTermMemory`；产物恢复后重跑，确认不是源码根因。
- 有效 RED：`mvn test "-Dtest=MemoryManagerTest#shouldStoreProjectScopedFactsByDefault" -DskipTests=false`
  - 结果：1 test / 1 failure；Windows 项目 key 不以 POSIX 字符串 `/repo/current` 结尾。
- GREEN：同一命令。
  - 结果：1 test / 0 failures / 0 errors，BUILD SUCCESS。
- 修复：使用 `@TempDir` 下的项目根，并将实际/期望都按绝对规范化 `Path` 比较；生产 Memory 路径身份不变。

- B/C/E/G/J Commit：`7c68cb34 test(runtime): 移除 Windows 宿主假设`

### F：工具对外路径统一 `/`

- RED：`mvn test "-Dtest=ToolRegistryTest#shouldGlobFilesInsideProject+shouldGrepCodeWithLineNumbersAndContext+shouldSkipCommonDependencyDirectoriesWhenGrepping,CodeSearchGoldenSetTest" -DskipTests=false`
  - 结果：4 tests / 1 failure；黄金集和两个 grep 用例已通过，只剩 glob 返回宿主反斜杠。
- GREEN：同一命令。
  - 结果：4 tests / 0 failures / 0 errors，BUILD SUCCESS。
- 审查：path agent 的 `JavaCodeSearchEngine` 在构造 `GrepMatch.file` 时统一 `/`，内部访问仍使用 `Path`，边界正确，未覆盖其改动。
- 修复：`ToolRegistry.globFiles` 在对外结果列表入口将 `relative.toString()` 的反斜杠替换为 `/`。
- Commits：
  - `ff3595de fix: 统一 Windows 对外路径解析`（path agent；含 `JavaCodeSearchEngine`）
  - `923f2451 fix(tool): 统一 glob 对外路径分隔符`

## 验证状态

- 本报告列出的 D/I/H/B/C/E/G/J/F focused 命令均已逐组完成 RED → GREEN。
- path agent 另行报告路径组合测试 24/24 BUILD SUCCESS；本线程没有据此替代自身 focused 验证。
- root agent 在 `923f2451` 后负责串行运行最终 Maven 集合，避免多个 agent 共用 `target/` 时再次竞态；结果由 root 汇总。
- `git diff --check` 对每组显式文件均无 whitespace error；Git 仅提示 Windows checkout 下未来 LF → CRLF 转换。

## 当前顾虑

- A 组未修复，因此任何包含 AppServer bootstrap 的全量测试仍可能启动 `npx` / Chrome MCP 后代进程并锁住 Windows 临时目录；最终验证不会擅自运行该高风险集合。
- linked worktree 的 Git 索引位于主仓库 `.git/worktrees`，沙箱内不可写；每次提交均需受控提权，并只按显式文件列表暂存，避免带入 path agent 的并发修改。
- Maven/Javac 中文 warning 在当前控制台存在 GBK/UTF-8 显示乱码，但 focused 测试的 exit code 与 Surefire 计数可正常判读。
- E / F / J 虽为 BUILD SUCCESS，Logback 初始化仍尝试写入不可用的 `C:\.wraith\logs` 并输出 appender error；这是当前 Maven 环境的独立日志目录噪声，没有纳入 runtime/tool 边界修复。
