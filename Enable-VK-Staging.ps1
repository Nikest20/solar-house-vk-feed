# Enables uploading approved images to the VK album when this user logs in.
# No wall publication: separate GitHub variable VK_PUBLISH_ENABLED controls it.
$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
$taskName = 'SolarHouseVK-Stage-Approved-Photos'
$file = Join-Path $repo 'publisher.local.json'
$config = Get-Content -LiteralPath $file -Raw -Encoding utf8 | ConvertFrom-Json -AsHashtable
if ([string]$config['group_id'] -ne '211038294') { throw 'Wrong VK community ID.' }
if (-not (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)) { throw 'Run Setup-VK-Staging.ps1 first.' }
Write-Host 'Will automatically upload approved photos to the COMMUNITY ALBUM (not the wall).'
$answer = Read-Host 'Type YES to enable staged photo uploads'
if ($answer -cne 'YES') { Write-Host 'Cancelled'; exit 0 }
$config['staging_enabled'] = $true
$config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $file -Encoding utf8
Enable-ScheduledTask -TaskName $taskName | Out-Null
Write-Host 'Staging ENABLED. Cloud wall publishing is still separately disabled.'
