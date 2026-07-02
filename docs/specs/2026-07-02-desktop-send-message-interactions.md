# Wraith 桌面端:发送消息交互(编辑/删除/停止 + IME 修复)设计 spec

> 日期:2026-07-02 · 用户已确认设计。语义拍板:**真回溯**(claude.ai 同款,rewind 即永久丢弃,不做版本树)。

## 1. IME bug(修复,无歧义)

- 根因:Composer 的 Enter 处理未判输入法组合态,选词确认的 Enter 被当作发送。
- 修法:`shared/composerKeys.ts` 纯函数 `shouldSendOnEnter({key, shiftKey, isComposing, keyCode}, running)`——`isComposing || keyCode === 229`(Safari/旧 Chromium 兜底)或 running 时不发送。Composer 以 `e.nativeEvent.isComposing` 接入。
- 测试:vitest 直测;真实 IME 无法 E2E,列入手动眼验。

## 2. 停止

- 全局 Esc:`turn === 'running'` 且**无待审批弹窗**时 → `turn.interrupt`(弹窗打开时 Esc 归弹窗语义,不中断)。「中断」按钮保留。
- 运行中输入框解锁:textarea 不再 disabled,可打草稿;发送按钮仍禁,Enter 不发送(§1 函数统一判)。

## 3. 用户消息操作(hover)

- user 气泡 hover 浮现 ✏️ 编辑 / 🗑 删除;running 时不可用。
- 编辑:气泡就地切 textarea + 保存/取消;保存 → `session.rewind(ordinal)` → 前端裁剪 → 以新文本重发(正常 submit 流)。
- 删除:二次点击确认(首点变「确认删除」);rewind 后不重发。裁掉该条**及之后全部**。
- 红线:无版本树;rewind 后模型记忆/落盘/UI 三者一致。

## 4. 后端 `session.rewind`

- wire:`session.rewind {sessionId, userOrdinal}`(1-based,第 k 条 user 消息);running 中回错;ordinal 缺失/无效 → -32602/-32000。
- `SessionRunner` 加 `default boolean rewind(int userOrdinal) { return false; }`;Main 实现:`truncateAtUserOrdinal(history, k)`(包私有静态,直测)→ `agent.restoreHistory(kept)` → 有 user 消息则 `store.persist(kept)`,否则 `store.deleteCurrent()`(新方法:删当前文件 + startNew,清空会话从磁盘/侧栏消失)。
- ordinal 超界/<1 → false → RPC 报错。

## 5. 前端状态

- reducer 加纯 helper `truncateAtUserOrdinal(state, ordinal)`(裁 items 到第 k 个 user 项之前,封口 _messageOpen)。
- Transcript 渲染时为 user 气泡计数 ordinal;新组件 `UserMessage.tsx`(展示态/编辑态/删除确认态);App 增 handleEditMessage/handleDeleteMessage/Esc 效果;preload/main 增 `rewindSession(userOrdinal)`。
- 删除后 items 可为空:停留对话态(不回欢迎页)。rewind 成功后 `void fetchSessions()`。

## 6. 测试

- vitest:`shouldSendOnEnter` 全分支、`truncateAtUserOrdinal`(中间/首条/超界/不可变)。
- Java:`truncateAtUserOrdinal` 静测;AppServer harness——rewind 分发/参数校验/runner false 报错;`SessionStore.deleteCurrent`(@TempDir)。
- E2E(mock 加 `session.rewind` + `MOCK_SLOW_TURN` 慢速窗口):编辑流(rewind+新 submit+气泡更新)、删除流(二次确认+气泡消失)、Esc 中断(record 含 turn.interrupt)。
- 手动眼验:真实中文 IME 选词 Enter 不发送。
