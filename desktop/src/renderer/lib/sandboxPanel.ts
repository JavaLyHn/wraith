import type { SandboxState } from '../../shared/types'

/**
 * 安全面板「命令沙箱联网」那一行的副文案(纯函数)。
 *
 * **改这行的起因**:Windows 上它恒显示「当前无沙箱(非 macOS 或不可用),命令不受网络限制」,
 * 开关灰着,用户点不动也无从判断该怎么办 —— 这是一行死文案。
 *
 * 三件事得说清楚,缺一条用户就得去猜:
 *   1. 现在**有没有**沙箱
 *   2. 没有的话**为什么**(后端的 degradedReason,此前只进 log.warn,桌面完全看不到)
 *   3. 有的话这个开关**管什么**
 */
export function sandboxNetHint(sandbox: SandboxState | null): string {
  if (!sandbox) return '读取中…'

  const kind = sandboxKindOf(sandbox)
  if (kind === 'none') {
    const why = sandbox.degradedReason?.trim()
    // 兜底文案刻意不再说「非 macOS」—— Windows 现在也该有沙箱,
    // 说成平台问题会让用户以为无解,而实际上多半是缺一项可修的前置条件。
    return why && why.length > 0
      ? `当前无沙箱,命令不受网络限制 · ${why}`
      : '当前无沙箱,命令不受网络限制(仍受命令黑名单与审批保护)'
  }

  const name = kind === 'macos-seatbelt' ? 'Seatbelt' : 'AppContainer'
  return `经 ${name} 沙箱强制 · 关=禁止 agent 命令联网(默认更安全);开=本次运行放行,重启恢复禁网`
}

/**
 * 取沙箱种类,兼容只回 `available` 的旧后端。
 *
 * 旧后端没有 `kind` 字段,此时只能从 `available` 推 —— 但推不出是哪一种,
 * 于是统一按 Seatbelt 呈现(旧后端唯一实现过的就是它)。
 */
export function sandboxKindOf(
  sandbox: SandboxState,
): 'macos-seatbelt' | 'windows-appcontainer' | 'none' {
  if (sandbox.kind) return sandbox.kind
  return sandbox.available ? 'macos-seatbelt' : 'none'
}

/** 联网开关是否可点:有沙箱才有「网络围栏」这回事,没沙箱时开关无意义。 */
export function sandboxToggleEnabled(sandbox: SandboxState | null): boolean {
  return !!sandbox && sandboxKindOf(sandbox) !== 'none'
}
