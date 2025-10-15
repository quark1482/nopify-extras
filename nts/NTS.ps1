param(
    [string[]]$RunId,
    [string]$ScheduleType,              # daily/weekly/interval
    [string]$StartTime,                 # HH:mm:ss format, for daily or weekly schedules
    [int]$IntervalMinutes = 0,          # for interval schedules, in minutes
    [int]$IntervalHours   = 0,          # for interval schedules, in hours (optional)
    [int]$IntervalDays    = 1,          # for daily schedules
    [int]$IntervalWeeks   = 1,          # for weekly schedules
    [int]$DurationMinutes = 0,          # for any schedule type, in minutes (optional)
    [int]$DurationHours   = 0,          # for any schedule type, in hours (optional)
    [switch]$Remove,                    # if present, removes the schedule instead of creating/updating it
    [switch]$List,                      # if present, just lists the scheduled runs
    [string]$Format       = "normal",   # short/normal/long format, for the list of scheduled runs
    [string]$ActorName,                 # if present, only shows the runs of the supplied actor
    [switch]$Install,                   # (hidden) if present, (re)installs the boot task
    [switch]$Uninstall,                 # (hidden) if present, uninstalls the boot task
    [switch]$Update,                    # (hidden) if present, updates the script for the boot task
    [switch]$UpdateTasks                # (hidden) if present, updates the script for the available tasks
)

$ScriptName        = [System.IO.Path]::GetFileNameWithoutExtension($MyInvocation.MyCommand.Name)
$ScriptVersion     = "v1.0.1"
$ActorNamePrefix   = "adimeiss/actor/"
$TaskNamePrefix    = "NopifyTask_"
$BootTaskName      = "${TaskNamePrefix}Boot"
$MaxNameLength     = 25
$DockerErrorCode   = 2
$DockerTimeout     = 30
$TaskRandomDelay   = 60
$ScriptCheckDocker = @"
    `$timestamp = Get-Date
    while (`$true) {
        `$ds = Get-Service -Name 'docker' -ErrorAction SilentlyContinue
        if (-not `$ds) {
            exit $DockerErrorCode
        }
        `$elapsed = (Get-Date) - `$timestamp
        if (`$ds.status -eq 'Running') {
            try {
                docker info | Out-Null ;
                if (`$LASTEXITCODE -eq 0) {
                    break
                }
            }
            catch {
                exit $DockerErrorCode
            }
        }
        if (`$elapsed.TotalSeconds -ge $DockerTimeout) {
            exit $DockerErrorCode
        }
        Start-Sleep -Seconds 1
    }
"@
$ScriptBootAction  = @"
    # $ScriptName $ScriptVersion - Boot script
    `$errors = 0
    `$Files  = Get-ChildItem -Path `$env:TEMP -Filter "$TaskNamePrefix*.lock" -File -ErrorAction SilentlyContinue
    foreach (`$file in `$Files) {
        try {
            `$name = [System.IO.Path]::GetFileNameWithoutExtension(`$file.Name)
            `$info = Get-ScheduledTask -TaskName `$name -ErrorAction SilentlyContinue
            if (`$info) {
                if (`$info.State -ne 'Running') {
                    Remove-Item `$file.FullName -Force -ErrorAction SilentlyContinue
                    Start-ScheduledTask -TaskName `$name
                }
            }
            else {
                Remove-Item `$file.FullName -Force -ErrorAction SilentlyContinue
            }
        }
        catch {
            `$errors += 1
        }
    }
    exit `$errors
"@
$ScriptTaskAction  = @"
    # $ScriptName $ScriptVersion - Task script
    `$id       = '{<container id>}'
    `$minutes  = {<duration>}
    `$lockName = '$TaskNamePrefix{0}.lock' -f `$id
    `$lockPath = Join-Path -Path `$env:TEMP -ChildPath `$lockName
    Start-Sleep -Seconds (Get-Random -Minimum 0 -Maximum $TaskRandomDelay)
    $($ScriptCheckDocker.trim())
    docker stop `$id
    if (`$LASTEXITCODE -ne 0) {
        exit $DockerErrorCode
    }
    docker start `$id
    if (`$LASTEXITCODE -ne 0) {
        exit $DockerErrorCode
    }
    New-Item -Path `$lockPath -ItemType File -Force | Out-Null
    `$timestamp = Get-Date
    while (`$true) {
        `$status = docker inspect -f '{{.State.Status}}' `$id
        if (`$status -ne 'running' -and `$status -ne 'restarting') {
            break
        }
        if (`$minutes) {
            `$elapsed = (Get-Date) - `$timestamp
            if (`$elapsed.TotalMinutes -ge `$minutes) {
                break
            }
        }
        Start-Sleep -Seconds 5
    }
    docker stop `$id
    if (`$LASTEXITCODE -ne 0) {
        exit $DockerErrorCode
    }
    Remove-Item `$lockPath -Force -ErrorAction SilentlyContinue
    exit 0
"@

function Show-Usage {
    @"

Nopify Task Scheduler $ScriptVersion

Usage:

  Schedule a run daily every N days, or weekly every N weeks, at a specific time:
    $ScriptName -RunId <id> -ScheduleType daily|weekly -StartTime <time> [-IntervalDays N | -IntervalWeeks N]
  Default value for N is 1 day/week.

  Schedule a run every N minutes or every N hours:
    $ScriptName -RunId <id> -ScheduleType interval [-IntervalMinutes N | -IntervalHours N]
  Default value for N is 0 minutes/hours. Sum must be greater than zero.

  Remove a run schedule:
    $ScriptName -RunId <id> -Remove

  List scheduled runs:
    $ScriptName -List [-Format short|normal|long] [-ActorName <name>]
  Use -Format short or -Format long to select the amount of information shown per row.
  Use -ActorName to filter rows by the supplied actor name.

  Additional details:
    Pass a 12-character hexadecimal value as RunId.
    Pass an ISO8601 time (24-hour format) as StartTime.
    [optional] Set the run time limit with either -DurationMinutes N or -DurationHours N.

  Pro-tip:
    Run names can be used instead of ids - just be sure to write the exact names.
    Combine hours and minutes for intervals and durations to customize periods.

  Examples:
    $ScriptName -RunId abcdef123456 -ScheduleType weekly -StartTime 09:00:00 -DurationHours 8
    $ScriptName -RunId abcdef123456 -ScheduleType daily -StartTime 23:59:00 -IntervalDays 2
    $ScriptName -RunId abcdef123456 -ScheduleType interval -IntervalMinutes 30
    $ScriptName -RunId abcdef123456 -Remove
    $ScriptName -List -Format short -ActorName myactor
    $ScriptName -List

"@ | Write-Output
}

function Show-Error {
    param(
        [string]$Text
    )
    if ([Console]::IsOutputRedirected) {
        Write-Output "Error: $Text"
    }
    else {
        Write-Host "Error: $Text" -ForegroundColor Red
    }
}

function Show-Info {
    param(
        [string]$Text
    )
    if ([Console]::IsOutputRedirected) {
        Write-Output $Text
    }
    else {
        Write-Host $Text -ForegroundColor Green
    }
}

function Show-Warning {
    param(
        [string]$Text
    )
    if ([Console]::IsOutputRedirected) {
        Write-Output "Warning: $Text"
    }
    else {
        Write-Host "Warning: $Text" -ForegroundColor Yellow
    }
}

# Check if running as admin
if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Show-Error -Text "This script must be run as Administrator.`n"
    exit 1
}

