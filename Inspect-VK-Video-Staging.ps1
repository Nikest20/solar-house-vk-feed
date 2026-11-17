# READ-ONLY: inspect the VK video upload UI using the same signed-in profile
# used by successful photo staging. No file chooser or wall publishing.
$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
$expected = 'https://github.com/Nikest20/solar-house-vk-feed.git'
$origin = (& git -C $repo remote get-url origin).Trim()
if ($LASTEXITCODE -ne 0 -or $origin -ne $expected) { throw 'Unexpected repository checkout.' }
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
if ($identity -match '(NETWORK SERVICE|SYSTEM|LOCAL SERVICE)$') { throw 'Use your interactive Windows account.' }
$node = (Get-Command node -ErrorAction Stop).Source
Write-Host 'READ ONLY: checking community video upload UI; no VK uploads or wall posts.'
& $node (Join-Path $repo 'src\inspect-vk-video-ui.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Inspect failed; please send the text output for diagnosis.' }
