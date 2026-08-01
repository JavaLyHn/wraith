/** 顶条左内边距:macOS 需让开左上角交通灯(~80px),其它平台贴左。 */
export function topBarLeftPad(platform: string): string {
  return platform === 'darwin' ? 'pl-[80px]' : 'pl-2'
}

/** 是否显示自绘窗口控制键(最小/最大/关闭):仅 Windows。mac 用交通灯,Linux 用系统窗框。 */
export function shouldShowWindowControls(platform: string): boolean {
  return platform === 'win32'
}

export type SandboxState = 'macos-seatbelt' | 'none' | 'unknown'
export type SandboxChipKind = 'ok' | 'off' | 'unknown'

/**
 * 顶栏沙箱盾的呈现口径(纯函数)。
 *
 * 原来这是侧栏底部常驻的一行灰字 —— 正常态占一行讲一句「一切正常」,是版面浪费;
 * 而它真正的价值只在**异常**那一刻。搬到顶栏后:正常=浅墨小盾(在场但不喊),
 * 未启用=红盾(喊)。文案进 title/aria-label,图标本身不带文字。
 */
export function sandboxChipView(sandbox: SandboxState): {
  kind: SandboxChipKind
  /** 无障碍名 + tooltip 文案。「未启用」三个字是异常态的判定词,别改。 */
  label: string
  title: string
  /** 墨色:异常才用 danger,正常态刻意压到 muted,不与顶栏其它键争注意力。 */
  tone: string
} {
  switch (sandbox) {
    case 'macos-seatbelt':
      return {
        kind: 'ok',
        label: '沙箱: Seatbelt',
        title: '命令在 Seatbelt 沙箱内执行 · 点击查看安全设置',
        tone: 'text-fg-muted hover:text-fg',
      }
    case 'none':
      return {
        kind: 'off',
        label: '沙箱未启用',
        title: '命令未在沙箱内执行 · 点击查看安全设置',
        tone: 'text-danger hover:text-danger',
      }
    default:
      return {
        kind: 'unknown',
        label: '沙箱状态未知',
        title: '沙箱状态未知 · 点击查看安全设置',
        tone: 'text-fg-subtle hover:text-fg',
      }
  }
}
