$ErrorActionPreference = 'Stop'
$botRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $botRoot
$runtimeDir = Join-Path $botRoot 'runtime'
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
$javaExe = Get-ChildItem -LiteralPath $runtimeDir -Filter java.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $javaExe) {
    Write-Host 'Descargando Java 21 portable (solo dentro de esta carpeta)...'
    $assets = Invoke-RestMethod 'https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jre&os=windows&vendor=eclipse'
    $package = $assets[0].binary.package
    $archive = Join-Path $runtimeDir 'java.zip'
    Invoke-WebRequest -Uri $package.link -OutFile $archive -UseBasicParsing
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $package.checksum) { throw 'No coincide la firma SHA256 de Java.' }
    Expand-Archive -LiteralPath $archive -DestinationPath $runtimeDir -Force
    Remove-Item -LiteralPath $archive
}
$jar = Join-Path $botRoot 'lavalink\Lavalink.jar'
if (-not (Test-Path -LiteralPath $jar)) {
    Write-Host 'Descargando Lavalink 4.2.2...'
    $release = Invoke-RestMethod 'https://api.github.com/repos/lavalink-devs/Lavalink/releases/tags/4.2.2'
    $asset = $release.assets | Where-Object name -eq 'Lavalink.jar'
    $download = "$jar.download"
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $download -UseBasicParsing
    if ($asset.digest -and $asset.digest.StartsWith('sha256:')) {
        if ((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash -ne $asset.digest.Substring(7)) { throw 'No coincide la firma SHA256 de Lavalink.' }
    }
    Move-Item -LiteralPath $download -Destination $jar
}
$ytdlpExe = Join-Path $runtimeDir 'yt-dlp.exe'
if (-not (Test-Path -LiteralPath $ytdlpExe)) {
    Write-Host 'Descargando yt-dlp...'
    $release = Invoke-RestMethod 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/tags/2026.10.26'
    $asset = $release.assets | Where-Object name -eq 'yt-dlp.exe'
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $ytdlpExe -UseBasicParsing
    if ($asset.digest -and $asset.digest.StartsWith('sha256:')) {
        if ((Get-FileHash -LiteralPath $ytdlpExe -Algorithm SHA256).Hash -ne $asset.digest.Substring(7)) { throw 'No coincide la firma SHA256 de yt-dlp.' }
    }
}
Set-Content -LiteralPath (Join-Path $runtimeDir 'yt-dlp.conf') -Value '--js-runtimes node' -Encoding ascii
Write-Host 'Motor de musica preparado.'
if (-not (Test-Path -LiteralPath (Join-Path $botRoot 'lavalink\plugins\tilin-audio.jar'))) {
    & (Join-Path $PSScriptRoot 'compilar-audio.ps1')
}
