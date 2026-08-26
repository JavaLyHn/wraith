import { useEffect } from 'react'

export interface UseKeyboardShortcutsOptions {
  getTurn: () => 'idle' | 'running'
  onInterrupt: () => Promise<void>
  onNewConversation: () => Promise<void>
  onPaletteOpen: () => void
  onToggleProviders: () => void
  getPendingApproval: () => boolean
  getPendingChoice: () => boolean
  getAutomationApproval: () => boolean
}

export function useKeyboardShortcuts(opts: UseKeyboardShortcutsOptions): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && opts.getTurn() === 'running'
        && !opts.getPendingApproval() && !opts.getPendingChoice() && !opts.getAutomationApproval()) {
        e.preventDefault()
        void opts.onInterrupt()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        opts.onPaletteOpen()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault()
        void opts.onNewConversation()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault()
        opts.onToggleProviders()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
}