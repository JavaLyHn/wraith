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
 * 常常找不到 node/npx。这里在 PATH 之外补一批常见的 Node 安装目录。
 * PATH 内目录优先(保序),再接常见目录,最后整体去重。纯函数,平台/homedir/pathEnv 全部注入。
 *
 * <b>分隔符按平台</b>:Windows 的 PATH 用 `;`。此前这里写死 `split(':')` ——
 * 在 Windows 上不只是"切不开",`C:\...` 里的盘符冒号还会把每条路径再切成两半,
 * 结果是 PATH **完全没被读到**,于是「Node 明明装着却报未找到 npx」。
 */
export function npxSearchDirs(
  pathEnv: string | undefined,
  homedir: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const win = platform === 'win32'
  const sep = win ? ';' : ':'
  // Windows 的 PATH 条目常带尾部反斜杠(`C:\Program Files\nodejs\`),归一掉再拼文件名,
  // 否则会拼出 `C:\Program Files\nodejs\\npx.cmd`。
  const fromPath = (pathEnv ?? '')
    .split(sep)
    .map((d) => (win ? d.trim().replace(/[\\/]+$/, '') : d.trim()))
    .filter(Boolean)
  const common = win
    ? [
      `${process.env['ProgramFiles'] ?? 'C:\\Program Files'}\\nodejs`,
      `${process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'}\\nodejs`,
      `${homedir}\\AppData\\Roaming\\npm`,          // npm -g 的全局 bin
      `${homedir}\\AppData\\Local\\Volta\\bin`,
      `${homedir}\\AppData\\Roaming\\nvm`,           // nvm-windows 的 symlink 目录
      `${homedir}\\scoop\\shims`,
      `${homedir}\\.volta\\bin`,
    ]
    : [
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
 * Windows 上 npx 的候选文件名,按**能不能直接 spawn** 排序。
 *
 * `.exe`(volta / scoop 这类 shim)可以 `shell:false` 直起;`.cmd` / `.bat` 不行,
 * 得由 {@link npxSpawnArgs} 套一层 `cmd.exe /c`。所以 exe 优先 —— 少一层解析。
 *
 * **无扩展名的 `npx` 刻意不收**:npm 在 Windows 上确实会同时装一个无扩展名的
 * `npx`,但那是给 Git Bash 用的 sh 脚本,`CreateProcess` 起不了它
 * (会得到一个看不懂的"不是有效的 Win32 应用程序")。收了反而更难排查。
 */
const WIN_NPX_NAMES = ['npx.exe', 'npx.cmd', 'npx.bat']

/**
 * 在候选目录里找到第一个真实存在的 npx 绝对路径;都没有返回 null(→ 调用方明确报错,不静默失败)。
 * existsFn 注入便于单测,生产传 fs.existsSync。
 *
 * <b>文件名按平台</b>:Windows 上 npm 装出来的是 `npx.cmd`,没有可执行的无扩展名 `npx`。
 * 同一个缺陷在 Java 侧的 MCP stdio 通道修过一次(见 `StdioCommand` 的 PATH × PATHEXT 解析)——
 * 这里是它在桌面主进程里的第二份。
 */
export function resolveNpx(
  dirs: string[],
  existsFn: (p: string) => boolean,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const win = platform === 'win32'
  const names = win ? WIN_NPX_NAMES : ['npx']
  const slash = win ? '\\' : '/'
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = `${dir}${slash}${name}`
      if (existsFn(candidate)) return candidate
    }
  }
  return null
}

/**
 * 把「npx 路径 + 定长参数」翻译成真正能交给 `spawn(shell:false)` 的 (command, args)。
 *
 * <b>为什么需要这一层</b>:Node 18.20 / 20.12 起(CVE-2024-27980 的修复),
 * `shell:false` 直接 spawn `.cmd` / `.bat` 会抛 `EINVAL`。也就是说光把 `npx.cmd`
 * 找出来还不够 —— 找到了照样起不来,只是报错换了一句。
 *
 * <b>为什么不干脆 `shell:true`</b>:那会让整条命令重新过一遍 shell 解析,
 * 把本模块刻意维持的"固定模板 + 数组传参、零解析"边界拆掉。这里退一步:
 * 只在 `.cmd`/`.bat` 时显式套 `cmd.exe /c`,参数仍以数组传递。
 * 唯一的用户可控 token 是宠物名,已被 {@link isValidPetName} 钉死在
 * `[a-z0-9-]` —— 既没有 cmd 的元字符(`& | < > ^ "`),也没有 `%` 变量展开,
 * 多出的这层解析吃不到任何东西。
 */
export function npxSpawnArgs(
  npxPath: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
  comSpec: string | undefined = process.env['ComSpec'],
): { command: string; args: string[] } {
  const isBatch = platform === 'win32' && /\.(cmd|bat)$/i.test(npxPath)
  if (!isBatch) return { command: npxPath, args }
  const shell = comSpec && comSpec.trim() ? comSpec.trim() : 'cmd.exe'
  return { command: shell, args: ['/c', npxPath, ...args] }
}
