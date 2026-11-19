# Recovery for the already-approved Nov 19 terrace clip. Read-only by default.
# -Publish allows one single fresh upload and a single Publish click after live
# duplicate checks. Never delete either attempt journal to force a retry.
param([switch]$Publish)
$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
$origin = (& git -C $repo remote get-url origin).Trim()
if ($LASTEXITCODE -ne 0 -or $origin -ne 'https://github.com/Nikest20/solar-house-vk-feed.git') {
  throw 'Unexpected GitHub checkout.'
}
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
if ($identity -match '(NETWORK SERVICE|SYSTEM|LOCAL SERVICE)$') {
  throw 'Run this under your interactive Windows account.'
}
$node = (Get-Command node -ErrorAction Stop).Source
$mode = if ($Publish) { '--publish' } else { '--check' }
Write-Host "SOLAR HOUSE VK Terrace clip recovery: $mode"
& $node (Join-Path $repo 'src\recover-vk-terrace-clip.mjs') $mode
if ($LASTEXITCODE -ne 0) { throw 'Recovery stopped; review diagnostics. Never rerun -Publish after a file was selected.' }
