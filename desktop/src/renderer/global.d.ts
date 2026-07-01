import type { BackendEvent } from '../shared/types'
import type { WraithApi } from '../preload/index'

declare global {
  interface Window {
    wraith: WraithApi
  }
}
