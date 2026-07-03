/**
 * attachmentKind — determine if a file attachment is an image or text.
 *
 * Rules:
 *   - Extensions png/jpg/jpeg/gif/webp (case-insensitive) → 'image'
 *   - Everything else (including no extension) → 'text'
 */

export type AttachmentKind = 'image' | 'text'

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])

/**
 * Given a file path or name, return 'image' if the extension is a recognised
 * image format, otherwise 'text'.  Case-insensitive.
 */
export function attachmentKind(filePath: string): AttachmentKind {
  const dot = filePath.lastIndexOf('.')
  if (dot < 0) return 'text'
  const ext = filePath.slice(dot + 1).toLowerCase()
  return IMAGE_EXTENSIONS.has(ext) ? 'image' : 'text'
}
