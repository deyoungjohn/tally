# Build a review pack for a work-order branch: diff, file list, owned-path check, and check output.
# Usage: pwsh scripts/review-pack.ps1 mod/WO-04-flow [-Base origin/main]
param([Parameter(Mandatory = $true)][string]$Branch, [string]$Base = "origin/main")
$ErrorActionPreference = "Continue"
$name = $Branch -replace "/", "_"
$out = "review/$name"
$wt = ".review-wt/$name"
New-Item -ItemType Directory -Force -Path $out | Out-Null
git fetch origin --quiet
git rev-parse --verify --quiet "origin/$Branch" *> $null
$ref = if ($LASTEXITCODE -eq 0) { "origin/$Branch" } else { $Branch }

git log --oneline "$Base..$ref" | Out-File -Encoding utf8 "$out/commits.txt"
git diff --stat "$Base...$ref" | Out-File -Encoding utf8 "$out/stat.txt"
git diff --name-only "$Base...$ref" | Out-File -Encoding utf8 "$out/files.txt"
git diff "$Base...$ref" | Out-File -Encoding utf8 "$out/diff.patch"
$py = if (Get-Command py -ErrorAction SilentlyContinue) { "py" } else { "python" }
& $py scripts/review_owned.py $Branch "$out/files.txt" *> "$out/owned.txt"
"owned-path check exit: $LASTEXITCODE" | Add-Content "$out/owned.txt"

if (Test-Path $wt) { git worktree remove --force $wt 2>$null; Remove-Item -Recurse -Force $wt -ErrorAction SilentlyContinue }
git worktree add --quiet --detach $wt $ref
Push-Location $wt
$log = @()
foreach ($step in @("pnpm install --frozen-lockfile", "pnpm typecheck", "pnpm lint", "pnpm format:check", "pnpm test")) {
  $log += "===== $step"
  $res = cmd /c "$step 2>&1"
  $log += ($res | Select-Object -Last 200)
  $log += "===== exit: $LASTEXITCODE"
}
Pop-Location
$log | Out-File -Encoding utf8 "$out/checks.txt"
git worktree remove --force $wt
Write-Host "Review pack written to $out/ (commits, stat, files, diff.patch, owned, checks)"
Select-String -Path "$out/checks.txt" -Pattern "^===== " | ForEach-Object { $_.Line }
Get-Content "$out/owned.txt" -Tail 1
