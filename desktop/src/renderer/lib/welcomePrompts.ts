export const EXAMPLE_PROMPTS: string[] = [
  '梳理这个项目的整体架构',
  '给这段代码补充单元测试',
  '解释这个报错并给出修复',
  '审查我最近的改动',
  '把这个函数重构得更清晰',
  '为这个模块写一段说明文档',
  '找出潜在的性能瓶颈',
  '帮我理清这个 bug 的复现路径',
  '把这个脚本改得更健壮',
  '总结这个目录下每个文件的职责',
]

/** 无重复随机取 count 条(count≥池长 → 返回打乱的全量;count≤0 → 空)。rng 可注入供测。 */
export function pickExamplePrompts(pool: string[], count: number, rng: () => number = Math.random): string[] {
  const arr = [...pool]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const t = arr[i]!; arr[i] = arr[j]!; arr[j] = t
  }
  return arr.slice(0, Math.max(0, Math.min(count, arr.length)))
}
