@echo off
REM Send the "lowest prices found today" digest to Telegram right now.
cd /d "%~dp0\.."
node src/index.js --digest
