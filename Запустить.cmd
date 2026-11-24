@echo off
chcp 65001 >nul
cd /d "%~dp0"
where npm >nul 2>nul || (echo Node.js ne najden. Prosto otkroj MyZombika.html dvojnym klikom. & pause & exit /b)
if not exist node_modules (
  echo Ustanavlivayu zavisimosti...
  call npm install || (echo npm install ne udalsya & pause & exit /b)
)
start "" http://localhost:5174
call npm run dev
pause
