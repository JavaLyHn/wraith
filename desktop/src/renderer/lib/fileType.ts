/** 产物文件的类型标签(按扩展名):`<类别> · <EXT>`;无扩展名 → `文件`。纯函数。 */
const CATEGORY: Record<string, string> = {
  md: '文档', markdown: '文档', txt: '文档', rst: '文档', adoc: '文档',
  ts: '代码', tsx: '代码', js: '代码', jsx: '代码', mjs: '代码', cjs: '代码',
  py: '代码', java: '代码', go: '代码', rs: '代码', c: '代码', cc: '代码', cpp: '代码',
  h: '代码', hpp: '代码', sh: '代码', rb: '代码', php: '代码', swift: '代码', kt: '代码', sql: '代码',
  json: '配置', yaml: '配置', yml: '配置', toml: '配置', ini: '配置', xml: '配置', env: '配置',
  css: '样式', scss: '样式', less: '样式',
}

export function fileTypeLabel(path: string): string {
  const base = path.split('/').pop() ?? path
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return '文件' // 无扩展名 或 dotfile(.env 等)
  const ext = base.slice(dot + 1)
  const cat = CATEGORY[ext.toLowerCase()] ?? '文件'
  return `${cat} · ${ext.toUpperCase()}`
}
