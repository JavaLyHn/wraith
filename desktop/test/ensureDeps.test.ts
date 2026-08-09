import { describe, it, expect, beforeEach, afterEach } from 'vitest'
// @ts-expect-error —— 构建脚本是无类型的 .mjs,这里只测它导出的纯函数
import { electronViteBinName, electronViteEntryPath, depsPresent, npmBinary, npmInstallArgs, ensureDeps, isDirectRun } from '../scripts/ensure-deps.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let tmp: string

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ensure-deps-'))
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('electronViteBinName', () => {
  it('Windows 上带 .cmd 后缀', () => {
    expect(electronViteBinName('win32')).toBe('electron-vite.cmd')
  })

  it('mac/Linux 上无后缀', () => {
    expect(electronViteBinName('darwin')).toBe('electron-vite')
    expect(electronViteBinName('linux')).toBe('electron-vite')
  })
})

describe('depsPresent', () => {
  /** 在 tmp 下造一个完整的 electron-vite 安装(bin shim + 实际包入口) */
  function createCompleteInstall(platform: string) {
    const binDir = path.join(tmp, 'node_modules', '.bin')
    fs.mkdirSync(binDir, { recursive: true })
    fs.writeFileSync(path.join(binDir, electronViteBinName(platform)), '')
    const entryDir = path.dirname(path.join(tmp, electronViteEntryPath()))
    fs.mkdirSync(entryDir, { recursive: true })
    fs.writeFileSync(path.join(tmp, electronViteEntryPath()), '')
  }

  it('bin shim 和包入口都存在时返回 true', () => {
    createCompleteInstall('win32')
    expect(depsPresent('win32', tmp)).toBe(true)
  })

  it('入口不存在时返回 false', () => {
    expect(depsPresent('win32', tmp)).toBe(false)
    expect(depsPresent('darwin', tmp)).toBe(false)
  })

  it('node_modules 目录都没有时返回 false,不抛', () => {
    // 干净 checkout 的典型状态:连 node_modules 都不存在
    expect(depsPresent('linux', tmp)).toBe(false)
  })

  it('半安装状态:bin shim 存在但包入口缺失时返回 false', () => {
    // 损坏的安装:npm 在异常中断后可能残留 .bin shim 但实际包已被删/未装,
    // 此时 depsPresent 必须返回 false 触发重装,否则 electron-vite 启动时 MODULE_NOT_FOUND。
    const binDir = path.join(tmp, 'node_modules', '.bin')
    fs.mkdirSync(binDir, { recursive: true })
    fs.writeFileSync(path.join(binDir, 'electron-vite.cmd'), '')
    // 注意:不创建 electron-vite/bin/electron-vite.js
    expect(depsPresent('win32', tmp)).toBe(false)
  })
})

describe('npmBinary', () => {
  it('Windows 用 npm.cmd(PowerShell 直接调 npm 会走 .ps1,子进程里不可靠)', () => {
    expect(npmBinary('win32')).toBe('npm.cmd')
  })

  it('mac/Linux 用 npm', () => {
    expect(npmBinary('darwin')).toBe('npm')
    expect(npmBinary('linux')).toBe('npm')
  })
})

describe('npmInstallArgs', () => {
  it('带 --legacy-peer-deps(react 18 vs 19 的 peer 冲突必须有它)', () => {
    const args = npmInstallArgs()
    expect(args).toContain('install')
    expect(args).toContain('--legacy-peer-deps')
  })
})

