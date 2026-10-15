@echo off
title TradingView Multi-Window SplitSync
cd /d "%~dp0"
taskkill /F /IM electron.exe >nul 2>&1
"node_modules\electron\dist\electron.exe" .
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo An error occurred while launching. Press any key to exit...
    pause >nul
)
