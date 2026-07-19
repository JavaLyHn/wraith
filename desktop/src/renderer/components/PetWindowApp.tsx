import { useEffect, useRef, useState } from 'react'
import PetSprite from './PetSprite'
import type { PetConfig } from '../../main/settings'
import type { PetSprite as PetSpriteType, PetState } from '../../shared/pets'
import type { PetStateSignal } from '../../shared/petState'
import { nextPetState, TRANSIENT_MS } from '../../shared/petState'

interface PreviewState {
  previewUrl: string | null
  sprite: PetSpriteType | null
}

interface SignalState {
  state: PetState
  expiresAt: number | null
}

/** 瞬态状态(success/error)的过期时长,越界/非瞬态状态查不到时立即过期(0ms)。 */
function transientMs(state: PetState): number {
  return state === 'success' ? TRANSIENT_MS.success : state === 'error' ? TRANSIENT_MS.error : 0
}

/**
 * PetWindowApp — 全局桌宠窗口的根组件(spec Task 7)。订阅主进程经 window.wraithPet
 * 推送的三路状态(config/preview/signal),按旧 App.tsx(已摘除)的 applyPetSignal
 * 模式管理瞬态计时:success/error 是瞬态,过期(TRANSIENT_MS)后自动回落 idle;
 * 其余状态(thinking/tool/approval)持久,直到下一条信号覆盖。挂载即调用
 * window.wraithPet.ready() 触发主进程首推当前 config + 当前选中宠物的 preview。
 */
export default function PetWindowApp(): JSX.Element {
  const [config, setConfig] = useState<PetConfig | null>(null)
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [signal, setSignal] = useState<SignalState>({ state: 'idle', expiresAt: null })
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    window.wraithPet.ready()

    const offConfig = window.wraithPet.onConfig((c) => setConfig(c))
    const offPreview = window.wraithPet.onPreview((p) => setPreview(p ? { previewUrl: p.previewUrl, sprite: p.sprite } : null))
    const offSignal = window.wraithPet.onSignal((s: PetStateSignal) => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      if (s.transient) {
        const ms = transientMs(s.state)
        const expiresAt = Date.now() + ms
        setSignal({ state: s.state, expiresAt })
        timerRef.current = setTimeout(() => {
          timerRef.current = null
          setSignal({ state: 'idle', expiresAt: null })
        }, ms)
      } else {
        setSignal({ state: s.state, expiresAt: null })
      }
    })

    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      offConfig()
      offPreview()
      offSignal()
    }
  }, [])

  const state = nextPetState(signal, Date.now())

  return (
    <PetSprite
      previewUrl={preview?.previewUrl ?? null}
      sprite={preview?.sprite ?? null}
      state={state}
      motion={config?.motion ?? 'calm'}
      scale={config?.scale ?? 1}
    />
  )
}
