# Thirteen for Windows: installs one setup exe silently for the current user, checks the result (the Start menu
# entry with its app user model id and toast activator CLSID, the AppUserModelId key, the .ics ProgID and the webcal
# capabilities), runs the installed Thirteen.exe --smoke, starts it (on a computer without calendars, over a calendar
# with one alert, whose toast Thirteen must schedule) and uninstalls silently while it is open, and checks that it was
# closed, that the registrations and the scheduled toasts are gone and that the user's calendars in
# %LOCALAPPDATA%\Thirteen\Calendars are kept.
# Run by build-windows.sh on the build VM after the installers are compiled.
#
#   powershell -ExecutionPolicy Bypass -File installer\verify-install.ps1 -Setup dist\Thirteen-1.0.0-windows-arm64-setup.exe -Version 1.0.0 -BuildNumber 1
#
# With -Version (and -BuildNumber) it also checks the version registered under Settings, Apps and the
# file version of the installed Thirteen.exe (Version.BuildNumber, from windows/Directory.Build.props).

param(
    [Parameter(Mandatory = $true)][string]$Setup,
    [string]$Version = "",
    [string]$BuildNumber = "",
    [string]$AppId = "{E9148DCE-F491-4088-9E7E-58032C992992}"
)
$ErrorActionPreference = "Stop"

# Toasts and file associations (docs/EVENTS.md §6.4): the values Thirteen.iss writes.
$Aumid = "HaugasDevelopment.Thirteen"
$ToastActivator = "{E653BA95-A6A1-461C-A730-3CA20783D353}"
$AumidKey = "HKCU:\Software\Classes\AppUserModelId\$Aumid"
$ProgIdKey = "HKCU:\Software\Classes\Thirteen.ics"
$WebcalProgIdKey = "HKCU:\Software\Classes\Thirteen.webcal"
$CapabilitiesKey = "HKCU:\Software\HaugasDevelopment\Thirteen\Capabilities"
$RegisteredKey = "HKCU:\Software\RegisteredApplications"
$CalendarsDir = Join-Path $env:LOCALAPPDATA "Thirteen\Calendars"
$TestToastId = "thirteenverify"

$InstallDir = Join-Path $env:LOCALAPPDATA "Programs\Thirteen"
$Exe = Join-Path $InstallDir "Thirteen.exe"
$Shortcut = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Thirteen.lnk"
$UninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$($AppId)_is1"
$Name = Split-Path -Leaf $Setup

# Set once this check has started Thirteen: removes the settings and calendars folders the check created, also when it
# fails, so a failed run leaves the machine as it found it.
$script:Cleanup = $null

function Fail([string]$Message) {
    Write-Host "FAIL ${Name}: $Message" -ForegroundColor Red
    if ($script:Cleanup) { & $script:Cleanup }
    exit 1
}

function Run-Silently([string]$File) {
    $p = Start-Process -FilePath $File -ArgumentList "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART" -Wait -PassThru
    return $p.ExitCode
}

if (Test-Path $InstallDir) { Fail "$InstallDir already exists; uninstall Thirteen first" }

$code = Run-Silently (Resolve-Path $Setup).Path
if ($code -ne 0) { Fail "setup exited with code $code" }
if (-not (Test-Path $Exe)) { Fail "$Exe was not installed" }
if (-not (Test-Path $Shortcut)) { Fail "Start menu entry $Shortcut is missing" }
if (-not (Test-Path $UninstallKey)) { Fail "uninstall entry $UninstallKey is missing" }
$entry = Get-ItemProperty $UninstallKey
Write-Host ("installed:   {0} {1} by {2} in {3}" -f $entry.DisplayName, $entry.DisplayVersion, $entry.Publisher, $entry.InstallLocation)
$fileVersion = (Get-Item $Exe).VersionInfo.FileVersion
Write-Host "exe version: $fileVersion"
if ($Version -ne "" -and $entry.DisplayVersion -ne $Version) { Fail "uninstall entry has version $($entry.DisplayVersion), expected $Version" }
if ($Version -ne "" -and $BuildNumber -ne "" -and $fileVersion -ne "$Version.$BuildNumber") { Fail "Thirteen.exe has file version $fileVersion, expected $Version.$BuildNumber" }
# The Start menu entry must start the installed Thirteen.exe (launched from it below with --smoke).
$link = (New-Object -ComObject WScript.Shell).CreateShortcut($Shortcut)
if ($link.TargetPath -ne $Exe) { Fail "Start menu entry points at $($link.TargetPath), expected $Exe" }
Write-Host "start menu:  $Shortcut -> $($link.TargetPath)"
if ($entry.Publisher -ne "Haugas Development OU") { Fail "uninstall entry has publisher $($entry.Publisher)" }

