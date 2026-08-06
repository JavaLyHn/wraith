# Maven 残留 AppServer / Provider 组修复报告

日期：2026-08-06
工作树：`D:\wraith\.worktrees\desktop-git-pill`

## RED 证据

执行：

```powershell
mvn test "-Dtest=AppServerNoModelBootstrapTest,ProviderDefaultSelfHealWiringTest" -DskipTests=false
```

结果：`Tests run: 6, Failures: 1, Errors: 4, Skipped: 0`。

- `AppServerNoModelBootstrapTest` 的对话错误提示断言收到乱码；测试驱动固定按 UTF-8 读取 child stderr，但 Windows child JVM 的 `stderr.encoding` 是 GBK。
- `session.start` 响应明确出现 `chrome-devtools: starting`。这些 provider/bootstrap 测试不验证 MCP，却启动了内建浏览器 MCP。
- 5 个测试方法结束后，JUnit 都无法删除 `@TempDir`；`npx` / 后代进程以临时目录为 cwd，在 Windows 上继续占用目录。

## 最小修复范围

仅修改测试驱动 `AppServerDriver`：

1. child JVM 显式使用 UTF-8 stdout/stderr，与驱动 reader 的协议一致；
2. 在这组非 MCP 测试中显式退订内建 browser MCP；
3. finally 先捕获后代句柄，再终止直接进程与后代进程，超时后强制终止并等待退出；
4. 不修改 `PathGuard`，也不把测试专用清理方法放进生产类。

## GREEN / 验证

修改后重新执行同一 focused test：

```powershell
mvn test "-Dtest=AppServerNoModelBootstrapTest,ProviderDefaultSelfHealWiringTest" -DskipTests=false
```

结果：`Tests run: 6, Failures: 0, Errors: 0, Skipped: 0`，`BUILD SUCCESS`。

- AppServer 无模型中文提示断言通过，证明 child stderr 与 UTF-8 reader 一致；
- 两个测试类均未再出现 `chrome-devtools: starting` 引起的目录占用；
- 所有 `@TempDir` 正常清理，没有 cleanup error；
- 未修改生产 `AppServerMcp` 生命周期，因为这组测试不覆盖真实 MCP 生命周期，测试隔离已足以修复本组根因。
