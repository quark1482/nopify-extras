# src/scripts/Set-Run-Proxies.ps1
param(
    [string]$RunId,
    [string]$ProxyList
);
$ErrorActionPreference = "Stop";
try {
    $pfx = "adimeiss/actor/";
    $res = @();
    $inp = "\\actor\\storage\\key_value_stores\\default\\INPUT.json";
    $tmp = New-TemporaryFile;
    docker cp "$RunId`:$inp" $tmp;
    $jsn = Get-Content $tmp -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop;
    $lst = @();
    foreach ($l in ($ProxyList -split "`r?`n")) {
        if ($l.Trim()) {
            $lst += $l.Trim();
        }
    }
    if ($lst.Count -eq 0) {
        throw "The list of supplied proxies is empty";
    }
    $saw = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase);
    $lst = @($lst | Where-Object { $saw.Add($_) });
    $arr = @();
    for ($i = 0; $i -lt $lst.Count; $i++) {
        $pxy = $lst[$i];
        try {
            $uri = [Uri]$pxy;
            if ($uri.Scheme -ne 'http') {
                throw "Invalid scheme in '$pxy'";
            }
            if (-not ($uri.Host -match '^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$|^[a-zA-Z0-9.-]+$')) {
                throw "Invalid hostname or IP in '$pxy'";
            }
            if (-not $uri.Port -or $uri.Port -notin 1..65535) {
                throw "Invalid or missing port in '$pxy'";
            }
            $arr += $pxy;
        }
        catch {
            throw "Invalid proxy URL: '$pxy'";
        }
    }
    if ($arr.Count -eq 0) {
        throw "The list of parsed proxies is empty";
    }
    $jsn | Add-Member -MemberType NoteProperty -Name adv_proxy_usage -Value @{
        useApifyProxy = $false
        proxyUrls     = $arr
    } -Force;
    $enc = New-Object System.Text.UTF8Encoding $false;
    [System.IO.File]::WriteAllText($tmp, ($jsn | ConvertTo-Json -Depth 100), $enc);
    docker cp $tmp "$RunId`:$inp";
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
finally {
    Remove-Item $tmp -Force;
}