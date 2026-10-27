using System.Text.Json;
using Thirteen.Core.Json;

namespace Thirteen.Core.Tests;

/// <summary>The first and last supported days, range errors, the SPEC 2 anchor table and SPEC 1.5 time zones.</summary>
public sealed class EdgeDayTests
{
    private static readonly GregorianDate First = new(1, 1, 1);
    private static readonly GregorianDate Last = new(9999, 12, 31);

    private static ThirteenErrorKind KindOf(Action action) => Assert.Throws<ThirteenException>(action).Kind;

    // ---- The edges of the range --------------------------------------------------------------

    [Fact]
    public void RangeConstants_MatchDateOnly()
    {
        Assert.Equal(First, GregorianDate.MinValue);
        Assert.Equal(First, default);
        Assert.Equal(Last, GregorianDate.MaxValue);
        Assert.Equal(GregorianDate.MinJulianDayNumber, First.JulianDayNumber);
        Assert.Equal(GregorianDate.MaxJulianDayNumber, Last.JulianDayNumber);
        Assert.Equal(DateOnly.MinValue, First.ToDateOnly());
        Assert.Equal(DateOnly.MaxValue, Last.ToDateOnly());
        Assert.Equal(First, GregorianDate.FromDateOnly(DateOnly.MinValue));
        Assert.Equal(Last, (GregorianDate)DateOnly.MaxValue);
        Assert.Equal(DateOnly.MaxValue, (DateOnly)Last);
        Assert.Equal(2_451_545, new GregorianDate(2000, 1, 1).JulianDayNumber);
        Assert.Equal(new YearRange(1, 9999), GregorianDate.SupportedYears);
        Assert.True(GregorianDate.SupportedYears.Contains(9999));
        Assert.False(GregorianDate.SupportedYears.Contains(0));
        Assert.False(GregorianDate.SupportedYears.Contains(10_000));
    }

    [Fact]
    public void DateTime_RoundTripsTheCalendarDate_WhateverItsKind()
    {
        // Date pickers hand over a DateTime whose Year/Month/Day is the chosen date.
        foreach (var kind in new[] { DateTimeKind.Unspecified, DateTimeKind.Local, DateTimeKind.Utc })
        {
            Assert.Equal(new GregorianDate(2026, 10, 19), GregorianDate.FromDateTime(new DateTime(2026, 10, 19, 23, 59, 59, kind)));
            Assert.Equal(new GregorianDate(2024, 2, 29), GregorianDate.FromDateTime(new DateTime(2024, 2, 29, 0, 0, 0, kind)));
        }
        Assert.Equal(First, GregorianDate.FromDateTime(DateTime.MinValue));
        Assert.Equal(Last, GregorianDate.FromDateTime(DateTime.MaxValue));

        var midnight = new GregorianDate(2026, 10, 19).ToDateTime();
        Assert.Equal(new DateTime(2026, 10, 19), midnight);
        Assert.Equal(DateTimeKind.Unspecified, midnight.Kind);
        Assert.Equal(TimeSpan.Zero, midnight.TimeOfDay);
        Assert.Equal(DateTime.MinValue, First.ToDateTime());
        Assert.Equal(Last, GregorianDate.FromDateTime(Last.ToDateTime()));
    }

    [Fact]
    public void FirstDay_0001_01_01()
    {
        Assert.Equal(Weekday.Monday, First.Weekday); // proleptic Gregorian
        Assert.Equal(1, First.DayOfYear);
        var ifc = First.ToThirteen();
        Assert.Equal(new ThirteenMonthDate(1, 1, 1), ifc);
        Assert.Equal("January 1, 1", ifc.Format());
        Assert.Equal("0001-M01-01", ifc.Format(FormatOptions.Numeric));
        Assert.Equal(Weekday.Sunday, ifc.Weekday);
        var positivist = First.ToThirteen(CalendarSystemId.Positivist);
        Assert.Equal(-1787, positivist.DisplayYear);
        Assert.Equal("Moses 1, -1787", positivist.Format());
        Assert.Equal("-1787-M01-01", positivist.Format(FormatOptions.Numeric));
        Assert.Equal(positivist, ThirteenDate.ParseNumeric("-1787-M01-01", CalendarSystemId.Positivist));
        Assert.Equal(364, First.DaysUntilYearDay());
        Assert.Equal(0.0, new Comparison(First).YearProgress);
        Assert.Equal(6, new Comparison(First).WeekdayShift); // Sunday fixed vs Monday real
    }