# Validate mandatory parameters or show usage

if ($PSBoundParameters.Count -eq 0) {
    Show-Usage
    exit 0
}
elseif ($Install -or $Uninstall -or $Update -or $UpdateTasks) {
    if ($PSBoundParameters.Count -ne 1) {
        Show-Error -Text "This command does not accept other parameters."
        Show-Usage
        exit 1
    }
}
elseif ($List) {
    if ($PSBoundParameters.ContainsKey('Format')) {
        $validFormats = @('short', 'normal', 'long')
        if ($Format.ToLower() -notin $validFormats) {
            Show-Error -Text "-Format must be one of short, normal, or long."
            Show-Usage
            exit 1
        }
    }
    if ($PSBoundParameters.ContainsKey('ActorName')) {
        # Validate that $ActorName is a valid image name and strip it from decorations
        if ($ActorName.StartsWith($ActorNamePrefix)) {
            $fullName  = $ActorName
            $ActorName = $ActorName.Replace($ActorNamePrefix, '')
        }
        else {
            $fullName = "$ActorNamePrefix$ActorName"
        }
        try {
            $dockerCmd = docker inspect $fullName 2>&1 | ConvertFrom-Json
            if (-not $dockerCmd) {
                throw
            }
        }
        catch {
            Show-Error -Text "ActorName '$ActorName' is not a valid actor name."
            Show-Usage
            exit 1
        }
    }
}
else {
    if (-not $PSBoundParameters.ContainsKey('RunId') -or $RunId -eq '') {
        Show-Error -Text "-RunId is required."
        Show-Usage
        exit 1
    }

    $RunId = $RunId | Select-Object -Unique
    # Validate that every item in $RunId is a valid container id or name and get its short id form
    for ($ndx = 0; $ndx -lt $RunId.Length; $ndx++) {
        try {
            $dockerCmd = docker inspect $($RunId[$ndx]) 2>&1 | ConvertFrom-Json
            if (-not $dockerCmd) {
                throw
            }
            $RunId[$ndx] = $dockerCmd[0].Id.Substring(0, 12)
        }
        catch {
            Show-Error -Text "RunId '$($RunId[$ndx])' is not a valid id / name."
            Show-Usage
            exit 1
        }
    }
    $RunId = $RunId | Select-Object -Unique

    if ($Remove) {
        if ($PSBoundParameters.Count -ne 2) {
            # Only RunId and Remove allowed together
            Show-Error -Text "When using -Remove, only -RunId should be specified."
            Show-Usage
            exit 1
        }
    }
    else {
        if (-not $PSBoundParameters.ContainsKey('ScheduleType')) {
            Show-Error -Text "-ScheduleType is required."
            Show-Usage
            exit 1
        }

        $ScheduleType = $ScheduleType.ToLower()

        if ($ScheduleType -notin @('daily', 'weekly', 'interval')) {
            Show-Error -Text "-ScheduleType must be one of daily, weekly, or interval."
            Show-Usage
            exit 1
        }

        if ($ScheduleType -eq 'interval') {
            if ($PSBoundParameters.ContainsKey('StartTime')) {
                Show-Error -Text "-StartTime is not applicable for interval schedule type."
                Show-Usage
                exit 1
            }
            if ((-not $PSBoundParameters.ContainsKey('IntervalMinutes') -and -not $PSBoundParameters.ContainsKey('IntervalHours'))) {
                Show-Error -Text "Either -IntervalMinutes or -IntervalHours must be specified for interval schedule type."
                Show-Usage
                exit 1
            }
            elseif ($IntervalMinutes -lt 0 -or $IntervalHours -lt 0) {
                Show-Error -Text "-IntervalMinutes and -IntervalHours must be positive integers."
                Show-Usage
                exit 1
            }
            else {
                $mins  = if ($IntervalMinutes) { $IntervalMinutes } else { 0 }
                $hours = if ($IntervalHours) { $IntervalHours } else { 0 }
                $total = $hours * 60 + $mins
                if ($total -le 0) {
                    Show-Error -Text "Total interval (hours + minutes) must be greater than zero."
                    Show-Usage
                    exit 1
                }
            }
        }
        else {
            if (-not $PSBoundParameters.ContainsKey('StartTime')) {
                Show-Error -Text "-StartTime is required for daily and weekly schedule types."
                Show-Usage
                exit 1
            }
            [datetime]$dateResult = [datetime]::MinValue
            if (-not [datetime]::TryParseExact($StartTime, "HH:mm:ss", $null, [System.Globalization.DateTimeStyles]::None, [ref]$dateResult)) {
                Show-Error -Text "Invalid -StartTime format."
                Show-Usage
                exit 1
            }
        }

        if(($PSBoundParameters.ContainsKey('DurationMinutes') -or $PSBoundParameters.ContainsKey('DurationHours'))) {
            if ($DurationMinutes -lt 0 -or $DurationHours -lt 0) {
                Show-Error -Text  "-DurationMinutes and -DurationHours must be positive integers."
                Show-Usage
                exit 1
            }
            else {
                $mins  = if ($DurationMinutes) { $DurationMinutes } else { 0 }
                $hours = if ($DurationHours) { $DurationHours } else { 0 }
                $total = $hours * 60 + $mins
                if ($total -le 0) {
                    Show-Error -Text "Total duration (hours + minutes), when supplied, must be greater than zero."
                    Show-Usage
                    exit 1
                }
            }
        }
    }
}

