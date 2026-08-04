/**
 * 配置目录在**界面文案**里的写法（分平台）。
 *
 * 路径实现一直是对的（后端走 `user.home` + `Path.of`，Windows 上是
 * `C:\Users\<名>\.wraith`）。错的是写法：面板上写着「把 SKILL.md 放到
 * `~/.wraith/skills/<名>/`」，而 Windows 用户既没有 `~` 可点，`cmd.exe` 也不展开它。
 *
 * Java 侧的同名职责在 `com.lyhn.wraith.config.ConfigPathDisplay`（prompt 与 CLI 提示用）；
 * 这里是渲染层的那一份 —— 两边不共享代码，但**结论必须一致**，各自有测试钉住。
 *
 * 想显示真实绝对路径时不要用这里的简写：`window.wraith.appInfo().dataDir` 有确切值
 * （「我」页面的数据目录一行就是那么来的）。
 */

/** `window.wraith.platform` 的取值（'darwin' | 'win32' | 'linux' | …）。 */
export function configHomeLabel(platform: string | undefined): string {
  return platform === 'win32' ? '%USERPROFILE%\\.wraith' : '~/.wraith'
}

export function configPathLabel(platform: string | undefined, ...segments: string[]): string {
  const sep = platform === 'win32' ? '\\' : '/'
  return [configHomeLabel(platform), ...segments.filter(s => s && s.length > 0)].join(sep)
}
