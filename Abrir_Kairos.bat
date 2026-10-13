@echo off
rem Liga o painel do robo (se ainda nao estiver ligado) e abre no navegador.
cd /d "%~dp0"
powershell -NoProfile -Command "if (-not (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue)) { Start-Process -WindowStyle Hidden -FilePath python -ArgumentList 'server.py' -WorkingDirectory '%~dp0' -RedirectStandardOutput 'server.log' -RedirectStandardError 'server_err.log'; Start-Sleep -Seconds 4 }"
start "" http://localhost:8000
