@echo off
cd /d "%~dp0"

if not exist node_modules (
    echo Installing dependencies...
    call npm install
    echo.
)

set /p REPO_DIR="Path to the repo you want to visualize: "

if not exist "%REPO_DIR%" (
    echo.
    echo That path doesn't exist: %REPO_DIR%
    pause
    exit /b 1
)

echo.
echo Building graph...
node src\languages\javascript\build-graph.js "%REPO_DIR%" output\graph.json
if errorlevel 1 (
    pause
    exit /b 1
)

echo.
if exist "%REPO_DIR%\.git" (
    echo Building history graph...
    node src\languages\javascript\build-history-graph.js "%REPO_DIR%" output\history-graph.json
) else (
    echo No .git folder found in that path - skipping history playback build.
    del /q output\history-graph.json 2>nul
)

echo.
echo Starting server at http://localhost:8090
start http://localhost:8090/src/viewer/viewer.html
node serve.js
