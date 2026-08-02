@echo off
rem wraith-install — 薄壳,让 `wraith-install` 能像 macOS 上一样当命令直接敲,
rem 而不必每次手打 powershell -ExecutionPolicy Bypass -File …。
rem 真正的逻辑在同目录的 wraith-install.ps1。
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0wraith-install.ps1" %*
exit /b %ERRORLEVEL%
