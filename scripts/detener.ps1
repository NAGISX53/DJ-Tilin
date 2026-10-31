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
        if ($service -eq 'bot') {
            $panelFile = Join-Path $botRoot 'runtime\panel-url.txt'
            if (Test-Path -LiteralPath $panelFile) {
                try {
                    $panelUri = [uri]((Get-Content -LiteralPath $panelFile -Raw).Trim())
                    if ($panelUri.Host -eq '127.0.0.1' -and $panelUri.Query -match '^\?key=([a-f0-9]{64})$') {
                        $shutdownKey = $matches[1]
                        Invoke-RestMethod -Uri ("http://127.0.0.1:" + $panelUri.Port + '/internal/shutdown') -Method Post -Headers @{ Authorization = "Bearer $shutdownKey" } -TimeoutSec 2 | Out-Null
                        for ($attempt = 0; $attempt -lt 100; $attempt++) {
                            if (-not (Get-Process -Id $serviceId -ErrorAction SilentlyContinue)) { break }
                            Start-Sleep -Milliseconds 100
                        }
                    }
                } catch { Write-Host 'Cierre directo: se conservara el ultimo guardado disponible.' }
            }
        }
        if (Get-Process -Id $serviceId -ErrorAction SilentlyContinue) { Stop-Process -Id $serviceId -Force }
    }
    Remove-Item -LiteralPath $pidFile
}
Write-Host 'DJ Tilin y el motor de musica se detuvieron.'
