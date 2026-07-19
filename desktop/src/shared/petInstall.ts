/**
 * petInstall(shared,纯函数)——应用内 `npx petdex@latest install <名>` 的两块无副作用逻辑:
 * 名字白名单校验、npx 可执行路径解析。放 shared 是因为渲染层要用同一个 isValidPetName
 * 做按钮禁用/即时反馈,主进程要用它做执行前的真正闸门——两处共用一份,绝不各写一套正则漂移。
 * 真正 spawn 子进程的副作用在 main/petInstall.ts。
 */

/** 宠物名白名单:小写字母/数字/连字符,首字符须字母数字,长度 1–64。
 * 这是执行外部命令前的第一道闸——只有过闸的名字才会作为 spawn 的定长参数传入,
 * 配合 shell:false + 固定命令模板,杜绝命令注入。 */
export function isValidPetName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(name)
}

/**
 * 从用户输入里抽出宠物名:既接受直接输入的名字(`boxcat`),也接受整条命令
 * (`npx petdex@latest install boxcat`、`petdex install my-pet --force`)——取最后一个
 * `install` token 之后的第一个 token 作为名字;没有 `install` 就把整串(trim 后)当名字。
 * 只负责"取名",合法性仍由 isValidPetName 单独把关(取出的名字照样要过白名单才会执行)。
 */
export function extractPetName(input: string): string {
  const trimmed = input.trim()
  const tokens = trimmed.split(/\s+/)
  const idx = tokens.lastIndexOf('install')
  if (idx >= 0 && idx < tokens.length - 1) return tokens[idx + 1]!
  return trimmed
}

// npm/npx 进度输出的转义:`\x1B[<n>G`(光标移到第 n 列,常见 1G)当作回车原地重绘;
// 其余 CSI(清行/清屏/颜色/光标移动)、OSC(窗口标题)、单字符转义一律删除。
const CURSOR_COL_RE = /\x1B\[[0-9]*G/g
const CSI_RE = /\x1B\[[0-?]*[ -/]*[@-~]/g
const OSC_RE = /\x1B\][^\x07]*(?:\x07|\x1B\\)/g
const ESC_RE = /\x1B[@-Z\\-_]/g

/**
 * 把子进程原始输出清成可读日志:npm 用 `\x1B[1G` + 清行转义在同一行反复重绘进度,
 * 直接累积会刷出满屏 "Downloading scoop..[1G[J..." 噪声。这里先把光标归位转义归一成 \r,
 * 删掉其余转义,再按行处理 \r(取每行最后一个 \r 之后的内容 = 该行最终态),折叠空行。
 */
export function cleanInstallLog(raw: string): string {
  const normalized = raw
    .replace(CURSOR_COL_RE, '\r')
    .replace(CSI_RE, '')
    .replace(OSC_RE, '')
    .replace(ESC_RE, '')
  return normalized
    .split('\n')
    .map((line) => { const i = line.lastIndexOf('\r'); return i >= 0 ? line.slice(i + 1) : line })
    .join('\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * npx 候选搜索目录:GUI 应用不继承登录 shell 的 PATH(macOS 尤甚),只靠 process.env.PATH
 * 常常找不到 node/npx。这里在 PATH 之外补一批常见的 Node 安装目录(homebrew/系统/volta/nvm/…)。
 * PATH 内目录优先(保序),再接常见目录,最后整体去重。纯函数,homedir/pathEnv 由调用方注入。
 */
export function npxSearchDirs(pathEnv: string | undefined, homedir: string): string[] {
  const fromPath = (pathEnv ?? '').split(':').filter(Boolean)
  const common = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    `${homedir}/.volta/bin`,
    `${homedir}/.nvm/current/bin`,
    `${homedir}/.local/bin`,
    `${homedir}/n/bin`,
  ]
  return [...new Set([...fromPath, ...common])]
}

/**
 * 在候选目录里找到第一个真实存在的 npx 绝对路径;都没有返回 null(→ 调用方明确报错,不静默失败)。
 * 只拼 `${dir}/npx`(本项目 macOS-only,不处理 .cmd);existsFn 注入便于单测,生产传 fs.existsSync。
 */
export function resolveNpx(dirs: string[], existsFn: (p: string) => boolean): string | null {
  for (const dir of dirs) {
    const candidate = `${dir}/npx`
    if (existsFn(candidate)) return candidate
  }
  return null
}
