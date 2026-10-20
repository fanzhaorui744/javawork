@echo off
chcp 65001 >nul
cd /d %~dp0
where java >nul 2>nul
if errorlevel 1 (
    echo [提示] 未检测到 Java，请先安装 JDK 17 并配置 JAVA_HOME。
    pause
    exit /b 1
)
java -jar lostfound.jar
pause
