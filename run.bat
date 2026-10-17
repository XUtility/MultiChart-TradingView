@echo off
title MultiChart-TradingView
cd /d "%~dp0"
if exist "%~dp0MultiChart-TradingView.exe" (
    start "" "%~dp0MultiChart-TradingView.exe"
    exit
)
if exist "%~dp0run-tauri.bat" (
    call "%~dp0run-tauri.bat"
    exit
)
pause
