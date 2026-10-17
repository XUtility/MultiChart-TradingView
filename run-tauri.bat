@echo off
title MultiChart-TradingView (Tauri Native)
cd /d "%~dp0"

if exist "%~dp0MultiChart-TradingView.exe" (
    echo Starting MultiChart-TradingView...
    start "" "%~dp0MultiChart-TradingView.exe"
    exit /b 0
)

if exist "%~dp0src-tauri\target\release\MultiChart-TradingView.exe" (
    echo Starting MultiChart-TradingView (Release Mode)...
    start "" "%~dp0src-tauri\target\release\MultiChart-TradingView.exe"
    exit /b 0
)

if exist "%~dp0src-tauri\target\release\app.exe" (
    echo Starting MultiChart-TradingView (Release Mode)...
    start "" "%~dp0src-tauri\target\release\app.exe"
    exit /b 0
)

if exist "%~dp0src-tauri\target\debug\MultiChart-TradingView.exe" (
    echo Starting MultiChart-TradingView (Debug Mode)...
    start "" "%~dp0src-tauri\target\debug\MultiChart-TradingView.exe"
    exit /b 0
)

if exist "%~dp0src-tauri\target\debug\app.exe" (
    echo Starting MultiChart-TradingView (Debug Mode)...
    start "" "%~dp0src-tauri\target\debug\app.exe"
    exit /b 0
)

echo Building MultiChart-TradingView with Tauri...
cd src-tauri
cargo build --release
if exist "target\release\MultiChart-TradingView.exe" (
    start "" "target\release\MultiChart-TradingView.exe"
) else if exist "target\release\app.exe" (
    start "" "target\release\app.exe"
) else (
    echo Build failed. Please check errors above.
    pause
)