    [Fact]
    public void LastDay_9999_12_31()
    {
        Assert.Equal(Weekday.Friday, Last.Weekday);
        Assert.Equal(DateOnly.MaxValue.DayOfWeek, Last.Weekday.ToDayOfWeek());
        Assert.Equal(365, Last.DayOfYear);
        var ifc = Last.ToThirteen();
        Assert.Equal(new ThirteenIntercalaryDate(9999, IntercalaryDayId.YearDay), ifc);
        Assert.Equal("Year Day 9999", ifc.Format());
        Assert.Equal("9999-YD", ifc.Format(FormatOptions.Numeric));
        Assert.Null(ifc.Weekday);
        var positivist = Last.ToThirteen(CalendarSystemId.Positivist);
        Assert.Equal(8211, positivist.DisplayYear);
        Assert.Equal("Festival of All the Dead 8211", positivist.Format());
        Assert.Equal(positivist, ThirteenDate.ParseNumeric("8211-YD", CalendarSystemId.Positivist));
        Assert.Equal(0, Last.DaysUntilYearDay());
        Assert.Equal(0, Last.DaysUntilYearDay(CalendarSystemId.Positivist));
        var c = new Comparison(Last);
        Assert.Equal(0, c.DaysRemainingInYear);
        Assert.Null(c.WeekdayShift);
        Assert.Null(c.LabelDrift);
        Assert.Null(c.ThirteenMonthDays);
        Assert.Equal(new ThirteenMonthDate(9999, 13, 28), new ThirteenMonthDate(9999, 13, 1).AddDays(27));
    }

    [Fact]
    public void ArithmeticPastTheEdges_Throws()
    {
        Assert.Equal(ThirteenErrorKind.JulianDayNumberOutOfRange, KindOf(() => First.AddDays(-1)));
        Assert.Equal(ThirteenErrorKind.JulianDayNumberOutOfRange, KindOf(() => Last.AddDays(1)));
        Assert.Equal(ThirteenErrorKind.JulianDayNumberOutOfRange, KindOf(() => Last.AddDays(long.MaxValue)));
        Assert.Equal(ThirteenErrorKind.JulianDayNumberOutOfRange, KindOf(() => First.AddDays(long.MinValue)));
        Assert.Equal(First, Last.AddDays(-(GregorianDate.MaxJulianDayNumber - GregorianDate.MinJulianDayNumber)));
        Assert.Equal(ThirteenErrorKind.JulianDayNumberOutOfRange, KindOf(() => Last.ToThirteen().AddDays(1)));
        Assert.Equal(ThirteenErrorKind.JulianDayNumberOutOfRange, KindOf(() => GregorianDate.FromJulianDayNumber(GregorianDate.MinJulianDayNumber - 1)));
        Assert.Equal(ThirteenErrorKind.JulianDayNumberOutOfRange, KindOf(() => GregorianDate.FromJulianDayNumber(GregorianDate.MaxJulianDayNumber + 1)));

        Assert.Equal(ThirteenErrorKind.YearOutOfRange, KindOf(() => new ThirteenMonthDate(9999, 13, 5).AddMonths(1)));
        Assert.Equal(ThirteenErrorKind.YearOutOfRange, KindOf(() => new ThirteenMonthDate(1, 1, 5).AddMonths(-1)));
        Assert.Equal(ThirteenErrorKind.YearOutOfRange, KindOf(() => new ThirteenMonthDate(1, 1, 5).AddMonths(long.MaxValue)));
        Assert.Equal(ThirteenErrorKind.YearOutOfRange, KindOf(() => new ThirteenMonthDate(1, 1, 5).AddMonths(long.MinValue)));
        Assert.Equal(new ThirteenMonthDate(9999, 13, 5), new ThirteenMonthDate(1, 1, 5).AddMonths(9999L * 13 - 1));
        Assert.Equal(ThirteenErrorKind.IntercalaryDayHasNoMonth, KindOf(() => Last.ToThirteen().AddMonths(1)));
        Assert.Equal(ThirteenErrorKind.YearOutOfRange, KindOf(() => Last.ToThirteen().SameSlotInYear(10000)));
    }

