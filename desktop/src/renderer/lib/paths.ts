/** 取路径末段做显示名；空则返回「默认工作目录」。 */
export function baseName(p: string): string {
  if (!p) return '默认工作目录'
  const parts = p.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || p
}

/** 相对路径按 workspace 拼绝对(供打开/揭示/下载等 fs 操作);绝对路径(POSIX /… 或 Windows 盘符)原样;无 workspace 原样。 */
export function resolveWorkspacePath(path: string, workspace: string | null): string {
  if (path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path)) return path
  return workspace ? workspace.replace(/\/+$/, '') + '/' + path : path
}
