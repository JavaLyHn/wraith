/**
 * PROVIDER_CATALOG — Wraith LLM Provider Registry
 *
 * Data sourced from liliMozi/openhanako (defaultBaseUrl, defaultApi, displayName)
 * and openhanako lib/default-models.json (suggestedModels).
 *
 * Rules:
 * - zhipu/zhipu-coding → folded into `glm` entry (alias: 'zhipu')
 * - moonshot entry carries alias 'kimi'; stepfun entry carries alias 'step'
 * - minimax-token-plan / mimo-token-plan are NOT separate entries (same models as minimax/mimo)
 * - custom is NOT in this catalog (rendered separately in ProvidersPanel)
 * - freellmapi + xfyun are Wraith-only builtins
 * - gemini uses google-generative-ai API → mapped to protocol 'openai' (not anthropic)
 */

export interface ProviderCatalogEntry {
  id: string
  displayName: string
  protocol: 'openai' | 'anthropic'
  defaultBaseUrl: string
  suggestedModels: string[]
  consoleUrl?: string
  aliases?: string[]
  builtin?: boolean
  repeatable?: boolean
  lobeIcon?: string
  codingPlan?: boolean
}

export const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  // ── Major international providers ────────────────────────────────────────
  {
    id: 'openai',
    displayName: 'OpenAI',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.openai.com/v1',
    suggestedModels: ['gpt-4.1', 'gpt-4o', 'o3', 'o4-mini'],
    consoleUrl: 'https://platform.openai.com/api-keys',
    lobeIcon: 'OpenAI',
  },
  {
    id: 'anthropic',
    displayName: 'Anthropic',
    protocol: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com',
    suggestedModels: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-sonnet-4-5'],
    consoleUrl: 'https://console.anthropic.com',
    lobeIcon: 'Anthropic',
  },
  {
    id: 'deepseek',
    displayName: 'DeepSeek',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.deepseek.com',
    suggestedModels: ['deepseek-v4-pro', 'deepseek-v4-flash'],
    consoleUrl: 'https://platform.deepseek.com',
    lobeIcon: 'DeepSeek',
  },
  {
    id: 'gemini',
    displayName: 'Google Gemini',
    protocol: 'openai',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    suggestedModels: ['gemini-3-pro-preview', 'gemini-3-flash-preview'],
    consoleUrl: 'https://aistudio.google.com/apikey',
    lobeIcon: 'Gemini',
  },
  {
    id: 'xai',
    displayName: 'xAI (Grok)',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.x.ai/v1',
    suggestedModels: ['grok-4-1-fast-reasoning', 'grok-4-1-fast-non-reasoning', 'grok-3-beta', 'grok-3-mini-beta'],
    consoleUrl: 'https://console.x.ai',
    lobeIcon: 'Grok',
  },
  {
    id: 'mistral',
    displayName: 'Mistral AI',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    suggestedModels: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest'],
    consoleUrl: 'https://console.mistral.ai',
    lobeIcon: 'Mistral',
  },
  {
    id: 'groq',
    displayName: 'Groq',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    suggestedModels: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
    consoleUrl: 'https://console.groq.com/keys',
    lobeIcon: 'Groq',
  },
  {
    id: 'perplexity',
    displayName: 'Perplexity',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.perplexity.ai',
    suggestedModels: ['sonar-pro', 'sonar'],
    consoleUrl: 'https://www.perplexity.ai/settings/api',
    lobeIcon: 'Perplexity',
  },
  {
    id: 'together',
    displayName: 'Together AI',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.together.xyz/v1',
    suggestedModels: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'deepseek-ai/DeepSeek-R1'],
    consoleUrl: 'https://api.together.ai',
    lobeIcon: 'Together',
  },
  {
    id: 'fireworks',
    displayName: 'Fireworks AI',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.fireworks.ai/inference/v1',
    suggestedModels: ['accounts/fireworks/models/llama-v3p3-70b-instruct', 'accounts/fireworks/models/deepseek-r1'],
    lobeIcon: 'Fireworks',
  },
  {
    id: 'openrouter',
    displayName: 'OpenRouter',
    protocol: 'openai',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    suggestedModels: ['openai/gpt-4o', 'anthropic/claude-opus-4'],
    consoleUrl: 'https://openrouter.ai/keys',
    lobeIcon: 'OpenRouter',
  },

  // ── Domestic China providers ──────────────────────────────────────────────
  {
    id: 'glm',
    displayName: '智谱 GLM',
    protocol: 'openai',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    suggestedModels: ['glm-5.2', 'glm-5.1', 'glm-5', 'glm-4-flash'],
    consoleUrl: 'https://open.bigmodel.cn',
    aliases: ['zhipu'],
    lobeIcon: 'Zhipu',
  },
  {
    id: 'moonshot',
    displayName: 'Moonshot (Kimi)',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    suggestedModels: ['moonshot-v1-128k', 'moonshot-v1-32k', 'moonshot-v1-8k'],
    consoleUrl: 'https://platform.moonshot.cn',
    aliases: ['kimi'],
    lobeIcon: 'Moonshot',
  },
  {
    id: 'dashscope',
    displayName: '阿里云百炼 (DashScope)',
    protocol: 'openai',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    suggestedModels: ['qwen3.6-plus', 'qwen3.6-flash', 'qwen3.5-max', 'qwen3-max'],
    lobeIcon: 'Qwen',
  },
  {
    id: 'minimax',
    displayName: 'MiniMax',
    protocol: 'anthropic',
    defaultBaseUrl: 'https://api.minimaxi.com/anthropic',
    suggestedModels: ['MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-M2.5', 'MiniMax-M2.1'],
    lobeIcon: 'Minimax',
  },
  {
    id: 'hunyuan',
    displayName: '腾讯混元',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    suggestedModels: ['hunyuan-turbos-latest', 'hunyuan-large-latest'],
    lobeIcon: 'Hunyuan',
  },
  {
    id: 'baichuan',
    displayName: '百川智能',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.baichuan-ai.com/v1',
    suggestedModels: ['Baichuan4-Turbo', 'Baichuan4-Air'],
    lobeIcon: 'Baichuan',
  },
  {
    id: 'baidu-cloud',
    displayName: '百度智能云 (文心)',
    protocol: 'openai',
    defaultBaseUrl: 'https://qianfan.baidubce.com/v2',
    suggestedModels: ['ernie-4.5-turbo-vl-32k', 'ernie-4.0-turbo-128k'],
    lobeIcon: 'Wenxin',
  },
  {
    id: 'stepfun',
    displayName: '阶跃星辰 (StepFun)',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.stepfun.com/v1',
    suggestedModels: ['step-2-16k', 'step-1-flash'],
    lobeIcon: 'Stepfun',
    aliases: ['step'],
  },
  {
    id: 'siliconflow',
    displayName: 'SiliconFlow (硅基流动)',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.siliconflow.cn/v1',
    suggestedModels: ['deepseek-ai/DeepSeek-V3-0324', 'Qwen/Qwen3-8B', 'Pro/deepseek-ai/DeepSeek-R1', 'THUDM/GLM-4-9B-0414'],
    lobeIcon: 'SiliconCloud',
  },
  {
    id: 'volcengine',
    displayName: '火山引擎 (豆包)',
    protocol: 'openai',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    suggestedModels: ['doubao-pro-4k', 'doubao-lite-4k'],
    lobeIcon: 'Volcengine',
  },
  {
    id: 'modelscope',
    displayName: '魔搭 (ModelScope)',
    protocol: 'openai',
    defaultBaseUrl: 'https://api-inference.modelscope.cn/v1',
    suggestedModels: ['Qwen/Qwen3-235B-A22B'],
    lobeIcon: 'ModelScope',
  },
  {
    id: 'infini',
    displayName: '无问芯穹 (Infini)',
    protocol: 'openai',
    defaultBaseUrl: 'https://cloud.infini-ai.com/maas/v1',
    suggestedModels: ['deepseek-r1', 'deepseek-v3-0324'],
    lobeIcon: 'Infinigence',
  },
  {
    id: 'mimo',
    displayName: 'Xiaomi (MiMo)',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.xiaomimimo.com/v1',
    suggestedModels: ['mimo-v2.5-pro', 'mimo-v2.5', 'mimo-v2-pro', 'mimo-v2-flash'],
    lobeIcon: 'XiaomiMiMo',
  },
  {
    id: 'agnes',
    displayName: 'Agnes AI',
    protocol: 'openai',
    defaultBaseUrl: 'https://apihub.agnes-ai.com/v1',
    suggestedModels: ['agnes-2.0-flash'],
  },

  // ── Coding-plan / specialized endpoints ──────────────────────────────────
  {
    id: 'dashscope-coding',
    displayName: '百炼 Coding Plan',
    protocol: 'openai',
    defaultBaseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
    suggestedModels: ['qwen3-coder-plus', 'qwen3-coder-next', 'qwen3-coder-flash'],
    lobeIcon: 'Qwen',
    codingPlan: true,
  },
  {
    id: 'zhipu-coding',
    displayName: '智谱 GLM Coding Plan',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.z.ai/api/coding/paas/v4',
    suggestedModels: ['glm-5.2', 'glm-5-turbo', 'glm-4.7', 'glm-4.5-air'],
    lobeIcon: 'Zhipu',
    codingPlan: true,
  },
  {
    id: 'kimi-coding',
    displayName: 'Kimi Coding Plan',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.kimi.com/coding/v1',
    suggestedModels: ['kimi-for-coding'],
    lobeIcon: 'Moonshot',
    codingPlan: true,
  },
  {
    id: 'volcengine-coding',
    displayName: '火山引擎 Coding Plan',
    protocol: 'openai',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
    suggestedModels: ['doubao-seed-code'],
    lobeIcon: 'Volcengine',
    codingPlan: true,
  },

  // ── Wraith-only builtins ──────────────────────────────────────────────────
  {
    id: 'freellmapi',
    displayName: 'FreeLLMAPI',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.free-llm.top/v1',
    suggestedModels: ['auto'],
    builtin: true,
    repeatable: true,
  },
  {
    id: 'xfyun',
    displayName: '讯飞 MaaS',
    protocol: 'openai',
    defaultBaseUrl: 'https://maas-api.cn-huabei-1.xf-yun.com/v1',
    suggestedModels: ['Qwen3.6-35B-A3B'],
    builtin: true,
    lobeIcon: 'Spark',
  },
]

