@echo off
setlocal
set "APP_DIR=%~dp0.."
if not exist "%APP_DIR%\logs" mkdir "%APP_DIR%\logs"
cd /d "%APP_DIR%\web"
node node_modules\vite\bin\vite.js --host 127.0.0.1 > "%APP_DIR%\logs\web-dev.out.log" 2> "%APP_DIR%\logs\web-dev.err.log"
