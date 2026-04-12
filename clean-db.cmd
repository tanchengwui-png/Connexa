@echo off
setlocal
cd /d "%~dp0"

if exist "prisma\dev.db" del /f /q "prisma\dev.db"
if exist "prisma\dev.db-shm" del /f /q "prisma\dev.db-shm"
if exist "prisma\dev.db-wal" del /f /q "prisma\dev.db-wal"

call npx.cmd prisma db push --skip-generate
if errorlevel 1 exit /b %errorlevel%

echo Database cleaned and recreated.
