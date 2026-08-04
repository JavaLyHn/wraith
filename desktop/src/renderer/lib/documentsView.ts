/**
 * documentsView —— 「文档」面板的纯展示逻辑,无 React/Electron 依赖。
 * 过滤、大小格式化、扩展名→图标类别。排序在主进程侧已做(addedAt 倒序)。
 */

import type { DocEntry } from '../../shared/types'

/** 按文件名过滤,大小写不敏感;空查询原样返回。 */
export function filterDocs(docs: DocEntry[], query: string): DocEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return docs
  return docs.filter(d => d.name.toLowerCase().includes(q))
}

/** 人类可读大小。1024 进制,KB 以上保留一位小数。 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(1)} ${units[i]}`
}

export type DocIconKind = 'pdf' | 'doc' | 'sheet' | 'image' | 'text' | 'file'

const EXT_KIND: Record<string, DocIconKind> = {
  pdf: 'pdf',
  doc: 'doc', docx: 'doc', rtf: 'doc', pages: 'doc',
  xls: 'sheet', xlsx: 'sheet', csv: 'sheet', numbers: 'sheet',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image',
  md: 'text', txt: 'text', json: 'text', yaml: 'text', yml: 'text', log: 'text',
}

/** 扩展名 → 图标类别;未知与无扩展名兜底 'file'。 */
export function docIconKind(name: string): DocIconKind {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return 'file'
  return EXT_KIND[name.slice(dot + 1).toLowerCase()] ?? 'file'
}
