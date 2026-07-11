import { useCallback, useEffect, useState } from 'react'
import { History, RotateCcw, RefreshCw, Trash2 } from 'lucide-react'
import type { SnapshotEntryView } from '../../shared/types'
import { phaseLabel, phaseMeaning, modeLabel, absTime } from '../lib/snapshotView'

export default function SnapshotPanel({ onBack }: { onBack: () => void }): JSX.Element {
  const [snapshots, setSnapshots] = useState<SnapshotEntryView[]>([])
  const [enabled, setEnabled] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await window.wraith.snapshotList()
      setSnapshots(r.snapshots); setEnabled(r.enabled); setError(null)
    } catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  const doRestore = useCallback(async (e: SnapshotEntryView): Promise<void> => {
    if (e.preTurnOffset <= 0) return
    const ok = window.confirm(
      `恢复工作区到这个快照?\n\n${e.summary || e.shortId}\n\n` +
      `⚠️ 会用该快照的文件覆盖当前工作区(可能删改文件)。\n恢复前系统会自动存一个「恢复前」快照,可再恢复回来。`,
    )
    if (!ok) return
    setBusy(true); setNotice(null)
    try {
      const r = await window.wraith.snapshotRestore(e.preTurnOffset)
      setNotice(r.ok ? `✅ ${r.message}(写回 ${r.restoredCount} · 删除 ${r.removedCount})` : `❌ ${r.message}`)
      await load()
    } catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }, [load])

  const doClean = useCallback(async (): Promise<void> => {
    if (!window.confirm('清理旧快照?会删除超出上限的历史快照(不影响当前工作区文件)。')) return
    setBusy(true); setNotice(null)
    try {
      const r = await window.wraith.snapshotClean()
      setNotice(r.ok ? ('✅ ' + (r.message || '已清理')) : ('❌ ' + (r.message || '清理失败')))
      await load()
    } catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }, [load])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button data-testid="snapshot-back" onClick={onBack}
          className="rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-surface/60">← 返回对话</button>
        <span className="flex items-center gap-2 text-sm font-bold text-fg">
          <History className="h-4 w-4 shrink-0" strokeWidth={1.5} />快照时间线
        </span>
        <span className="ml-auto flex items-center gap-2 text-xs text-fg-subtle">
          {enabled ? `共 ${snapshots.length} 个` : '快照未启用'}
          <button onClick={() => void load()} title="刷新" className="rounded p-1 hover:bg-surface hover:text-fg">
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
          <button data-testid="snapshot-clean" onClick={() => void doClean()} disabled={busy} title="清理旧快照"
            className="rounded p-1 hover:bg-surface hover:text-danger disabled:opacity-40">
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        </span>
      </div>

      <div className="shrink-0 border-b border-border px-4 py-2 text-3xs leading-relaxed text-fg-subtle">
        每轮对话前后自动存下的「工作区存档」。点某个<span className="text-accent">轮前</span>存档的「恢复到此」,可把项目文件回滚到那一刻(与你项目的 git 相互独立、不受影响)。
      </div>

      {error && <div className="shrink-0 px-4 py-2 text-xs text-danger">出错:{error}</div>}
      {notice && <div className="shrink-0 px-4 py-2 text-xs text-fg">{notice}</div>}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {busy && snapshots.length === 0 ? (
          <div className="text-xs text-fg-subtle">加载中…</div>
        ) : snapshots.length === 0 ? (
          <div className="text-xs text-fg-subtle">暂无快照。跑过对话后,每轮开始前会自动存一个可恢复的快照。</div>
        ) : (
          <div className="flex flex-col">
            {snapshots.map((s) => (
              <div key={s.commitId} className="flex items-center gap-3 border-b border-border/60 py-2.5">
                <span className={'shrink-0 rounded px-1.5 py-0.5 text-3xs ' +
                  (s.phase === 'PRE_TURN' ? 'bg-accent/12 text-accent' : s.phase === 'PRE_RESTORE' ? 'bg-danger/10 text-danger' : 'bg-surface text-fg-muted')}>{phaseLabel(s.phase)}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs text-fg">{phaseMeaning(s.phase)}</div>
                  <div className="mt-0.5 truncate text-3xs text-fg-subtle">{absTime(s.createdAtMs)} · {modeLabel(s.turnId)}</div>
                </div>
                {s.preTurnOffset > 0 && (
                  <button onClick={() => void doRestore(s)} disabled={busy} title="把工作区恢复到这个存档"
                    className="flex shrink-0 items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-fg-muted hover:border-accent hover:text-accent disabled:opacity-40">
                    <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} />恢复到此
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
