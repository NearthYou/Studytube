@echo off
cd /d C:\sw\agentic-board\api
set AI_SERVICE_URL=http://localhost:8001
"C:\Program Files\nodejs\node.exe" dist\main.js > C:\sw\agentic-board\logs\api-dev.out.log 2> C:\sw\agentic-board\logs\api-dev.err.log
