export interface BrowserTab {
  id: string
  title: string
  url: string
  loading: boolean
  failed: boolean
  canBack: boolean
  canForward: boolean
}
export interface BrowserTabsState { tabs: BrowserTab[]; activeId: string | null }

export function newBrowserTab(id: string): BrowserTab {
  return { id, title: '新标签页', url: '', loading: false, failed: false, canBack: false, canForward: false }
}

export function addBrowserTab(state: BrowserTabsState, tab: BrowserTab): BrowserTabsState {
  return { tabs: [...state.tabs, tab], activeId: tab.id }
}

export function closeBrowserTab(state: BrowserTabsState, id: string): BrowserTabsState {
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

export function setActiveBrowserTab(state: BrowserTabsState, id: string): BrowserTabsState {
  return state.tabs.some(t => t.id === id) ? { ...state, activeId: id } : state
}

export function patchBrowserTab(state: BrowserTabsState, id: string, patch: Partial<BrowserTab>): BrowserTabsState {
  if (!state.tabs.some(t => t.id === id)) return state
  return { ...state, tabs: state.tabs.map(t => (t.id === id ? { ...t, ...patch } : t)) }
}
