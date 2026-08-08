# Desktop test portability design

## Goal

让桌面端测试在 Windows、macOS 和 Linux 上表达相同的行为约束，不把宿主平台的路径规则或权限偶然性误判为产品回归。

## Scope

- 不修改 `petInstall`、`petWindow`、文档库或宠物存储的生产逻辑。
- 不新增依赖、不修改 npm lockfile，也不绕过 Electron 下载的 TLS 校验。
- 只修正已有测试的环境假设，并保留软链接越界防护的测试意图。

## Design

### Soft-link security cases

文档库和宠物存储的软链接用例继续验证「库内链接不得逃逸到库外」。测试建立软链接时若 Windows 返回权限错误（`EPERM`），该用例以明确原因跳过；其它错误仍应抛出。这样有权限的平台持续执行安全断言，而无权限的 Windows 开发机不会把系统策略误报成代码失败。

反斜杠文件名只在 POSIX 平台可作为普通文件名创建。该用例在 Windows 跳过并说明原因；路径校验的其它用例仍会覆盖 Windows 的越界处理。

### Explicit platform inputs

`npxSearchDirs` 和 `resolveNpx` 已把平台作为可注入参数。旧测试必须显式传入 `darwin`，使其验证 macOS 的候选路径和无扩展名 `npx` 规则，而不再依赖运行测试的机器。

`npxSpawnArgs` 的 fallback 测试传入空字符串，而不是 `undefined`：`undefined` 的契约是使用真实 `ComSpec`，空字符串才表达「变量缺失或空白，回落到 cmd.exe」。

`petHtmlTarget` 的生产路径由 Node 的 `path.join` 生成；测试也以 `path.join` 生成期望，因此断言路径结构而不是 POSIX 分隔符。

## Verification

运行受影响的 Vitest 文件，确认 Windows 不再有无权限软链接与路径分隔符失败；在支持软链接的平台，安全用例仍会实际执行。最后运行 `npx vitest run` 和 `npx tsc --noEmit`，并记录任何与本次无关的现有失败。
