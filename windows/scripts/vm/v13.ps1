# Gate V13 without the reboot (docs/EVENTS.md §8.2), run by vmjob.sh in the VM's desktop session with Arch=x64 or
# Arch=arm64 (only a label): a calendar with two events is put in place for the installed Thirteen (only on a computer
# with no Thirteen store, which this job removes again at the end); a normal start of Thirteen schedules their alert
# toasts (THIRTEEN_TRACE=1 copies its log to v13-trace-<arch>.txt); Thirteen is closed with --quit; toast A must show
# with Thirteen closed, and its banner is clicked through UI Automation, which must start Thirteen on thirteen://day/;
# then Thirteen is uninstalled before toast B is due, and B must not show.
#
#   sh windows/scripts/vm/vmjob.sh windows/scripts/vm/v13.ps1 2400 Arch=arm64
$Aumid = 'HaugasDevelopment.Thirteen'
$Exe = Join-Path $env:LOCALAPPDATA 'Programs\Thirteen\Thirteen.exe'
$Calendars = Join-Path $env:LOCALAPPDATA 'Thirteen\Calendars'
if (-not (Test-Path $Exe)) { throw "Thirteen is not installed at $Exe" }
if (Test-Path (Join-Path $env:LOCALAPPDATA 'Thirteen')) { throw "a Thirteen store already exists; not touching it" }
[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
function Scheduled { try { @([Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($Aumid).GetScheduledToastNotifications()) } catch { Log "scheduled: notifier refused ($($_.Exception.Message.Trim()))"; @() } }
function History { try { @([Windows.UI.Notifications.ToastNotificationManager]::History.GetHistory($Aumid)) } catch { Log "history: refused ($($_.Exception.Message.Trim()))"; @() } }

# Two events of a new local calendar: A starts 12 to 13 minutes from now and alerts 7 to 8 minutes from now, B starts
# and alerts 8 minutes after A (5 minutes before their starts, a relative trigger, as Thirteen's presets write it).
$now = [DateTime]::UtcNow
$startA = $now.AddSeconds(60 - $now.Second).AddMinutes(12)
$startB = $startA.AddMinutes(8)
$fmt = 'yyyyMMdd\THHmmss\Z'
$stamp = $now.ToString($fmt)
$ics = @(
 'BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Thirteen QA//W11 V13//EN','X-WR-CALNAME:V13 check',
 'BEGIN:VEVENT',"UID:w11-v13-a-$Arch@thirteen.qa","DTSTAMP:$stamp","DTSTART:$($startA.ToString($fmt))","DTEND:$($startA.AddMinutes(30).ToString($fmt))","SUMMARY:V13 toast $Arch A",
 'BEGIN:VALARM','ACTION:DISPLAY','DESCRIPTION:Reminder','TRIGGER:-PT5M','END:VALARM','END:VEVENT',
 'BEGIN:VEVENT',"UID:w11-v13-b-$Arch@thirteen.qa","DTSTAMP:$stamp","DTSTART:$($startB.ToString($fmt))","DTEND:$($startB.AddMinutes(30).ToString($fmt))","SUMMARY:V13 toast $Arch B",
 'BEGIN:VALARM','ACTION:DISPLAY','DESCRIPTION:Reminder','TRIGGER:-PT5M','END:VALARM','END:VEVENT',
 'END:VCALENDAR') -join "`r`n"
New-Item -ItemType Directory -Force -Path $Calendars | Out-Null
[System.IO.File]::WriteAllText((Join-Path $Calendars 'w11-v13.ics'), $ics + "`r`n", (New-Object System.Text.UTF8Encoding($false)))
Log "store seeded: A starts $($startA.ToString('o')), alert $($startA.AddMinutes(-5).ToString('o')); B starts $($startB.ToString('o')), alert $($startB.AddMinutes(-5).ToString('o'))"

# A normal start of the installed app schedules the toasts; then it is closed the way the uninstaller closes it.
$env:THIRTEEN_TRACE = '1'
$traceFile = "C:\thirteen-qa\v13-trace-$Arch.txt"
$p = Start-Process -FilePath $Exe -PassThru -RedirectStandardError $traceFile
for ($i = 0; $i -lt 240 -and $p.MainWindowHandle -eq 0 -and -not $p.HasExited; $i++) { Start-Sleep -Milliseconds 250; $p.Refresh() }
Log "started pid $($p.Id) window $($p.MainWindowHandle) (THIRTEEN_TRACE=1, stderr to $traceFile)"
Remove-Item Env:\THIRTEEN_TRACE
$deadline = (Get-Date).AddSeconds(180)
while ((Get-Date) -lt $deadline -and @(Scheduled).Count -lt 2) { Start-Sleep -Seconds 2 }
Log "scheduled toasts seen after start: $(@(Scheduled).Count)"
foreach ($t in Scheduled) { Log ("scheduled: id {0} at {1:o} xml {2}" -f $t.Id, $t.DeliveryTime.UtcDateTime, $t.Content.GetXml()) }
$q = Start-Process -FilePath $Exe -ArgumentList '--quit' -Wait -PassThru
Start-Sleep -Seconds 2; $p.Refresh()
Log "closed: --quit exit $($q.ExitCode); Thirteen running: $(@(Get-Process Thirteen -ErrorAction SilentlyContinue).Count)"
foreach ($line in @(Get-Content $traceFile -ErrorAction SilentlyContinue | Where-Object { $_ -like 'Thirteen:*' })) { Log "trace: $line" }
foreach ($t in Scheduled) { Log ("scheduled after close: id {0} at {1:o}" -f $t.Id, $t.DeliveryTime.UtcDateTime) }

# Wait for toast A with Thirteen closed, then click its banner.
$fireA = $startA.AddMinutes(-5)
$clicked = $false
$desktop = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, 'New notification')
while ([DateTime]::UtcNow -lt $fireA.AddSeconds(120) -and -not $clicked) {
    $host_ = $desktop.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
    if ($host_) {
        $all = $host_.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
        $names = @($all | ForEach-Object { "$($_.Current.ControlType.ProgrammaticName)='$($_.Current.Name)'" })
        Log ("banner at {0:o} (alert time {1:o}): {2}" -f [DateTime]::UtcNow, $fireA, ($names -join '; '))
        $target = $all | Where-Object { $_.Current.Name -like "*V13 toast $Arch A*" } | Select-Object -First 1
        if ($target) {
            $shot = "C:\thirteen-qa\v13-banner-$Arch.png"
            $b = $host_.Current.BoundingRectangle
            $bmp = New-Object System.Drawing.Bitmap([int]$b.Width, [int]$b.Height)
            $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen([int]$b.X, [int]$b.Y, 0, 0, $bmp.Size); $g.Dispose(); $bmp.Save($shot); $bmp.Dispose()
            Log "banner captured to $shot"
            Log "click: $(Invoke-Element $target) on '$($target.Current.Name)'"
            $clicked = $true
        }
    }
    Start-Sleep -Milliseconds 300
}
foreach ($h in History) { Log ("history: tag {0} xml {1}" -f $h.Tag, $h.Content.GetXml()) }
if (-not $clicked) { Log "no banner of toast A was found to click" }
Start-Sleep -Seconds 8
$opened = @(Get-CimInstance Win32_Process -Filter "Name='Thirteen.exe'")
foreach ($o in $opened) { Log "after click: Thirteen.exe pid $($o.ProcessId) command line: $($o.CommandLine)" }
if ($opened.Count -gt 0) {
    $op = Get-Process -Id $opened[0].ProcessId
    Start-Sleep -Seconds 4
    Capture $op "C:\thirteen-qa\v13-click-$Arch.png"
    $root = Root $op
    $heads = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) | Where-Object { $_.Current.Name -like '*2026*' } | Select-Object -First 8
    foreach ($e in $heads) { Log "day view text: $($e.Current.ControlType.ProgrammaticName) '$($e.Current.Name)'" }
    $q = Start-Process -FilePath $Exe -ArgumentList '--quit' -Wait -PassThru
    Start-Sleep -Seconds 2
    Log "closed again: --quit exit $($q.ExitCode); running: $(@(Get-Process Thirteen -ErrorAction SilentlyContinue).Count)"
}

