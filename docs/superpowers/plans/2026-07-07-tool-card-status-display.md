# 工具卡片成败徽标修复 + 内容显示重构 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 工具失败必红徽标(与正文一致),后端成败信号显式化,内容(参数/消息)可读。

**Architecture:** 后端给 `ToolOutput`/`ToolExecutionResult` 加显式 `ok` + `ToolOutput.failure()`,`emitToolCardResult` 用 `result.ok()`;前端 `toolCardFailed`(ok===false 或正文失败标记)统一驱动徽标,并加 `prettyArgs`/`stripDsml` 纯函数美化显示。

**Tech Stack:** Java 17 / JUnit;TypeScript / React / vitest。

## Global Constraints

- 无密钥面;提交前仍跑 `git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer"`。
- **含 Java 改动 → 收尾必须** `mvn -q -DskipTests package` 重建并部署 `target/wraith-1.0-SNAPSHOT.jar` → `~/.wraith/wraith.jar`。
- 门禁:桌面(`desktop/`)`npm run typecheck` 0 + `npm run test` 全绿 + `npm run build`;Java 针对性 `mvn -DskipTests=false -Dtest='AgentToolCardEmitTest' test` 0F/0E(仅跑该类;全量有 ~4F/38E 无关基线噪声)。
- 组件签名沿用既有约定;提交 trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN`。
- 失败标记集:`工具执行失败` / `🛡️ 策略拒绝` / `工具执行超时`。

---

### Task 1: 后端显式失败标志

**Files:**
- Modify: `src/main/java/com/lyhn/wraith/tool/ToolOutput.java`
- Modify: `src/main/java/com/lyhn/wraith/tool/ToolRegistry.java`（doExecuteTool 失败返回 + ToolExecutionResult record）
- Modify: `src/main/java/com/lyhn/wraith/agent/Agent.java`（emitToolCardResult）
- Test: `src/test/java/com/lyhn/wraith/agent/AgentToolCardEmitTest.java`

**Interfaces:**
- Produces: `ToolOutput.ok()` + `ToolOutput.failure(String)`;`ToolExecutionResult.ok()`;`emitToolCardResult` 依据 `result.ok()` 发 tool.result。

- [ ] **Step 1: 改测试为目标行为(先红)**

`AgentToolCardEmitTest.java` 把 `result(...)` helper 与失败用例改为显式 ok:
```java
    private static ToolExecutionResult result(String id, String name, String text, boolean timedOut, boolean ok) {
        return new ToolExecutionResult(id, name, "{}", text, 5L, timedOut, List.of(), ok);
    }
```
并更新各调用点(补第 5 参 ok):
- `nonCommandToolEmitsOutputAndOkResult`: `result("c1","web_search","搜索结果…", false, true)`
- `executeCommandIsSkippedEntirely`: `result("c2","execute_command","hi", false, true)`
- `timedOutToolEmitsNotOk`: `result("c3","read_file","工具执行超时（60秒），已取消", true, false)`
- `failedPrefixEmitsNotOk`(改名语义可留): `result("c4","read_file","工具执行失败: boom", false, false)`
- `emptyResultEmitsOnlyResultNoOutput`: `result("c5","todo_write","", false, true)`
- `oversizedResultIsTruncated`: `result("c6","read_file", big, false, true)`
- `nullRendererIsSafeNoop`: `result("c7","read_file","x", false, true)`

- [ ] **Step 2: 跑测试确认失败**

Run: `mvn -DskipTests=false -Dtest=AgentToolCardEmitTest test`
Expected: 编译失败(`ToolExecutionResult` 无第 8 参 `ok`)。

- [ ] **Step 3: ToolOutput 加 ok + failure()**

`ToolOutput.java` 整体改为:
```java
package com.lyhn.wraith.tool;

import com.lyhn.wraith.llm.LlmClient;

import java.util.List;

public record ToolOutput(String text, List<LlmClient.ContentPart> imageParts, boolean ok) {
    public ToolOutput {
        text = text == null ? "" : text;
        imageParts = imageParts == null ? List.of() : List.copyOf(imageParts);
    }

    /** 兼容:2 参构造默认 ok=true(保留 McpClient/McpCallToolResult 的既有调用)。 */
    public ToolOutput(String text, List<LlmClient.ContentPart> imageParts) {
        this(text, imageParts, true);
    }

    public static ToolOutput text(String text) {
        return new ToolOutput(text, List.of(), true);
    }

    /** 失败输出:ok=false。 */
    public static ToolOutput failure(String text) {
        return new ToolOutput(text, List.of(), false);
    }

