/**
 * 「还没配模型」的判定（纯函数）。
 *
 * 后端现在允许**无模型启动** —— 此前它在没有任何 API Key 时 `System.exit(1)`，
 * 而桌面端配 provider 又必须经过后端，于是「想配 key 得先有 key」，全新装机无路可走。
 * 后端修好之后还剩一半：界面得**主动说出来**，否则用户打开只看到一个能点但发不出话的空壳。
 *
 * 两个信号来源：
 *  - 启动时 `initialize` 回包的 `capabilities.modelConfigured`
 *  - 配完 provider 后 `model.list` 回包的 `current.provider`
 */
export interface ModelReadySignals {
  /** initialize 回包里的 capabilities.modelConfigured；旧后端没有这个字段 */
  modelConfigured?: boolean
  /** model.list 回包里的 current.provider；配上了就非空 */
  currentProvider?: string
}

/**
 * 是否该提示用户去配模型。
 *
 * **对旧后端保持沉默**：`modelConfigured` 缺失且拿不到 provider 时返回 false。
 * 宁可不提示，也不要对一个其实配好了的旧版本天天弹「你还没配模型」——
 * 误报一次，用户就再也不信这条提示了。
 */
export function needsModelSetup(s: ModelReadySignals): boolean {
  if (s.currentProvider !== undefined && s.currentProvider.trim() !== '') return false
  if (s.modelConfigured === true) return false
  if (s.modelConfigured === false) return true
  // modelConfigured 缺失(旧后端):只有在明确拿到空 provider 时才敢判定
  return s.currentProvider !== undefined && s.currentProvider.trim() === ''
}
