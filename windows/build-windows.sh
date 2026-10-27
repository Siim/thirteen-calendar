#!/bin/bash
# Thirteen for Windows: build, smoke-test and package from the Mac, using the Windows VM over SSH.
#
#   ./build-windows.sh                  test, publish x64 + arm64, smoke-test on the VM, build and verify
#                                       both installers, copy them to dist/ (Thirteen-<version>-windows-
#                                       <arch>-setup.exe plus the stable Thirteen-windows-<arch>-setup.exe)
#   ./build-windows.sh --publish-only   test and publish on the Mac only (no VM)
#   ./build-windows.sh --no-installer   stop after the smoke tests on the VM
#   ./build-windows.sh --skip-tests     do not run dotnet test first
#   ./build-windows.sh --skip-verify    do not install/uninstall the installers on the VM
#
# Modelled on the owner's Superscribe pipeline, with one
# difference: the .NET 10 publish runs on the Mac (self-contained, so the VM needs no .NET 10 SDK) and
# only the finished folders travel to the VM, which runs the smoke tests and Inno Setup.
#
# Environment:
#   THIRTEEN_WINDOWS_HOST       SSH target          (default siim@192.168.64.3)
#   THIRTEEN_WINDOWS_BUILD_DIR  build folder on VM  (default C:\thirteen-build)
#   THIRTEEN_AZURE_SIGNING_ENV  optional path to an env file with these signing variable names
#                               (AZURE_SIGNING_KVT tenant, AZURE_SIGNING_KVI client id,
#                               AZURE_SIGNING_KVS client secret, AZURE_SIGNING_ACCOUNT, AZURE_SIGNING_PROFILE;
#                               optional AZURE_SIGNING_ENDPOINT). Only when it is set are
#                               Thirteen.exe and both installers signed with Azure Trusted Signing on
#                               the VM (same signtool and dlib paths as Superscribe). Secrets are sent to
#                               the VM over SSH stdin, never on a command line, and never printed.
set -euo pipefail

PUBLISH_ONLY=false
NO_INSTALLER=false
SKIP_TESTS=false
SKIP_VERIFY=false
for arg in "$@"; do
    case "$arg" in
        --publish-only) PUBLISH_ONLY=true ;;
        --no-installer) NO_INSTALLER=true ;;
        --skip-tests) SKIP_TESTS=true ;;
        --skip-verify) SKIP_VERIFY=true ;;
        -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
        *) echo "Unknown option: $arg (see --help)" >&2; exit 2 ;;
    esac
done

HERE="$(cd "$(dirname "$0")" && pwd)"
WINDOWS_HOST="${THIRTEEN_WINDOWS_HOST:-siim@192.168.64.3}"
WINDOWS_BUILD_DIR="${THIRTEEN_WINDOWS_BUILD_DIR:-C:\\thirteen-build}"
WINDOWS_BUILD_DIR_SCP="${WINDOWS_BUILD_DIR//\\//}"
RIDS=(win-x64 win-arm64)
# The Windows target framework of Thirteen.Desktop.csproj (TargetFrameworks: net10.0 and this one).
WINDOWS_TFM=net10.0-windows10.0.19041.0
VERSION="$(sed -n 's:.*<Version>\(.*\)</Version>.*:\1:p' "$HERE/Directory.Build.props" | head -n 1)"
[ -n "$VERSION" ] || { echo "ERROR: no <Version> in Directory.Build.props" >&2; exit 1; }
BUILD_NUMBER="$(sed -n 's:.*<BuildNumber>\(.*\)</BuildNumber>.*:\1:p' "$HERE/Directory.Build.props" | head -n 1)"
[ -n "$BUILD_NUMBER" ] || { echo "ERROR: no <BuildNumber> in Directory.Build.props" >&2; exit 1; }
# Release artifact names (docs/RELEASING.md) and the stable names behind the
# releases/latest/download links (design/DECISIONS.md).
setup_name() { echo "Thirteen-$VERSION-windows-$1-setup.exe"; }
stable_setup_name() { echo "Thirteen-windows-$1-setup.exe"; }

