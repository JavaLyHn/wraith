import type { Item, PlanStepItem, TeamStep } from '../../shared/transcriptReducer'

/**
 * 把 renderer 当前持有的 transcript(Item[])序列化为 Markdown。
 * 纯函数、无副作用、可单测(时间由调用方传入 meta.exportedAt)。
 * 语义对齐 CLI 的 /export —— 导出「当前对话」,不回后端拉历史。
 */
export interface ExportMeta {
  title: string
  model?: string
  workspace?: string
  exportedAt: string // 已格式化好的字符串
}

/** 单个工具输出的最大保留字符数,超出截断防文件过大。 */
const OUTPUT_LIMIT = 3000

function truncate(s: string): string {
  if (s.length <= OUTPUT_LIMIT) return s
  return s.slice(0, OUTPUT_LIMIT) + `\n…(已截断 ${s.length - OUTPUT_LIMIT} 字)`
}

/** 每行加前缀(用于 blockquote / diff 行标记)。 */
function prefixLines(text: string, prefix: string): string {
  return text.split('\n').map((l) => prefix + l).join('\n')
}

function planChecklist(steps: PlanStepItem[]): string {
  return steps
    .map((s) => `- [${s.status === 'done' ? 'x' : ' '}] ${s.description}${s.result ? ` — ${s.result}` : ''}`)
    .join('\n')
}

function teamChecklist(steps: TeamStep[]): string {
  return steps
    .map((s) => `- [${s.status === 'done' ? 'x' : ' '}] ${s.description}${s.agent ? ` (@${s.agent})` : ''}`)
    .join('\n')
}

function renderItem(item: Item): string | null {
  switch (item.type) {
    case 'user':
      return `## 👤 用户\n\n${item.text.trim()}`
    case 'message':
      return `## 🤖 助手\n\n${item.text.trim()}`
    case 'error':
      return `## ⚠️ 出错\n\n${item.text.trim()}`
    case 'thinking': {
      const body = item.text.trim()
      if (!body) return null
      return prefixLines(`💭 ${body}`, '> ')
    }
    case 'tool': {
      const c = item.card
      let out = `### 🔧 ${c.name}\n\n**参数**\n\n\`\`\`json\n${c.argsJson || '{}'}\n\`\`\``
      const o = (c.output || '').trim()
      if (o) out += `\n\n**输出**\n\n\`\`\`\n${truncate(o)}\n\`\`\``
      return out
    }
    case 'diff': {
      const before = item.before ? prefixLines(item.before, '-') : ''
      const after = item.after ? prefixLines(item.after, '+') : ''
      const body = [before, after].filter(Boolean).join('\n')
      return `### 📝 ${item.filePath}\n\n\`\`\`diff\n${body}\n\`\`\``
    }
    case 'plan': {
      const head = `## 📋 计划:${item.goal || '(未命名)'}`
      const list = item.steps.length ? '\n\n' + planChecklist(item.steps) : ''
      return head + list
    }
    case 'planReview': {
      const head = `## 📋 计划复审:${item.goal || '(未命名)'}`
      const list = item.steps.length ? '\n\n' + item.steps.map((s) => `- ${s.description}`).join('\n') : ''
      return head + list
    }
    case 'team': {
      const head = `## 👥 团队:${item.goal || '(未命名)'}`
      const agents = item.agents.length ? '\n\n**成员**\n\n' + item.agents.map((a) => `- ${a.role}`).join('\n') : ''
      const steps = item.steps.length ? '\n\n**步骤**\n\n' + teamChecklist(item.steps) : ''
      return head + agents + steps
    }
    default:
      return null
  }
}

export function transcriptToMarkdown(items: Item[], meta: ExportMeta): string {
  const metaParts = [
    meta.model ? `模型 ${meta.model}` : null,
    meta.workspace ? `工作目录 ${meta.workspace}` : null,
    `导出于 ${meta.exportedAt}`,
  ].filter(Boolean)
  const header = `# ${meta.title}\n\n> ${metaParts.join(' · ')}\n`
  const body = items
    .map(renderItem)
    .filter((s): s is string => s !== null)
    .join('\n\n---\n\n')
  return body ? `${header}\n${body}\n` : `${header}`
}
