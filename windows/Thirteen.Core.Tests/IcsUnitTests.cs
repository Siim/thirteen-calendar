using System.Text;
using Thirteen.Core.Events;
using Thirteen.Core.Ics;
using Thirteen.Core.Tests.Support;

namespace Thirteen.Core.Tests;

/// <summary>
/// Unit tests of Thirteen.Core.Ics for what fixtures/ics does not replay directly, with expectations copied from
/// packages/core/test/ics/*.test.ts. Zone data comes from the <see cref="RecordedZoneResolver"/> of
/// fixtures/events.json (America/New_York 2004 to 2032, Asia/Jerusalem 2025 to 2030, Asia/Tokyo 2025 to 2027,
/// Europe/Tallinn 2024 to 2031, Europe/Kiev 2026, ...), never the platform's.
/// </summary>
public sealed class IcsUnitTests
{
    private static IZoneResolver Zones => EventsFixture.Recorded;

    private static string Crlf(params string[] lines) => string.Join("\r\n", lines) + "\r\n";

    private static string Calendar(params string[] lines) =>
        Crlf(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Test//Thirteen tests//EN", .. lines, "END:VCALENDAR"]);

    private static LocalDateTime L(string text) => LocalDateTime.Parse(text);

    private static int Octets(string line) => Encoding.UTF8.GetByteCount(line);

    // ---- Lexer, values, colors -----------------------------------------------------------------

    [Fact]
    public void FoldLine_Folds_At75Octets_ContinuationsASpaceAnd74More()
    {
        Assert.Equal("SUMMARY:short", IcsLexer.FoldLine("SUMMARY:short"));
        Assert.Equal(new string('X', 75), IcsLexer.FoldLine(new string('X', 75)));
        var lines = IcsLexer.FoldLine(new string('X', 200)).Split("\r\n");
        Assert.Equal([75, 75, 52], lines.Select(Octets).ToArray());
        Assert.All(lines.Skip(1), l => Assert.StartsWith(" ", l, StringComparison.Ordinal));
        Assert.Equal([new string('X', 200)], IcsLexer.Unfold(lines).Select(c => c.Text).ToArray());
    }

    [Fact]
    public void FoldLine_NeverSplitsAUtf8Sequence()
    {
        var text = "SUMMARY:" + string.Concat(Enumerable.Repeat("ä", 40)) + string.Concat(Enumerable.Repeat(char.ConvertFromUtf32(0x1F389), 30));
        var lines = IcsLexer.FoldLine(text).Split("\r\n");
        Assert.All(lines, l => Assert.True(Octets(l) <= 75, $"{Octets(l)} octets"));
        Assert.All(lines, l => Assert.False(char.IsHighSurrogate(l[^1]), "a line ends inside a surrogate pair"));
        Assert.Equal([text], IcsLexer.Unfold(lines).Select(c => c.Text).ToArray());
    }

    [Fact]
    public void ContentLines_SplitNameParametersAndValue_KeepingQuotedValues()
    {
        var p = IcsLexer.ParseContentLine("dtstart;tzid=\"Europe/Tallinn\";X-A=\"a:b;c\",d:20261019T093000")!;
        Assert.Equal("DTSTART", p.Name);
        Assert.Equal([new IcsParameter("TZID", "\"Europe/Tallinn\""), new IcsParameter("X-A", "\"a:b;c\",d")], p.Params.ToArray());
        Assert.Equal("20261019T093000", p.Value);
        Assert.Equal("Europe/Tallinn", IcsLexer.ParamValue(p.Params, "TZID"));
        Assert.Null(IcsLexer.ParseContentLine("This line has no colon"));
        Assert.Equal("URL:https://example.com/a?b=c:d", IcsLexer.ContentLineText(IcsLexer.ParseContentLine("URL:https://example.com/a?b=c:d")!));
        Assert.Equal("\"a,b\"", IcsLexer.QuoteParam("a,b"));
        Assert.Equal("Europe/Tallinn", IcsLexer.QuoteParam("Europe/Tallinn"));
    }

    [Fact]
    public void Text_EscapesRoundTrip()
    {
        Assert.Equal("a\nb, c; d\\e\nf", IcsLexer.UnescapeText("a\\nb\\, c\\; d\\\\e\\Nf"));
        foreach (var text in new[] { "plain", "a,b;c\\d", "line\nbreak", "cr\r\nlf" })
        {
            Assert.Equal(text.Replace("\r\n", "\n", StringComparison.Ordinal), IcsLexer.UnescapeText(IcsLexer.EscapeText(text)));
        }
        Assert.Equal("a\\nb\\nc", IcsLexer.EscapeText("a\r\nb\rc"));
    }

    [Fact]
    public void DateValues_ReadEveryKind_AndRejectBadText()
    {
        IcsParameter[] none = [];
        Assert.Equal(new IcsDateValue.DateValue(new GregorianDate(2026, 10, 19)), IcsValues.ReadDateValue("20261019", [new IcsParameter("VALUE", "DATE")]));
        Assert.Equal(new IcsDateValue.FloatingValue(L("2026-10-19T09:30")), IcsValues.ReadDateValue("20261019T093059", none));
        Assert.Equal(new IcsDateValue.UtcValue(L("2026-10-19T09:30")), IcsValues.ReadDateValue("20261019T093000z", none));
        Assert.Equal(new IcsDateValue.ZonedValue(L("2026-10-19T09:30"), "Europe/Tallinn"), IcsValues.ReadDateValue("20261019T093000", [new IcsParameter("TZID", "\"Europe/Tallinn\"")]));
        Assert.IsType<IcsDateValue.UtcValue>(IcsValues.ReadDateValue("20261019T093000Z", [new IcsParameter("TZID", "Europe/Tallinn")]));
        Assert.Equal(new IcsDateValue.DateValue(new GregorianDate(1000, 1, 1)), IcsValues.ReadDateValue("10000101", none));
        Assert.Null(IcsValues.ReadDateValue("20261019T090000", [new IcsParameter("VALUE", "DATE")]));
        Assert.Null(IcsValues.ReadDateValue("20261019", [new IcsParameter("VALUE", "DATE-TIME")]));
        foreach (var bad in new[] { "20260229", "2026-10-19", "20261019T250000", "00001231" }) Assert.Null(IcsValues.ReadDateValue(bad, none));

        var zoned = new IcsDateValue.ZonedValue(L("2026-10-19T09:30"), "FLE Standard Time");
        Assert.Equal("20261019T093000", IcsValues.DateValueText(zoned));
        Assert.Equal([new IcsParameter("TZID", "FLE Standard Time")], IcsValues.DateValueParams(zoned));
        Assert.Equal("Z FLE Standard Time 2026-10-19T09:30", IcsValues.DateValueKey(zoned));
        Assert.Equal("00090102", IcsValues.DateValueText(new IcsDateValue.DateValue(new GregorianDate(9, 1, 2))));
        Assert.Equal("20261019T000000Z", IcsValues.DateValueText(new IcsDateValue.UtcValue(L("2026-10-19T00:00"))));
        Assert.Throws<ThirteenException>(() => new IcsDateValue.UtcValue(L("2026-10-19T24:00")));
    }

    [Fact]
    public void Durations_AndUtcOffsets()
    {
        Assert.Equal(new IcsDuration(false, 1, 0), IcsValues.ParseDuration("P1D"));
        Assert.Equal(new IcsDuration(false, 0, 5400), IcsValues.ParseDuration("PT1H30M"));
        Assert.Equal(new IcsDuration(true, 7, 0), IcsValues.ParseDuration("-P1W"));
        Assert.Equal(new IcsDuration(false, 1, 7384), IcsValues.ParseDuration("+P1DT2H3M4S"));
        Assert.Equal(new IcsDuration(true, 0, 1800), IcsValues.ParseDuration("-P0DT0H30M0S"));
        foreach (var bad in new[] { "P", "PT", "P1DT", "1D", "P1H", "PT1D", "" }) Assert.Null(IcsValues.ParseDuration(bad));
        Assert.Equal(-15, IcsValues.DurationMinutes(IcsValues.ParseDuration("-PT15M")!.Value));
        Assert.Equal(1, IcsValues.DurationMinutes(IcsValues.ParseDuration("PT90S")!.Value));
        Assert.Equal(-1, IcsValues.DurationMinutes(IcsValues.ParseDuration("-PT90S")!.Value));
        foreach (var (minutes, text) in new (long, string)[]
        {
            (0, "PT0S"), (-15, "-PT15M"), (-60, "-PT1H"), (-90, "-PT1H30M"), (-1440, "-P1D"), (-1500, "-P1DT1H"), (-10080, "-P1W"), (-20160, "-P2W"), (30, "PT30M"),
        })
        {
            Assert.Equal(text, IcsValues.FormatDurationMinutes(minutes));
            Assert.Equal(minutes, IcsValues.DurationMinutes(IcsValues.ParseDuration(text)!.Value));
        }
        Assert.Equal(180, IcsValues.ParseUtcOffset("+0300"));
        Assert.Equal(-300, IcsValues.ParseUtcOffset("-0500"));
        Assert.Equal(-30, IcsValues.ParseUtcOffset("-003000"));
        Assert.Equal(24, IcsValues.ParseUtcOffset("+002456"));
        Assert.Equal(0, IcsValues.ParseUtcOffset("-0000"));
        foreach (var bad in new[] { "0300", "+3", "+2400", "+0060", "Z" }) Assert.Null(IcsValues.ParseUtcOffset(bad));
        Assert.Equal("+0300", IcsValues.FormatUtcOffset(180));
        Assert.Equal("-0030", IcsValues.FormatUtcOffset(-30));
    }

    [Fact]
    public void Colors_NormalizeAndMapToCss3Names()
    {
        Assert.Equal("#ea580c", IcsColors.NormalizeHexColor("#EA580CFF"));
        Assert.Null(IcsColors.NormalizeHexColor("EA580C"));
        Assert.Equal("#ff4500", IcsColors.CssColorHex("OrangeRed"));
        Assert.Null(IcsColors.CssColorHex("rebeccapurple"));
        Assert.Equal("aqua", IcsColors.NearestCssColorName("#00ffff"));
        Assert.Equal("gray", IcsColors.NearestCssColorName("#808080"));
        Assert.Equal(
            ["orangered", "crimson"],
            new[] { "#ea580c", "#dc2626" }.Select(IcsColors.NearestCssColorName).ToArray());
    }

    [Fact]
    public void DerivedUid_IsMissingAnd32HexDigitsOfSha256()
    {
        // SHA-256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad (FIPS 180-4).
        var calendar = IcsReader.Parse(Calendar("BEGIN:VEVENT", "DTSTART:20261019T090000Z", "SUMMARY:Lunch", "END:VEVENT"), "cal");
        var uid = calendar.Groups.Single().Uid;
        var expected = "missing-" + Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes("cal\nDTSTART:20261019T090000Z\nLunch")))[..32];
        Assert.Equal(expected, uid);
        Assert.True(calendar.Groups.Single().Master!.UidDerived);
        Assert.Equal("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData("abc"u8)));
        Assert.Equal(uid, IcsReader.Parse(Calendar("BEGIN:VEVENT", "DTSTART:20261019T090000Z", "SUMMARY:Lunch", "END:VEVENT"), "cal").Groups.Single().Uid);
        Assert.NotEqual(uid, IcsReader.Parse(Calendar("BEGIN:VEVENT", "DTSTART:20261019T090000Z", "SUMMARY:Lunch", "END:VEVENT"), "other").Groups.Single().Uid);
    }

