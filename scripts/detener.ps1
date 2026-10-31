$ErrorActionPreference = 'Stop'
$botRoot = Split-Path -Parent $PSScriptRoot
foreach ($service in @('bot','music')) {
    $pidFile = Join-Path $botRoot "$service.pid"
    if (-not (Test-Path -LiteralPath $pidFile)) { continue }
    $serviceId = (Get-Content -LiteralPath $pidFile).Trim()
    if ($serviceId -notmatch '^\d+$') { throw 'Archivo PID no valido.' }
    $serviceProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$serviceId" -ErrorAction SilentlyContinue
    if ($serviceProcess) {
        $belongs = if ($service -eq 'bot') { $serviceProcess.CommandLine.Contains((Join-Path $botRoot 'src\start.js')) } else { $serviceProcess.ExecutablePath -like "$botRoot\runtime\*\bin\java.exe" }
        if (-not $belongs) { throw "El PID de $service no corresponde a esta copia; no lo detuve." }
        Stop-Process -Id $serviceId -Force
    }
    Remove-Item -LiteralPath $pidFile
}
Write-Host 'DJ Tilin y el motor de musica se detuvieron.'
