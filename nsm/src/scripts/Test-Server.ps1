# src/scripts/Test-Server.ps1
$ErrorActionPreference = "Stop";
try {
    $osw = (Get-CimInstance Win32_OperatingSystem).caption;
    $lic = Get-CimInstance SoftwareLicensingProduct |
           Where-Object {
             $_.PartialProductKey -and $_.Name -like "Windows*"
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