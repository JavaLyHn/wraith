# 桌面端交互式选择器设计

> 日期：2026-08-10
> 背景：交互式选择器（commit 07ab92e7..6b748ca3）已实现 CLI 路径的 `Renderer.promptChoice`，但桌面端/app-server 路径的 `EventStreamRenderer` 未覆写 `promptChoice`，走 default stub 返回 `cancelled`，导致 AI 调用 `present_options` 时拿到 `__cancelled__` 回退到文本列选项，用户看不到可点击 UI。本设计补齐桌面端跨层实现。

## 目标

让桌面端用户在 AI 调用 `present_options` 时看到可点击的选择器弹窗，选择后结果回传给后端继续 ReAct 循环。交互方式：**点击为主 + 键盘辅助**（方向键上下移动高亮、Enter 确认、ESC 取消）。

## 不在范围

- LanternaRenderer 适配（计划标注为可选后续，本设计不涉及）
- 微信/gateway/automation 非交互会话（present_options 在这些会话继续走 default cancelled，AGENTS.md 已规定非交互默认拒绝）
- present_options 工具本身的逻辑改动（Task 7 已完成）

## 架构：镜像现有 approval 管道

现有 approval 管道是经过验证的"后端阻塞 + 前端交互 + RPC 回传"范式。本设计完全镜像它，新增 `choice` 管道，与 approval 管道独立（不共享 state，避免干扰）。

```
AI 调用 present_options
  → ToolRegistry 执行 lambda
  → PresentOptionsTool.execute
  → renderer.promptChoice(ChoiceRequest)        ← EventStreamRenderer 覆写
  → 发 choice.requested 事件 + CompletableFuture 阻塞
  → 前端收到事件 → state.pendingChoice → 渲染 ChoiceModal
  → 用户点击/键盘选择
  → 前端调 respondChoice IPC
  → main 进程转发 choice.respond RPC
  → AppServer.handleChoiceRespond
  → renderer.resolveChoice(choiceId, result)
  → CompletableFuture 完成 → promptChoice 返回
  → PresentOptionsTool 拿到选中 label 返回给 AI
  → AI 继续对话
```

## 后端改动

### 1. `EventStreamRenderer.promptChoice`（新增方法）

镜像 `promptApproval`（EventStreamRenderer.java:227-247）：

```java
// 新增字段
private final java.util.concurrent.atomic.AtomicLong choiceSeq = new java.util.concurrent.atomic.AtomicLong();
private final Map<String, java.util.concurrent.CompletableFuture<ChoiceResult>> pendingChoices =
        new java.util.concurrent.ConcurrentHashMap<>();

@Override public ChoiceResult promptChoice(ChoiceRequest request) {
    if (request == null || request.options() == null || request.options().isEmpty()) {
        return ChoiceResult.cancelled();
    }
    String choiceId = "choice_" + choiceSeq.incrementAndGet();
    java.util.concurrent.CompletableFuture<ChoiceResult> fut = new java.util.concurrent.CompletableFuture<>();
    pendingChoices.put(choiceId, fut);
    Map<String, Object> p = base();
    p.put("choiceId", choiceId);
    p.put("title", request.title() == null ? "请选择" : request.title());
    // options 序列化为 List<Map{label,description}>
    java.util.List<Map<String, Object>> opts = new java.util.ArrayList<>();
    for (ChoiceOption opt : request.options()) {
        Map<String, Object> o = new LinkedHashMap<>();
        o.put("label", opt.label());
        o.put("description", opt.description());
        opts.add(o);
    }
    p.put("options", opts);
    p.put("allowCancel", request.allowCancel());
    p.put("hint", request.hint());
    writer.notify("choice.requested", p);
    try {
        return fut.get();
    } catch (Exception e) {
        return ChoiceResult.cancelled();
    } finally {
        pendingChoices.remove(choiceId);
    }
}

/** AppServer 收到 choice.respond 时调用。 */
public void resolveChoice(String choiceId, ChoiceResult result) {
    java.util.concurrent.CompletableFuture<ChoiceResult> fut = pendingChoices.get(choiceId);
    if (fut != null) fut.complete(result);
}
```

