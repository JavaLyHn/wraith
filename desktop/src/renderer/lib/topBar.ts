/** 顶条左内边距:macOS 需让开左上角交通灯(~80px),其它平台贴左。 */
export function topBarLeftPad(platform: string): string {
  return platform === 'darwin' ? 'pl-[80px]' : 'pl-2'
}

/** 是否显示自绘窗口控制键(最小/最大/关闭):仅 Windows。mac 用交通灯,Linux 用系统窗框。 */
export function shouldShowWindowControls(platform: string): boolean {
  return platform === 'win32'
}

export type SandboxState = 'macos-seatbelt' | 'windows-appcontainer' | 'none' | 'unknown'
export type SandboxChipKind = 'ok' | 'ok-net' | 'off' | 'unsupported' | 'unknown'

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
 *
 * **`networkAllowed` 为什么必须进来**:面板里用户唯一能拨的沙箱控件就是
 * 「命令沙箱联网」,而它<b>不改 kind</b>。此前这个函数只吃 kind,于是拨开关
 * 顶栏毫无反应 —— 用户报的「不管有没有开启沙箱,护盾始终不变」就是这件事,
 * 跟 Windows 无关,只是他在 Windows 上先撞上。
 *
 * 联网放行是**弱化**不是**故障**:文件系统仍然被关着,只是网络出口开了。
 * 所以给 warn 不给 danger,给半盾不给警告盾 —— 把它画成红色等同于说
 * 「你没有沙箱」,那是假话;画成和全关一样又等于说「拨了没用」,也是假话。
 */
export function sandboxChipView(sandbox: SandboxState, platform: string, networkAllowed = false): {
  kind: SandboxChipKind
  /** 无障碍名 + tooltip 文案。「未启用」三个字是异常态的判定词,别改。 */
  label: string
  title: string
  /** 墨色:异常才用 danger,其余刻意压到 muted/subtle,不与顶栏其它键争注意力。 */
  tone: string
} {
  switch (sandbox) {
    case 'macos-seatbelt':
      return sandboxed('Seatbelt', networkAllowed)
    case 'windows-appcontainer':
      return sandboxed('AppContainer', networkAllowed)
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

/** 有沙箱的两态:全关着 vs 放行了网络。文案里点名具体沙箱,免得「有沙箱」听起来像句空话。 */
function sandboxed(name: string, networkAllowed: boolean): {
  kind: SandboxChipKind
  label: string
  title: string
  tone: string
} {
  return networkAllowed
    ? {
      kind: 'ok-net',
      label: `沙箱: ${name} · 已放行网络`,
      title: `命令在 ${name} 沙箱内执行,但已放行网络出口`
        + ' · 文件系统仍限制在工作区内 · 点击查看安全设置',
      tone: 'text-warn hover:text-warn',
    }
    : {
      kind: 'ok',
      label: `沙箱: ${name} · 已断网`,
      title: `命令在 ${name} 沙箱内执行,网络出口已关闭 · 点击查看安全设置`,
      tone: 'text-fg-muted hover:text-fg',
    }
}
