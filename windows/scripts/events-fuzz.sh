#!/bin/sh
# Differential check of the C# events port against @thirteen/core on random inputs (windows/README.md,
# "How parity is guaranteed"). For each seed and mode (plain, FOCUS=leap, FOCUS=dst) events-fuzz.mjs writes
# random cases in the section shapes of fixtures/events.json, and a copy of the parity tests replays them:
# the same Section_* bodies as Thirteen.Core.Tests, with EventsFixture reading the generated file instead of
# fixtures/events.json. Nothing in the repository is changed; the work folder is printed at the end.
#
#   sh windows/scripts/events-fuzz.sh [seed ...]       (default seeds: 1 2 3)
#   THIRTEEN_FUZZ_CASES   cases per section (default 400)
#   THIRTEEN_FUZZ_DIR     work folder (default: a new folder under /tmp)
set -eu

HERE=$(cd "$(dirname "$0")/.." && pwd)
WORK=${THIRTEEN_FUZZ_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/thirteen-events-fuzz.XXXXXX")}
CASES=${THIRTEEN_FUZZ_CASES:-400}
[ $# -gt 0 ] || set -- 1 2 3
TESTS="$WORK/tests"

mkdir -p "$TESTS/Support"
cp "$HERE/Thirteen.Core.Tests/EventsFixtureParityTests.cs" "$TESTS/"
for f in EventsJson.cs Fixture.cs EventsFixture.cs; do cp "$HERE/Thirteen.Core.Tests/Support/$f" "$TESTS/Support/"; done
# Sections and counts come from the generated file; its path from THIRTEEN_EVENTS_FUZZ.
perl -0pi -e 's/public static readonly \(string Name, int Count\)\[\] Sections =\s*\[.*?\];/public static (string Name, int Count)[] Sections => Root.GetProperty("counts").EnumerateObject().Select(p => (p.Name, p.Value.GetInt32())).ToArray();/s; s/var path = System\.IO\.Path\.Combine\(Fixture\.RepositoryRoot\(\), "fixtures", "events\.json"\);/var path = Environment.GetEnvironmentVariable("THIRTEEN_EVENTS_FUZZ")!;/' "$TESTS/Support/EventsFixture.cs"
grep -q THIRTEEN_EVENTS_FUZZ "$TESTS/Support/EventsFixture.cs" || { echo "events-fuzz: could not patch EventsFixture.cs" >&2; exit 1; }
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
dotnet build "$TESTS/Thirteen.Core.Tests.csproj" --artifacts-path "$WORK/artifacts" -v quiet -nologo >/dev/null

# The sections the generator writes (zones, zoneOffsets, dateLists and alarms are not fuzzed).
FILTER='FullyQualifiedName~Section_&FullyQualifiedName!~Section_Zones&FullyQualifiedName!~Section_ZoneOffsets&FullyQualifiedName!~Section_DateLists&FullyQualifiedName!=Thirteen.Core.Tests.EventsFixtureParityTests.Section_Alarms'
status=0
for mode in plain leap dst; do
  for seed in "$@"; do
    file="$WORK/fuzz-$mode-$seed.json"
    FOCUS=$([ "$mode" = plain ] && echo "" || echo "$mode") node "$HERE/scripts/events-fuzz.mjs" "$seed" "$CASES" "$file" >/dev/null
    if THIRTEEN_EVENTS_FUZZ="$file" dotnet test "$TESTS/Thirteen.Core.Tests.csproj" --artifacts-path "$WORK/artifacts" --no-build --filter "$FILTER" >"$WORK/test-$mode-$seed.log" 2>&1; then
      echo "events-fuzz: $mode seed $seed: $(grep -E 'Passed!' "$WORK/test-$mode-$seed.log" | sed 's/ - Thirteen.*//')"
    else
      status=1
      echo "events-fuzz: $mode seed $seed: FAILED (cases in $file)"
      grep -E 'mismatch\(es\) in|^ +[a-zA-Z]+\[[0-9]+\]' "$WORK/test-$mode-$seed.log" | head -20
    fi
  done
done
echo "events-fuzz: work folder $WORK"
exit $status
