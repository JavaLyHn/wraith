# 占位兑现波(UI Fulfillment)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 兑现三个 Phase A 占位(spec `docs/specs/2026-07-03-ui-fulfillment.md`):Composer 附件(图片+文本)、模型会话级切换+可设默认、侧栏标题+项目搜索。

**Architecture:** Java 先行(T1-T3 wire 契约)→ 桌面消费(T4-T6)→ 文档(T7)。附件复用既有 `LlmClient.ContentPart` 图片管道;模型切换复用 CLI `/model` 的 `LlmClientFactory.create + agent.setLlmClient` 机件;搜索纯渲染层。

**Tech Stack:** Java 17(AppServer/Agent/SessionStore)、Electron main+React TS、vitest、Playwright。

## Global Constraints

- 分支 `feat/ui-fulfillment`;基线门禁:**Java 944 @ 0F/0E(BUILD SUCCESS)、vitest 155、Playwright 41、tsc 0**;每任务钉增量目标数,零回归。
- 秘钥纪律:`model.list` 等**绝不返回 apiKey/baseUrl 值**(hasKey 布尔);附件内容不进日志(trace 截断);提交前 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"` 无命中;trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`;只 add 本任务文件。
- CLI 路径零行为改动(Main.java 交互循环不动;新能力只经 app-server SessionRunner 暴露)。
- E2E:`WRAITH_E2E_USERDATA` 隔离、零 sleep;mock 保真同任务落地(防 E-1 式掩蔽);既有 41 例零改动(适配需报告列明)。
- 上限常量(spec §1.2):文本单文件 512KB、单轮总量 2MB、图片单张 4MB;错误走 turn.failed 友好文案,不发起 LLM 调用。

## 已钉事实(实现者不必重查)

- `AppServer.handleTurn`(AppServer.java:159-185):`input = params.get("input").asText()`;turn 线程 catch → turn.failed(e.toString())。`SessionRunner` 接口在 :25,`runTurn(String)` :27。
- app-server 的 SessionRunner 实现在 cli/Main.java:1161-1200:`runTurn` → AtMentionExpander.expand → `agent.run(expanded)`;`persistTurn` → `sessionStore.persist(agent.getConversationHistory())`;initialize result `model` 字段在 :1246。
- `LlmClient.ContentPart`(LlmClient.java:35-54):`text(t)` / `imageBase64(b64, mimeType)` / `imageUrl(u)`;`Message.user(String)` :73、`Message.user(List<ContentPart>)` :77;`AbstractOpenAiCompatibleClient` 已支持 image part 序列化(:307-313)。
- CLI `/model` 机件(Main.java:603-631):`LlmClientFactory.create(provider, config)`(无 key 返回 null)、`config.setDefaultProvider + save`、`agent.setLlmClient(client)`(Agent.java:77,连带 memory/compactor);`llmClient.getModelName()/getProviderName()` 存在。
- `WraithConfig`:providers map、`getApiKey(p)/getModel(p)`(config 值优先,env/.env 兜底);`SessionMeta` 已含 provider/model 字段(SessionStore.java:103)。
- 桌面:preload `submitTurn(input)`(preload/index.ts:13/:62)→ main `wraith:submitTurn`(index.ts:220-226)→ `client.request('turn.submit', {sessionId, input})`;Composer 附件占位钮 testid="attach"(Composer.tsx:136-148);模型只读 chip(:151-159,tooltip "模型/强度切换在后续阶段");Sidebar 搜索 disabled 项 key 'search'(Sidebar.tsx:30);ProjectSwitcher 用 Popover。
- mock fixture:`WRAITH_E2E_RECORD` 记录请求(method+params),E2E 以 record 断言 wire。

---

