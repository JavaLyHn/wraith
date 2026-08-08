import type { GitStatusView } from '../shared/types'

export interface GitStatusRpcClient {
  request(method: string, params: object): Promise<unknown>
}

/**
 * 只请求固定的只读 RPC，并把 app-server 回包收窄成 renderer 需要的视图。
 * 不补默认值是刻意的：null、空列表和 error 都是状态，补值会把失败伪装成干净仓库。
 */
export async function requestGitStatus(client: GitStatusRpcClient): Promise<GitStatusView> {
  const status = await client.request('git.status', {}) as GitStatusView
  return {
    repo: status.repo,
    root: status.root,
    name: status.name,
    state: status.state,
    branch: status.branch,
    upstream: status.upstream,
    ahead: status.ahead,
    behind: status.behind,
    insertions: status.insertions,
    deletions: status.deletions,
    untracked: status.untracked,
    filesTotal: status.filesTotal,
    files: status.files,
    remotes: status.remotes,
    error: status.error,
  }
}
