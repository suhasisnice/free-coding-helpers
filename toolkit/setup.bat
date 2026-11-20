@echo off
cd /d "%~dp0"
if exist "app\wizard-ui.js" cd app
where node >nul 2>nul
if errorlevel 1 goto nonode
echo Opening the setup app in your browser. Keep this window open until you finish.
node wizard-ui.js
goto end
:nonode
echo Node.js is not installed. Installing it now with winget...
winget install -e --id OpenJS.NodeJS.LTS
echo.
echo Node installed. CLOSE this window and double-click setup.bat again.
:end
pause
