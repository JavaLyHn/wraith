<#
.SYNOPSIS
    把一条命令送进 Windows AppContainer 执行，作为 macOS Seatbelt 在 Windows 上的对等物。

.DESCRIPTION
    由 Java 侧 CommandSandbox 调起（见 AppContainerCommand）。本脚本负责：

      1. 确保 AppContainer profile 存在（断网 / 联网各一个，能力集创建时定死）
      2. 幂等地把工作区授权给该 profile 的 SID（.git 显式拒写，对齐 Seatbelt）
      3. 建一对 AppContainer 可访问的管道，CreateProcess 进 AppContainer
      4. 把子进程输出泵回自己的 stdout，透传退出码

    ── 为什么由 PowerShell 干这件事 ──
    AppContainer 的难点不是调 Win32，是 stdio。从 Java 走 JNA 的话要自建管道、
    把 HANDLE 循环 ReadFile 桥回 InputStream，ProcessBuilder 的流处理全部作废。
    而 PowerShell 自己的 stdout 就是 Java 给的管道，往下继承即可，Java 侧零改动。
    Win32 调用用 Add-Type 就地编译 C#，靠 Windows 自带的 .NET Framework 编译器，
    不需要 MSVC / node-gyp。

    ── 已知风险（作者无 Windows 机器，以下全部未经真机验证）──
    · 管道 DACL：AppContainer 令牌受限，默认 DACL 的匿名管道可能读写被拒。
      这里显式把 profile SID 加进 PipeSecurity。若失败症状是「命令跑了但零输出」。
    · CreateProcessAsUserW vs CreateProcessW：两条路都有人用，这里先试前者、
      失败退后者，并把实际生效的那条打到 -Diag 输出里。
    · 工具链可读性：Program Files / Windows 默认已对 ALL APPLICATION PACKAGES 开读+执行，
      但装在用户目录下的工具链（如 %APPDATA%\npm）不在此列，需手工授权。
    · TEMP：AppContainer 写不了用户的 %TEMP%，故这里改指到可写的沙箱专用临时目录。

.NOTES
    退出码：透传子进程退出码；本脚本自身失败用 >= 250 的码以便区分。
      250 = profile 创建/解析失败   251 = ACL 授权失败
      252 = 管道或进程创建失败      253 = 参数错误
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ProfileName,
    [Parameter(Mandatory = $true)][string]$Workspace,
    [string]$GitDir = '',
    [string]$CommandLine = '',
    # 只做环境自检、不执行命令(供 `wraith sandbox doctor` 调用)
    [switch]$Diag
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# 诊断信息一律走 stderr —— stdout 是命令输出,混进去会污染 agent 看到的结果
function Write-Diag([string]$msg) { [Console]::Error.WriteLine("[sandbox] $msg") }