    [Fact]
    public void DisplayYearRanges_AndTheirEdges()
    {
        Assert.Equal(new YearRange(1, 9999), CalendarSystemId.Ifc.DisplayYearRange());
        Assert.Equal(new YearRange(-1787, 8211), CalendarSystemId.Positivist.DisplayYearRange());
        Assert.Equal(1, CalendarSystemId.Positivist.GregorianYear(-1787));
        Assert.Equal(9999, CalendarSystemId.Positivist.GregorianYear(8211));
        Assert.Equal(1788, CalendarSystemId.Positivist.GregorianYear(0));
        Assert.Equal(ThirteenErrorKind.DisplayYearOutOfRange, KindOf(() => CalendarSystemId.Positivist.GregorianYear(-1788)));
        Assert.Equal(ThirteenErrorKind.DisplayYearOutOfRange, KindOf(() => CalendarSystemId.Positivist.GregorianYear(8212)));
        Assert.Equal(ThirteenErrorKind.DisplayYearOutOfRange, KindOf(() => CalendarSystemId.Ifc.GregorianYear(0)));
        Assert.Equal(ThirteenErrorKind.DisplayYearOutOfRange, KindOf(() => CalendarSystemId.Ifc.GregorianYear(long.MinValue)));
        Assert.Equal(ThirteenErrorKind.DisplayYearOutOfRange, KindOf(() => ThirteenDate.ParseNumeric("-1788-YD", CalendarSystemId.Positivist)));
        Assert.Equal(ThirteenErrorKind.DisplayYearOutOfRange, KindOf(() => ThirteenDate.ParseNumeric("0000-M01-01")));
        Assert.Equal(ThirteenErrorKind.MalformedThirteenNumeric, KindOf(() => ThirteenDate.ParseNumeric("-0000-YD", CalendarSystemId.Positivist)));
        // Positivist year 0 is Gregorian 1788, a leap year: All the Dead is 30 December, IFC December 28.
        var allTheDead1788 = ThirteenDate.ParseNumeric("0000-YD", CalendarSystemId.Positivist);
        Assert.Equal(new GregorianDate(1788, 12, 30), allTheDead1788.Gregorian);
        Assert.Equal("December 28, 1788", allTheDead1788.ConvertTo(CalendarSystemId.Ifc).Format());
        Assert.Equal("0000", ThirteenFormat.NumericYear(0));
        Assert.Equal("-1787", ThirteenFormat.NumericYear(-1787));
        Assert.Equal("0238", ThirteenFormat.NumericYear(238));
    }

    [Fact]
    public void PositivistHolyWomen_CountsToNextYearsAllTheDead()
    {
        // 9996 is the last leap year in range; 9999 itself is common, so year + 1 never leaves the range.
        Assert.Equal(365, new GregorianDate(9996, 12, 31).DaysUntilYearDay(CalendarSystemId.Positivist));
        Assert.Equal(0, new GregorianDate(9996, 12, 30).DaysUntilYearDay(CalendarSystemId.Positivist));
        Assert.Equal(0, new GregorianDate(9996, 12, 31).DaysUntilYearDay());
        Assert.Equal(new ThirteenIntercalaryDate(9996, IntercalaryDayId.LeapDay, CalendarSystemId.Positivist),
            new GregorianDate(9996, 12, 31).ToThirteen(CalendarSystemId.Positivist));
    }

    // ---- Validation --------------------------------------------------------------------------

