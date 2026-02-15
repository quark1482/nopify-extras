# src/scripts/Search-Runs.ps1
function Invoke-Remote-Action {
    param(
        [string]$svr,
        [string]$ip,
        [string]$run
    );
    $ErrorActionPreference = 'Stop';
    try {
        $pfx = "adimeiss/actor/";
        $res = @();
        docker image ls "$pfx*" --format "{{json .}}" | ConvertFrom-Json | ForEach-Object {
            $rep = $_.Repository;
            $aci = $_.ID;
            $acn = $rep -replace [regex]::Escape($pfx), "";
            docker ps -aq --filter "ancestor=$rep" --filter "name=$run" | ForEach-Object {
                $jsn = docker inspect $_ | ConvertFrom-Json;
                $row = [PSCustomObject]@{
                    actorId       = $aci
                    actorName     = $acn
                    runID         = $jsn[0].Id.Substring(0,12)
                    runName       = $jsn[0].Name.TrimStart("/")
                    status        = $jsn[0].State.Status
                    startedAt     = $jsn[0].State.StartedAt.Split(".")[0].Replace("T", " ")
                    finishedAt    = $jsn[0].State.FinishedAt.Split(".")[0].Replace("T", " ")
                    duration      = ""
                    restartCount  = $jsn[0].RestartCount
                    restartPolicy = $jsn[0].HostConfig.RestartPolicy.Name
                };
                $map = @{
                    "no"             = "never"
                    "on-failure"     = "on failure"
                    "unless-stopped" = "always"
                    "always"         = "non-stop"
                };
                if ($map[$row.restartPolicy]) {
                    $row.restartPolicy = $map[$row.restartPolicy];
                }
                elseif (!$row.restartPolicy) {
                    $row.restartPolicy = "unknown";
                }
                $utc = [System.Globalization.DateTimeStyles]::AssumeUniversal;
                if ($row.status -eq "running") {
                    $dur = (Get-Date) - [datetime]::Parse($row.startedAt, $null, $utc);
                }
                else {
                    $dur = [datetime]::Parse($row.finishedAt, $null, $utc) - [datetime]::Parse($row.startedAt, $null, $utc);
                }
                $day = [math]::Floor($dur.TotalDays);
                $hrs = [math]::Floor($dur.TotalHours % 24);
                $min = [math]::Floor($dur.TotalMinutes % 60);
                if ($day -gt 0) {
                    $row.duration += "$day" + "d ";
                }
                if ($hrs -gt 0) {
                    $row.duration += "$hrs" + "h ";
                }
                if ($min -gt 0 -or ($day -eq 0 -and $hrs -eq 0)) {
                    $row.duration += "$min" + "m";
                }
                $row.duration = $row.duration.Trim();
                $res += $row;
            };
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