    // ---- Reader --------------------------------------------------------------------------------

    [Fact]
    public void Parse_Throws_OnlyWithoutAVCalendar()
    {
        var error = Assert.Throws<ThirteenException>(() => IcsReader.Parse("BEGIN:VEVENT\r\nEND:VEVENT\r\n"));
        Assert.Equal(ThirteenErrorKind.InvalidIcs, error.Kind);
        var calendar = IcsReader.Parse("BEGIN:VCALENDAR\r\ngarbage\r\nEND:VCALENDAR\r\n");
        Assert.Equal([IcsWarningCode.BadLine], calendar.Warnings.Select(w => w.Code).ToArray());
    }

    [Fact]
    public void Parse_ReadsDtend10000101_AfterAnAllDayStart_AsTheEndOf9999()
    {
        var calendar = IcsReader.Parse(Calendar("BEGIN:VEVENT", "UID:a", "DTSTART;VALUE=DATE:99991230", "DTEND;VALUE=DATE:10000101", "END:VEVENT"));
        var master = calendar.Groups.Single().Master!;
        Assert.Null(master.End);
        Assert.Equal("P2D", master.Duration);
        var early = IcsReader.Parse(Calendar("BEGIN:VEVENT", "UID:b", "DTSTART;VALUE=DATE:09991230", "DTEND;VALUE=DATE:10000101", "END:VEVENT")).Groups.Single().Master!;
        Assert.Equal(new IcsDateValue.DateValue(new GregorianDate(1000, 1, 1)), early.End);
        // The writer gives the line back as read.
        Assert.Contains("DTEND;VALUE=DATE:10000101\r\n", IcsWriter.Serialize(IcsGroups.ReplaceGroup(calendar, calendar.Groups[0]), Zones), StringComparison.Ordinal);
    }