    [Fact]
    public void Constructors_Validate_InSpecOrder()
    {
        Assert.Equal(ThirteenErrorKind.YearOutOfRange, KindOf(() => _ = new GregorianDate(0, 1, 1)));
        Assert.Equal(ThirteenErrorKind.YearOutOfRange, KindOf(() => _ = new GregorianDate(10000, 13, 40)));
        Assert.Equal(ThirteenErrorKind.InvalidGregorianMonth, KindOf(() => _ = new GregorianDate(2026, 13, 1)));
        Assert.Equal(ThirteenErrorKind.InvalidGregorianDay, KindOf(() => _ = new GregorianDate(2023, 2, 29)));
        Assert.Equal(ThirteenErrorKind.InvalidGregorianDay, KindOf(() => _ = new GregorianDate(1900, 2, 29)));
        Assert.Equal(29, new GregorianDate(2000, 2, 29).Day);
        Assert.Equal(ThirteenErrorKind.DayOfYearOutOfRange, KindOf(() => GregorianDate.FromDayOfYear(2023, 366)));
        Assert.Equal(ThirteenErrorKind.DayOfYearOutOfRange, KindOf(() => ThirteenDate.FromDayOfYear(2024, 0)));
        Assert.Equal(ThirteenErrorKind.YearOutOfRange, KindOf(() => _ = new ThirteenMonthDate(0, 14, 29)));
        Assert.Equal(ThirteenErrorKind.InvalidThirteenMonth, KindOf(() => _ = new ThirteenMonthDate(2026, 14, 29)));
        Assert.Equal(ThirteenErrorKind.InvalidThirteenDay, KindOf(() => _ = new ThirteenMonthDate(2026, 13, 29)));
        Assert.Equal(ThirteenErrorKind.IntercalaryDayNotInYear, KindOf(() => _ = new ThirteenIntercalaryDate(2023, IntercalaryDayId.LeapDay)));
        Assert.Equal(ThirteenErrorKind.IntercalaryDayNotInYear, KindOf(() => _ = new ThirteenIntercalaryDate(2100, IntercalaryDayId.LeapDay, CalendarSystemId.Positivist)));
        Assert.Equal(ThirteenErrorKind.InvalidThirteenDay, KindOf(() => CalendarSystemId.Ifc.FixedWeekday(29)));
        Assert.Equal(ThirteenErrorKind.InvalidThirteenMonth, KindOf(() => CalendarSystemId.Ifc.MonthInfo(0)));
        Assert.Equal(ThirteenErrorKind.InvalidGregorianMonth, KindOf(() => GregorianDate.MonthName(0)));
        Assert.Equal(ThirteenErrorKind.YearOutOfRange, KindOf(() => GregorianDate.IsLeapYear(0)));
        Assert.Equal(ThirteenErrorKind.YearOutOfRange, KindOf(() => _ = new ThirteenYearLayout(10000)));
        Assert.Equal(ThirteenErrorKind.InvalidGregorianMonth, KindOf(() => _ = new GregorianMonthLayout(2026, 0)));
        Assert.Equal(ThirteenErrorKind.InvalidWeekday, KindOf(() => _ = new GregorianMonthLayout(2026, 1, CalendarSystemId.Ifc, (Weekday)7)));
        Assert.Equal(ThirteenErrorKind.UnknownIdentifier, KindOf(() => CalendarSystemIdExtensions.Parse("gregorian")));
        Assert.Equal(ThirteenErrorKind.UnknownIdentifier, KindOf(() => ((CalendarSystemId)5).Definition()));
    }

    [Theory]
    [InlineData("2026-1-01")]
    [InlineData(" 2026-10-19")]
    [InlineData("2026-10-19 ")]
    [InlineData("2026-10-19T00:00")]
    [InlineData("+2026-10-19")]
    [InlineData("20261019")]
    [InlineData("2026/10/19")]
    [InlineData("２０２６-10-19")]
    [InlineData("")]
    public void ParseIso_RejectsMalformedText(string text)
    {
        Assert.Equal(ThirteenErrorKind.MalformedIsoDate, KindOf(() => GregorianDate.ParseIso(text)));
        Assert.False(GregorianDate.TryParseIso(text, out _));
    }

