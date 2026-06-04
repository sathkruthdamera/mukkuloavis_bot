@echo off
REM ============================================================
REM  Launch a REAL Chrome with a CDP debug port for the Avis agent
REM  to attach to. Uses a DEDICATED profile so it never clashes with
REM  your everyday Chrome windows.
REM
REM  Keep this window/Chrome OPEN while the agent runs. Tip: browse
REM  avis.com in it once so it earns real PerimeterX cookies.
REM ============================================================
set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" (
  echo Could not find chrome.exe. Edit this file and set CHROME to your Chrome path.
  pause
  exit /b 1
)
"%CHROME%" --remote-debugging-port=9222 --user-data-dir="%USERPROFILE%\avis-chrome-profile" --no-first-run --no-default-browser-check https://www.avis.com/en/home
