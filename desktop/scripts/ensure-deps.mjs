import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * dev 启动前自动补齐 npm 依赖。
 *
 * **为什么需要它**:新的 Git worktree 或首次 checkout 后,`desktop/node_modules` 不存在。
 * 用户直接敲 `npm run dev` 会得到 `electron-vite: command not found`,得先手动 `npm install
 * --legacy-peer-deps`。这层「记得先装依赖」的认知负担在 worktree 频繁切换时很烦 ——
 * 本脚本把这一步收进 `predev` 钩子,让 `npm run dev` 在干净 checkout 上也能直接跑。
 *
 * **安全边界**:只在 `node_modules/.bin/electron-vite` 缺失时才调 npm install;
 * 依赖已就绪时立即退出,不访问网络、不改任何文件。
 *
 * **不做什么**:不跑 Maven、不下载 JRE、不改 lockfile 之外的版本。后端 jar 仍由
 * `dev-win.ps1` 等现有脚本负责。
 */

/** 当前脚本所在目录的上级 = desktop 项目根。 */
const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 平台对应的 electron-vite 入口文件名。
 * Windows 上 npm 生成 `.cmd` shim;mac/Linux 是无后缀的可执行脚本。
 */
export function electronViteBinName(platform) {
  return platform === 'win32' ? 'electron-vite.cmd' : 'electron-vite'
}

/**
 * 检查依赖是否已就绪 —— 看 `node_modules/.bin/electron-vite` 入口在不在。
 * 不查 `node_modules` 目录是否存在:干净 checkout 连这个目录都没有,
 * existsSync 对不存在的路径返回 false,正好是我们要的。
 */
export function depsPresent(platform, projectRoot) {
  const bin = path.join(projectRoot, 'node_modules', '.bin', electronViteBinName(platform))
  return existsSync(bin)
}

/**
 * 平台对应的 npm 可执行名。
 * Windows 上子进程里直接调 `npm` 会走 `.ps1`(PowerShell 脚本),在非 PowerShell
 * 父进程里不可靠;`npm.cmd` 是跨 shell 的稳定入口。
 */
export function npmBinary(platform) {
  return platform === 'win32' ? 'npm.cmd' : 'npm'
}

/** npm install 的参数。`--legacy-peer-deps` 是必须的:
 *  `@lobehub/icons` → `@lobehub/ui` 有 react 18 vs 19 的 peer 冲突,
 *  干净 checkout 上普通 `npm install` 会 ERESOLVE 失败。 */
export function npmInstallArgs() {
  return ['install', '--legacy-peer-deps']
}

/**
 * 主入口:依赖缺失时调 npm install,失败则非零退出。
 * npm install 继承当前 cwd / env / stdio,用户能看到完整的安装输出。
 *
 * @param platform    传入而非用 process.platform,便于测试
 * @param projectRoot  同上
 * @param spawn        可注入的 spawnSync,测试时传 mock;缺省用 child_process.spawnSync
 * @returns 0=成功或依赖已就绪;非零=npm install 失败(错误码透传)
 */
export function ensureDeps(platform = process.platform, projectRoot = desktopRoot, spawn = spawnSync) {
  if (depsPresent(platform, projectRoot)) {
    return 0
  }

  console.log('[ensure-deps] node_modules 缺失,自动安装依赖…')
  const result = spawn(npmBinary(platform), npmInstallArgs(), {
    cwd: projectRoot,
    stdio: 'inherit',
    env: process.env,
    // Windows 上必须 shell:true —— Node 18.20.2+ 为修 CVE-2024-27980,
    // spawnSync 调 .cmd 文件不带 shell 会直接 EINVAL,status 永远是 null,
    // npm 根本不启动,predev 等于没跑。参数是内部常量,无注入风险。
    // POSIX 上保持 shell:false,避免 sh -c 改变错误码/信号语义。
    shell: platform === 'win32',
  })

  if (result.error || result.status !== 0) {
    // 保留 npm 的原始错误码,禁止继续启动 Electron。
    // result.error 能进来说明 spawn 本身就失败了(EINVAL 等),status 是 null,
    // 必须连同 error 一起判,否则 EINVAL 会被 `status ?? 1` 吞成 1 但日志只显示 null,误导排查。
    console.error(`[ensure-deps] npm install 失败 (exit ${result.status}${result.error ? `, error: ${result.error.message}` : ''})`)
    return result.status ?? 1
  }

  return 0
}

/**
 * 判断当前模块是不是"被直接运行"(而非被 import)。
 *
 * **为什么不能直接字符串拼接 `file://${process.argv[1]}`**:
 *  Windows 上 `process.argv[1]` 是 `c:\Users\...\foo.mjs`(反斜杠、无 file:// 前缀),
 *  而 `import.meta.url` 是 `file:///c:/Users/.../foo.mjs`(三斜杠 + 正斜杠)。
 *  字符串拼出来的 `file://c:\Users\...\foo.mjs` 与 import.meta.url 永远不相等,
 *  导致 predev 钩子在 Windows 上静默空跑、ensureDeps() 从不被调用,
 *  干净 worktree 上 node_modules 不会自动安装,electron-vite 报"不是内部或外部命令"。
 *  用 `node:url` 的 `pathToFileURL` 把 argv[1] 规范成 file URL 再比较,跨平台可靠。
 *
 * @param metaUrl  当前模块的 `import.meta.url`
 * @param argv1     `process.argv[1]`(直接运行时是本脚本路径,被 import 时是宿主入口)
 * @returns true = 本模块正在被直接运行
 */
export function isDirectRun(metaUrl, argv1) {
  if (!argv1) return false
  try {
    return metaUrl === pathToFileURL(argv1).href
  } catch {
    // argv1 不是合法路径(极端情况下)时安全地视为非直接运行,而非抛错崩掉 predev
    return false
  }
}

// 直接运行时执行;被 import 时不执行(测试用)
if (isDirectRun(import.meta.url, process.argv[1])) {
  process.exit(ensureDeps())
}
