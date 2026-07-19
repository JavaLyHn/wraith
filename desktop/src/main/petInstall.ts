/**
 * petInstall(main)——应用内执行 `npx petdex@latest install <名>` 的副作用部分。
 *
 * 安全边界(见 spec):名字白名单(isValidPetName)+ 固定命令模板 + shell:false 数组传参
 * + 120s 超时。用户只能控制 <名>,且必须过闸;命令名/其余参数恒定,无 shell 解析,故无注入面。
 * npx 路径经 shared/petInstall 的 resolveNpx 从常见目录解析(GUI app 不继承登录 shell 的 PATH)。
 *
 * spawnFn / npxPath 是测试注入点:单测传假 spawn 与固定 npxPath,免真跑 npx、免碰真实 fs/PATH。
 */

import { spawn } from 'node:child_process'
import type { SpawnOptions, ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import { isValidPetName, npxSearchDirs, resolveNpx } from '../shared/petInstall'
import type { PetInstallResult } from '../shared/pets'

/** petdex 安装超时:下载 + 解包一般远小于此;仅用于防子进程挂死。 */
const INSTALL_TIMEOUT_MS = 120_000

type SpawnFn = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess

export interface PetdexInstallDeps {
  /** 子进程工作目录。petdex 自身默认装到 ~/.codex/pets,这里给个中性 cwd(通常 os.homedir())。 */
  cwd: string
  /** 流式输出回调(stdout/stderr 合并,原样字符串块)。 */
  onOutput: (chunk: string) => void
  /** 测试注入:默认真 child_process.spawn。 */
  spawnFn?: SpawnFn
  /**
   * 测试注入:npx 绝对路径。
   * - undefined(默认):自动从常见目录解析,找不到 → 失败。
   * - null:显式模拟"未找到 npx"。
   * - string:直接用。
   */
  npxPath?: string | null
}

function resolveNpxDefault(): string | null {
  return resolveNpx(npxSearchDirs(process.env['PATH'], os.homedir()), (p) => fs.existsSync(p))
}

/**
 * 跑一次 petdex 安装。任何早退(非法名 / 未找到 npx)都在 spawn 之前返回带用户文案的失败,
 * 绝不把不可信输入送进子进程。close 事件按退出码判成败;error 事件(如 ENOENT)与超时
 * (signal 非空)各给清晰文案。Promise 只 resolve、不 reject——调用方按 result.ok 分支即可。
 */
export function runPetdexInstall(name: string, deps: PetdexInstallDeps): Promise<PetInstallResult> {
  if (!isValidPetName(name)) {
    return Promise.resolve({ ok: false, error: '无效宠物名:只允许小写字母、数字、连字符,长度 1–64。' })
  }
  const npx = deps.npxPath !== undefined ? deps.npxPath : resolveNpxDefault()
  if (!npx) {
    return Promise.resolve({ ok: false, error: '未找到 Node/npx。请先安装 Node.js,或改用手动命令在终端执行。' })
  }
  const spawnFn: SpawnFn = deps.spawnFn ?? spawn
  return new Promise<PetInstallResult>((resolve) => {
    let settled = false
    const done = (r: PetInstallResult): void => { if (!settled) { settled = true; resolve(r) } }
    try {
      const child = spawnFn(npx, ['petdex@latest', 'install', name], {
        shell: false,
        cwd: deps.cwd,
        timeout: INSTALL_TIMEOUT_MS,
        env: process.env,
      })
      child.stdout?.on('data', (d: Buffer) => deps.onOutput(d.toString()))
      child.stderr?.on('data', (d: Buffer) => deps.onOutput(d.toString()))
      child.on('error', (e: Error) => done({ ok: false, error: `无法启动 npx:${e.message}` }))
      child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
        if (signal) return done({ ok: false, error: `安装被终止(${signal},可能超时或被杀)。` })
        done(code === 0 ? { ok: true, error: null } : { ok: false, error: `petdex 安装失败(退出码 ${code})。` })
      })
    } catch (e) {
      done({ ok: false, error: (e as Error).message })
    }
  })
}
