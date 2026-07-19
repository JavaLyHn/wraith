import { useCallback, useEffect, useRef, useState } from 'react'
import PetSprite from './PetSprite'
import type { PetConfig } from '../../main/settings'
import type { PetSprite as PetSpriteType, PetState } from '../../shared/pets'
import type { PetStateSignal } from '../../shared/petState'
import { nextPetState, TRANSIENT_MS } from '../../shared/petState'
import { spriteRowFor } from '../lib/petMotion'
import { isOpaqueAt, spriteHitPixel, containScale, STATIC_IMAGE_MAX_PX, stepScale } from '../../shared/petWindow'

interface PreviewState {
  previewUrl: string | null
  sprite: PetSpriteType | null
}

interface SignalState {
  state: PetState
  expiresAt: number | null
}

/** 点击穿透(Task 8)命中测试要用的解码结果:精灵表场景 sheetW/H 是整张表、frameW/H
 * 是单帧尺寸、capRatio 恒 1(精灵表没有 STATIC_IMAGE_MAX_PX 那层收缩);单图场景
 * sheetW/H 就是原图尺寸本身(frameW/H 与 sheetW/H 相同、col/row 恒 (0,0)),capRatio
 * 是 containScale 算出的收缩比——必须和 PetSprite 里实际渲染用的同一份比例一致,
 * 否则命中测试跟画面会对不上。 */
