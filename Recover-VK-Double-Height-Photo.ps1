# One-time recovery: associate an already-uploaded, user-confirmed VK photo.
# Does not upload a new photo or post anything to the wall.
$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
$originExpected = 'https://github.com/Nikest20/solar-house-vk-feed.git'
$origin = (& git -C $repo remote get-url origin).Trim()
if ($LASTEXITCODE -ne 0 -or $origin -ne $originExpected) { throw 'Unexpected Git origin.' }
if ((@(& git -C $repo status --porcelain)).Count -gt 0) {
    throw 'Git checkout has local changes; inspect before recovery.'
}
& git -C $repo pull --ff-only origin main
if ($LASTEXITCODE -ne 0) { throw 'Git pull failed; nothing changed.' }

$id = 'solar-house-double-height-20261203'
$photo = 'photo-211038294_457240977'
$url = 'https://vk.ru/' + $photo
$expectedImageHash = '0ac24aa1784be336bb43f5a8e88886c7c84d86b451b5cd19499d7e414c1c5de1'
$root = Join-Path $env:LOCALAPPDATA 'SolarHouseVkAuto'
$stateFile = Join-Path $root 'photo-staging-state\solar-house-double-height-20261203.json'
$evidenceFile = Join-Path $root 'upload-diagnostics\2026-11-23T12-37-56-343Z\result.json'
$queueFile = Join-Path $repo 'queue\2026-12-03-double-height.json'
$imageFile = Join-Path $repo 'media\2026-12-03-double-height.jpg'
$configFile = Join-Path $repo 'publisher.local.json'
$lockFile = Join-Path $root 'photo-staging-state\.stage-running.lock'

foreach ($file in @($stateFile, $evidenceFile, $queueFile, $imageFile, $configFile)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required file missing: $file" }
}
if (Test-Path -LiteralPath $lockFile) {
    throw 'Staging lock exists. Check whether an earlier upload process is still running; no recovery performed.'
}
$state = Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json -AsHashtable
$evidence = Get-Content -LiteralPath $evidenceFile -Raw -Encoding UTF8 | ConvertFrom-Json -AsHashtable
$post = Get-Content -LiteralPath $queueFile -Raw -Encoding UTF8 | ConvertFrom-Json -AsHashtable
$config = Get-Content -LiteralPath $configFile -Raw -Encoding UTF8 | ConvertFrom-Json -AsHashtable

if ($state.post_id -ne $id -or $state.status -ne 'upload-attempted' -or
    $state.image_sha256 -ne $expectedImageHash) {
    throw 'State is not the expected interrupted upload; do not overwrite it.'
}
if ($evidence.mode -ne 'read-only-inspect' -or $evidence.status -ne 'album-ids-read' -or
    $evidence.photos_visible -lt 59 -or
    $evidence.recent_photo_candidates -notcontains $url -or
    ([DateTimeOffset]::Parse($evidence.started_at) -le [DateTimeOffset]::Parse($state.created_at_utc))) {
    throw 'Read-only album inspection does not confirm the new photo.'
}
if ($post.id -ne $id -or $post.status -ne 'approved' -or
    $post.image -ne '2026-12-03-double-height.jpg' -or
    $post.publish_at -ne '2026-12-03T10:00:00+03:00' -or
    $post.approved_image_sha256 -ne $expectedImageHash -or
    $post.ContainsKey('photo_attachment') -or $post.ContainsKey('staged_content_sha256')) {
    throw 'Queue entry has changed or is already staged; no recovery performed.'
}
if ($config.staging_enabled -ne $true) {
    throw 'Local photo staging is disabled; no recovery performed.'
}
$imageHash = (Get-FileHash -LiteralPath $imageFile -Algorithm SHA256).Hash.ToLowerInvariant()
if ($imageHash -ne $expectedImageHash) { throw 'Media image does not match approved image.' }
$contentBytes = [Text.Encoding]::UTF8.GetBytes("$($post.id)`n$($post.text)`n$($post.image)")
$contentHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($contentBytes)).ToLowerInvariant()
if ($contentHash -ne $state.content_sha256) { throw 'Text or image reference changed after upload attempt.' }

$allQueue = Get-ChildItem -LiteralPath (Join-Path $repo 'queue') -Filter '*.json' -File
foreach ($q in $allQueue) {
    if ($q.FullName -eq $queueFile) { continue }
    $other = Get-Content -LiteralPath $q.FullName -Raw -Encoding UTF8 | ConvertFrom-Json -AsHashtable
    if ($other.photo_attachment -eq $photo) { throw 'This VK photo is already bound to a different queue entry.' }
}

Write-Host 'Album inspection shows one new photo, ID 457240977.'
Write-Host "OPEN AND CHECK THE PICTURE: $url"
Write-Host 'It MUST show the approved double-height living room interior (Vtoroy svet).'
$answer = Read-Host 'If visually correct, type YES to link this existing photo without another upload'
if ($answer -cne 'YES') { Write-Host 'Cancelled: no changes.'; exit 0 }

$state.status = 'photo-uploaded'
$state.photo_attachment = $photo
$state.confirmed_from_album_url = $url
$state.confirmed_at_utc = [DateTimeOffset]::UtcNow.ToString('o')
$tempState = "$stateFile.recovered.tmp"
$state | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $tempState -Encoding UTF8
Move-Item -LiteralPath $tempState -Destination $stateFile -Force
Write-Host 'Existing photo ID has been safely confirmed in local staging state.'
Write-Host 'Completing staging via the existing pipeline (no additional photo upload)...'
& (Join-Path $repo 'Sync-VK-Staging.ps1')
Write-Host 'Recovery requested. Check queue/2026-12-03-double-height.json for photo_attachment and staging hashes.'