describe('ensureDeps', () => {
  /** mock spawn 的最小签名:只关心被调时的参数和返回的 status */
  function mockSpawn(status: number | null) {
    const calls: Array<{ cmd: string; args: string[]; opts: object }> = []
    const fn = (cmd: string, args: string[], opts: object) => {
      calls.push({ cmd, args, opts })
      return { status }
    }
    return { fn, calls }
  }

  it('依赖已就绪时返回 0 且不调 spawn', () => {
    // 在 tmp 里造完整安装(bin shim + 包入口),让 depsPresent 返回 true
    const binDir = path.join(tmp, 'node_modules', '.bin')
    fs.mkdirSync(binDir, { recursive: true })
    fs.writeFileSync(path.join(binDir, 'electron-vite.cmd'), '')
    const entryDir = path.dirname(path.join(tmp, electronViteEntryPath()))
    fs.mkdirSync(entryDir, { recursive: true })
    fs.writeFileSync(path.join(tmp, electronViteEntryPath()), '')

    const { fn, calls } = mockSpawn(0)
    const code = ensureDeps('win32', tmp, fn as any)

    expect(code).toBe(0)
    expect(calls).toHaveLength(0) // 依赖在,不该碰 npm
  })

  it('依赖缺失时用正确的 npm 命令安装并返回 0', () => {
    // tmp 里没有 node_modules,depsPresent 返回 false
    const { fn, calls } = mockSpawn(0)
    const code = ensureDeps('win32', tmp, fn as any)

    expect(code).toBe(0)
    expect(calls).toHaveLength(1)
    expect(calls[0].cmd).toBe('npm.cmd') // Windows 上必须是 npm.cmd
    expect(calls[0].args).toEqual(['install', '--legacy-peer-deps'])
    expect(calls[0].opts).toHaveProperty('cwd', tmp)
  })

  it('半安装状态(bin shim 在但包入口缺失)时触发重装', () => {
    // 残留的 .cmd shim 存在但 electron-vite/bin/electron-vite.js 缺失,
    // depsPresent 应返回 false,触发 npm install 修复损坏的安装。
    const binDir = path.join(tmp, 'node_modules', '.bin')
    fs.mkdirSync(binDir, { recursive: true })
    fs.writeFileSync(path.join(binDir, 'electron-vite.cmd'), '')

    const { fn, calls } = mockSpawn(0)
    const code = ensureDeps('win32', tmp, fn as any)

    expect(code).toBe(0)
    expect(calls).toHaveLength(1) // 必须触发重装
  })

  it('Windows 上 spawn 必须带 shell:true(Node 18.20.2+ 调 .cmd 不带 shell 会 EINVAL)', () => {
    // CVE-2024-27980 修复后,Windows 上 spawnSync('npm.cmd',...) 不带 shell:true
    // 直接返回 status:null + error:EINVAL,npm 根本不启动。
    // 参数是内部常量 ['install','--legacy-peer-deps'],无注入风险,shell:true 安全。
    const { fn, calls } = mockSpawn(0)
    ensureDeps('win32', tmp, fn as any)

    expect(calls[0].opts).toHaveProperty('shell', true)
  })

  it('mac/Linux 上 spawn 不带 shell(避免 sh -c 改变错误码/信号语义)', () => {
    const { fn, calls } = mockSpawn(0)
    ensureDeps('darwin', tmp, fn as any)

    expect(calls[0].opts).toHaveProperty('shell', false)
  })

  it('npm install 失败时透传非零退出码,禁止继续启动 Electron', () => {
    const { fn, calls } = mockSpawn(1) // npm install 返回 1
    const code = ensureDeps('win32', tmp, fn as any)

    expect(code).toBe(1) // 必须是 npm 的原始错误码,不能被吞成 0
    expect(calls).toHaveLength(1)
  })

  it('npm install 被 signal 杀掉时(status=null)回落到 1', () => {
    // spawnSync 被 signal 终止时 status 是 null,不能让 predev 误认为成功
    const { fn } = mockSpawn(null)
    const code = ensureDeps('linux', tmp, fn as any)

    expect(code).toBe(1)
  })
})

describe('isDirectRun', () => {
  // 回归:Windows 上 `import.meta.url === \`file://${process.argv[1]}\`` 永远为 false
  // —— import.meta.url 是 `file:///c:/Users/.../foo.mjs`(三斜杠+正斜杠),
  // 字符串拼出来的是 `file://c:\Users\...\foo.mjs`(两斜杠+反斜杠)。
  // 后果:predev 钩子静默空跑,ensureDeps() 从不被调用,
  // 干净 worktree 上 node_modules 不会自动安装,electron-vite 直接报"不是内部或外部命令"。
  // 修复:用 node:url 的 pathToFileURL 把 argv[1] 规范成 file URL 再比较。
  it('Windows 反斜杠绝对路径能匹配对应的 file URL', () => {
    const argv1 = 'c:\\Users\\LyHn\\repo\\desktop\\scripts\\ensure-deps.mjs'
    const metaUrl = 'file:///c:/Users/LyHn/repo/desktop/scripts/ensure-deps.mjs'
    expect(isDirectRun(metaUrl, argv1)).toBe(true)
  })

  // pathToFileURL 按当前平台解析路径,POSIX 路径只在 POSIX 平台上才会被正确规范成 file URL,
  // 在 Windows 上跑会假失败 —— 用 skipIf 把它限定在非 win32 平台
  it.skipIf(process.platform === 'win32')('POSIX 绝对路径仍能匹配(不回归 mac/Linux)', () => {
    const argv1 = '/Users/lyhn/repo/desktop/scripts/ensure-deps.mjs'
    const metaUrl = 'file:///Users/lyhn/repo/desktop/scripts/ensure-deps.mjs'
    expect(isDirectRun(metaUrl, argv1)).toBe(true)
  })

  it('被 vitest import 时 argv[1] 不是本脚本,返回 false', () => {
    // 测试进程里 import.meta.url 指向 ensure-deps.mjs,
    // 但 argv[1] 指向 vitest 入口,不该判定为直接运行
    const metaUrl = 'file:///c:/repo/desktop/scripts/ensure-deps.mjs'
    const argv1 = 'c:\\path\\to\\node_modules\\vitest\\dist\\cli.js'
    expect(isDirectRun(metaUrl, argv1)).toBe(false)
  })
})
