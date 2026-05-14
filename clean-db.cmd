@echo off
setlocal
cd /d "%~dp0"

call npx.cmd prisma db push --force-reset
if errorlevel 1 exit /b %errorlevel%

echo Database reset complete.
