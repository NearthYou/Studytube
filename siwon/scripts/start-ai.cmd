@echo off
cd /d C:\sw\agentic-board\siwon
C:\Python314\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8001 --app-dir ai > C:\sw\agentic-board\siwon\logs\ai-dev.out.log 2> C:\sw\agentic-board\siwon\logs\ai-dev.err.log
