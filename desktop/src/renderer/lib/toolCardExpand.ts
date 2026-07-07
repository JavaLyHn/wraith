/** 智能默认:运行中或失败→展开;完成且成功→折叠。 */
export function toolCardDefaultExpanded(card: { done: boolean; ok?: boolean }): boolean {
  return !card.done || card.ok === false
}
