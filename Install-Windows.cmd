@echo off
cd /d "%~dp0"
node scripts/setup.mjs --client discord --inject
if errorlevel 1 echo Installation failed. Read the error above.
pause
