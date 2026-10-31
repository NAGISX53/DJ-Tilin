$ErrorActionPreference = 'Stop'
$botRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $botRoot
$musicPidFile = Join-Path $botRoot 'music.pid'
if (Test-Path -LiteralPath $musicPidFile) {
    $runningMusic = Get-CimInstance Win32_Process -Filter "ProcessId=$(Get-Content -LiteralPath $musicPidFile)" -ErrorAction SilentlyContinue
    if ($runningMusic -and $runningMusic.ExecutablePath -like "$botRoot\runtime\*\bin\java.exe") {
        Write-Host 'El motor de musica ya esta iniciado.'
        exit 0
    }
}
# Import only music variables, never the Discord token.
if (Test-Path -LiteralPath '.env') {
    Get-Content -LiteralPath '.env' | ForEach-Object {
        if ($_ -match '^\s*(LAVALINK_PASSWORD|SPOTIFY_CLIENT_ID|SPOTIFY_CLIENT_SECRET)=(.*)$') {
            [Environment]::SetEnvironmentVariable($matches[1], $matches[2].Trim().Trim('"').Trim("'"), 'Process')
        }
    }
}
$javaExe = Get-ChildItem -LiteralPath (Join-Path $botRoot 'runtime') -Filter java.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $javaExe -or -not (Test-Path -LiteralPath 'lavalink\Lavalink.jar')) { throw 'Ejecuta PREPARAR-MUSICA.cmd primero.' }
Set-Location -LiteralPath (Join-Path $botRoot 'lavalink')
$env:SERVER_ADDRESS = '127.0.0.1'
$musicProcess = Start-Process -FilePath $javaExe.FullName -ArgumentList @('-Xms64m','-Xmx384m','-jar','Lavalink.jar') -WorkingDirectory (Get-Location).Path -WindowStyle Hidden -RedirectStandardOutput (Join-Path $botRoot 'music.log') -RedirectStandardError (Join-Path $botRoot 'music-error.log') -PassThru
$musicProcess.Id | Set-Content -LiteralPath $musicPidFile
Write-Host 'Motor de musica iniciado en segundo plano.'
