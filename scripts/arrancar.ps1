$ErrorActionPreference = 'Stop'
$botRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $botRoot
$botPidFile = Join-Path $botRoot 'bot.pid'
$botScript = Join-Path $botRoot 'src\start.js'
if (Test-Path -LiteralPath $botPidFile) {
    $runningBot = Get-CimInstance Win32_Process -Filter "ProcessId=$(Get-Content -LiteralPath $botPidFile)" -ErrorAction SilentlyContinue
    if ($runningBot -and $runningBot.CommandLine.Contains($botScript)) {
        Write-Host 'DJ Tilin ya esta iniciado. Para reiniciarlo, usa DETENER.cmd y luego iniciar.cmd.'
        exit 0
    }
}
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$nodeExe = if ($nodeCommand) { $nodeCommand.Source } else { 'C:\Program Files\nodejs\node.exe' }
& $nodeExe -e "import('./src/validate-config.js').then(async m=>m.validateConfig((await import('./src/config.js')).config))"
if ($LASTEXITCODE -ne 0) { throw 'La configuracion de Discord no esta completa.' }
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'iniciar-musica.ps1')
if ($LASTEXITCODE -ne 0) { throw 'No se pudo iniciar Lavalink.' }
$musicReady = $false
$musicPassword = 'youshallnotpass'
Get-Content -LiteralPath (Join-Path $botRoot '.env') | ForEach-Object {
    if ($_ -match '^\s*LAVALINK_PASSWORD=(.*)$') { $musicPassword = $matches[1].Trim().Trim('"').Trim("'") }
}
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try { $version = Invoke-RestMethod 'http://127.0.0.1:2333/version' -Headers @{ Authorization = $musicPassword } -TimeoutSec 1; $musicReady = $true; break } catch { Start-Sleep -Milliseconds 500 }
}
if (-not $musicReady) { throw 'Lavalink no respondio. Revisa music.log y music-error.log.' }
$botProcess = Start-Process -FilePath $nodeExe -ArgumentList ('"' + $botScript + '"') -WorkingDirectory $botRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $botRoot 'bot.log') -RedirectStandardError (Join-Path $botRoot 'bot-error.log') -PassThru
$botProcess.Id | Set-Content -LiteralPath $botPidFile
Write-Host 'DJ Tilin iniciado en segundo plano. No necesitas dejar esta ventana abierta.'
