@echo off
chcp 65001 >nul
cd /d D:\Code\ShibaPlan
echo 正在启动 ShibaPlan...
npm run tauri dev
pause
