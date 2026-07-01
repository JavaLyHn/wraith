import { describe, it, expect } from 'vitest'
import { resolveBackendCommand, defaultJarPath } from '../src/main/backend'

describe('resolveBackendCommand', () => {
  it('returns java -jar <defaultJar> app-server when env var is absent', () => {
    const result = resolveBackendCommand({}, '/home/user/.wraith/wraith.jar')
    expect(result).toEqual({
      cmd: 'java',
      args: ['-jar', '/home/user/.wraith/wraith.jar', 'app-server']
    })
  })

  it('returns java -jar <defaultJar> app-server when env var is empty string', () => {
    const result = resolveBackendCommand(
      { WRAITH_APPSERVER_CMD: '' },
      '/home/user/.wraith/wraith.jar'
    )
    expect(result).toEqual({
      cmd: 'java',
      args: ['-jar', '/home/user/.wraith/wraith.jar', 'app-server']
    })
  })

  it('splits WRAITH_APPSERVER_CMD on whitespace: single token', () => {
    const result = resolveBackendCommand(
      { WRAITH_APPSERVER_CMD: 'node' },
      '/ignored/wraith.jar'
    )
    expect(result).toEqual({ cmd: 'node', args: [] })
  })

  it('splits WRAITH_APPSERVER_CMD on whitespace: cmd + multiple args', () => {
    const result = resolveBackendCommand(
      { WRAITH_APPSERVER_CMD: 'node /abs/mock.mjs --port 9000' },
      '/ignored/wraith.jar'
    )
    expect(result).toEqual({
      cmd: 'node',
      args: ['/abs/mock.mjs', '--port', '9000']
    })
  })

  it('splits WRAITH_APPSERVER_CMD: two-token case', () => {
    const result = resolveBackendCommand(
      { WRAITH_APPSERVER_CMD: 'node /abs/mock.mjs' },
      '/ignored/wraith.jar'
    )
    expect(result).toEqual({ cmd: 'node', args: ['/abs/mock.mjs'] })
  })
})

describe('defaultJarPath', () => {
  it('returns <homedir>/.wraith/wraith.jar', () => {
    const result = defaultJarPath('/Users/x')
    expect(result).toContain('/Users/x')
    expect(result).toMatch(/\.wraith[/\\]wraith\.jar$/)
  })

  it('works with any homedir', () => {
    const result = defaultJarPath('/home/alice')
    expect(result).toBe('/home/alice/.wraith/wraith.jar')
  })
})
