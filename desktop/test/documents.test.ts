import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  documentsDir, ensureDocumentsDir, listDocuments,
  resolveInVault, addDocuments, removeDocument, copyFailReason,
} from '../src/main/documents'

let tmp: string
let vault: string

beforeEach(async () => {
  tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wraith-docs-'))
  vault = documentsDir(tmp)
  await ensureDocumentsDir(vault)
})
afterEach(async () => { await fs.promises.rm(tmp, { recursive: true, force: true }) })

/** 造一个源文件,返回绝对路径。 */
async function srcFile(name: string, content = 'x'): Promise<string> {
  const p = path.join(tmp, name)
  await fs.promises.writeFile(p, content)
  return p
}

async function createSymlinkOrSkip(target: string, link: string): Promise<boolean> {
  try {
    await fs.promises.symlink(target, link)
    return true
  } catch (error) {
    if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') return false
    throw error
  }
}

describe('documentsDir', () => {
  it('落在 <home>/.wraith/documents', () => {
    expect(documentsDir('/home/me')).toBe(path.join('/home/me', '.wraith', 'documents'))
  })
})

describe('ensureDocumentsDir', () => {
  it('目录不存在时创建,已存在时不报错', async () => {
    const d = path.join(tmp, 'deep', 'nested', 'documents')
    await ensureDocumentsDir(d)
    expect(fs.existsSync(d)).toBe(true)
    await ensureDocumentsDir(d)   // 第二次不抛
  })
})

describe('listDocuments', () => {
  it('空目录返回空数组', async () => {
    expect(await listDocuments(vault)).toEqual([])
  })

  it('跳过隐藏文件与子目录,只列普通文件', async () => {
    await fs.promises.writeFile(path.join(vault, 'a.pdf'), 'hello')
    await fs.promises.writeFile(path.join(vault, '.DS_Store'), 'noise')
    await fs.promises.mkdir(path.join(vault, 'sub'))
    const list = await listDocuments(vault)
    expect(list.map(e => e.name)).toEqual(['a.pdf'])
    expect(list[0].size).toBe(5)
  })

  it('按 addedAt 倒序(新的在前)', async () => {
    await fs.promises.writeFile(path.join(vault, 'old.md'), '1')
    await fs.promises.writeFile(path.join(vault, 'new.md'), '1')
    // 直接把 old 的时间戳压到过去,避免依赖真实时序
    const past = new Date(Date.now() - 60_000)
    await fs.promises.utimes(path.join(vault, 'old.md'), past, past)
    const list = await listDocuments(vault)
    expect(list[0].name).toBe('new.md')
  })

  it('目录不存在时返回空数组而不是抛', async () => {
    expect(await listDocuments(path.join(tmp, 'nope'))).toEqual([])
  })

  // ── 列举口径必须与 resolveInVault 一致,否则会列出「看得见却删不掉」的死行 ──────
  // final review 实测复现的两个实例:列出来的行,open/reveal/remove 三个动作全抛,
  // 用户只能去访达删,而且点开时弹的是「路径越界」这种听着像安全事故的文案。

  it('库内软链(指向库外文件)不出现在列表里 —— 否则它的三个动作全抛「路径越界」', async (ctx) => {
    const outside = path.join(tmp, 'outside.txt')
    await fs.promises.writeFile(outside, 'sensitive')
    if (!await createSymlinkOrSkip(outside, path.join(vault, '看起来很正常.txt'))) {
      return ctx.skip('当前 Windows 账号没有创建符号链接的权限；支持该能力的平台仍执行库外链接防护断言。')
    }
    await fs.promises.writeFile(path.join(vault, 'real.md'), 'x')
    const list = await listDocuments(vault)
    expect(list.map(e => e.name)).toEqual(['real.md'])
    // 同一个名字在 resolveInVault 那侧确实是抛的 —— 两处口径这才对上
    expect(() => resolveInVault(vault, '看起来很正常.txt')).toThrow(/越界/)
  })

  // Windows 的反斜杠是路径分隔符，真实文件系统无法构造这个 POSIX 文件名。
  it.skipIf(process.platform === 'win32')('名字含反斜杠的普通文件不出现在列表里 —— 否则它的三个动作全抛「非法文件名」', async () => {
    // POSIX 上 \ 是合法文件名字符,从 Windows 拷来/拖进来就能产生
    await fs.promises.writeFile(path.join(vault, 'a\\b.txt'), 'x')
    await fs.promises.writeFile(path.join(vault, 'real.md'), 'x')
    const list = await listDocuments(vault)
    expect(list.map(e => e.name)).toEqual(['real.md'])
    expect(() => resolveInVault(vault, 'a\\b.txt')).toThrow(/非法文件名/)
  })
})