# ---------------------------------------------------------------- Win32 互操作

Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class WraithAC
{
    [StructLayout(LayoutKind.Sequential)]
    public struct SID_AND_ATTRIBUTES { public IntPtr Sid; public uint Attributes; }

    [StructLayout(LayoutKind.Sequential)]
    public struct SECURITY_CAPABILITIES
    {
        public IntPtr AppContainerSid;
        public IntPtr Capabilities;
        public uint CapabilityCount;
        public uint Reserved;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct STARTUPINFO
    {
        public int cb;
        public IntPtr lpReserved, lpDesktop, lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }

    public const int  STARTF_USESTDHANDLES          = 0x00000100;
    public const uint EXTENDED_STARTUPINFO_PRESENT  = 0x00080000;
    public const uint CREATE_NO_WINDOW              = 0x08000000;
    public const uint CREATE_UNICODE_ENVIRONMENT    = 0x00000400;
    // PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES = ProcThreadAttributeValue(9, FALSE, TRUE, FALSE)
    public static readonly IntPtr PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES = (IntPtr)0x00020009;

    [DllImport("userenv.dll", CharSet = CharSet.Unicode)]
    public static extern int CreateAppContainerProfile(string name, string displayName, string description,
        SID_AND_ATTRIBUTES[] capabilities, int capabilityCount, out IntPtr sid);

    [DllImport("userenv.dll", CharSet = CharSet.Unicode)]
    public static extern int DeriveAppContainerSidFromAppContainerName(string name, out IntPtr sid);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool ConvertStringSidToSid(string stringSid, out IntPtr sid);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool ConvertSidToStringSid(IntPtr sid, out IntPtr stringSid);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute,
        IntPtr value, IntPtr size, IntPtr previous, IntPtr returnSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern void DeleteProcThreadAttributeList(IntPtr list);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CreateProcessAsUser(IntPtr token, string applicationName, string commandLine,
        IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint creationFlags,
        IntPtr environment, string currentDirectory, ref STARTUPINFOEX startupInfo,
        out PROCESS_INFORMATION processInformation);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CreateProcess(string applicationName, string commandLine,
        IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint creationFlags,
        IntPtr environment, string currentDirectory, ref STARTUPINFOEX startupInfo,
        out PROCESS_INFORMATION processInformation);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr CreateFile(string name, uint access, uint share, IntPtr security,
        uint creationDisposition, uint flags, IntPtr template);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool TerminateProcess(IntPtr handle, uint exitCode);
}
'@

# ---------------------------------------------------------------- profile / SID

# 能力 SID 在 profile 创建时定死,之后改不了 —— 所以断网/联网是两个 profile,
# 而不是一个 profile 运行时切能力。语义与 Seatbelt 的 (deny network*) 开关一致。
$CAP_INTERNET_CLIENT   = 'S-1-15-3-1'
$CAP_PRIVATE_NETWORK   = 'S-1-15-3-3'

function New-CapabilityArray([string[]]$sids) {
    if (-not $sids -or $sids.Count -eq 0) { return $null }
    $arr = New-Object 'WraithAC+SID_AND_ATTRIBUTES[]' $sids.Count
    for ($i = 0; $i -lt $sids.Count; $i++) {
        $p = [IntPtr]::Zero
        if (-not [WraithAC]::ConvertStringSidToSid($sids[$i], [ref]$p)) {
            throw "ConvertStringSidToSid 失败: $($sids[$i])"
        }
        $e = New-Object 'WraithAC+SID_AND_ATTRIBUTES'
        $e.Sid = $p
        $e.Attributes = 0x00000004  # SE_GROUP_ENABLED
        $arr[$i] = $e
    }
    return $arr
}

function Get-AppContainerSidString([string]$name, [string[]]$capabilities) {
    $caps = New-CapabilityArray $capabilities
    $count = 0; if ($caps) { $count = $caps.Count }
    $sidPtr = [IntPtr]::Zero

    $hr = [WraithAC]::CreateAppContainerProfile($name, $name, 'wraith command sandbox',
                                                $caps, $count, [ref]$sidPtr)
    # HRESULT_FROM_WIN32(ERROR_ALREADY_EXISTS) = 0x800700B7,profile 已在,拿它的 SID 即可。
    # 这里刻意写有符号的 -2147024713 而不是 [int]0x800700B7:
    # 0x800700B7 = 2147943607 超出 Int32 上界,`[int]` 转换会当场抛异常 —— 那样连比较都走不到。
    if ($hr -eq -2147024713) {
        $hr = [WraithAC]::DeriveAppContainerSidFromAppContainerName($name, [ref]$sidPtr)
    }
    if ($hr -ne 0) { throw ("CreateAppContainerProfile 失败, HRESULT=0x{0:X8}" -f $hr) }

    $strPtr = [IntPtr]::Zero
    if (-not [WraithAC]::ConvertSidToStringSid($sidPtr, [ref]$strPtr)) {
        throw 'ConvertSidToStringSid 失败'
    }
    return [Runtime.InteropServices.Marshal]::PtrToStringUni($strPtr)
}

# ---------------------------------------------------------------- ACL

function Grant-SandboxAcl([string]$sid, [string]$workspace, [string]$gitDir, [string]$sandboxTemp) {
    # 幂等标记:同一 (SID, 工作区) 只授权一次。否则每条命令都跑一遍 icacls,
    # 大仓库上光这一步就能拖垮体感。
    $marker = Join-Path $sandboxTemp ('acl-' + ([Math]::Abs(("$sid|$workspace").GetHashCode())) + '.ok')
    if (Test-Path -LiteralPath $marker) { return }

    # 刻意不加 /T:SetNamedSecurityInfo 对带继承标记的 ACE 本就会向下传播到既有子对象,
    # 而 /T 会强制逐个文件显式写一遍 —— 带 node_modules 的仓库上那是分钟级的开销。
    $out = & icacls $workspace /grant ("*${sid}:(OI)(CI)(M)") /C /Q 2>&1
    if ($LASTEXITCODE -ne 0) { throw "icacls 授权工作区失败: $out" }

    if ($gitDir -and (Test-Path -LiteralPath $gitDir)) {
        # .git 只读 —— 对齐 Seatbelt 的 (deny file-write* GIT_DIR)。
        # deny ACE 优先于 allow,且只作用于 AppContainer 的 SID,
        # 用户自己的进程不带这个 SID,不受影响。
        $out = & icacls $gitDir /deny ("*${sid}:(OI)(CI)(W)") /C /Q 2>&1
        if ($LASTEXITCODE -ne 0) { throw "icacls 保护 .git 失败: $out" }
    }

    $out = & icacls $sandboxTemp /grant ("*${sid}:(OI)(CI)(M)") /C /Q 2>&1
    if ($LASTEXITCODE -ne 0) { throw "icacls 授权临时目录失败: $out" }

    New-Item -ItemType File -Path $marker -Force | Out-Null
}

# ---------------------------------------------------------------- 主流程

$sandboxTemp = Join-Path $env:LOCALAPPDATA ("wraith\sandbox-temp\" + $ProfileName)
New-Item -ItemType Directory -Path $sandboxTemp -Force | Out-Null

try {
    $caps = @()
    if ($ProfileName -like '*-net') { $caps = @($CAP_INTERNET_CLIENT, $CAP_PRIVATE_NETWORK) }
    $sid = Get-AppContainerSidString $ProfileName $caps
} catch {
    Write-Diag "profile 失败: $_"
    exit 250
}

try {
    Grant-SandboxAcl $sid $Workspace $GitDir $sandboxTemp
} catch {
    Write-Diag "ACL 失败: $_"
    exit 251
}

if ($Diag) {
    # 自检模式:把关键事实打到 stdout 给 doctor 解析,不执行任何用户命令
    Write-Output "sid=$sid"
    Write-Output "profile=$ProfileName"
    Write-Output "network=$(if ($caps.Count -gt 0) { 'allowed' } else { 'denied' })"
    Write-Output "temp=$sandboxTemp"
    exit 0
}

if ([string]::IsNullOrWhiteSpace($CommandLine)) { Write-Diag '空命令'; exit 253 }

# AppContainer 写不了用户的 %TEMP%。lpEnvironment 传 NULL 时子进程继承本进程环境,
# 所以在这里改 $env: 就等于改了子进程的 TEMP —— 不必手工拼环境块。
$env:TEMP = $sandboxTemp
$env:TMP  = $sandboxTemp

$pipe = $null; $stdinHandle = [IntPtr]::Zero; $attrList = [IntPtr]::Zero
$capsPtr = [IntPtr]::Zero; $secCapsPtr = [IntPtr]::Zero; $sidPtrForCaps = [IntPtr]::Zero
$pi = New-Object 'WraithAC+PROCESS_INFORMATION'
$started = $false

try {
    # ---- 管道:必须显式把 AppContainer SID 加进 DACL ----
    # AppContainer 的令牌被严格削过,默认 DACL 的匿名管道它可能读写被拒。
    # 漏了这一步的症状是「命令跑完了但一个字都没输出」,极难归因。
    $pipeSec = New-Object System.IO.Pipes.PipeSecurity

    # ⚠ 创建者自己也必须在 DACL 里,而且这一条不能省。
    #
    # `New-Object PipeSecurity` 是**空 DACL**,而显式安全描述符会**整体替换默认 DACL**。
    # CreatePipe 建完服务端还要打开另一端,那一步**要过访问检查** —— DACL 里没有创建者
    # 就是 ERROR_ACCESS_DENIED,.NET 翻成 UnauthorizedAccessException(「对路径的访问被拒绝」)。
    #
    # 漏了它的真实症状(用户 Windows 11 实测):四条探针**全部** exit=252,
    # 第二条给出 `使用"4"个参数调用".ctor"时发生异常:"对路径的访问被拒绝。"` ——
    # 那个 4 参 .ctor 就是下面的 AnonymousPipeServerStream。AppContainer 进程根本没起来,
    # 于是「授权给 AppContainer」这个本意也一起落空。
    $meSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $pipeSec.AddAccessRule((New-Object System.IO.Pipes.PipeAccessRule(
        $meSid, [System.IO.Pipes.PipeAccessRights]::FullControl,
        [System.Security.AccessControl.AccessControlType]::Allow)))

    $acSid   = New-Object System.Security.Principal.SecurityIdentifier($sid)
    $pipeSec.AddAccessRule((New-Object System.IO.Pipes.PipeAccessRule(
        $acSid, [System.IO.Pipes.PipeAccessRights]::FullControl,
        [System.Security.AccessControl.AccessControlType]::Allow)))
    $pipe = New-Object System.IO.Pipes.AnonymousPipeServerStream(
        [System.IO.Pipes.PipeDirection]::In,
        [System.IO.HandleInheritability]::Inheritable,
        65536, $pipeSec)
    $childOut = $pipe.ClientSafePipeHandle.DangerousGetHandle()

    # stdin 给 NUL:STARTF_USESTDHANDLES 要求三个句柄都有效,
    # 而 Java 侧本来也从不往命令写入。
    $stdinHandle = [WraithAC]::CreateFile('NUL', 0x80000000, 3, [IntPtr]::Zero, 3, 0, [IntPtr]::Zero)

    # ---- SECURITY_CAPABILITIES ----
    if (-not [WraithAC]::ConvertStringSidToSid($sid, [ref]$sidPtrForCaps)) { throw 'SID 转换失败' }
    $secCaps = New-Object 'WraithAC+SECURITY_CAPABILITIES'
    $secCaps.AppContainerSid = $sidPtrForCaps
    $secCaps.Capabilities    = [IntPtr]::Zero
    $secCaps.CapabilityCount = 0
    $secCaps.Reserved        = 0
    $secCapsSize = [Runtime.InteropServices.Marshal]::SizeOf($secCaps)
    $secCapsPtr  = [Runtime.InteropServices.Marshal]::AllocHGlobal($secCapsSize)
    [Runtime.InteropServices.Marshal]::StructureToPtr($secCaps, $secCapsPtr, $false)

    # ---- 属性列表 ----
    $size = [IntPtr]::Zero
    [void][WraithAC]::InitializeProcThreadAttributeList([IntPtr]::Zero, 1, 0, [ref]$size)
    $attrList = [Runtime.InteropServices.Marshal]::AllocHGlobal($size)
    if (-not [WraithAC]::InitializeProcThreadAttributeList($attrList, 1, 0, [ref]$size)) {
        throw "InitializeProcThreadAttributeList 失败: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }
    if (-not [WraithAC]::UpdateProcThreadAttribute($attrList, 0,
            [WraithAC]::PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES,
            $secCapsPtr, [IntPtr]$secCapsSize, [IntPtr]::Zero, [IntPtr]::Zero)) {
        throw "UpdateProcThreadAttribute 失败: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }

    # ⚠ 必须先把内层结构体建好再整体赋值,不能写 `$si.StartupInfo.cb = ...`。
    # PowerShell 读嵌套值类型字段拿到的是**副本**,在副本上赋值改不到 $si 里去,
    # 结果是 cb/dwFlags/句柄全为 0 —— 症状是子进程拿不到 stdio,或 CreateProcess 直接失败。
    $inner = New-Object 'WraithAC+STARTUPINFO'
    # cb 取 STARTUPINFOEX 的大小(用了 EXTENDED_STARTUPINFO_PRESENT 就得是它,不是 STARTUPINFO)
    $inner.cb          = [Runtime.InteropServices.Marshal]::SizeOf([Type][WraithAC+STARTUPINFOEX])
    $inner.dwFlags     = [WraithAC]::STARTF_USESTDHANDLES
    $inner.hStdInput   = $stdinHandle
    $inner.hStdOutput  = $childOut
    $inner.hStdError   = $childOut   # 与 Java 侧 redirectErrorStream(true) 对齐

    $si = New-Object 'WraithAC+STARTUPINFOEX'
    $si.StartupInfo     = $inner
    $si.lpAttributeList = $attrList

    $flags = [WraithAC]::EXTENDED_STARTUPINFO_PRESENT -bor [WraithAC]::CREATE_NO_WINDOW
    # ComSpec 加引号:标准路径 C:\Windows\system32\cmd.exe 没空格,但不该赌这一点
    $shell = if ([string]::IsNullOrWhiteSpace($env:ComSpec)) { 'cmd.exe' } else { $env:ComSpec }
    $full  = '"' + $shell + '" /c ' + $CommandLine

    # 两条路都有人在用,而我验不了哪条在这台机器上work,所以先试 AsUser 再退普通版,
    # 并把实际生效的那条打到 stderr —— 真机排查时这一行能省很多时间。
    $started = [WraithAC]::CreateProcessAsUser([IntPtr]::Zero, $null, $full, [IntPtr]::Zero,
        [IntPtr]::Zero, $true, $flags, [IntPtr]::Zero, $Workspace, [ref]$si, [ref]$pi)
    if (-not $started) {
        $e1 = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
        $started = [WraithAC]::CreateProcess($null, $full, [IntPtr]::Zero, [IntPtr]::Zero,
            $true, $flags, [IntPtr]::Zero, $Workspace, [ref]$si, [ref]$pi)
        if (-not $started) {
            throw "CreateProcess 失败 (AsUser err=$e1, plain err=$([Runtime.InteropServices.Marshal]::GetLastWin32Error()))"
        }
        if ($VerbosePreference -ne 'SilentlyContinue') { Write-Diag "经 CreateProcess 启动 (AsUser err=$e1)" }
    }
} catch {
    Write-Diag "启动失败: $_"
    if ($pipe) { $pipe.Dispose() }
    exit 252
}

# 关掉父进程手上那份 client 端句柄 —— 不关的话写端永不归零,读到 EOF 那一刻永远不来,
# 命令跑完了这里还在死等。
$pipe.DisposeLocalCopyOfClientHandle()

try {
    $stdout = [Console]::OpenStandardOutput()
    $buf = New-Object byte[] 8192
    while (($n = $pipe.Read($buf, 0, $buf.Length)) -gt 0) {
        $stdout.Write($buf, 0, $n)
        $stdout.Flush()   # 逐块刷 —— Java 侧靠逐行读把输出流给 UI,攒着不刷等于没有流式
    }
} catch {
    Write-Diag "读取输出失败: $_"
}

[void][WraithAC]::WaitForSingleObject($pi.hProcess, 0xFFFFFFFF)
$code = 0
[void][WraithAC]::GetExitCodeProcess($pi.hProcess, [ref]$code)

[void][WraithAC]::CloseHandle($pi.hThread)
[void][WraithAC]::CloseHandle($pi.hProcess)
if ($stdinHandle -ne [IntPtr]::Zero) { [void][WraithAC]::CloseHandle($stdinHandle) }
if ($attrList -ne [IntPtr]::Zero) {
    [WraithAC]::DeleteProcThreadAttributeList($attrList)
    [Runtime.InteropServices.Marshal]::FreeHGlobal($attrList)
}
if ($secCapsPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeHGlobal($secCapsPtr) }
$pipe.Dispose()

exit $code
