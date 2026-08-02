import { describe, it, expect } from 'vitest'
// @ts-expect-error —— 构建脚本是无类型的 .mjs,这里只测它导出的纯函数
import { parseTarget, hostTarget, expectedJavaBin, crossBuildRefusal, runtimeReusable, TARGETS } from '../scripts/prepare-resources.mjs'

/**
 * prepare-resources 原来只用 `process.platform`(**宿主**)判断已有 JRE 够不够用,
 * 不看**构建目标**。后果:在装了 wine 的 mac 上先 dist:mac 再 dist:win,
 * 它看到 runtime 里有 bin/java 就跳过 jlink,把 macOS 的 JRE 打进 Windows 安装包 ——
 * 不报错、不警告,产出一个看起来正常、装完后端起不来的包。
 *
 * 这组用例把两道判据钉死:目标≠宿主必须硬失败;复用已有 runtime 必须真跑一次。
 */
describe('构建目标解析', () => {
  it('没传 --target 时按宿主', () => {
    expect(parseTarget([], 'darwin')).toBe('mac')
    expect(parseTarget([], 'win32')).toBe('win')
    expect(parseTarget([], 'linux')).toBe('linux')
  })

  it('两种写法都认', () => {
    expect(parseTarget(['--target', 'win'], 'darwin')).toBe('win')
    expect(parseTarget(['--target=win'], 'darwin')).toBe('win')
  })

  it('非法值抛错,不静默退回宿主', () => {
    // 静默退回是最坏的:`--target windows` 拼错一个字母就变成给 mac 备料,还一声不吭
    expect(() => parseTarget(['--target', 'windows'], 'darwin')).toThrow(/只接受/)
    expect(() => parseTarget(['--target'], 'darwin')).toThrow(/只接受/)
  })

  it('hostTarget 覆盖三平台,未知平台按 linux', () => {
    expect(hostTarget('win32')).toBe('win')
    expect(hostTarget('darwin')).toBe('mac')
    expect(hostTarget('freebsd')).toBe('linux')
    expect(TARGETS).toEqual(['mac', 'win', 'linux'])
  })
})

describe('交叉构建拒绝', () => {
  it('mac 上出 win 包 → 拒绝', () => {
    const msg = crossBuildRefusal('win', 'darwin')
    expect(msg).toBeTruthy()
    expect(msg).toContain('不能交叉出包')
  })

  it('win 上出 mac 包 → 同样拒绝(不是只防一个方向)', () => {
    expect(crossBuildRefusal('mac', 'win32')).toBeTruthy()
  })

  it('目标=宿主 → 放行', () => {
    expect(crossBuildRefusal('mac', 'darwin')).toBeNull()
    expect(crossBuildRefusal('win', 'win32')).toBeNull()
    expect(crossBuildRefusal('linux', 'linux')).toBeNull()
  })

  it('拒绝信息要说清后果和出路,不能只说「失败」', () => {
    const msg = crossBuildRefusal('win', 'darwin')
    expect(msg).toContain('java.exe')             // 具体会缺什么
    expect(msg).toContain('windows-release.md')   // 该去哪
  })
})

describe('已有 runtime 能否复用', () => {
  const yes = (): boolean => true
  const no = (): boolean => false

  it('目标 win 时找的是 java.exe,不是 java', () => {
    const seen: string[] = []
    runtimeReusable('/r', 'win', (p: string) => { seen.push(p); return false }, yes)
    expect(seen[0]).toContain('java.exe')
  })

  it('目标 mac 时找的是 java', () => {
    const seen: string[] = []
    runtimeReusable('/r', 'mac', (p: string) => { seen.push(p); return false }, yes)
    expect(seen[0]!.endsWith('java')).toBe(true)
  })

  it('文件不存在 → 不复用,且不去跑探针', () => {
    let probed = false
    expect(runtimeReusable('/r', 'win', no, () => { probed = true; return true })).toBe(false)
    expect(probed).toBe(false)
  })

  it('文件在但跑不起来 → 不复用', () => {
    // 这是 mac↔linux 唯一的分辨手段:两者可执行体同名(都是 bin/java),
    // 只有真的 `java -version` 一次才知道手上这份是不是本平台的。
    expect(runtimeReusable('/r', 'mac', yes, no)).toBe(false)
  })

  it('文件在且跑得起来 → 复用', () => {
    expect(runtimeReusable('/r', 'mac', yes, yes)).toBe(true)
  })

  it('expectedJavaBin:只有 win 带 .exe', () => {
    expect(expectedJavaBin('win')).toBe('java.exe')
    expect(expectedJavaBin('mac')).toBe('java')
    expect(expectedJavaBin('linux')).toBe('java')
  })
})
