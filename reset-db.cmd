@echo off
setlocal
cd /d "%~dp0"
call npm.cmd run db:push
if errorlevel 1 exit /b %errorlevel%
call npm.cmd run db:seed:demo
