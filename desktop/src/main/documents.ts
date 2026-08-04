/**
 * documents —— 「文档」面板的存储层:~/.wraith/documents/ 扁平存放用户资料。
 *
 * 刻意不 import electron:dialog/shell 留在 index.ts 的 handler 里,
 * 这样本模块能在纯 Node 下被 vitest 直接测(路径逃逸那组用例才好写)。
 *
 * 目录本身是唯一真相源 —— 不建索引文件,列表全部由 readdir + stat 现算。
 */

import fs from 'fs'
import path from 'path'
import { uniqueDownloadName } from './fileOpen'
import type { DocEntry, DocAddResult } from '../shared/types'

/** 库目录:<home>/.wraith/documents。取 home 作参数,便于测试。 */
export function documentsDir(home: string): string {
  return path.join(home, '.wraith', 'documents')
}

/** 首次访问自动创建;已存在不报错。 */
export async function ensureDocumentsDir(dir: string): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true })
}

/**
 * 列库内普通文件,跳过隐藏文件、子目录与软链,按 addedAt 倒序。目录不存在返回空数组。
 *
 * ⚠ 列举口径必须与 `resolveInVault` 的「什么算库内条目」一致,否则会列出
 * **看得见却删不掉**的死行(open/reveal/remove 三个动作全抛,用户只能去访达删):
 *   - 用 `stat`(跟随软链)会把「库内软链→库外文件」当普通文件列出,而
 *     resolveInVault 第 3 步的 realpath 越界校验会让它三个动作全抛「路径越界」
 *     —— 那文案听着像安全事故。改用 `lstat`:软链的 isFile() 为 false,自然跳过,
 *     也才真正符合 spec §3.3「只列普通文件」。
 *   - 名字含反斜杠的普通文件在 POSIX 上合法(拖进来就能产生),但 resolveInVault
 *     第 1 步判它「非法文件名」→ 同样三个动作全抛。这里直接不列。
 */
export async function listDocuments(dir: string): Promise<DocEntry[]> {
  let names: string[]
  try {
    names = await fs.promises.readdir(dir)
  } catch {
    return []   // 目录还没建 = 库是空的,不是错误
  }
  const out: DocEntry[] = []
  for (const name of names) {
    if (name.startsWith('.')) continue    // .DS_Store 一类噪音
    if (name.includes('\\')) continue     // resolveInVault 视为非法名 → 不列,免得成死行
    try {
      const st = await fs.promises.lstat(path.join(dir, name))
      if (!st.isFile()) continue          // 跳过子目录与软链(lstat 下软链 isFile() 为 false)
      // birthtime 在部分 Linux 文件系统上为 0/无效,退回 mtime
      const birth = st.birthtimeMs
      out.push({ name, size: st.size, addedAt: birth > 0 ? birth : st.mtimeMs })
    } catch { /* 列举过程中文件消失:跳过即可 */ }
  }
  return out.sort((a, b) => b.addedAt - a.addedAt)
}

/**
 * 把库内文件名解析成绝对路径。三步顺序**不可调换**:
 *   1. 名字合法性 → 非法抛
 *   2. 存在性     → 不存在返回 missing(不抛)
 *   3. realpath 越界 → 越界抛
 * 第 2 步必须在 realpath 之前:realpathSync 对不存在的路径直接抛 ENOENT,
 * 混在一起就分不清「文件没了」(该幂等成功)和「路径越界」(该抛)。
 */
export function resolveInVault(
  dir: string,
  name: string,
): { status: 'ok'; path: string } | { status: 'missing' } {
  // 1. 名字合法性:不许有分隔符,不许是 . / .. / 空
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw new Error(`非法文件名:${name}`)
  }
  const target = path.join(dir, name)

  // 2. 存在性(用 lstat:软链本身存在就算存在,交给第 3 步去揭穿)
  try {
    fs.lstatSync(target)
  } catch {
    return { status: 'missing' }
  }

  // 3. realpath 越界:字符串比较看不出软链,必须解析
  const realVault = fs.realpathSync(dir)
  const realTarget = fs.realpathSync(target)
  const rel = path.relative(realVault, realTarget)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`路径越界:${name}`)
  }
  return { status: 'ok', path: target }
}

/**
 * 入库失败原因 → 面向用户的中文(spec §6 那张表写死了要显示「xxx 无读取权限」这类文案)。
 * 直接透传 Node 的 err.message 会得到 `ENOENT: no such file or directory, stat '/…'`
 * 这种一整串英文 + 完整源路径,和同函数里已有的中文「暂不支持文件夹」也不是一个口径。
 * 未收录的 errno **保留原文** —— spec 要求这类罕见故障带上原始 errno 好让人能查。
 */
export function copyFailReason(err: unknown): string {
  const code = (err as NodeJS.ErrnoException | null)?.code
  switch (code) {
    case 'ENOENT': return '文件已不存在'
    case 'EACCES':
    case 'EPERM': return '无读取权限'
    case 'ENOSPC': return '磁盘空间不足(ENOSPC)'   // 罕见故障,仍带上原始 errno
    case 'EISDIR': return '暂不支持文件夹'
    default: return err instanceof Error ? err.message : String(err)
  }
}

/** 批量拷贝进库。单条失败不影响其余,失败原因面向用户可读。 */
export async function addDocuments(dir: string, sources: string[]): Promise<DocAddResult> {
  await ensureDocumentsDir(dir)
  const added: string[] = []
  const failed: { name: string; reason: string }[] = []
  // 同批内也要避免互相覆盖:taken 随每次入库增长
  const taken = new Set(await fs.promises.readdir(dir).catch(() => [] as string[]))

  for (const src of sources) {
    const base = path.basename(src)
    try {
      const st = await fs.promises.stat(src)
      if (st.isDirectory()) { failed.push({ name: base, reason: '暂不支持文件夹' }); continue }
      const finalName = uniqueDownloadName(taken, base)
      await fs.promises.copyFile(src, path.join(dir, finalName))
      taken.add(finalName)
      added.push(finalName)
    } catch (err) {
      failed.push({ name: base, reason: copyFailReason(err) })
    }
  }
  return { added, failed }
}

/** 删除库内文件。已不存在 = 幂等成功;越界抛。 */
export async function removeDocument(dir: string, name: string): Promise<void> {
  const r = resolveInVault(dir, name)
  if (r.status === 'missing') return
  await fs.promises.unlink(r.path)
}
