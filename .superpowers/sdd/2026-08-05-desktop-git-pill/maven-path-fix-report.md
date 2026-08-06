# Maven 路径 / RAG 修复报告

日期：2026-08-06  
工作区：`D:\wraith\.worktrees\desktop-git-pill`

## 范围

仅处理诊断报告 B–E 中下列四组：RAG 测试隔离、AppServer 测试 JSON、Java 搜索对外路径、图片 `file://` Windows drive path。未修改 `PathGuard`，未处理 runtime 组。

## B. RAG 测试隔离

根因：三个测试类把 `wraith.rag.dir` 与项目键硬编码为 POSIX `/tmp`。Windows 将其落到当前驱动器的 `D:\tmp`，该目录位于 workspace-write 范围外，SQLite 打开遗留库后首个写操作得到 `SQLITE_READONLY`。此外，`CodeRetriever` 会正规化项目路径，原始 `/tmp` 项目键与 Windows 绝对项目键不相等。

RED：

```powershell
mvn test '-Dtest=CodeIndexTest,CodeRetrieverTest,VectorStoreTest' -DskipTests=false
```

结果：退出码 1；`Tests run: 10, Failures: 2, Errors: 5, Skipped: 0`。`CodeRetrieverTest` 和 `VectorStoreTest` 在 `clearProject()` 报 `SQLITE_READONLY`，`CodeIndexTest` 两个索引断言失败。

修复：三个测试类统一使用每个测试自己的 `@TempDir/rag-store`；项目键也改为 `@TempDir/project`；保存并在 `@AfterEach` 中恢复或清除原 `wraith.rag.dir`。未修改 `VectorStore`、`CodeIndex` 或 `CodeRetriever` 生产代码。

GREEN：

```powershell
mvn test '-Dtest=CodeIndexTest,CodeRetrieverTest,VectorStoreTest' -DskipTests=false
```

结果：退出码 0；`Tests run: 10, Failures: 0, Errors: 0, Skipped: 0`，`BUILD SUCCESS`。

文件：

- `src/test/java/com/lyhn/wraith/rag/CodeIndexTest.java`
- `src/test/java/com/lyhn/wraith/rag/CodeRetrieverTest.java`
- `src/test/java/com/lyhn/wraith/rag/VectorStoreTest.java`

## C. AppServer workspaceDir 测试 JSON

根因：测试把 Windows `Path.toString()` 直接拼进 JSON；反斜杠形成非法 JSON escape，解析器拒绝该行，`SessionRunnerFactory` 从未被调用，捕获值保持 `UNSET`。生产解析器正确拒绝 malformed JSON。

RED：

```powershell
mvn test -Dtest=AppServerWorkspaceDirTest -DskipTests=false
```

结果：退出码 1；`Tests run: 3, Failures: 1, Errors: 0, Skipped: 0`；`validWorkspaceDirPassedToFactory` 期望 Windows 临时目录，实际为 `UNSET`。

修复：使用 Jackson `ObjectNode` 构造并序列化所有 `session.start` 请求，交由 Jackson 转义 Windows 路径；有效目录由 `@TempDir` 管理。断言仍验证真实 factory 参数、session id 与无效目录错误码。

GREEN：

```powershell
mvn test -Dtest=AppServerWorkspaceDirTest -DskipTests=false
```

结果：退出码 0；`Tests run: 3, Failures: 0, Errors: 0, Skipped: 0`，`BUILD SUCCESS`。

一次并发 Maven 运行曾导致 Surefire discovery 的 `NoClassDefFoundError: AppServer$SessionRunner`（0 tests）；同一 `target` 当时也在写入本任务未运行的 `CommandSandboxTest` 报告。无竞争重跑上面的精确命令后通过，判定为共享 `target` 的并发构建干扰，不计入功能 GREEN。

文件：

- `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerWorkspaceDirTest.java`

## D. Java 搜索路径

待处理。

## E. 图片 file:// Windows drive path

待处理。

## 提交

- RAG / AppServer 阶段提交：待本阶段提交后在最终报告回填。

## 顾虑

- `wraith.rag.dir` 是 JVM 全局属性；本修复逐测试恢复原值，但若未来开启同 JVM 并行执行这些测试类，仍应使用 JUnit 资源锁或改为显式依赖注入。
- Maven 任务共享同一 worktree 的 `target` 时会互相删除/覆盖类文件与 Surefire 报告；验证应避免并发运行。
