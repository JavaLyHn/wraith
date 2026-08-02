import { useEffect, useRef, useState } from 'react'
import type { DurableTaskView } from '../../shared/types'
import { initialWatchState, pollIntervalMs, stepWatch, type WatchState } from '../../shared/taskWatch'

/**
 * 轮询后台任务:维护活跃计数,并在有任务新变成终态时回调一次。
 *
 * 为什么是轮询:后端对后台任务不推送任何事件(面板一直也是自己拉的)。这里在 App 层再拉一次,
 * 让"有东西在跑 / 跑完了"在不打开面板时也看得见。间隔按活跃数自适应(见 pollIntervalMs),
 * 闲时 15s,避免长期空转敲后端。
 *
 * onFinished 用 ref 存:调用方通常传内联箭头函数,直接进依赖数组会让 effect 每次渲染重建、
 * 定时器被反复清掉重设 —— 那样在快节奏渲染下可能一次都轮不到。
 */
export function useBackgroundTasks(
  list: (limit: number) => Promise<{ tasks?: DurableTaskView[]; enabled?: boolean }>,
  onFinished: (tasks: DurableTaskView[]) => void,
  /** 轮询间隔(毫秒),按活跃数决定。仅测试覆写 —— 否则每条用例都要真等 15s。 */
  intervalFor: (active: number) => number = pollIntervalMs,
): number {
  const [active, setActive] = useState(0)
  const watchRef = useRef<WatchState>(initialWatchState())
  const finishedRef = useRef(onFinished)
  finishedRef.current = onFinished

  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const tick = async (): Promise<void> => {
      let tasks: DurableTaskView[] | null = null
      try {
        const r = await list(30)
        // enabled:false = 这次读不到(会话未建立 / 该形态不支持后台任务),与抛错同等对待。
        // 不能当成空列表 —— 见下面 tasks===null 分支的理由。
        if (('enabled' in r ? r.enabled : true) !== false) tasks = r.tasks ?? []
      } catch {
        // 后端没起来:静默退避,别把错误糊到对话里
      }
      if (stopped) return
      if (tasks === null) {
        // 拉取失败**不能**当成"目前没有任务":那会把 seeded 置位并把 settled 播种成空,
        // 下一次成功拉取时所有历史完成项都成了"新完成",一次性灌满对话。
        // 什么都不改,等下一拍重试(此时 active 也维持原值,不闪回 0)。
        timer = setTimeout(() => void tick(), intervalFor(0))
        return
      }
      const step = stepWatch(watchRef.current, tasks)
      watchRef.current = step.next
      setActive(step.active)
      if (step.finished.length > 0) finishedRef.current(step.finished)
      timer = setTimeout(() => void tick(), intervalFor(step.active))
    }

    void tick()
    return () => { stopped = true; if (timer) clearTimeout(timer) }
  }, [list, intervalFor])

  return active
}
