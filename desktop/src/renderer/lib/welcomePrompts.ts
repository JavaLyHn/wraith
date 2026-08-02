/**
 * 首页示例。
 *
 * 旧版是 8 条以冒号结尾的半句(「重构这个函数,让它更清晰:」),点一下只把半句填进输入框 ——
 * 冒号后面填什么全靠用户自己想。而首页空态服务的恰恰是"还不知道能让它干什么"的时刻,
 * 半句等于把问题原样退回去。
 *
 * 改成两级:**类别 → 具体建议**。每条叶子都是一句完整、当场就能跑的指令,不带冒号、不留空 ——
 * 用户一个字都不必想。原本需要用户指定对象的(哪个函数/哪个模块)一律改写成"让 agent 自己先找"
 * (如「挑一处最值得重构的代码并说明理由」),因为它本来就有能力找。
 */
export interface PromptCategory {
  /** 类别名(第一级芯片上的字) */
  label: string
  /** 具体建议(第二级芯片);每条都必须是完整可执行的一句话 */
  prompts: string[]
}

export const PROMPT_CATEGORIES: PromptCategory[] = [
  {
    label: '了解这个项目',
    prompts: [
      '梳理这个目录的结构,说明每个部分是做什么的',
      '这个项目是做什么的?主要模块有哪些?',
      '找出这个项目的入口文件,讲一遍它的启动流程',
    ],
  },
  {
    label: '改进代码',
    prompts: [
      '审查我最近这次改动,指出问题',
      '挑一处最值得重构的代码,说明理由并给出方案',
      '找出这个项目里最该补单元测试的地方',
    ],
  },
  {
    label: '排查问题',
    prompts: [
      '跑一遍测试,把失败的原因讲清楚',
      '检查有没有没被处理的错误路径',
      '找出可能的性能隐患,按影响排序',
    ],
  },
  {
    label: '写文档',
    prompts: [
      '为这个项目写一份 README 概览',
      '给核心模块补一段说明文档',
      '把最近的改动整理成一份变更说明',
    ],
  },
]

/** 无重复随机取 count 条(count≥池长 → 返回打乱的全量;count≤0 → 空)。rng 可注入供测。 */
export function pickExamplePrompts<T>(pool: T[], count: number, rng: () => number = Math.random): T[] {
  const arr = [...pool]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const t = arr[i]!; arr[i] = arr[j]!; arr[j] = t
  }
  return arr.slice(0, Math.max(0, Math.min(count, arr.length)))
}

/**
 * 叶子必须是"点了就能跑"的完整句:不以冒号收尾,也不留占位空白。
 * 这条判据是给测试用的 —— 旧版那批半句正是栽在冒号上,不写死就会有人再加回去。
 */
export function isSelfContained(prompt: string): boolean {
  const t = prompt.trim()
  if (t.length === 0) return false
  if (/[:：]$/.test(t)) return false
  return !/(___|\{\{|\[待填\])/.test(t)
}
