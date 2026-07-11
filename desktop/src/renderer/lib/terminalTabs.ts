export interface TermTab { id: string; label: string }
export interface TabsState { tabs: TermTab[]; activeId: string | null }

export function addTab(state: TabsState, tab: TermTab): TabsState {
  return { tabs: [...state.tabs, tab], activeId: tab.id }
}

export function closeTab(state: TabsState, id: string): TabsState {
  const idx = state.tabs.findIndex(t => t.id === id)
  if (idx < 0) return state
  const tabs = state.tabs.filter(t => t.id !== id)
  let activeId = state.activeId
  if (state.activeId === id) {
    if (tabs.length === 0) activeId = null
    else activeId = (state.tabs[idx - 1] ?? state.tabs[idx + 1])?.id ?? tabs[0]!.id
  }
  return { tabs, activeId }
}

export function setActive(state: TabsState, id: string): TabsState {
  return state.tabs.some(t => t.id === id) ? { ...state, activeId: id } : state
}

export function shortTabLabel(cwd: string, index: number): string {
  const trimmed = (cwd || '').replace(/\/+$/, '')
  const base = trimmed.split('/').pop()
  return base && base.length > 0 ? base : `终端 ${index + 1}`
}
