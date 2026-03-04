# src/scripts/Invoke-Remote-Action.ps1
function Invoke-Remote-Action {
    param (
        [string]$ServerNick,
        [string]$ServerName,
        [string]$UserName,
        [string]$Password
        <#EXTRA_PARAMS_DECL#>
    );
    $svr = $ServerNick;
    $ip  = "<not resolved>";
    $eap = $ErrorActionPreference;
    $ErrorActionPreference = "Stop";
    try {
        $ip  = [System.Net.Dns]::GetHostAddresses($ServerName)[0].IPAddressToString;
        $sec = ConvertTo-SecureString $Password -AsPlainText -Force;
        $crd = New-Object System.Management.Automation.PSCredential ($UserName, $sec);
        $ses = New-PSSession -ComputerName $ip -Credential $crd -ErrorAction Stop;
        $ret = Invoke-Command -Session $ses -ScriptBlock {
            & {
                <#REMOTE_SCRIPT_BODY#>
            } @args;
        } -ErrorAction Stop <#EXTRA_ARGUMENT_LIST#>;
        $ret | Add-Member -NotePropertyName server -NotePropertyValue $svr -Force;
        $ret | Add-Member -NotePropertyName ip -NotePropertyValue $ip -Force;
        if ($ret.results) {
            $ret.results = $ret.results |
                Select-Object @{Name="server";Expression={$svr}}, @{Name="ip";Expression={$ip}},
                              * -ExcludeProperty server, ip;
        }
    }
    catch {
        $ret = [pscustomobject]@{
            server  = $svr
            ip      = $ip
            type    = $_.Exception.GetType().FullName
            error   = $_.Exception.Message
            success = $false
        };
    }
    finally {
        if ($ses) {
            Remove-PSSession $ses -ErrorAction SilentlyContinue;
        }
        $ErrorActionPreference = $eap;
    }
    return $ret | Select-Object server, ip, results, type, error, success;
}