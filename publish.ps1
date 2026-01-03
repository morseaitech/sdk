
Write-Host "Installing dependencies..." -ForegroundColor Cyan
npm install

if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to install dependencies!" -ForegroundColor Red
    exit 1
}

Write-Host "Dependencies installed!" -ForegroundColor Green

Write-Host "Building MORSE SDK..." -ForegroundColor Cyan
npm run build

if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed!" -ForegroundColor Red
    exit 1
}

Write-Host "Build completed!" -ForegroundColor Green

Write-Host "Checking package contents..." -ForegroundColor Cyan
npm pack --dry-run

Write-Host ""
$confirm = Read-Host "Publish to npm? (y/n)"

if ($confirm -eq "y" -or $confirm -eq "Y") {
    Write-Host "Publishing to npm..." -ForegroundColor Cyan
    npm publish --tag beta --access public
    
    if ($LASTEXITCODE -eq 0) {
        # Read version from package.json
        $packageJson = Get-Content package.json | ConvertFrom-Json
        $version = $packageJson.version
        
        Write-Host "Published successfully!" -ForegroundColor Green
        Write-Host ""
        Write-Host "Package: @morseai/sdk@$version" -ForegroundColor Yellow
        Write-Host "Install: npm install @morseai/sdk@beta" -ForegroundColor Yellow
    }
    else {
        Write-Host "Publication failed!" -ForegroundColor Red
        exit 1
    }
}
else {
    Write-Host "Publication cancelled" -ForegroundColor Yellow
}