function Make-Script {
    param (
        [string]$ContainerId,
        [int]$Duration
    )
    $script = $ScriptTaskAction -replace [regex]::Escape("{<container id>}"), $ContainerId
    $script = $script -replace [regex]::Escape("{<duration>}"), $Duration
    return [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($script))
}

function Make-Task-Name {
    param (
        [string]$ContainerId
    )
    return "$TaskNamePrefix$ContainerId"
}

function Actions-Differ($action1, $action2) {
    return $action1.Arguments -ne $action2.Arguments
}

function Triggers-Differ($trigger1, $trigger2) {
    # Different trigger types
    if ($trigger1.CimClass.CimClassName -ne $trigger2.CimClass.CimClassName) {
        return $true
    }

    # Common properties
    $commonProps = @('Enabled', 'EndBoundary', 'ExecutionTimeLimit', 'Id', 'RandomDelay')
    foreach ($prop in $commonProps) {
        if ($trigger1.$prop -ne $trigger2.$prop) {
            return $true
        }
    }

    # Type-specific properties
    switch ($trigger1.CimClass.CimClassName) {
        'MSFT_TaskTimeTrigger' {  # -Once
            $rep1 = $trigger1.Repetition
            $rep2 = $trigger2.Repetition
            # Check if one has Repetition and the other doesn't
            if ($null -eq $rep1 -xor $null -eq $rep2) {
                return $true
            }
            # Compare Repetition properties (Interval as string)
            if ($rep1.Interval -ne $rep2.Interval) {
                return $true
            }
            if ($rep1.Duration -ne $rep2.Duration) {
                return $true
            }
            if ($rep1.StopAtDurationEnd -ne $rep2.StopAtDurationEnd) {
                return $true
            }
            # Ignore StartBoundary for -Once
        }
        'MSFT_TaskDailyTrigger' {  # -Daily
            if ($trigger1.DaysInterval -ne $trigger2.DaysInterval) {
                return $true
            }
            if ($trigger1.StartBoundary -ne $trigger2.StartBoundary) {
                return $true
            }
        }
        'MSFT_TaskWeeklyTrigger' {  # -Weekly
            if ($trigger1.WeeksInterval -ne $trigger2.WeeksInterval) {
                return $true
            }
            if ($trigger1.StartBoundary -ne $trigger2.StartBoundary) {
                return $true
            }
            $days1 = $trigger1.DaysOfWeek | Sort-Object
            $days2 = $trigger2.DaysOfWeek | Sort-Object
            if ($days1.Length -ne $days2.Length -or ($days1 -join ',') -ne ($days2 -join ',')) {
                return $true
            }
        }
    }

    return $false
}

