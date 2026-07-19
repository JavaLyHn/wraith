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
  moveTo: (x: number, y: number) => ipcRenderer.send('pet:moveTo', x, y),
  setScale: (scale: number) => ipcRenderer.send('pet:setScale', scale),
  contextMenu: () => ipcRenderer.send('pet:contextMenu'),
}
contextBridge.exposeInMainWorld('wraithPet', api)
export type WraithPetApi = typeof api
declare global { interface Window { wraithPet: WraithPetApi } }
