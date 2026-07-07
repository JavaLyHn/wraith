/** Uint8Array → 标准 base64(无 dataURL 前缀)。纯函数,可测。 */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

/** 录音 Blob → base64(渲染层调用)。 */
export async function blobToBase64(blob: Blob): Promise<string> {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()))
}

/** 把 text 插入 value 的 [selStart,selEnd),返回新值 + 新光标。 */
export function insertAtCursor(
  value: string, selStart: number, selEnd: number, text: string,
): { value: string; caret: number } {
  const start = Math.max(0, Math.min(selStart, value.length))
  const end = Math.max(start, Math.min(selEnd, value.length))
  return { value: value.slice(0, start) + text + value.slice(end), caret: start + text.length }
}
