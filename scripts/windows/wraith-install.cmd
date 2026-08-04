@echo off
rem wraith-install - thin shim so that `wraith-install` can be typed as a
rem command the way it is on macOS, instead of spelling out
rem `powershell -ExecutionPolicy Bypass -File ...` every time.
rem The real logic lives in wraith-install.ps1 next to this file.
rem
rem ### ASCII ONLY. CRLF ONLY. ###
rem This file used to carry Chinese comments, and that broke it outright:
rem cmd.exe parses batch files byte-wise in the OEM code page (GBK/936 on a
rem Chinese Windows), where a stray GBK lead byte swallows the following byte.
rem Two newlines were eaten, which merged the `powershell` line below into the
rem preceding rem comment - so `wraith-install` did nothing at all and still
rem exited 0. Pinned by WindowsLauncherScriptTest.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0wraith-install.ps1" %*
exit /b %ERRORLEVEL%
