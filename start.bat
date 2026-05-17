@echo off
setlocal
title Universal Function
color 0A

echo.
echo  Starting Universal Function...
echo.

REM ── Check venv exists ────────────────────────
if not exist ".venv\Scripts\activate.bat" (
    echo  [ERROR] Virtual environment not found.
    echo  Please run  install.bat  first.
    echo.
    pause
    exit /b 1
)

call .venv\Scripts\activate.bat

REM ── Open browser after a short delay ─────────
start "" /B cmd /c "timeout /t 2 >nul && start http://localhost:8000"

REM ── Launch server ─────────────────────────────
echo  Server running at http://localhost:8000
echo  Press Ctrl+C to stop.
echo.
uvicorn backend.main:app --port 8000
