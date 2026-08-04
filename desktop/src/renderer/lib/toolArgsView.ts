/**
 * 工具参数的展示形态判定（审批弹窗与对话流里的工具卡共用）。
 *
 * 起因:批准 `mcp__memory__list_resources` 时弹窗里挂着一个**空的大框**，占掉四分之一个
 * 对话框却什么都没写 —— 那个工具用的是 `emptyObjectSchema()`，压根没有参数，模型送的是 `{}`。
 * 工具卡上是同一件事的另一面:把字面量 `{}` 贴在工具名后面，以及为 `{}` 单独撑出一条边框。
 *
 * **纪律:绝不隐藏任何键。** 审批弹窗的全部意义是「让用户看清将要执行什么」，
 * 为了好看藏掉一个参数，是把可读性换成了安全性。所以对「值为空」的处理是
 * **显式标出来**（`(空)`）而不是丢掉 —— 那是多给信息，不是少给。
 * 只有「压根没有参数」才收起整个框，因为那时确实没有信息可丢。
 */

export interface ArgRow {
  key: string
  /** 给人看的取值；空值统一显示为 `(空)`。 */
  display: string
  /** 该值是否为空（`''` / `null` / `[]` / `{}`）。`0` 与 `false` **不算**空。 */
  empty: boolean
}

export interface ArgsView {
  /** none=没有参数（收起整个框）；rows=逐行键值；raw=解析不了，原样显示。 */
  kind: 'none' | 'rows' | 'raw'
  rows: ArgRow[]
  raw: string
}

const EMPTY_MARK = '(空)'

function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true
  if (typeof v === 'string') return v.length === 0
  if (Array.isArray(v)) return v.length === 0
  // 0 / false 是实实在在的取值，不算空
  if (typeof v === 'object') return Object.keys(v as object).length === 0
  return false
}

function display(v: unknown): string {
  if (isEmptyValue(v)) return EMPTY_MARK
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

export function argsView(argsJson: string): ArgsView {
  const raw = argsJson ?? ''
  if (raw.trim().length === 0) {
    return { kind: 'none', rows: [], raw }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // 解析不了的时候用户**更**需要看到原文 —— 那正是出问题的信号
    return { kind: 'raw', rows: [], raw }
  }
  if (parsed === null) {
    return { kind: 'none', rows: [], raw }
  }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    // 顶层不是对象:工具约定被打破了,原样摊开给用户看
    return { kind: 'raw', rows: [], raw }
  }
  const entries = Object.entries(parsed as Record<string, unknown>)
  if (entries.length === 0) {
    return { kind: 'none', rows: [], raw }
  }
  return {
    kind: 'rows',
    raw,
    rows: entries.map(([key, value]) => ({
      key,
      display: display(value),
      empty: isEmptyValue(value),
    })),
  }
}

/** 有没有值得展示的参数。`{}` / 空串 / `null` 都算没有。 */
export function hasArgs(argsJson: string): boolean {
  return argsView(argsJson).kind !== 'none'
}
