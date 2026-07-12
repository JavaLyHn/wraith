export const EXAMPLE_PROMPTS: string[] = [
  '重构这个函数,让它更清晰:',
  '给这段代码补充单元测试:',
  '解释这个报错并修复:',
  '审查这次改动:',
  '为这个模块写说明文档:',
  '优化这段代码的性能:',
  '排查这个 bug:',
  '梳理这个目录的结构:',
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