function Settings-Differ($settings1, $settings2) {
    $mi1 = $settings1.CimInstanceProperties.Item('MultipleInstances').Value
    $mi2 = $settings2.CimInstanceProperties.Item('MultipleInstances').Value
    if ($mi1 -ne $mi2) {
        return $true
    }
    # Normalize ExecutionTimeLimit: PT0H and PT0S are equivalent
    $etl1 = $settings1.ExecutionTimeLimit
    $etl2 = $settings2.ExecutionTimeLimit
    if ($etl1 -eq "PT0H" -or $etl1 -eq "PT0S") {
        $etl1 = "PT0H"
    }
    if ($etl2 -eq "PT0H" -or $etl2 -eq "PT0S") {
        $etl2 = "PT0H"
    }
    if ($etl1 -ne $etl2) {
        return $true
    }
    return $false
}

function Install-Boot-Task {
    $existing  = Get-ScheduledTask -TaskName $BootTaskName -ErrorAction SilentlyContinue
    $runScript = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($ScriptBootAction))
    $action    = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -EncodedCommand $runScript"
    $trigger   = New-ScheduledTaskTrigger -AtStartup
    $settings  = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew
    $settings.ExecutionTimeLimit = "PT0H"
    if ($existing) {
        Set-ScheduledTask -TaskName $BootTaskName -Action $action -Trigger $trigger -Settings $settings | Out-Null
        Show-Info -Text "Boot task updated."
    }
    else {
        Register-ScheduledTask -TaskName $BootTaskName -Action $action -Trigger $trigger -Settings $settings -User 'SYSTEM' -RunLevel Highest | Out-Null
        Show-Info -Text "Boot task installed."
    }
}

function Uninstall-Boot-Task {
    $existing = Get-ScheduledTask -TaskName $BootTaskName -ErrorAction SilentlyContinue
    if ($existing) {
        Unregister-ScheduledTask -TaskName $BootTaskName -Confirm:$false | Out-Null
        Show-Info -Text "Boot task uninstalled."
    }
    else {
        Show-Error -Text "Boot task not found."
    }
}

