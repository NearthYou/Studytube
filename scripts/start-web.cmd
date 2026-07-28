@echo off
cd /d C:\sw\studytube\web
"C:\Program Files\nodejs\node.exe" node_modules\vite\bin\vite.js --host 127.0.0.1 > C:\sw\studytube\logs\web-dev.out.log 2> C:\sw\studytube\logs\web-dev.err.log