$out = Join-Path $env:TEMP "thirteen-smoke.txt"
$start = @{ FilePath = $link.TargetPath; ArgumentList = "--smoke"; Wait = $true; PassThru = $true; NoNewWindow = $true; RedirectStandardOutput = $out }
if ($link.WorkingDirectory) { $start.WorkingDirectory = $link.WorkingDirectory }
$p = Start-Process @start
$smoke = Get-Content $out
Remove-Item $out -ErrorAction SilentlyContinue
if ($p.ExitCode -ne 0) { Fail "installed Thirteen.exe --smoke exited with code $($p.ExitCode)" }
if (-not ($smoke -match "^Today \(IFC\):")) { Fail "unexpected --smoke output: $smoke" }
Write-Host "smoke:       $($smoke[0])"
Write-Host "             $($smoke[-1])"

$ProtocolKey = "HKCU:\Software\Classes\thirteen"
$command = (Get-ItemProperty -Path "$ProtocolKey\shell\open\command" -ErrorAction SilentlyContinue).'(default)'
if (-not $command -or $command -notlike "*$Exe*") { Fail "thirteen:// is not registered to $Exe (found: $command)" }
Write-Host "protocol:    thirteen:// -> $command"

# The Start menu entry carries the toasts' app user model id and the stub toast activator CLSID (Shell property
# System.AppUserModel.ID and System.AppUserModel.ToastActivatorCLSID of the .lnk).
$shellApp = New-Object -ComObject Shell.Application
$lnk = $shellApp.Namespace((Split-Path $Shortcut)).ParseName((Split-Path -Leaf $Shortcut))
$lnkAumid = [string]$lnk.ExtendedProperty("System.AppUserModel.ID")
$lnkActivator = [string]$lnk.ExtendedProperty("System.AppUserModel.ToastActivatorCLSID")
if ($lnkAumid -ne $Aumid) { Fail "Start menu entry has app user model id '$lnkAumid', expected $Aumid" }
if ($lnkActivator.Trim('{', '}').ToUpperInvariant() -ne $ToastActivator.Trim('{', '}')) { Fail "Start menu entry has toast activator CLSID '$lnkActivator', expected $ToastActivator" }
Write-Host "shortcut:    AUMID $lnkAumid, toast activator $lnkActivator"

$aumidEntry = Get-ItemProperty -Path $AumidKey -ErrorAction SilentlyContinue
if (-not $aumidEntry -or $aumidEntry.DisplayName -ne "Thirteen") { Fail "$AumidKey has no DisplayName Thirteen" }
if (-not $aumidEntry.IconUri -or -not (Test-Path $aumidEntry.IconUri)) { Fail "$AumidKey IconUri '$($aumidEntry.IconUri)' is not an installed file" }
Write-Host "aumid key:   DisplayName $($aumidEntry.DisplayName), IconUri $($aumidEntry.IconUri)"

