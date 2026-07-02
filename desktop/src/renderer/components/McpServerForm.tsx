export interface McpFormValue {
  scope: 'user' | 'project'
  name: string
  command: string
  args: string[]
  env: Record<string, string>
}
interface McpServerFormProps {
  mode: 'add' | 'edit'
  initial: import('../../shared/types').McpServerView | null
  busy: boolean
  onCancel: () => void
  onSubmit: (v: McpFormValue) => Promise<boolean>
}
export default function McpServerForm(_props: McpServerFormProps): JSX.Element {
  return <div data-testid="mcp-form" className="text-xs text-fg-subtle">表单(Task 9 实装)</div>
}
