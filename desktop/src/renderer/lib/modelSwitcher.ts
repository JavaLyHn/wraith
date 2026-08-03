import { baseProviderId, findCatalogEntry, instanceDisplayName } from '../../shared/providerCatalog'
import type { ProviderView } from '../../shared/types'

/**
 * 模型选择下拉框只展示【已配置(hasKey)】的 provider。
 * model.list 的 providers 只报 config 里写下的 ∪ env 里发现的(由 ProviderResolver 判定),
 * 不再恒含硬编码的 6 家;但对话界面的切换下拉框仍不应列出未配置(无 key)的 provider。
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
