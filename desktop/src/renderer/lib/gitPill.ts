import type { GitStatusView } from '../../shared/types'

/**
 * pill 上显示什么。抽成纯函数是因为组合多：五种状态 × 行数是否省略 × 未跟踪是否显示。
 * 用纯函数穷举比在组件里 render 五遍便宜（既有做法见 lib/topBar.ts 的 sandboxChipView）。
 */
export function gitPillView(s: GitStatusView | null): {
  visible: boolean
  branch: string
  suffix: string
  title: string
} {
  // null = 还没拉回来。刻意不显示占位 —— 顶栏闪一下比晚出现半秒更烦人。
  // repo:false = 不是仓库 / git 不在 PATH。整块不渲染，不显示「无仓库」那种噪音。
  if (!s || !s.repo) return { visible: false, branch: '', suffix: '', title: '' }

  const parts: string[] = []
  if (s.insertions > 0 || s.deletions > 0) {
    // 用 U+2212 减号而不是 hyphen：等宽对齐好看，且不会被误读成命令行参数
    parts.push(`+${s.insertions} −${s.deletions}`)
  }
  if (s.untracked > 0) parts.push(`· ${s.untracked} 未跟踪`)

  const marks: string[] = []
  if (s.state === 'detached') marks.push('游离')
  if (s.state === 'unborn') marks.push('无提交')
  if (s.ahead > 0) marks.push(`领先 ${s.ahead}`)
  if (s.behind > 0) marks.push(`落后 ${s.behind}`)
  if (s.error) marks.push('刷新失败')

  return {
    visible: true,
    // branch/name 在类型上是 string | null（后端取数失败时可能给 null）。
    // ?? '' 让 pill 在异常态也能渲染出空串而不是把 null 拼进 DOM。
    branch: s.branch ?? '',
    suffix: parts.join(' '),
    title: [s.name, s.branch, ...marks].filter(Boolean).join(' · '),
  }
}