function Update-Boot-Task-Script {
    $existing  = Get-ScheduledTask -TaskName $BootTaskName -ErrorAction SilentlyContinue
    $runScript = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($ScriptBootAction))
    $action    = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -EncodedCommand $runScript"
    if ($existing) {
        Set-ScheduledTask -TaskName $BootTaskName -Action $action | Out-Null
        Show-Info -Text "Boot task updated."
    }
    else {
        Show-Error -Text "Boot task not found."
    }
}

function Update-Tasks-Script {
    $tasks = Get-ScheduledTask | Where-Object { $_.TaskName -like "$TaskNamePrefix*" -and $_.TaskName -ne $BootTaskName }
    $hits  = 0
    $total = $tasks.Count
    if ($total -eq 0) {
        Write-Output "No scheduled runs were found to update"
        return
    }
    foreach ($task in $tasks) {
        $taskName    = $task.TaskName
        $containerId = $taskName.Substring($TaskNamePrefix.Length)
        $encScript   = ([regex]::Match($task.Actions[0].Arguments, '-EncodedCommand\s+(\S+)')).Groups[1].Value
        $decScript   = [System.Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($encScript))
        $duration    = [int](([regex]::Match($decScript, '\$minutes\s*=\s*(\d+)')).Groups[1].Value)
        $runScript   = Make-Script -ContainerId $containerId -Duration $duration
        $action      = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -EncodedCommand $runScript"
        try {
            Set-ScheduledTask -TaskName $taskName -Action $action | Out-Null
            Show-Info -Text "Task $taskName script updated."
            $hits += 1
        }
        catch {
            Show-Error -Text "Task $taskName script update failed."
        }
    }
    Write-Output "Updated $hits of $total task(s)."
}

function Create-Or-Update-Schedule {
    param (
        [string]$ContainerId,
        [int]$Duration
    )
    # Decide trigger type
    switch ($ScheduleType) {
        'interval' {
            $totalMinutes = $IntervalHours * 60 + $IntervalMinutes
            # No RepetitionDuration: unlimited repetition
            $trigger      = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes $totalMinutes)
        }
        'daily' {
            $startDateTime = [datetime]::ParseExact($StartTime, 'HH:mm:ss', $null)
            $interval      = if ($IntervalDays -and $IntervalDays -gt 1) { $IntervalDays } else { 1 }
            $trigger       = New-ScheduledTaskTrigger -Daily -At $startDateTime -DaysInterval $interval
        }
        'weekly' {
            $startDateTime = [datetime]::ParseExact($StartTime, 'HH:mm:ss', $null)
            $interval      = if ($IntervalWeeks -and $IntervalWeeks -gt 1) { $IntervalWeeks } else { 1 }
            $today         = (Get-Date).DayOfWeek
            $trigger       = New-ScheduledTaskTrigger -Weekly -At $startDateTime -WeeksInterval $interval -DaysOfWeek $today
        }
    }

    # Create the action to kill and start the container on trigger
    $runScript = Make-Script -ContainerId $ContainerId -Duration $Duration
    $action    = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -EncodedCommand $runScript"

    # To keep delayed runs, use: New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew
    # To kill delayed runs, use: New-ScheduledTaskSettingsSet -MultipleInstances StopExisting**
    $settings = New-ScheduledTaskSettingsSet
    $settings.CimInstanceProperties.Item('MultipleInstances').Value = 3 # **Not directly supported yet.
    # Set the execution time limit to "Never"
    $settings.ExecutionTimeLimit = "PT0H"

    # Check existing task
    $taskName     = Make-Task-Name -ContainerId $ContainerId
    $existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($existingTask) {
        $existingAction   = $existingTask.Actions[0]
        $existingTrigger  = $existingTask.Triggers[0]
        $existingSettings = $existingTask.Settings
        $ad = Actions-Differ $existingAction $action
        $td = Triggers-Differ $existingTrigger $trigger
        $sd = Settings-Differ $existingSettings $settings
        if ($ad -or $td -or $sd) {
            Set-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings | Out-Null
            Show-Info -Text "Run $ContainerId schedule updated."
        }
        else {
            Write-Output "Run $ContainerId is already scheduled."
        }
    }
    else {
        Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -User 'SYSTEM' -RunLevel Highest | Out-Null
        Show-Info -Text "Run $ContainerId has been scheduled."
    }

    # Check container restart policy
    $policy = docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' $ContainerId
    if ($policy -eq 'always' -or $policy -eq 'unless-stopped') {
        Show-Warning -Text "Run $ContainerId is set to ALWAYS restart after exit (Use NEVER or ON FAILURE)."
    }
}