    [Fact]
    public void Parse_UpperCasesNamesAndEnumerations_AsJavaScriptDoes()
    {
        // JavaScript's toUpperCase applies the full case mapping (ß is SS, ﬁ is FI, ŉ is ʼN) and maps the dotless ı to
        // I; .NET's invariant upper case does neither. Expectations from @thirteen/core/ics (found by ics-fuzz).
        Assert.Equal(("FINAL", "STRASSE", "TENTATIVE", "ʼN", "ΑΙ", "İ", "ABC-1"),
            (JsCase.Upper("ﬁnal"), JsCase.Upper("Straße"), JsCase.Upper("tentatıve"), JsCase.Upper("ŉ"), JsCase.Upper("ᾳ"), JsCase.Upper("İ"), JsCase.Upper("abc-1")));
        var text = Calendar(
            "BEGIN:VEVENT", "UID:s", "DTSTAMP:20261001T080000Z", "DTSTART;VALUE=DATE-TıME:20261019", "SUMMARY:Bad", "END:VEVENT",
            "BEGIN:VEVENT", "UID:t", "DTSTAMP:20261001T080000Z", "DTSTART:20261020T090000Z", "STATUS:TENTATıVE", "TRANSP:Straße", "END:VEVENT",
            "BEGIN:VEVENT", "UID:u", "DTSTAMP:20261001T080000Z", "DTSTART:20261021T090000Z", "STATUS:ﬁnal",
            "BEGIN:VALARM", "ACTION:dısplay", "TRIGGER;RELATED=ıEND:-PT5M", "END:VALARM", "END:VEVENT");
        var calendar = IcsReader.Parse(text, "cal", Zones);
        // VALUE=DATE-TıME is DATE-TIME, so a date is a bad DTSTART and the event is kept as read.
        Assert.Equal([(7, IcsWarningCode.BadDate)], calendar.Warnings.Select(w => (w.Line, w.Code)).ToArray());
        Assert.Equal(["VEVENT"], calendar.Others.Select(o => o.Name).ToArray());
        Assert.Equal([("t", "TENTATIVE", "STRASSE"), ("u", "FINAL", null)], calendar.Groups.Select(g => (g.Uid, g.Master!.Status, g.Master.Transp)).ToArray());
        var alarm = calendar.Groups[1].Master!.Alarms.Single();
        Assert.Equal(("DISPLAY", (IcsTrigger)new IcsTrigger.Relative(-5, IcsTriggerRelation.Start)), (alarm.Action, alarm.Trigger));
        var events = IcsExpansion.EventsFromCalendar(calendar, "Europe/Tallinn", Zones, new DeviceWindow(L("2026-10-01T00:00"), L("2026-11-01T00:00")), calendarId: "cal");
        Assert.Equal([EventStatus.Tentative, EventStatus.Confirmed], events.Select(e => e.Status).ToArray());
        // An edit keeps the untouched STATUS and TRANSP as read: the field still equals the one read from Original.
        Assert.Equal(
            "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//Thirteen tests//EN\r\nBEGIN:VEVENT\r\nUID:s\r\nDTSTAMP:20261001T080000Z\r\nDTSTART;VALUE=DATE-TıME:20261019\r\nSUMMARY:Bad\r\nEND:VEVENT\r\n" +
            "BEGIN:VEVENT\r\nUID:t\r\nDTSTAMP:20261001T080000Z\r\nSEQUENCE:0\r\nDTSTART:20261020T090000Z\r\nTRANSP:Straße\r\nSTATUS:TENTATıVE\r\nEND:VEVENT\r\n" +
            "BEGIN:VEVENT\r\nUID:u\r\nDTSTAMP:20261001T080000Z\r\nDTSTART:20261021T090000Z\r\nSTATUS:ﬁnal\r\nBEGIN:VALARM\r\nACTION:dısplay\r\nTRIGGER;RELATED=ıEND:-PT5M\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
            IcsWriter.Serialize(IcsGroups.ReplaceGroup(calendar, calendar.Groups[0]), Zones, L("2026-10-19T06:41")));
    }

