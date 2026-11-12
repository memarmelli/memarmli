@echo off
rem Melli Architect: starts the site and admin server, then opens the browser.
rem   run.bat          serve on port 4173
rem   run.bat 8080     serve on another port
rem Close this window (or press Ctrl+C) to stop the server.
setlocal
cd /d "%~dp0"

set "PORT=4173"
if not "%~1"=="" set "PORT=%~1"

set "PYTHON="
where python >nul 2>nul && set "PYTHON=python"
if not defined PYTHON (where py >nul 2>nul && set "PYTHON=py -3")
if not defined PYTHON (
  echo Python 3 was not found. Install it from https://www.python.org/downloads/ and run this file again.
  pause
  exit /b 1
)

echo.
echo   Melli Architect
echo   Site:   http://127.0.0.1:%PORT%/
echo   Admin:  http://127.0.0.1:%PORT%/admin/
echo   The admin code is in data\ADMIN-CODE.txt the first time it is created.
echo.

rem Open the browser a moment after the server starts.
if not defined MELLI_NO_BROWSER start "" /b cmd /c "timeout /t 2 /nobreak >nul & start "" http://127.0.0.1:%PORT%/"

%PYTHON% server.py --port %PORT%
if errorlevel 1 (
  echo.
  echo The server stopped with an error. If port %PORT% is busy, run: run.bat 8080
  pause
)
endlocal
