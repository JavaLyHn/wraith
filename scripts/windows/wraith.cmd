@echo off
setlocal
rem ============================================================================
rem  wraith — Windows 启动器(对标 macOS 上手写的 /opt/homebrew/bin/wraith)
rem
rem    wraith [args...]      终端 CLI(默认;-c/--continue、-r/--resume、
rem                          app-server / gateway 等子命令原样透传)
rem    wraith -d|--desktop   启动桌面端 dev(electron-vite,复用同一个 jar)
rem
rem  改完 Java 后端后跑 `wraith-install` 重新构建装 jar,终端与桌面都会用上新的。
rem
rem  与 mac 版的差别:**不硬编码仓库路径**。mac 那个脚本里写死了
rem  /Users/xxx/Desktop/wraith,换台机器就废。这里从脚本自身位置反推仓库根,
rem  也允许用 WRAITH_REPO 覆盖(把本文件复制到别处时用)。
rem ============================================================================

set "JAR=%USERPROFILE%\.wraith\wraith.jar"
if not exist "%JAR%" (
  echo wraith: 还没安装 jar: %JAR% 1>&2
  echo   先装一次:  powershell -ExecutionPolicy Bypass -File scripts\windows\wraith-install.ps1 1>&2
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