describe('resolveInVault —— 路径安全', () => {
  it('正常名字返回库内路径', async () => {
    await fs.promises.writeFile(path.join(vault, 'a.pdf'), 'x')
    const r = resolveInVault(vault, 'a.pdf')
    expect(r.status).toBe('ok')
    expect(r.status === 'ok' && r.path).toBe(path.join(vault, 'a.pdf'))
  })

  it('相对路径逃逸 → 抛', () => {
    expect(() => resolveInVault(vault, '../../../etc/passwd')).toThrow(/非法文件名/)
  })

  it('绝对路径 → 抛', () => {
    expect(() => resolveInVault(vault, '/etc/passwd')).toThrow(/非法文件名/)
  })

  it('. 与 .. 与空串 → 抛', () => {
    expect(() => resolveInVault(vault, '.')).toThrow(/非法文件名/)
    expect(() => resolveInVault(vault, '..')).toThrow(/非法文件名/)
    expect(() => resolveInVault(vault, '')).toThrow(/非法文件名/)
  })

  it('库内软链指向库外 → 抛越界(realpath 才看得出来)', async (ctx) => {
    const outside = path.join(tmp, 'secret.txt')
    await fs.promises.writeFile(outside, 'sensitive')
    if (!await createSymlinkOrSkip(outside, path.join(vault, 'innocent.txt'))) {
      return ctx.skip('当前 Windows 账号没有创建符号链接的权限；支持该能力的平台仍执行库外链接防护断言。')
    }
    expect(() => resolveInVault(vault, 'innocent.txt')).toThrow(/越界/)
  })

  it('文件不存在 → status=missing,不抛(与越界是两条分支)', () => {
    const r = resolveInVault(vault, 'ghost.pdf')
    expect(r.status).toBe('missing')
  })
})

