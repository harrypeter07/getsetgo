@echo off
title Shimpli Laptop Local Video Server
echo ============================================================
echo   🍿 SHIMPLI LAPTOP LOCAL VIDEO SERVER (ZERO UPLOAD WAIT)
echo ============================================================
echo.
echo Folder: C:\ShimpliVideos (or drop any folder onto this bat script)
echo.
if "%~1"=="" (
    node scripts/local-server.js "C:\ShimpliVideos"
) else (
    node scripts/local-server.js "%~1"
)
pause
