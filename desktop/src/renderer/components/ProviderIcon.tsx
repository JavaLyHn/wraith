/**
 * ProviderIcon — renders each provider's brand logo via @lobehub/icons.
 *
 * Import strategy: we use deep component-level imports
 * (e.g. `@lobehub/icons/es/OpenAI/components/Mono`) to avoid pulling in
 * `Avatar` → `features/IconAvatar` → `@lobehub/ui` (not installed).
 * We prefer the `Color` variant when it exists, otherwise fall back to `Mono`.
 *
 * Pinned to @lobehub/icons@5.10.1 internal es/<Brand>/components/{Mono,Color} layout (not public API);
 * upgrading requires re-verifying these paths.
 */
import React from 'react'
// — Mono-only icons (no Color component) —
import OpenAIMono from '@lobehub/icons/es/OpenAI/components/Mono'
import AnthropicMono from '@lobehub/icons/es/Anthropic/components/Mono'
import GrokMono from '@lobehub/icons/es/Grok/components/Mono'
import GroqMono from '@lobehub/icons/es/Groq/components/Mono'
import OpenRouterMono from '@lobehub/icons/es/OpenRouter/components/Mono'
import MoonshotMono from '@lobehub/icons/es/Moonshot/components/Mono'
// — Color-capable icons: use their Color component —
import DeepSeekColor from '@lobehub/icons/es/DeepSeek/components/Color'
import GeminiColor from '@lobehub/icons/es/Gemini/components/Color'
import MistralColor from '@lobehub/icons/es/Mistral/components/Color'
import PerplexityColor from '@lobehub/icons/es/Perplexity/components/Color'
import TogetherColor from '@lobehub/icons/es/Together/components/Color'
import FireworksColor from '@lobehub/icons/es/Fireworks/components/Color'
import ZhipuColor from '@lobehub/icons/es/Zhipu/components/Color'
import QwenColor from '@lobehub/icons/es/Qwen/components/Color'
import MinimaxColor from '@lobehub/icons/es/Minimax/components/Color'
import HunyuanColor from '@lobehub/icons/es/Hunyuan/components/Color'
import BaichuanColor from '@lobehub/icons/es/Baichuan/components/Color'
import WenxinColor from '@lobehub/icons/es/Wenxin/components/Color'
import StepfunColor from '@lobehub/icons/es/Stepfun/components/Color'
import SiliconCloudColor from '@lobehub/icons/es/SiliconCloud/components/Color'
import VolcengineColor from '@lobehub/icons/es/Volcengine/components/Color'
import ModelScopeColor from '@lobehub/icons/es/ModelScope/components/Color'
import { findCatalogEntry } from '../../shared/providerCatalog'

type LobeIconComp = React.ComponentType<{ size?: number | string }>

// Static lookup map — keys match the `lobeIcon` values in providerCatalog.ts exactly.
// One component per provider; Color variant preferred where available.
const LOBE_ICONS: Record<string, LobeIconComp> = {
  OpenAI: OpenAIMono as unknown as LobeIconComp,
  Anthropic: AnthropicMono as unknown as LobeIconComp,
  DeepSeek: DeepSeekColor as unknown as LobeIconComp,
  Gemini: GeminiColor as unknown as LobeIconComp,
  Grok: GrokMono as unknown as LobeIconComp,
  Mistral: MistralColor as unknown as LobeIconComp,
  Groq: GroqMono as unknown as LobeIconComp,
  Perplexity: PerplexityColor as unknown as LobeIconComp,
  Together: TogetherColor as unknown as LobeIconComp,
  Fireworks: FireworksColor as unknown as LobeIconComp,
  OpenRouter: OpenRouterMono as unknown as LobeIconComp,
  Zhipu: ZhipuColor as unknown as LobeIconComp,
  Moonshot: MoonshotMono as unknown as LobeIconComp,
  Qwen: QwenColor as unknown as LobeIconComp,
  Minimax: MinimaxColor as unknown as LobeIconComp,
  Hunyuan: HunyuanColor as unknown as LobeIconComp,
  Baichuan: BaichuanColor as unknown as LobeIconComp,
  Wenxin: WenxinColor as unknown as LobeIconComp,
  Stepfun: StepfunColor as unknown as LobeIconComp,
  SiliconCloud: SiliconCloudColor as unknown as LobeIconComp,
  Volcengine: VolcengineColor as unknown as LobeIconComp,
  ModelScope: ModelScopeColor as unknown as LobeIconComp,
}

export type IconKind = { kind: 'lobe'; name: string } | { kind: 'fallback'; letter: string }

/**
 * 决定用 lobehub 图标还是回落首字母(纯函数,可测)。
 * - 如果 catalog 有 lobeIcon 且在 LOBE_ICONS 映射中 → lobe
 * - 否则 → fallback,letter 取 displayName/id 的第一个 Unicode 字符
 */
export function resolveIconKind(id: string): IconKind {
  const e = findCatalogEntry(id)
  if (e?.lobeIcon && e.lobeIcon in LOBE_ICONS) {
    return { kind: 'lobe', name: e.lobeIcon }
  }
  const label = e?.displayName ?? id
  return { kind: 'fallback', letter: [...label][0] ?? '?' }
}

/**
 * Renders the provider's brand icon (via @lobehub/icons) or a rounded letter badge.
 * Color variant is already baked into LOBE_ICONS where available.
 */
export default function ProviderIcon({
  id,
  size = 20,
}: {
  id: string
  size?: number
}): React.JSX.Element {
  const k = resolveIconKind(id)

  if (k.kind === 'lobe') {
    const Comp = LOBE_ICONS[k.name]
    if (Comp) {
      return <Comp size={size} />
    }
  }

  // Fallback: colored letter badge
  const letter =
    k.kind === 'fallback'
      ? k.letter
      : ([...(findCatalogEntry(id)?.displayName ?? id)][0] ?? '?')

  return (
    <span
      style={{ width: size, height: size }}
      className="inline-flex items-center justify-center rounded-full bg-surface text-[10px] text-fg-muted"
    >
      {letter}
    </span>
  )
}
