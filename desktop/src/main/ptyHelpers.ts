/** 选择要 spawn 的 shell:非 win 优先 $SHELL;win 用 COMSPEC;否则平台默认。 */
export function resolveShell(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  if (platform === 'win32') return env.COMSPEC || 'powershell.exe'
  if (env.SHELL && env.SHELL.trim()) return env.SHELL
  return platform === 'darwin' ? '/bin/zsh' : '/bin/bash'
}
