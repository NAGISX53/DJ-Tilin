$ErrorActionPreference = 'Stop'
$botRoot = Split-Path -Parent $PSScriptRoot
$capability = Join-Path $botRoot 'runtime\panel-url.txt'
if (-not (Test-Path -LiteralPath $capability)) { throw 'Inicia DJ Tilin primero con iniciar.cmd.' }
$panelUrl = (Get-Content -LiteralPath $capability -Raw).Trim()
if ($panelUrl -notmatch '^http://127\.0\.0\.1:\d+/auth/local\?key=[a-f0-9]{64}$') { throw 'Dirección del panel no válida.' }
Start-Process $panelUrl
