import { useCallback, useEffect, useRef, useState } from 'react'
import type { Preview } from '../../shared/sessionPreview'

/**
 * 预览状态 hook:管理 preview state + previewRef 的同步。
 *
 * previewRef 用于在事件回调中即时读取最新 preview,避免闭包陈旧。
 */
export function useLivePreviewRef() {
  const [preview, setPreview] = useState<Preview>(null)
  const previewRef = useRef<Preview>(null)
  useEffect(() => { previewRef.current = preview }, [preview])
  const getPreview = useCallback(() => previewRef.current, [])
  return { preview, setPreview, previewRef, getPreview }
}