### Task 1: Java 附件 wire——参数解析、校验上限、文本注入

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java`(handleTurn :159-185;SessionRunner 接口 :25)
- Create: `src/main/java/com/lyhn/wraith/runtime/appserver/TurnAttachments.java`(纯函数解析/校验/注入)
- Test: `src/test/java/com/lyhn/wraith/runtime/appserver/TurnAttachmentsTest.java`(新,≥6)+ `AppServerTest` 风格 dispatch 用例 1 条

**Interfaces:**
- Consumes: 既有 handleTurn 线程模型(catch → turn.failed)。
- Produces(后续任务依赖,逐字):
  - wire:`turn.submit` params 增可选 `attachments: [{ "path": string, "kind": "image"|"text" }]`;
  - `TurnAttachments.Resolved resolve(JsonNode attachmentsOrNull) throws IOException`——返回 `record Resolved(String textPrefix, List<LlmClient.ContentPart> imageParts, List<String> imageNames)`;校验失败抛 `IOException(友好中文文案,含文件名)`;
  - `SessionRunner` 增 default 重载:`default String runTurn(String input, java.util.List<com.lyhn.wraith.llm.LlmClient.ContentPart> imageParts, java.util.List<String> imageNames) throws Exception { return runTurn(input); }`(T2 覆写;本任务 AppServer 改调重载)。

- [ ] **Step 1: TDD 纯函数**——TurnAttachmentsTest 先红:
  - 文本注入格式:`resolve` 对 kind=text 文件产出 `textPrefix` = 依次 ` ```<文件名>\n<内容>\n``` `+空行,末尾拼正文由调用方做;
  - 上限:text >512KB 抛(文案含文件名);单轮总量 >2MB 抛;image >4MB 抛;
  - 图片:kind=image 读 bytes→Base64→`ContentPart.imageBase64(b64, mime)`(mime 按扩展 png/jpeg/gif/webp 映射),`imageNames` 记文件名;
  - 路径不存在/是目录/不可读 抛;kind 非法 抛;**kind=image 但扩展不在映射内 抛**(后端复核渲染端判定,spec §1.2);attachments 为 null/空 → Resolved("",[],[])。
  用 `Files.createTempFile` 构造真文件,禁 Mockito。

- [ ] **Step 2: 实现 TurnAttachments**(常量 `TEXT_MAX=512*1024; TOTAL_MAX=2*1024*1024; IMAGE_MAX=4*1024*1024`),跑绿。

- [ ] **Step 3: handleTurn 接线**——input 提取后:

```java
TurnAttachments.Resolved att;
try {
    att = TurnAttachments.resolve(params == null ? null : params.get("attachments"));
} catch (IOException e) {
    String turnId = "turn_" + turnSeq.incrementAndGet();
    writer.result(msg.id(), Map.of("turnId", turnId, "status", "running"));
    writer.notify("turn.started", Map.of("sessionId", sessionId, "turnId", turnId));
    writer.notify("turn.failed", Map.of("sessionId", sessionId, "turnId", turnId, "error", "附件错误: " + e.getMessage()));
    return;
}
String effectiveInput = att.textPrefix().isEmpty() ? input : att.textPrefix() + input;
```
turn 线程内 `session.runTurn(input)` 改 `session.runTurn(effectiveInput, att.imageParts(), att.imageNames())`。(校验失败路径保持 wire 时序 started→failed,与既有失败形状一致——渲染端已按 turn.failed 处理。)

- [ ] **Step 4: dispatch 用例**——AppServerTest 既有 harness 手法:提交带一个临时文本附件的 turn.submit,fake SessionRunner 记录收到的 input,断言含 ```` ```<文件名> ```` 块与正文;再一条超限断言 turn.failed 通知含 "附件错误"。

- [ ] **Step 5: 门禁**:`mvn test -Dtest=TurnAttachmentsTest,AppServerTest -DskipTests=false` 全绿;全量 **944+7=951 @ 0F/0E**(新增数以实际为准,报告钉数)。

- [ ] **Step 6: 提交** `feat(appserver): turn.submit 附件参数(文本注入+图片parts+三级上限,失败即 turn.failed)`

---