    [Fact]
    public void ParseIso_ReportsImpossibleDatesAsValidationErrors()
    {
        Assert.Equal(ThirteenErrorKind.InvalidGregorianDay, KindOf(() => GregorianDate.ParseIso("2023-02-29")));
        Assert.Equal(ThirteenErrorKind.YearOutOfRange, KindOf(() => GregorianDate.ParseIso("0000-01-01")));
        Assert.False(GregorianDate.TryParseIso("2023-02-29", out _));
        Assert.True(GregorianDate.TryParseIso("0001-01-01", out var first));
        Assert.Equal(First, first);
        Assert.Equal(Last, GregorianDate.ParseIso("9999-12-31"));
        Assert.False(GregorianDate.TryParseIso(null, out _));
    }

    [Theory]
    [InlineData("2026-m11-12")]
    [InlineData("2026-M11-12 ")]
    [InlineData("2026-M1-12")]
    [InlineData("2026-yd")]
    [InlineData("26-YD")]
    [InlineData("2026-10-19")]
    [InlineData("2026-W43-1")]
    [InlineData("-0000-YD")]
    public void ParseNumeric_RejectsMalformedText(string text)
    {
        Assert.Equal(ThirteenErrorKind.MalformedThirteenNumeric, KindOf(() => ThirteenDate.ParseNumeric(text)));
        Assert.False(ThirteenDate.TryParseNumeric(text, CalendarSystemId.Ifc, out _));
        Assert.False(GregorianDate.TryParseIso("2026-M11-12", out _));
    }

    // ---- SPEC 2 anchor table -----------------------------------------------------------------

    [Theory]
    //          Gregorian     IFC long                IFC wd  Greg wd  Positivist long
    [InlineData("2026-10-19", "October 12, 2026", 4, 1, "Descartes 12, 238")]
    [InlineData("2026-01-01", "January 1, 2026", 0, 4, "Moses 1, 238")]
    [InlineData("2026-01-29", "February 1, 2026", 0, 4, "Homer 1, 238")]
    [InlineData("2026-02-28", "March 3, 2026", 2, 6, "Aristotle 3, 238")]
    [InlineData("2026-06-18", "Sol 1, 2026", 0, 4, "Charlemagne 1, 238")]
    [InlineData("2026-12-30", "December 28, 2026", 6, 3, "Bichat 28, 238")]
    [InlineData("2026-12-31", "Year Day 2026", -1, 4, "Festival of All the Dead 238")]
    [InlineData("2024-06-17", "Leap Day 2024", -1, 1, "Charlemagne 1, 236")]
    [InlineData("2024-06-18", "Sol 1, 2024", 0, 2, "Charlemagne 2, 236")]
    [InlineData("2024-02-29", "March 4, 2024", 3, 4, "Aristotle 4, 236")]
    [InlineData("2024-12-30", "December 28, 2024", 6, 1, "Festival of All the Dead 236")]
    [InlineData("2024-12-31", "Year Day 2024", -1, 2, "Festival of Holy Women 236")]
    [InlineData("2023-01-01", "January 1, 2023", 0, 0, "Moses 1, 235")]
    [InlineData("1900-03-01", "March 4, 1900", 3, 4, "Aristotle 4, 112")]
    [InlineData("2000-06-17", "Leap Day 2000", -1, 6, "Charlemagne 1, 212")]
    public void AnchorTable(string iso, string ifcLong, int ifcWeekday, int gregorianWeekday, string positivistLong)
    {
        var g = GregorianDate.ParseIso(iso);
        var ifc = g.ToThirteen();
        Assert.Equal(ifcLong, ifc.Format());
        Assert.Equal(ifcWeekday < 0 ? null : (Weekday)ifcWeekday, ifc.Weekday);
        Assert.Equal((Weekday)gregorianWeekday, g.Weekday);
        Assert.Equal(positivistLong, g.ToThirteen(CalendarSystemId.Positivist).Format());
        Assert.Equal(g, ifc.Gregorian);
    }

