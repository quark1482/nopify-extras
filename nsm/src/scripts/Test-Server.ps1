# src/scripts/Test-Server.ps1
function Invoke-Remote-Action {
    param(
        [string]$svr,
        [string]$ip
    );
    $ErrorActionPreference = 'Stop';
    try {
        $osw = (Get-CimInstance Win32_OperatingSystem).caption;
        $lic = Get-CimInstance SoftwareLicensingProduct |
               Where-Object {
                 $_.PartialProductKey -and $_.Name -like 'Windows*'
               };
        $sts = if ($lic.LicenseStatus -eq 1) { "Activated" } else { "Not activated yet" };
        $rem = [math]::Round($lic.GracePeriodRemaining / 1440);
        $res = @();
        $row = [pscustomobject]@{
            os       = $osw
            status   = $sts
            daysLeft = $rem
        };
        $res += $row;
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