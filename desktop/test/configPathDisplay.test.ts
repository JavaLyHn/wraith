import { describe, it, expect } from 'vitest'
import { configHomeLabel, configPathLabel } from '../src/renderer/lib/configPathDisplay'

/**
 * 桌面文案里的配置目录写法要分平台。
 *
 * 用户在 Windows 上撞到的是同一件事的另一面:界面上写着「把 SKILL.md 放到
 * ~/.wraith/skills/<名>/」,而 Windows 上既没有 ~ 这个概念给用户点,cmd.exe 也不展开它。
 * Java 侧有 ConfigPathDisplay 管同一件事(prompt 与 CLI 提示);这里是渲染层的那一份。
 */

describe('configPathDisplay', () => {
  it('mac / linux 用 ~/.wraith', () => {
    expect(configHomeLabel('darwin')).toBe('~/.wraith')
    expect(configHomeLabel('linux')).toBe('~/.wraith')
  })

  it('Windows 用 %USERPROFILE%\\.wraith —— cmd.exe 里能展开,~ 不能', () => {
    expect(configHomeLabel('win32')).toBe('%USERPROFILE%\\.wraith')
    expect(configHomeLabel('win32')).not.toContain('~')
  })

  it('子路径按平台分隔符拼', () => {
    expect(configPathLabel('darwin', 'skills')).toBe('~/.wraith/skills')
    expect(configPathLabel('win32', 'skills')).toBe('%USERPROFILE%\\.wraith\\skills')
    expect(configPathLabel('win32', 'skills', 'my-skill')).toBe('%USERPROFILE%\\.wraith\\skills\\my-skill')
  })

  it('platform 未知(极端/测试环境)时退回 Unix 写法,不抛', () => {
    expect(configHomeLabel(undefined)).toBe('~/.wraith')
    expect(configHomeLabel('')).toBe('~/.wraith')
  })

  it('空段被跳过 —— 不产出结尾多一个分隔符的路径', () => {
    expect(configPathLabel('darwin', 'skills', '')).toBe('~/.wraith/skills')
  })
})
