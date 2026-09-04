@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or later is required. Install it from https://nodejs.org/
  pause
  exit /b 1
)
echo Open http://127.0.0.1:4173 in your browser.
echo Keep this window open. Press Ctrl+C to stop the app and clear the API key.
node server.mjs
if errorlevel 1 pause
