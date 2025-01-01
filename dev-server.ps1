param(
  [int]$Port = 9090
)

$ErrorActionPreference = 'Stop'
$root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }

Write-Host "[ps-dev-server] Root: $root"

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
Write-Host "[ps-dev-server] Serving http://127.0.0.1:$Port/"

function Get-ContentType($path) {
  switch ([System.IO.Path]::GetExtension($path).ToLower()) {
    '.html' { 'text/html; charset=utf-8' }
    '.js'   { 'text/javascript; charset=utf-8' }
    '.mjs'  { 'text/javascript; charset=utf-8' }
    '.css'  { 'text/css; charset=utf-8' }
    '.json' { 'application/json; charset=utf-8' }
    '.svg'  { 'image/svg+xml' }
    '.png'  { 'image/png' }
    '.jpg'  { 'image/jpeg' }
    '.jpeg' { 'image/jpeg' }
    '.ico'  { 'image/x-icon' }
    default { 'application/octet-stream' }
  }
}

while ($true) {
  $ctx = $listener.GetContext()
  try {
    $req = $ctx.Request
    $res = $ctx.Response
    $urlPath = $req.Url.AbsolutePath
    $localPath = [System.IO.Path]::Combine($root, $urlPath.TrimStart('/'))

    if (!(Test-Path -LiteralPath $localPath)) {
      $localPath = [System.IO.Path]::Combine($root, 'index.html')
    } elseif ((Get-Item -LiteralPath $localPath).PSIsContainer) {
      $idx = [System.IO.Path]::Combine($localPath, 'index.html')
      if (Test-Path -LiteralPath $idx) { $localPath = $idx } else { $localPath = [System.IO.Path]::Combine($root, 'index.html') }
    }

    $bytes = [System.IO.File]::ReadAllBytes($localPath)
    $ctype = Get-ContentType -path $localPath
    $res.Headers['Cache-Control'] = 'no-store'
    $res.ContentType = $ctype
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
    $res.StatusCode = 200
    $res.Close()
  } catch {
    try { $ctx.Response.StatusCode = 404; $ctx.Response.Close() } catch {}
  }
}