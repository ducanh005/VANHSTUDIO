# Copy next to the independently packaged VANHSUB.exe. Uses only this candidate's profile.
$ErrorActionPreference = 'Stop'
$betaRoot = $PSScriptRoot
$candidateExe = [IO.Path]::GetFullPath((Join-Path $betaRoot 'VANHSUB.exe'))
if (-not (Test-Path -LiteralPath $candidateExe -PathType Leaf)) { throw 'Không tìm thấy VANHSUB.exe cạnh launcher.' }
$running = @(Get-CimInstance Win32_Process -Filter "Name = 'VANHSUB.exe'" | Where-Object { $_.ExecutablePath -eq $candidateExe })
if ($running.Count -gt 0) { Write-Host 'Candidate này đang chạy; không mở instance thứ hai.'; return }
$profileRoot = Join-Path $betaRoot 'Beta-Profile'
$env:NODE_ENV = 'production'
$env:VANHSUB_AUDIT_USER_DATA_DIR = Join-Path $profileRoot 'user'
$env:VANHSUB_AI_STUDIO_DIR = Join-Path $profileRoot 'studio'
$env:VANHSUB_SETTINGS_DIR = Join-Path $profileRoot 'settings'
$env:VANHSUB_TASKS_DIR = Join-Path $profileRoot 'tasks'
$env:VANHSUB_BIBLE_DIR = Join-Path $profileRoot 'bible'
$env:VANHSUB_VOICE_SAMPLES_DIR = Join-Path $profileRoot 'samples'
$env:VANHSUB_DISABLE_FLOW_BRIDGE = '1'
$env:VANHSUB_ALLOW_INSECURE_TEST_SECRETS = '0'
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue
Start-Process -FilePath $candidateExe -WorkingDirectory $betaRoot
