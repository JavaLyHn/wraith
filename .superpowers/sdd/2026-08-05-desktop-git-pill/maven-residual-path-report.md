# Maven 剩余 PathGuard 路径错误修复报告

日期：2026-08-06
工作区：`D:\wraith\.worktrees\desktop-git-pill`

## RED 证据

在未设置 `TEMP` / `TMP` 的普通环境中运行：

```powershell
mvn test -Dtest=PathGuardTest -DskipTests=false
```

结果为 `10 tests, 0 failures, 4 errors`。四个错误都是测试方法在调用
`root.toRealPath()` 时访问系统临时目录
`C:\Users\LyHn\AppData\Local\Temp\junit*` 被拒绝；并非 `PathGuard`
生产逻辑抛出的策略错误。

## 根因与修复边界

根因是 `PathGuardTest` 使用 JUnit 默认 `@TempDir` 工厂，测试目录因此落在
当前沙箱不可读取真实路径的系统临时目录。修复仅调整测试夹具：把该测试的
临时目录固定在项目 `target/path-guard-test` 下并声明始终清理。生产
`PathGuard`、AppServer 和 MCP 均不修改。

符号链接用例在平台不支持创建符号链接时改为明确 aborted，避免静默返回造成
没有执行断言却被记为通过。

## 验证结果

未设置 `TEMP` / `TMP`，以普通环境再次运行精确命令：

```powershell
mvn test -Dtest=PathGuardTest -DskipTests=false
```

结果：`10 tests, 0 failures, 0 errors, 1 skipped`，`BUILD SUCCESS`。
跳过的是当前 Windows 环境无权限创建符号链接的用例；该状态现在由 JUnit 明确记录，
不再以无断言的成功掩盖。

测试结束后检查 `target/path-guard-test`，剩余临时子目录数为 `0`，证明两个
`@TempDir` 字段均被 `CleanupMode.ALWAYS` 清理。项目级父目录保留为空目录并由
Maven 的 `target/` 生命周期统一管理。
