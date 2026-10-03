# Conch, installed with one line on Windows (ADR 0026):
#
#   irm https://conchagent.com/install.ps1 | iex
#
# (the same file as scripts/install.ps1 on GitHub, served by the website)
#
# It gets what Conch needs (Node.js and Git, when they're missing) into your
# own folders, builds Conch, keeps it running in the background, adds it to
# the Start menu and opens it. Nothing needs an administrator. It installs
# the newest stable release (ADR 0051), checked against the signing keys
# Conch ships; after that Conch updates itself. Run it again any time: it
# repairs anything that moved.
#
# Options (set before running): $env:CONCH_NO_BACKGROUND, $env:CONCH_NO_SHORTCUT,
# $env:CONCH_NO_OPEN, $env:CONCH_UNINSTALL, $env:CONCH_DIR, $env:CONCH_REPO,
# $env:CONCH_CHANNEL (beta or alpha: also take those releases),
# $env:CONCH_BRANCH (a developer's copy: follow a branch, every change),
# $env:CONCH_SERVER (a little computer: no browser; then `conch setup` asks how you'll reach it),
# $env:CONCH_DOMAIN (on a server, at an address of your own, over HTTPS by Conch itself: ADR 0064).

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$NodeMajor = 24
$Repo = if ($env:CONCH_REPO) { $env:CONCH_REPO } else { 'https://github.com/georgevibing/conch-agent.git' }
$Branch = if ($env:CONCH_BRANCH) { $env:CONCH_BRANCH } else { 'main' }
$Channel = if ($env:CONCH_CHANNEL) { $env:CONCH_CHANNEL } else { 'stable' }
if ($Channel -notin @('stable', 'beta', 'alpha')) { throw "CONCH_CHANNEL can be stable, beta or alpha (not $Channel)." }
$ConchHome = if ($env:CONCH_HOME) { $env:CONCH_HOME } else { Join-Path $HOME '.conch' }
$Dir = if ($env:CONCH_DIR) { $env:CONCH_DIR } else { Join-Path $env:LOCALAPPDATA 'Conch\app' }
$Runtime = Join-Path $ConchHome 'runtime'
if ($env:CONCH_DOMAIN) { $env:CONCH_SERVER = '1' }
if ($env:CONCH_SERVER) { $env:CONCH_NO_OPEN = '1'; $env:CONCH_NO_SHORTCUT = '1' }

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

# ── Releases (ADR 0051) ──────────────────────────────────────────────────

# The release to install from a list of tags: vX.Y.Z is stable, vX.Y.Z-beta.N
# and vX.Y.Z-alpha.N are pre-releases. Stable takes only stable, beta also
# betas, alpha everything; the newest wins, in semver's order.
function Select-Release([string[]]$tags, [string]$channel) {
  $num = '(0|[1-9][0-9]{0,5})'
  $best = $null; $bestKey = $null
  foreach ($tag in $tags) {
    $m = [regex]::Match("$tag".Trim(), "^v$num\.$num\.$num(?:-(alpha|beta)\.([1-9][0-9]{0,4}))?$")
    if (-not $m.Success) { continue }
    $kind = $m.Groups[4].Value
    if ($kind -eq 'beta' -and $channel -eq 'stable') { continue }
    if ($kind -eq 'alpha' -and $channel -ne 'alpha') { continue }
    $rank = if ($kind -eq 'beta') { 2 } elseif ($kind -eq 'alpha') { 1 } else { 3 }
    $n = if ($kind) { [int]$m.Groups[5].Value } else { 0 }
    $key = '{0:D6} {1:D6} {2:D6} {3} {4:D5}' -f [int]$m.Groups[1].Value, [int]$m.Groups[2].Value, [int]$m.Groups[3].Value, $rank, $n
    if (-not $bestKey -or [string]::CompareOrdinal($key, $bestKey) -gt 0) { $best = "$tag".Trim(); $bestKey = $key }
  }
  return $best
}

