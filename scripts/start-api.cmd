@echo off
setlocal
set "APP_DIR=%~dp0.."
if not exist "%APP_DIR%\logs" mkdir "%APP_DIR%\logs"
cd /d "%APP_DIR%\api"
set "AI_SERVICE_URL=http://localhost:8001"
node dist\main.js > "%APP_DIR%\logs\api-dev.out.log" 2> "%APP_DIR%\logs\api-dev.err.log"
