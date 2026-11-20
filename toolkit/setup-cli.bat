@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto nonode
:menu
echo.
echo   1 = Install for Antigravity
echo   2 = Install for Claude Code
echo   3 = Key setup only (start OmniRoute, add keys, open Antigravity)
echo   4 = Exit
set A=
set /p A=Type 1, 2, 3 or 4: 
if "%A%"=="4" exit /b
if "%A%"=="3" goto keys
set AG=
if "%A%"=="1" set AG=antigravity
if "%A%"=="2" set AG=claude
if not defined AG goto menu
set P=
set /p P=Your project folder (drag it here, or press Enter to skip): 
set P=%P:"=%
if not defined P goto noproj
node setup-wizard.js --agent %AG% --project "%P%"
goto end
:noproj
node setup-wizard.js --agent %AG%
goto end
:keys
node setup-wizard.js --guide
goto end
:nonode
echo Node.js is not installed. Installing it now with winget...
winget install -e --id OpenJS.NodeJS.LTS
echo.
echo Node installed. CLOSE this window and double-click setup.bat again.
:end
echo.
echo Finished. Send the summary above (and .fcode-install.json) back.
pause
