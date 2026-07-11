import { describe, it, expect } from 'vitest'
import { resolveShell } from '../src/main/ptyHelpers'

describe('resolveShell', () => {
  it('非 win 且有 $SHELL → 用 $SHELL', () => {
    expect(resolveShell({ SHELL: '/usr/bin/fish' }, 'darwin')).toBe('/usr/bin/fish')
    expect(resolveShell({ SHELL: '/bin/bash' }, 'linux')).toBe('/bin/bash')
  })
  it('darwin 无 $SHELL → /bin/zsh', () => {
    expect(resolveShell({}, 'darwin')).toBe('/bin/zsh')
  })
  it('linux 无 $SHELL → /bin/bash', () => {
    expect(resolveShell({}, 'linux')).toBe('/bin/bash')
  })
  it('win32 → COMSPEC 或 powershell(忽略 $SHELL)', () => {
    expect(resolveShell({ COMSPEC: 'C:\\\\cmd.exe', SHELL: '/bin/zsh' }, 'win32')).toBe('C:\\\\cmd.exe')
    expect(resolveShell({}, 'win32')).toBe('powershell.exe')
  })
})
