# The six Windows screenshots of docs/EVENTS.md §6.4 (docs/screenshots/windows-*.png), run by screenshots.sh through
# vmjob.sh in the VM's desktop session. The installed Thirteen (%LOCALAPPDATA%\Programs\Thirteen) on the mockup data
# set (--fake-events: nothing is read or written, today is 2026-10-19), Almanac, 1440 x 900 at 100 %, light unless the
# name says dark. Each capture is the window with its dialog over it; each also writes the window's UI Automation
# tree (<name>-tree.txt: control type, name, automation id, focusable, patterns), the names Narrator reads.
# $Only (optional, comma-separated names) takes a subset.
$Exe = Join-Path $env:LOCALAPPDATA 'Programs\Thirteen\Thirteen.exe'
if (-not (Test-Path $Exe)) { throw "Thirteen is not installed at $Exe" }
$Out = 'C:\thirteen-qa\shots'
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$common = @('--fake-events', '--theme', 'almanac', '--width', '1440', '--height', '900')
$wanted = if ($Only) { $Only -split ',' } else { @() }

function Shot([string]$Name, [string[]]$Arguments, [scriptblock]$Steps) {
    if ($wanted.Count -gt 0 -and -not ($wanted -contains $Name)) { return }
    $p = Start-Thirteen $Exe ($common + $Arguments) 10
    try {
        if ($Steps) { & $Steps $p }
        Capture $p (Join-Path $Out "$Name.png")
        Dump-Tree $p (Join-Path $Out "$Name-tree.txt")
    } finally { Stop-Thirteen $p }
}

Shot 'windows-calendar-month' @('--mode', 'light', '--route', 'month/2026/11') $null
Shot 'windows-calendar-month-dark' @('--mode', 'dark', '--route', 'month/2026/11') $null
Shot 'windows-calendar-week' @('--mode', 'light', '--route', 'week/2026-10-19') $null
# Board I1: Book club: Cotsworth in the editor (the chip selected through UI Automation, then Ctrl+E).
Shot 'windows-event-editor' @('--mode', 'light', '--route', 'month/2026/11') {
    param($p)
    $chip = Find-Named $p 'Book club: Cotsworth, *'
    Log "chip: $(Invoke-Element $chip) '$($chip.Current.Name)'"
    $chip.SetFocus()
    Start-Sleep -Seconds 1
    [System.Windows.Forms.SendKeys]::SendWait('^e')
    Start-Sleep -Seconds 4
    $titles = @([QaCapture]::Windows($p.Id) | ForEach-Object { [QaCapture]::Title($_) })
    Log "windows after Ctrl+E: $($titles -join ' | ')"
    # The run that took docs/screenshots/windows-event-editor.png had this fallback: if Ctrl+E opened no dialog, Enter
    # on the chip opens its details and their Edit opens the editor.
    if ($titles.Count -lt 2) {
        $chip.SetFocus(); [System.Windows.Forms.SendKeys]::SendWait('{ENTER}'); Start-Sleep -Seconds 2
        Log "edit: $(Invoke-Element (Find-Named $p 'Edit'))"
        Start-Sleep -Seconds 4
    }
}
# Board D2, "after a successful check": a public holiday feed (Google's United States holidays; nothing is subscribed,
# the dialog is captured before its second Subscribe).
Shot 'windows-subscribe' @('--mode', 'light', '--route', 'month/2026/11') {
    param($p)
    Log "pane: $(Invoke-Element (Find-Named $p 'Subscribe to calendar'))"
    Start-Sleep -Seconds 2
    $dialog = [QaCapture]::Windows($p.Id) | Where-Object { $_ -ne $p.MainWindowHandle } | Select-Object -First 1
    $field = $UIA::FromHandle($dialog).FindFirst($TS::Descendants,
        (New-Object System.Windows.Automation.PropertyCondition($UIA::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)))
    $field.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue(
        'https://calendar.google.com/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics')
    Log "subscribe: $(Invoke-Element (Find-Named $p 'Subscribe'))"
    Log "found: '$((Find-Named $p '*events' 120).Current.Name)'"
    Start-Sleep -Seconds 2
}
# Board D2: the Calendars pane with a subscription's settings (name, color, link, update, Update now, Unsubscribe).
Shot 'windows-calendars' @('--mode', 'light', '--route', 'month/2026/11') {
    param($p)
    Log "settings: $(Invoke-Element (Find-Named $p 'Calendar settings, Holidays in Estonia'))"
    Start-Sleep -Seconds 3
}
