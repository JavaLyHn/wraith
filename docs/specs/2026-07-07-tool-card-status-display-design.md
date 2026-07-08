# 设计：工具卡片成败徽标修复 + 内容显示重构

日期：2026-07-07
范围：Java 后端(工具结果显式失败标志) + 桌面渲染层(徽标一致/参数美化/DSML 过滤)。分支 `fix/tool-card-status-display`（off main）。**含 Java → 眼验前重建部署 jar。**

## 问题（systematic-debugging 结论）

模型吐出畸形工具调用(argsJson 是坏 JSON)时,UI 出现「工具正文明示失败,徽标却绿色 ✓ 完成」的自相矛盾。根因链:
- 后端判成败靠**字符串前缀启发式** `ok = !text.startsWith("工具执行失败:")`（`Agent.java:383`）——脆弱。
- 畸形调用常带**空/重复的 tool call id**,reducer `updateToolCard(callId)` 按 callId 匹配,撞 id 时某工具的 `ok` 会串到别的卡(后到的 ok 覆盖),于是失败正文配绿徽标。
- 静态代码看不死具体哪条腿,但本质是:**成败信号既靠猜、又依赖 callId 精确匹配**,任一环出岔即矛盾。

另:内容区把 `argsJson` 原样(带 `\n`/`\t` 转义)显示;模型把工具调用当正文吐的 `<|DSML|invoke …>` 标记原样泄漏进消息气泡。

## 目标

1. **徽标与正文永不矛盾**:失败正文 ⇒ 红徽标(治标于显示层,与哪条腿出错无关)。
2. **成败信号显式化**(治本):工具结果带显式 `ok`,不再靠前缀猜。
3. **内容可读**:参数 JSON 美化;消息里 DSML 标记清洗(best-effort)。

## 非目标（YAGNI）

- 不改 LLM 客户端的工具调用解析(畸形 JSON 由模型产生,后端已容错为"工具执行失败");不实现 DSML 解析器。
- 不改 callId 分配(显示层一致已让 callId 撞车无害化)。
- 不改 execute_command 的流式收尾(它不走 emitToolCardResult)。

## 现有结构（锚点）

- `tool/ToolOutput.java`:`record ToolOutput(text, imageParts)` + `static text(String)`。
- `tool/ToolRegistry.java`:`doExecuteTool` 成功 `ToolOutput.text(result)`;策略拒绝 `ToolOutput.text("🛡️ 策略拒绝: …")`(:1278);通用 catch `ToolOutput.text("工具执行失败: …")`(:1284)。`record ToolExecutionResult(id,name,argumentsJson,result,elapsedMillis,timedOut,imageParts)`(:1580),工厂 `completed`/`failed`/`timedOut`(仅 2 处 `new ToolExecutionResult`,都在工厂内)。
- `agent/Agent.java:375-391` `emitToolCardResult`:`ok = !timedOut && !text.startsWith("工具执行失败:")` → `appendToolResult(id, ok, ok?0:1)`。测试 `AgentToolCardEmitTest`。
- `desktop/src/shared/transcriptReducer.ts`:`tool.result` 写 `card.ok`;`tool.output.delta` 累 `card.output`。
- `desktop/src/shared/toolBadge.ts` `toolBadgeLabel`;`desktop/src/renderer/lib/toolCardExpand.ts` `toolCardDefaultExpanded`;`desktop/src/renderer/components/ToolCard.tsx`(徽标色 + argsJson 头 + output pre);`desktop/src/renderer/components/AgentMessage.tsx`(消息 markdown 渲染)。

## 设计

### 1. 后端:显式失败标志