$icsCommand = (Get-ItemProperty -Path "$ProgIdKey\shell\open\command" -ErrorAction SilentlyContinue).'(default)'
if (-not $icsCommand -or $icsCommand -notlike "*$Exe*") { Fail "ProgID Thirteen.ics does not open $Exe (found: $icsCommand)" }
foreach ($ext in ".ics", ".ical") {
    $openWith = Get-ItemProperty -Path "HKCU:\Software\Classes\$ext\OpenWithProgids" -ErrorAction SilentlyContinue
    if (-not $openWith -or -not ($openWith.PSObject.Properties.Name -contains "Thirteen.ics")) { Fail "$ext has no OpenWithProgids entry Thirteen.ics" }
    $default = (Get-ItemProperty -Path "HKCU:\Software\Classes\$ext" -ErrorAction SilentlyContinue).'(default)'
    if ($default -eq "Thirteen.ics") { Fail "$ext was made a Thirteen file; Thirteen must never take the default" }
}
Write-Host "progid:      Thirteen.ics -> $icsCommand (Open with for .ics and .ical)"

$webcalCommand = (Get-ItemProperty -Path "$WebcalProgIdKey\shell\open\command" -ErrorAction SilentlyContinue).'(default)'
if (-not $webcalCommand -or $webcalCommand -notlike "*$Exe*") { Fail "ProgID Thirteen.webcal does not open $Exe (found: $webcalCommand)" }
$registered = (Get-ItemProperty -Path $RegisteredKey -ErrorAction SilentlyContinue).Thirteen
if ($registered -ne "Software\HaugasDevelopment\Thirteen\Capabilities") { Fail "RegisteredApplications has Thirteen = '$registered'" }
$urls = Get-ItemProperty -Path "$CapabilitiesKey\URLAssociations" -ErrorAction SilentlyContinue
if (-not $urls -or $urls.webcal -ne "Thirteen.webcal" -or $urls.webcals -ne "Thirteen.webcal") { Fail "the capabilities do not declare webcal and webcals" }
Write-Host "capabilities: webcal, webcals -> Thirteen.webcal; .ics, .ical -> Thirteen.ics (Default apps, not the default)"

