@echo off
REM Run ONE Avis check through your real Chrome (must be started first via
REM start-chrome-debug.bat) and Telegram a verdict. Reads secrets from .env.
cd /d "%~dp0\.."
node src/index.js --once --report