    [Fact]
    public void RdatePeriod_LongerThanAnInt_EndsAtTheEndOf9999()
    {
        // A PERIOD of 3,652,060 days (capped at the 3,652,059 days of years 1 to 9999) lasts 5,258,964,960 minutes, more
        // than an int: the occurrence ends at 9999-12-31T24:00, as in TypeScript (ExtraDate.DurationMinutes is a long).
        var calendar = IcsReader.Parse(Calendar(
            "BEGIN:VEVENT", "UID:long", "DTSTAMP:20261001T080000Z", "DTSTART;TZID=Europe/Tallinn:20260105T100000",
            "DTEND;TZID=Europe/Tallinn:20260105T110000", "RRULE:FREQ=WEEKLY;COUNT=2", "RDATE;VALUE=PERIOD:20260107T100000Z/P3652060D",
            "SUMMARY:Long", "END:VEVENT"), "cal", Zones);
        var input = IcsExpansion.RecognitionInputFor(calendar.Groups[0].Master!, calendar, Zones);
        Assert.Equal([new ExtraDate(new GregorianDate(2026, 1, 7), 720, 5_258_964_960)], input.Rdates.ToArray());
        var january = IcsExpansion.EventsFromCalendar(calendar, "Europe/Tallinn", Zones, new DeviceWindow(L("2026-01-01T00:00"), L("2026-02-01T00:00")), calendarId: "cal");
        Assert.Equal(
            [("cal/long|2026-01-05T10:00", L("2026-01-05T11:00")), ("cal/long|2026-01-07T12:00", L("9999-12-31T24:00")), ("cal/long|2026-01-12T10:00", L("2026-01-12T11:00"))],
            january.Select(e => (e.Key, e.End)).ToArray());
        var last = IcsExpansion.EventsFromCalendar(calendar, "Europe/Tallinn", Zones, new DeviceWindow(L("9999-12-01T00:00"), L("9999-12-31T24:00")), calendarId: "cal");
        Assert.Equal(["cal/long|2026-01-07T12:00"], last.Select(e => e.Key).ToArray());
    }

    // ---- Zones ---------------------------------------------------------------------------------

    [Fact]
    public void Resolve_PrefersAKnownIanaId_ThenAWindowsId_ThenTheFile_ElseFloating()
    {
        var calendar = IcsReader.Parse(Calendar(
            "BEGIN:VTIMEZONE", "TZID:Custom", "BEGIN:STANDARD", "DTSTART:19700101T000000", "TZOFFSETFROM:+0530", "TZOFFSETTO:+0530", "END:STANDARD", "END:VTIMEZONE"));
        Assert.Equal(ZoneHandleKind.Iana, IcsZones.Resolve("Europe/Tallinn", calendar, Zones).Kind);
        var windows = IcsZones.Resolve("FLE Standard Time", calendar, Zones);
        Assert.Equal((ZoneHandleKind.Windows, "Europe/Kiev"), (windows.Kind, windows.Zone));
        var custom = IcsZones.Resolve("Custom", calendar, Zones);
        Assert.Equal(ZoneHandleKind.VTimeZone, custom.Kind);
        Assert.Equal(L("2026-10-19T04:00"), IcsZones.ToUtc(new IcsDateValue.ZonedValue(L("2026-10-19T09:30"), "Custom"), custom));
        var floating = IcsZones.Resolve("Mars/Olympus", calendar, Zones);
        Assert.Equal(ZoneHandleKind.Floating, floating.Kind);
        Assert.Null(IcsZones.ToUtc(new IcsDateValue.FloatingValue(L("2026-10-19T09:30")), floating));
        Assert.Equal(L("2026-10-19T06:30"), IcsZones.ToUtc(new IcsDateValue.ZonedValue(L("2026-10-19T09:30"), "Europe/Tallinn"), IcsZones.Resolve("Europe/Tallinn", calendar, Zones)));
    }

