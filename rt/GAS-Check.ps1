# GAS-Check.ps1
# Compares local src folder against multiple GAS containers using clasp

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
$localSrc    = Join-Path $projectRoot "src"
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
    Write-Host "=== Checking scriptId $id ===" -ForegroundColor Cyan
    # Temp folder for remote clone
    $tempRemoteRoot = Join-Path $env:TEMP ("gas-check-" + $id)
    $tempRemoteSrc  = Join-Path $tempRemoteRoot "src"
    if (Test-Path $tempRemoteRoot) {
        Remove-Item $tempRemoteRoot -Recurse -Force
    }
    New-Item -ItemType Directory -Path $tempRemoteRoot | Out-Null
    Push-Location $tempRemoteRoot
    try {
        # Create a temporary .clasp.json
        $claspConfigWithId = $claspConfig.Clone()
        $claspConfigWithId["scriptId"] = $id
        $json = $claspConfigWithId | ConvertTo-Json
        Set-Content -Path $tempClasp -Value $json
        # Run clasp clone
        Write-Host "Running clasp clone..."
        clasp clone $id --rootDir src | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "clasp clone failed for scriptId $id"
        }
        # Compare directories
        $localFiles = Get-ChildItem $localSrc -Recurse | ForEach-Object {
            $h = Get-FileHash $_.FullName
            [PSCustomObject]@{
                RelPath = $_.FullName.Substring($localSrc.Length).TrimStart("\")
                Hash    = $h.Hash
            }
        }
        $remoteFiles = Get-ChildItem $tempRemoteSrc -Recurse | ForEach-Object {
            $h = Get-FileHash $_.FullName
            [PSCustomObject]@{
                RelPath = $_.FullName.Substring($tempRemoteSrc.Length).TrimStart("\")
                Hash    = $h.Hash
            }
        }
        $diff = Compare-Object $localFiles $remoteFiles -Property RelPath, Hash |
            Group-Object -Property RelPath |
            ForEach-Object {
                $file = $_.Name
                $sideIndicators = $_.Group.SideIndicator
                if ($sideIndicators -contains "=>" -and $sideIndicators -contains "<=") {
                    [PSCustomObject]@{
                        File   = $file
                        Status = "different"
                    }
                }
                elseif ($sideIndicators -contains "<=") {
                    [PSCustomObject]@{
                        File   = $file
                        Status = "local-only"
                    }
                }
                elseif ($sideIndicators -contains "=>") {
                    [PSCustomObject]@{
                        File   = $file
                        Status = "remote-only"
                    }
                }
            }
        if ($diff) {
            Write-Host "MISMATCH detected for scriptId $id" -ForegroundColor Yellow
            # Pretty diff output
            foreach ($d in $diff) {
                Write-Host "  [$($d.Status)] " -NoNewLine -ForegroundColor Yellow
                Write-Host $d.File
                if ($d.Status -eq "different") {
                    $localFile = Join-Path $localSrc $d.File
                    $remoteFile = Join-Path $tempRemoteSrc $d.File
                    $escapedLocalFile = [Regex]::Escape($localFile)
                    $escapedRemoteFile = [Regex]::Escape($remoteFile)
                    $fcOutput = cmd /c "fc $localFile $remoteFile" | Out-String
                    $fcOutput = $fcOutput -replace "(?i)Comparing files.*", ""
                    $fcOutput = $fcOutput -replace "(?i)$escapedLocalFile", "LOCAL"
                    $fcOutput = $fcOutput -replace "(?i)$escapedRemoteFile", "REMOTE"
                    $fcOutput = $fcOutput.Trim()
                    Write-Host $fcOutput
                }
            }
        }
        else {
            Write-Host "Local sources MATCH remote project" -ForegroundColor Green
        }
    }
    catch {
        Write-Host "Check error: $_" -ForegroundColor Red
    }
    finally {
        Pop-Location
        Remove-Item $tempRemoteRoot -Recurse -Force
        Remove-Item $tempClasp -Force -ErrorAction SilentlyContinue
        Write-Host ""
    }
}