function Remove-Schedule {
    param (
        [string]$ContainerId
    )
    # Check existing task
    $taskName     = Make-Task-Name -ContainerId $ContainerId
    $existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($existingTask) {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
        Write-Output "Run $ContainerId is not scheduled anymore."
    }
    else {
        Show-Warning -Text "Run $ContainerId schedule was not found."
    }
}

function Center-Text {
    param (
        [string]$Text,
        [int]$Width
    )
    if ($null -eq $Text) {
        $Text = ""
    }
    $textLength = $Text.Length
    if ($textLength -ge $Width) {
        return $Text.Substring(0, $Width)
    }
    $padLeft = [math]::Floor(($Width - $textLength) / 2)
    $padRight = $Width - $textLength - $padLeft
    return (' ' * $padLeft) + $Text + (' ' * $padRight)
}

function Convert-ISO8601-Duration {
    param (
        [string]$Duration
    )
    # Initialize values
    $years = 0; $months = 0; $weeks = 0; $days = 0
    $hours = 0; $minutes = 0; $seconds = 0
    # Regex to match full ISO 8601 duration format
    if ($Duration -match '^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$') {
        $years   = [int]($matches[1] -as [int])
        $months  = [int]($matches[2] -as [int])
        $weeks   = [int]($matches[3] -as [int])
        $days    = [int]($matches[4] -as [int])
        $hours   = [int]($matches[5] -as [int])
        $minutes = [int]($matches[6] -as [int])
        $seconds = [int]($matches[7] -as [int])
    }
    else {
        return "N/A"
    }
    # Build output, skip trailing zeroes
    $parts = @()
    if ($years)   { $parts += "${years}y" }
    if ($months)  { $parts += "${months}M" }  # Uppercase M for months
    if ($weeks)   { $parts += "${weeks}w" }
    if ($days)    { $parts += "${days}d" }
    if ($hours)   { $parts += "${hours}h" }
    if ($minutes) { $parts += "${minutes}m" } # Lowercase m for minutes
    if ($seconds) { $parts += "${seconds}s" }
    return ($parts -join ', ')
}

function Convert-Minutes-Duration {
    param (
        [int]$Minutes
    )
    if ($Minutes -eq 0) {
        return "N/A"
    }
    $minutesInYear  = 518400
    $minutesInMonth = 43200
    $minutesInDay   = 1440
    $minutesInHour  = 60
    $years    = [math]::Floor($Minutes / $minutesInYear)
    $Minutes -= $years * $minutesInYear
    $months   = [math]::Floor($Minutes / $minutesInMonth)
    $Minutes -= $months * $minutesInMonth
    $days     = [math]::Floor($Minutes / $minutesInDay)
    $Minutes -= $days * $minutesInDay
    $hours    = [math]::Floor($Minutes / $minutesInHour)
    $Minutes -= $hours * $minutesInHour
    $result = @()
    if ($years -gt 0)   { $result += "${years}y" }
    if ($months -gt 0)  { $result += "${months}M" }  # Uppercase M for months
    if ($days -gt 0)    { $result += "${days}d" }
    if ($hours -gt 0)   { $result += "${hours}h" }
    if ($Minutes -gt 0) { $result += "${Minutes}m" } # Lowercase m for minutes
    return ($result -join ', ')
}

function Truncate-String {
    param (
        [string]$InputString,
        [int]$MaxLength
    )

    if ($InputString.Length -le $MaxLength) {
        return $InputString
    }
    elseif ($MaxLength -le 3) {
        # Not enough space for text + ellipsis: just return dots
        return '.' * $MaxLength
    }
    else {
        $TrimmedLength = $MaxLength - 3
        return $InputString.Substring(0, $TrimmedLength) + "..."
    }
}

