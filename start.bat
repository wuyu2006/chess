@echo off
cd /d "%~dp0"
start "" /b cmd /c "timeout /t 1 >nul & start http://localhost:3000"
node server.mjs
pause
