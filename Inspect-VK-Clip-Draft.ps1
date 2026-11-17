# Read-only recovery inspection for the already-uploaded terrace clip.
$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
$origin = (& git -C $repo remote get-url origin).Trim()
if ($LASTEXITCODE -ne 0 -or $origin -ne 'https://github.com/Nikest20/solar-house-vk-feed.git') {
  throw 'Unexpected repository checkout.'
}
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
if ($identity -match '(NETWORK SERVICE|SYSTEM|LOCAL SERVICE)$') {
  throw 'Use your interactive Windows account.'
}
$node = (Get-Command node -ErrorAction Stop).Source
Write-Host 'READ ONLY: checking the existing VK clip draft; no file upload or publication.'
& $node (Join-Path $repo 'src\inspect-vk-clip-draft.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Clip inspection stopped; see diagnostics.' }
