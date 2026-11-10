@echo off
setlocal
node "%~dp0server.mjs" --open
if errorlevel 1 pause
