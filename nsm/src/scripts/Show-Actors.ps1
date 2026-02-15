# src/scripts/Show-Actors.ps1
function Invoke-Remote-Action {
    param(
        [string]$svr,
        [string]$ip
    );
    $ErrorActionPreference = 'Stop';
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
            server  = $svr
            ip      = $ip
            results = $res
            success = $true
        };
    }
    catch {
        [pscustomobject]@{
            server  = $svr
            ip      = $ip
            type    = $_.Exception.GetType().FullName
            error   = $_.Exception.Message
            success = $false
        };
    }
}