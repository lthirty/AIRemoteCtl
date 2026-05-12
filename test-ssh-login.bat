@echo off
setlocal

set "SSH_USER=%USERNAME%"
set "SSH_HOST=127.0.0.1"

echo.
echo Testing local SSH login.
echo User: %SSH_USER%
echo Host: %SSH_HOST%
echo.
echo When prompted, enter your Windows account password.
echo If login works, this prints SSH_OK and exits.
echo.

ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 %SSH_USER%@%SSH_HOST% "echo SSH_OK"

echo.
if errorlevel 1 (
  echo SSH login failed. Check the Windows account password.
) else (
  echo SSH login succeeded.
)
pause
