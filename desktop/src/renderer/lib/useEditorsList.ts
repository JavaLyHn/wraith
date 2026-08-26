import { useEffect, useState } from 'react'
import type { EditorApp } from '../../shared/editors'

/**
 * 编辑器列表 hook:获取已安装的编辑器列表。
 */
export function useEditorsList(): { editors: EditorApp[]; setEditors: React.Dispatch<React.SetStateAction<EditorApp[]>> } {
  const [editors, setEditors] = useState<EditorApp[]>([])
  useEffect(() => { void window.wraith.listEditors().then(setEditors).catch(() => {}) }, [])
  return { editors, setEditors }
}
