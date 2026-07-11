# 桌面「整理上下文」(补齐 CLI /compact)

- 日期:2026-07-11
- 状态:draft → 实现中
- 关联:CLI `/compact`(`Main.java` case COMPACT → `reactAgent.compactHistoryNow()` → `Agent.CompactionResult`)

## 背景

CLI `/compact` 手动把当前 ReAct 对话历史里较早的消息压成摘要,**释放上下文窗口**
(不等自动阈值触发)。桌面没有手动入口(自动压缩仍在跑,但用户不能主动触发)。
这是 CLI↔桌面对照里剩的两个缺口之一。

## 目标

桌面聊天区一个按钮「整理上下文」,点击 → 后端 `agent.compactHistoryNow()` →
把早期历史压成摘要,回包压缩前后 token 数;前端提示「12.3k → 4.1k」或「无需整理」。

## 非目标

- 不改压缩算法(复用 `ConversationHistoryCompactor`)。
- **不改可见 transcript**:压缩的是后端 agent 的**上下文**(喂给 LLM 的历史),
  renderer 的 `Item[]` 聊天记录不动——用户看到的对话不变,只是后端上下文变轻。

## 设计

### 后端

- **AppServer**:SessionRunner 加 `compactHistory()` 默认方法 + dispatch `case "session.compact"`。
  压缩会**调一次 LLM**(生成摘要),**耗时** → 用 `dispatchAsync`(后台线程),与 rag.index 同理。
- **Main.java**(app-server SessionRunner,~1214):
  ```java
  public Map<String,Object> compactHistory() {
      Agent.CompactionResult r = agent.compactHistoryNow();
      return {compacted, beforeTokens, afterTokens, error};  // error 只放简单消息
  }
  ```

### 桌面

- **preload + 类型**:`compactHistory()` → `{compacted, beforeTokens, afterTokens, error}`。
- **纯函数** `lib/compactView.ts`:`compactionNotice(result)` → 中文文案
  (成功「✅ 已整理:12.3k → 4.1k tokens」/ 未压「上下文未超阈值,无需整理」/ 失败「整理失败」)+
  `formatTokens(n)`(1234→"1.2k")。配单测。
- **UI**:chat 头部导出按钮旁加「整理」按钮(lucide `Sparkles`/`Wand2`,1.5px 单色)。
  点击 → busy 态 → 调 `compactHistory` → 顶部 notice 显示结果。turn 运行中禁用。

### 安全红线

- 回包不含历史正文/密钥;error 只放 `e` 简单消息。
- 单测只测纯函数,不碰真实会话。

## 测试

- `desktop/test/compactView.test.ts`:formatTokens + compactionNotice 三态。
- typecheck / vitest / build 全绿;**改了 Java → 重打 jar + 同步 + 重启桌面**。

## 验收

- 聊过几轮后点「整理」→ 提示 token 下降;短对话点 → 「无需整理」。
- 可见聊天记录不变(只后端上下文变轻)。
