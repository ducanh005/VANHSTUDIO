param(
    [Parameter(Mandatory=$true)][string]$Runtime,
    [Parameter(Mandatory=$true)][string]$Ffmpeg,
    [int]$Port = 6006
)
$ErrorActionPreference = 'Stop'
$runtimePath = (Resolve-Path -LiteralPath $Runtime).Path
$pythonPath = Join-Path $runtimePath 'venv\Scripts\python.exe'
$serverPath = Join-Path $runtimePath 'piper_server.py'
if (!(Test-Path -LiteralPath $pythonPath) -or !(Test-Path -LiteralPath $serverPath) -or !(Test-Path -LiteralPath $Ffmpeg)) {
    throw 'Missing dedicated Piper runtime or FFmpeg. No installation changes were made.'
}
try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2
    if ($health.engine -ne 'piper' -or $health.voice -ne 'vi_VN-vais1000-medium') { throw 'Port is occupied by a different service.' }
    Write-Output 'Piper is already available.'
    exit 0
} catch {
    if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { throw 'Port is occupied; refusing to launch another server.' }
}
$existing = Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" | Where-Object { $_.ExecutablePath -eq $pythonPath -and $_.CommandLine -like '*piper_server.py*' }
if ($existing) { throw 'Piper is starting or unresponsive. Refusing to duplicate it.' }
$arguments = @('"' + $serverPath + '"', '--runtime', '"' + $runtimePath + '"', '--ffmpeg', '"' + $Ffmpeg + '"', '--port', "$Port")
$process = Start-Process -FilePath $pythonPath -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimePath 'server.stdout.log') -RedirectStandardError (Join-Path $runtimePath 'server.stderr.log')
$process.Id | Set-Content -LiteralPath (Join-Path $runtimePath 'server.pid')
for ($attempt = 0; $attempt -lt 25; $attempt++) {
    Start-Sleep -Milliseconds 200
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 1
        if ($health.engine -eq 'piper') { Write-Output 'Piper is available on loopback.'; exit 0 }
    } catch { }
}
throw 'Piper did not become ready. Inspect the dedicated runtime log; no other process was stopped.'
