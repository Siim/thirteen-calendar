# Thirteen for Windows: compiles the installers with Inno Setup on Windows.
# Run by build-windows.sh on the build VM; also usable by hand on any Windows machine that has the
# repository layout (publish\win-x64, publish\win-arm64, installer\, Thirteen.Desktop\Assets\).
#
#   powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1 -Version 1.0.0 -BuildNumber 1
#
# Installs Inno Setup 6 first if it is missing (the same silent install the Superscribe pipeline uses).
# Output: dist\Thirteen-<Version>-windows-x64-setup.exe and dist\Thirteen-<Version>-windows-arm64-setup.exe.

param(
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$BuildNumber = "1",
    [string]$BuildDir = (Split-Path -Parent $PSScriptRoot),
    [string[]]$Arch = @("x64", "arm64")
)
$ErrorActionPreference = "Stop"

$InnoSetupUrl = "https://jrsoftware.org/download.php/is.exe"
$InnoSetupInstaller = Join-Path $env:TEMP "innosetup.exe"
$Iscc = Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe"

if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version must be MAJOR.MINOR.PATCH, got '$Version'" }
if ($BuildNumber -notmatch '^\d+$') { throw "BuildNumber must be a whole number, got '$BuildNumber'" }
Write-Host "=== Thirteen installer build ($Version, build $BuildNumber) ===" -ForegroundColor Cyan

if (-not (Test-Path $Iscc)) {
    Write-Host "Inno Setup 6 not found: downloading and installing it silently..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri $InnoSetupUrl -OutFile $InnoSetupInstaller -UseBasicParsing
    Start-Process -FilePath $InnoSetupInstaller -ArgumentList "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART" -Wait
    Remove-Item $InnoSetupInstaller -ErrorAction SilentlyContinue
    if (-not (Test-Path $Iscc)) { throw "Inno Setup installation failed: $Iscc is missing" }
    Write-Host "  Inno Setup installed" -ForegroundColor Green
} else {
    Write-Host "Inno Setup: $Iscc" -ForegroundColor Green
}

$Script = Join-Path $BuildDir "installer\Thirteen.iss"
$Dist = Join-Path $BuildDir "dist"
New-Item -ItemType Directory -Force -Path $Dist | Out-Null

foreach ($a in $Arch) {
    $PublishDir = Join-Path $BuildDir "publish\win-$a"
    if (-not (Test-Path (Join-Path $PublishDir "Thirteen.exe"))) { throw "Missing $PublishDir\Thirteen.exe (publish win-$a first)" }
    $Output = Join-Path $Dist "Thirteen-$Version-windows-$a-setup.exe"
    Remove-Item $Output -ErrorAction SilentlyContinue
    Write-Host "Compiling the $a installer..." -ForegroundColor Yellow
    & $Iscc /Qp "/DArch=$a" "/DAppVersion=$Version" "/DBuildNumber=$BuildNumber" "/DPublishDir=$PublishDir" "/DOutputDir=$Dist" $Script
    if ($LASTEXITCODE -ne 0) { throw "ISCC failed for $a (exit code $LASTEXITCODE)" }
    if (-not (Test-Path $Output)) { throw "ISCC reported success but $Output is missing" }
    $Size = (Get-Item $Output).Length
    Write-Host ("  {0}: {1:N0} bytes" -f (Split-Path -Leaf $Output), $Size) -ForegroundColor Green
}
