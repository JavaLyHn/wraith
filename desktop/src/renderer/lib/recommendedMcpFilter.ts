/**
 * 「推荐 MCP · 一键添加」里**已经装了的就别再推荐**。
 *
 * <p>用户实测：左栏已经有 `memory`(用户) 和 `playwright`(用户) 两个 server，
 * 而下面的推荐区仍然并列摆着 Memory 和 Playwright 的「＋ 添加」——
 * 点下去只会得到一个重名冲突。推荐区的语义是「你还可以加什么」，不是目录。
 *
 * <p><b>怎么算「已经装了」</b>：两条判据，命中任一即算。
 * <ol>
 *   <li><b>名字</b>对上 —— 一键添加会把 server 名预填成推荐项的 {@code id}，
 *       所以照默认流程装的必然名字相同。</li>
 *   <li><b>包名</b>对上 —— 用户手动装、或装完改了名时，名字这条就断了。
 *       所以再比命令参数里那个能唯一认出它的包名（去掉版本后缀）。</li>
 * </ol>
 *
 * <p><b>停用的也算已装</b>：它仍在配置里，重复添加照样撞名。推荐区不该把它当"缺"。
 */
import type { McpServerView } from '../../shared/types'
import { RECOMMENDED_MCP, type RecommendedMcp } from './pluginShowcase'

/**
 * 去掉版本后缀。
 *
 * <p>scoped 包（`@scope/name@1.2`）只能切**第二个** `@` —— 切第一个会把整个包名切光。
 * 这一条是为了让 `@playwright/mcp@latest`（推荐项写的）和 `@playwright/mcp`（用户手写的）
 * 认成同一个东西。
 */
export function stripVersionSuffix(spec: string): string {
  const s = spec.trim()
  const at = s.indexOf('@', s.startsWith('@') ? 1 : 0)
  return at > 0 ? s.slice(0, at) : s
}

/**
 * 推荐项的「指纹」：命令参数里第一个真实包名；认不出返回 null。
 *
 * <p>跳过两类参数：`-y` / `--repository` 这类<b>开关</b>，
 * 和 `<仓库路径>` 这类<b>占位符</b>（占位符是给用户替换的，拿它比对只会误判）。
 */
export function recommendedPackageId(m: RecommendedMcp): string | null {
  for (const raw of m.args ?? []) {
    const a = raw.trim()
    if (!a || a.startsWith('-') || a.startsWith('<')) continue
    return stripVersionSuffix(a)
  }
  return null
}

/** 这个推荐项是不是已经装过了。 */
export function isRecommendationAdded(m: RecommendedMcp, servers: McpServerView[]): boolean {
  const pkg = recommendedPackageId(m)
  const wantedName = m.id.trim().toLowerCase()
  return (servers ?? []).some(s => {
    if ((s.name ?? '').trim().toLowerCase() === wantedName) {
      return true
    }
    if (!pkg) {
      return false
    }
    return (s.args ?? []).some(a => {
      const arg = (a ?? '').trim()
      // 占位符不参与比对:用户真的把 <仓库路径> 留在那儿时不该被当成包名
      return arg !== '' && !arg.startsWith('<') && stripVersionSuffix(arg) === pkg
    })
  })
}

/** 还没装的推荐项 —— 推荐区只渲染这些。 */
export function unaddedRecommendations(servers: McpServerView[]): RecommendedMcp[] {
  return RECOMMENDED_MCP.filter(m => !isRecommendationAdded(m, servers))
}
