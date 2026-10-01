# Conch, installed with one line on Windows (ADR 0026):
#
#   irm https://raw.githubusercontent.com/giotiskl/conch-agent/main/scripts/install.ps1 | iex
#
# It gets what Conch needs (Node.js and Git, when they're missing) into your
# own folders, builds Conch, keeps it running in the background, adds it to
# the Start menu and opens it. Nothing needs an administrator. Run it again
# any time: it updates Conch and repairs anything that moved.
#
# Options (set before running): $env:CONCH_NO_BACKGROUND, $env:CONCH_NO_SHORTCUT,
# $env:CONCH_NO_OPEN, $env:CONCH_UNINSTALL, $env:CONCH_DIR, $env:CONCH_REPO, $env:CONCH_BRANCH.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$NodeMajor = 24
$Repo = if ($env:CONCH_REPO) { $env:CONCH_REPO } else { 'https://github.com/giotiskl/conch-agent.git' }
$Branch = if ($env:CONCH_BRANCH) { $env:CONCH_BRANCH } else { 'main' }
$ConchHome = if ($env:CONCH_HOME) { $env:CONCH_HOME } else { Join-Path $HOME '.conch' }
$Dir = if ($env:CONCH_DIR) { $env:CONCH_DIR } else { Join-Path $env:LOCALAPPDATA 'Conch\app' }
$Runtime = Join-Path $ConchHome 'runtime'

function Say($text) { Write-Host "  $text" }
function Ok($text) { Write-Host '  ' -NoNewline; Write-Host ([char]0x2713) -ForegroundColor Green -NoNewline; Write-Host " $text" }
function Step($text) { Write-Host "  ... $text" -ForegroundColor DarkGray }
function Warn($text) { Write-Host '  ! ' -ForegroundColor Yellow -NoNewline; Write-Host $text }
function Fail($text, $hint) {
  Write-Host ''
  Write-Host "  x $text" -ForegroundColor Red
  if ($hint) { Write-Host "    $hint" }
  Write-Host ''
  throw $text
}

# Run a program quietly; on failure, show what it said.
function Quietly([string]$file, [string[]]$arguments) {
  $log = [IO.Path]::GetTempFileName()
  $process = Start-Process -FilePath $file -ArgumentList $arguments -NoNewWindow -Wait -PassThru `
    -RedirectStandardOutput $log -RedirectStandardError "$log.err"
  if ($process.ExitCode -ne 0) {
    Get-Content $log, "$log.err" -Tail 25 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "    $_" }
    Remove-Item $log, "$log.err" -ErrorAction SilentlyContinue
    return $false
  }
  Remove-Item $log, "$log.err" -ErrorAction SilentlyContinue
  return $true
}

Write-Host ''
Write-Host '  Conch' -ForegroundColor White
Write-Host ''

# ── Node.js ──────────────────────────────────────────────────────────────

function Test-Node($path) {
  if (-not $path -or -not (Test-Path $path)) { return $false }
  & $path -e "process.exit(Number(process.versions.node.split('.')[0]) >= $NodeMajor ? 0 : 1)" 2>$null
  return $LASTEXITCODE -eq 0
}

function Find-Node {
  $candidates = @(
    (Join-Path $Runtime 'node\node.exe'),
    (Get-Command node -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source),
    (Join-Path $env:ProgramFiles 'nodejs\node.exe')
  )
  foreach ($candidate in $candidates) { if (Test-Node $candidate) { return $candidate } }
  return $null
}

function Get-Node {
  $arch = if ([Environment]::Is64BitOperatingSystem) {
    if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  } else { Fail 'Conch needs 64-bit Windows.' }
  $base = "https://nodejs.org/dist/latest-v$NodeMajor.x"
  try { $sums = (Invoke-WebRequest -UseBasicParsing "$base/SHASUMS256.txt").Content }
  catch { Fail "Conch couldn't reach nodejs.org." 'Check your internet connection, then run this again.' }
  $line = $sums -split "`n" | Where-Object { $_ -match "  (node-v$NodeMajor\.[0-9.]+-win-$arch\.zip)$" } | Select-Object -First 1
  if (-not $line) { Fail "nodejs.org has no Node.js $NodeMajor for this computer." 'Install it from https://nodejs.org, then run this again.' }
  $want, $file = $line.Trim() -split '\s+'
  $zip = Join-Path ([IO.Path]::GetTempPath()) $file
  Invoke-WebRequest -UseBasicParsing "$base/$file" -OutFile $zip
  # The checksum list and the download must agree, byte for byte.
  if ((Get-FileHash $zip -Algorithm SHA256).Hash.ToLower() -ne $want.ToLower()) {
    Remove-Item $zip
    Fail "The Node.js download didn't match its checksum, so Conch threw it away." 'Run this again; if it keeps happening, your network may be changing downloads.'
  }
  New-Item -ItemType Directory -Force $Runtime | Out-Null
  Expand-Archive $zip -DestinationPath $Runtime -Force
  Remove-Item $zip
  $unpacked = Join-Path $Runtime ($file -replace '\.zip$', '')
  $link = Join-Path $Runtime 'node'
  if (Test-Path $link) { Remove-Item $link -Recurse -Force }
  Rename-Item $unpacked 'node'
}

