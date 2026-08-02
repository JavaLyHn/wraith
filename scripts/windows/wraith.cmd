@echo off
setlocal
rem ============================================================================
rem  wraith — Windows 启动器(对标 macOS 上手写的 /opt/homebrew/bin/wraith)
rem
rem    wraith [args...]      终端 CLI(默认;-c/--continue、-r/--resume、
rem                          app-server / gateway / sandbox 等子命令原样透传)
rem    wraith -d|--desktop   启动桌面端 dev(electron-vite,复用同一个 jar)
rem    wraith -h|--help      用法(不需要 jar 就能看)
rem
rem  改完 Java 后端后跑 `wraith-install` 重新构建装 jar,终端与桌面都会用上新的。
rem
rem  与 mac 版的差别:**不硬编码仓库路径**。mac 那个脚本里写死了
rem  /Users/xxx/Desktop/wraith,换台机器就废。这里从脚本自身位置反推仓库根,
rem  也允许用 WRAITH_REPO 覆盖(把本文件复制到别处时用)。
rem
rem  -d / -h 为什么可以安全截走:Java CLI 自己只认 -c/--continue 与 -r/--resume
rem  (见 Main.ResumeIntent.from),既没有 -d 也没有 -h —— 不截的话 `wraith --help`
rem  会被当成无关参数忽略然后**直接进 REPL**,等于压根没有用法可查。
rem ============================================================================

if /i "%~1"=="-h"     goto usage
if /i "%~1"=="--help" goto usage
if /i "%~1"=="/?"     goto usage

set "JAR=%USERPROFILE%\.wraith\wraith.jar"
if not exist "%JAR%" (
  echo wraith: 还没安装 jar: %JAR% 1>&2
  echo   跑一次 wraith-install 即可^(它会构建后端并装到上面这个位置^) 1>&2
  echo   若连 wraith-install 都找不到,说明短命令没装全,在仓库根跑: 1>&2
  echo     powershell -ExecutionPolicy Bypass -File scripts\windows\wraith-install.ps1 1>&2
  exit /b 1
)

if /i "%~1"=="-d"        goto desktop
if /i "%~1"=="--desktop" goto desktop

rem CLI:整串参数原样透传
java -jar "%JAR%" %*
exit /b %ERRORLEVEL%

:desktop
rem 仓库根:优先 WRAITH_REPO,否则取本脚本上两级(scripts\windows -> scripts -> repo)
set "REPO=%WRAITH_REPO%"
if not defined REPO for %%I in ("%~dp0..\..") do set "REPO=%%~fI"
if not exist "%REPO%\desktop\package.json" (
  echo wraith: 在 %REPO% 下找不到 desktop\package.json 1>&2
  echo   若本文件被复制到了仓库外,请设环境变量 WRAITH_REPO 指向仓库根 1>&2
  exit /b 1
)
cd /d "%REPO%\desktop" || exit /b 1
npm run dev
exit /b %ERRORLEVEL%

:usage
echo wraith — 终端 CLI 与桌面端的统一入口
echo.
echo   wraith                    开终端 CLI^(交互式对话^)
echo   wraith -c ^| --continue    接着上一次会话
echo   wraith -r ^| --resume [id] 恢复历史会话^(不给 id 则列出来挑^)
echo   wraith -d ^| --desktop     开桌面端 dev
echo   wraith -h ^| --help        这份用法
echo.
echo   wraith sandbox doctor     沙箱体检^(四条探针^)
echo   wraith gateway bind ^<平台^>   绑定 IM 账号
echo   wraith app-server         桌面端用的 JSON-RPC 后端^(一般不用手敲^)
echo.
echo   wraith-install            改完 Java 后端后重新构建装 jar
echo.
echo 注意:终端 CLI **不套命令沙箱**^(只有桌面/IM 网关/定时任务套^),
echo       但命令黑名单与 HITL 审批照常生效。详见 docs\windows-usage.md 第 8 节。
exit /b 0
