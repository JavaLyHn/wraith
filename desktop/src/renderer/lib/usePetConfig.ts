import { useEffect, useState } from 'react'
import type { PetConfig } from '../../main/settings'

/**
 * usePetConfig — 桌宠配置的 IPC-backed hook。
 * 配置单一来源已迁到主进程(settings.json,见 main/settings.ts 的
 * readPetConfig/writePetConfig),renderer 不再持有第二份影子状态:
 * 挂载即拉一次 petGetConfig,随后订阅 onPetConfig(其它来源——包括桌宠窗自身
 * 的拖动/右键菜单——写回的广播)保持同步;setConfig 只发 patch,回填以
 * IPC 返回值为准(不本地乐观合并,避免与主进程 normalize 结果分叉)。
 */
export function usePetConfig(): { config: PetConfig | null; setConfig: (patch: Partial<PetConfig>) => void } {
  const [config, setState] = useState<PetConfig | null>(null)

  useEffect(() => {
    let alive = true
    void window.wraith.petGetConfig().then((c) => { if (alive) setState(c) })
    const off = window.wraith.onPetConfig((c) => setState(c))
    return () => { alive = false; off() }
  }, [])

  const setConfig = (patch: Partial<PetConfig>): void => {
    void window.wraith.petSetConfig(patch).then(setState)
  }

  return { config, setConfig }
}
