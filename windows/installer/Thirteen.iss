; Thirteen for Windows: Inno Setup 6 script (tested with 6.7.0).
; Per-user install (no administrator rights, %LOCALAPPDATA%\Programs\Thirteen), a Start menu entry with the
; app user model id of Thirteen's toasts, the thirteen: protocol, "Open with" for .ics files, webcal capabilities,
; an uninstaller registered under Settings > Apps (it clears scheduled toasts and keeps %LOCALAPPDATA%\Thirteen,
; the user's calendars), and one installer per architecture:
;
;   ISCC /DArch=x64   /DAppVersion=1.0.0 /DBuildNumber=1 Thirteen.iss  ->  ..\dist\Thirteen-1.0.0-windows-x64-setup.exe
;   ISCC /DArch=arm64 /DAppVersion=1.0.0 /DBuildNumber=1 Thirteen.iss  ->  ..\dist\Thirteen-1.0.0-windows-arm64-setup.exe
;
; The versioned names are the release artifacts (docs/RELEASING.md); build-windows.sh also copies them
; to the stable names Thirteen-windows-<arch>-setup.exe used by the releases/latest/download links
; (design/DECISIONS.md).
;
; Input is the self-contained publish folder ..\publish\win-<Arch> (dotnet publish -r win-<Arch>);
; override with /DPublishDir=... and /DOutputDir=... . build-windows.sh runs all of this on the VM.
; Both architectures share one AppId, so installing either one upgrades or replaces the other.

#ifndef Arch
  #define Arch "x64"
#endif
#if Arch != "x64" && Arch != "arm64"
  #error Arch must be x64 or arm64
#endif
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef BuildNumber
  #define BuildNumber "1"
#endif
#ifndef PublishDir
  #define PublishDir "..\publish\win-" + Arch
#endif
#ifndef OutputDir
  #define OutputDir "..\dist"
#endif
#ifndef IconFile
  #define IconFile "..\Thirteen.Desktop\Assets\Thirteen.ico"
#endif

#define AppName "Thirteen"
#define AppPublisher "Haugas Development OU"
#define AppExeName "Thirteen.exe"
#define AppId "{{E9148DCE-F491-4088-9E7E-58032C992992}"
; The app user model id of the Start menu entry, the process and its alert toasts (docs/EVENTS.md §6.4); the same
; constant as ToastPlatform.AppUserModelId in Thirteen.Desktop/Services/ToastPlatform.cs.
#define AppUserModelId "HaugasDevelopment.Thirteen"
; A stub toast activator CLSID, generated once for Thirteen and never changed: Microsoft's "no COM activator" option for
; unpackaged apps. Nothing is registered under it; toast clicks arrive through the thirteen: protocol instead.
#define ToastActivatorClsid "E653BA95-A6A1-461C-A730-3CA20783D353"

[Setup]
AppId={#AppId}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppCopyright=Copyright (c) {#AppPublisher}
VersionInfoVersion={#AppVersion}.{#BuildNumber}
VersionInfoProductVersion={#AppVersion}
VersionInfoCompany={#AppPublisher}
VersionInfoProductName={#AppName}
VersionInfoDescription={#AppName} Setup ({#Arch})
; Per-user: {autopf} resolves to %LOCALAPPDATA%\Programs and {autoprograms} to the user's Start menu.
PrivilegesRequired=lowest
DefaultDirName={autopf}\{#AppName}
DisableProgramGroupPage=yes
UsePreviousAppDir=yes
OutputDir={#OutputDir}
OutputBaseFilename=Thirteen-{#AppVersion}-windows-{#Arch}-setup
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\{#AppExeName}
UninstallDisplayName={#AppName}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
MinVersion=10.0.17763
CloseApplications=yes
RestartApplications=no
; The .ics / .ical "Open with" entries and the webcal capabilities below: tell Explorer once setup has written them.
ChangesAssociations=yes
#if Arch == "arm64"
ArchitecturesAllowed=arm64
ArchitecturesInstallIn64BitMode=arm64
#else
; x64compatible also admits Windows 11 on Arm, which runs the x64 build under emulation.
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
#endif

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#PublishDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
; The icon of the toasts' app user model id (IconUri below), also shown by Windows without the shortcut.
Source: "{#IconFile}"; DestDir: "{app}"; DestName: "Thirteen.ico"; Flags: ignoreversion

[Icons]
; The Start menu entry carries the app user model id and the stub toast activator CLSID, so Windows shows the toasts
; Thirteen schedules (§6.4); a click on one opens thirteen://day/{date} through the protocol below.
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExeName}"; AppUserModelID: "{#AppUserModelId}"; AppUserModelToastActivatorCLSID: "{#ToastActivatorClsid}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon; AppUserModelID: "{#AppUserModelId}"

[Registry]
; thirteen:// links (thirteen://today, thirteen://year/2026?day=2026-10-19, ...) open the app; a running
; instance receives the link instead of a second window. Per user, removed again by the uninstaller.
Root: HKCU; Subkey: "Software\Classes\thirteen"; ValueType: string; ValueName: ""; ValueData: "URL:Thirteen"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\thirteen"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\thirteen\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExeName}"",0"
Root: HKCU; Subkey: "Software\Classes\thirteen\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExeName}"" ""%1"""

; Toasts (docs/EVENTS.md §6.4): the app user model id's name and icon, so toasts show "Thirteen" and its icon even
; without the shortcut.
Root: HKCU; Subkey: "Software\Classes\AppUserModelId\{#AppUserModelId}"; ValueType: string; ValueName: "DisplayName"; ValueData: "{#AppName}"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\AppUserModelId\{#AppUserModelId}"; ValueType: string; ValueName: "IconUri"; ValueData: "{app}\Thirteen.ico"

; .ics and .ical files: Thirteen appears under "Open with" (OpenWithProgids) and never takes the default. A file opened
; with it goes to the Import dialog (Thirteen.exe "C:\path\file.ics").
Root: HKCU; Subkey: "Software\Classes\Thirteen.ics"; ValueType: string; ValueName: ""; ValueData: "iCalendar file"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\Thirteen.ics"; ValueType: string; ValueName: "FriendlyTypeName"; ValueData: "iCalendar file"
Root: HKCU; Subkey: "Software\Classes\Thirteen.ics\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExeName}"",0"
Root: HKCU; Subkey: "Software\Classes\Thirteen.ics\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExeName}"" ""%1"""
Root: HKCU; Subkey: "Software\Classes\.ics\OpenWithProgids"; ValueType: string; ValueName: "Thirteen.ics"; ValueData: ""; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\.ical\OpenWithProgids"; ValueType: string; ValueName: "Thirteen.ics"; ValueData: ""; Flags: uninsdeletevalue

; webcal:// and webcals:// links: declared as capabilities (Software\RegisteredApplications), so the user can choose
; Thirteen for them in Settings > Default apps; Thirteen is never made the default. A link opened with it goes to the
; Subscribe dialog, prefilled, and nothing is fetched until Subscribe is pressed.
Root: HKCU; Subkey: "Software\Classes\Thirteen.webcal"; ValueType: string; ValueName: ""; ValueData: "URL:Calendar subscription"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\Thirteen.webcal"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\Thirteen.webcal\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExeName}"",0"
Root: HKCU; Subkey: "Software\Classes\Thirteen.webcal\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExeName}"" ""%1"""
Root: HKCU; Subkey: "Software\HaugasDevelopment"; Flags: uninsdeletekeyifempty
Root: HKCU; Subkey: "Software\HaugasDevelopment\Thirteen"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\HaugasDevelopment\Thirteen\Capabilities"; ValueType: string; ValueName: "ApplicationName"; ValueData: "{#AppName}"
Root: HKCU; Subkey: "Software\HaugasDevelopment\Thirteen\Capabilities"; ValueType: string; ValueName: "ApplicationDescription"; ValueData: "The 13-month calendar next to the Gregorian one."
Root: HKCU; Subkey: "Software\HaugasDevelopment\Thirteen\Capabilities"; ValueType: string; ValueName: "ApplicationIcon"; ValueData: """{app}\{#AppExeName}"",0"
Root: HKCU; Subkey: "Software\HaugasDevelopment\Thirteen\Capabilities\URLAssociations"; ValueType: string; ValueName: "webcal"; ValueData: "Thirteen.webcal"
Root: HKCU; Subkey: "Software\HaugasDevelopment\Thirteen\Capabilities\URLAssociations"; ValueType: string; ValueName: "webcals"; ValueData: "Thirteen.webcal"
Root: HKCU; Subkey: "Software\HaugasDevelopment\Thirteen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".ics"; ValueData: "Thirteen.ics"
Root: HKCU; Subkey: "Software\HaugasDevelopment\Thirteen\Capabilities\FileAssociations"; ValueType: string; ValueName: ".ical"; ValueData: "Thirteen.ics"
Root: HKCU; Subkey: "Software\RegisteredApplications"; ValueType: string; ValueName: "{#AppName}"; ValueData: "Software\HaugasDevelopment\Thirteen\Capabilities"; Flags: uninsdeletevalue

[Run]
Filename: "{app}\{#AppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(AppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; No alert toast fires after Thirteen is gone: Thirteen.exe --clear-alerts removes every toast it scheduled (§6.4). It
; runs after InitializeUninstall has closed the running Thirteen, and before the files are removed.
Filename: "{app}\{#AppExeName}"; Parameters: "--clear-alerts"; RunOnceId: "ClearAlerts"; Flags: runhidden waituntilterminated

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
// Thirteen.exe --quit closes the Thirteen of this session the way its close button does (it saves its
// settings) and waits until it has exited. Without it, uninstalling while Thirteen was open left
// Thirteen.exe and its libraries in {app}, and an upgrade would find them in use.
procedure QuitRunningThirteen();
var
  Exe: String;
  ResultCode: Integer;
begin
  Exe := ExpandConstant('{app}\{#AppExeName}');
  if FileExists(Exe) then
    Exec(Exe, '--quit', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  QuitRunningThirteen();
  Result := '';
end;

function InitializeUninstall(): Boolean;
begin
  QuitRunningThirteen();
  Result := True;
end;
