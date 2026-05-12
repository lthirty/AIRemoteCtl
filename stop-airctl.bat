@echo off
setlocal

set "AIRCTL_PORT=8787"
set "CODEX_PORT=8390"

echo.
echo Stopping AIRemoteCtl on port %AIRCTL_PORT%...

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='SilentlyContinue';" ^
  "$ports=@(%AIRCTL_PORT%);" ^
  "foreach($port in $ports) {" ^
  "  Get-NetTCPConnection -LocalPort $port | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {" ^
  "    $p=Get-Process -Id $_;" ^
  "    if($p) { Write-Host ('Stopping {0} pid={1} on port {2}' -f $p.ProcessName,$p.Id,$port); Stop-Process -Id $p.Id -Force; }" ^
  "  }" ^
  "}"

echo.
echo Stopping Codex app-server on port %CODEX_PORT% if it was launched for AIRemoteCtl...

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='SilentlyContinue';" ^
  "Get-NetTCPConnection -LocalPort %CODEX_PORT% | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {" ^
  "  $p=Get-Process -Id $_;" ^
  "  if($p -and $p.ProcessName -ieq 'codex') {" ^
  "    Write-Host ('Stopping codex app-server pid={0} on port %CODEX_PORT%' -f $p.Id);" ^
  "    Stop-Process -Id $p.Id -Force;" ^
  "  }" ^
  "}"

echo.
echo Done.
pause