# Same tool locations as the Superscribe pipeline.
DOTNET_PATH='C:\Program Files\dotnet\dotnet.exe'
TRUSTED_SIGN_DLIB='C:\trusted-signing-client\bin\x64\Azure.CodeSigning.Dlib.dll'
SIGNTOOL_EXE='C:\Users\siim\.dotnet\tools\.store\azuretrustedsigntool\1.3.13\azuretrustedsigntool\1.3.13\tools\net8.0\any\SDK\signtool.exe'
SIGNING_DOTNET_ROOT='C:\Users\siim\AppData\Local\Microsoft\dotnet'

# ---- helpers -------------------------------------------------------------------------------

vm() { ssh -o ConnectTimeout=10 -o LogLevel=ERROR "$WINDOWS_HOST" "$@"; }

# Runs a PowerShell script on the VM, read from stdin (keeps secrets off every command line).
vm_ps() { ssh -o ConnectTimeout=10 -o LogLevel=ERROR "$WINDOWS_HOST" "powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command -"; }

# Single-quoted PowerShell literal (an embedded ' is doubled). Portable to macOS bash 3.2.
ps_quote() { local q="'"; local s="${1//$q/$q$q}"; printf "'%s'" "$s"; }

# Value of KEY in an env file (KEY=value, KEY="value", export KEY=value). Never echoed.
env_value() {
    local line value
    line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?$2=" "$1" | tail -n 1 || true)"
    [ -n "$line" ] || return 0
    value="${line#*=}"
    value="${value%$'\r'}"
    if [ "${#value}" -ge 2 ] && { [[ "$value" == \"*\" ]] || [[ "$value" == \'*\' ]]; }; then
        value="${value:1:${#value}-2}"
    fi
    printf '%s' "$value"
}

file_size() { stat -f %z "$1" 2>/dev/null || stat -c %s "$1"; }

# ---- signing configuration -----------------------------------------------------------------

SIGN=false
if [ -n "${THIRTEEN_AZURE_SIGNING_ENV:-}" ]; then
    [ -f "$THIRTEEN_AZURE_SIGNING_ENV" ] || { echo "ERROR: THIRTEEN_AZURE_SIGNING_ENV=$THIRTEEN_AZURE_SIGNING_ENV is not a file" >&2; exit 1; }
    AZURE_SIGNING_KVT="$(env_value "$THIRTEEN_AZURE_SIGNING_ENV" AZURE_SIGNING_KVT)"
    AZURE_SIGNING_KVI="$(env_value "$THIRTEEN_AZURE_SIGNING_ENV" AZURE_SIGNING_KVI)"
    AZURE_SIGNING_KVS="$(env_value "$THIRTEEN_AZURE_SIGNING_ENV" AZURE_SIGNING_KVS)"
    SIGNING_ACCOUNT="$(env_value "$THIRTEEN_AZURE_SIGNING_ENV" AZURE_SIGNING_ACCOUNT)"
    SIGNING_PROFILE="$(env_value "$THIRTEEN_AZURE_SIGNING_ENV" AZURE_SIGNING_PROFILE)"
    if [ -z "$AZURE_SIGNING_KVT" ] || [ -z "$AZURE_SIGNING_KVI" ] || [ -z "$AZURE_SIGNING_KVS" ] \
        || [ -z "$SIGNING_ACCOUNT" ] || [ -z "$SIGNING_PROFILE" ]; then
        echo "ERROR: $THIRTEEN_AZURE_SIGNING_ENV must define AZURE_SIGNING_KVT, AZURE_SIGNING_KVI, AZURE_SIGNING_KVS, AZURE_SIGNING_ACCOUNT and AZURE_SIGNING_PROFILE" >&2
        exit 1
    fi
    SIGNING_ENDPOINT="$(env_value "$THIRTEEN_AZURE_SIGNING_ENV" AZURE_SIGNING_ENDPOINT)"
    SIGNING_ENDPOINT="${SIGNING_ENDPOINT:-https://neu.codesigning.azure.net}"
    SIGN=true
fi

# Signs files on the VM with Azure Trusted Signing (signtool + dlib), then verifies the signatures.
sign_on_vm() {
    local metadata="$WINDOWS_BUILD_DIR\\signing\\metadata.json"
    local json="{ \"Endpoint\": \"$SIGNING_ENDPOINT\", \"CodeSigningAccountName\": \"$SIGNING_ACCOUNT\", \"CertificateProfileName\": \"$SIGNING_PROFILE\" }"
    local file
    for file in "$@"; do
        echo "    signing $file"
        # ASCII single-line JSON: a UTF-16 BOM breaks the Azure dlib (see the Superscribe pipeline).
        printf '%s\n' \
            "\$ErrorActionPreference = 'Stop'" \
            "New-Item -ItemType Directory -Force -Path $(ps_quote "$WINDOWS_BUILD_DIR\\signing") | Out-Null" \
            "Set-Content -Path $(ps_quote "$metadata") -Value $(ps_quote "$json") -Encoding ascii -NoNewline" \
            "\$env:DOTNET_ROOT = $(ps_quote "$SIGNING_DOTNET_ROOT")" \
            "\$env:AZURE_TENANT_ID = $(ps_quote "$AZURE_SIGNING_KVT")" \
            "\$env:AZURE_CLIENT_ID = $(ps_quote "$AZURE_SIGNING_KVI")" \
            "\$env:AZURE_CLIENT_SECRET = $(ps_quote "$AZURE_SIGNING_KVS")" \
            "& $(ps_quote "$SIGNTOOL_EXE") sign /v /fd SHA256 /tr http://timestamp.acs.microsoft.com /td SHA256 /dlib $(ps_quote "$TRUSTED_SIGN_DLIB") /dmdf $(ps_quote "$metadata") $(ps_quote "$file")" \
            "if (\$LASTEXITCODE -ne 0) { Write-Host \"signtool sign failed with exit code \$LASTEXITCODE\"; exit 1 }" \
            "& $(ps_quote "$SIGNTOOL_EXE") verify /pa $(ps_quote "$file")" \
            "if (\$LASTEXITCODE -ne 0) { Write-Host 'signature verification failed'; exit 1 }" \
            "\$sig = Get-AuthenticodeSignature $(ps_quote "$file")" \
            "if (\$sig.Status -ne 'Valid') { Write-Host \"Authenticode status \$(\$sig.Status)\"; exit 1 }" \
            "Write-Host \"    signed by \$(\$sig.SignerCertificate.Subject)\"" \
            "exit 0" \
            | vm_ps
    done
}

echo "=== Thirteen for Windows $VERSION (build $BUILD_NUMBER) ==="

# ---- [1] tests ---------------------------------------------------------------------------------

if [ "$SKIP_TESTS" = false ]; then
    echo "[1/8] Running Thirteen.Core.Tests and Thirteen.Desktop.Tests on the Mac..."
    dotnet test "$HERE/Thirteen.Core.Tests/Thirteen.Core.Tests.csproj" -c Release --nologo -v q
    dotnet test "$HERE/Thirteen.Desktop.Tests/Thirteen.Desktop.Tests.csproj" -c Release --nologo -v q
    echo "  ✓ tests passed"
else
    echo "[1/8] Tests skipped"
fi

# ---- [2] publish on the Mac --------------------------------------------------------------------

echo "[2/8] Publishing self-contained builds on the Mac..."
for rid in "${RIDS[@]}"; do
    out="$HERE/publish/$rid"
    rm -rf "$out"
    # -f picks the Windows target of the multi-targeted app (net10.0 is the macOS development build); a
    # publish without it fails (docs/EVENTS.md §6.4).
    dotnet publish "$HERE/Thirteen.Desktop/Thirteen.Desktop.csproj" -c Release -r "$rid" -f "$WINDOWS_TFM" -o "$out" --nologo -v q
    [ -f "$out/Thirteen.exe" ] || { echo "ERROR: $out/Thirteen.exe missing" >&2; exit 1; }
    echo "  ✓ $rid: $(ls "$out" | tr '\n' ' ')($(du -sh "$out" | cut -f1))"
done

if [ "$PUBLISH_ONLY" = true ]; then
    echo "=== Publish complete: $HERE/publish/win-x64 and $HERE/publish/win-arm64 ==="
    exit 0
fi

# ---- [3] VM ------------------------------------------------------------------------------------

echo "[3/8] Testing SSH connection to $WINDOWS_HOST..."
if ! vm "echo Connected" >/dev/null 2>&1; then
    echo "ERROR: Cannot connect to the Windows VM at $WINDOWS_HOST (is it running with SSH enabled?)" >&2
    exit 1
fi
echo "  ✓ connected"

echo "[4/8] Copying builds and installer sources to $WINDOWS_BUILD_DIR..."
vm "taskkill /IM Thirteen.exe /F" >/dev/null 2>&1 || true
printf '%s\n' \
    "\$ErrorActionPreference = 'Stop'" \
    "\$root = $(ps_quote "$WINDOWS_BUILD_DIR")" \
    "foreach (\$d in 'publish', 'installer', 'dist', 'signing', 'Thirteen.Desktop') { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path \$root \$d) }" \
    "foreach (\$d in 'publish', 'installer', 'dist', 'Thirteen.Desktop\\Assets') { New-Item -ItemType Directory -Force -Path (Join-Path \$root \$d) | Out-Null }" \
    "exit 0" \
    | vm_ps
scp -q -o LogLevel=ERROR -r "$HERE/publish/win-x64" "$HERE/publish/win-arm64" "$WINDOWS_HOST:$WINDOWS_BUILD_DIR_SCP/publish/"
scp -q -o LogLevel=ERROR "$HERE/installer/Thirteen.iss" "$HERE/installer/build-installer.ps1" "$HERE/installer/verify-install.ps1" \
    "$WINDOWS_HOST:$WINDOWS_BUILD_DIR_SCP/installer/"
scp -q -o LogLevel=ERROR "$HERE/Thirteen.Desktop/Assets/Thirteen.ico" "$WINDOWS_HOST:$WINDOWS_BUILD_DIR_SCP/Thirteen.Desktop/Assets/"
echo "  ✓ copied"

echo "[5/8] Smoke-testing both builds on Windows (Thirteen.exe --smoke)..."
for rid in "${RIDS[@]}"; do
    output="$(vm "$WINDOWS_BUILD_DIR\\publish\\$rid\\Thirteen.exe --smoke")" || { echo "ERROR: $rid --smoke failed" >&2; exit 1; }
    grep -q '^Today (IFC):' <<<"$output" || { echo "ERROR: unexpected $rid --smoke output: $output" >&2; exit 1; }
    grep -q "^Thirteen $VERSION on " <<<"$output" || { echo "ERROR: $rid --smoke does not report version $VERSION: $output" >&2; exit 1; }
    echo "  ✓ $rid"
    sed 's/^/      /' <<<"$output"
done

# docs/EVENTS.md §6.4 "On the VM": the real window on the mockup data set in Month (an SSH session is session 0 without
# a desktop, so ANGLE logs Direct3D swap chain errors on stderr; the render itself works and a watchdog guarantees the
# exit code), with its screenshot copied back to dist/smoke/, and --clear-alerts (exits 0; without the installer's app
# user model id it has nothing to clear).
echo "[5/8] UI smoke on the mockup data set and --clear-alerts on both builds..."
mkdir -p "$HERE/dist/smoke"
for rid in "${RIDS[@]}"; do
    shot="$WINDOWS_BUILD_DIR\\publish\\smoke-ui-$rid.png"
    output="$(vm "$WINDOWS_BUILD_DIR\\publish\\$rid\\Thirteen.exe --smoke-ui --fake-events --route month/2026/11 --screenshot $shot" 2>/dev/null)" \
        || { echo "ERROR: $rid --smoke-ui failed: $(head -n 3 <<<"$output")" >&2; exit 1; }
    grep -q '^UI smoke: window' <<<"$output" || { echo "ERROR: unexpected $rid --smoke-ui output: $(head -n 3 <<<"$output")" >&2; exit 1; }
    grep -q 'October 2026' <<<"$output" || { echo "ERROR: $rid --smoke-ui did not show Month (October 2026)" >&2; exit 1; }
    # The chips are drawn, not text; the mockup's calendars in the Calendars pane show the data set loaded.
    grep -q 'Holidays in Estonia' <<<"$output" || { echo "ERROR: $rid --smoke-ui did not show the mockup calendars" >&2; exit 1; }
    grep -q '^UI smoke: saved ' <<<"$output" || { echo "ERROR: $rid --smoke-ui saved no screenshot" >&2; exit 1; }
    scp -q -o LogLevel=ERROR "$WINDOWS_HOST:$WINDOWS_BUILD_DIR_SCP/publish/smoke-ui-$rid.png" "$HERE/dist/smoke/smoke-ui-$rid.png"
    vm "$WINDOWS_BUILD_DIR\\publish\\$rid\\Thirteen.exe --clear-alerts" >/dev/null 2>&1 || { echo "ERROR: $rid --clear-alerts failed" >&2; exit 1; }
    echo "  ✓ $rid: $(head -n 1 <<<"$output"); dist/smoke/smoke-ui-$rid.png; --clear-alerts exit 0"
done

if [ "$NO_INSTALLER" = true ]; then
    echo "=== Done (installers skipped) ==="
    exit 0
fi

if [ "$SIGN" = true ]; then
    echo "[5.5/8] Signing Thirteen.exe in both builds..."
    vm "\"$DOTNET_PATH\" tool install --global AzureTrustedSignTool" >/dev/null 2>&1 || echo "    AzureTrustedSignTool already installed"
    vm "powershell -NoProfile -Command \"if (-not (Test-Path '$TRUSTED_SIGN_DLIB')) { Invoke-WebRequest -Uri 'https://www.nuget.org/api/v2/package/Microsoft.Trusted.Signing.Client/1.0.95' -OutFile 'C:\\trusted-signing-client.zip'; Expand-Archive -Path 'C:\\trusted-signing-client.zip' -DestinationPath 'C:\\trusted-signing-client' -Force }\""
    sign_on_vm "$WINDOWS_BUILD_DIR\\publish\\win-x64\\Thirteen.exe" "$WINDOWS_BUILD_DIR\\publish\\win-arm64\\Thirteen.exe"
    echo "  ✓ binaries signed"
else
    echo "[5.5/8] Signing skipped (set THIRTEEN_AZURE_SIGNING_ENV to sign)"
fi

# ---- [6] installers ----------------------------------------------------------------------------

echo "[6/8] Building installers with Inno Setup on the VM..."
vm "powershell -NoProfile -ExecutionPolicy Bypass -File $WINDOWS_BUILD_DIR\\installer\\build-installer.ps1 -Version $VERSION -BuildNumber $BUILD_NUMBER -BuildDir $WINDOWS_BUILD_DIR"
echo "  ✓ installers built"

if [ "$SIGN" = true ]; then
    echo "[6.5/8] Signing both installers..."
    sign_on_vm "$WINDOWS_BUILD_DIR\\dist\\$(setup_name x64)" "$WINDOWS_BUILD_DIR\\dist\\$(setup_name arm64)"
    echo "  ✓ installers signed"
fi

if [ "$SKIP_VERIFY" = false ]; then
    echo "[7/8] Installing, smoke-testing and uninstalling each installer on the VM..."
    for arch in x64 arm64; do
        if ! vm "powershell -NoProfile -ExecutionPolicy Bypass -File $WINDOWS_BUILD_DIR\\installer\\verify-install.ps1 -Setup $WINDOWS_BUILD_DIR\\dist\\$(setup_name "$arch") -Version $VERSION -BuildNumber $BUILD_NUMBER" \
            | sed 's/^/    /'; then
            echo "ERROR: $arch installer verification failed" >&2
            exit 1
        fi
    done
    echo "  ✓ both installers verified"
else
    echo "[7/8] Install verification skipped"
fi

# ---- [8] copy back -----------------------------------------------------------------------------

echo "[8/8] Copying installers to $HERE/dist..."
mkdir -p "$HERE/dist"
for arch in x64 arm64; do
    name="$(setup_name "$arch")"
    stable="$(stable_setup_name "$arch")"
    rm -f "$HERE/dist/$name" "$HERE/dist/$stable"
    scp -q -o LogLevel=ERROR "$WINDOWS_HOST:$WINDOWS_BUILD_DIR_SCP/dist/$name" "$HERE/dist/$name"
    cp "$HERE/dist/$name" "$HERE/dist/$stable"
    echo "  ✓ dist/$name and dist/$stable ($(file_size "$HERE/dist/$name") bytes)"
done

echo ""
echo "=== Build complete: $VERSION (build $BUILD_NUMBER), $([ "$SIGN" = true ] && echo signed || echo unsigned) ==="
echo "x64 installer:   $HERE/dist/$(setup_name x64) (= $(stable_setup_name x64))"
echo "arm64 installer: $HERE/dist/$(setup_name arm64) (= $(stable_setup_name arm64))"
