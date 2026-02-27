# src/scripts/Show-Actor-Runs.ps1
param(
    [string]$ActorId
);
$ErrorActionPreference = "Stop";
try {
    function Get-Last-Status-Message {
        param(
            [string]$RunId
        );
        $res = [PSCustomObject]@{
            timestamp = ""
            level     = ""
            message   = ""
        };
        $out = [System.IO.Path]::GetTempFileName();
        $arg = @("logs", $RunId, "--tail", "100", "--timestamps");
        $prc = Start-Process docker -ArgumentList $arg -NoNewWindow -RedirectStandardOutput $out -Wait -PassThru;
        $log = (Get-Content $out -Raw -ErrorAction SilentlyContinue) -split '\r?\n' -ne '';
        for ($ndx = $log.Count - 1; $ndx -ge 0; $ndx--) {
            $raw = $log[$ndx] -replace '\x1B\[[0-9;]*m', '';
            if ($raw -match "^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?Z\s+(ERROR|WARN|DEBUG|INFO)\s+\[Status message\]:(.+)$") {
                $res.timestamp = $matches[1].Replace("T", " ");
                $res.level     = $matches[3];
                $res.message   = $matches[4].Trim();
                break;
            }
        }
        Remove-Item $out -Force -ErrorAction SilentlyContinue;
        return $res;
    }
    $pfx = "adimeiss/actor/";
    $rep = docker inspect --format '{{index (split (index .RepoTags 0) \":\") 0}}' $ActorId
    $acn = $rep -replace [regex]::Escape($pfx), "";
    $res = @();
    docker ps -aq --filter "ancestor=$ActorId" | ForEach-Object {
        $lsm = Get-Last-Status-Message -RunId $_;
        $jsn = docker inspect $_ | ConvertFrom-Json;
        $sta = $jsn[0].State.StartedAt.Split(".")[0].Replace("T", " ").Replace("Z", "");
        $fin = $jsn[0].State.FinishedAt.Split(".")[0].Replace("T", " ").Replace("Z", "");
        if ($sta -eq "0001-01-01 00:00:00") {
            $sta = "";
        }
        if ($fin -eq "0001-01-01 00:00:00") {
            $fin = "";
        }
        $row = [PSCustomObject]@{
            actorId       = $ActorId
            actorName     = $acn
            runID         = $jsn[0].Id.Substring(0,12)
            runName       = $jsn[0].Name.TrimStart("/")
            status        = $jsn[0].State.Status
            logMessage    = $lsm.message
            logLevel      = $lsm.level
            logTimestamp  = $lsm.timestamp
            startedAt     = $sta
            finishedAt    = $fin
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
        if ($row.startedAt -ne "") {
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
        }
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