    [Fact]
    public void BuildVTimeZone_NewYork2005And2026_BothRulePeriods_TheLastOpenEnded()
    {
        var zone = IcsZones.BuildVTimeZone("America/New_York", [2005, 2026], Zones);
        Assert.Equal(
            Crlf(
                "BEGIN:VTIMEZONE", "TZID:America/New_York", "X-THIRTEEN-GENERATED:2005-2026",
                "BEGIN:DAYLIGHT", "DTSTART:20040404T020000", "TZOFFSETFROM:-0500", "TZOFFSETTO:-0400", "RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU;UNTIL=20060402T070000Z", "END:DAYLIGHT",
                "BEGIN:STANDARD", "DTSTART:20041031T020000", "TZOFFSETFROM:-0400", "TZOFFSETTO:-0500", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU;UNTIL=20061029T060000Z", "END:STANDARD",
                "BEGIN:DAYLIGHT", "DTSTART:20070311T020000", "TZOFFSETFROM:-0500", "TZOFFSETTO:-0400", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU", "END:DAYLIGHT",
                "BEGIN:STANDARD", "DTSTART:20071104T020000", "TZOFFSETFROM:-0400", "TZOFFSETTO:-0500", "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU", "END:STANDARD",
                "END:VTIMEZONE"),
            IcsWriter.SerializeTimeZone(zone));

        // The definition alone gives the recorded offsets every hour of 2004 to 2032.
        var own = IcsZones.VTimeZoneResolverFor(zone, "G");
        var mismatches = new List<string>();
        for (var t = L("2004-01-01T00:00").Absolute; t < L("2033-01-01T00:00").Absolute; t += 60)
        {
            var utc = LocalDateTime.FromAbsolute(t)!.Value;
            var expected = Zones.OffsetMinutesAt("America/New_York", utc);
            var actual = own.OffsetMinutesAt("G", utc);
            if (expected != actual) mismatches.Add($"{utc}: {actual} != {expected}");
        }
        Assert.Empty(mismatches.Take(10));
    }

    [Fact]
    public void BuildVTimeZone_Jerusalem_TokyoWithoutDst_AndBadInput()
    {
        var jerusalem = IcsZones.BuildVTimeZone("Asia/Jerusalem", [2026, 2029], Zones);
        Assert.Equal(
            ["daylight 2025 3 -1:Friday utc", "standard 2025 10 -1:Sunday utc", "daylight 2028 3 4:Friday open", "standard 2028 10 -1:Sunday open"],
            jerusalem.Observances.Select(o => FormattableString.Invariant(
                $"{o.Kind.RawValue()} {o.Start.Date.Year} {string.Join(",", o.RRules.Select(r => FormattableString.Invariant($"{r.ByMonth[0]} {r.ByDay[0].Ordinal}:{r.ByDay[0].Weekday} {(r.Until is null ? "open" : r.Until.Kind)}")))}")).ToArray());
        var tokyo = IcsZones.BuildVTimeZone("Asia/Tokyo", [2026], Zones);
        Assert.Equal(
            [new IcsObservance(IcsObservanceKind.Standard, L("2025-01-01T00:00"), 540, 540, ValueList<RRule>.Empty, ValueList<LocalDateTime>.Empty, ValueList<string>.Empty)],
            tokyo.Observances.ToArray());
        Assert.Equal(new IcsYearRange(2026, 2027), IcsZones.BuildVTimeZone("Europe/Tallinn", [2027, 2026, 2026], Zones).Generated);
        Assert.Equal(ThirteenErrorKind.InvalidIcs, Assert.Throws<ThirteenException>(() => IcsZones.BuildVTimeZone("Nowhere", [2026], Zones)).Kind);
        Assert.Equal(ThirteenErrorKind.InvalidIcs, Assert.Throws<ThirteenException>(() => IcsZones.BuildVTimeZone("Europe/Tallinn", [], Zones)).Kind);
        Assert.Equal(ThirteenErrorKind.YearOutOfRange, Assert.Throws<ThirteenException>(() => IcsZones.BuildVTimeZone("Europe/Tallinn", [0], Zones)).Kind);
        Assert.Equal(ThirteenErrorKind.InvalidIcs, Assert.Throws<ThirteenException>(() => IcsZones.BuildVTimeZone("", [2026], Zones)).Kind);
    }

    [Fact]
    public void SameDefinition_ComparesObservancesInAnyOrder_IgnoringNames()
    {
        var a = IcsZones.BuildVTimeZone("America/New_York", [2026], Zones);
        var reversed = a with { Tzid = "Other", Observances = a.Observances.Reverse().Select(o => o with { Names = ["EST"] }).ToValueList() };
        Assert.True(IcsZones.SameDefinition(a, reversed));
        var shifted = a with { Observances = a.Observances.Select((o, i) => i == 0 ? o with { OffsetTo = o.OffsetTo + 60 } : o).ToValueList() };
        Assert.False(IcsZones.SameDefinition(a, shifted));
    }

