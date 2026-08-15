import type { PreviewKind } from '../../shared/types'

/** 文本文件预览单请求字节上限 (1.5 MB) */
export const MAX_TEXT_BYTES = 1_572_864

const CODE_EXTS = new Set([
  'java','ts','tsx','js','jsx','mjs','cjs','py','go','rs','json','yaml','yml','toml','xml',
  'sh','bash','zsh','ps1','psm1','bat','cmd','css','scss','less','html','htm','sql','kt',
  'kts','scala','rb','php','mdx','c','h','cpp','cc','hpp','cs','r','lua','pl','swift',
  'dart','rust','mod','gradle','properties','ini','conf','env','dockerfile','makefile',
  'ipynb','svelte','vue','graphql','gql','proto','avsc','tf','tfvars','nix','ex','exs',
])

const MD_EXTS = new Set(['md', 'markdown'])
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'])
const PDF_EXTS = new Set(['pdf'])

/** 依据文件扩展名返回预览类型;永远不抛,默认返回 'binary'。 */
export function previewKind(filePath: string): PreviewKind {
  const basename = filePath.split(/[\\/]/).pop() ?? filePath
  const idx = basename.lastIndexOf('.')
  const ext = idx === -1 ? '' : basename.slice(idx + 1).toLowerCase()
  if (ext === '') return 'binary'
  if (CODE_EXTS.has(ext)) return 'code'
  if (MD_EXTS.has(ext)) return 'markdown'
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (PDF_EXTS.has(ext)) return 'pdf'
  return 'binary'
}
