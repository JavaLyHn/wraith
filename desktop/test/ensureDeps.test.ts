import { describe, it, expect, beforeEach, afterEach } from 'vitest'
// @ts-expect-error —— 构建脚本是无类型的 .mjs,这里只测它导出的纯函数
import { electronViteBinName, depsPresent, npmBinary, npmInstallArgs, ensureDeps } from '../scripts/ensure-deps.mjs'
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
  it('入口存在时返回 true', () => {
    const binDir = path.join(tmp, 'node_modules', '.bin')
    fs.mkdirSync(binDir, { recursive: true })
    fs.writeFileSync(path.join(binDir, 'electron-vite.cmd'), '')
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
    // 在 tmp 里造一个 .bin/electron-vite.cmd,让 depsPresent 返回 true
    const binDir = path.join(tmp, 'node_modules', '.bin')
    fs.mkdirSync(binDir, { recursive: true })
    fs.writeFileSync(path.join(binDir, 'electron-vite.cmd'), '')

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
