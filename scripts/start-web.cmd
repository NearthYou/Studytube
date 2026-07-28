@echo off
cd /d C:\sw\agentic-board\web
"C:\Program Files\nodejs\node.exe" node_modules\vite\bin\vite.js --host 127.0.0.1 > C:\sw\agentic-board\logs\web-dev.out.log 2> C:\sw\agentic-board\logs\web-dev.err.log
