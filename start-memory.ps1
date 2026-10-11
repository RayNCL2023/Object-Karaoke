# Starts NMAFC (OpenLoft's open-source memory engine) on http://127.0.0.1:8765, using this folder's Gemini key.
# NMAFC is already installed on this laptop in ..\nmafc-svc\.venv (see README for a fresh install).
$here = $PSScriptRoot
$svc = Join-Path (Split-Path -Parent $here) "nmafc-svc"
$key = ((Get-Content (Join-Path $here ".env") | Where-Object { $_ -match '^GEMINI_API_KEY=' }) -replace '^GEMINI_API_KEY=', '').Trim().Trim('"')
if (-not $key) { Write-Host "Put GEMINI_API_KEY in .env first."; exit 1 }
$env:OPENAI_API_KEY = $key
$env:OPENAI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
$env:NMAFC_LLM_PROVIDER_MODEL = "openai/gemini-flash-lite-latest"
$env:NMAFC_EMBEDDING_PROVIDER_MODEL = "openai/gemini-embedding-001"
$env:NMAFC_EMBEDDING_DIM = "3072"   # skips NMAFC's dimension probe, which breaks on Windows
Set-Location $svc
Get-Process nmafc-web -ErrorAction SilentlyContinue | Stop-Process -ErrorAction SilentlyContinue
Start-Process -FilePath ".\.venv\Scripts\nmafc-web.exe" -ArgumentList "--port","8765","--host","127.0.0.1" -WindowStyle Hidden `
  -RedirectStandardOutput "$env:TEMP\nmafc-out.txt" -RedirectStandardError "$env:TEMP\nmafc-err.txt"
Write-Host "Memory (NMAFC) starting on http://127.0.0.1:8765 (dashboard + /docs there too)."