    // ---- Groups --------------------------------------------------------------------------------

    private static readonly string TwoEvents = Calendar(
        "BEGIN:VEVENT", "UID:a", "DTSTAMP:20261001T080000Z", "LAST-MODIFIED:20261002T080000Z", "DTSTART;TZID=Europe/Tallinn:20261019T090000", "SUMMARY:First", "END:VEVENT",
        "BEGIN:VEVENT", "UID:b", "DTSTAMP:20261003T080000Z", "DTSTART;VALUE=DATE:20261020", "SUMMARY:Second", "END:VEVENT");

    [Fact]
    public void ReplaceGroup_KeepsPlaces_ClearsRaw_AndRemoveGroup()
    {
        var calendar = IcsReader.Parse(TwoEvents);
        var first = calendar.Groups[0];
        var edited = IcsGroups.ReplaceGroup(calendar, first with { Master = first.Master! with { Summary = "Renamed", Sequence = 1 } });
        Assert.Equal(["a", "b"], edited.Groups.Select(g => g.Uid).ToArray());
        Assert.Null(edited.Groups[0].Master!.Raw);
        Assert.Equal(first.Master!.Line, edited.Groups[0].Master!.Line);
        var text = IcsWriter.Serialize(edited, Zones, L("2026-10-19T06:41"));
        Assert.Contains("SUMMARY:Renamed\r\n", text, StringComparison.Ordinal);
        Assert.Contains("DTSTART;TZID=Europe/Tallinn:20261019T090000\r\n", text, StringComparison.Ordinal);
        Assert.Contains("BEGIN:VEVENT\r\nUID:b\r\nDTSTAMP:20261003T080000Z\r\nDTSTART;VALUE=DATE:20261020\r\nSUMMARY:Second\r\nEND:VEVENT\r\n", text, StringComparison.Ordinal);
        Assert.Contains("X-THIRTEEN-GENERATED:2026-2026", text, StringComparison.Ordinal);
        Assert.True(text.IndexOf("BEGIN:VTIMEZONE", StringComparison.Ordinal) < text.IndexOf("BEGIN:VEVENT", StringComparison.Ordinal));
        Assert.Equal(["b"], IcsGroups.RemoveGroup(calendar, "a").Groups.Select(g => g.Uid).ToArray());
        Assert.Equal(["b"], IcsGroups.ReplaceGroup(calendar, new IcsGroup("a", null, ValueList<IcsEvent>.Empty)).Groups.Select(g => g.Uid).ToArray());
        Assert.Equal(ThirteenErrorKind.InvalidIcs, Assert.Throws<ThirteenException>(() => IcsGroups.ReplaceGroup(calendar, new IcsGroup("x", first.Master, ValueList<IcsEvent>.Empty))).Kind);
    }

    [Fact]
    public void Versions_AndImportBaselines()
    {
        var calendar = IcsReader.Parse(TwoEvents);
        Assert.Equal(L("2026-10-02T08:00"), IcsGroups.EventVersion(calendar.Groups[0].Master!));
        Assert.Equal(L("2026-10-03T08:00"), IcsGroups.GroupVersion(calendar.Groups[1]));
        var withBaseline = IcsGroups.WithImportBaseline(calendar.Groups[0], L("2026-10-02T08:00"));
        Assert.EndsWith("SUMMARY:First\r\nX-THIRTEEN-IMPORTED-LAST-MODIFIED:20261002T080000Z\r\nEND:VEVENT\r\n", withBaseline.Master!.Raw, StringComparison.Ordinal);
        var again = IcsGroups.WithImportBaseline(withBaseline, L("2026-10-05T08:00"));
        Assert.Single(again.Master!.Raw!.Split("X-THIRTEEN-IMPORTED-LAST-MODIFIED").Skip(1));
        Assert.Equal(new IcsDateValue.UtcValue(L("2026-10-05T08:00")), again.Master.ImportedLastModified);
    }