同时移除 `openPalette` 的 `return -1` 覆写（现在 default 委托 promptChoice，覆写反而会绕过新管道）。让 `openPalette` 走 default → `promptChoice` → 新管道，这样 `/resume` 续接会话和 `/config` 的列表选择也能在桌面端用弹窗。

### 2. `AppServer.handleChoiceRespond`（新增 RPC 路由）

镜像 `handleApprovalRespond`（AppServer.java:1449-1468）：

```java
case "choice.respond" -> handleChoiceRespond(msg);

private void handleChoiceRespond(JsonRpc.Incoming msg) {
    if (session == null) { writer.error(msg.id(), -32000, "no session"); return; }
    JsonNode p = msg.params();
    if (p == null) { writer.error(msg.id(), -32602, "missing params"); return; }
    String choiceId = p.path("choiceId").asText("");
    if (choiceId.isBlank()) { writer.error(msg.id(), -32602, "缺 choiceId"); return; }
    boolean cancelled = p.path("cancelled").asBoolean(false);
    int selectedIndex = p.path("selectedIndex").asInt(-1);
    ChoiceResult result = cancelled ? ChoiceResult.cancelled() : ChoiceResult.selected(selectedIndex);
    session.renderer().resolveChoice(choiceId, result);
    writer.result(msg.id(), java.util.Map.of("ok", true));
}
```

注意：`choice.respond` 必须由 `dispatchAsync` 之外的正常分发线程处理（与 `approval.respond` 一致）——它只是 complete 一个 future，不阻塞。死锁风险已由现有架构解决（promptChoice 阻塞在 turn 线程，choice.respond 在分发线程 complete future，两者不互斥）。

### 3. openPalette 移除覆写

EventStreamRenderer.java:225 的 `@Override public int openPalette(...) { return -1; }` 删除。default 委托 promptChoice 后，桌面端 `/resume` 和 `/config` 的列表选择也会走新管道。

## 前端改动

### 1. `desktop/src/shared/types.ts`（新增类型）

```typescript
export interface ChoiceOption {
  label: string
  description: string | null
}
export interface PendingChoice {
  choiceId: string
  title: string
  options: ChoiceOption[]
  allowCancel: boolean
  hint: string | null
}
```

### 2. `desktop/src/preload/index.ts`（新增 IPC 桥）

镜像 `respondApproval`（preload/index.ts:261-263）：

```typescript
respondChoice(choiceId: string, cancelled: boolean, selectedIndex: number): Promise<void>

// 实现
respondChoice(choiceId, cancelled, selectedIndex) {
  return ipcRenderer.invoke('wraith:respondChoice', choiceId, cancelled, selectedIndex)
}
```

### 3. `desktop/src/main/index.ts`（新增 IPC handler）

镜像 `wraith:respondApproval`（main/index.ts:806-820）：

```typescript
ipcMain.handle('wraith:respondChoice', async (_e, choiceId: string, cancelled: boolean, selectedIndex: number) => {
  await client.request('choice.respond', { choiceId, cancelled, selectedIndex })
})
```

### 4. `desktop/src/renderer/App.tsx`（state + 事件分发 + 渲染）

镜像 pendingApproval 处理：

- state 新增 `pendingChoice: PendingChoice | null`
- 事件分发：收到 `choice.requested` → dispatch({ type: 'setChoice', payload })
- handler：`handleChoiceRespond(cancelled, selectedIndex)` → `window.wraith.respondChoice(...)` → dispatch({ type: 'clearChoice' })
- 渲染：`{state.pendingChoice && <ChoiceModal ... onRespond onReject />}`

### 5. `desktop/src/renderer/components/ChoiceModal.tsx`（新组件）

