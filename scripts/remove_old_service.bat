@echo off
chcp 65001 >nul 2>&1
setlocal EnableDelayedExpansion

:: ============================================================
::  MALINALCO RENDER - Eliminar servicios anteriores
::  Limpia instalaciones previas (Tenebrio Python/Node) que
::  pudieran estar en el equipo destino y compartan el puerto 5000.
::  Ejecutar como administrador
:: ============================================================

title Malinalco - Eliminar servicios anteriores

echo.
echo ============================================================
echo   Eliminando servicios anteriores que ocupan el puerto 5000
echo ============================================================

:: ---- [1/5] Admin ----
echo.
echo [1/5] Verificando permisos de administrador...
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Requiere administrador.
    echo         Clic derecho ^> Ejecutar como administrador.
    pause & exit /b 1
)
echo       OK

:: ---- [2/5] Detener y eliminar servicios NSSM anteriores ----
echo.
echo [2/5] Eliminando servicios NSSM anteriores...
where nssm >nul 2>&1
if %errorlevel% neq 0 (
    echo [AVISO] NSSM no encontrado en PATH. Omitiendo.
    goto :KILL_PROCS
)

for %%S in (TenebrioHeatmap TenebrioNode) do (
    nssm status %%S >nul 2>&1
    if !errorlevel! equ 0 (
        echo       Eliminando %%S...
        nssm stop %%S >nul 2>&1
        timeout /t 3 /nobreak >nul
        for /f "tokens=3" %%p in ('sc queryex %%S ^| findstr PID') do (
            if %%p neq 0 taskkill /PID %%p /T /F >nul 2>&1
        )
        nssm remove %%S confirm >nul 2>&1
        timeout /t 2 /nobreak >nul
    )
)
echo       OK

:: ---- [3/5] Matar procesos residuales y liberar puerto 5000 ----
:KILL_PROCS
echo.
echo [3/5] Cerrando procesos residuales y liberando puerto 5000...
powershell -Command "Get-WmiObject Win32_Process -Filter \"Name='python.exe'\" | Where-Object { $_.CommandLine -match 'main\.py' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
powershell -Command "Get-NetTCPConnection -LocalPort 5000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>&1
echo       OK

:: ---- [4/5] Limpiar kioskos antiguos del inicio de sesion ----
echo.
echo [4/5] Limpiando entradas antiguas del inicio de sesion...
schtasks /delete /tn "TenebrioKiosk" /f >nul 2>&1
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\TenebrioKiosk.bat" >nul 2>&1
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\MalinalcoKiosk.bat" >nul 2>&1
powershell -Command "$paths = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Run','HKLM:\Software\Microsoft\Windows\CurrentVersion\Run'); foreach ($p in $paths) { Get-ItemProperty -Path $p -ErrorAction SilentlyContinue | ForEach-Object { $_.PSObject.Properties | Where-Object { $_.Value -match 'localhost:5000|kiosk' } | ForEach-Object { Remove-ItemProperty -Path $p -Name $_.Name -Force -ErrorAction SilentlyContinue } } }" >nul 2>&1
echo       OK

:: ---- [5/5] Limpiar politicas de Edge que bloquean el setup ----
echo.
echo [5/5] Restaurando politicas de Edge...
reg delete "HKLM\SOFTWARE\Policies\Microsoft\Edge" /v StartupBoostEnabled /f >nul 2>&1
reg delete "HKLM\SOFTWARE\Policies\Microsoft\Edge" /v BackgroundModeEnabled /f >nul 2>&1
reg delete "HKLM\SOFTWARE\Policies\Microsoft\Edge" /v AllowPrelaunch /f >nul 2>&1
reg delete "HKLM\SOFTWARE\Policies\Microsoft\Edge" /v RestoreOnStartup /f >nul 2>&1
echo       OK

echo.
echo ============================================================
echo   LIMPIEZA COMPLETADA
echo ============================================================
echo   Servicios anteriores:    Eliminados
echo   Procesos / Puerto 5000:  Liberados
echo   Inicio de sesion:        Limpiado
echo   Politicas Edge:          Restauradas
echo ============================================================
pause
exit /b 0
