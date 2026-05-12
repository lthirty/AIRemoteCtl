@echo off
setlocal

cd /d "%~dp0"

if /I "%~1"=="--admin-setup-start" goto admin_setup_start

set "AIRCTL_HOST=0.0.0.0"
set "AIRCTL_PORT=8787"
set "AIRCTL_WORKSPACE=%~dp0"
set "CODEX_AUTO_START=1"
set "CODEX_WS_URL=ws://127.0.0.1:8390"
set "CODEX_BIND_URL=ws://127.0.0.1:8390"

call :ensure_ssh_ready
if errorlevel 1 exit /b 1

goto start_airctl

:admin_setup_start
call :setup_ssh_admin
if errorlevel 1 (
  echo.
  echo SSH setup failed.
  pause
  exit /b 1
)
set "AIRCTL_HOST=0.0.0.0"
set "AIRCTL_PORT=8787"
set "AIRCTL_WORKSPACE=%~dp0"
set "CODEX_AUTO_START=1"
set "CODEX_WS_URL=ws://127.0.0.1:8390"
set "CODEX_BIND_URL=ws://127.0.0.1:8390"
goto start_airctl

:ensure_ssh_ready
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=Get-Service sshd -ErrorAction SilentlyContinue; if($s -and $s.Status -eq 'Running'){exit 0}else{exit 1}"
if not errorlevel 1 exit /b 0

echo.
echo Windows OpenSSH Server is not ready.
echo AIRemoteCtl will open an administrator window to enable SSH for Litter.
echo Approve the UAC prompt, then use the new administrator window.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%ComSpec%' -ArgumentList '/k', '\"%~f0\" --admin-setup-start' -Verb RunAs"
if errorlevel 1 (
  echo.
  echo Failed to open administrator setup window.
  echo Right-click start-airctl.bat and choose "Run as administrator".
  echo.
  pause
  exit /b 1
)
exit /b 1

:setup_ssh_admin
net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo Administrator permission is required to enable Windows OpenSSH Server.
  echo Right-click start-airctl.bat and choose "Run as administrator".
  echo.
  exit /b 1
)

echo.
echo Installing/enabling Windows OpenSSH Server for Litter...

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$cap=Get-WindowsCapability -Online | Where-Object Name -like 'OpenSSH.Server*' | Select-Object -First 1;" ^
  "if(-not $cap){ throw 'OpenSSH.Server capability not found on this Windows install.' }" ^
  "if($cap.State -ne 'Installed'){ Add-WindowsCapability -Online -Name $cap.Name | Out-Host }" ^
  "Set-Service -Name sshd -StartupType Automatic;" ^
  "Start-Service sshd;" ^
  "if(-not (Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue)) {" ^
  "  New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 | Out-Host" ^
  "} else {" ^
  "  Enable-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' | Out-Null" ^
  "}" ^
  "Write-Host '';" ^
  "Write-Host 'OpenSSH Server status:';" ^
  "Get-Service sshd | Format-Table Name,Status,StartType;" ^
  "Write-Host '';" ^
  "Write-Host 'Use these values in Litter:';" ^
  "Write-Host ('Host: ' + ((Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -First 1 -ExpandProperty IPAddress)));" ^
  "Write-Host 'Port: 22';" ^
  "Write-Host ('Username: ' + $env:USERNAME);"
if errorlevel 1 exit /b 1
exit /b 0

:start_airctl
for /f "delims=" %%C in ('where codex 2^>nul') do (
  if not defined CODEX_BIN set "CODEX_BIN=%%C"
)

if not defined CODEX_BIN if exist "%LOCALAPPDATA%\OpenAI\Codex\bin\codex.exe" (
  set "CODEX_BIN=%LOCALAPPDATA%\OpenAI\Codex\bin\codex.exe"
)

if not defined CODEX_BIN for /f "delims=" %%C in ('dir /b /s "%ProgramFiles%\WindowsApps\OpenAI.Codex_*\app\resources\codex.exe" 2^>nul') do (
  if not defined CODEX_BIN set "CODEX_BIN=%%C"
)

if not defined CODEX_BIN (
  echo.
  echo Cannot find codex.exe in this Windows session.
  echo Checked PATH, %LOCALAPPDATA%\OpenAI\Codex\bin, and WindowsApps.
  echo Please open Codex once, then run this script again.
  echo.
  pause
  exit /b 1
)

for /f "usebackq delims=" %%P in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$c=Get-NetTCPConnection -LocalPort %AIRCTL_PORT% -ErrorAction SilentlyContinue | Select-Object -First 1; if($c){$c.OwningProcess}"`) do set "AIRCTL_EXISTING_PID=%%P"

if defined AIRCTL_EXISTING_PID (
  echo.
  echo AIRemoteCtl is already running on port %AIRCTL_PORT% ^(pid=%AIRCTL_EXISTING_PID%^).
  echo.
  choice /C YN /M "Stop the old instance and restart"
  if errorlevel 2 (
    echo.
    echo Keeping existing instance. Close this window or run stop-airctl.bat when needed.
    pause
    exit /b 0
  )
  echo.
  echo Stopping old AIRemoteCtl instance...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; Stop-Process -Id %AIRCTL_EXISTING_PID% -Force"
  timeout /t 1 /nobreak >nul
)

for /f "delims=" %%T in ('node -e "process.stdout.write(require('crypto').randomBytes(18).toString('base64url'))"') do set "AIRCTL_TOKEN=%%T"
> ".airctl-token" echo %AIRCTL_TOKEN%

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