交互：点击为主 + 键盘辅助
- 鼠标点击选项 = 直接确认该项
- 方向键 ↑↓ 移动高亮（默认高亮第一项）
- Enter 确认当前高亮项
- ESC 取消（allowCancel=false 时 ESC 无效，点遮罩也不关）
- 右上角 X 按钮（仅 allowCancel=true 时显示）

UI 结构（用现有 shadcn Dialog，与 ApprovalModal 一致）：
```
Dialog
  DialogContent
    DialogTitle: {title}
    DialogDescription: {hint ?? '↑↓ 选择  Enter 确认' + (allowCancel ? '  ESC 取消' : '')}
    选项列表（每项一个 button，高亮项加 ring）:
      [label]
      (description 灰色小字，如有)
    底部: allowCancel ? [取消按钮] : null
```

键盘事件：Dialog 内监听 keydown，↑/↓/Enter/ESC。

### 6. `desktop/src/shared/transcriptReducer.ts`

`choice.requested` **不进 transcript**（与 approval.requested 一致——它是临时 modal 状态，不是历史消息）。reducer 收到 `choice.requested` 时只更新 `pendingChoice`，不追加 transcript 项。`choice.respond` 也不进 transcript。

### 7. `desktop/test/fixtures/mock-appserver.mjs`

E2E mock 需要响应 `choice.respond` RPC（否则前端走 -32601 catch 分支，测不到真实路径），镜像现有 approval.respond mock。

## 测试

### 后端
- `EventStreamRendererTest`（新增或扩展）：
  - `promptChoice` 发 `choice.requested` 事件且含正确 options
  - `resolveChoice` 完成 future 且返回正确 selectedIndex
  - `resolveChoice` cancelled 时返回 cancelled
  - 未知 choiceId 幂等忽略
- `AppServerTest`（扩展）：
  - `choice.respond` 路由解析正确参数
  - 缺 choiceId 报 -32602
  - 无 session 报 -32000

### 前端
- `ChoiceModal.test.tsx`：
  - 渲染选项列表（label + description）
  - 点击选项触发 onRespond(selectedIndex)
  - 方向键移动高亮 + Enter 确认
  - ESC 取消（allowCancel=true 时）
  - allowCancel=false 时 ESC 无效
- 现有测试不受影响（ApprovalModal 独立 state）

### E2E
- mock-appserver.mjs 响应 `choice.respond`
- 现有 approval E2E 不受影响

## 风险与边界

1. **死锁**：promptChoice 在 turn 线程阻塞，choice.respond 在分发线程 complete future。与 approval 管道同样的线程模型，已验证无死锁。turn.interrupt 会 interrupt turn 线程，promptChoice 的 `fut.get()` 抛 InterruptedException → 返回 cancelled（与 promptApproval 一致）。
2. **会话切换/中断时的悬挂 future**：与 approval 同——session 关闭时 pending future 不会 complete，但 turn 线程被 interrupt 后 fut.get() 抛异常返回 cancelled。不需额外清理。
3. **openPalette 移除覆写后的影响**：`/resume` 和 `/config` 在桌面端原本 openPalette 返回 -1（用户看不到），现在会弹 ChoiceModal。这是正向改进，但需验证 `/resume` 的会话列表和 `/config` 的配置项列表数据格式与 ChoiceOption 兼容（openPalette 传的是 `List<String>`，default 委托时包成 `ChoiceOption(label, null)`，前端 description=null 不显示——OK）。
4. **非交互会话**：wechat/gateway/automation 的 renderer 不是 EventStreamRenderer，不受影响，继续走 default cancelled。

## 验证路径

| 场景 | 命令 |
|------|------|
| 后端单测 | `mvn test -Dtest=EventStreamRendererTest,AppServerTest -DskipTests=false` |
| 前端单测 | `npx vitest run ChoiceModal` |
| 前端类型 | `npx tsc --noEmit` |
| E2E mock | `npx vitest run` 全量 |
| 手动 | `wraith -d` → 让 AI 给出多个方案 → 确认 ChoiceModal 弹出 → 点击/键盘选择 → AI 继续 |
