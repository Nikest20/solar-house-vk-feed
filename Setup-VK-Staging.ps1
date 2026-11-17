# One-time setup, run in a normal interactive PowerShell session (not as admin).
# Requires Git for Windows + Node.js and a clone inside SolarHouseVK.
$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
$expected = Join-Path $env:USERPROFILE 'SolarHouseVK\publisher-cloud'
$taskName = 'SolarHouseVK-Stage-Approved-Photos'
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
if (-not (Test-Path -LiteralPath (Join-Path $repo '.git') -PathType Container)) {
    throw 'Launch this file from a git clone, not a ZIP copy.'
}
if ((Resolve-Path -LiteralPath $repo).Path -ne $expected) {
    throw "Expected a checkout at $expected, got $repo"
}
if ($identity -match '(NETWORK SERVICE|SYSTEM|LOCAL SERVICE)$') {
    throw 'Run as the signed-in Windows account, not the GitHub Runner service.'
}
$git = (Get-Command git -ErrorAction Stop).Source
$node = (Get-Command node -ErrorAction Stop).Source
$pwsh = (Get-Command pwsh -ErrorAction Stop).Source
$nodeMajor = [int]((& $node --version).Trim() -replace '^v(\d+).*$', '$1')
if ($nodeMajor -lt 22) { throw 'Node.js 22 or newer is required.' }
$origin = (& $git -C $repo remote get-url origin).Trim()
if ($LASTEXITCODE -ne 0 -or $origin -ne 'https://github.com/Nikest20/solar-house-vk-feed.git') {
    throw "Unexpected git remote: $origin"
}
$configFile = Join-Path $repo 'publisher.local.json'
if (-not (Test-Path -LiteralPath $configFile -PathType Leaf)) {
    $localConfig = [ordered]@{ group_id = '211038294'; staging_enabled = $false }
    $localConfig | ConvertTo-Json | Set-Content -LiteralPath $configFile -Encoding utf8
}
$config = Get-Content -LiteralPath $configFile -Raw -Encoding utf8 | ConvertFrom-Json -AsHashtable
if ([string]$config['group_id'] -ne '211038294') { throw 'Wrong VK community ID in local config.' }
New-Item -ItemType Directory -Path (Join-Path $repo 'media') -Force | Out-Null
$profile = Join-Path $env:LOCALAPPDATA 'SolarHouseVkAuto\browser-profile'
if (-not (Test-Path -LiteralPath $profile -PathType Container)) {
    throw "Chrome profile used in successful VK uploads is missing: $profile"
}
Write-Host 'Checking local queue without contacting VK...'
& $node (Join-Path $repo 'src\offline-stage.mjs') --mode preview
if ($LASTEXITCODE -ne 0) { throw 'Local staging preview failed.' }

# Validate GitHub write access without making a real commit or push.
Write-Host 'Checking GitHub write authentication (browser sign-in may appear)...'
& $git -C $repo push --dry-run origin HEAD:refs/heads/main
if ($LASTEXITCODE -ne 0) { throw 'GitHub write authentication failed. No scheduled task was created.' }
& $git -C $repo config user.name 'SolarHouseVK-staging'
& $git -C $repo config user.email '125212944+Nikest20@users.noreply.github.com'

# Only the owner account can use the existing interactive Chrome profile.
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$script = Join-Path $repo 'Sync-VK-Staging.ps1'
$action = New-ScheduledTaskAction -Execute $pwsh -Argument ('-NoLogo -NoProfile -File "' + $script + '"') -WorkingDirectory $repo
$atLogon = New-ScheduledTaskTrigger -AtLogOn -User $identity
$hourly = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration (New-TimeSpan -Days 365)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 6)
$old = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($old) {
    $oldExe = [string]$old.Actions[0].Execute
    $oldArgs = [string]$old.Actions[0].Arguments
    if ($oldExe -ne $pwsh -or -not $oldArgs.Contains($script)) {
        throw "Existing task $taskName points somewhere else. Refusing to overwrite it."
    }
}

# The task is set up disabled until the operator explicitly arms photo staging.
$config['staging_enabled'] = $false
$config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $configFile -Encoding utf8
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($atLogon, $hourly) -Principal $principal -Settings $settings -Force | Out-Null
Disable-ScheduledTask -TaskName $taskName | Out-Null
Write-Host ''
Write-Host 'SOLAR HOUSE / VK — WINDOWS STAGING INSTALLED' -ForegroundColor Green
Write-Host "Account: $identity; task: $taskName; status: DISABLED"
Write-Host 'Ready for a separate authorization to upload APPROVED photos into the community ALBUM.'
Write-Host 'Nothing was posted to the wall, and no photo was uploaded.'
