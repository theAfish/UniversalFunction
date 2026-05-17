@echo off
setlocal EnableDelayedExpansion
title Universal Function — Installer
color 0A

echo.
echo  ============================================
echo    Universal Function  ^|  Installer
echo  ============================================
echo.

REM ── Check Python ─────────────────────────────
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Python was not found.
    echo.
    echo  Please install Python 3.10 or newer from:
    echo    https://www.python.org/downloads/
    echo.
    echo  IMPORTANT: During installation, check the box
    echo  "Add Python to PATH" before clicking Install.
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('python --version 2^>^&1') do set PY_VER=%%v
echo  Found: %PY_VER%
echo.

REM ── Create virtual environment ────────────────
if exist ".venv" (
    echo  Virtual environment already exists, skipping creation.
) else (
    echo  [1/2] Creating virtual environment...
    python -m venv .venv
    if !errorlevel! neq 0 (
        echo  [ERROR] Failed to create virtual environment.
        pause
        exit /b 1
    )
    echo  Done.
)
echo.

REM ── Install dependencies ──────────────────────
echo  [2/2] Installing dependencies (this may take a minute)...
call .venv\Scripts\activate.bat
pip install -r requirements.txt --quiet --disable-pip-version-check
if %errorlevel% neq 0 (
    echo  [ERROR] Failed to install dependencies.
    echo  Try running this script again, or check your internet connection.
    pause
    exit /b 1
)
echo  Done.
echo.

REM ── Done ─────────────────────────────────────
echo  ============================================
echo    Installation complete!
echo.
echo    Next steps:
echo    1. Double-click  start.bat  to launch.
echo    2. The app opens in your browser.
echo    3. Click the "Settings" button to enter
echo       your API key.
echo  ============================================
echo.
pause
