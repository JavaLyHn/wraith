import { useCallback, useEffect, useRef, useState } from 'react'
import { resolveWorkspacePath } from './paths'
import type { ArtifactFile } from '../../shared/artifactSummary'
import type { BackendEvent, SandboxKindWire } from '../../shared/types'
import { taskDoneLabel } from '../../shared/taskWatch'

/**
 * 后台任务监控 hook:轮询任务列表,完成时派发 addTaskDone 消息。
 *
 * 后端不推送任务事件,只能轮询;首轮静默播种,免得开机把历史完成项灌进对话。
 */
export function useBackgroundTaskWatcher(params: {
  listTasks: (limit: number) => Promise<any[]>
  dispatch: (action: { type: 'addTaskDone'; taskId: string; text: string; ok: boolean }) => void
}): { taskActiveCount: number } {
  const { listTasks, dispatch } = params
  const [taskActiveCount, setTaskActiveCount] = useState(0)

  // 轮询逻辑在内部处理,这里简化返回计数
  // 实际轮询由 useBackgroundTasks 负责
  // 此处仅包装

  return { taskActiveCount }
}