# A toast scheduled under Thirteen's app user model id must be gone after uninstalling ([UninstallRun]
# Thirteen.exe --clear-alerts). Scheduled through WinRT here, so the check does not depend on calendar data. Windows
# may refuse a notifier in a session without a desktop (SSH): the check is then reported as skipped, not passed.
$toastChecked = $false
try {
    [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
    [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
    $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($Aumid)
    $toastXml = New-Object Windows.Data.Xml.Dom.XmlDocument
    $toastXml.LoadXml('<toast activationType="protocol" launch="thirteen://day/2026-10-19"><visual><binding template="ToastGeneric"><text>verify-install</text></binding></visual></toast>')
    $scheduled = New-Object Windows.UI.Notifications.ScheduledToastNotification($toastXml, [DateTimeOffset]::Now.AddDays(2))
    $scheduled.Id = $TestToastId
    $notifier.AddToSchedule($scheduled)
    $found = @($notifier.GetScheduledToastNotifications() | Where-Object { $_.Id -eq $TestToastId }).Count
    if ($found -ne 1) { Fail "the test toast was not scheduled (found $found)" }
    $toastChecked = $true
    Write-Host "toasts:      a test toast is scheduled under $Aumid"
} catch {
    Write-Host "toasts:      SKIPPED, no notifier in this session ($($_.Exception.Message.Trim()))"
}
$hadCalendars = Test-Path $CalendarsDir

# The installed Thirteen schedules its own alert toasts (docs/EVENTS.md §6.4, V13). On a computer without calendars, a
# calendar with one event and its alert is put in place before Thirteen starts; the toast Thirteen schedules for it must be
# listed under the app user model id, and gone after uninstalling. Only this end-to-end check sees a toast Windows
# refuses (task W11 found every toast refused: 16-character ids, 0x803E0120). A computer with calendars is not touched.
$AlertTitle = "verify-install alert"
if (-not $hadCalendars) {
    New-Item -ItemType Directory -Force -Path $CalendarsDir | Out-Null
    $alertStart = [DateTime]::UtcNow.Date.AddDays(2).AddHours(12)
    $utc = 'yyyyMMdd\THHmmss\Z'
    $ics = @("BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Haugas Development//Thirteen verify-install//EN", "X-WR-CALNAME:verify-install",
        "BEGIN:VEVENT", "UID:verify-install@thirteen.invalid", "DTSTAMP:$([DateTime]::UtcNow.ToString($utc))",
        "DTSTART:$($alertStart.ToString($utc))", "DTEND:$($alertStart.AddHours(1).ToString($utc))", "SUMMARY:$AlertTitle",
        "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Reminder", "TRIGGER:-PT30M", "END:VALARM", "END:VEVENT", "END:VCALENDAR") -join "`r`n"
    [System.IO.File]::WriteAllText((Join-Path $CalendarsDir "verify-install.ics"), $ics + "`r`n", (New-Object System.Text.UTF8Encoding($false)))
}

# Uninstall while Thirteen is open, as a user may: the uninstaller runs Thirteen.exe --quit, which closes
# it, so no file is left in use. A normal start writes settings.json on close; remove it again if this
# check created it.
$SettingsDir = Join-Path $env:APPDATA "Thirteen"
$hadSettings = Test-Path $SettingsDir
$app = Start-Process -FilePath $Exe -PassThru
$script:Cleanup = {
    if (-not $app.HasExited) { Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 500 }
    if (-not $hadSettings) { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $SettingsDir }
    if (-not $hadCalendars) {
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $CalendarsDir
        $parent = Split-Path $CalendarsDir
        if ((Test-Path $parent) -and -not (Get-ChildItem -Force $parent)) { Remove-Item -Force $parent }
    }
}
for ($i = 0; $i -lt 40 -and -not $app.HasExited -and $app.MainWindowHandle -eq 0; $i++) { Start-Sleep -Milliseconds 250; $app.Refresh() }
if ($app.HasExited) { Fail "Thirteen.exe exited at start with code $($app.ExitCode)" }
Write-Host "running:     Thirteen.exe (process $($app.Id)) before uninstalling"
# On a computer without calendars, wait (at most 30 s) for the running Thirteen to write its first-use index, so the
# check below has a file to keep.
$IndexFile = Join-Path $CalendarsDir "calendars.json"
for ($i = 0; $i -lt 120 -and -not $app.HasExited -and -not (Test-Path $IndexFile); $i++) { Start-Sleep -Milliseconds 250 }
$appToastChecked = $false
if (-not $hadCalendars -and $toastChecked) {
    for ($i = 0; $i -lt 120 -and -not $appToastChecked; $i++) {
        $mine = @($notifier.GetScheduledToastNotifications() | Where-Object { $_.Content.GetXml() -like "*$AlertTitle*" })
        if ($mine.Count -gt 0) {
            $appToastChecked = $true
            Write-Host ("toasts:      Thirteen scheduled its alert (id {0}, at {1:u})" -f $mine[0].Id, $mine[0].DeliveryTime.UtcDateTime)
        } else {
            Start-Sleep -Milliseconds 500
        }
    }
    if (-not $appToastChecked) { Fail "Thirteen scheduled no toast within 60 s for the alert of verify-install.ics" }
}

# Every calendar file there now (the user's, or the first-use calendar the running Thirteen created) must survive. The
# store's .lock (held open by the running Thirteen and deleted when it closes) and its .tmp write-throughs are not
# calendar files.
$calendarFiles = @()
if (Test-Path $CalendarsDir) {
    $calendarFiles = @(Get-ChildItem -File -Path $CalendarsDir | Where-Object { $_.Name -ne ".lock" -and $_.Name -notlike "*.tmp" } | ForEach-Object { $_.Name })
}
Write-Host "calendars:   $($calendarFiles.Count) file(s) in $CalendarsDir before uninstalling ($($calendarFiles -join ', '))"

$uninstaller = Join-Path $InstallDir "unins000.exe"
if (-not (Test-Path $uninstaller)) { Fail "uninstaller $uninstaller is missing" }
$code = Run-Silently $uninstaller
if ($code -ne 0) { Fail "uninstaller exited with code $code" }
# The uninstaller finishes its work from a copy in %TEMP%; give it a moment to remove the folder.
for ($i = 0; $i -lt 60 -and ((Test-Path $InstallDir) -or (Test-Path $UninstallKey)); $i++) { Start-Sleep -Milliseconds 500 }
if (Test-Path $InstallDir) { Fail "$InstallDir is still present after uninstalling" }
if (Test-Path $Shortcut) { Fail "Start menu entry is still present after uninstalling" }
if (Test-Path $UninstallKey) { Fail "uninstall entry is still present after uninstalling" }
if (Test-Path $ProtocolKey) { Fail "thirteen:// registration is still present after uninstalling" }
if (-not $app.HasExited) { Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue; Fail "the running Thirteen.exe was not closed by the uninstaller" }
if (Test-Path $AumidKey) { Fail "$AumidKey is still present after uninstalling" }
if (Test-Path $ProgIdKey) { Fail "ProgID Thirteen.ics is still present after uninstalling" }
if (Test-Path $WebcalProgIdKey) { Fail "ProgID Thirteen.webcal is still present after uninstalling" }
if (Test-Path (Split-Path $CapabilitiesKey)) { Fail "the capabilities key is still present after uninstalling" }
if ((Get-ItemProperty -Path $RegisteredKey -ErrorAction SilentlyContinue).Thirteen) { Fail "RegisteredApplications still lists Thirteen after uninstalling" }
foreach ($ext in ".ics", ".ical") {
    $openWith = Get-ItemProperty -Path "HKCU:\Software\Classes\$ext\OpenWithProgids" -ErrorAction SilentlyContinue
    if ($openWith -and ($openWith.PSObject.Properties.Name -contains "Thirteen.ics")) { Fail "$ext still opens with Thirteen after uninstalling" }
}
if ($toastChecked) {
    $left = @($notifier.GetScheduledToastNotifications() | Where-Object { $_.Id -eq $TestToastId }).Count
    if ($left -ne 0) {
        foreach ($t in @($notifier.GetScheduledToastNotifications())) { $notifier.RemoveFromSchedule($t) }
        Fail "a scheduled toast is still there after uninstalling (--clear-alerts did not run)"
    }
    Write-Host "toasts:      the scheduled toast was removed by the uninstaller"
}
if ($appToastChecked) {
    $leftApp = @($notifier.GetScheduledToastNotifications() | Where-Object { $_.Content.GetXml() -like "*$AlertTitle*" }).Count
    if ($leftApp -ne 0) {
        foreach ($t in @($notifier.GetScheduledToastNotifications())) { $notifier.RemoveFromSchedule($t) }
        Fail "Thirteen's scheduled alert is still there after uninstalling (--clear-alerts did not run)"
    }
    Write-Host "toasts:      Thirteen's scheduled alert was removed by the uninstaller"
}
# The user's calendars stay (§6.4): the folder the running Thirteen created or found is still there, with every file
# it held before uninstalling.
if (Test-Path (Split-Path $CalendarsDir)) {
    if (-not (Test-Path $CalendarsDir)) { Fail "$CalendarsDir was removed by the uninstaller" }
    foreach ($file in $calendarFiles) {
        if (-not (Test-Path (Join-Path $CalendarsDir $file))) { Fail "the calendar file $file was removed by the uninstaller" }
    }
    Write-Host "calendars:   $CalendarsDir is kept with its $($calendarFiles.Count) file(s)"
}
& $script:Cleanup
Write-Host "uninstalled: folder, Start menu entry, uninstall entry, thirteen:// and file registrations removed; the open Thirteen was closed"
Write-Host "PASS $Name" -ForegroundColor Green
