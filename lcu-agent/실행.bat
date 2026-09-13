@echo off
chcp 65001 >nul
cd /d "%~dp0"
title ARAM Squad Stats - 전적 동기화

echo.
echo  ╔══════════════════════════════════╗
echo  ║   ARAM Squad Stats 전적 동기화   ║
echo  ╚══════════════════════════════════╝
echo.

:: ---- 파이썬 찾기 -------------------------------------------------------
set "PY="
python --version >nul 2>&1
if not errorlevel 1 set "PY=python"
if defined PY goto have_python
py -3 --version >nul 2>&1
if not errorlevel 1 set "PY=py -3"
if defined PY goto have_python

echo  [오류] Python이 설치되어 있지 않습니다.
echo  https://python.org 에서 설치해주세요.
echo  설치할 때 "Add python.exe to PATH" 체크박스를 꼭 켜주세요.
echo.
pause
exit /b 1

:: ---- 필요한 패키지 확인 및 설치 ----------------------------------------
:have_python
echo  사용 중인 Python:
%PY% -c "import sys; print('   ' + sys.executable)"
echo.
%PY% -c "import requests, psutil" >nul 2>&1
if not errorlevel 1 goto run

echo  필요한 패키지를 설치합니다 ^(requests, psutil^) ...
if exist requirements.txt %PY% -m pip install --disable-pip-version-check -r requirements.txt
if not exist requirements.txt %PY% -m pip install --disable-pip-version-check requests psutil

%PY% -c "import requests, psutil" >nul 2>&1
if not errorlevel 1 goto run

echo  권한 문제로 보입니다. 현재 사용자 전용으로 다시 설치합니다 ...
if exist requirements.txt %PY% -m pip install --disable-pip-version-check --user -r requirements.txt
if not exist requirements.txt %PY% -m pip install --disable-pip-version-check --user requests psutil

%PY% -c "import requests, psutil" >nul 2>&1
if not errorlevel 1 goto run

echo.
echo  [오류] 패키지 설치에 실패했습니다.
echo  인터넷 연결을 확인한 뒤 이 파일을 다시 실행해주세요.
echo  참고: 위에 표시된 Python에 패키지가 필요합니다.
echo  PowerShell의 python과 다른 인터프리터일 수 있습니다.
echo.
pause
exit /b 1

:: ---- 실행 --------------------------------------------------------------
:run
echo.
%PY% lcu_agent.py %*
if errorlevel 1 (
  echo 동기화 실패. 위의 오류 메시지를 확인해주세요.
  pause
  exit /b 1
)
echo.
echo  완료! 이 창은 2초 후 자동으로 닫힙니다.
timeout /t 2 >nul