    [Fact]
    public void AllDayEnd_UntilFor_AndNewCalendar()
    {
        Assert.Equal(new IcsAllDayEnd(new IcsDateValue.DateValue(new GregorianDate(2026, 10, 21)), null), IcsGroups.AllDayEnd(new GregorianDate(2026, 10, 19), new GregorianDate(2026, 10, 20)));
        Assert.Equal(new IcsAllDayEnd(null, null), IcsGroups.AllDayEnd(new GregorianDate(9999, 12, 31), new GregorianDate(9999, 12, 31)));
        Assert.Equal(new IcsAllDayEnd(null, "P3D"), IcsGroups.AllDayEnd(new GregorianDate(9999, 12, 29), new GregorianDate(9999, 12, 31)));
        Assert.Throws<ThirteenException>(() => IcsGroups.AllDayEnd(new GregorianDate(2026, 10, 20), new GregorianDate(2026, 10, 19)));

        var calendar = IcsReader.Parse(TwoEvents);
        var master = calendar.Groups[0].Master!;
        Assert.Equal(RRuleUntil.Utc(L("2026-11-16T21:59")), IcsGroups.UntilFor(new GregorianDate(2026, 11, 16), master, calendar, Zones));
        Assert.Equal(RRuleUntil.OnDate(new GregorianDate(2026, 11, 16)), IcsGroups.UntilFor(new GregorianDate(2026, 11, 16), calendar.Groups[1].Master!, calendar, Zones));
        var floating = master with { Start = new IcsDateValue.ZonedValue(L("2026-10-19T09:00"), "Mars/Olympus") };
        Assert.Equal(RRuleUntil.Floating(L("2026-11-16T23:59")), IcsGroups.UntilFor(new GregorianDate(2026, 11, 16), floating, calendar, Zones));

        var weekly = master with { RRules = [RRule.Parse("FREQ=WEEKLY;COUNT=5")] };
        var retimed = IcsGroups.WithRetimedUntils(weekly, [new UntilRewrite(StoredRuleKind.RRule, 0, new GregorianDate(2026, 11, 16))], calendar, Zones);
        Assert.Equal("FREQ=WEEKLY;UNTIL=20261116T215959Z", retimed.RRules[0].ToString());
        Assert.Null(retimed.Raw);
        Assert.Throws<ThirteenException>(() => IcsGroups.WithRetimedUntils(weekly, [new UntilRewrite(StoredRuleKind.ExRule, 0, new GregorianDate(2026, 11, 16))], calendar, Zones));
        Assert.Equal("FREQ=WEEKLY;UNTIL=20261116T215959Z;BYDAY=MO", IcsWriter.PatchRuleEnd("FREQ=WEEKLY;COUNT=5;BYDAY=MO", retimed.RRules[0]));
        Assert.Equal("RRULE:FREQ=DAILY;COUNT=3", IcsWriter.PatchRuleEnd("RRULE:FREQ=DAILY", RRule.Parse("FREQ=DAILY;COUNT=3")));

        var fresh = IcsGroups.NewCalendar("id-1", "Work, home", "#EA580C");
        Assert.Equal(
            Crlf("BEGIN:VCALENDAR", "VERSION:2.0", $"PRODID:{IcsWriter.ThirteenProdId}", "CALSCALE:GREGORIAN", "X-WR-CALNAME:Work\\, home", "NAME:Work\\, home",
                "X-APPLE-CALENDAR-COLOR:#EA580C", "COLOR:orangered", "X-THIRTEEN-CALENDAR-ID:id-1", "END:VCALENDAR"),
            IcsWriter.Serialize(fresh, Zones));
        Assert.Throws<ThirteenException>(() => IcsGroups.NewCalendar("", "Work", "#ea580c"));
        Assert.Throws<ThirteenException>(() => IcsGroups.NewCalendar("id", "Work", "orange"));
        var renamed = IcsWriter.Serialize(fresh with { Name = "Home", Color = "#2563eb", RefreshInterval = "PT6H" }, Zones);
        Assert.Contains("X-WR-CALNAME:Home\r\nNAME:Home\r\nX-APPLE-CALENDAR-COLOR:#2563EB\r\nCOLOR:royalblue\r\n", renamed, StringComparison.Ordinal);
        Assert.Contains("REFRESH-INTERVAL;VALUE=DURATION:PT6H\r\nX-PUBLISHED-TTL:PT6H\r\n", renamed, StringComparison.Ordinal);
    }

    // ---- Expansion and merges ------------------------------------------------------------------

    [Fact]
    public void EventsFromCalendar_GivesKeys_StartUtc_AndZone_AndValidatesItsInput()
    {
        var calendar = IcsReader.Parse(TwoEvents, "cal", Zones);
        var window = new DeviceWindow(L("2026-10-01T00:00"), L("2026-11-01T00:00"));
        var events = IcsExpansion.EventsFromCalendar(calendar, "America/New_York", Zones, window, calendarId: "cal");
        Assert.Equal(["cal/a|2026-10-19T09:00", "cal/b|2026-10-20"], events.Select(e => e.Key).ToArray());
        Assert.Equal((L("2026-10-19T02:00"), L("2026-10-19T06:00"), "Europe/Tallinn"), (events[0].Start, events[0].StartUtc!.Value, events[0].Zone));
        Assert.Equal((true, (LocalDateTime?)null, (string?)null), (events[1].AllDay, events[1].StartUtc, events[1].Zone));
        Assert.Equal(new EventOccurrence("cal/b|2026-10-20", "cal", "Second", true, L("2026-10-20T00:00"), L("2026-10-20T24:00")), events[1].ToOccurrence());
        Assert.Equal(ThirteenErrorKind.InvalidEvent, Assert.Throws<ThirteenException>(() => IcsExpansion.EventsFromCalendar(calendar, "Mars/Olympus", Zones, window)).Kind);
        Assert.Equal(ThirteenErrorKind.InvalidEvent, Assert.Throws<ThirteenException>(() => IcsExpansion.EventsFromCalendar(calendar, "Europe/Tallinn", Zones, window, limit: 0)).Kind);
    }