describe('addDocuments', () => {
  it('拷贝进库并返回最终文件名', async () => {
    const s = await srcFile('report.pdf', 'content')
    const r = await addDocuments(vault, [s])
    expect(r.added).toEqual(['report.pdf'])
    expect(r.failed).toEqual([])
    expect(fs.readFileSync(path.join(vault, 'report.pdf'), 'utf8')).toBe('content')
  })

  it('重名不覆盖,走 uniqueDownloadName 从 (2) 起', async () => {
    await fs.promises.writeFile(path.join(vault, 'a.pdf'), 'old')
    const s = await srcFile('a.pdf', 'new')
    const r = await addDocuments(vault, [s])
    expect(r.added).toEqual(['a (2).pdf'])
    expect(fs.readFileSync(path.join(vault, 'a.pdf'), 'utf8')).toBe('old')      // 原文件没被动
    expect(fs.readFileSync(path.join(vault, 'a (2).pdf'), 'utf8')).toBe('new')
  })

  it('同一批里两个同名文件也各自消歧', async () => {
    const d1 = path.join(tmp, 'd1'); const d2 = path.join(tmp, 'd2')
    await fs.promises.mkdir(d1); await fs.promises.mkdir(d2)
    await fs.promises.writeFile(path.join(d1, 'same.md'), '1')
    await fs.promises.writeFile(path.join(d2, 'same.md'), '2')
    const r = await addDocuments(vault, [path.join(d1, 'same.md'), path.join(d2, 'same.md')])
    expect(r.added).toEqual(['same.md', 'same (2).md'])
  })

  it('文件夹被跳过并计入 failed,不影响同批其他文件', async () => {
    const dir = path.join(tmp, 'afolder')
    await fs.promises.mkdir(dir)
    const s = await srcFile('ok.md')
    const r = await addDocuments(vault, [dir, s])
    expect(r.added).toEqual(['ok.md'])
    expect(r.failed).toEqual([{ name: 'afolder', reason: '暂不支持文件夹' }])
  })

  it('源文件不存在时计入 failed,其余继续', async () => {
    const s = await srcFile('good.md')
    const r = await addDocuments(vault, [path.join(tmp, 'ghost.md'), s])
    expect(r.added).toEqual(['good.md'])
    expect(r.failed).toHaveLength(1)
    expect(r.failed[0].name).toBe('ghost.md')
    // 中文原因,而不是 `ENOENT: no such file or directory, stat '/…'` 那串带绝对路径的英文
    expect(r.failed[0].reason).toBe('文件已不存在')
    expect(r.failed[0].reason).not.toContain(tmp)
  })
})

// spec §6 那张表写死了失败原因是「xxx 无读取权限」这类中文;
// 直接透传 Node 的 err.message 会得到一整串英文 + 完整源路径,和同函数里已有的
// 中文「暂不支持文件夹」也不是一个口径。
describe('copyFailReason', () => {
  const errno = (code: string): NodeJS.ErrnoException =>
    Object.assign(new Error(`${code}: some raw node text, stat '/Users/x/y'`), { code })

  it('常见 errno 映射成中文', () => {
    expect(copyFailReason(errno('ENOENT'))).toBe('文件已不存在')
    expect(copyFailReason(errno('EACCES'))).toBe('无读取权限')
    expect(copyFailReason(errno('EPERM'))).toBe('无读取权限')
    expect(copyFailReason(errno('EISDIR'))).toBe('暂不支持文件夹')
  })

  it('磁盘写满带上原始 errno(spec 明确要求这条能被查)', () => {
    expect(copyFailReason(errno('ENOSPC'))).toBe('磁盘空间不足(ENOSPC)')
  })

  it('未收录的 errno 保留原文 —— 罕见故障宁可原样透出也别吞掉', () => {
    expect(copyFailReason(errno('EMFILE'))).toContain('EMFILE')
  })

  it('无 code 的 Error / 非 Error 值都能给出字符串', () => {
    expect(copyFailReason(new Error('炸了'))).toBe('炸了')
    expect(copyFailReason('炸了')).toBe('炸了')
    expect(copyFailReason(null)).toBe('null')
  })
})

describe('removeDocument', () => {
  it('删掉库内文件', async () => {
    await fs.promises.writeFile(path.join(vault, 'a.pdf'), 'x')
    await removeDocument(vault, 'a.pdf')
    expect(fs.existsSync(path.join(vault, 'a.pdf'))).toBe(false)
  })

  it('文件已不存在 → 幂等成功,不抛', async () => {
    await expect(removeDocument(vault, 'ghost.pdf')).resolves.toBeUndefined()
  })

  it('越界名字 → 抛,且不碰目标文件', async (ctx) => {
    const outside = path.join(tmp, 'keep.txt')
    await fs.promises.writeFile(outside, 'x')
    if (!await createSymlinkOrSkip(outside, path.join(vault, 'link.txt'))) {
      return ctx.skip('当前 Windows 账号没有创建符号链接的权限；支持该能力的平台仍执行库外链接防护断言。')
    }
    await expect(removeDocument(vault, 'link.txt')).rejects.toThrow(/越界/)
    expect(fs.existsSync(outside)).toBe(true)
  })
})
