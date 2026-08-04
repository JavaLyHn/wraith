@echo off
setlocal
rem ==========================================================================
rem  wraith - Windows launcher. Counterpart of the hand-written
rem  /opt/homebrew/bin/wraith on macOS.
rem
rem    wraith [args...]        terminal CLI (default). -c/--continue,
rem                            -r/--resume, app-server, gateway, sandbox and
rem                            everything else pass straight through to Java.
rem    wraith -d, --desktop    desktop dev (electron-vite, reuses the same jar)
rem    wraith -h, --help       usage; works without a jar installed
rem
rem  Run wraith-install after changing the Java backend - terminal and desktop
rem  both pick up the new jar.
rem
rem  Unlike the macOS script this does NOT hardcode the repo path: it derives
rem  the repo root from its own location, and WRAITH_REPO overrides that.
rem
rem  Why -d / -h are safe to intercept: the Java CLI only knows -c/--continue
rem  and -r/--resume (see Main.ResumeIntent.from), so without interception
rem  "wraith --help" would be ignored and drop straight into the REPL.
rem
rem  ### ASCII ONLY. CRLF ONLY. ###
rem  cmd.exe parses batch files byte-wise in the OEM code page (GBK/936 on a
rem  Chinese Windows). A stray GBK lead byte (0x81-0xFE) swallows the byte
rem  after it, and both 0x0A (newline) and 0x5E (the ^ escape) are in range -
rem  so one Chinese comment can silently merge two lines or strip an escape.
rem  Every human-readable string therefore lives in wraith-msg.ps1, which is
rem  UTF-8 with BOM and read correctly by PowerShell. This file also avoids
rem  multi-line "(...)" blocks: parentheses inside them are exactly what
rem  needs caret-escaping, and the caret is what gets eaten. Pinned by
rem  WindowsLauncherScriptTest.
rem ==========================================================================

if /i "%~1"=="-h"     goto usage
if /i "%~1"=="--help" goto usage
if /i "%~1"=="/?"     goto usage

set "JAR=%USERPROFILE%\.wraith\wraith.jar"
if not exist "%JAR%" goto nojar

if /i "%~1"=="-d"        goto desktop
if /i "%~1"=="--desktop" goto desktop

rem CLI: hand the whole argument string to Java untouched.
rem Exec'd directly on purpose - no PowerShell wrapper on this path, so the
rem interactive REPL keeps the real console (stdin, raw mode, Ctrl-C) instead
rem of a piped one.
rem
rem  --enable-native-access=ALL-UNNAMED is required by JLine 4 on some JDKs.
rem  JLine's JniTerminalProvider constructor reflectively calls
rem  Module.isNativeAccessEnabled() and throws when it is false, so the jni
rem  provider - the ONLY working one on Windows - never loads. The terminal then
rem  degrades to DumbTerminal: no raw mode, so no arrow keys, no Tab completion,
rem  no history, and non-ASCII input gets mangled on echo.
rem  That method is JDK 22+, but GraalVM backported it - so a GraalVM JDK 21
rem  enforces the check while NOT honouring the jar manifest's
rem  Enable-Native-Access entry (that one is only read by JDK 24+).
rem
rem  The flag cannot be passed unconditionally: plain OpenJDK 21 rejects it as an
rem  unrecognized option and refuses to start at all. So probe once, cache the
rem  answer, and pay zero startup cost afterwards. Delete the cache file (or
rem  re-run wraith-install) after switching JDKs. See wraith terminal doctor.
set "FLAGFILE=%USERPROFILE%\.wraith\java-flags.txt"
if exist "%FLAGFILE%" goto readflags
java --enable-native-access=ALL-UNNAMED -version >nul 2>&1
if errorlevel 1 goto writeempty
echo --enable-native-access=ALL-UNNAMED> "%FLAGFILE%"
goto readflags
:writeempty
rem  A single space keeps set /p from leaving JAVA_FLAGS undefined-but-stale.
echo. > "%FLAGFILE%"
:readflags
set "JAVA_FLAGS="
set /p JAVA_FLAGS=<"%FLAGFILE%"
java %JAVA_FLAGS% -jar "%JAR%" %*
exit /b %ERRORLEVEL%

:desktop
rem Repo root: WRAITH_REPO wins, otherwise two levels up from this script
rem (scripts\windows, then scripts, then the repo root).
set "REPO=%WRAITH_REPO%"
if not defined REPO for %%I in ("%~dp0..\..") do set "REPO=%%~fI"
if not exist "%REPO%\desktop\package.json" goto nodesktop
cd /d "%REPO%\desktop" || exit /b 1
npm run dev
exit /b %ERRORLEVEL%

rem  The three message paths below shell out to PowerShell because that is
rem  where the localized (Chinese) text can live safely. Each one keeps a bare
rem  ASCII fallback: if PowerShell cannot be started at all, the user must
rem  still learn what went wrong instead of getting silence.

:usage
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0wraith-msg.ps1" usage
if errorlevel 1 echo wraith: CLI, -c continue, -r resume, -d desktop. See docs\windows-usage.md
exit /b 0

:nojar
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0wraith-msg.ps1" nojar "%JAR%" 1>&2
if errorlevel 1 echo wraith: jar not installed - run wraith-install. Expected: %JAR% 1>&2
exit /b 1

:nodesktop
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0wraith-msg.ps1" nodesktop "%REPO%" 1>&2
if errorlevel 1 echo wraith: no desktop\package.json under %REPO% - set WRAITH_REPO 1>&2
exit /b 1
