# 跨阶段眼验 Runbook

> **适用版本**:清债波 2（`feat/debt-sweep-2`）合并 main 后。
> **必要前置**:每一项均需先完成以下两步，再按各节说明操作：
> 1. `mvn clean package -DskipTests` → 将 `target/wraith-1.0-SNAPSHOT.jar` 装入 `~/.wraith/wraith.jar`（备份旧 jar：`cp ~/.wraith/wraith.jar ~/.wraith/wraith.jar.bak`）
> 2. `cd desktop && npm run dev`（桌面 Electron 窗口正常启动）

---

## 目录

| # | 区域 | 说明 |
|---|---|---|
| A | [真图片 → DeepSeek vision](#a-真图片--deepseek-vision) | 支持识别 / 不支持时降级文案 |
| B | [真实 provider 切换 + resume 恢复](#b-真实-provider-切换--resume-恢复) | 切换一轮对话 + 切后 resume 恢复新 provider + key 失效回退横幅 |
| C | [真 MCP server 全链路](#c-真-mcp-server-全链路) | 添加 → ready → 模型调用工具 → 审批弹窗 → @-mention 展开 |
| D | [切项目 mcp.json 重载 + 本会话放行不残留](#d-切项目-mcpjson-重载--本会话放行不残留) | reattach 红线 |
| E | [【清债波 2 新增】MCP 冷启动期间不冻结 UI](#e-清债波-2-新增-mcp-冷启动期间不冻结-ui) | T1 修复的眼验（npx 冷拉期间操作不阻塞） |
| F | [【清债波 2 新增】自动化触发失败后续任务仍能运行](#f-清债波-2-新增-自动化触发失败后续任务仍能运行) | T2 修复：spawn 同步抛后不砖死 |
| G | [【清债波 2 新增】提交失败出现可见错误横幅](#g-清债波-2-新增-提交失败出现可见错误横幅) | T3 修复：断后端 / 被拒时用户可见提示 |
| H | [真 30s tick 到点触发自动化任务](#h-真-30s-tick-到点触发自动化任务) | macOS 通知点击唤起面板 |
| I | [app 退出时运行中任务落 interrupted](#i-app-退出时运行中任务落-interrupted) | stopAll 正确写盘 |
| J | [附件超限友好文案](#j-附件超限友好文案) | 单文件 / 轮次 / 图片三级上限 |
| K | [搜索大列表体感](#k-搜索大列表体感) | 侧栏过滤实时响应 |
| L | [workspace-switch 手速点重选被禁](#l-workspace-switch-手速点重选被禁) | 提交 / 编辑重发中禁止切换目录 |
| M | [真沙箱「本次放行网络」联动](#m-真沙箱本次放行网络联动) | 勾选后当条通、下条不通 |
| N | [真 java 落盘 / list / resume 端到端](#n-真-java-落盘--list--resume-端到端) | 断连重连自动 resume |

---

## A 真图片 → DeepSeek vision

### 前置
- `~/.wraith/config.json` 配置了支持 vision 的 provider（DeepSeek-V3 / V4 等），`apiKey` 已填真实值（**不要把 key 提交到仓库**）。
- 本机磁盘有一张 PNG/JPEG 图片，路径已知，文件大小 ≤ 2 MB。
- 已重建 `~/.wraith/wraith.jar` + `npm run dev`。

### 步骤（支持 vision 分支）
1. 在 Composer 点击附件图标（或拖入图片），选择本地图片文件。
2. 输入文字："这张图片里有什么内容？"，点击发送。
3. 等待模型回复。

### 预期（支持 vision）
- 模型返回对图片内容的文字描述（如 "图中是一只猫" 等），不出现报错或纯占位文案。
- Composer 图片缩略图正常显示，发送后消息项中有图片附件标记。

### 步骤（不支持 vision / 超图片上限 4 MB 分支）
1. 将当前 provider 切换为不支持图片输入的模型（或上传 > 4 MB 的大图）。
2. 附上图片后点击发送。

### 预期（降级文案）
- 应出现友好错误文案（如「图片附件不受支持，已作为文本占位发送」或「文件过大，单图限 4 MB」），**不**出现崩溃或纯白屏。
- 对话仍可继续（输入框可发下一条消息）。

### 若失败 = 真 bug
- 支持 vision 分支无任何图片描述 → 图片未随请求发出，或 base64 编码路径断裂。
- 超限时无文案、崩溃、Composer 卡死 → 附件限制校验或降级分支未触发。

---

## B 真实 provider 切换 + resume 恢复

### 前置
- `~/.wraith/config.json` 至少配置两个 provider（如 `deepseek` 和 `freellmapi`），两者 `apiKey` 均已填真实值。
- 已重建 jar + `npm run dev`。

### 步骤（切换一轮对话）
1. 当前 provider 为 provider-A，发送一条消息，等待回复（确认对话正常）。
2. 点击 Composer 右侧 model chip / provider 下拉，切换为 provider-B。
3. 再发一条消息，等待回复。
4. 检查 model chip 显示是否已更新为 provider-B 的模型名。

### 预期
- 切换后 model chip 更新为 provider-B 名称。
- 第二条回复确实来自 provider-B（可从响应风格或日志判断）。
- 不出现旧 provider 的 API key 泄漏到界面（打开开发者工具 Network 面板，确认请求头无 `apiKey` / `baseUrl` 字段回传给前端）。

### 步骤（切后 resume 恢复新 provider）
1. 在上述 provider-B 会话中发一条消息后，点击侧栏新建会话（或关闭/重启 `npm run dev`）。
2. 重新打开应用，从侧栏点击之前使用 provider-B 的会话。
3. 观察 model chip。

### 预期
- resume 后 model chip 显示 provider-B 名称（而非默认 provider-A）。

### 步骤（key 失效回退横幅）
1. 在 `~/.wraith/config.json` 将某个 provider 的 `apiKey` 改为无效值（如 `"INVALID_KEY"`），保存。
2. 切换到该 provider，发一条消息。

### 预期
- 出现回退横幅提示（如「provider XXX key 无效，已回退默认 provider」），提示可 dismiss。
- 对话自动回退到有效 provider 继续工作，不白屏不崩溃。

### 若失败 = 真 bug
- resume 后 model chip 仍显示 provider-A → `session.resume` 返回的 `provider`/`model` 字段未被桌面消费。
- key 失效无任何横幅 → `modelFallback` 通知未路由到 `model-fallback-banner`。

---

## C 真 MCP server 全链路

### 前置
- 已安装 Node.js，可执行 `npx @modelcontextprotocol/server-filesystem --help`（首次会拉包）。
- 准备一个测试目录，如 `~/Desktop/mcp-test-dir`（需存在）。
- 已重建 jar + `npm run dev`。

### 步骤
1. 打开 Plugins 面板（侧栏点击插件图标）。
2. 点击「添加 MCP server」，填写：
   - **名称**：`fs-test`
   - **命令**：`npx`
   - **参数**：`@modelcontextprotocol/server-filesystem ~/Desktop/mcp-test-dir`
3. 保存，观察状态徽标变化（STARTING → READY）。
4. 在 Composer 输入 `@fs-test` 触发 @-mention，确认候选列表展开（列出 server 工具）。
5. 发送一条消息触发文件系统工具（如"列出 ~/Desktop/mcp-test-dir 中的文件"）。
6. 等待审批弹窗出现，点击「本次放行」。
7. 确认工具结果返回并展示在对话视图中。

### 预期
- server 状态在 30 s 内变为 READY（npx 冷拉可能需要 1–3 分钟，首次可放宽；再次运行应 < 10 s）。
- @-mention 下拉展开后显示 `fs-test` 的工具列表（如 `read_file`、`list_directory` 等）。
- 审批弹窗含工具名称与参数，可正常确认/拒绝。
- 工具结果（文件列表）出现在对话 transcript 中。

### 若失败 = 真 bug
- server 永远停在 STARTING 或 ERROR → McpServerManager 冷拉路径断裂（检查 server 日志区）。
- @-mention 展开为空 / 不展开 → AtMentionExpander 未获取工具列表，或 @-mention 过滤错误。
- 审批弹窗未出现 → `tool_calls` 路由或 `hitl` 通道断裂。

---

## D 切项目 mcp.json 重载 + 本会话放行不残留

### 前置
- 准备两个独立工作区目录，记为 `dir-A` 和 `dir-B`。
- 在 `dir-A/.wraith/mcp.json` 配置一个 MCP server（如 C 节的 `fs-test`）；`dir-B` 无 MCP 配置。
- 已重建 jar + `npm run dev`。

### 步骤（切项目后 mcp.json 重载）
1. 在 Composer 选择 `dir-A` 作为工作区，打开 Plugins 面板，确认 `fs-test` 出现并 READY。
2. 对 `fs-test` 某工具点击「本会话放行」（在审批弹窗中选 APPROVED_ALL）。
3. 通过 ProjectSwitcher 切换到 `dir-B`。
4. 打开 Plugins 面板。

### 预期（重载）
- 切换到 `dir-B` 后，Plugins 面板中不再显示 `fs-test`（`dir-B` 无 MCP 配置）。
- `dir-B` 的会话不共享 `dir-A` 的 server。

### 步骤（本会话放行不残留 — reattach 红线）
1. 切回 `dir-A`，在新会话中对 `fs-test` 工具调用前，审批弹窗不应预先放行（应重新弹窗询问）。
2. 关闭 `npm run dev` 后重新启动，重连同一工作区 `dir-A`，同样触发工具调用。

### 预期（不残留）
- 重新会话后「本会话放行」状态清零，仍需重新审批，不可跨会话自动通行。

### 若失败 = 真 bug
- 切换工作区后旧 server 仍显示 → `reattach` 路径未按工作区隔离重载 mcp.json。
- 新会话无需审批直接放行 → `reattach` 未清除 approval 状态，违反安全约束。

---

## E 【清债波 2 新增】MCP 冷启动期间不冻结 UI

> 对应 Task 1 修复：`McpServerManager` 中 `client.initialize()` 冷拉移出内置锁，`reloadFromConfig` / `reattach` 不再被阻塞。

### 前置
- 准备一个通过 `npx` 拉包启动的 MCP server（首次启动会冷拉，耗时数十秒）。
- 已重建 jar + `npm run dev`。

### 步骤
1. 添加一个需要 `npx` 首次冷拉的 MCP server（清除 npx 缓存可用 `npm cache clean --force`），使其处于 STARTING 状态（冷拉中）。
2. **同时**（不等 server READY）：在 Composer 发送一条普通对话消息（不涉及该 server）。
3. **同时**：在 Plugins 面板点击另一个已有 server 的「停用」按钮。
4. 等待冷拉完成，观察 server 最终状态。

### 预期
- 冷拉期间，对话消息正常发出并收到回复（UI 不卡顿、RPC 调用未被阻塞）。
- 点击「停用」后立即得到 UI 反馈（server 状态变化），不需等到冷拉结束。
- 冷拉完成后 server 正常变为 READY（或 ERROR），不影响其他 server。

### 若失败 = 真 bug
- 冷拉期间发消息超时 / 无响应 → `initialize()` 冷拉仍持锁，dispatch 线程被阻塞（T1 修复未生效）。
- 停用按钮无响应直到 server READY → `disable` RPC 仍在等锁。

---

## F 【清债波 2 新增】自动化触发失败后续任务仍能运行

> 对应 Task 2 修复：`automationRunner.ts` `spawn` 同步抛兜底，并发槽正常释放。

### 前置
- 在自动化面板创建两个任务：
  - **任务 1**：命令设为一个肯定报错的值（如 `/nonexistent_command_xyz`）。
  - **任务 2**：命令设为一个正常命令（如 `echo "hello"`）。
- 已重建 jar + `npm run dev`。

### 步骤
1. 手动点击任务 1 的「立即运行」，等待其失败（状态变为 `failed`）。
2. 立即点击任务 2 的「立即运行」。
3. 等待任务 2 完成。

### 预期
- 任务 1 以 `failed` 状态结束，运行历史有失败记录。
- 任务 2 正常触发并完成（`completed`），**不会**永久停在「运行中」或无响应。
- 自动化调度槽已释放，后续任务可正常排队。

### 若失败 = 真 bug
- 任务 2 的「立即运行」点击后无任何反应 / 永久 pending → 并发槽卡死，T2 修复未生效（`spawn` 同步抛未兜底导致 `exited` 永不 resolve）。

---

## G 【清债波 2 新增】提交失败出现可见错误横幅

> 对应 Task 3 修复：`handleSubmit` / `handleEditMessage` catch 块置 `submitError` state，渲染错误横幅。

### 前置
- 已重建 jar + `npm run dev`。
- 模拟后端断开：启动 app 后，在终端 `kill` 掉 java app-server 进程（或拔掉网络让 DeepSeek 请求必失败）。

### 步骤（提交失败）
1. 后端已断开 / 网络不通状态下，在 Composer 输入一条消息，点击发送。
2. 观察界面是否出现错误横幅。
3. 点击横幅上的「×」关闭按钮。
4. 恢复后端，再次发送一条消息，确认横幅消失。

### 步骤（编辑消息失败）
1. 在已有对话中点击某条 user 消息旁的编辑图标，修改内容后提交。
2. 同样在后端断开时观察横幅。

### 预期
- 发送失败后，对话视图顶部（或 Composer 上方）出现红色错误横幅，文案包含可读的失败原因（如「提交失败，请检查网络或 provider 配置」）。
- 横幅带 dismiss 按钮，点击后横幅消失。
- 下次成功提交后横幅自动清除。
- 编辑消息失败时同样出现横幅（复用同一机制）。

### 若失败 = 真 bug
- 提交失败后界面无任何提示（仅 console.error）→ `SubmitErrorBanner` 未渲染，T3 修复未生效。
- 横幅文案暴露 API key / URL（含 `sk-` 前缀或 `https://` 地址）→ 安全问题，sanitizer 未工作。

---

## H 真 30s tick 到点触发自动化任务

### 前置
- 在自动化面板创建一个「每分钟」触发的任务（或直接编辑 `automations.json` 将 `nextRunAt` 设为当前时间 + 35 s）。
- macOS 系统通知权限已为 Wraith 授权。
- 已重建 jar + `npm run dev`。

### 步骤（tick 触发）
1. 保持 app 前台运行，等待 35 s（最多 60 s）。
2. 观察自动化面板，运行历史列表是否新增一条记录。

### 步骤（macOS 通知点击唤起面板）
1. 将 app 最小化到后台（Dock 缩小），等待下一次触发。
2. 收到系统通知时，点击通知。
3. 观察 app 窗口是否弹回前台，且自动化面板打开。

### 步骤（app 退出运行中任务落 interrupted）
1. 手动触发一个耗时较长的任务（如 `sleep 30`）。
2. 任务运行中时，通过菜单「Quit Wraith」退出 app。
3. 重新启动 app，查看该任务的运行历史。

### 预期
- tick 按时触发（误差 ≤ 30 s）；每次触发仅运行一次，不重复。
- 通知点击后 app 窗口置前，自动化面板展开。
- 退出后重启，该任务历史状态为 `interrupted`（不是 `running` 或空）。
- 退出后用 `ps aux | grep wraith` 确认无孤儿 java 进程残留。

### 若失败 = 真 bug
- tick 未触发 → 调度器 `computeNextRun` 或 tick 定时器未激活。
- 通知点击无响应 → `isDestroyed()` 守卫过于保守，或 notification 事件未接线。
- 退出后任务仍显示 `running` → `stopAll` 未写盘 `interrupted`，T4（summaryOf 空安全）或 I-6 修复未生效。
- 退出后有孤儿进程 → `will-quit` 信号链断裂。

---

## I app 退出时运行中任务落 interrupted

> 此项已在 H 节「app 退出」步骤中覆盖，此处补充侧重点。

### 前置
- 同 H 节。

### 步骤
1. 启动一个使用真实 app-server 子进程的自动化任务（需 `WRAITH_E2E_USERDATA` 外真实 session）。
2. 任务运行期间强制退出 app（Cmd+Q 或菜单 Quit）。
3. 重启 app，打开自动化面板查看历史。
4. 执行 `ps aux | grep wraith` 验证孤儿进程。

### 预期
- 任务历史中该条记录状态为 `interrupted`，`endedAt` 已写入。
- 无 wraith/java 孤儿进程。

### 若失败 = 真 bug
- 状态为 `running` → `finishRun` 未被 `stopAll` 调用，或 `summaryOf` 崩溃导致写盘中断。
- 有孤儿进程 → `will-quit` SIGTERM / stdin EOF 未正确发出。

---

## J 附件超限友好文案

### 前置
- 准备：单文件 > 512 KB 的文本文件，单图 > 4 MB 的图片，累计 > 2 MB 的多个文本文件。
- 已重建 jar + `npm run dev`。

### 步骤
1. 在 Composer 附件区选择单个 > 512 KB 的文本文件，点击发送。
2. 选择单图 > 4 MB 的图片，点击发送。
3. 选择多个文本文件，累计超过 2 MB / 轮上限，点击发送。

### 预期
- 每种超限场景均出现友好中文文案（如「单文件限 512 KB」「图片限 4 MB」「本轮附件总量限 2 MB」），**不**出现崩溃或纯英文技术报错。
- 超限时不发出请求，对话无 `turn.failed` 出现（本地校验拦截）。

### 若失败 = 真 bug
- 出现未处理异常 / 白屏 → 前端附件大小校验断路，或 `turn.failed` 合成路径崩溃。
- 文案为英文技术栈错误（如 "PAYLOAD_TOO_LARGE"）→ 友好文案映射缺失。

---

## K 搜索大列表体感

### 前置
- 侧栏会话列表 ≥ 20 条（可通过多次新建会话积累，或手动写 `~/.wraith/sessions/` 测试数据）。
- 已重建 jar + `npm run dev`。

### 步骤
1. 点击侧栏搜索框，逐字输入一个关键词（每字间无需停顿）。
2. 观察会话列表过滤响应速度。
3. 清空搜索框，列表恢复全部。

### 预期
- 输入每个字符后列表在 **100 ms 内**（视觉上即时）更新过滤结果，无明显卡顿。
- 搜索范围覆盖会话标题 + 工作区名称（两分区均过滤）。
- 搜索结果激活态（高亮）正确。

### 若失败 = 真 bug
- 输入字符后列表响应明显延迟（> 500 ms）→ 过滤逻辑阻塞渲染线程（可能需要 memo 优化）。
- 清空后列表不恢复 → query 状态重置逻辑断裂。

---

## L workspace-switch 手速点重选被禁

### 前置
- 已重建 jar + `npm run dev`。

### 步骤
1. 在 Composer 输入消息后迅速点击发送，同时（发送进行中）立即点击 ProjectSwitcher 试图切换工作区。
2. 观察切换是否被禁止（按钮 disabled 或操作被阻止）。
3. 同样在编辑消息并重发过程中尝试切换。

### 预期
- 提交 / 编辑重发期间（`running` 状态），ProjectSwitcher 的工作区切换操作被禁用（无法点击或点击无效）。
- 提交完成后切换恢复正常。

### 若失败 = 真 bug
- 手速点击切换成功 → Task 2（清债波）的竞态关窗修复失效，可能导致会话串台（旧工作区 session 继续收到新工作区回复）。

---

## M 真沙箱「本次放行网络」联动

### 前置
- macOS 沙箱可用（非 VM；`sandbox-exec` 存在于 `/usr/bin/sandbox-exec`）。
- 工作区已启用沙箱（Composer 显示沙箱徽标）。
- 已重建 jar + `npm run dev`。

### 步骤
1. 触发一个需要执行 `curl https://example.com` 的工具（可要求模型执行 shell 命令）。
2. 审批弹窗出现时，勾选「本次放行网络」（`allowNetworkOnce`），点击「本次放行」。
3. 确认 `curl` 命令正常返回 HTTP 响应。
4. **紧接着**再次触发另一条 `curl` 命令（不再勾选放行网络）。
5. 观察第二条命令是否被沙箱拦截（网络请求失败）。

### 预期
- 第一条 `curl`：网络放行，命令成功返回（如 HTTP 200 或页面内容）。
- 第二条 `curl`：网络未放行，命令失败（如 `Operation not permitted` 或连接超时）。
- 「本次放行」标记在第一条命令完成后即被消费清除（不延续到第二条）。

### 若失败 = 真 bug
- 第二条 `curl` 也成功 → `consumeNetworkOnce`（`grantNetworkOnce` 消费即清）逻辑断裂，或早退兜底未生效，Phase C 安全回归。
- 第一条 `curl` 仍被拦截 → `allowNetworkOnce` 未传给沙箱策略。

---

## N 真 java 落盘 / list / resume 端到端

### 前置
- `~/.wraith/config.json` 已配置有效 provider 和 apiKey（**不要提交到仓库**）。
- 已重建 jar + `npm run dev`。

### 步骤（落盘）
1. 开启一个新会话，发送 3 条消息，等待全部回复完成。
2. 在终端检查 `~/.wraith/sessions/` 目录，确认新建了会话目录，其中有 `history.jsonl` 或等价文件，且行数与消息轮次匹配。

### 步骤（list）
1. 关闭 `npm run dev`，重新启动。
2. 侧栏会话列表应显示刚才的会话（标题、时间戳等元数据正确）。

### 步骤（resume）
1. 在侧栏点击该会话。
2. 对话 transcript 回放出之前所有消息（静态回放），不重新发请求。
3. 继续发一条新消息，等待回复，确认会话正常延续。

### 步骤（断连重连 auto-resume）
1. 在会话进行中，在终端手动 `kill` java 进程（模拟断连）。
2. 等待断连横幅出现，确认出现后等待 app 自动重连（约 5–10 s）。
3. 确认自动 resume 后 transcript 内容与断连前一致，且可继续对话。

### 预期
- 落盘：`~/.wraith/sessions/<hash>/` 下存在持久化文件，内容非空。
- list：重启后会话在侧栏中可见，元数据正确。
- resume：点击后 transcript 完整回放，新消息正常收发。
- 断连重连：自动 resume，无需手动操作，transcript 不丢失。

### 若失败 = 真 bug
- 落盘后重启侧栏为空 → `session.list` RPC 未读取 `~/.wraith/sessions/`，或 SessionStore 路径计算错误。
- resume 后 transcript 为空 → `session.resume` 未返回历史消息，或 `messagesToItems` 映射断裂。
- 断连后无横幅 / 无自动 resume → 重连逻辑（`reconnect effect`）未激活，或 `session.resume` 返回错误。

---

## 附录：快速参考

| 前置动作 | 命令 |
|---|---|
| 备份 jar | `cp ~/.wraith/wraith.jar ~/.wraith/wraith.jar.bak` |
| 重建 jar | `cd /path/to/wraith && mvn clean package -DskipTests` |
| 装入 jar | `cp target/wraith-1.0-SNAPSHOT.jar ~/.wraith/wraith.jar` |
| 启动桌面 | `cd desktop && npm run dev` |
| 检查孤儿进程 | `ps aux \| grep -i wraith` |
| 查 sessions 落盘 | `ls -lh ~/.wraith/sessions/` |
| 重置 npx 缓存 | `npm cache clean --force` |

> **安全提示**：本 runbook 中所有「apiKey」均指用户在 `~/.wraith/config.json` 中自行配置的本地密钥，**不包含任何实际 key 值**，请勿将含真实 key 的配置文件提交到仓库。
