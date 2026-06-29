@echo off
echo Starting MyLab Dashboard...
start "" cmd /k "node "%~dp0server.js""
timeout /t 2 /nobreak >nul
start "" "http://localhost:5500/index.html"