### Task 2: Java 图片 parts 进 Agent + 落盘占位 + trace 截断

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/agent/Agent.java`(run 入口增重载)
- Modify: `src/main/java/com/lyhn/wraith/cli/Main.java`(:1163-1171 app-server runner 覆写三参 runTurn)
- Modify: `src/main/java/com/lyhn/wraith/session/SessionMessageCodec.java`(image parts 落盘占位)
- Modify: `src/main/java/com/lyhn/wraith/llm/LlmTraceLogger.java`(base64 截断)
- Test: `src/test/java/com/lyhn/wraith/session/SessionMessageCodecTest.java`(+2)、Agent 侧最小历史形状用例(放既有 Agent 测试文件,+1)

**Interfaces:**
- Consumes: T1 的 `Resolved`/三参 runTurn 重载。
- Produces: `Agent.run(String input, List<LlmClient.ContentPart> extraImageParts, List<String> imageNames)`——语义:本轮用户消息为**单条** `Message.user(parts)`,parts = `[text("附件图片: " + join(imageNames, ", ")), ...extraImageParts, text(input)]`(无图片时走既有 `run(String)` 路径不变);落盘:codec 对含 image part 的消息**丢弃 image parts、保留 text parts 拼接**(resume 回放可见 "附件图片: x.png" 占位,不存 base64)。

- [ ] **Step 1: 读 Agent.run(String) 的用户消息构建点**(memoryManager.addUserMessage :131 一带)与 SessionMessageCodec 的 Message 序列化现状(parts 消息目前怎么写盘——很可能只写 content 串),把现状写进报告。
- [ ] **Step 2: TDD codec**:先红两例——含 image part 的 user 消息 round-trip 后无 image、text 拼接保留;纯文本消息 round-trip 不变。实现:序列化时 `hasContentParts()` 消息 → 拼接 text parts 为 content(image 丢弃);反序列化维持既有。
- [ ] **Step 3: Agent 重载**——最小侵入:重载内构建 parts 版用户消息入历史(替代 addUserMessage 的纯文本路径,细节按 Step 1 读到的真实结构;不改 run(String) 行为),后续循环复用既有逻辑。补 1 条历史形状用例(run 重载后 conversationHistory 末条 user 消息 parts 结构断言;LLM 调用用现有可注入桩/最小 fake,以该测试文件既有手法为准)。
- [ ] **Step 4: Main.java runner 覆写**:

```java
public String runTurn(String input, java.util.List<com.lyhn.wraith.llm.LlmClient.ContentPart> imageParts,
                      java.util.List<String> imageNames) throws Exception {
    String expanded = input;
    com.lyhn.wraith.mcp.McpServerManager m = appServerMcp.manager();
    if (m != null) expanded = new com.lyhn.wraith.mcp.mention.AtMentionExpander(m).expand(input);
    return imageParts == null || imageParts.isEmpty()
            ? agent.run(expanded) : agent.run(expanded, imageParts, imageNames);
}
```
- [ ] **Step 5: LlmTraceLogger 截断**——请求体序列化处对 `imageBase64` 字段值截为前 64 字符+`…[truncated]`(读文件现状定落点;若 trace 记的是原始 JSON,正则替换 base64 长串)。
- [ ] **Step 6: 门禁**:相关测试类全绿;全量 **951+3=954 @ 0F/0E**(实际数报告钉)。
- [ ] **Step 7: 提交** `feat(agent+session): 图片附件单条 parts 用户消息+落盘占位(去 base64)+trace 截断`

---

### Task 3: Java model.* 三 RPC + resume 恢复 provider

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/runtime/appserver/AppServer.java`(dispatch 三 case + SessionRunner 三 default 方法)
- Modify: `src/main/java/com/lyhn/wraith/cli/Main.java`(runner 覆写三方法;resume 恢复;llmClient 引用改可变持有——读 :1155 前的构造区确定现状)
- Test: `src/test/java/com/lyhn/wraith/runtime/appserver/AppServerModelTest.java`(新,≥6)

**Interfaces(wire,逐字;T5 消费):**
- `model.list` → `{ current: {provider, model}, default: string, providers: [{name, model, hasKey}] }`(model 取 `config.getModel(name)` 可空串;**负断言:结果序列化不含 apiKey/baseUrl 值**);
- `session.setModel` params `{provider}` → 成功 `{provider, model}`;无 key/未知 provider → error -32602 "未配置 <p> 的 API Key"(经 `LlmClientFactory.create` null 判);切换仅会话级:`agent.setLlmClient(newClient)`,**不写 config**;
- `config.setDefaultProvider` params `{provider}` → 校验存在+有 key → `config.setDefaultProvider+save` → `{ok:true}`;
- `session.resume` 行为扩展:resume 后按 `meta.provider` 尝试 `LlmClientFactory.create`;成功 → setLlmClient;失败 → 保持当前 client,resume result 增 `modelFallback: true`;resume result 一并增 `{provider, model}`(实际生效值)。

