import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, History, RotateCcw, RefreshCw, Trash2, ToggleLeft, ToggleRight } from 'lucide-react'
import type { SnapshotEntryView, SnapshotSettingsView } from '../../shared/types'
import { phaseLabel, phaseMeaning, modeLabel, absTime, relativeTime, summaryInput } from '../lib/snapshotView'

/**
 * 快照总开关。
 *
 * <p><b>被环境变量压住时不许装作能改。</b> 取值链是
 * env → 系统属性 → config.json → 默认开，按钮写的是最后那层。
 * 所以 `locked` 时要把话说全：本次会话仍会切过去（运行期覆盖生效），
 * 但下次启动还是听那个环境变量的 —— 不说清的话用户下次会以为按钮坏了。
 */
function SnapshotToggle({ settings, busy, onToggle }: {
  settings: SnapshotSettingsView | null
  busy: boolean
  onToggle: () => void
}): JSX.Element {
  if (settings && !settings.available) {
    return <span data-testid="snapshot-toggle-unavailable" className="text-3xs text-fg-subtle">快照不可用</span>
  }
  const on = settings?.enabled ?? true
  const locked = Boolean(settings?.locked)
  const title = locked
    ? `快照${on ? '已开启' : '已关闭'}（当前由${settings?.source === 'env' ? '环境变量' : '启动参数'}决定）\n`
      + '点它会立刻对本次会话生效并写进配置，但下次启动仍以那个设置为准。'
    : `点一下${on ? '关闭' : '开启'}快照（写进配置，立即生效）`
  return (
    <button
      data-testid="snapshot-toggle"
      data-enabled={on ? 'true' : 'false'}
      data-locked={locked ? 'true' : 'false'}
      onClick={onToggle}
      disabled={busy || settings === null}
      title={title}
      className={'flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-3xs transition-colors disabled:opacity-40 '
        + (on ? 'border-ok/60 text-ok hover:bg-ok/10' : 'border-border text-fg-subtle hover:bg-surface')}>
      {on ? <ToggleRight className="h-3.5 w-3.5" strokeWidth={1.5} />
          : <ToggleLeft className="h-3.5 w-3.5" strokeWidth={1.5} />}
      {on ? '已开' : '已关'}
      {locked && <span data-testid="snapshot-toggle-locked" title={title}>*</span>}
    </button>
  )
}

export default function SnapshotPanel({ onBack }: { onBack: () => void }): JSX.Element {
  const [snapshots, setSnapshots] = useState<SnapshotEntryView[]>([])
  const [enabled, setEnabled] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const [settings, setSettings] = useState<SnapshotSettingsView | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await window.wraith.snapshotList()
      setSnapshots(r.snapshots); setEnabled(r.enabled); setError(null)
    } catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }, [])

  // 开关状态单独拉:它不属于「列表」,而且关掉之后列表是空的 ——
  // 若混在一起,关掉后就再也拉不到开关状态了。
  const loadSettings = useCallback(async (): Promise<void> => {
    try {
      setSettings(await window.wraith.snapshotSettings())
    } catch (err) {
      console.error('[wraith] snapshotSettings error:', err)
    }
  }, [])

  useEffect(() => { void load(); void loadSettings() }, [load, loadSettings])

  const toggleEnabled = useCallback(async (): Promise<void> => {
    const next = !(settings?.enabled ?? enabled)
    setBusy(true); setNotice(null)
    try {
      const r = await window.wraith.snapshotSetEnabled(next)
      if (r.ok) {
        setNotice((next ? '✅ 快照已开启' : '🛑 快照已关闭')
            + (r.warning ? `　⚠️ ${r.warning}` : '　（已记住，重启仍生效）'))
      } else {
        setNotice('❌ ' + (r.message ?? '切换失败'))
      }
      await loadSettings()
      await load()
    } catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }, [settings, enabled, load, loadSettings])

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
        <button data-testid="snapshot-back" onClick={onBack} title="返回对话"
          className="rounded-lg p-1.5 text-fg-muted hover:bg-surface hover:text-fg transition-colors"><ArrowLeft className="h-4 w-4" strokeWidth={1.5} /></button>
        <span className="flex items-center gap-2 text-sm font-bold text-fg">
          <History className="h-4 w-4 shrink-0" strokeWidth={1.5} />快照时间线
        </span>
        <span className="ml-auto flex items-center gap-2 text-xs text-fg-subtle">
          {enabled ? `共 ${snapshots.length} 个` : '快照未启用'}
          <SnapshotToggle settings={settings} busy={busy} onToggle={() => void toggleEnabled()} />
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
