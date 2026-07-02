/**
 * MCP server 表单值组装纯函数 — env 脱敏、args 拆分、空值语义处理。
 * 编辑态:后端只回 envKeys,值以空串占位(空串=提交时保留现值,不回显密钥)。
 */

export interface McpFormValue {
  scope: 'user' | 'project'
  name: string
  command: string
  args: string[]
  env: Record<string, string>
}

export interface EnvRow { key: string; value: string }

/** 编辑态回填:后端只回 envKeys,值以空串占位(空串=提交时保留现值)。 */
export function envRowsFromKeys(envKeys: string[]): EnvRow[] {
  return envKeys.map(key => ({ key, value: '' }))
}

/** args 文本域按行拆、trim、去空行;env 空 key 行丢弃、空 value 原样传(后端语义:保留现值)。 */
export function buildFormValue(
  scope: 'user' | 'project', name: string, command: string, argsText: string, envRows: EnvRow[],
): McpFormValue {
  const env: Record<string, string> = {}
  for (const r of envRows) {
    const k = r.key.trim()
    if (k) env[k] = r.value
  }
  return {
    scope, name: name.trim(), command: command.trim(),
    args: argsText.split('\n').map(s => s.trim()).filter(Boolean),
    env,
  }
}
