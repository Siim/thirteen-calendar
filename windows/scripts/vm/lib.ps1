# Helpers for QA jobs in the build VM's interactive session (session 1), run by vmjob.sh through a scheduled task:
# start Thirteen, find and invoke UI Automation elements by name, dump the UI Automation tree (the names Narrator
# reads), and capture a window with the dialogs and popups over it (PrintWindow, PW_RENDERFULLCONTENT).
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing, System.Windows.Forms
if (-not ('QaCapture' -as [type])) {
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class QaCapture {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  // Visible top-level windows of a process, top of the z-order first.
  public static List<IntPtr> Windows(int pid) {
    var list = new List<IntPtr>();
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == (uint)pid && IsWindowVisible(h)) { RECT r; GetWindowRect(h, out r); if (r.R - r.L > 1 && r.B - r.T > 1) list.Add(h); } return true; }, IntPtr.Zero);
    return list;
  }
  public static string Title(IntPtr h) { var s = new System.Text.StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }
  public static RECT Frame(IntPtr h) { RECT f; if (DwmGetWindowAttribute(h, 9, out f, 16) != 0) GetWindowRect(h, out f); return f; }
  public static Bitmap Shot(IntPtr h, out RECT frame) {
    RECT wr; GetWindowRect(h, out wr); frame = Frame(h);
    var bmp = new Bitmap(wr.R - wr.L, wr.B - wr.T, PixelFormat.Format32bppArgb);
    using (var g = Graphics.FromImage(bmp)) { var hdc = g.GetHdc(); PrintWindow(h, hdc, 2); g.ReleaseHdc(hdc); }
    var crop = new Rectangle(frame.L - wr.L, frame.T - wr.T, frame.R - frame.L, frame.B - frame.T);
    crop.Intersect(new Rectangle(0, 0, bmp.Width, bmp.Height));
    var result = bmp.Clone(crop, PixelFormat.Format32bppArgb); bmp.Dispose(); return result;
  }
  // The main window with every other visible window of the process (dialogs, popups) drawn over it where it is on screen.
  public static string Compose(int pid, IntPtr main, string path) {
    RECT mf; var canvas = Shot(main, out mf);
    var log = new System.Text.StringBuilder();
    log.AppendFormat("main {0} {1}x{2} at {3},{4}\n", Title(main), mf.R - mf.L, mf.B - mf.T, mf.L, mf.T);
    using (var g = Graphics.FromImage(canvas)) {
      var list = Windows(pid); list.Reverse();
      foreach (var h in list) {
        if (h == main) continue;
        RECT f; var b = Shot(h, out f);
        log.AppendFormat("over '{0}' {1}x{2} at {3},{4}\n", Title(h), f.R - f.L, f.B - f.T, f.L - mf.L, f.T - mf.T);
        g.DrawImage(b, f.L - mf.L, f.T - mf.T, b.Width, b.Height); b.Dispose();
      }
    }
    // Opaque: PrintWindow leaves the alpha of some pixels at 0.
    using (var opaque = new Bitmap(canvas.Width, canvas.Height, PixelFormat.Format24bppRgb)) {
      using (var g = Graphics.FromImage(opaque)) { g.DrawImage(canvas, 0, 0, canvas.Width, canvas.Height); }
      opaque.Save(path, ImageFormat.Png);
    }
    canvas.Dispose();
    return log.ToString();
  }
}
"@
}
[void][QaCapture]::SetProcessDpiAwarenessContext([IntPtr](-4))
$UIA = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]

function Log([string]$Text) { Add-Content -Path $global:JobLog -Value ("{0:HH:mm:ss} {1}" -f (Get-Date), $Text) }

function Start-Thirteen([string]$Exe, [string[]]$Arguments, [int]$Settle = 8) {
    $p = if ($Arguments -and $Arguments.Count -gt 0) { Start-Process -FilePath $Exe -ArgumentList $Arguments -PassThru } else { Start-Process -FilePath $Exe -PassThru }
    for ($i = 0; $i -lt 120 -and $p.MainWindowHandle -eq 0 -and -not $p.HasExited; $i++) { Start-Sleep -Milliseconds 250; $p.Refresh() }
    if ($p.HasExited) { throw "Thirteen exited at start with code $($p.ExitCode)" }
    Start-Sleep -Seconds $Settle
    $p.Refresh()
    [void][QaCapture]::SetForegroundWindow($p.MainWindowHandle)
    Log "started pid $($p.Id) window $($p.MainWindowHandle) '$([QaCapture]::Title($p.MainWindowHandle))'"
    return $p
}

function Root($p) { return $UIA::FromHandle($p.MainWindowHandle) }

# Every element of the process's windows whose name matches (wildcard), first one.
function Find-Named($p, [string]$Pattern, [int]$TimeoutSeconds = 90) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        foreach ($h in [QaCapture]::Windows($p.Id)) {
            $root = $UIA::FromHandle($h)
            $all = $root.FindAll($TS::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
            foreach ($e in $all) { if ($e.Current.Name -like $Pattern) { return $e } }
        }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    throw "no element named like '$Pattern'"
}

function Invoke-Element($e) {
    $pattern = $null
    if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) { $pattern.Invoke(); return "invoke" }
    if ($e.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) { $pattern.Select(); return "select" }
    if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pattern)) { $pattern.Toggle(); return "toggle" }
    $e.SetFocus(); [System.Windows.Forms.SendKeys]::SendWait("{ENTER}"); return "focus+enter"
}

function Dump-Tree($p, [string]$Path) {
    $lines = New-Object System.Collections.Generic.List[string]
    foreach ($h in [QaCapture]::Windows($p.Id)) {
        $root = $UIA::FromHandle($h)
        $lines.Add("WINDOW '$($root.Current.Name)' $($root.Current.ControlType.ProgrammaticName)")
        $all = $root.FindAll($TS::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
        foreach ($e in $all) {
            $c = $e.Current
            $patterns = ($e.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName -replace 'PatternIdentifiers.Pattern','' }) -join ','
            $lines.Add(("{0}|{1}|{2}|{3}|{4}" -f $c.ControlType.ProgrammaticName, $c.Name, $c.AutomationId, $c.IsKeyboardFocusable, $patterns))
        }
    }
    [System.IO.File]::WriteAllLines($Path, $lines)
    Log "tree: $($lines.Count) lines -> $Path"
}

function Capture($p, [string]$Path) {
    $p.Refresh()
    $log = [QaCapture]::Compose($p.Id, $p.MainWindowHandle, $Path)
    Log ("captured {0}`n{1}" -f $Path, $log.TrimEnd())
}

function Stop-Thirteen($p) {
    if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 500
}