- `ToolOutput` 加 `boolean ok`(canonical ctor 默认 true);新工厂 `static ToolOutput failure(String text)` → ok=false。`text(String)` 保持 ok=true。
- `doExecuteTool`:策略拒绝(:1278)与通用 catch(:1284)改用 `ToolOutput.failure(...)`;成功路径不变。MCP 路径维持(其错误由 invoker 决定,超范围)。
- `ToolExecutionResult` 加 `boolean ok`:`completed(inv, ToolOutput o, ms)` → `ok = o == null || o.ok()`;`completed(inv, String, ms)` → 走 `ToolOutput.text`(ok=true);`failed(...)` → ok=false;`timedOut(...)` → ok=false。两处 `new ToolExecutionResult(...)` 补 `ok` 实参。
- `emitToolCardResult`:`boolean ok = result.ok();`(删前缀启发式)。`appendToolResult(id, ok, ok ? 0 : 1)` 不变。

### 2. 前端:徽标与正文一致

- `toolBadge.ts` 新增纯函数 `toolCardFailed(card): boolean` = `card.ok === false || FAIL_RE.test(card.output.trimStart())`,其中 `FAIL_RE = /^(工具执行失败|🛡️ 策略拒绝|工具执行超时)/`。`toolBadgeLabel` 内部改用 `toolCardFailed(card)` 求 `failed`(execute_command 分支不变)。
- `ToolCard.tsx` 徽标色:`badgeClass = !card.done ? accent : toolCardFailed(card) ? danger : ok-green`。
- `toolCardExpand.ts` `toolCardDefaultExpanded`:`!card.done || toolCardFailed(card)`(失败默认展开)。
- `transcriptReducer.ts` `tool.result`:`ok` 仍 `typeof boolean ? : undefined`(不动;一致性由 `toolCardFailed` 的正文兜底保证)。

### 3. 前端:内容可读

- 新纯函数 `desktop/src/renderer/lib/toolContent.ts`:
  - `prettyArgs(argsJson: string): string` —— 试 `JSON.parse` → `JSON.stringify(_, null, 2)`(转义自然还原);解析失败返回原串。
  - `stripDsml(text: string): string` —— 去除 `<|DSML| … >` 形态标记(正则 `/<\|[^>]*\|?[^>]*>/g` 之类,best-effort),折叠多余空行;普通文本原样。
- `ToolCard.tsx`:展开区 `<pre>` 显 `prettyArgs(card.argsJson)`(参数)后接 `card.output`(结果);头部仍显紧凑截断的原始 argsJson。
- `AgentMessage.tsx`:markdown 渲染前对文本套 `stripDsml`。

## 测试 / 门禁

- **vitest**:`toolBadge`(`toolCardFailed`:ok=false→真;输出以失败标记开头→真;成功→假)。`toolContent`(`prettyArgs` 合法→缩进/非法→原样;`stripDsml` 去 DSML 标记/留正常文本)。`toolCardExpand`(失败→展开)。
- **Java**:更新 `AgentToolCardEmitTest`(显式 ok 流:`ToolOutput.failure` → tool.result ok=false;成功 → ok=true);新增 `ToolOutput`/`ToolExecutionResult` ok 字段的针对性断言。
- **门禁**:桌面 typecheck 0 + vitest 全绿 + build;Java 针对性 `-Dtest='AgentToolCardEmitTest'`(+相关)0F/0E。
- **眼验(重建部署 jar)**:构造/复现畸形工具调用 → 失败卡片徽标红、正文清晰;参数以缩进 JSON 呈现、无 `\n\t` 字面;消息里不再见 `<|DSML|…>`。成功工具仍绿。

## 风险

- 改 `ToolExecutionResult`/`ToolOutput` 是核心路径 → 靠 `AgentToolCardEmitTest` + 全量 Java 相关测试守回归。
- `stripDsml` 是启发式,可能清不干净复杂畸形块;定位为 best-effort(根子在模型/后端原生 tool_calls),不追求完美。

## 交付链路
`fix/tool-card-status-display` → 实现(TDD)→ 桌面三门 + Java 针对性全绿 → 重建部署 jar → 眼验 → FF-merge + 推送(推送前点头)。

## 安全
无密钥面。工具错误信息本就是诊断文本(已有截断);不新增网络/存储。
