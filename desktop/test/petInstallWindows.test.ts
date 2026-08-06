import { describe, it, expect } from 'vitest'
import { npxSearchDirs, resolveNpx, npxSpawnArgs } from '../src/shared/petInstall'

/**
 * Windows 上找不到 / 起不动 npx。
 *
 * 用户在 Windows 桌面「宠物库 → 从 Petdex 安装」上看到
 * 「未找到 Node/npx。请先安装 Node.js」—— 而那台机器上 Node 明明装着
 * （他正用 `npm run dev` 跑着这个应用）。
 *
 * 原来这段是 macOS-only 写死的，三处都不成立于 Windows：
 *
 *  1. `pathEnv.split(':')` —— Windows 的 PATH 用 `;` 分隔。
 *     用 `:` 切的结果是整条 PATH 变成**一个**巨大的"目录"，
 *     而且 `C:\...` 里的盘符冒号还会把它切得更碎。等于 PATH 完全没被读到。
 *  2. `${dir}/npx` —— Windows 上 npm 装出来的是 `npx.cmd`，没有无扩展名的 `npx`。
 *     （同一个缺陷在 Java 侧的 MCP stdio 通道修过一次，见 `StdioCommand`。）
 *  3. 兜底目录全是 `/opt/homebrew/bin` 这类 POSIX 路径。
 *
 * 还有第四层，光修解析是碰不到的：**`.cmd` 不能直接 spawn**。
 * Node 18.20 / 20.12 起（CVE-2024-27980 的修复）`shell:false` 直接起批处理会抛
 * `EINVAL`。所以解析出 `npx.cmd` 之后还得经 `cmd.exe /c`。
 */

const WIN_PATH = 'C:\\Program Files\\nodejs\\;C:\\Windows\\system32;C:\\Users\\me\\AppData\\Roaming\\npm'
const HOME_WIN = 'C:\\Users\\me'

describe('npxSearchDirs —— 分隔符按平台', () => {
  it('Windows 用 ; 切,且盘符冒号不会把路径切碎', () => {
    const dirs = npxSearchDirs(WIN_PATH, HOME_WIN, 'win32')
    expect(dirs).toContain('C:\\Program Files\\nodejs')      // 尾部反斜杠要归一掉
    expect(dirs).toContain('C:\\Windows\\system32')
    expect(dirs).toContain('C:\\Users\\me\\AppData\\Roaming\\npm')
    // 用 : 切过的话会冒出 'C' 和 '\Program Files\nodejs\;C' 这种残骸
    expect(dirs).not.toContain('C')
  })

  it('Windows 兜底目录是 Windows 的,不是 /opt/homebrew/bin', () => {
    const dirs = npxSearchDirs(undefined, HOME_WIN, 'win32')
    expect(dirs.some(d => d.toLowerCase().includes('nodejs'))).toBe(true)
    expect(dirs.some(d => d.toLowerCase().includes('appdata\\roaming\\npm'))).toBe(true)
    expect(dirs).not.toContain('/opt/homebrew/bin')
  })

  it('PATH 里的目录仍然优先于兜底目录(保序)', () => {
    const dirs = npxSearchDirs('D:\\my\\node', HOME_WIN, 'win32')
    expect(dirs[0]).toBe('D:\\my\\node')
  })

  it('darwin 行为一字不变 —— 这次改动不许动 mac', () => {
    const dirs = npxSearchDirs('/usr/local/bin:/foo/bin', '/Users/me', 'darwin')
    expect(dirs[0]).toBe('/usr/local/bin')
    expect(dirs[1]).toBe('/foo/bin')
    expect(dirs).toContain('/opt/homebrew/bin')
  })
})

