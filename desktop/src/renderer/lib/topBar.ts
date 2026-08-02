/** 顶条左内边距:macOS 需让开左上角交通灯(~80px),其它平台贴左。 */
export function topBarLeftPad(platform: string): string {
  return platform === 'darwin' ? 'pl-[80px]' : 'pl-2'
}

/** 是否显示自绘窗口控制键(最小/最大/关闭):仅 Windows。mac 用交通灯,Linux 用系统窗框。 */
export function shouldShowWindowControls(platform: string): boolean {
  return platform === 'win32'
}

export type SandboxState = 'macos-seatbelt' | 'windows-appcontainer' | 'none' | 'unknown'
export type SandboxChipKind = 'ok' | 'off' | 'unsupported' | 'unknown'

/**
 * 顶栏沙箱盾的呈现口径(纯函数)。
 *
 * 原来这是侧栏底部常驻的一行灰字 —— 正常态占一行讲一句「一切正常」,是版面浪费;
 * 而它真正的价值只在**异常**那一刻。搬到顶栏后:正常=浅墨小盾(在场但不喊),
 * 未启用=红盾(喊)。文案进 title/aria-label,图标本身不带文字。
 *
 * **platform 参数为什么还在**:后端现在会直接报出具体种类
 * (`macos-seatbelt | windows-appcontainer | none`),所以 mac 与 Windows
 * 不再需要靠 platform 区分 —— 那套反推是当初后端只能回布尔时的补丁,
 * 根因消失了就该拆掉。
 *
 * 但 `none` 本身仍是多义的,platform 还得留着回答最后一个问题:
 * 在 macOS / Windows 上 `none` 是「本该有却没有」(可行动 → 红盾);
 * 在 Linux 上是「这个平台压根没实现」(点进去也没得修 → 不该红)。
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
    case 'windows-appcontainer':
      return {
        kind: 'ok',
        label: '沙箱: AppContainer',
        title: '命令在 AppContainer 沙箱内执行 · 点击查看安全设置',
        tone: 'text-fg-muted hover:text-fg',
      }
    case 'none':
      // mac 与 Windows 都**有**沙箱实现,回 none 意味着它本该在却没起来 —— 可行动,该红。
      // Linux 没有对应实现,红盾常亮属于告警疲劳,而且是在说假话(暗示有一处可修的错配)。
      return platform === 'linux'
        ? {
          kind: 'unsupported',
          label: '当前平台无沙箱',
          title: '当前平台没有沙箱实现 · 命令仅受命令黑名单与审批保护 · 点击查看安全设置',
          tone: 'text-fg-muted hover:text-fg',
        }
        : {
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
