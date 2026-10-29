; DreamCanvas installer (Inno Setup 6). Built by build.ps1 -Installer from artifacts\DreamCanvas.
; Per-user install: no administrator rights needed, nothing written outside the user's profile
; except the optional WebView2 runtime, which Microsoft's own setup installs.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#define Source "..\artifacts\DreamCanvas"

[Setup]
AppId={{6B2E0C7A-4D1F-4C8E-9C3A-2F7D5E8B1A90}
AppName=DreamCanvas
AppVersion={#AppVersion}
AppVerName=DreamCanvas {#AppVersion}
AppPublisher=DreamCanvas
AppComments=Live wallpapers, scene editor, video wallpapers, widgets and screensaver for Windows.
VersionInfoVersion={#AppVersion}
DefaultDirName={autopf}\DreamCanvas
DefaultGroupName=DreamCanvas
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir=..\artifacts\installer
OutputBaseFilename=DreamCanvasSetup-{#AppVersion}
SetupIconFile=..\assets\dreamcanvas.ico
UninstallDisplayIcon={app}\app\DreamCanvas.exe
UninstallDisplayName=DreamCanvas
WizardStyle=modern
; Solid LZMA2 with a dictionary larger than the app's runtime: when the compressor reaches the
; identical runtime files in engine\, the copies in app\ are still in reach, so the duplicates cost
; almost nothing in the download. (Compiling needs about 2 GB of memory.)
Compression=lzma2/ultra64
SolidCompression=yes
LZMADictionarySize=196608
LZMAUseSeparateProcess=yes
; Close DreamCanvas windows that would lock files (the engine is stopped in [Code] below).
CloseApplications=yes
RestartApplications=no

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"
Name: "startup"; Description: "Start the &wallpaper engine when Windows starts (keeps your live wallpaper after a restart)"

[Files]
Source: "{#Source}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "redist\MicrosoftEdgeWebview2Setup.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall; Check: NeedsWebView2

[Icons]
Name: "{autoprograms}\DreamCanvas"; Filename: "{app}\app\DreamCanvas.exe"; Comment: "Live wallpapers for your desktop"
Name: "{autodesktop}\DreamCanvas"; Filename: "{app}\app\DreamCanvas.exe"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "DreamCanvas Engine"; \
    ValueData: """{app}\engine\DreamCanvas.Engine.exe"" --background"; Tasks: startup; Flags: uninsdeletevalue

[Run]
Filename: "{tmp}\MicrosoftEdgeWebview2Setup.exe"; Parameters: "/silent /install"; StatusMsg: "Installing Microsoft Edge WebView2 Runtime (needs internet)..."; \
    Check: NeedsWebView2; Flags: waituntilterminated
; Points an existing DreamCanvas screensaver / startup entry from an older copy at this one.
Filename: "{app}\engine\dreamcanvas-cli.exe"; Parameters: "install-fixups"; StatusMsg: "Finishing..."; Flags: runhidden waituntilterminated
Filename: "{app}\app\DreamCanvas.exe"; Description: "Open DreamCanvas"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; Stops the wallpaper (your normal Windows wallpaper comes back), restores your previous
; screensaver if DreamCanvas was selected, removes start-with-Windows, and closes the engine.
Filename: "{app}\engine\dreamcanvas-cli.exe"; Parameters: "uninstall-cleanup"; Flags: runhidden waituntilterminated; RunOnceId: "DreamCanvasCleanup"

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
function WebView2Version(Root: Integer; Key: String): String;
begin
  if not RegQueryStringValue(Root, Key, 'pv', Result) then Result := '';
end;

{ WebView2 is part of Windows 11 and most Windows 10 PCs (installed with Microsoft Edge). }
function NeedsWebView2: Boolean;
var
  V: String;
begin
  V := WebView2Version(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}');
  if (V = '') or (V = '0.0.0.0') then
    V := WebView2Version(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}');
  Result := (V = '') or (V = '0.0.0.0');
end;

{ An update replaces files the running engine uses: ask it to close first. }
procedure StopRunningEngine;
var
  Cli: String;
  Code: Integer;
begin
  Cli := ExpandConstant('{app}\engine\dreamcanvas-cli.exe');
  if FileExists(Cli) then
    Exec(Cli, 'shutdown', '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssInstall then StopRunningEngine;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Data: String;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    Data := ExpandConstant('{localappdata}\DreamCanvas');
    if DirExists(Data) and (not UninstallSilent) then
      if MsgBox('Also delete your DreamCanvas projects, downloaded videos and settings?' + #13#10#13#10 +
                'Choose No to keep them for a later reinstall.', mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
        DelTree(Data, True, True, True);
  end;
end;