interface HitTestData {
  data: Uint8ClampedArray
  sheetW: number
  frameW: number
  frameH: number
  capRatio: number
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
 *
 * 点击穿透(Task 8):默认窗口是 setIgnoreMouseEvents(true,{forward:true})(纯穿透,
 * 但 renderer 仍能收到 mousemove)。本组件独立解码 previewUrl(不读取 PetSprite 任何
 * 内部 ref/state,只借 PetSprite 的 onFrame 回调拿当前动画帧号)得到一份 alpha 数据,
 * mousemove 时用 spriteHitPixel 把指针窗口坐标反算成 sheet 像素、isOpaqueAt 判断是否
 * 命中非透明像素,命中才让窗口临时捕获鼠标——只在"穿透⇄捕获"状态翻转的那一刻才发
 * IPC(ignoringRef 记当前状态),不会每次 mousemove 都发一条。
 *
 * 全身拖动/滚轮缩放/右键菜单(Task 9):三者都挂在本组件的根 div 上,因为命中测试
 * 已经保证"这个 div 收到指针事件"就等价于"窗口正在捕获鼠标",不需要再单独判断。
 * 拖动期间(draggingRef=true)会让上面的 mousemove 命中测试整体短路——否则窗口
 * 跟随指针移动到新位置后,下一帧 mousemove 用旧窗口坐标反算出的 sheet 像素很可能
 * 落回透明区,命中测试会误判"没按在宠物上了"从而 setIgnoreMouse(true),窗口这一刻
 * 变穿透、后续指针事件穿过去打到桌面,拖拽被硬生生打断。
 */
export default function PetWindowApp(): JSX.Element {
  const [config, setConfig] = useState<PetConfig | null>(null)
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [signal, setSignal] = useState<SignalState>({ state: 'idle', expiresAt: null })
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 命中测试要读的"最新值"全部收进 ref,mousemove 监听器本身只挂一次(空依赖数组)、
  // 永不重新订阅——它是高频事件,不希望每次 state/config 变化都拆装一次监听器。
  const scaleRef = useRef(1)
  const rowRef = useRef(0)
  const frameColRef = useRef(0)
  const hitRef = useRef<HitTestData | null>(null)
  const ignoringRef = useRef(true) // 与主进程建窗时的默认 setIgnoreMouseEvents(true,…) 对齐

  // 全身拖动(Task 9):draggingRef 是"当前是否在拖"的唯一真源,下面的点击穿透
  // mousemove 命中测试第一件事就读它——见本文件顶部注释里对这条协调关系的解释。
  // grabRef 记按下那一刻"指针相对窗口左上角"的偏移(screen 坐标系),拖动全程复用,
  // 不必每次 pointermove 重新计算(窗口左上角在拖动中一直变,不能拿它反推偏移)。
  const draggingRef = useRef(false)
  const grabRef = useRef({ dx: 0, dy: 0 })
  // 滚轮缩放节流:同一 rAF 内的重复 wheel 事件直接丢弃(而不是排队到下一帧才发),
  // 避免触控板连续触发的高频 wheel 把 IPC 刷爆。
  const wheelPendingRef = useRef(false)

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

  useEffect(() => {
    scaleRef.current = config?.scale ?? 1
  }, [config?.scale])

  useEffect(() => {
    rowRef.current = preview?.sprite ? spriteRowFor(state, preview.sprite.rows) : 0
  }, [state, preview?.sprite])

  // PetSprite 报回的当前动画帧列号(精灵表场景);单图场景 PetSprite 不会推进这个值,
  // frameColRef 留在初值 0 也无妨——单图命中测试的 col 恒为 0(见下方解码分支)。
  const handleFrame = useCallback((frame: number) => {
    frameColRef.current = frame
  }, [])

  // previewUrl/sprite 变化时独立解码一份 alpha:精灵表整表解码(sheetW/H = 表尺寸,
  // frameW/H = 单帧尺寸,capRatio 恒 1);单图整图解码(sheetW/H = frameW/H = 图片
  // 原始像素尺寸,capRatio 用 containScale 与 PetSprite 渲染时算的同一个比例)。
  // 解码失败(canvas 不可用/图片加载失败)→ hitRef 置空,mousemove 上该帧一律视为
  // 未命中(透明穿透),绝不因解码失败而误判命中卡住穿透。
  useEffect(() => {
    hitRef.current = null
    const previewUrl = preview?.previewUrl ?? null
    const sprite = preview?.sprite ?? null
    if (!previewUrl) return
    let alive = true
    const img = new Image()
    img.onload = (): void => {
      if (!alive) return
      try {
        const sheetW = sprite ? sprite.columns * sprite.frameWidth : img.naturalWidth
        const sheetH = sprite ? sprite.rows * sprite.frameHeight : img.naturalHeight
        const canvas = document.createElement('canvas')
        canvas.width = sheetW
        canvas.height = sheetH
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.drawImage(img, 0, 0)
        const { data } = ctx.getImageData(0, 0, sheetW, sheetH)
        if (!alive) return
        hitRef.current = sprite
          ? { data, sheetW, frameW: sprite.frameWidth, frameH: sprite.frameHeight, capRatio: 1 }
          : { data, sheetW, frameW: img.naturalWidth, frameH: img.naturalHeight, capRatio: containScale(img.naturalWidth, img.naturalHeight, STATIC_IMAGE_MAX_PX) }
      } catch {
        hitRef.current = null
      }
    }
    img.onerror = (): void => { hitRef.current = null }
    img.src = previewUrl
    return () => { alive = false }
  }, [preview?.previewUrl, preview?.sprite])

  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      if (draggingRef.current) return // 拖动期间挂起命中测试,见组件顶部注释
      const hit = hitRef.current
      let opaque = false
      if (hit) {
        const s = scaleRef.current * hit.capRatio
        const px = spriteHitPixel(e.clientX, e.clientY, s, frameColRef.current, rowRef.current, hit.frameW, hit.frameH)
        if (px) opaque = isOpaqueAt(hit.data, hit.sheetW, px.px, px.py)
      }
      if (opaque === ignoringRef.current) { // 需要翻转(当前状态与命中结果不一致)
        ignoringRef.current = !opaque
        window.wraithPet.setIgnoreMouse(!opaque)
      }
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  // 全身拖动(Task 9):按下时记 grabDX/DY = 指针 - 窗口左上角(均为 screen 坐标),
  // setPointerCapture 保证后续 pointermove/pointerup 持续打到这个 div 上,即便窗口
  // 跟随指针移动导致指针"跑出"当前窗口范围(否则窗口一旦落后于指针,原生 hover-based
  // 事件路由会直接丢事件,拖拽半途中断)。只响应左键(e.button===0):右键要留给
  // onContextMenu,中键/其余键不应该启动拖动——否则会跟右键菜单同时抢状态:
  // draggingRef=true + 命中测试被挂起,而原生 Menu.popup() 抢走输入焦点后,这次
  // pointerdown 对应的 pointerup 可能永远送不到这个 div,draggingRef 卡死在 true。
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    draggingRef.current = true
    grabRef.current = { dx: e.screenX - window.screenX, dy: e.screenY - window.screenY }
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [])

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    window.wraithPet.moveTo(e.screenX - grabRef.current.dx, e.screenY - grabRef.current.dy)
  }, [])

  // 拖动被外部打断的兜底:pointerup 不一定总会送达这个 div——原生右键菜单弹出、
  // 系统手势、窗口失焦等都可能让浏览器直接派发 pointercancel,或者(capture 已经
  // 被浏览器自己收回时)只派发 lostpointercapture 而没有 pointerup。没有这道兜底,
  // draggingRef 会卡在 true:上面的 mousemove 命中测试永久短路,窗口永远停在
  // "捕获鼠标"态,连透明区也会吞穿桌面点击,只能重启桌宠窗才能恢复。onPointerCancel
  // 和 onLostPointerCapture 都只做同一件事:复位 draggingRef + 尽力释放 capture
  // (capture 已经丢失时 release 本身是无害的空操作,用 try/catch 兜底跨浏览器差异)。
  const resetDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* 已丢失/已释放,无害 */ }
  }, [])

  // 落盘用当前窗口屏幕原点(而非 pointerup 那一刻的指针坐标减 grab 偏移——理论上
  // 该相等,但直接读 window.screenX/Y 更贴近"主进程 setBounds 之后实际落地的位置",
  // 不受 moveTo IPC 异步/节流影响)。
  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    resetDrag(e)
    void window.wraithPet.setConfig({ position: { x: window.screenX, y: window.screenY } })
  }, [resetDrag])

  // 滚轮缩放(Task 9):每帧最多发一次 setScale IPC,同帧内的重复 wheel 事件直接丢弃
  // (wheelPendingRef 挡住,不排队、不合并 deltaY)。stepScale 的"当前 scale"读
  // scaleRef(命中测试同一份 ref,随 config.scale 保持最新),不额外引入新状态。
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (wheelPendingRef.current) return
    wheelPendingRef.current = true
    requestAnimationFrame(() => { wheelPendingRef.current = false })
    window.wraithPet.setScale(stepScale(scaleRef.current, e.deltaY))
  }, [])

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    window.wraithPet.contextMenu()
  }, [])

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={resetDrag}
      onLostPointerCapture={resetDrag}
      onWheel={handleWheel}
      onContextMenu={handleContextMenu}
    >
      <PetSprite
        previewUrl={preview?.previewUrl ?? null}
        sprite={preview?.sprite ?? null}
        state={state}
        motion={config?.motion ?? 'calm'}
        onFrame={handleFrame}
        scale={config?.scale ?? 1}
      />
    </div>
  )
}
