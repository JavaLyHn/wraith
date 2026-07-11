/**
 * 粘贴图片落临时文件的纯逻辑(扩展名校验 + 文件名生成)。
 * 与 fs / electron 解耦,便于单测。实际写盘在 index.ts 的 IPC handler 里。
 */

const ALLOWED_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])

/** 归一化并校验扩展名;非法(含空)返回 null。 */
export function validImageExt(ext: string): string | null {
  if (!ext) return null
  const e = ext.trim().toLowerCase().replace(/^\./, '')
  return ALLOWED_EXT.has(e) ? e : null
}

/** 生成临时图片文件名:paste-<epochMs>-<seq>.<ext>(无随机密钥、无敏感信息)。 */
export function tempImageName(ext: string, seq: number, nowMs: number): string {
  return `paste-${nowMs}-${seq}.${ext}`
}
