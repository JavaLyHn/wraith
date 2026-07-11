/**
 * Composer 粘贴/拖拽图片的纯判定逻辑(与 DOM 事件解耦,便于单测)。
 * 事件处理器只负责「取 blob / 取路径」,判定与造条目全在这里。
 */
import type { AttachmentItem } from '../components/Composer'
import { attachmentKind } from '../../shared/attachmentKind'

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

/** 剪贴板 image mime → 落盘扩展名;未知 mime → null(不落盘)。 */
export function imageExtFromMime(mime: string): string | null {
  if (!mime) return null
  return MIME_TO_EXT[mime.toLowerCase()] ?? null
}

/** type 是否是图片 mime。 */
export function isImageMime(type: string): boolean {
  return !!type && type.toLowerCase().startsWith('image/')
}

/** basename(跨平台:同时切 / 和 \)。 */
function baseNameOf(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(i + 1) : p
}

/** 一批磁盘路径 → 附件条目(图片扩展 → image,其余 → text);空路径跳过。 */
export function pathsToAttachments(paths: string[]): AttachmentItem[] {
  const out: AttachmentItem[] = []
  for (const p of paths) {
    if (!p || !p.trim()) continue
    out.push({ path: p, name: baseNameOf(p), kind: attachmentKind(p) })
  }
  return out
}
