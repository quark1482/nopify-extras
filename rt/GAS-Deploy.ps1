# GAS-Deploy.ps1
# Pushes the same src folder to multiple GAS containers using clasp

# Common clasp configuration
$claspConfig = @{
    rootDir            = "src"
    scriptExtensions   = @(".js", ".gs")
    htmlExtensions     = @(".html")
    jsonExtensions     = @(".json")
    filePushOrder      = @()
    skipSubdirectories = $false
}

$projectRoot = Get-Location
$tempClasp   = Join-Path $projectRoot ".clasp.json"
$envPath     = Join-Path $projectRoot ".env"
$scriptIds   = @()

# Load multiline SCRIPT_IDs from .env file
if (-not (Test-Path $envPath)) {
    Write-Host "Missing .env file" -ForegroundColor Red
    exit 1
}
Get-Content $envPath | Where-Object { $_ -match "^\s*SCRIPT_ID\s*=\s*([^#]+)\s*(#.*)?$" } |
    ForEach-Object { $scriptIds += $matches[1].Trim() } |
    Where-Object { $_ -ne "" }
if ($scriptIds.Count -eq 0) {
    Write-Host "No single valid SCRIPT_ID found in .env file" -ForegroundColor Red
    exit 1
}

foreach ($id in $scriptIds) {
    Write-Host "=== Deploying scriptId $id ===" -ForegroundColor Cyan
    try {
        # Create a temporary .clasp.json
        $claspConfigWithId = $claspConfig.Clone()
        $claspConfigWithId["scriptId"] = $id
        $json = $claspConfigWithId | ConvertTo-Json
        Set-Content -Path $tempClasp -Value $json
        # Run clasp push
        Write-Host "Running clasp push..."
        clasp push
        if ($LASTEXITCODE -ne 0) {
            throw "clasp push failed for scriptId $id"
        }
        Write-Host "Finished deploying to $id" -ForegroundColor Green
    }
    catch {
        Write-Host "Deploy error: $_" -ForegroundColor Red
    }
    finally {
        # Delete the temporary file
        Remove-Item $tempClasp -Force -ErrorAction SilentlyContinue
        Write-Host ""
    }
}