function Print-CustomTable {
    param (
        [array]$Items,
        [int]$Mode
    )
    $allColumns = @(
        @{ Label = "Actor Name";       Width=1+$MaxNameLength; Expression = { param($x) $x.ActorName } },
        @{ Label = "Run Id";           Width = 13; Expression = { param($x) $x.RunId } },
        @{ Label = "Run Name";         Width=1+$MaxNameLength; Expression = { param($x) $x.RunName } },
        @{ Label = "Run State";        Width = 11; Expression = { param($x) $x.RunState } },
        @{ Label = "Restart";          Width = 11; Expression = { param($x) $x.RSPolicy };   Center = $true },
        @{ Label = "Task Activation";  Width = 20; Expression = { param($x) $x.Activation }; Center = $true },
        @{ Label = "Interval";         Width = 10; Expression = { param($x) $x.Interval };   Center = $true },
        @{ Label = "Time Limit";       Width = 12; Expression = { param($x) $x.TimeLimit };  Center = $true },
        @{ Label = "Task Last Run";    Width = 20; Expression = { param($x) $x.LastRun };    Center = $true },
        @{ Label = "Task Last Result"; Width = 17; Expression = { param($x) $x.TaskResult }; Center = $true },
        @{ Label = "Task Next Run";    Width = 20; Expression = { param($x) $x.NextRun };    Center = $true }
    )
    # Define label lists for each mode
    switch ($Mode) {
        0 {
            $allLabels = @("Run Name", "Run State", "Interval", "Time Limit", "Task Next Run")
        }
        1 {
            $allLabels = @("Run Id", "Run Name", "Run State", "Restart", "Interval", "Time Limit", "Task Last Run", "Task Next Run")
        }
        2 {
            $allLabels = $allColumns.Label
        }
        default {
            throw "Invalid Mode value: $Mode"
        }
    }
    # Filter columns based on allowed labels
    $columns = $allColumns | Where-Object { $allLabels -contains $_.Label }
    # Print header
    $header = ($columns | ForEach-Object {
        if ($_.Center) {
            Center-Text -Text $_.Label -Width $_.Width
        }
        else {
            $_.Label.PadRight($_.Width)
        }
    }) -join ""
    $dashes = ($columns | ForEach-Object { '-' * ($_.Width - 1) + ' ' }) -join ""
    Write-Output $header
    Write-Output $dashes
    # Print rows
    foreach ($item in $Items) {
        $row = ($columns | ForEach-Object {
            $value = &($_.Expression) $item
            if ($_.Center) {
                Center-Text -Text "$value" -Width $_.Width
            }
            else {
                "$($value)".PadRight($_.Width)
            }
        }) -join ""
        Write-Output $row
    }
}

function Get-Friendly-Task-Result {
    param ($result)

    # Try convert to int
    $intResult = 0
    if (-not [int]::TryParse($result, [ref]$intResult)) {
        return $result
    }

    # Convert to hex string with 0x prefix (lowercase)
    $hexResult = "0x" + $intResult.ToString('x')

    switch ($hexResult) {
        '0x0'     { return 'Completed' }
        '0x1'     { return 'Script problem' }
        '0x2'     { return 'Docker problem' } # Custom error: must match $DockerErrorCode
        '0x41300' { return 'Ready' }
        '0x41301' { return 'Running' }
        '0x41302' { return 'Disabled' }
        '0x41303' { return 'Has not run' }
        '0x41304' { return 'No more runs' }
        '0x41305' { return 'Not scheduled' }
        '0x41306' { return 'Terminated' }
        '0x41307' { return 'No triggers' }
        '0x41308' { return 'No times set' }
        '0x4131b' { return 'Trigger problem' }
        '0x4131c' { return 'Login problem' }
        '0x41325' { return 'Queued' }
        default   { return $hexResult }
    }
}

