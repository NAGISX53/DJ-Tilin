$ErrorActionPreference = 'Stop'
$botRoot = Split-Path -Parent $PSScriptRoot
$buildRoot = Join-Path $botRoot 'runtime\build'
$classes = Join-Path $buildRoot 'classes'
$libs = Join-Path $buildRoot 'libs'
New-Item -ItemType Directory -Path $classes,$libs -Force | Out-Null
foreach ($dependency in @(
    @{ Name='ecj.jar'; Url='https://repo.maven.apache.org/maven2/org/eclipse/jdt/ecj/3.41.0/ecj-3.41.0.jar' },
    @{ Name='opus-natives.jar'; Url='https://repo.maven.apache.org/maven2/club/minnced/opus-java-natives/1.1.1/opus-java-natives-1.1.1.jar' }
)) {
    $target = Join-Path $buildRoot $dependency.Name
    if (-not (Test-Path -LiteralPath $target)) { Invoke-WebRequest -Uri $dependency.Url -OutFile $target -UseBasicParsing }
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$serverJar = [IO.Compression.ZipFile]::OpenRead((Join-Path $botRoot 'lavalink\Lavalink.jar'))
try {
    foreach ($entry in $serverJar.Entries) {
        if ($entry.FullName -like 'BOOT-INF/lib/*.jar') {
            $target = Join-Path $libs $entry.Name
            if (-not (Test-Path -LiteralPath $target)) { [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$target,$true) }
        }
    }
} finally { $serverJar.Dispose() }
$nativeDir = Join-Path $classes 'native'
New-Item -ItemType Directory -Path $nativeDir -Force | Out-Null
$nativeJar = [IO.Compression.ZipFile]::OpenRead((Join-Path $buildRoot 'opus-natives.jar'))
try {
    [IO.Compression.ZipFileExtensions]::ExtractToFile($nativeJar.GetEntry('natives/win32-x86-64/libopus.dll'), (Join-Path $nativeDir 'libopus.dll'), $true)
} finally { $nativeJar.Dispose() }
$java = Get-ChildItem -LiteralPath (Join-Path $botRoot 'runtime') -Filter java.exe -Recurse | Select-Object -First 1
$classpath = (Get-ChildItem -LiteralPath $libs -Filter '*.jar' | ForEach-Object FullName) -join ';'
$sources = Get-ChildItem -LiteralPath (Join-Path $botRoot 'lavalink\tilin-audio\src') -Filter '*.java' -Recurse | ForEach-Object FullName
& $java.FullName -jar (Join-Path $buildRoot 'ecj.jar') -21 -nowarn -encoding UTF-8 -cp $classpath -d $classes $sources
if ($LASTEXITCODE -ne 0) { throw 'No se pudo compilar el codificador.' }
& $java.FullName -cp "$classes;$classpath" dev.tilin.audio.EncoderSelfTest
if ($LASTEXITCODE -ne 0) { throw 'Fallaron las pruebas de audio nativo.' }
& $java.FullName -cp "$classes;$classpath" dev.tilin.audio.EncoderMultiGuildTest
if ($LASTEXITCODE -ne 0) { throw 'Fallaron las pruebas de aislamiento entre servidores.' }
$metadataDir = Join-Path $classes 'lavalink-plugins'
New-Item -ItemType Directory -Path $metadataDir -Force | Out-Null
Set-Content -LiteralPath (Join-Path $metadataDir 'tilin-audio.properties') -Encoding ascii -Value "path=dev.tilin.audio`nname=tilin-audio`nversion=1.0.0"
$pluginDir = Join-Path $botRoot 'lavalink\plugins'
New-Item -ItemType Directory -Path $pluginDir -Force | Out-Null
$outputJar = Join-Path $pluginDir 'tilin-audio.jar'
if (Test-Path -LiteralPath $outputJar) { Remove-Item -LiteralPath $outputJar }
$archive = [IO.Compression.ZipFile]::Open($outputJar, [IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($file in (Get-ChildItem -LiteralPath $classes -File -Recurse)) {
        $name = $file.FullName.Substring($classes.Length + 1).Replace('\','/')
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $name) | Out-Null
    }
    # Spring's component scanner discovers packages by their directory entries.
    foreach ($directory in (Get-ChildItem -LiteralPath $classes -Directory -Recurse)) {
        $name = $directory.FullName.Substring($classes.Length + 1).Replace('\','/') + '/'
        $archive.CreateEntry($name) | Out-Null
    }
} finally { $archive.Dispose() }
Write-Host 'Plugin de audio compilado y probado.'
