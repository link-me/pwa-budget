Param(
  [int]$Port = 8050
)

Write-Host "Starting PWA Budget API on port $Port"

Push-Location "$PSScriptRoot"

if (!(Test-Path package.json)) {
  Write-Host "package.json not found" -ForegroundColor Yellow
}

if (!(Test-Path node_modules)) {
  Write-Host "Installing dependencies..." -ForegroundColor Cyan
  npm install | Out-Host
}

$env:PORT = "$Port"
node index.js

Pop-Location