function List-Scheduled-Tasks {
    param (
        [int]$ListMode,
        [string]$ListFilter
    )
    $tasks = Get-ScheduledTask | Where-Object { $_.TaskName -like "$TaskNamePrefix*" -and $_.TaskName -ne $BootTaskName }

    $results = @()

    foreach ($task in $tasks) {
        $containerId    = $task.TaskName.Substring($TaskNamePrefix.Length)

        $encScript      = ([regex]::Match($task.Actions[0].Arguments, '-EncodedCommand\s+(\S+)')).Groups[1].Value
        $decScript      = [System.Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($encScript))
        $duration       = [int](([regex]::Match($decScript, '\$minutes\s*=\s*(\d+)')).Groups[1].Value)
        $timeLimit      = Convert-Minutes-Duration -Minutes $duration

        $dockerCmd      = docker inspect $containerId 2>&1 | ConvertFrom-Json
        $ImageId        = $dockerCmd.Image
        $containerName  = Truncate-String -InputString $dockerCmd.Name.TrimStart('/') -MaxLength $MaxNameLength
        $containerState = $dockerCmd.State.Status
        $restartPolicy  = switch ($dockerCmd.HostConfig.RestartPolicy.Name) {
            ""               { "Never" }
            "no"             { "Never" }
            "always"         { "Always" }
            "unless-stopped" { "Always" }
            "on-failure"     { "On failure" }
            default          { $policy = "'$policy'" }
        }
        $dockerCmd      = docker inspect --format '{{ index .RepoTags 0 }}' $ImageId
        $rawName        = ($dockerCmd -split ':')[0].Replace($ActorNamePrefix, '')
        $imageName      = Truncate-String -InputString $rawName -MaxLength $MaxNameLength

        $trigger       = $task.Triggers[0]
        # Format start time ISO without 'T' and timezone
        $activation    = $trigger.StartBoundary -replace 'T', ' ' -replace '\+\d{2}:\d{2}$', ''

        # Human-friendly repetition interval
        if ($trigger.Repetition) {
            if ($null -ne $trigger.Repetition.Interval) {
                $interval = Convert-ISO8601-Duration $trigger.Repetition.Interval
            }
            else {
                switch ($trigger.CimClass.CimClassName) {
                    'MSFT_TaskTimeTrigger' {  # TimeTrigger (One time)
                        $interval = "One time"
                    }
                    'MSFT_TaskDailyTrigger' {
                        # Use DaysInterval property to fake an interval string
                        $days = if ($trigger.DaysInterval -and $trigger.DaysInterval -gt 1) { $trigger.DaysInterval } else { 1 }
                        $interval = "${days}d"
                    }
                    'MSFT_TaskWeeklyTrigger' {
                        # Use WeeksInterval property to fake an interval string
                        $weeks = if ($trigger.WeeksInterval -and $trigger.WeeksInterval -gt 1) { $trigger.WeeksInterval } else { 1 }
                        $interval = "${weeks}w"
                    }
                    default {
                        $interval = "N/A"
                    }
                }
            }
        }
        else {
            $interval = "N/A"
        }

        # Get last run and next run times via schtasks text output
        $lastRun = "N/A"
        $nextRun = "N/A"
        $runtime = schtasks /query /TN $task.TaskName /V /FO LIST | Select-String "Last Run Time", "Next Run Time", "Last Result"
        foreach ($line in $runtime) {
            if ($line.line -match "Last Run Time:\s*(.+)") {
                $rawLast = $matches[1].Trim()
                try {
                    $dtLast = [datetime]::Parse($rawLast)
                    if ($dtLast -eq [datetime]'1999-11-30 00:00:00') {
                        $lastRun = "Has not run"
                    }
                    else {
                        $lastRun = $dtLast.ToString("yyyy-MM-dd HH:mm:ss")
                    }
                }
                catch {}
            }
            elseif ($line.line -match "Next Run Time:\s*(.+)") {
                $rawNext = $matches[1].Trim()
                try {
                    $dtNext  = [datetime]::Parse($rawNext)
                    $nextRun = $dtNext.ToString("yyyy-MM-dd HH:mm:ss")
                }
                catch {}
            }
            elseif ($line.line -match "Last Result:\s*(.+)") {
                $taskResult = Get-Friendly-Task-Result $matches[1].Trim()
            }
        }

        $results += [PSCustomObject]@{
            ActorName  = $imageName
            RunId      = $containerId
            RunName    = $containerName
            RunState   = $containerState
            RSPolicy   = $restartPolicy
            Activation = $activation
            Interval   = $interval
            TimeLimit  = $timeLimit
            LastRun    = $lastRun
            TaskResult = $taskResult
            NextRun    = $nextRun
        }
    }

    $results = $results | Sort-Object -Property ActorName, RunName

    if ($ListFilter) {
        $results = $results | Where-Object { $_.ActorName -eq $ListFilter }
    }

    if ($results.Length) {
        # Format table with explicit column widths for good alignment
        Print-CustomTable -Items $results -Mode $ListMode
        Write-Output "`nTotal: $($results.Length)"
    }
    else {
        Write-Output "No scheduled runs were found to list"
    }
}

if ($Install) {
    Install-Boot-Task
}
elseif ($Uninstall) {
    Uninstall-Boot-Task
}
elseif ($Update) {
    Update-Boot-Task-Script
}
elseif ($UpdateTasks) {
    Update-Tasks-Script
}
elseif ($List) {
    $mode = switch ($Format) {
        "short" { 0 }
        "long"  { 2 }
        default { 1 }
    }
    List-Scheduled-Tasks -ListMode $mode -ListFilter $ActorName
}
elseif ($Remove) {
    foreach ($id in $RunId) {
        Remove-Schedule -ContainerId $id
    }
}
else {
    foreach ($id in $RunId) {
        $duration = $DurationHours * 60 + $DurationMinutes
        Create-Or-Update-Schedule -ContainerId $id -Duration $duration
    }
}
Write-Output ""
exit 0