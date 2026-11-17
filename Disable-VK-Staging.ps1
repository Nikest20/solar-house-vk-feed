$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
$taskName = 'SolarHouseVK-Stage-Approved-Photos'
$file = Join-Path $repo 'publisher.local.json'
$config = Get-Content -LiteralPath $file -Raw -Encoding utf8 | ConvertFrom-Json -AsHashtable
if ([string]$config['group_id'] -ne '211038294') { throw 'Wrong VK community ID.' }
$config['staging_enabled'] = $false
$config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $file -Encoding utf8
Disable-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Out-Null
Write-Host 'Staging DISABLED. No wall publishing setting was changed.'
