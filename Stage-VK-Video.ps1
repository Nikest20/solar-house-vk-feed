# Interactive one-time VK Video staging. Never saves/publishes the wall post.
# Check mode by default; explicit -Upload selects the approved MP4 once.
param([switch]$Upload)
$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
$origin = (& git -C $repo remote get-url origin).Trim()
if ($LASTEXITCODE -ne 0 -or $origin -ne 'https://github.com/Nikest20/solar-house-vk-feed.git') {
  throw 'Unexpected GitHub checkout.'
}
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
if ($identity -match '(NETWORK SERVICE|SYSTEM|LOCAL SERVICE)$') {
  throw 'Use your interactive Windows account.'
}
$node = (Get-Command node -ErrorAction Stop).Source
$mode = if ($Upload) { '--stage' } else { '--check' }
Write-Host "SOLAR HOUSE VK Video: $mode; no wall post."
& $node (Join-Path $repo 'src\stage-vk-video-ui.mjs') $mode
if ($LASTEXITCODE -ne 0) { throw 'Video staging stopped. Do not retry after file selection without reviewing the journal.' }
