#!/bin/bash
# Runs a PowerShell job in the build VM's interactive desktop (session 1) and prints its log. SSH sessions run in
# session 0, which has no desktop: windows, UI Automation and toast banners need session 1, so the job runs from a
# scheduled task (schtasks /it) as the signed-in user. The job body is wrapped with lib.ps1 (Start-Thirteen,
# Find-Named, Invoke-Element, Capture, Dump-Tree, Log) and runs in C:\thirteen-qa on the VM.
#
#   sh windows/scripts/vm/vmjob.sh <job.ps1> [timeout seconds, default 600] [Name=value ...]
#
# Each Name=value becomes `$Name = 'value'` before the body (for example Arch=arm64 for v13.ps1). Leaves the scheduled
# task ThirteenQA and C:\thirteen-qa on the VM; `sh windows/scripts/vm/vmjob.sh --clean` removes both.
# THIRTEEN_WINDOWS_HOST overrides the VM (default siim@192.168.64.3).
set -euo pipefail
HOST="${THIRTEEN_WINDOWS_HOST:-siim@192.168.64.3}"
HERE="$(cd "$(dirname "$0")" && pwd)"
vm() { ssh -o ConnectTimeout=30 -o BatchMode=yes -o LogLevel=ERROR "$HOST" "$@"; }

if [ "${1:-}" = "--clean" ]; then
    vm "schtasks /delete /tn ThirteenQA /f >nul 2>&1 & if exist C:\\thirteen-qa rmdir /s /q C:\\thirteen-qa" || true
    echo "removed the ThirteenQA task and C:\\thirteen-qa"
    exit 0
fi

BODY="$1"; TIMEOUT="${2:-600}"
shift
if [ $# -gt 0 ]; then shift; fi
JOB="$(mktemp -t thirteen-qa-job).ps1"
{
    echo "\$global:JobLog = 'C:\\thirteen-qa\\job.log'"
    echo "Set-Content -Path \$global:JobLog -Value ''"
    for assignment in "$@"; do
        name="${assignment%%=*}"; value="${assignment#*=}"
        echo "\$$name = '${value//\'/\'\'}'"
    done
    echo "try {"
    echo ". 'C:\\thirteen-qa\\lib.ps1'"
    cat "$BODY"
    echo "} catch { Log (\"ERROR {0} {1}\" -f \$_.Exception.Message, \$_.InvocationInfo.PositionMessage) } finally { Set-Content -Path 'C:\\thirteen-qa\\job.done' -Value 'done' }"
} > "$JOB"
vm "if not exist C:\\thirteen-qa mkdir C:\\thirteen-qa" >/dev/null
scp -q -o LogLevel=ERROR "$HERE/lib.ps1" "$HOST:C:/thirteen-qa/lib.ps1"
scp -q -o LogLevel=ERROR "$JOB" "$HOST:C:/thirteen-qa/job.ps1"
rm -f "$JOB"
vm "del C:\\thirteen-qa\\job.done 2>nul & schtasks /create /it /sc once /st 00:00 /tn ThirteenQA /tr \"powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\\thirteen-qa\\job.ps1\" /f >nul 2>&1 & schtasks /run /tn ThirteenQA" >/dev/null
for ((i = 0; i < TIMEOUT; i += 5)); do
    if vm "if exist C:\\thirteen-qa\\job.done (echo yes)" 2>/dev/null | grep -q yes; then break; fi
    sleep 5
done
vm "type C:\\thirteen-qa\\job.log & if not exist C:\\thirteen-qa\\job.done echo JOB-NOT-FINISHED"
