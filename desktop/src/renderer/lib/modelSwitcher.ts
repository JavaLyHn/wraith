import type { ProviderView } from '../../shared/types'

/**
 * 模型选择下拉框只展示【已配置(hasKey)】的 provider。
 * model.list 会回报 KNOWN_PROVIDERS ∪ 已配置(供 Provider 配置面板枚举),
 * 但对话界面的切换下拉框不应列出未配置的旧 provider。
 */
export function configuredProviders(providers: ProviderView[]): ProviderView[] {
  return providers.filter(p => p.hasKey)
}
