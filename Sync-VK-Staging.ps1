# Runs only under the signed-in Windows account which owns Chrome profile.
# Synchronizes approved posts and uploads photos to the community ALBUM only.
# Cloud publishing to the WALL is a completely separate, disabled-by-default job.
$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
$expectedOrigin = 'https://github.com/Nikest20/solar-house-vk-feed.git'
$origin = (& git -C $repo remote get-url origin).Trim()
if ($LASTEXITCODE -ne 0 -or $origin -ne $expectedOrigin) {
    throw "Git origin is not the expected Solar House VK repository: $origin"
}
$logDir = Join-Path $env:LOCALAPPDATA 'SolarHouseVkAuto\staging-task-logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$logFile = Join-Path $logDir ('stage-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.txt')
Start-Transcript -LiteralPath $logFile | Out-Null
try {
    Write-Host 'SOLAR HOUSE / VK: synchronizing approved posts from GitHub...'
    & git -C $repo pull --ff-only origin main
    if ($LASTEXITCODE -ne 0) { throw 'Cannot fast-forward GitHub queue; VK not touched.' }
    $node = (Get-Command node -ErrorAction Stop).Source
    & $node (Join-Path $repo 'src\offline-stage.mjs') --mode stage --git-push
    if ($LASTEXITCODE -ne 0) { throw 'Photo staging needs review; see the log. No wall post sent.' }
    Write-Host 'SOLAR HOUSE / VK: staging complete; no wall post sent.'
}
finally { Stop-Transcript | Out-Null }