describe('resolveNpx —— 文件名按平台', () => {
  it('Windows 认 npx.cmd', () => {
    const exists = (p: string): boolean => p === 'C:\\Program Files\\nodejs\\npx.cmd'
    expect(resolveNpx(['C:\\nope', 'C:\\Program Files\\nodejs'], exists, 'win32'))
      .toBe('C:\\Program Files\\nodejs\\npx.cmd')
  })

  it('Windows 上优先 .exe(volta 这类 shim 装的是 exe,能直接 spawn,不必过 cmd)', () => {
    const exists = (p: string): boolean => p.endsWith('npx.exe') || p.endsWith('npx.cmd')
    expect(resolveNpx(['C:\\n'], exists, 'win32')).toBe('C:\\n\\npx.exe')
  })

  it('Windows 上 .bat 也认(排在 .cmd 之后)', () => {
    const exists = (p: string): boolean => p === 'C:\\n\\npx.bat'
    expect(resolveNpx(['C:\\n'], exists, 'win32')).toBe('C:\\n\\npx.bat')
  })

  it('Windows 上**不**接受无扩展名的 npx —— 那是给 Git Bash 用的 sh 脚本,CreateProcess 起不了', () => {
    const exists = (p: string): boolean => p === 'C:\\n\\npx'
    expect(resolveNpx(['C:\\n'], exists, 'win32')).toBeNull()
  })

  it('Windows 用反斜杠拼接', () => {
    const seen: string[] = []
    resolveNpx(['C:\\n'], (p) => { seen.push(p); return false }, 'win32')
    expect(seen.every(p => !p.includes('/'))).toBe(true)
  })

  it('darwin 仍只找无扩展名的 npx', () => {
    const exists = (p: string): boolean => p === '/opt/homebrew/bin/npx'
    expect(resolveNpx(['/usr/local/bin', '/opt/homebrew/bin'], exists, 'darwin'))
      .toBe('/opt/homebrew/bin/npx')
    expect(resolveNpx(['/a'], (p) => p === '/a/npx.cmd', 'darwin')).toBeNull()
  })

  it('都找不到 → null(调用方据此明确报错,不静默)', () => {
    expect(resolveNpx(['C:\\a', 'C:\\b'], () => false, 'win32')).toBeNull()
  })
})

describe('npxSpawnArgs —— .cmd 不能直接 spawn', () => {
  const ARGS = ['petdex@latest', 'install', 'boba']

  it('Windows 的 .cmd 必须经 cmd.exe /c —— 直接 spawn 会 EINVAL(Node 18.20+/20.12+)', () => {
    const r = npxSpawnArgs('C:\\n\\npx.cmd', ARGS, 'win32', 'C:\\Windows\\system32\\cmd.exe')
    expect(r.command).toBe('C:\\Windows\\system32\\cmd.exe')
    expect(r.args).toEqual(['/c', 'C:\\n\\npx.cmd', ...ARGS])
  })

  it('.bat 同理', () => {
    expect(npxSpawnArgs('C:\\n\\npx.bat', ARGS, 'win32', undefined).args[0]).toBe('/c')
  })

  it('ComSpec 缺失时回落到裸 cmd.exe(交给 PATH 找)', () => {
    expect(npxSpawnArgs('C:\\n\\npx.cmd', ARGS, 'win32', '').command).toBe('cmd.exe')
    expect(npxSpawnArgs('C:\\n\\npx.cmd', ARGS, 'win32', '  ').command).toBe('cmd.exe')
  })

  it('Windows 的 .exe 直接起,不套 cmd —— 少一层解析就少一分注入面', () => {
    const r = npxSpawnArgs('C:\\n\\npx.exe', ARGS, 'win32', 'C:\\Windows\\system32\\cmd.exe')
    expect(r.command).toBe('C:\\n\\npx.exe')
    expect(r.args).toEqual(ARGS)
  })

  it('darwin 原样直起', () => {
    const r = npxSpawnArgs('/opt/homebrew/bin/npx', ARGS, 'darwin', undefined)
    expect(r.command).toBe('/opt/homebrew/bin/npx')
    expect(r.args).toEqual(ARGS)
  })

  it('参数顺序与个数不被改写 —— 宠物名必须是最后一个定长实参', () => {
    for (const p of ['win32', 'darwin'] as const) {
      const r = npxSpawnArgs(p === 'win32' ? 'C:\\n\\npx.cmd' : '/b/npx', ARGS, p, undefined)
      expect(r.args[r.args.length - 1]).toBe('boba')
      expect(r.args.filter(a => a === 'install')).toHaveLength(1)
    }
  })
})
