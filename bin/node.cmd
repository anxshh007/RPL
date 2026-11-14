@echo off
setlocal
set ELECTRON_RUN_AS_NODE=1
"C:\Users\tusha\AppData\Local\Programs\Microsoft VS Code\Code.exe" --no-warnings --experimental-transform-types %*
set ERR=%ERRORLEVEL%
exit /b %ERR%