- [ ] **Step 1: TDD dispatch 测试**(AppServerMcpTest 的 harness 手法,fake runner 可控):model.list 形状+hasKey 置灰位+**无 key 值负断言**(整包 JSON 字符串 not contains 已知假 key);setModel 成功/无 key 错误;setDefaultProvider 校验;resume fallback 标志。
- [ ] **Step 2: AppServer 三 case**(`model.list`/`session.setModel`/`config.setDefaultProvider`,dispatch 风格照 :86-102 既有;SessionRunner default 返回 null/UnsupportedOperation → -32000,与 mcp() 缺省模式一致)。
- [ ] **Step 3: Main runner 覆写**——机件全部现成(已钉事实第 4 条);注意 app-server 分支的 `agent`/`llmClient` 持有方式,setModel 后 initialize 已发的 model 字段不回改(chip 由 model.list 刷新,T5 处理)。resume 恢复接在 :1177-1181 的 resume 覆写内。
- [ ] **Step 4: 门禁**:新测试类全绿;全量 **954+6=960 @ 0F/0E**(实际数报告钉);CLI 交互路径零 diff(git diff 核对 Main.java 只动 app-server runner 区)。
- [ ] **Step 5: 提交** `feat(appserver): model.list/session.setModel/config.setDefaultProvider 三 RPC+resume 按会话恢复 provider(不回传 key)`

---

### Task 4: 桌面附件——选择 IPC、chips、submit 携带、E2E

**Files:**
- Modify: `desktop/src/main/index.ts`(新 `wraith:pickAttachments`;`wraith:submitTurn` 透传 attachments)
- Modify: `desktop/src/preload/index.ts`(pickAttachments;submitTurn 签名扩展)
- Modify: `desktop/src/renderer/components/Composer.tsx`(附件钮启用、chips 区、提交清空、running 禁用)
- Modify: `desktop/src/renderer/App.tsx`(attachments 状态、handleSubmit 携带)
- Modify: `desktop/test/fixtures/mock-appserver.mjs`(turn.submit 的 attachments 已随 params 入 record,无需改;核对即可)
- Test: `desktop/test/e2e/shell.e2e.ts`(+2:T42 附件链、T43 移除 chip)、vitest +1(kind 判定纯函数)

**Interfaces:**
- Consumes: T1 wire `attachments:[{path,kind}]`。
- Produces: preload `pickAttachments(): Promise<{path,name,kind}[]>`(main 侧 `dialog.showOpenDialog(mainWindow, {properties:['openFile','multiSelections'], filters:[图片扩展,文本/代码扩展,All]})`,**模态**;E2E 分支:`WRAITH_E2E_ATTACH` env(JSON 数组)直接返回注入值——照 `WRAITH_E2E_PICK` 先例);`submitTurn(input, attachments?)` 三层透传;kind 判定 `desktop/src/shared/attachmentKind.ts`:图片扩展 png/jpg/jpeg/gif/webp → image,其余 → text。

- [ ] **Step 1: shared/attachmentKind.ts + vitest**(先红后绿,大小写扩展/无扩展→text)。
- [ ] **Step 2: main IPC + preload**(submitTurn 第二参可选,`client.request('turn.submit', {sessionId, input, ...(attachments?.length ? {attachments: attachments.map(a=>({path:a.path, kind:a.kind}))} : {})})`)。
- [ ] **Step 3: Composer/App**——attach 钮启用(testid 不变;running 禁用与输入框同步);选中后 chips 行(testid `attachment-chip`,文件名+移除钮 testid `attachment-remove`);提交携带并清空;tooltip 移除"后续阶段"文案。
- [ ] **Step 4: E2E**——T42:`WRAITH_E2E_ATTACH` 注入一个临时文本文件路径 → 点 attach → chip 出现 → 提交 → record 断言 turn.submit params.attachments[0].path/kind;T43:两附件移除其一后提交,record 断言只剩一个。
- [ ] **Step 5: 门禁**:tsc 0;vitest **155+1=156**;`npm run build && npx playwright test` **41+2=43**。
- [ ] **Step 6: 提交** `feat(desktop): Composer 附件(选择/chips/移除/随 turn 提交)+kind 判定`

---

### Task 5: 桌面模型下拉+设为默认+E2E

**Files:**
- Modify: `desktop/src/main/index.ts` + `desktop/src/preload/index.ts`(modelList/setModel/setDefaultProvider 三透传)
- Create: `desktop/src/renderer/components/ModelSwitcher.tsx`(Popover,ProjectSwitcher 同款风格)
- Modify: `desktop/src/renderer/components/Composer.tsx`(:151-159 只读 chip 换 ModelSwitcher;「强度」字样移除)
- Modify: `desktop/test/fixtures/mock-appserver.mjs`(model.list/session.setModel/config.setDefaultProvider 最小实现:内存 provider 表,setModel 改 current)
- Test: E2E +2(T44 切换更新 chip+record;T45 设为默认 record)、vitest 0(纯组件,E2E 覆盖)

