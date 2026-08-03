import { contextBridge, ipcRenderer } from 'electron'
import type { PetSprite } from '../shared/pets'
import type { PetStateSignal } from '../shared/petState'
import type { PetConfig } from '../main/settings'

const api = {
  ready: () => ipcRenderer.send('pet:ready'),
  getConfig: () => ipcRenderer.invoke('pet:getConfig') as Promise<PetConfig>,
  setConfig: (patch: Partial<PetConfig>) => ipcRenderer.invoke('pet:setConfig', patch) as Promise<PetConfig>,
  onConfig: (cb: (c: PetConfig) => void) => {
    const h = (_e: unknown, c: PetConfig) => cb(c); ipcRenderer.on('pet:config', h)
    return () => ipcRenderer.removeListener('pet:config', h)
  },
  onPreview: (cb: (p: { id: string; previewUrl: string | null; sprite: PetSprite | null } | null) => void) => {
    const h = (_e: unknown, p: any) => cb(p); ipcRenderer.on('pet:preview', h)
    return () => ipcRenderer.removeListener('pet:preview', h)
  },
  onSignal: (cb: (s: PetStateSignal) => void) => {
    const h = (_e: unknown, s: PetStateSignal) => cb(s); ipcRenderer.on('pet:signal', h)
    return () => ipcRenderer.removeListener('pet:signal', h)
  },
  setIgnoreMouse: (ignore: boolean) => ipcRenderer.send('pet:setIgnoreMouse', ignore),
  // 传的是**指针**屏幕坐标,不是窗口原点 —— 窗口原点由主进程按它自己的 getBounds()
  // 换算(渲染层的 window.screenX/Y 不保证跟着 setBounds 更新,用它算会让宠物卡在屏幕顶端)。
  dragStart: (px: number, py: number) => ipcRenderer.send('pet:dragStart', px, py),
  dragMove: (px: number, py: number) => ipcRenderer.send('pet:dragMove', px, py),
  dragEnd: () => ipcRenderer.send('pet:dragEnd'),
  setScale: (scale: number) => ipcRenderer.send('pet:setScale', scale),
  contextMenu: () => ipcRenderer.send('pet:contextMenu'),
}
contextBridge.exposeInMainWorld('wraithPet', api)
export type WraithPetApi = typeof api
declare global { interface Window { wraithPet: WraithPetApi } }
