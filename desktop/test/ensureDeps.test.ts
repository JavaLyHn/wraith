import { describe, it, expect, beforeEach, afterEach } from 'vitest'
// @ts-expect-error —— 构建脚本是无类型的 .mjs,这里只测它导出的纯函数
import { electronViteBinName, depsPresent, npmBinary, npmInstallArgs } from '../scripts/ensure-deps.mjs'
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