# ── Git ──────────────────────────────────────────────────────────────────

function Find-Git {
  $found = Get-Command git -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source
  if ($found) { return $found }
  $mingit = Join-Path $Runtime 'git\cmd\git.exe'
  if (Test-Path $mingit) { return $mingit }
  return $null
}

# MinGit (Git for Windows' portable build) into Conch's own folder, checked against GitHub's digest.
function Get-Git {
  $release = Invoke-RestMethod -UseBasicParsing 'https://api.github.com/repos/git-for-windows/git/releases/latest' `
    -Headers @{ 'User-Agent' = 'conch-installer' }
  $asset = $release.assets | Where-Object { $_.name -match '^MinGit-[0-9.]+-64-bit\.zip$' } | Select-Object -First 1
  if (-not $asset) { Fail "Conch couldn't find Git to download." 'Install Git from https://git-scm.com, then run this again.' }
  $zip = Join-Path ([IO.Path]::GetTempPath()) $asset.name
  Invoke-WebRequest -UseBasicParsing $asset.browser_download_url -OutFile $zip
  if ($asset.digest -match '^sha256:([0-9a-f]+)$') {
    if ((Get-FileHash $zip -Algorithm SHA256).Hash.ToLower() -ne $Matches[1]) {
      Remove-Item $zip
      Fail "The Git download didn't match its checksum, so Conch threw it away." 'Run this again.'
    }
  }
  $target = Join-Path $Runtime 'git'
  if (Test-Path $target) { Remove-Item $target -Recurse -Force }
  Expand-Archive $zip -DestinationPath $target -Force
  Remove-Item $zip
}

function Invoke-Pnpm([string[]]$arguments) {
  $env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
  $corepack = Join-Path (Split-Path $script:Node) 'corepack.cmd'
  if (Test-Path $corepack) { return Quietly $corepack (@('pnpm') + $arguments) }
  $npx = Join-Path (Split-Path $script:Node) 'npx.cmd'
  return Quietly $npx (@('--yes', 'pnpm') + $arguments)
}

function Invoke-Conch([string[]]$arguments) {
  Push-Location $Dir
  try {
    $env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
    $corepack = Join-Path (Split-Path $script:Node) 'corepack.cmd'
    $output = & $corepack pnpm --silent --filter '@conch/server' conch @arguments 2>&1
    return @{ Ok = ($LASTEXITCODE -eq 0); Output = ($output -join "`n") }
  } finally { Pop-Location }
}

# ── Uninstall ────────────────────────────────────────────────────────────

