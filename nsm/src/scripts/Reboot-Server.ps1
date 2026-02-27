# src/scripts/Reboot-Server.ps1
$ErrorActionPreference = "Stop";
try {
    shutdown.exe /r /t 5 /d p:0:0 /c "NSM - Remote Reboot"
    $res = @();
    $row = [pscustomobject]@{
        exitCode = $LASTEXITCODE
    };
    $res += $row;
    [pscustomobject]@{
        results = $res
        success = $true
    };
}
catch {
    [pscustomobject]@{
        type    = $_.Exception.GetType().FullName
        error   = $_.Exception.Message
        success = $false
    };
}