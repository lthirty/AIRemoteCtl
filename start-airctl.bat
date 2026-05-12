@echo off
setlocal

cd /d "%~dp0"

set "AIRCTL_HOST=0.0.0.0"
set "AIRCTL_PORT=8787"
set "AIRCTL_WORKSPACE=%~dp0"
set "CODEX_AUTO_START=1"
set "CODEX_WS_URL=ws://127.0.0.1:8390"
set "CODEX_BIND_URL=ws://127.0.0.1:8390"

for /f "usebackq delims=" %%T in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(18)).TrimEnd('=').Replace('+','-').Replace('/','_')"`) do set "AIRCTL_TOKEN=%%T"

echo.
echo AIRemoteCtl starting...
echo.
echo If dependencies are missing, npm install will run first.
echo Keep this window open while using phone control.
echo.

if not exist "node_modules\ws" (
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo.
echo Phone URL will be printed below after startup.
echo Token: %AIRCTL_TOKEN%
echo.

node src\server.js

echo.
echo AIRemoteCtl stopped.
pause
