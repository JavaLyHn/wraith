/** 顶条左内边距:macOS 需让开左上角交通灯(~80px),其它平台贴左。 */
export function topBarLeftPad(platform: string): string {
  return platform === 'darwin' ? 'pl-[80px]' : 'pl-2'
}

/** 是否显示自绘窗口控制键(最小/最大/关闭):仅 Windows。mac 用交通灯,Linux 用系统窗框。 */
export function shouldShowWindowControls(platform: string): boolean {
  return platform === 'win32'
}

export type SandboxState = 'macos-seatbelt' | 'none' | 'unknown'
export type SandboxChipKind = 'ok' | 'off' | 'unsupported' | 'unknown'

/**
 * 顶栏沙箱盾的呈现口径(纯函数)。
 *
 * 原来这是侧栏底部常驻的一行灰字 —— 正常态占一行讲一句「一切正常」,是版面浪费;
 * 而它真正的价值只在**异常**那一刻。搬到顶栏后:正常=浅墨小盾(在场但不喊),
 * 未启用=红盾(喊)。文案进 title/aria-label,图标本身不带文字。
 *
 * **为什么要吃 platform**:后端只回 `macos-seatbelt | none`
 * (`CommandSandbox.available()` = `os.name contains "mac" && /usr/bin/sandbox-exec 可执行`),
 * 于是 Windows / Linux 恒定拿到 `none`。同一个 `none` 在两边意思完全不同:
 * 在 mac 上是「本可以有,现在没有」—— 可行动的告警,该红;
 * 在 Windows 上是「这个平台压根没这东西」—— 用户点进安全设置什么也做不了,
 * 红盾常亮既是告警疲劳,也是在说假话(暗示存在一处可修的错配)。
 *
 * 分工:**颜色只表达紧急度,图标表达状态**。所以 unsupported 与 ok 同为 muted 墨,
 * 靠图标(plain Shield vs ShieldCheck)和 tooltip 区分,只有真异常才配 danger。
 */
export function sandboxChipView(sandbox: SandboxState, platform: string): {
  kind: SandboxChipKind
  /** 无障碍名 + tooltip 文案。「未启用」三个字是异常态的判定词,别改。 */
  label: string
  title: string
  /** 墨色:异常才用 danger,其余刻意压到 muted/subtle,不与顶栏其它键争注意力。 */
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
      // 判据是 platform 不是后端回包 —— 两边回的都是 'none',差别在这个 'none' 可不可行动。
      return platform === 'darwin'
        ? {
          kind: 'off',
          label: '沙箱未启用',
          title: '命令未在沙箱内执行 · 点击查看安全设置',
          tone: 'text-danger hover:text-danger',
        }
        : {
          kind: 'unsupported',
          label: '当前平台无沙箱',
          title: '当前平台不支持 Seatbelt 沙箱 · 命令仅受命令黑名单保护 · 点击查看安全设置',
          tone: 'text-fg-muted hover:text-fg',
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