**Interfaces:** Consumes T3 wire。Produces:chip testid `model-chip` 保持可定位;条目 testid `model-option`,无 key 置灰 disabled;「设为默认」testid `model-set-default`;running 时触发器 disabled。

- [ ] **Step 1: mock 三方法**(固定两 provider:一有 key 一无;setModel 校验 hasKey)。
- [ ] **Step 2: 三层透传 + ModelSwitcher 组件**(打开时 fetch model.list;选择 → setModel → chip 显示新 provider/model;行内「设为默认」→ setDefaultProvider;错误 console+轻提示)。
- [ ] **Step 3: Composer 接线**(model prop 仍作初始显示,切换后以组件内 state 为准;「强度」文案删除)。
- [ ] **Step 4: E2E**——T44:开下拉→选另一 provider→chip 文本变+record 断言 session.setModel;无 key 项 disabled 断言;T45:设为默认→record 断言 config.setDefaultProvider。
- [ ] **Step 5: 门禁**:tsc 0;vitest 156;E2E **43+2=45**。
- [ ] **Step 6: 提交** `feat(desktop): 模型会话级切换下拉+设为默认(无 key 置灰,强度字样移除)`

---

### Task 6: 侧栏搜索(标题+项目,纯渲染层)

**Files:**
- Create: `desktop/src/renderer/lib/sidebarSearch.ts`(纯过滤函数)
- Modify: `desktop/src/renderer/components/Sidebar.tsx`(搜索项启用为输入框;激活时两分区渲染)
- Test: `desktop/test/sidebarSearch.test.ts`(新,+2)、E2E +1(T46)

**Interfaces:** Produces `filterSidebar(sessions: {id,title}[], projects: ProjectView[], query): { sessions: [...], projects: [...] }`(不区分大小写 contains;title 空按 '未命名' 参与;项目按显示名/路径尾段);Sidebar 搜索框 testid `sidebar-search`(启用后),清除钮 `sidebar-search-clear`,Esc 清空;空结果文案 '无匹配'。分区点击走既有 onSelectSession/onActivateProject 回调(props 已有,核对实际名)。

- [ ] **Step 1: TDD 纯函数**(大小写、空 query 返回原列表、项目路径尾段命中)。
- [ ] **Step 2: Sidebar 改造**(NAV_DISABLED 移除 search;非激活态显示放大镜入口/激活态输入框——以现有侧栏布局最小改动为准;两分区标题「会话」「项目」)。
- [ ] **Step 3: E2E T46**:注入两项目+若干会话(既有 WRAITH_E2E_PROJECTS/mock sessions 手法),输入关键字断言两分区各自过滤,清除恢复。
- [ ] **Step 4: 门禁**:tsc 0;vitest **156+2=158**;E2E **45+1=46**。
- [ ] **Step 5: 提交** `feat(desktop): 侧栏搜索(会话标题+项目过滤,纯渲染层)`

---

### Task 7: ROADMAP + spec 兑现标记

**Files:** Modify `docs/ROADMAP.md`(占位兑现波入已实现表;待眼验增补:真图片发 DeepSeek 验证 vision 与降级文案、真切 provider 一轮对话、resume 后 provider 恢复、搜索大列表体感)。
- [ ] 更新 + `npx tsc --noEmit` 快验未误碰代码 + 提交 `docs(roadmap): 占位兑现波入表(附件/模型切换/侧栏搜索)`。

---

## 收尾(controller 执行)

1. **整支终审**(fable;焦点:①attachments/model.* wire 双端逐字一致+mock 保真度 ②附件安全面(路径校验旁路/日志泄漏/上限绕过/落盘 base64 残留) ③setModel 与 resume/persist 的 provider 一致性(切换后 persistTurn 的 meta、跨会话不串) ④CLI 路径零行为改动核查 ⑤主会话/自动化链零回归)→ ONE 修复波 → 复验。
2. **全量回归**(controller 亲跑):Java 全量 @ 0F/0E、vitest 158、E2E 46、tsc 0、workspace 压测 10 连。
3. **jar 重建 + 眼验卡 C**(真图片 vision/真切 provider/搜索体感)。
4. **merge --no-ff + push**。
