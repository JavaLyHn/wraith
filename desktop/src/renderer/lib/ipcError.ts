/**
 * ipcErrorText —— 把 `ipcRenderer.invoke` 抛出的异常还原成主进程说的那句人话。
 *
 * 主进程 handler 里 throw 的 Error 经 IPC 回到渲染层后,message 会被 Electron 套一层
 * `Error invoking remote method '<channel>': Error: ` 前缀。直接贴到 UI 上,用户看到的是
 *
 *   Error invoking remote method 'wraith:documents:open': Error: 文件已不存在
 *
 * 而设计里要的只有「文件已不存在」。凡是把主进程错误往界面上显示的地方,都该先过这里。
 *
 * 这段正则原先写死在 automationLabels.saveErrorText 内部(只有 AutomationForm 受益),
 * 「文档」面板 final review 发现同一退化在新面板的 list/open/reveal/remove 全线复现 ——
 * 于是抽成共享函数,saveErrorText 改为复用它,而不是各处再抄一份正则。
 *
 * fallback:主进程给的 message 为空时的兜底文案。不传则返回空串,由调用方自己判空
 * (saveErrorText 就靠这个区分「保存失败:<原因>」和「保存失败」两种输出)。
 */
export function ipcErrorText(err: unknown, fallback = ''): string {
  const raw = err instanceof Error ? err.message : String(err)
  const reason = raw.replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, '').trim()
  return reason || fallback
}
