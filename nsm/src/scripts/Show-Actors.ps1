# src/scripts/Show-Actors.ps1
$ErrorActionPreference = "Stop";
try {
    $pfx = "adimeiss/actor/";
    $res = @();
    docker image ls "$pfx*" --format "{{json .}}" | ConvertFrom-Json | ForEach-Object {
        $rep = $_.Repository;
        $aci = $_.ID;
        $acn = $rep -replace [regex]::Escape("$pfx"), "";
        $run = (docker ps --filter "ancestor=$rep" --format "." | Measure-Object -Line).Lines;
        $tot = (docker ps -a --filter "ancestor=$rep" --format "." | Measure-Object -Line).Lines;
        $row = [PSCustomObject]@{
            actorId    = $aci
            actorName  = $acn
            activeRuns = $run
            totalRuns  = $tot
        };
        $res += $row;
    };
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