// ── Lookup map (id + alias → entry) ──────────────────────────────────────────
const BY_KEY = new Map<string, ProviderCatalogEntry>()
for (const e of PROVIDER_CATALOG) {
  BY_KEY.set(e.id, e)
  for (const a of e.aliases ?? []) BY_KEY.set(a, e)
}

export function findCatalogEntry(idOrAlias: string): ProviderCatalogEntry | undefined {
  return BY_KEY.get(idOrAlias)
}

/** 去掉实例 id 末尾的 `-<数字>`(freellmapi-2 → freellmapi);非数字后缀(baidu-cloud)保持不变。 */
export function baseProviderId(id: string): string {
  return id.replace(/-\d+$/, '')
}

/** 为可重复 provider 铸造下一个实例 id:base 未占用→base;否则 base-N,N 从 2 起最小未占用。 */
export function nextInstanceId(baseId: string, configuredIds: Set<string>): string {
  if (!configuredIds.has(baseId)) return baseId
  let n = 2
  while (configuredIds.has(`${baseId}-${n}`)) n++
  return `${baseId}-${n}`
}

/** 实例显示名:label 优先 → `名称 · label`;否则 base → 名称、`-N` → `名称 #N`;entry 缺省回落 id。 */
export function instanceDisplayName(
  id: string,
  label: string | undefined,
  entry: ProviderCatalogEntry | undefined,
): string {
  const base = entry?.displayName ?? id
  if (label && label.trim()) return `${base} · ${label.trim()}`
  const m = id.match(/-(\d+)$/)
  return m ? `${base} #${m[1]}` : base
}

/** 编辑/新增表单的字段回填:已保存值优先,catalog 默认兜底(apiKey 从不回填,单独处理)。 */
export function prefillForm(
  saved: { model?: string; baseUrl?: string; protocol?: string; label?: string } | undefined,
  entry: ProviderCatalogEntry | undefined,
): { model: string; baseUrl: string; protocol: 'openai' | 'anthropic'; label: string } {
  return {
    model: saved?.model || entry?.suggestedModels[0] || '',
    baseUrl: saved?.baseUrl || entry?.defaultBaseUrl || '',
    protocol: (saved?.protocol as 'openai' | 'anthropic') || entry?.protocol || 'openai',
    label: saved?.label || '',
  }
}
