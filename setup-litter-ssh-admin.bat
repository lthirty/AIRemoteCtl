@echo off
setlocal

net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo Please right-click this file and choose "Run as administrator".
  echo This script enables Windows OpenSSH Server for Litter SSH connections.
  echo.
  pause
  exit /b 1
)

echo.
echo Installing/enabling Windows OpenSSH Server...

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
  "Write-Host ('Port: 22');" ^
  "Write-Host ('Username: ' + $env:USERNAME);"

echo.
echo Done. In Litter, add an SSH server with the host/username shown above.
echo Use your Windows account password, not the phone unlock code.
echo.
pause
