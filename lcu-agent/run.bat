@echo off
chcp 65001 >nul
cd /d "%~dp0"
title ARAM Squad Stats - Sync

:: ---- find python ------------------------------------------------------
set "PY="
python --version >nul 2>&1
if not errorlevel 1 set "PY=python"
if defined PY goto have_python
py -3 --version >nul 2>&1
if not errorlevel 1 set "PY=py -3"
if defined PY goto have_python

echo.
echo  [ERROR] Python not found.
echo  Install it from https://python.org
echo  During install, check "Add python.exe to PATH".
echo.
pause
exit /b 1

:: ---- ensure dependencies ----------------------------------------------
:have_python
echo Python interpreter in use:
%PY% -c "import sys; print('  ' + sys.executable)"
echo.
%PY% -c "import requests, psutil" >nul 2>&1
if not errorlevel 1 goto run

echo Installing dependencies: requests, psutil ...
if exist requirements.txt %PY% -m pip install --disable-pip-version-check -r requirements.txt
if not exist requirements.txt %PY% -m pip install --disable-pip-version-check requests psutil

%PY% -c "import requests, psutil" >nul 2>&1
if not errorlevel 1 goto run

echo Retrying install for current user only ...
if exist requirements.txt %PY% -m pip install --disable-pip-version-check --user -r requirements.txt
if not exist requirements.txt %PY% -m pip install --disable-pip-version-check --user requests psutil

%PY% -c "import requests, psutil" >nul 2>&1
if not errorlevel 1 goto run

echo.
echo  [ERROR] Failed to install dependencies.
echo  Check your internet connection, then run this file again.
echo  Note: the packages are needed by the interpreter shown above,
echo  which may differ from the "python" in your PowerShell window.
echo.
pause
exit /b 1

:: ---- run ---------------------------------------------------------------
:run
%PY% lcu_agent.py %*
if errorlevel 1 (
  echo Sync failed. Check the message above.
  pause
  exit /b 1
)
echo.
echo Done! Closing in 2 seconds...
timeout /t 2 >nul