# The release must be signed by a key Conch's own list names. On a first
# install that list comes from the same place as the release (GitHub, over
# HTTPS), so this catches a tag never signed, or signed by someone else;
# after that, Conch checks every update against the list it already has.
function Confirm-Release([string]$tag) {
  $signers = Join-Path $Dir 'release\allowed_signers'
  $keys = if (Test-Path $signers) { Get-Content $signers | Where-Object { $_ -match '^[^#]*(ssh-ed25519|ssh-rsa|ecdsa-sha2-|sk-ssh-ed25519|sk-ecdsa-sha2-)' } }
  if (-not $keys) { Warn "Conch doesn't name its signing keys yet, so this release's signature can't be checked."; return }
  $keygen = Get-Command ssh-keygen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source
  if (-not $keygen) {
    $bundled = Join-Path (Split-Path (Split-Path $git)) 'usr\bin\ssh-keygen.exe'
    if (Test-Path $bundled) { $keygen = $bundled }
  }
  $version = [regex]::Match((& $git --version), '(\d+)\.(\d+)')
  $recent = $version.Success -and ([int]$version.Groups[1].Value -gt 2 -or ([int]$version.Groups[1].Value -eq 2 -and [int]$version.Groups[2].Value -ge 34))
  if (-not $keygen -or -not $recent) { Warn "This computer's Git can't check signatures (it needs Git 2.34 and ssh-keygen), so the release isn't checked."; return }
  $ok = Quietly $git @('-C', "`"$Dir`"", '-c', 'gpg.format=ssh', '-c', "`"gpg.ssh.allowedSignersFile=$signers`"", '-c', "`"gpg.ssh.program=$keygen`"", 'verify-tag', $tag)
  if (-not $ok) {
    Remove-Item $Dir -Recurse -Force -ErrorAction SilentlyContinue
    Fail "This release of Conch isn't signed by Conch's makers, so the installer stopped." "Nothing of yours was changed. Try again later, or tell Conch's makers."
  }
}

# Conch's version, as its folder writes it.
function Get-ConchVersion([string]$folder) {
  try { return (Get-Content (Join-Path $folder 'package.json') -Raw | ConvertFrom-Json).version } catch { return '' }
}

function Invoke-Pnpm([string[]]$arguments) {
  $env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
  $corepack = Join-Path (Split-Path $script:Node) 'corepack.cmd'
  if (Test-Path $corepack) { return Quietly $corepack (@('pnpm') + $arguments) }
  $npx = Join-Path (Split-Path $script:Node) 'npx.cmd'
  return Quietly $npx (@('--yes', 'pnpm') + $arguments)
}

function Invoke-Conch([string[]]$arguments) {
  Push-Location $RunDir
  try {
    $env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
    $corepack = Join-Path (Split-Path $script:Node) 'corepack.cmd'
    $output = & $corepack pnpm --silent --filter '@conch/server' conch @arguments 2>&1
    return @{ Ok = ($LASTEXITCODE -eq 0); Output = ($output -join "`n") }
  } finally { Pop-Location }
}

# ── Uninstall ────────────────────────────────────────────────────────────