    [Fact]
    public void RecognitionInputFor_ReadsAThirteenMarker_InTheMastersZone()
    {
        var calendar = IcsReader.Parse(Calendar(
            "BEGIN:VEVENT", "UID:m", "DTSTAMP:20261001T080000Z", "DTSTART;TZID=Europe/Tallinn:20261019T190000",
            "RRULE:FREQ=WEEKLY;UNTIL=20261116T165959Z", "EXDATE:20261026T170000Z", "SUMMARY:Choir", "END:VEVENT"));
        var input = IcsExpansion.RecognitionInputFor(calendar.Groups[0].Master!, calendar, Zones);
        Assert.Equal(L("2026-10-19T19:00"), input.Start);
        Assert.Equal(L("2026-11-16T18:59"), input.RRules[0].Until);
        Assert.Equal([new OriginalDate(new GregorianDate(2026, 10, 26), 19 * 60)], input.Exdates.ToArray());
        var recognition = Recognition.Of(input);
        Assert.Equal([new OriginalDate(new GregorianDate(2026, 10, 26))], recognition.Recurrence.ExceptDates.ToArray());
    }

    [Fact]
    public void ImportCalendar_AddsUpdatesAndKeeps_AndRestoreCountsKeptNewer()
    {
        var target = IcsReader.Parse(TwoEvents, "cal", Zones);
        var newer = Calendar(
            "BEGIN:VEVENT", "UID:a", "DTSTAMP:20261010T080000Z", "LAST-MODIFIED:20261010T080000Z", "DTSTART;TZID=Europe/Tallinn:20261019T100000", "SUMMARY:First, moved", "END:VEVENT",
            "BEGIN:VEVENT", "UID:c", "DTSTART:20261021T090000Z", "SUMMARY:No version", "END:VEVENT",
            "BEGIN:VEVENT", "UID:b", "DTSTAMP:20261001T080000Z", "DTSTART;VALUE=DATE:20261020", "SUMMARY:Second, older", "END:VEVENT");
        var imported = IcsMerge.ImportCalendar(target, newer, "cal", Zones);
        Assert.Equal((1, 1, 1, 0), (imported.Added, imported.Updated, imported.Unchanged, imported.Skipped));
        var a = imported.Calendar.Groups.Single(g => g.Uid == "a").Master!;
        Assert.Equal(("First, moved", new IcsDateValue.UtcValue(L("2026-10-10T08:00"))), (a.Summary, a.ImportedLastModified));
        Assert.Contains("X-THIRTEEN-IMPORTED-LAST-MODIFIED:20261010T080000Z\r\nEND:VEVENT", a.Raw, StringComparison.Ordinal);
        // A group with neither LAST-MODIFIED nor DTSTAMP is older than any other: added without a baseline line.
        Assert.Null(imported.Calendar.Groups.Single(g => g.Uid == "c").Master!.ImportedLastModified);
        Assert.Equal("Second", imported.Calendar.Groups.Single(g => g.Uid == "b").Master!.Summary);

        var restored = IcsMerge.RestoreCalendar(target, newer, "cal", Zones);
        Assert.Equal((1, 1, 0, 1), (restored.Added, restored.Updated, restored.Unchanged, restored.KeptNewer));
        Assert.DoesNotContain("X-THIRTEEN-IMPORTED-LAST-MODIFIED", IcsWriter.Serialize(restored.Calendar, Zones), StringComparison.Ordinal);
    }

    [Fact]
    public void ImportCalendar_WithoutAVersion_NeverReplacesAStoredGroupOrOverride()
    {
        // The TypeScript reference (ics-procedures.ts) throws here, because the fixtures' inputs always carry a version;
        // §2.17 says a group with neither LAST-MODIFIED nor DTSTAMP is older than any other, and the C# merge does that.
        var target = IcsReader.Parse(Calendar(
            "BEGIN:VEVENT", "UID:a", "DTSTAMP:20261001T080000Z", "DTSTART:20261019T090000Z", "RRULE:FREQ=DAILY;COUNT=5", "SUMMARY:Stored", "END:VEVENT",
            "BEGIN:VEVENT", "UID:a", "DTSTAMP:20261001T080000Z", "RECURRENCE-ID:20261020T090000Z", "DTSTART:20261020T100000Z", "SUMMARY:Stored override", "END:VEVENT"), "cal", Zones);
        var incoming = Calendar(
            "BEGIN:VEVENT", "UID:a", "RECURRENCE-ID:20261020T090000Z", "DTSTART:20261020T110000Z", "SUMMARY:No version", "END:VEVENT",
            "BEGIN:VEVENT", "UID:a", "RECURRENCE-ID:20261021T090000Z", "DTSTART:20261021T110000Z", "SUMMARY:New, no version", "END:VEVENT");
        var imported = IcsMerge.ImportCalendar(target, incoming, "cal", Zones);
        Assert.Equal((0, 1, 0, 0), (imported.Added, imported.Updated, imported.Unchanged, imported.Skipped));
        var overrides = imported.Calendar.Groups.Single().Overrides;
        Assert.Equal(["Stored override", "New, no version"], overrides.Select(o => o.Summary).ToArray());
        Assert.Null(overrides[1].ImportedLastModified);
        Assert.DoesNotContain("X-THIRTEEN-IMPORTED-LAST-MODIFIED", overrides[1].Raw, StringComparison.Ordinal);

        var master = Calendar("BEGIN:VEVENT", "UID:a", "DTSTART:20261019T120000Z", "SUMMARY:Master, no version", "END:VEVENT");
        var again = IcsMerge.ImportCalendar(target, master, "cal", Zones);
        Assert.Equal((0, 0, 1, 0), (again.Added, again.Updated, again.Unchanged, again.Skipped));
        Assert.Equal("Stored", again.Calendar.Groups.Single().Master!.Summary);
    }
}
