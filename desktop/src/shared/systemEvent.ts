/**
 * 系统事件 —— UI 侧代替用户提交、用来把「聊天之外发生的事」告诉 agent 的一类消息。
 *
 * 为什么要带前缀:app-server 没有「往会话历史旁路塞一条」的 RPC,唯一能让 agent 知情的
 * 通道就是普通 turn.submit,于是它在后端历史里就是一条 role=user 的消息。会话恢复时
 * messagesToItems 必须能把它认出来还原成「系统事件」气泡 —— 否则用户重开会话会看见
 * 一句自己从没说过的话。
 */
export const SYSTEM_EVENT_PREFIX = '⊙系统事件⊙'

export function makeSystemEvent(body: string): string {
  return `${SYSTEM_EVENT_PREFIX} ${body}`
}

/** 是系统事件则返回正文,否则 null。前缀必须打头 —— 用户复述这串字符时不该被吞。 */
export function parseSystemEvent(text: string): string | null {
  if (!text || !text.startsWith(SYSTEM_EVENT_PREFIX)) return null
  return text.slice(SYSTEM_EVENT_PREFIX.length).trim()
}
