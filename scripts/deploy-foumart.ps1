# Build apple2js and copy //e embed assets to foumartgames.com/extensions/AppleIIe
#
# Usage (from apple2js repo root):
#   npm run deploy:foumart
#   npm run deploy:foumart -- -SkipBuild
#   powershell -File scripts/deploy-foumart.ps1 -Target "D:\sites\extensions\AppleIIe"
#
param(
    [string]$Target = "C:\DATA\HTTP\www.foumartgames.com\extensions\AppleIIe",
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

if (-not (Test-Path $Target)) {
    Write-Error "Deploy target not found: $Target"
}

Push-Location $Root
try {
    if (-not $SkipBuild) {
        Write-Host "Building apple2js (production)..." -ForegroundColor Cyan
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "npm run build failed with exit code $LASTEXITCODE" }
    } else {
        Write-Host "Skipping build (-SkipBuild)." -ForegroundColor Yellow
    }

    $copies = @(
        @{ Src = "dist\main2e.bundle.js";          Dst = "dist\main2e.bundle.js" },
        @{ Src = "dist\preact.bundle.js";          Dst = "dist\preact.bundle.js" },
        @{ Src = "dist\audio_worker.bundle.js";    Dst = "dist\audio_worker.bundle.js" },
        @{ Src = "dist\format_worker.bundle.js";   Dst = "dist\format_worker.bundle.js" },
        @{ Src = "css\apple2.css";                 Dst = "css\apple2.css" },
        @{ Src = "apple2jse.html";                 Dst = "index.html" }
    )

    foreach ($item in $copies) {
        $srcPath = Join-Path $Root $item.Src
        $dstPath = Join-Path $Target $item.Dst
        if (-not (Test-Path $srcPath)) {
            throw "Missing build output: $srcPath (run npm run build first)"
        }
        $dstDir = Split-Path -Parent $dstPath
        if (-not (Test-Path $dstDir)) {
            New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
        }
        Copy-Item -Force $srcPath $dstPath
        Write-Host "  copied $($item.Src) -> $Target\$($item.Dst)" -ForegroundColor Green
    }

    # CSS fonts and sprites referenced by apple2.css (relative paths under css/)
    $cssAssets = @(
        "css\ApplePrintChar21.ttf",
        "js\components\css\apple-2a-scanline.otf"
    )
    foreach ($rel in $cssAssets) {
        $srcPath = Join-Path $Root $rel
        if (-not (Test-Path $srcPath)) { continue }
        $name = Split-Path -Leaf $rel
        $dstPath = Join-Path $Target "css\$name"
        Copy-Item -Force $srcPath $dstPath
        Write-Host "  copied $rel -> $Target\css\$name" -ForegroundColor Green
    }

    Get-ChildItem -Path (Join-Path $Root "css") -Filter "*.png" -File -ErrorAction SilentlyContinue | ForEach-Object {
        $dstPath = Join-Path $Target "css\$($_.Name)"
        Copy-Item -Force $_.FullName $dstPath
        Write-Host "  copied css\$($_.Name) -> $Target\css\$($_.Name)" -ForegroundColor Green
    }

    Write-Host ""
    Write-Host "Deploy complete -> $Target" -ForegroundColor Cyan
}
finally {
    Pop-Location
}