    [Fact]
    public void Today_2026_10_19_MatchesTheSpecExample()
    {
        var c = new Comparison(new GregorianDate(2026, 10, 19));
        Assert.Equal(new ThirteenMonthDate(2026, 11, 12), c.Thirteen);
        Assert.Equal(3, c.WeekdayShift);
        Assert.Equal(7, c.LabelDrift);
        Assert.Equal(291.0 / 365.0, c.YearProgress);
        Assert.Equal(73, new GregorianDate(2026, 10, 19).DaysUntilYearDay());
        Assert.Equal("Thursday, October 12, 2026", c.Thirteen.Format(new FormatOptions(IncludeWeekday: true)));
        Assert.Equal("2026-M11-12 (ifc)", c.Thirteen.ToString());
        Assert.Equal("2026-10-19", new GregorianDate(2026, 10, 19).ToString());
    }

    // ---- SPEC 1.5 time zones -----------------------------------------------------------------

    // Windows reads its zones from the registry, which has fewer historical rules than the IANA data
    // on macOS and Linux (docs/events-verification/windows.md, W1 re-check). There these days exist,
    // and the registry rule puts São Paulo's 2018 change at 23:59:59.999, so its first instant is 1 ms early.
    private static readonly HashSet<string> WindowsHasNoSkippedDay = ["Pacific/Apia 2011-12-30", "Pacific/Kiritimati 1994-12-31", "Pacific/Kwajalein 1993-08-21"];
    private static readonly HashSet<string> WindowsOneMillisecondEarly = ["America/Sao_Paulo 2018-11-04"];

    [Theory]
    [InlineData("America/Sao_Paulo", "2018-11-04", "2018-11-04T01:00:00-02:00")]
    [InlineData("America/Havana", "2024-03-10", "2024-03-10T01:00:00-04:00")]
    [InlineData("Europe/Tallinn", "2026-10-19", "2026-10-19T00:00:00+03:00")]
    [InlineData("UTC", "0001-01-01", "0001-01-01T00:00:00+00:00")]
    [InlineData("UTC", "9999-12-31", "9999-12-31T00:00:00+00:00")]
    [InlineData("America/New_York", "9999-12-31", "9999-12-31T00:00:00-05:00")]
    public void FirstInstant_IsLocalMidnight_OrTheFirstExistingTime(string zoneId, string iso, string expected)
    {
        var zone = TimeZoneInfo.FindSystemTimeZoneById(zoneId);
        var first = GregorianDate.ParseIso(iso).FirstInstant(zone);
        Assert.NotNull(first);
        var want = DateTimeOffset.Parse(expected, System.Globalization.CultureInfo.InvariantCulture);
        if (OperatingSystem.IsWindows() && WindowsOneMillisecondEarly.Contains($"{zoneId} {iso}"))
        {
            Assert.Equal(want.AddMilliseconds(-1), first.Value);
        }
        else
        {
            Assert.Equal(want, first.Value);
            Assert.Equal(expected, first.Value.ToString("yyyy-MM-dd'T'HH:mm:sszzz", System.Globalization.CultureInfo.InvariantCulture));
        }
        Assert.Equal(GregorianDate.ParseIso(iso), GregorianDate.FromInstant(first.Value, zone));
        // One tick earlier is the previous local day.
        if (first.Value.UtcTicks > 0)
            Assert.NotEqual(GregorianDate.ParseIso(iso), GregorianDate.FromInstant(first.Value.AddTicks(-1), zone));
    }

    [Theory]
    [InlineData("Pacific/Apia", "2011-12-30")]
    [InlineData("Pacific/Kiritimati", "1994-12-31")]
    [InlineData("Pacific/Kwajalein", "1993-08-21")]
    public void FirstInstant_IsNull_WhenTheZoneSkippedTheWholeDay(string zoneId, string iso)
    {
        var zone = TimeZoneInfo.FindSystemTimeZoneById(zoneId);
        var date = GregorianDate.ParseIso(iso);
        if (OperatingSystem.IsWindows() && WindowsHasNoSkippedDay.Contains($"{zoneId} {iso}"))
        {
            // The day exists in the registry zone: its first instant must belong to it.
            var first = date.FirstInstant(zone);
            Assert.NotNull(first);
            Assert.Equal(date, GregorianDate.FromInstant(first.Value, zone));
            return;
        }
        Assert.Null(date.FirstInstant(zone));
        Assert.NotNull(date.AddDays(-1).FirstInstant(zone));
        Assert.NotNull(date.AddDays(1).FirstInstant(zone));
    }