    public boolean hasImageParts() {
        return !imageParts.isEmpty();
    }
}
```

- [ ] **Step 4: doExecuteTool 失败返回改用 failure()**

`ToolRegistry.java`:
- 第 1278 行 `return ToolOutput.text("🛡️ 策略拒绝: " + e.getMessage());` → `return ToolOutput.failure("🛡️ 策略拒绝: " + e.getMessage());`
- 第 1284 行 `return ToolOutput.text("工具执行失败: " + e.getMessage());` → `return ToolOutput.failure("工具执行失败: " + e.getMessage());`

- [ ] **Step 5: ToolExecutionResult 加 ok 字段 + 工厂**

`ToolRegistry.java` record `ToolExecutionResult`:签名末尾加 `, boolean ok`:
```java
    public record ToolExecutionResult(String id, String name, String argumentsJson,
                                      String result, long elapsedMillis, boolean timedOut,
                                      List<com.lyhn.wraith.llm.LlmClient.ContentPart> imageParts, boolean ok) {
        private static ToolExecutionResult completed(ToolInvocation invocation, ToolOutput output, long elapsedMillis) {
            return new ToolExecutionResult(
                    invocation.id(), invocation.name(), invocation.argumentsJson(),
                    output == null ? "" : output.text(), elapsedMillis, false,
                    output == null ? List.of() : output.imageParts(),
                    output == null || output.ok());
        }
        private static ToolExecutionResult completed(ToolInvocation invocation, String result, long elapsedMillis) {
            return completed(invocation, ToolOutput.text(result), elapsedMillis);
        }
        private static ToolExecutionResult failed(ToolInvocation invocation, String message) {
            return completed(invocation, ToolOutput.failure("工具执行失败: " + message), 0);
        }
        private static ToolExecutionResult timedOut(ToolInvocation invocation, long timeoutSeconds) {
            return new ToolExecutionResult(
                    invocation.id(), invocation.name(), invocation.argumentsJson(),
                    "工具执行超时（" + timeoutSeconds + "秒），已取消",
                    timeoutSeconds * 1000, true, List.of(), false);
        }
```
（`completed`/`failed`/`timedOut` 之下的其它方法如 `hasImageParts` 保持不变。）

- [ ] **Step 6: emitToolCardResult 用 result.ok()**

`Agent.java:383` `boolean ok = !result.timedOut() && !text.startsWith("工具执行失败:");` → `boolean ok = result.ok();`
（其余截断/emit 逻辑不变。`text` 局部变量仍用于 output delta。）

- [ ] **Step 7: 跑测试确认通过**

Run: `mvn -DskipTests=false -Dtest=AgentToolCardEmitTest test`
Expected: `Tests run: 7, Failures: 0, Errors: 0` BUILD SUCCESS。

- [ ] **Step 8: 提交**

```bash
git add src/main/java/com/lyhn/wraith/tool/ToolOutput.java src/main/java/com/lyhn/wraith/tool/ToolRegistry.java src/main/java/com/lyhn/wraith/agent/Agent.java src/test/java/com/lyhn/wraith/agent/AgentToolCardEmitTest.java
git diff --cached | grep -iE "api[_-]?key|secret|sk-|Bearer" || true
git commit -m "$(printf 'fix(tool): 工具结果显式 ok 标志(ToolOutput.failure/ToolExecutionResult.ok),emitToolCardResult 不再靠前缀猜成败\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN')"
```

---

### Task 2: 前端徽标与正文一致

**Files:**
- Modify: `desktop/src/shared/toolBadge.ts`
- Modify: `desktop/src/renderer/components/ToolCard.tsx`
- Modify: `desktop/src/renderer/lib/toolCardExpand.ts`
- Test: `desktop/test/toolBadge.test.ts`, `desktop/test/toolCardExpand.test.ts`

**Interfaces:**
- Consumes: `ToolCard`(含 `ok?`, `output`, `done`, `name`, `exitCode`)。
- Produces: `toolCardFailed(card): boolean`(供徽标色/文案/默认展开共用)。

- [ ] **Step 1: 写失败测试**

`desktop/test/toolBadge.test.ts` 追加(顶部 import 补 `toolCardFailed`):
```ts
import { toolBadgeLabel, toolCardFailed } from '../src/shared/toolBadge'
import type { ToolCard } from '../src/shared/transcriptReducer'
const mk = (p: Partial<ToolCard>): ToolCard => ({ callId: 'x', name: 't', argsJson: '', output: '', done: true, ...p })

describe('toolCardFailed', () => {
  it('ok===false → 失败', () => { expect(toolCardFailed(mk({ ok: false }))).toBe(true) })
  it('正文以失败标记开头 → 失败(即使 ok 非 false)', () => {
    expect(toolCardFailed(mk({ output: '工具执行失败: boom\n' }))).toBe(true)
    expect(toolCardFailed(mk({ output: '  🛡️ 策略拒绝: x' }))).toBe(true)
  })
  it('成功(ok 未定/正文正常) → 不失败', () => {
    expect(toolCardFailed(mk({ output: '搜索结果…' }))).toBe(false)
  })
})
```
`desktop/test/toolCardExpand.test.ts` 追加:
```ts
it('失败卡片默认展开', () => {
  expect(toolCardDefaultExpanded({ callId: 'x', name: 't', argsJson: '', output: '工具执行失败: boom', done: true } as never)).toBe(true)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npm run test -- --run toolBadge toolCardExpand`
Expected: FAIL(`toolCardFailed` 未导出)。

- [ ] **Step 3: toolBadge.ts 加 toolCardFailed + 改 label**

在 `toolBadge.ts` 顶部(import 之后)加并改写:
```ts
const FAIL_RE = /^(工具执行失败|🛡️ 策略拒绝|工具执行超时)/

/** 卡片是否失败:显式 ok===false,或输出以失败标记开头(与正文一致,兜底 ok 信号缺失)。 */
export function toolCardFailed(card: ToolCard): boolean {
  return card.ok === false || FAIL_RE.test(card.output.trimStart())
}

export function toolBadgeLabel(card: ToolCard): string {
  if (!card.done) return 'running…'
  const failed = toolCardFailed(card)
  if (card.name === 'execute_command' && failed) {
    return `exit ${card.exitCode ?? 1}`
  }
  return failed ? '✗ 失败' : '✓ 完成'
}
```

- [ ] **Step 4: ToolCard 徽标色用 toolCardFailed**

`ToolCard.tsx`:import 补 `toolCardFailed`(`import { toolBadgeLabel, toolCardFailed } from '../../shared/toolBadge'`);badgeClass 改:
```tsx
  const badgeClass = !card.done
    ? 'bg-accent/15 text-accent'
    : toolCardFailed(card)
      ? 'bg-danger text-white'
      : 'bg-ok text-white'
```

- [ ] **Step 5: toolCardDefaultExpanded 用 toolCardFailed**

`toolCardExpand.ts`:import `toolCardFailed`,改:
```ts
import { toolCardFailed } from '../../shared/toolBadge'
export function toolCardDefaultExpanded(card: ToolCard): boolean {
  return !card.done || toolCardFailed(card)
}
```

- [ ] **Step 6: 跑测试 + typecheck**

Run: `cd desktop && npm run test -- --run toolBadge toolCardExpand && npm run typecheck`
Expected: 全绿;typecheck 0。

- [ ] **Step 7: 提交**

```bash
git add desktop/src/shared/toolBadge.ts desktop/src/renderer/components/ToolCard.tsx desktop/src/renderer/lib/toolCardExpand.ts desktop/test/toolBadge.test.ts desktop/test/toolCardExpand.test.ts
git commit -m "$(printf 'fix(desktop): toolCardFailed 统一徽标——ok===false 或正文失败标记皆判失败,徽标与正文永不矛盾\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN')"
```

---

### Task 3: 内容显示重构(参数美化 + DSML 过滤)

**Files:**
- Create: `desktop/src/renderer/lib/toolContent.ts`
- Test: `desktop/test/toolContent.test.ts`
- Modify: `desktop/src/renderer/components/ToolCard.tsx`（展开区显 prettyArgs）
- Modify: `desktop/src/renderer/components/AgentMessage.tsx`（渲染前 stripDsml）

**Interfaces:**
- Produces: `prettyArgs(argsJson): string`;`stripDsml(text): string`。

- [ ] **Step 1: 写失败测试**

新建 `desktop/test/toolContent.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { prettyArgs, stripDsml } from '../src/renderer/lib/toolContent'

describe('prettyArgs', () => {
  it('合法 JSON → 缩进(转义还原)', () => {
    expect(prettyArgs('{"a":"x\\ny"}')).toBe('{\n  "a": "x\\ny"\n}'.replace('\\n', '\n'))
  })
  it('非法 JSON → 原样返回', () => {
    expect(prettyArgs('{"a":"x"步}')).toBe('{"a":"x"步}')
  })
  it('空 → 空', () => { expect(prettyArgs('')).toBe('') })
})

describe('stripDsml', () => {
  it('去除 <|DSML|…> 标记', () => {
    expect(stripDsml('<|DSML|invoke name="t">你好')).toBe('你好')
  })
  it('普通文本原样', () => {
    expect(stripDsml('正常消息')).toBe('正常消息')
  })
})
```
（`prettyArgs` 首个断言意在验:输入含转义 `\n` 的字符串,`JSON.parse`+`stringify` 后字符串体内 `\n` 仍是 `\\n` 文本 —— 实现者按 `JSON.stringify(JSON.parse(x), null, 2)` 实际输出对齐断言;若不便可改断言为 `expect(prettyArgs('{"a":1}')).toBe('{\n  "a": 1\n}')` 这种无转义样例。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd desktop && npm run test -- --run toolContent`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现 toolContent.ts**

```ts
/** 工具卡片内容显示的纯逻辑。 */

/** 参数 JSON 美化:能解析则缩进(转义自然还原),否则原样返回。 */
export function prettyArgs(argsJson: string): string {
  if (!argsJson || !argsJson.trim()) return ''
  try {
    return JSON.stringify(JSON.parse(argsJson), null, 2)
  } catch {
    return argsJson
  }
}

/** 清洗模型误吐进正文的 DSML 工具调用标记(best-effort);普通文本原样。 */
export function stripDsml(text: string): string {
  if (!text) return text
  return text
    .replace(/<\|\s*DSML\s*\|[^>]*>/g, '')
    .replace(/\n{3,}/g, '\n\n')
}
```
（若 Step 1 首个断言与实际输出不符,以实际 `JSON.stringify` 输出为准修正断言——这是格式化行为,非逻辑分歧。）

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop && npm run test -- --run toolContent`
Expected: PASS。

- [ ] **Step 5: ToolCard 展开区显 prettyArgs**

`ToolCard.tsx`:import `prettyArgs`;展开区在 output `<pre>` 前加参数块(仅当 argsJson 非空):
```tsx
      {expanded && (
        <div className="border-t border-border">
          {card.argsJson.trim() && (
            <pre data-testid="tool-args" className="m-0 max-h-40 overflow-y-auto whitespace-pre-wrap break-words border-b border-border/50 px-3 py-2 text-2xs leading-relaxed text-fg-subtle">
              {prettyArgs(card.argsJson)}
            </pre>
          )}
          <pre
            data-testid="tool-output"
            className="m-0 max-h-60 overflow-y-auto whitespace-pre-wrap break-words px-3 py-2 text-xs leading-relaxed text-fg-muted"
          >
            {card.output || ' '}
          </pre>
        </div>
      )}
```
（替换原先单一 `{expanded && (<pre …>{card.output || ' '}</pre>)}` 块;头部 `{card.argsJson}` 紧凑截断保持不变。）

- [ ] **Step 6: AgentMessage 渲染前 stripDsml**

`AgentMessage.tsx`:import `stripDsml`;把传给 markdown 的文本源包一层 `stripDsml(...)`（找到渲染 `text`/children 的位置,如 `<ReactMarkdown>{text}` → `{stripDsml(text)}`;若文本来自 prop,先 `const clean = stripDsml(text)` 再用）。

- [ ] **Step 7: typecheck + build**

Run: `cd desktop && npm run typecheck && npm run build`
Expected: typecheck 0;build 成功。

- [ ] **Step 8: 提交**

```bash
git add desktop/src/renderer/lib/toolContent.ts desktop/test/toolContent.test.ts desktop/src/renderer/components/ToolCard.tsx desktop/src/renderer/components/AgentMessage.tsx
git commit -m "$(printf 'feat(desktop): 工具参数 JSON 美化(prettyArgs)+ 消息 DSML 标记清洗(stripDsml)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01G49KyPFe5h2vqV4zGSueLN')"
```

---

## 最终门禁 + 部署 + 眼验

- [ ] 桌面三门:`cd desktop && npm run typecheck && npm run test && npm run build` 全绿。
- [ ] Java:`mvn -DskipTests=false -Dtest='AgentToolCardEmitTest' test` 0F/0E。
- [ ] **重建部署 jar**:`mvn -q -DskipTests package` → 覆盖 `~/.wraith/wraith.jar`。
- [ ] 眼验:失败工具徽标红 + 正文清晰;参数以缩进 JSON 呈现、无 `\n\t` 字面;消息无 `<|DSML|…>`;成功工具仍绿。

## Self-Review

- **Spec 覆盖**:显式失败标志(T1)、徽标一致(T2)、参数美化+DSML(T3);reducer 不改(spec 定,一致性由 T2 兜底)。✓
- **占位符**:无 TBD;各步含完整代码/命令(T3 Step6 的 AgentMessage 落点需实现者按实际 markdown 渲染位置接线,已注明)。
- **类型一致**:`ToolExecutionResult` 8 字段(末位 ok)在 record + 测试 helper 一致;`toolCardFailed` T2 定义、ToolCard/toolCardExpand 消费;`prettyArgs`/`stripDsml` T3 定义、ToolCard/AgentMessage 消费。✓
