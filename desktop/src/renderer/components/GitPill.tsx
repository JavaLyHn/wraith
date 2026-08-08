import { useState } from 'react'
import { GitBranch, RefreshCw, Link2, FileDiff } from 'lucide-react'
import type { GitStatusView } from '../../shared/types'
import { gitPillView } from '../lib/gitPill'

/**
 * 顶栏常驻的只读 Git pill + 弹出层。
 *
 * **只读**：本组件不提供任何写仓库的动作。提交 / 推送 / 切分支 / 开 PR 都不在本期范围
 * （spec §9），因为写操作要过 HITL、处理鉴权与冲突，是另一个量级。
 */
export default function GitPill({ status, onRefresh }: {
  status: GitStatusView | null
  onRefresh: () => void
}): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const v = gitPillView(status)
  if (!v.visible || !status) return null

  const toggle = (): void => {
    const next = !open
    setOpen(next)
    // 打开时强刷:用户主动看的那一刻必须是新的
    if (next) onRefresh()
  }

  return (
    <div className="relative [-webkit-app-region:no-drag]">
      <button
        data-testid="git-pill"
        onClick={toggle}
        title={v.title}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-[10px] px-2 py-1 text-2xs text-fg-muted transition duration-150 hover:text-fg active:scale-95 motion-reduce:transform-none"
      >
        <GitBranch className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
        <span className="max-w-[168px] truncate">{v.branch}</span>
        {v.suffix && <span className="shrink-0 tabular-nums">{v.suffix}</span>}
      </button>

      {open && (
        <>
          {/* 点外面关掉。用一层透明覆盖而不是全局 mousedown 监听 —— 后者要手动
              判断点击是否落在弹出层内，容易漏掉 portal 之类的情况 */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            data-testid="git-pill-popover"
            className="absolute right-0 top-full z-50 mt-1 w-[340px] rounded-xl border border-border bg-surface p-3 shadow-lg"
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="flex-1 truncate text-xs font-bold text-fg">{status.name}</span>
              <button
                data-testid="git-pill-refresh"
                onClick={onRefresh}
                title="刷新"
                className="rounded-lg p-1 text-fg-muted hover:text-fg"
              >
                <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            </div>

            <div className="flex items-center gap-2 border-t border-border pt-2 text-2xs">
              <GitBranch className="h-3.5 w-3.5 shrink-0 text-fg-muted" strokeWidth={1.5} />
              <span className="flex-1 truncate text-fg">{status.branch}</span>
              {status.state === 'detached' && <span className="shrink-0 text-warn">游离</span>}
              {status.state === 'unborn' && <span className="shrink-0 text-warn">无提交</span>}
            </div>
            {status.upstream && (
              <div className="mt-0.5 pl-[22px] text-3xs text-fg-subtle">
                ↑ {status.ahead} ↓ {status.behind} · {status.upstream}
              </div>
            )}

            <div className="mt-2 flex items-center gap-2 border-t border-border pt-2 text-2xs">
              <FileDiff className="h-3.5 w-3.5 shrink-0 text-fg-muted" strokeWidth={1.5} />
              <span className="flex-1 text-fg">变更 {status.filesTotal} 个文件</span>
              <span className="shrink-0 tabular-nums">
                <span className="text-ok">+{status.insertions}</span>{' '}
                <span className="text-danger">−{status.deletions}</span>
              </span>
            </div>
            <div className="mt-1 pl-[22px]">
              {status.files.map(f => (
                <div key={f.path} data-testid="git-pill-file" className="flex gap-1.5 text-3xs">
                  <span className={'shrink-0 font-mono ' + (f.staged ? 'text-ok' : 'text-fg-subtle')}>{f.xy}</span>
                  <span className="truncate text-fg-muted">{f.path}</span>
                </div>
              ))}
              {status.filesTotal > status.files.length && (
                <div className="mt-0.5 text-3xs text-fg-subtle">
                  … 共 {status.filesTotal} 个，已显示前 {status.files.length} 个
                </div>
              )}
              {status.untracked > 0 && (
                <div className="mt-0.5 text-3xs text-fg-subtle">
                  另有 {status.untracked} 个未跟踪文件（git 不统计它们的行数）
                </div>
              )}
            </div>

            {status.remotes.length > 0 && (
              <div className="mt-2 border-t border-border pt-2">
                {status.remotes.map(r => (
                  <button
                    key={r.name}
                    data-testid="git-pill-remote"
                    onClick={() => void navigator.clipboard?.writeText(r.url)}
                    title="点击复制"
                    className="flex w-full items-center gap-2 text-left text-2xs text-fg-muted hover:text-fg"
                  >
                    <Link2 className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                    <span className="shrink-0">{r.name}</span>
                    <span className="truncate">{r.url}</span>
                  </button>
                ))}
              </div>
            )}

            {status.error && (
              <div data-testid="git-pill-stale" className="mt-2 rounded-lg bg-warn/10 px-2 py-1.5 text-3xs text-warn">
                本次刷新失败：{status.error}
                <br />上面显示的是上一次成功的数据。
              </div>
            )}

            {/* 这两行是需求的一部分,不是装饰。两者在用户眼里都叫「版本」,
                分不清会导致不可逆的误回滚(spec §7)。 */}
            <div className="mt-2 border-t border-border pt-2 text-3xs leading-relaxed text-fg-subtle">
              这里显示的是你的真实 <span className="font-mono">.git</span>（<b>只读</b>）。
              Agent 的逐轮留档在「快照」面板，两者互不影响。
            </div>
          </div>
        </>
      )}
    </div>
  )
}
