export type GlobalMode = 'auto' | 'expanded' | 'collapsed'

/** 解析某可折叠块是否展开。优先级:单块 override > 全局 mode > auto 默认。 */
export function resolveExpanded(
  key: string,
  autoDefault: boolean,
  overrides: Record<string, boolean>,
  globalMode: GlobalMode,
): boolean {
  if (Object.prototype.hasOwnProperty.call(overrides, key)) return overrides[key]
  if (globalMode === 'expanded') return true
  if (globalMode === 'collapsed') return false
  return autoDefault
}

/** 点总开关后的下一模式:expanded ↔ collapsed;auto 首次点视为 expanded(展开全部)。 */
export function nextGlobalMode(current: GlobalMode): 'expanded' | 'collapsed' {
  return current === 'expanded' ? 'collapsed' : 'expanded'
}

/** 总开关按钮文案。 */
export function globalToggleLabel(current: GlobalMode): string {
  return current === 'expanded' ? '▾ 折叠全部' : '▸ 展开全部'
}
