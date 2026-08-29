// desktop/src/renderer/lib/logger.ts
// 轻量级级别可控 logger:默认只输出 warn/error;VITE_DEBUG=true 时输出 debug/info。
// 所有 catch 块里的 console.error 应该用 logger.error —— 生产环境可由打包器
// 自动剥离或通过 window.__LOG_LEVEL__ 运行时降级。

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

function levelFromEnv(): LogLevel {
  if (typeof window !== 'undefined') {
    const override = (window as unknown as { __LOG_LEVEL__?: LogLevel }).__LOG_LEVEL__
    if (override) return override
  }
  const env = (import.meta as ImportMeta).env as Record<string, string | undefined> | undefined
  if (env?.VITE_DEBUG === 'true') return 'debug'
  // 开发模式下用 info 级别,生产默认 warn
  return env?.DEV ? 'info' : 'warn'
}

let currentLevel: LogLevel = levelFromEnv()

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

function shouldLog(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[currentLevel]
}

function fmtTag(tag?: string): string {
  return tag ? `[${tag}]` : ''
}

export const logger = {
  setLevel(level: LogLevel): void { currentLevel = level },
  getLevel(): LogLevel { return currentLevel },
  debug(tag?: string, ...args: unknown[]): void {
    if (shouldLog('debug')) console.debug(fmtTag(tag), ...args)
  },
  info(tag?: string, ...args: unknown[]): void {
    if (shouldLog('info')) console.info(fmtTag(tag), ...args)
  },
  warn(tag?: string, ...args: unknown[]): void {
    if (shouldLog('warn')) console.warn(fmtTag(tag), ...args)
  },
  error(tag?: string, ...args: unknown[]): void {
    // error 级别始终输出(catch 块里的错误需要在生产环境也能看到)
    console.error(fmtTag(tag), ...args)
  },
}
