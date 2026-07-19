import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { isValidPetName, npxSearchDirs, resolveNpx, extractPetName, cleanInstallLog } from '../src/shared/petInstall'
import { runPetdexInstall } from '../src/main/petInstall'

describe('extractPetName', () => {
  it('直接输入名字原样返回(trim)', () => {
    expect(extractPetName('boxcat')).toBe('boxcat')
    expect(extractPetName('  scoop  ')).toBe('scoop')
  })
  it('整条命令取 install 后的名字', () => {
    expect(extractPetName('npx petdex@latest install boxcat')).toBe('boxcat')
    expect(extractPetName('petdex install my-pet')).toBe('my-pet')
    expect(extractPetName('npx petdex@latest install boxcat --force')).toBe('boxcat')
  })
  it('没有 install 就把整串当名字(交给 isValidPetName 再判)', () => {
    expect(extractPetName('just some text')).toBe('just some text')
  })
})

describe('cleanInstallLog', () => {
  it('把 \\x1B[1G 光标归位 + 清行转义按回车折叠成当前行', () => {
    const raw = 'Downloading scoop.\x1B[1G\x1B[JDownloading scoop..\x1B[1G\x1B[JDownloading scoop...'
    expect(cleanInstallLog(raw)).toBe('Downloading scoop...')
  })
  it('剥离颜色 ANSI,保留可读文本', () => {
    expect(cleanInstallLog('\x1B[32minstalled\x1B[0m boxcat')).toBe('installed boxcat')
  })
  it('\\r 原地重绘同一行取最后一段;多行各自处理', () => {
    expect(cleanInstallLog('a\rbb\rccc')).toBe('ccc')
    expect(cleanInstallLog('line1\nprog.\rprog..\nline3')).toBe('line1\nprog..\nline3')
  })
  it('折叠多余空行 + 去首尾空白', () => {
    expect(cleanInstallLog('\n\n\nhello\n\n\n\nworld\n\n')).toBe('hello\n\nworld')
  })
})

describe('isValidPetName', () => {
  it('接受小写字母/数字/连字符,首字符字母数字,长度 1–64', () => {
    for (const ok of ['scoop', 'a', 'pet-1', 'a1-b2-c3', 'x'.repeat(64)]) expect(isValidPetName(ok)).toBe(true)
  })
  it('拒绝空/大写/空格/首字符连字符/超长/注入字符', () => {
    for (const bad of ['', '-x', 'A', 'Scoop', 'has space', 'x'.repeat(65), 'foo;rm -rf', '../evil', 'a b', 'pet_1', '名字']) {
      expect(isValidPetName(bad)).toBe(false)
    }
  })
})

describe('npxSearchDirs', () => {
  it('PATH 目录在前、常见目录在后,整体去重', () => {
    const dirs = npxSearchDirs('/usr/local/bin:/foo/bin', '/Users/me')
    expect(dirs[0]).toBe('/usr/local/bin')
    expect(dirs[1]).toBe('/foo/bin')
    expect(dirs).toContain('/opt/homebrew/bin')
    expect(dirs).toContain('/Users/me/.volta/bin')
    // /usr/local/bin 同时在 PATH 与常见目录里,只应出现一次(去重)。
    expect(dirs.filter(d => d === '/usr/local/bin')).toHaveLength(1)
  })
  it('PATH 缺失时仍给出常见目录', () => {
    const dirs = npxSearchDirs(undefined, '/Users/me')
    expect(dirs).toContain('/opt/homebrew/bin')
    expect(dirs.length).toBeGreaterThan(0)
  })
})

describe('resolveNpx', () => {
  it('返回首个存在的 npx 绝对路径', () => {
    const exists = (p: string): boolean => p === '/opt/homebrew/bin/npx'
    expect(resolveNpx(['/usr/local/bin', '/opt/homebrew/bin'], exists)).toBe('/opt/homebrew/bin/npx')
  })
  it('全不存在 → null', () => {
    expect(resolveNpx(['/a', '/b'], () => false)).toBeNull()
  })
})

/** 假子进程:EventEmitter + stdout/stderr 两个子 emitter,供测试主动 emit data/close/error。 */
function fakeChild(): EventEmitter & { stdout: EventEmitter; stderr: EventEmitter } {
  const c = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter }
  c.stdout = new EventEmitter()
  c.stderr = new EventEmitter()
  return c
}

describe('runPetdexInstall', () => {
  it('非法名 → 不 spawn,直接失败', async () => {
    const spawnFn = vi.fn()
    const r = await runPetdexInstall('Bad Name', { cwd: '/tmp', onOutput: () => {}, spawnFn: spawnFn as never, npxPath: '/x/npx' })
    expect(r.ok).toBe(false)
    expect(spawnFn).not.toHaveBeenCalled()
  })

  it('npxPath=null(未找到 npx) → 不 spawn,给出明确文案', async () => {
    const spawnFn = vi.fn()
    const r = await runPetdexInstall('scoop', { cwd: '/tmp', onOutput: () => {}, spawnFn: spawnFn as never, npxPath: null })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('npx')
    expect(spawnFn).not.toHaveBeenCalled()
  })

  it('固定命令模板 + 定长参数 + shell:false;close 0 → 成功且流转输出', async () => {
    const child = fakeChild()
    const spawnFn = vi.fn(() => child)
    const chunks: string[] = []
    const p = runPetdexInstall('scoop', { cwd: '/home', onOutput: (c) => chunks.push(c), spawnFn: spawnFn as never, npxPath: '/opt/homebrew/bin/npx' })
    child.stdout.emit('data', Buffer.from('downloading...'))
    child.emit('close', 0, null)
    const r = await p
    expect(r).toEqual({ ok: true, error: null })
    expect(chunks.join('')).toContain('downloading')
    expect(spawnFn).toHaveBeenCalledWith('/opt/homebrew/bin/npx', ['petdex@latest', 'install', 'scoop'], expect.objectContaining({ shell: false, cwd: '/home' }))
  })

  it('非 0 退出码 → 失败', async () => {
    const child = fakeChild()
    const p = runPetdexInstall('scoop', { cwd: '/home', onOutput: () => {}, spawnFn: (() => child) as never, npxPath: '/x/npx' })
    child.emit('close', 1, null)
    const r = await p
    expect(r.ok).toBe(false)
    expect(r.error).toContain('1')
  })

  it('close 带 signal(超时/被杀) → 失败文案含 signal', async () => {
    const child = fakeChild()
    const p = runPetdexInstall('scoop', { cwd: '/home', onOutput: () => {}, spawnFn: (() => child) as never, npxPath: '/x/npx' })
    child.emit('close', null, 'SIGTERM')
    const r = await p
    expect(r.ok).toBe(false)
    expect(r.error).toContain('SIGTERM')
  })

  it('spawn error(如 ENOENT) → 失败,不抛出', async () => {
    const child = fakeChild()
    const p = runPetdexInstall('scoop', { cwd: '/home', onOutput: () => {}, spawnFn: (() => child) as never, npxPath: '/x/npx' })
    child.emit('error', new Error('spawn npx ENOENT'))
    const r = await p
    expect(r.ok).toBe(false)
    expect(r.error).toContain('ENOENT')
  })
})
