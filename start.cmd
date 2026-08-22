@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo.
echo   FreeCall
echo   --------
echo.

rem ---------------------------------------------------------------- Node check
where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js isn't on your PATH.
  echo   Install Node 18 or newer from https://nodejs.org and run this again.
  goto :fail
)

set NODE_MAJOR=0
for /f "tokens=1 delims=v." %%v in ('node -v') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 18 (
  for /f %%v in ('node -v') do echo   Node %%v is too old; this needs 18 or newer.
  goto :fail
)

rem -------------------------------------------------------------- dependencies
if not exist "node_modules\" (
  echo   Installing dependencies. First run only - this takes a few minutes.
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo   npm install failed. Scroll up for the reason; a proxy or offline
    echo   registry is the usual cause.
    goto :fail
  )
  echo.
)

rem ---------------------------------------------------------------- server env
if not exist "server\.env" (
  copy /y "server\.env.example" "server\.env" >nul
  echo   Created server\.env from the example. Defaults are fine for local use.
)

rem ------------------------------------------------------------- start it up
echo   Starting the signaling server on http://localhost:4000
start "FreeCall server" cmd /k "npm run dev:server"

echo   Waiting for it to answer...
set READY=
where curl >nul 2>nul
if errorlevel 1 (
  rem No curl on this box, so just give it a moment.
  ping -n 7 127.0.0.1 >nul
  set READY=assumed
) else (
  for /l %%i in (1,1,30) do (
    if not defined READY (
      curl --silent --fail --max-time 2 http://localhost:4000/health >nul 2>nul && set READY=1
      if not defined READY ping -n 2 127.0.0.1 >nul
    )
  )
)
if not defined READY (
  echo   Still starting. The web app retries on its own, so carrying on.
) else (
  echo   Server is up.
)

echo   Starting the web client on http://localhost:5173
start "FreeCall web" cmd /k "npm run dev:web"
ping -n 5 127.0.0.1 >nul
start "" http://localhost:5173

echo.
echo   Two new windows are running the server and the web client. Closing
echo   either one stops that half; this window can be closed now.
echo.
echo   Sign in as alice, bob or carol - the password is: password
echo.
echo   To place a real call you need two sessions: open a second browser
echo   profile (or an incognito window) and sign in as a different user.
echo.
echo   The mobile app is separate and needs a native build:
echo     npm --prefix mobile install
echo     cd mobile ^&^& npx expo prebuild ^&^& npm run android
echo.
exit /b 0

:fail
echo.
pause
exit /b 1
