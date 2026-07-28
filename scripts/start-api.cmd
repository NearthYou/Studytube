@echo off
cd /d C:\sw\studytube\api
set AI_SERVICE_URL=http://localhost:8001
"C:\Program Files\nodejs\node.exe" dist\main.js > C:\sw\studytube\logs\api-dev.out.log 2> C:\sw\studytube\logs\api-dev.err.log
