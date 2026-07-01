/** 取路径末段做显示名；空则返回「默认工作目录」。 */
export function baseName(p: string): string {
  if (!p) return '默认工作目录'
  const parts = p.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || p
}
