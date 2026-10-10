@echo off
cd /d "%~dp0"
node -v
if not exist node_modules call npm install
echo Open http://localhost:4000 in your browser
call npm run dev
pause
