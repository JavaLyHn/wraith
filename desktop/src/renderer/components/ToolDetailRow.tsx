import { useState } from 'react'
import { hasToolParams } from '../lib/toolParams'

/**
 * 工具详情行(内置能力详情与 MCP server tools tab 共用):
 * mono 真名 + 描述 + 可折叠入参 schema;missing 时淡色标记「定义缺失 / 当前不可用」。
 */
export default function ToolDetailRow(
  { name, description, parameters, missing = false }: {
    name: string
    description: string
    parameters?: unknown
    missing?: boolean
  },
): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const showParams = hasToolParams(parameters)
  return (
    <div className="rounded-lg bg-surface/60 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-fg">{name}</span>
        {missing && <span className="text-3xs text-fg-subtle">定义缺失 / 当前不可用</span>}
        {showParams && (
          <button type="button" onClick={() => setExpanded(v => !v)}
            className="ml-auto shrink-0 text-3xs text-fg-subtle hover:text-fg-muted">
            {expanded ? '▼ 参数' : '▶ 参数'}
          </button>
        )}
      </div>
      {description && <div className="mt-0.5 text-xs text-fg-muted">{description}</div>}
      {showParams && expanded && (
        <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded bg-bg px-2 py-1 text-2xs text-fg-subtle">
{JSON.stringify(parameters, null, 2)}
        </pre>
      )}
    </div>
  )
}
