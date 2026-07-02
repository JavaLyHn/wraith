/**
 * 审批弹窗决策映射 — 纯 TS,无 React/Electron。
 * REJECTED 不经此函数(拒绝按钮直接发)。
 */

export interface ApprovalEditState {
  toolName: string
  originalArgsJson: string
  /** execute_command 命令编辑框当前值;null = 未动过。 */
  editedCommand: string | null
  /** 通用 JSON 编辑器当前文本;null = 未开启编辑。 */
  editedArgsJson: string | null
  allowNetwork: boolean
  sessionAllowTool: boolean
}

export interface ApprovalResponsePayload {
  decision: 'APPROVED' | 'MODIFIED' | 'APPROVED_ALL'
  modifiedArgs?: string
  allowNetwork?: boolean
}

/** JSON 合法性:合法 → null,非法 → 错误信息(供 UI 内联展示)。 */
export function validateArgsJson(s: string): string | null {
  try {
    JSON.parse(s)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : 'invalid JSON'
  }
}

export function buildApprovalResponse(edit: ApprovalEditState): ApprovalResponsePayload {
  const net = edit.allowNetwork ? { allowNetwork: true as const } : {}
  let modifiedArgs: string | null = null

  if (edit.toolName === 'execute_command' && edit.editedCommand !== null) {
    try {
      const orig = JSON.parse(edit.originalArgsJson) as Record<string, unknown>
      if (edit.editedCommand !== orig['command']) {
        modifiedArgs = JSON.stringify({ ...orig, command: edit.editedCommand })
      }
    } catch {
      // 原参不可解析 → 无法安全改写,视为未修改
    }
  } else if (
    edit.editedArgsJson !== null &&
    validateArgsJson(edit.editedArgsJson) === null &&
    edit.editedArgsJson !== edit.originalArgsJson
  ) {
    modifiedArgs = edit.editedArgsJson
  }

  if (modifiedArgs !== null) return { decision: 'MODIFIED', modifiedArgs, ...net }
  if (edit.sessionAllowTool) return { decision: 'APPROVED_ALL', ...net }
  return { decision: 'APPROVED', ...net }
}
