import { useCallback, useEffect, useState } from 'react'
import { History, RotateCcw, RefreshCw, Trash2 } from 'lucide-react'
import type { SnapshotEntryView } from '../../shared/types'
import { phaseLabel, phaseMeaning, modeLabel, absTime, relativeTime, summaryInput } from '../lib/snapshotView'

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
    const input = summaryInput(e.summary)
    const ok = window.confirm(
      `把工作区恢复到这张「${phaseLabel(e.phase)}」存档(${absTime(e.createdAtMs)})?\n` +
      (input ? `当时的输入:${input}\n` : '') +
      `\n⚠️ 会用该存档的文件覆盖当前工作区(此后改动 / 新建的文件会丢失)。\n` +
      `恢复前会自动再存一张「恢复前」存档 —— 想撤销这次恢复,就回到那张即可。`,
    )
    if (!ok) return
    setBusy(true); setNotice(null)
    try {
      const r = await window.wraith.snapshotRestoreCommit(e.commitId)
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
        每轮对话(计划/团队模式)前后自动存下的「工作区存档」。任一条点「恢复到此」即把项目文件回滚到那一刻;恢复前会自动再存一张<span className="text-accent">恢复前</span>存档 —— 想撤销这次恢复,就回到那张。(与你项目的 git 相互独立、互不影响)
      </div>

      {error && <div className="shrink-0 px-4 py-2 text-xs text-danger">出错:{error}</div>}
      {notice && <div className="shrink-0 px-4 py-2 text-xs text-fg">{notice}</div>}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 panel-content">
        {busy && snapshots.length === 0 ? (
          <div className="text-xs text-fg-subtle">加载中…</div>
        ) : snapshots.length === 0 ? (
          <div className="text-xs text-fg-subtle">暂无快照。跑过对话后,每轮开始前会自动存一个可恢复的快照。</div>
        ) : (
          <div className="flex flex-col">
            {snapshots.map((s) => {
              const input = summaryInput(s.summary)
              return (
              <div key={s.commitId} className="flex items-start gap-3 border-b border-border/60 py-2.5">
                <span title={phaseMeaning(s.phase)}
                  className={'mt-0.5 shrink-0 cursor-default rounded px-1.5 py-0.5 text-3xs ' +
                  (s.phase === 'PRE_TURN' ? 'bg-accent/12 text-accent' : s.phase === 'PRE_RESTORE' ? 'bg-danger/10 text-danger' : 'bg-surface text-fg-muted')}>{phaseLabel(s.phase)}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-fg">
                    <span>{absTime(s.createdAtMs)}</span>
                    <span className="text-3xs text-fg-subtle">{relativeTime(s.createdAtMs)}</span>
                    <span className="text-3xs text-fg-subtle">· {modeLabel(s.turnId)}</span>
                    <span className="font-mono text-3xs text-fg-subtle" title={'快照 commit ' + s.commitId}>· {s.shortId}</span>
                  </div>
                  {input && (
                    <div className="mt-1 truncate text-3xs text-fg-muted" title={input}>「{input}」</div>
                  )}
                </div>
                <button onClick={() => void doRestore(s)} disabled={busy} title="把工作区恢复到这个存档"
                  className="mt-0.5 flex shrink-0 items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-fg-muted hover:border-accent hover:text-accent disabled:opacity-40">
                  <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} />恢复到此
                </button>
              </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
