<#
  Corrige drizzle/meta/_journal.json (estava vazio, sem registrar as 4 migrations existentes).
  Nao aplica nada em producao - so corrige o historico local do drizzle-kit.
  Uso:
    cd "C:\Users\al-ra\Documents\Codex\github\radar-carreira-platform"
    powershell -ExecutionPolicy Bypass -File apply_migration_0003_fix.ps1 -Commit
#>
param(
  [string]$RepoPath = (Get-Location).Path,
  [string]$Branch = "fix/drizzle-journal-0003",
  [switch]$Commit,
  [switch]$Push
)

$ErrorActionPreference = "Continue"

function Write-Utf8NoBom($Path, $Content) {
  $dir = Split-Path -Parent $Path
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $enc)
  Write-Host "  escrito: $Path"
}

if (-not (Test-Path (Join-Path $RepoPath "package.json"))) {
  throw "package.json nao encontrado. Rode este script dentro do repo ou passe -RepoPath."
}

Push-Location $RepoPath
try {
  $isGitRepo = Test-Path ".git"
  if ($isGitRepo) {
    Write-Host "Trocando para main e atualizando..."
    git checkout main
    git pull
    $existingBranch = git branch --list $Branch
    if ($existingBranch) {
      Write-Host "Branch ja existe, mudando para ela."
      git checkout $Branch
    } else {
      Write-Host "Criando branch nova."
      git checkout -b $Branch
    }
  } else {
    Write-Host "Aviso: pasta nao parece um repo git. Copiando o arquivo mesmo assim."
  }

  Write-Host ""
  Write-Host "Corrigindo drizzle/meta/_journal.json..."
  Write-Utf8NoBom (Join-Path $RepoPath "drizzle\meta\_journal.json") @'
{
  "version": "7",
  "dialect": "sqlite",
  "entries": [
    {
      "idx": 0,
      "version": "6",
      "when": 1730000000000,
      "tag": "0000_platform",
      "breakpoints": true
    },
    {
      "idx": 1,
      "version": "6",
      "when": 1731000000000,
      "tag": "0001_admin_settings",
      "breakpoints": true
    },
    {
      "idx": 2,
      "version": "6",
      "when": 1732000000000,
      "tag": "0002_user_alerts",
      "breakpoints": true
    },
    {
      "idx": 3,
      "version": "6",
      "when": 1733000000000,
      "tag": "0003_alert_deliveries",
      "breakpoints": true
    }
  ]
}

'@

  if ($isGitRepo -and ($Commit -or $Push)) {
    git add drizzle/meta/_journal.json
    git commit -m "fix: registra as migrations 0000-0003 no journal do drizzle-kit"
    if ($LASTEXITCODE -ne 0) { Write-Host "Nada novo para commitar." } else { Write-Host "Commit criado." }
    if ($Push) {
      git push -u origin $Branch
      Write-Host "Branch enviada."
    }
  } elseif ($isGitRepo) {
    Write-Host ""
    Write-Host "Mudanca nao commitada (rode com -Commit)."
  }

  Write-Host ""
  Write-Host "Isto NAO aplica a migration 0003 em producao - so corrige o historico local."
} finally {
  Pop-Location
}
