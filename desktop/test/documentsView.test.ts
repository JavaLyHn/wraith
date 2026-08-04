import { describe, it, expect } from 'vitest'
import { filterDocs, formatSize, docIconKind } from '../src/renderer/lib/documentsView'
import type { DocEntry } from '../src/shared/types'

const doc = (name: string): DocEntry => ({ name, size: 1, addedAt: 1 })

describe('filterDocs', () => {
  const docs = [doc('需求文档.pdf'), doc('API 设计.md'), doc('Report.PDF')]

  it('空查询原样返回', () => {
    expect(filterDocs(docs, '')).toHaveLength(3)
  })

  it('只留名字含关键词的', () => {
    expect(filterDocs(docs, '设计').map(d => d.name)).toEqual(['API 设计.md'])
  })

  it('大小写不敏感', () => {
    expect(filterDocs(docs, 'report').map(d => d.name)).toEqual(['Report.PDF'])
    expect(filterDocs(docs, '.pdf').map(d => d.name)).toEqual(['需求文档.pdf', 'Report.PDF'])
  })

  it('查询两侧空白被忽略', () => {
    expect(filterDocs(docs, '  设计  ')).toHaveLength(1)
  })

  it('无命中返回空数组', () => {
    expect(filterDocs(docs, 'zzz')).toEqual([])
  })
})

describe('formatSize', () => {
  it('B 区间', () => {
    expect(formatSize(0)).toBe('0 B')
    expect(formatSize(999)).toBe('999 B')
  })
  it('KB 区间(1024 起)', () => {
    expect(formatSize(1024)).toBe('1.0 KB')
    expect(formatSize(1536)).toBe('1.5 KB')
  })
  it('MB 区间', () => {
    expect(formatSize(1024 * 1024)).toBe('1.0 MB')
    expect(formatSize(2.4 * 1024 * 1024)).toBe('2.4 MB')
  })
  it('GB 区间', () => {
    expect(formatSize(1024 ** 3)).toBe('1.0 GB')
  })
})

describe('docIconKind', () => {
  it('按扩展名分类,大小写不敏感', () => {
    expect(docIconKind('a.pdf')).toBe('pdf')
    expect(docIconKind('a.PDF')).toBe('pdf')
    expect(docIconKind('a.docx')).toBe('doc')
    expect(docIconKind('a.xlsx')).toBe('sheet')
    expect(docIconKind('a.png')).toBe('image')
    expect(docIconKind('a.md')).toBe('text')
  })
  it('未知扩展名与无扩展名兜底 file', () => {
    expect(docIconKind('a.zzz')).toBe('file')
    expect(docIconKind('README')).toBe('file')
  })
})
