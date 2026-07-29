@echo off
setlocal
set "APP_DIR=%~dp0.."
if not exist "%APP_DIR%\logs" mkdir "%APP_DIR%\logs"
cd /d "%APP_DIR%"
"%APP_DIR%\ai\.venv\Scripts\python.exe" -m uvicorn main:app --host 0.0.0.0 --port 8001 --app-dir ai > "%APP_DIR%\logs\ai-dev.out.log" 2> "%APP_DIR%\logs\ai-dev.err.log"
