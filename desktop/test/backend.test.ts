import { describe, it, expect } from 'vitest'
import { resolveBackendCommand, packagedBackendCommand, defaultJarPath } from '../src/main/backend'

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

describe('resolveBackendCommand 三态', () => {
  const jar = defaultJarPath('/Users/x') // /Users/x/.wraith/wraith.jar

  it('env 覆写最高优先(即使 packaged 也让位)', () => {
    const r = resolveBackendCommand({ WRAITH_APPSERVER_CMD: 'foo -a b' }, jar, { resourcesPath: '/R' })
    expect(r).toEqual({ cmd: 'foo', args: ['-a', 'b'] })
  })

  it('packaged → 捆绑 java + 捆绑 jar', () => {
    const r = resolveBackendCommand({}, jar, { resourcesPath: '/R' })
    expect(r).toEqual({ cmd: '/R/runtime/bin/java', args: ['-jar', '/R/wraith.jar', 'app-server'] })
  })

  it('dev(无 packaged) → 系统 java + 默认 jar,行为不变', () => {
    const r = resolveBackendCommand({}, jar)
    expect(r).toEqual({ cmd: 'java', args: ['-jar', jar, 'app-server'] })
  })
})

describe('packagedBackendCommand', () => {
  it('拼 resourcesPath 下的 runtime/bin/java 与 wraith.jar', () => {
    expect(packagedBackendCommand('/R')).toEqual({
      cmd: '/R/runtime/bin/java', args: ['-jar', '/R/wraith.jar', 'app-server'],
    })
  })
})