$script:Node = Find-Node
if ($env:CONCH_UNINSTALL) {
  if ($script:Node -and (Test-Path (Join-Path $Dir 'package.json'))) {
    $env:PATH = "$(Split-Path $script:Node);$env:PATH"
    Invoke-Conch @('quit') | Out-Null
    Invoke-Conch @('background', 'off') | Out-Null
    Invoke-Conch @('shortcut', 'remove') | Out-Null
    Ok "Conch has stopped and won't start when you sign in"
  }
  if (Test-Path $Dir) { Remove-Item $Dir -Recurse -Force }
  Ok "Removed Conch from $Dir"
  Say "Your chats and settings are still in $ConchHome, for when you come back."
  Write-Host ''
  return
}

# ── Install ──────────────────────────────────────────────────────────────

if ($script:Node -and -not $env:CONCH_FORCE_NODE_DOWNLOAD) {
  Ok "Node.js $((& $script:Node -v).TrimStart('v'))"
} else {
  Step "Getting Node.js $NodeMajor"
  Get-Node
  $script:Node = Join-Path $Runtime 'node\node.exe'
  Ok "Node.js $((& $script:Node -v).TrimStart('v')) (in $Runtime)"
}
$env:PATH = "$(Split-Path $script:Node);$env:PATH"

$git = Find-Git
if (-not $git) {
  Step 'Getting Git'
  Get-Git
  $git = Find-Git
}
$env:PATH = "$(Split-Path $git);$env:PATH"
Ok 'Git'

if (Test-Path (Join-Path $Dir '.git')) {
  Step 'Updating Conch'
  $changes = & $git -C $Dir status --porcelain --untracked-files=no
  if ($changes) { Warn "Conch's folder has changes of its own, so it stays as it is." }
  elseif (-not (Quietly $git @('-C', "`"$Dir`"", 'pull', '--ff-only'))) {
    Warn "Conch couldn't update just now; it carries on with the version it has."
  }
} else {
  Step 'Getting Conch'
  New-Item -ItemType Directory -Force (Split-Path $Dir) | Out-Null
  if (-not (Quietly $git @('clone', '--branch', $Branch, $Repo, "`"$Dir`""))) {
    Fail "Conch couldn't be downloaded." 'Check your internet connection, then run this again.'
  }
}
Ok "Conch (in $Dir)"

Step 'Installing what Conch uses (a minute or two the first time)'
Push-Location $Dir
try {
  if (-not (Invoke-Pnpm @('install', '--frozen-lockfile'))) { Fail "Installing didn't finish." 'Run this again; the lines above say what went wrong.' }
  Step 'Building the app'
  if (-not (Invoke-Pnpm @('--filter', '@conch/web', 'build'))) { Fail "Building Conch didn't finish." 'Run this again; the lines above say what went wrong.' }
} finally { Pop-Location }
Ok 'Installed'

if (-not $env:CONCH_NO_SHORTCUT) {
  $result = Invoke-Conch @('shortcut')
  if ($result.Ok) { Ok 'Conch is in the Start menu' } else { Warn "Conch couldn't add itself to the Start menu; open it at http://localhost:4317." }
}

$url = 'http://localhost:4317'
if (-not $env:CONCH_NO_BACKGROUND) {
  Step 'Starting Conch'
  $result = Invoke-Conch @('background', 'on')
  if (-not $result.Ok) {
    $result.Output -split "`n" | ForEach-Object { Write-Host "    $_" }
    Fail "Conch didn't start." "Run it by hand to see why: cd `"$Dir`"; corepack pnpm start"
  }
  if ($result.Output -match '(http://\S+)') { $url = $Matches[1] }
  Ok 'Conch is running, and starts by itself when you sign in'
}

Write-Host ''
Write-Host "  Conch is ready at $url" -ForegroundColor White
if (-not $env:CONCH_NO_BACKGROUND) { Say 'Open it any time from the Start menu: just type Conch.' }
else { Say "Start it with: cd `"$Dir`"; corepack pnpm start" }
Write-Host ''
if (-not $env:CONCH_NO_OPEN -and -not $env:CONCH_NO_BACKGROUND) { Start-Process $url }
