import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 把后端 jar 与捆绑 JRE 备进 resources/,供 electron-builder 的 extraResources 打包。
 *
 * **这个脚本知道自己在为哪个平台备料。** 原来它只用 `process.platform`(宿主)判断
 * 已有 JRE 够不够用,不看构建目标 —— 于是在装了 wine 的 mac 上先 dist:mac 再 dist:win,
 * 它会看到 mac 那份 runtime 里有 bin/java 就跳过 jlink,把 **macOS 的 JRE 打进
 * Windows 安装包**,而且一声不吭。装完的用户只会看到后端起不来。
 *
 * 现在:目标由 `--target mac|win|linux` 显式传入(缺省=宿主),
 * 目标≠宿主直接硬失败,不给出一个看起来正常、装完却是废的包。
 */

export const TARGETS = ['mac', 'win', 'linux']

/** 宿主平台对应的目标标记。 */
export function hostTarget(platform) {
  if (platform === 'win32') return 'win'
  if (platform === 'darwin') return 'mac'
  return 'linux'
}

/** 解析 `--target win` / `--target=win`;没传则按宿主。非法值抛错,不静默退回宿主。 */
export function parseTarget(argv, platform) {
  const i = argv.findIndex((a) => a === '--target' || a.startsWith('--target='))
  if (i === -1) return hostTarget(platform)
  const raw = argv[i].includes('=') ? argv[i].slice('--target='.length) : argv[i + 1]
  if (!raw || !TARGETS.includes(raw)) {
    throw new Error(`--target 只接受 ${TARGETS.join(' / ')},收到:${raw ?? '(空)'}`)
  }
  return raw
}

/**
 * 目标平台的 java 可执行体名。
 * ⚠ mac 与 linux **同为** 'java' —— 光看文件名区分不了这两者,所以复用前还要真跑一次。
 */
export function expectedJavaBin(target) {
  return target === 'win' ? 'java.exe' : 'java'
}

/**
 * 交叉构建拒绝理由;可以构建则返回 null。
 *
 * 为什么不是警告而是拒绝:捆绑 JRE 由**宿主** jlink 产出,jlink 不带 --module-path
 * 指向目标平台 jmods 就只能产宿主平台的运行时;node-pty 又是原生模块。
 * 两者都没有"降级也能用"的形态 —— 产出的包必定是废的,那就不该产出。
 */
export function crossBuildRefusal(target, platform) {
  const host = hostTarget(platform)
  if (target === host) return null
  return [
    `✖ 不能交叉出包:目标 = ${target},宿主 = ${host}。`,
    '',
    '  捆绑 JRE 由宿主 jlink 产出(scripts/gen-jre.mjs),产的是宿主平台的二进制;',
    '  node-pty 是原生模块,同样必须在目标平台 npm install。',
    `  硬出的包会在装完后找不到 runtime/bin/${expectedJavaBin(target)},后端起不来。`,
    '',
    `  请在 ${target} 机器上构建。Windows 步骤见 docs/windows-release.md。`,
  ].join('\n')
}

/**
 * 已有的 runtime 能不能复用(纯函数,fs 与探针都注入)。
 *
 * 两道:名字对不对(catch 掉 win↔非win),以及**真的能跑**
 * (catch 掉 mac↔linux —— 这两者可执行体同名,只有跑一下才分得出)。
 */
export function runtimeReusable(runtimeDir, target, exists, probe) {
  const bin = path.join(runtimeDir, 'bin', expectedJavaBin(target))
  if (!exists(bin)) return false
  return probe(bin)
}

function main() {
  const DIR = path.dirname(fileURLToPath(import.meta.url))
  const ROOT = path.resolve(DIR, '..')
  const REPO = path.resolve(ROOT, '..')            // 仓库根
  const JAR_SRC = path.join(REPO, 'target', 'wraith-1.0-SNAPSHOT.jar')
  const RES = path.join(ROOT, 'resources')
  const RUNTIME = path.join(RES, 'runtime')

  const target = parseTarget(process.argv.slice(2), process.platform)
  const refusal = crossBuildRefusal(target, process.platform)
  if (refusal) { console.error(refusal); process.exit(1) }

  if (!existsSync(JAR_SRC)) {
    console.error('缺 jar,请先在仓库根跑 mvn -q clean package -DskipTests:', JAR_SRC)
    process.exit(1)
  }
  mkdirSync(RES, { recursive: true })
  copyFileSync(JAR_SRC, path.join(RES, 'wraith.jar'))

  // 探针:真跑一次 `java -version`。跑不起来就当没有 —— 宁可多花一次 jlink,
  // 也不要把一份跑不动的 runtime 打进包里。
  const probe = (bin) => {
    try { execFileSync(bin, ['-version'], { stdio: 'ignore' }); return true }
    catch { return false }
  }
  if (!runtimeReusable(RUNTIME, target, existsSync, probe)) {
    execFileSync('node', [path.join(DIR, 'gen-jre.mjs')], { stdio: 'inherit' })
  }
  console.log(`resources 就绪(target=${target}):wraith.jar + runtime`)
}

const invokedDirectly = process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) main()
