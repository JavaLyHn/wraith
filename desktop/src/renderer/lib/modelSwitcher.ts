import { baseProviderId, findCatalogEntry, instanceDisplayName } from '../../shared/providerCatalog'
import type { ProviderView } from '../../shared/types'

/**
 * 模型选择下拉框只展示【已配置(hasKey)】的 provider。
 * model.list 会回报 KNOWN_PROVIDERS ∪ 已配置(供 Provider 配置面板枚举),
 * 但对话界面的切换下拉框不应列出未配置的旧 provider。
 */
export function configuredProviders(providers: ProviderView[]): ProviderView[] {
  return providers.filter(p => p.hasKey)
}

/**
 * 下拉框中一个 provider 的显示名:优先用户配置的备注名(如 `FreeLLMAPI · newapi`),
 * 否则回落 catalog 显示名 / 实例编号(`FreeLLMAPI` / `FreeLLMAPI #2`),而不是原始 id。
 * 实例 id(freellmapi-2)经 baseProviderId 解析到 catalog 条目。
 */
export function providerOptionLabel(p: ProviderView): string {
  return instanceDisplayName(p.name, p.label, findCatalogEntry(baseProviderId(p.name)))
}
