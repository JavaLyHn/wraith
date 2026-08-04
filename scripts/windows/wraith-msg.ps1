# wraith-msg.ps1 —— Windows 短命令的中文文案。
#
# 为什么文案不能留在 wraith.cmd 里:cmd.exe 按 **OEM 码页**(中文 Windows = GBK/936)
# **逐字节**解析批处理文件,并且对 DBCS 用的是「见到 lead byte 就盲目前进 2 字节」。
# UTF-8 的中文是三字节,被错拆成 GBK 序列后行尾常剩下一个孤立 lead byte(0x81–0xFE),
# 它会把**紧随其后的那一个字节吞掉** —— 而可被吞的范围里有两个要命的东西:
#   0x0A(换行) → 相邻两行被并成一条命令
#   0x5E(^,批处理转义符) → ^( 变成裸 ( ,括号块提前闭合或永不闭合
#
# 实测(字节级模拟):
#   wraith-install.cmd 物理 6 行 → cmd 眼里 4 行,`powershell -File wraith-install.ps1`
#     **整行被并进上一条 rem 注释** → 安装静默空转,退出码还是 0,jar 从没被构建过
#   wraith.cmd 物理 72 行 → cmd 眼里 66 行,另有 42 个 ASCII 字节被吞(含 ^ 转义符)
#
# .ps1 没有这个问题 —— 前提是**带 UTF-8 BOM**,否则 Windows PowerShell 5.1 同样按
# GBK 解码(见 PowerShellBomTest,那次被吞的是花括号)。
#
# 约束由 WindowsLauncherScriptTest 钉住:.cmd 必须纯 ASCII + CRLF,
# 且这里必须处理 wraith.cmd 会传过来的每一个话题。
param(
  [Parameter(Position = 0)][string]$Topic = 'usage',
  [Parameter(Position = 1)][string]$Arg = ''
)

# 用 Write-Output 而不是 Write-Host:调用方会做 `1>&2` 把提示送到 stderr,
# 而 Write-Host 写的是 host 而非 stdout,重定向抓不到它。
function Write-Usage {
  Write-Output 'wraith —— 终端 CLI 与桌面端的统一入口'
  Write-Output ''
  Write-Output '  wraith                    开终端 CLI(交互式对话)'
  Write-Output '  wraith -c | --continue    接着上一次会话'
  Write-Output '  wraith -r | --resume [id] 恢复历史会话(不给 id 则列出来挑)'
  Write-Output '  wraith -d | --desktop     开桌面端 dev'
  Write-Output '  wraith -h | --help        这份用法'
  Write-Output ''
  Write-Output '  wraith sandbox doctor     沙箱体检(四条探针)'
  Write-Output '  wraith gateway bind <平台>   绑定 IM 账号'
  Write-Output '  wraith app-server         桌面端用的 JSON-RPC 后端(一般不用手敲)'
  Write-Output ''
  Write-Output '  wraith-install            改完 Java 后端后重新构建装 jar'
  Write-Output ''
  Write-Output '注意:终端 CLI **不套命令沙箱**(只有桌面/IM 网关/定时任务套),'
  Write-Output '      但命令黑名单与 HITL 审批照常生效。详见 docs\windows-usage.md 第 8 节。'
}

switch ($Topic) {
  'nojar' {
    Write-Output "wraith: 还没安装 jar: $Arg"
    Write-Output '  跑一次 wraith-install 即可(它会构建后端并装到上面这个位置)'
    Write-Output '  若连 wraith-install 都找不到,说明短命令没装全,在仓库根跑:'
    Write-Output '    powershell -ExecutionPolicy Bypass -File scripts\windows\wraith-install.ps1'
    break
  }
  'nodesktop' {
    Write-Output "wraith: 在 $Arg 下找不到 desktop\package.json"
    Write-Output '  若本文件被复制到了仓库外,请设环境变量 WRAITH_REPO 指向仓库根'
    break
  }
  'usage' {
    Write-Usage
    break
  }
  default {
    Write-Usage
  }
}
