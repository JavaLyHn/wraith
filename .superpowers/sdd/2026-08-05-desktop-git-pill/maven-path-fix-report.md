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

根因：Java fallback 在 `Path -> GrepMatch.file` 边界直接使用 `relative.toString()`，Windows 返回反斜杠；同一 `GrepMatch.file` 又被正文和 `suggested_reads` 共用，因此 fallback 与 rg 后端的公开格式不一致。

RED：

```powershell
mvn test -Dtest=CodeSearchGoldenSetTest -DskipTests=false
```

结果：退出码 1；`Tests run: 1, Failures: 1, Errors: 0, Skipped: 0`。期望包含 `src/main/java/com/lyhn/wraith/cli/Main.java:520`，实际正文与 `suggested_reads` 均为 `src\main\java\...`。

修复：仅在 `collectMatches` 生成对外 `fileKey` 时将 `\` 替换为 `/`；glob 过滤继续使用原生 `Path`。

GREEN：

```powershell
mvn test -Dtest=CodeSearchGoldenSetTest -DskipTests=false
```

结果：退出码 0；`Tests run: 1, Failures: 0, Errors: 0, Skipped: 0`（随后与 `ToolRegistryTest` 同跑时该 golden test 仍为 1/1）。

文件：

- `src/main/java/com/lyhn/wraith/tool/JavaCodeSearchEngine.java`

## E. 图片 file:// Windows drive path

根因：`fileUriToLocalPath` 对不以 `/` 开头的 `afterScheme` 一律按 authority/fallback 处理并补前导 `/`；Windows 兼容输入 `file://C:\...` 因此变成 `/C:\...`，文件不存在。percent decode 本身可用，只是输入路径结构已经错误。

RED：

```powershell
mvn test -Dtest=ImageReferenceParserTest -DskipTests=false
```

结果：退出码 1；`Tests run: 10, Failures: 3, Errors: 0, Skipped: 0`；失败正是未编码空格、非 ASCII 与 `%20` 三个 `file://` 用例。

修复：在 POSIX/authority 分支前识别 `字母盘符 + ':' + ('/' 或 '\')`，Windows drive path 原样进入既有 `percentDecodeUtf8`。未将 `file://host/share` 当作本地盘符，也未扩展 UNC 行为。

GREEN：

```powershell
mvn test -Dtest=ImageReferenceParserTest -DskipTests=false
```

结果：退出码 0；`Tests run: 10, Failures: 0, Errors: 0, Skipped: 0`，既有 POSIX/percent decode 相关测试共同通过。

文件：

- `src/main/java/com/lyhn/wraith/image/ImageReferenceParser.java`

## 提交

- `6c323a09 test: 修复 Windows 下 Maven 路径隔离`：RAG / AppServer 测试隔离与本报告初稿。
- Java 搜索 / 图片路径提交：待最终提交后由 `git log` 确认。

## 顾虑

- `wraith.rag.dir` 是 JVM 全局属性；本修复逐测试恢复原值，但若未来开启同 JVM 并行执行这些测试类，仍应使用 JUnit 资源锁或改为显式依赖注入。
- Maven 任务共享同一 worktree 的 `target` 时会互相删除/覆盖类文件与 Surefire 报告；验证应避免并发运行。
- `CodeSearchGoldenSetTest,ToolRegistryTest` 同跑时 golden 始终通过，但 `ToolRegistryTest` 在当前 Windows sandbox 有 3 个既有环境失败（`shouldRunCommandInProjectDirectory`、`shouldTimeoutLongRunningCommandWithoutHanging`、`shouldGlobFilesInsideProject`）；把 `TEMP/TMP` 指到 workspace-local 目录后仍相同。本任务未修改这些命令/glob 路径，按范围留给共享边界审查。

## 最终组合验证

```powershell
mvn test '-Dtest=CodeIndexTest,CodeRetrieverTest,VectorStoreTest,AppServerWorkspaceDirTest,CodeSearchGoldenSetTest,ImageReferenceParserTest' -DskipTests=false
```

结果：退出码 0；`Tests run: 24, Failures: 0, Errors: 0, Skipped: 0`，`BUILD SUCCESS`。
