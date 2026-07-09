import type { BuiltinToolView } from '../../shared/types'

/** 一行可渲染的内置工具:后端目录命中则带真实描述/参数,否则 missing。 */
export interface BuiltinToolRow {
  name: string
  description: string
  parameters?: unknown
  missing: boolean
}

/**
 * 把某内置能力声明的工具名数组与后端目录 join。
 * 命中 → 用后端 description/parameters;未命中 → missing=true(描述空),仍保留工具名。
 */
export function joinBuiltinTools(
  capabilityToolNames: string[],
  catalog: BuiltinToolView[],
): BuiltinToolRow[] {
  return capabilityToolNames.map(name => {
    const hit = catalog.find(t => t.name === name)
    return hit
      ? { name, description: hit.description, parameters: hit.parameters, missing: false }
      : { name, description: '', parameters: undefined, missing: true }
  })
}
