# Solar House VK: install approved images from the ZIP delivered in ChatGPT.
# This imports pictures into GitHub and pre-stages them in the VK community album.
# NEVER posts to the VK wall. Requires signed-in Windows Chrome VK profile.
param(
    [Parameter(Mandatory = $true)]
    [string]$Archive
)
$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
$expectedOrigin = 'https://github.com/Nikest20/solar-house-vk-feed.git'
$origin = (& git -C $repo remote get-url origin).Trim()
if ($LASTEXITCODE -ne 0 -or $origin -ne $expectedOrigin) {
    throw "Unexpected Git remote: $origin"
}
if (-not (Test-Path -LiteralPath $Archive -PathType Leaf)) {
    throw "ZIP file not found: $Archive"
}
$pending = @(& git -C $repo status --porcelain)
if ($LASTEXITCODE -ne 0 -or $pending.Count -gt 0) {
    throw 'Local checkout has uncommitted changes; review them before importing images.'
}
& git -C $repo pull --ff-only origin main
if ($LASTEXITCODE -ne 0) {
    throw 'Could not update queue from GitHub; no files were imported.'
}
$images = [ordered]@{
    '2026-11-27-kiln-dried-wood.jpg' = '2842b820f53b443dcf9fa13aecc3f40c4e87345b9bb0db1c4407cc02a6c60d79'
    '2026-11-29-winter-framing.jpg' = '6ab22a55361d0cbee5ee9def5f8c8019dcb23b5e5544513b5d9cac3c153c0a07'
    '2026-12-01-terrace-6x3.jpg' = '13da13980b1955330e42b35d486e9a48936851a8dc0e3c56ce5c456390dd54a4'
    '2026-12-03-double-height.jpg' = '0ac24aa1784be336bb43f5a8e88886c7c84d86b451b5cd19499d7e414c1c5de1'
}
$tmp = Join-Path $env:TEMP ('SolarHouseVK-images-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
try {
    Expand-Archive -LiteralPath $Archive -DestinationPath $tmp -Force
    # Verify every image BEFORE copying any image.
    foreach ($name in $images.Keys) {
        $source = Join-Path $tmp $name
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
            throw "Missing in archive: $name"
        }
        $hash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($hash -ne $images[$name]) {
            throw "Image checksum mismatch: $name. Do not import."
        }
        $dest = Join-Path (Join-Path $repo 'media') $name
        if (Test-Path -LiteralPath $dest -PathType Leaf) {
            $existing = (Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($existing -ne $hash) {
                throw "Different image already exists: $name. Review before overwriting."
            }
        }
    }
    foreach ($name in $images.Keys) {
        $source = Join-Path $tmp $name
        $dest = Join-Path (Join-Path $repo 'media') $name
        Copy-Item -LiteralPath $source -Destination $dest
        & git -C $repo add -- ('media/' + $name)
        if ($LASTEXITCODE -ne 0) { throw "Could not add $name to Git." }
    }
    $staged = (& git -C $repo diff --cached --name-only)
    if ($staged) {
        & git -C $repo commit -m 'VK: add approved illustrations for 27 Nov to 3 Dec 2026'
        if ($LASTEXITCODE -ne 0) { throw 'Git commit failed.' }
        & git -C $repo push origin main
        if ($LASTEXITCODE -ne 0) { throw 'Git push failed; do not repeat without checking local Git status.' }
    }
    Write-Host 'Four images verified and stored in GitHub.'
    Write-Host 'Pre-staging images in the VK album (no wall publication)...'
    & (Join-Path $repo 'Sync-VK-Staging.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'VK pre-staging command failed.' }
    # The default Sync-VK-Staging.ps1 uploads at most 3 pictures per call.
    & (Join-Path $repo 'Sync-VK-Staging.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'Second VK pre-staging command failed.' }
    Write-Host 'Image import and VK album staging completed. Check queue photo_attachment fields.'
}
finally {
    if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
}
