import { useEffect, useRef } from 'react'

/**
 * turnRef 同步 hook:让 turnRef.current 与 state.turn 保持同步。
 *
 * 消除「dispatch(markStarted) → 组件重渲染」之间的闭包陈旧:
 * markStarted 已在提交瞬间置 running,但用旧 state.turn 闭包的回调
 * 直到下次重渲染前读到的仍是 'idle',守卫会漏放行;改读 ref 即时可见。
 */
export function useTurnSyncRef(turn: 'idle' | 'running') {
  const turnRef = useRef(turn)
  useEffect(() => {
    turnRef.current = turn
  }, [turn])
  return turnRef
}
