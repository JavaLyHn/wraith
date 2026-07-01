import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('wraith', {
  ping: () => 'pong'
})
