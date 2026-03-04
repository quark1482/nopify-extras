# src/scripts/Stop-Run.ps1
param(
    [string]$RunId,
    [boolean]$RemoveAfter
);
$ErrorActionPreference = "Stop";
try {
    $tmo = 10;
    $res = @();
    $jsn = docker inspect $RunId | ConvertFrom-Json;
    if ($jsn[0].State.Status -notin @("created", "exited", "dead")) {
        try {
            docker stop $RunId | Out-Null;
            $sta = Get-Date;
            while ($true) {
                Start-Sleep -Milliseconds 500;
                $jsn = docker inspect $RunId | ConvertFrom-Json;
                if ($jsn[0].State.Status -in @("created", "exited", "dead")) {
                    break;
                }
                if (((Get-Date) - $sta).TotalSeconds -gt $tmo) {
                    throw "Container stop timeout";
                }
            }
        }
        catch {
            throw "Container stop failed";
        }
    }
    $lyr = $jsn[0].GraphDriver.Data.dir;
    if ($lyr) {
        $vhd = Join-Path $lyr "sandbox.vhdx";
        if (Test-Path $vhd) {
            try {
                Dismount-DiskImage -ImagePath $vhd -ErrorAction Stop;
            }
            catch {
                throw "VHD dismount failed";
            }
        }
    }
    $row = [PSCustomObject]@{
        runID   = $jsn[0].Id.Substring(0,12)
        runName = $jsn[0].Name.TrimStart("/")
        status  = $jsn[0].State.Status
    };
    if ($RemoveAfter) {
        try {
            docker rm -f $RunId | Out-Null;
            $row.status = "removed";
        }
        catch {
            throw "Container remove failed";
        }
    }
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