    [Fact]
    public void Today_UsesTheGivenZone()
    {
        var utc = GregorianDate.Today(TimeZoneInfo.Utc);
        Assert.InRange(GregorianDate.FromDateOnly(DateOnly.FromDateTime(DateTime.UtcNow)).DaysSince(utc), 0, 1);
        var local = GregorianDate.Today();
        Assert.InRange(Math.Abs(local.DaysSince(utc)), 0, 1);
    }

    // ---- JSON --------------------------------------------------------------------------------

    [Fact]
    public void Json_RoundTripsDates_AndRejectsInvalidOnes()
    {
        var g = new GregorianDate(2026, 10, 19);
        Assert.Equal("{\"year\":2026,\"month\":10,\"day\":19}", ThirteenJson.Serialize(g));
        Assert.Equal(g, ThirteenJson.Deserialize<GregorianDate>(ThirteenJson.Serialize(g)));
        ThirteenDate month = new ThirteenMonthDate(2026, 11, 12, CalendarSystemId.Positivist);
        Assert.Equal("{\"kind\":\"month\",\"system\":\"positivist\",\"year\":2026,\"month\":11,\"day\":12}", ThirteenJson.Serialize(month));
        Assert.Equal(month, ThirteenJson.Deserialize<ThirteenDate>(ThirteenJson.Serialize(month)));
        ThirteenDate leap = new ThirteenIntercalaryDate(2024, IntercalaryDayId.LeapDay);
        Assert.Equal("{\"kind\":\"intercalary\",\"system\":\"ifc\",\"year\":2024,\"id\":\"leap-day\"}", ThirteenJson.Serialize(leap));
        Assert.Equal(leap, ThirteenJson.Deserialize<ThirteenIntercalaryDate>(ThirteenJson.Serialize(leap)));

        Assert.Throws<JsonException>(() => ThirteenJson.Deserialize<GregorianDate>("{\"year\":2023,\"month\":2,\"day\":29}"));
        Assert.Throws<JsonException>(() => ThirteenJson.Deserialize<ThirteenDate>("{\"kind\":\"month\",\"system\":\"ifc\",\"year\":2026,\"month\":14,\"day\":1}"));
        Assert.Throws<JsonException>(() => ThirteenJson.Deserialize<ThirteenDate>("{\"kind\":\"intercalary\",\"system\":\"ifc\",\"year\":2023,\"id\":\"leap-day\"}"));
        Assert.Throws<JsonException>(() => ThirteenJson.Deserialize<ThirteenDate>("{\"kind\":\"week\",\"system\":\"ifc\",\"year\":2023}"));
        Assert.Throws<JsonException>(() => ThirteenJson.Deserialize<FormatOptions>("{\"style\":\"long\",\"locale\":\"en\"}"));
        Assert.Throws<JsonException>(() => ThirteenJson.Deserialize<FormatOptions>("{\"includeYear\":null}"));
        Assert.Throws<JsonException>(() => ThirteenJson.Deserialize<ThirteenMonthDate>(ThirteenJson.Serialize(leap)));
    }

    [Fact]
    public void Ordering_IsChronological_WithIfcFirstOnTheSameDay()
    {
        var a = new GregorianDate(2026, 10, 19);
        var ifc = a.ToThirteen();
        var positivist = a.ToThirteen(CalendarSystemId.Positivist);
        Assert.Equal(0, ifc.CompareChronologically(positivist));
        Assert.True(ifc < positivist);
        Assert.True(ifc < a.AddDays(1).ToThirteen());
        Assert.True(a < a.AddDays(1));
        Assert.NotEqual(ifc, positivist);
        Assert.Equal(new ThirteenMonthDate(2026, 11, 12), ifc);
        Assert.Equal(new ThirteenMonthDate(2026, 11, 12).GetHashCode(), ifc.GetHashCode());
    }
}
