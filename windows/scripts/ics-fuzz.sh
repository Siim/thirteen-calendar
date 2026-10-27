#!/bin/sh
# Differential check of the C# .ics port against @thirteen/core/ics on random inputs (windows/README.md, "How
# parity is guaranteed"). For each seed, ics-fuzz.mjs writes random iCalendar texts and what the TypeScript module
# returned for them (with the zone offsets it used), and IcsFuzzReplay.cs replays the file through
# Thirteen.Core.Ics in a temporary test project built from it and the Support files of Thirteen.Core.Tests.
# Nothing in the repository is changed; the work folder is printed at the end, with each run's mismatches.
#
#   sh windows/scripts/ics-fuzz.sh [seed ...]      (default seeds: 1 2 3)
#   THIRTEEN_FUZZ_CASES   documents per seed (default 300)
#   THIRTEEN_FUZZ_DIR     work folder (default: a new folder under /tmp)
set -eu

HERE=$(cd "$(dirname "$0")/.." && pwd)
WORK=${THIRTEEN_FUZZ_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/thirteen-ics-fuzz.XXXXXX")}
CASES=${THIRTEEN_FUZZ_CASES:-300}
[ $# -gt 0 ] || set -- 1 2 3
TESTS="$WORK/tests"

mkdir -p "$TESTS/Support"
cp "$HERE/scripts/IcsFuzzReplay.cs" "$TESTS/"
for f in EventsJson.cs IcsJson.cs Fixture.cs EventsFixture.cs; do cp "$HERE/Thirteen.Core.Tests/Support/$f" "$TESTS/Support/"; done
cat > "$TESTS/Thirteen.Core.Tests.csproj" <<EOF
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <LangVersion>latest</LangVersion>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <AssemblyName>Thirteen.Core.Tests</AssemblyName>
    <RootNamespace>Thirteen.Core.Tests</RootNamespace>
    <IsTestProject>true</IsTestProject>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="18.11.0" />
    <PackageReference Include="xunit" Version="2.9.3" />
    <PackageReference Include="xunit.runner.visualstudio" Version="3.1.5" />
    <Using Include="Xunit" />
    <ProjectReference Include="$HERE/Thirteen.Core/Thirteen.Core.csproj" />
  </ItemGroup>
</Project>
EOF
dotnet build "$TESTS/Thirteen.Core.Tests.csproj" --artifacts-path "$WORK/artifacts" -v quiet -nologo >"$WORK/build.log" 2>&1 || { cat "$WORK/build.log" >&2; exit 1; }

status=0
for seed in "$@"; do
  file="$WORK/fuzz-$seed.json"
  node "$HERE/scripts/ics-fuzz.mjs" "$seed" "$CASES" "$file" >"$WORK/generate-$seed.log"
  if THIRTEEN_ICS_FUZZ="$file" dotnet test "$TESTS/Thirteen.Core.Tests.csproj" --artifacts-path "$WORK/artifacts" --no-build --logger "console;verbosity=detailed" >"$WORK/test-$seed.log" 2>&1; then
    echo "ics-fuzz: seed $seed: $(grep -E '[0-9]+ cases, [0-9]+ checks' "$WORK/test-$seed.log" | sed 's/^ *//')"
  else
    status=1
    echo "ics-fuzz: seed $seed: FAILED ($(grep -cv '^$' "$file.mismatches.txt" 2>/dev/null || echo '?') mismatches in $file.mismatches.txt)"
    head -20 "$file.mismatches.txt" 2>/dev/null || tail -30 "$WORK/test-$seed.log"
  fi
done
echo "ics-fuzz: work folder $WORK"
exit $status