$RunDir = $Dir
$script:Node = Find-Node
if ($env:CONCH_UNINSTALL) {
  if ($script:Node -and (Test-Path (Join-Path $Dir 'package.json'))) {
    $env:PATH = "$(Split-Path $script:Node);$env:PATH"
    Invoke-Conch @('quit') | Out-Null
    Invoke-Conch @('background', 'off') | Out-Null
    Invoke-Conch @('shortcut', 'remove') | Out-Null
    Invoke-Conch @('tray', 'off') | Out-Null
    Invoke-Conch @('command', 'off') | Out-Null
    Ok "Conch has stopped and won't start when you sign in"
  }
  if (Test-Path $Dir) { Remove-Item $Dir -Recurse -Force }
  # The versions Conch's updates made ready (ADR 0051) are Conch's code, not your data.
  $versions = Join-Path $ConchHome 'versions'
  if (Test-Path $versions) { Remove-Item $versions -Recurse -Force }
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
  # A release swapped in by Conch's own updates is the one that runs (ADR 0051).
  $pointer = Join-Path $ConchHome 'versions\current'
  $current = if (Test-Path $pointer) { (Get-Content $pointer -TotalCount 1).Trim() } else { '' }
  & $git -C $Dir symbolic-ref -q HEAD *> $null
  $onBranch = $LASTEXITCODE -eq 0
  if ($current -and (Test-Path (Join-Path $current 'apps\server\src\start.ts'))) {
    $RunDir = $current
    Say 'Conch updates itself: Settings > Health > Updates.'
  } elseif (-not $onBranch) {
    Say 'Conch updates itself: Settings > Health > Updates.'
  } else {
    Step 'Updating Conch'
    $changes = & $git -C $Dir status --porcelain --untracked-files=no
    if ($changes) { Warn "Conch's folder has changes of its own, so it stays as it is." }
    elseif (-not (Quietly $git @('-C', "`"$Dir`"", 'pull', '--ff-only'))) {
      Warn "Conch couldn't update just now; it carries on with the version it has."
    }
  }
} else {
  Step $(if ($env:CONCH_BRANCH) { "Getting Conch ($Branch)" } else { 'Getting Conch' })
  New-Item -ItemType Directory -Force (Split-Path $Dir) | Out-Null
  if (-not (Quietly $git @('clone', '--branch', $Branch, $Repo, "`"$Dir`""))) {
    Fail "Conch couldn't be downloaded." 'Check your internet connection, then run this again.'
  }
  if ($env:CONCH_BRANCH) {
    # A developer's copy: this branch, every change on it.
    & $git -C $Dir config conch.follow branch
  } else {
    $tag = Select-Release @(& $git -C $Dir tag -l 'v*') $Channel
    if ($tag) {
      Confirm-Release $tag
      if (-not (Quietly $git @('-C', "`"$Dir`"", '-c', 'advice.detachedHead=false', 'checkout', '--quiet', '--detach', $tag))) {
        Fail "Conch couldn't open release $tag." 'Run this again; the lines above say what went wrong.'
      }
      if ($Channel -ne 'stable') { & $git -C $Dir config conch.channel $Channel }
    } else {
      # Before Conch's first release, it follows main, as it always did.
      Say 'Conch has no releases yet, so it follows every change.'
    }
  }
}
Ok "Conch $(Get-ConchVersion $RunDir) (in $RunDir)"

Step 'Installing what Conch uses (a minute or two the first time)'
Push-Location $RunDir
try {
  if (-not (Invoke-Pnpm @('install', '--frozen-lockfile'))) { Fail "Installing didn't finish." 'Run this again; the lines above say what went wrong.' }
  Step 'Building the app'
  if (-not (Invoke-Pnpm @('--filter', '@conch/web', 'build'))) { Fail "Building Conch didn't finish." 'Run this again; the lines above say what went wrong.' }
} finally { Pop-Location }
Ok 'Installed'

# The conch command, in every terminal from now on.
if ((Invoke-Conch @('command', 'on')).Ok) { Ok 'The conch command is ready' }
else { Warn "The conch command couldn't be added; corepack pnpm conch works in $Dir." }

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

if ($env:CONCH_SERVER) {
  # The conversation (ADR 0064): how you'll reach Conch, and the link that makes it yours.
  # It talks to you directly, so nothing here catches what it says.
  Say 'Windows stops Conch when you sign out: lock the screen instead.'
  Write-Host ''
  $setupArgs = @('setup')
  if ($env:CONCH_DOMAIN) { $setupArgs += @('--domain', $env:CONCH_DOMAIN) }
  Push-Location $RunDir
  try {
    $env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
    & (Join-Path (Split-Path $script:Node) 'corepack.cmd') pnpm --silent --filter '@conch/server' conch @setupArgs
  } finally { Pop-Location }
  Write-Host ''
} else {
  Write-Host ''
  Write-Host "  Conch is ready at $url" -ForegroundColor White
  if (-not $env:CONCH_NO_BACKGROUND) { Say 'Open it any time from the Start menu: just type Conch.' }
  else { Say "Start it with: cd `"$Dir`"; corepack pnpm start" }
  Write-Host ''
  # It opens as this computer (ADR 0063): `conch open` hands the browser a one-time link.
  if (-not $env:CONCH_NO_OPEN -and -not $env:CONCH_NO_BACKGROUND) {
    if (-not (Invoke-Conch @('open')).Ok) { Start-Process $url }
  }
}
