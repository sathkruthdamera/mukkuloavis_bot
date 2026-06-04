@echo off
REM ============================================================
REM  Launch BRAVE with a CDP debug port for the Avis agent.
REM  Brave's Shields block the marketing popup, so the page loads
REM  cleaner. Dedicated profile so it won't clash with your normal Brave.
REM
REM  Keep it OPEN while the agent runs. Browse avis.com in it once so
REM  it earns real PerimeterX cookies (helps avoid the 403 block).
REM  Then set CHROME_CDP_URL=http://localhost:9223 in your .env
REM ============================================================
set "BRAVE=C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe"
if not exist "%BRAVE%" set "BRAVE=%LOCALAPPDATA%\BraveSoftware\Brave-Browser\Application\brave.exe"
if not exist "%BRAVE%" (
  echo Could not find brave.exe. Edit this file and set BRAVE to your Brave path.
  pause
  exit /b 1
)
"%BRAVE%" --remote-debugging-port=9223 --user-data-dir="%USERPROFILE%\avis-brave-profile" --window-size=1500,950 --no-first-run --no-default-browser-check https://www.avis.com/en/home