# B is still scheduled; uninstall before it fires, then watch for it.
foreach ($t in Scheduled) { Log ("scheduled before uninstall: id {0} at {1:o}" -f $t.Id, $t.DeliveryTime.UtcDateTime) }
$un = Start-Process -FilePath (Join-Path $env:LOCALAPPDATA 'Programs\Thirteen\unins000.exe') -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART' -Wait -PassThru
for ($i = 0; $i -lt 360 -and (Test-Path (Join-Path $env:LOCALAPPDATA 'Programs\Thirteen')); $i++) { Start-Sleep -Milliseconds 500 }
Log "uninstalled: exit $($un.ExitCode); program folder present: $(Test-Path (Join-Path $env:LOCALAPPDATA 'Programs\Thirteen')); calendars kept: $(@(Get-ChildItem $Calendars -File | ForEach-Object Name) -join ', ')"
foreach ($t in Scheduled) { Log ("scheduled after uninstall: id {0} at {1:o}" -f $t.Id, $t.DeliveryTime.UtcDateTime) }
$fireB = $startB.AddMinutes(-5)
$seenB = $false
while ([DateTime]::UtcNow -lt $fireB.AddSeconds(90)) {
    $host_ = $desktop.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
    if ($host_) {
        $all = $host_.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
        $names = @($all | ForEach-Object { $_.Current.Name }) -join '; '
        Log ("banner while waiting for B at {0:o}: {1}" -f [DateTime]::UtcNow, $names)
        if ($names -like "*V13 toast $Arch B*") { $seenB = $true }
    }
    Start-Sleep -Milliseconds 500
}
Log ("toast B (alert time {0:o}) after uninstall: {1}" -f $fireB, $(if ($seenB) { 'SHOWN (fail)' } else { 'not shown' }))
foreach ($h in History) { Log ("history after uninstall: tag {0} xml {1}" -f $h.Tag, $h.Content.GetXml()) }

# Leave nothing: the store and settings this check created.
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $env:LOCALAPPDATA 'Thirteen'), (Join-Path $env:APPDATA 'Thirteen')
Log "cleaned: store present $(Test-Path (Join-Path $env:LOCALAPPDATA 'Thirteen')), settings present $(Test-Path (Join-Path $env:APPDATA 'Thirteen'))"
