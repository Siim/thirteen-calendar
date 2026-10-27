using System.Text.Json;
using System.Text.Json.Nodes;
using Thirteen.Core.Json;
using Thirteen.Core.Tests.Support;
using Xunit.Abstractions;

namespace Thirteen.Core.Tests;

/// <summary>
/// Golden parity with @thirteen/core: every section of fixtures/conversions.json (version 2).
/// Sections that hold the exact JSON of a core result are compared with the C# result serialised by
/// <see cref="ThirteenJson"/>: same keys in the same order, explicit nulls, same numbers and strings.
/// Section sizes are asserted, so a truncated fixture cannot pass, and nothing is ever skipped.
/// </summary>
public sealed class FixtureParityTests(ITestOutputHelper output)
{
    /// <summary>The number of golden conversion cases documented in fixtures/README.md.</summary>
    public const int ExpectedCaseCount = 1620;

    /// <summary>One row per fixture case: index plus a readable label.</summary>
    public static IEnumerable<object[]> CaseRows() =>
        Fixture.Array("cases").Select((c, i) => new object[]
        {
            i, $"{c.GetProperty("gregorian").GetString()} {c.GetProperty("thirteen").GetProperty("system").GetString()}",
        });

    // ---- Envelope ----------------------------------------------------------------------------

    [Fact]
    public void Envelope_HasVersion2_AllSections_AndDocumentedSizes()
    {
        var root = Fixture.Root;
        Assert.Equal(2, root.GetProperty("version").GetInt32());
        Assert.Equal("@thirteen/core", root.GetProperty("generatedBy").GetString());
        Assert.Equal("docs/SPEC.md", root.GetProperty("spec").GetString());
        Assert.Equal(
            ["version", "generatedBy", "spec", "systems", "gregorianCalendar", "cases", "comparisons", "formats", "numericParsing",
             "yearStats", "monthAlignments", "thirteenYearLayouts", "gregorianMonthLayouts", "slots", "labelLookups", "notableDates", "arithmetic"],
            root.EnumerateObject().Select(p => p.Name).ToArray());

        Assert.Equal(ExpectedCaseCount, Fixture.Array("cases").Length);
        Assert.Equal(68, Fixture.Array("comparisons").Length);
        Assert.Equal(21, Fixture.Array("formats", "options").Length);
        Assert.Equal(44, Fixture.Array("formats", "thirteen").Length);
        Assert.Equal(19, Fixture.Array("formats", "gregorian").Length);
        Assert.Equal(39, Fixture.Array("numericParsing").Length);
        Assert.Equal(14, Fixture.Array("yearStats").Length);
        Assert.Equal(4, Fixture.Array("monthAlignments").Length);
        Assert.Equal(4, Fixture.Array("thirteenYearLayouts").Length);
        Assert.Equal(96, Fixture.Array("gregorianMonthLayouts").Length);
        Assert.Equal(4, Fixture.Array("slots").Length);
        Assert.Equal(24, Fixture.Array("labelLookups", "gregorian").Length);
        Assert.Equal(13, Fixture.Array("labelLookups", "thirteen").Length);
        Assert.Equal(4, Fixture.Array("notableDates").Length);
        Assert.Equal(16, Fixture.Array("arithmetic", "addDays").Length);
        Assert.Equal(10, Fixture.Array("arithmetic", "addMonths").Length);
        Assert.Equal(6, Fixture.Array("arithmetic", "sameSlotInYear").Length);
        output.WriteLine($"Fixture {Fixture.Path}: {Fixture.Array("cases").Length} conversion cases");
    }

    [Fact]
    public void CaseRows_CoverEveryFixtureCase()
    {
        // The per-case theory below is fed by CaseRows; prove it enumerates the whole section.
        Assert.Equal(ExpectedCaseCount, CaseRows().Count());
        Assert.Equal(Enumerable.Range(0, ExpectedCaseCount), CaseRows().Select(r => (int)r[0]));
    }

    // ---- Systems -----------------------------------------------------------------------------

    [Fact]
    public void Systems_MatchCalendarSystemsVerbatim_PlusDisplayYearRange()
    {
        var raw = Fixture.Array("systems");
        Assert.Equal(CalendarSystem.All.Count, raw.Length);
        Assert.Equal([CalendarSystemId.Ifc, CalendarSystemId.Positivist], CalendarSystemIdExtensions.All);
        Assert.Equal(CalendarSystemId.Ifc, CalendarSystem.DefaultId);
        var m = new Mismatches();
        for (var i = 0; i < raw.Length; i++)
        {
            var system = CalendarSystem.All[i];
            m.Check(ReferenceEquals(system.Id.Definition(), system), $"{system.Id}: Definition() is not the shared instance");
            m.Check(ReferenceEquals(CalendarSystem.Get(system.Id), system), $"{system.Id}: Get() is not the shared instance");
            var node = (JsonObject)JsonCompare.ToNode(system);
            node["displayYearRange"] = JsonCompare.ToNode(system.Id.DisplayYearRange());
            m.Json(node, raw[i], system.Id.RawValue());
        }
        m.AssertNone("systems");
    }

    [Fact]
    public void GregorianCalendar_MatchesDescriptorVerbatim()
    {
        // The engine data is byte-identical to @thirteen/core, ThirteenKit and the Kotlin port; the copy
        // rule is also applied at display time (DisplayTextTests).
        Assert.Null(JsonCompare.FirstDifference(JsonCompare.ToNode(GregorianCalendarInfo.Gregorian), Fixture.Section("gregorianCalendar")));
        Assert.Same(GregorianMonthInfo.All, GregorianCalendarInfo.Gregorian.Months);
    }

    [Fact]
    public void DescriptorText_ThroughDisplayText_HasNoDashes_AndReadsLikeTheAppleApps()
    {
        // The fixture's descriptor text has no en or em dash at all.
        var text = File.ReadAllText(Fixture.Path);
        Assert.Equal(0, text.Count(c => c == '\u2013'));
        Assert.Equal(0, text.Count(c => c == '\u2014'));

        var descriptors = CalendarSystem.All.Cast<ICalendarDescriptor>().Append(GregorianCalendarInfo.Gregorian).ToArray();
        var shown = descriptors.SelectMany(d => new[] { d.Name, d.ShortName, d.Inventor, d.Summary }.Concat(d.History.Select(h => h.Text)))
            .Concat(CalendarSystem.All.SelectMany(s => s.IntercalaryDays.SelectMany(i => new[] { i.Name, i.ShortName, i.Description })))
            .Concat(CalendarSystem.All.SelectMany(s => s.Months.Select(m => m.Meaning ?? "")))
            .Select(DisplayText.WithoutDashes)
            .ToArray();
        Assert.All(shown, s => Assert.True(s.IndexOfAny(['\u2013', '\u2014']) < 0, s));
        Assert.Contains(
            "Great Britain and its colonies adopt the Gregorian calendar, skipping 3 to 13 September.",
            GregorianCalendarInfo.Gregorian.History.Select(h => DisplayText.WithoutDashes(h.Text)));
    }

    // ---- Cases -------------------------------------------------------------------------------

    [Theory]
    [MemberData(nameof(CaseRows))]
    public void Case(int index, string label)
    {
        var c = Fixture.Array("cases")[index];
        var m = new Mismatches();
        CheckCase(c, m);
        m.AssertNone($"case {index} ({label})");
    }

    [Fact]
    public void Cases_AllPassInOneSweep()
    {
        var cases = Fixture.Array("cases");
        Assert.Equal(ExpectedCaseCount, cases.Length);
        var m = new Mismatches();
        foreach (var c in cases) CheckCase(c, m);
        m.AssertNone("cases");
        output.WriteLine($"{cases.Length} fixture cases checked in both directions");
    }

    private static void CheckCase(JsonElement c, Mismatches m)
    {
        var iso = c.GetProperty("gregorian").GetString()!;
        var expected = Fixture.Thirteen(c.GetProperty("thirteen"));
        var system = expected.System;
        var ctx = $"{iso} {system.RawValue()}";
        var gregorian = GregorianDate.ParseIso(iso);
        var dayOfYear = c.GetProperty("dayOfYear").GetInt32();
        var displayYear = c.GetProperty("displayYear").GetInt32();

        // Gregorian -> 13-month -> Gregorian.
        m.Equal(iso, gregorian.ToIsoString(), ctx + " iso");
        m.Equal(expected, ThirteenDate.FromGregorian(gregorian, system), ctx + " FromGregorian");
        m.Equal(expected, gregorian.ToThirteen(system), ctx + " ToThirteen");
        m.Equal(gregorian, expected.Gregorian, ctx + " Gregorian");
        m.Equal(expected, ThirteenDate.FromDayOfYear(gregorian.Year, dayOfYear, system), ctx + " FromDayOfYear");
        var other = system == CalendarSystemId.Ifc ? CalendarSystemId.Positivist : CalendarSystemId.Ifc;
        m.Equal(expected, expected.ConvertTo(other).ConvertTo(system), ctx + " ConvertTo round trip");

        // DateOnly (the BCL calendar) agrees on the date itself.
        var dateOnly = DateOnly.ParseExact(iso, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
        m.Equal(dateOnly, gregorian.ToDateOnly(), ctx + " ToDateOnly");
        m.Equal(dayOfYear, dateOnly.DayOfYear, ctx + " DateOnly.DayOfYear");
        m.Equal(c.GetProperty("gregorianWeekday").GetInt32(), (int)dateOnly.DayOfWeek, ctx + " DateOnly.DayOfWeek");

        // Years, day-of-year, weekdays.
        m.Equal(displayYear, expected.DisplayYear, ctx + " DisplayYear");
        m.Equal(displayYear, system.DisplayYear(gregorian.Year), ctx + " system.DisplayYear");
        m.Equal(gregorian.Year, system.GregorianYear(displayYear), ctx + " system.GregorianYear");
        m.Equal(dayOfYear, gregorian.DayOfYear, ctx + " gregorian.DayOfYear");
        m.Equal(dayOfYear, expected.DayOfYear, ctx + " thirteen.DayOfYear");
        m.Equal(c.GetProperty("isLeapYear").GetBoolean(), gregorian.IsInLeapYear, ctx + " IsInLeapYear");
        m.Equal(c.GetProperty("isLeapYear").GetBoolean(), GregorianDate.IsLeapYear(gregorian.Year), ctx + " IsLeapYear");
        m.Equal(c.GetProperty("gregorianWeekday").GetInt32(), (int)gregorian.Weekday, ctx + " gregorianWeekday");
        m.Equal(Fixture.OptionalInt(c.GetProperty("thirteenWeekday")), (int?)expected.Weekday, ctx + " thirteenWeekday");

        // Comparison fields carried by the case.
        var comparison = new Comparison(gregorian, system);
        m.Equal(expected, comparison.Thirteen, ctx + " comparison.Thirteen");
        m.Equal(Fixture.OptionalInt(c.GetProperty("weekdayShift")), comparison.WeekdayShift, ctx + " weekdayShift");
        m.Equal(Fixture.OptionalInt(c.GetProperty("labelDrift")), comparison.LabelDrift, ctx + " labelDrift");

        // Text, both directions of the numeric form, and the JSON shape of the date.
        var formattedLong = c.GetProperty("formattedLong").GetString();
        m.Equal(formattedLong, expected.Format(), ctx + " Format()");
        m.Equal(formattedLong, expected.Format(FormatOptions.Long), ctx + " Format(Long)");
        m.Equal(expected, ThirteenDate.ParseNumeric(expected.Format(FormatOptions.Numeric), system), ctx + " numeric round trip");
        m.Json(JsonCompare.ToNode(expected), c.GetProperty("thirteen"), ctx + " thirteen JSON");
    }

    // ---- Comparisons -------------------------------------------------------------------------

    [Fact]
    public void Comparisons_MatchExactJson_DisplayYear_AndDaysUntilYearDay()
    {
        var raw = Fixture.Array("comparisons");
        var m = new Mismatches();
        foreach (var e in raw)
        {
            var date = Fixture.Gregorian(e.GetProperty("gregorian"));
            var system = Fixture.Thirteen(e.GetProperty("thirteen")).System;
            var ctx = $"{date} {system.RawValue()}";
            var comparison = new Comparison(date, system);
            m.Equal(comparison, date.Compare(system), ctx + " Compare()");
            m.Equal(e.GetProperty("displayYear").GetInt32(), comparison.Thirteen.DisplayYear, ctx + " displayYear");
            m.Equal(e.GetProperty("daysUntilYearDay").GetInt32(), date.DaysUntilYearDay(system), ctx + " daysUntilYearDay");
            m.Check(
                comparison.DaysIntoYear + 1 + comparison.DaysRemainingInYear == date.LengthOfYear,
                ctx + " daysIntoYear + 1 + daysRemainingInYear != daysInYear");
            var node = (JsonObject)JsonCompare.ToNode(comparison);
            node["displayYear"] = comparison.Thirteen.DisplayYear;
            node["daysUntilYearDay"] = date.DaysUntilYearDay(system);
            m.Json(node, e, ctx);
        }
        m.AssertNone("comparisons");
    }

    // ---- Formats and parsing -----------------------------------------------------------------

    [Fact]
    public void Formats_MatchFormatThirteenAndFormatGregorian_ForAll21OptionBags()
    {
        var rawOptions = Fixture.Array("formats", "options");
        var options = rawOptions.Select(o => ThirteenJson.Deserialize<FormatOptions>(o.GetRawText())).ToArray();
        var m = new Mismatches();
        for (var i = 0; i < options.Length; i++) m.Json(JsonCompare.ToNode(options[i]), rawOptions[i], $"options[{i}]");

        var count = 0;
        foreach (var e in Fixture.Array("formats", "thirteen"))
        {
            var date = Fixture.Thirteen(e.GetProperty("date"));
            var outputs = e.GetProperty("outputs").EnumerateArray().Select(x => x.GetString()).ToArray();
            m.Equal(options.Length, outputs.Length, $"{date} outputs");
            for (var i = 0; i < options.Length; i++, count++)
            {
                m.Equal(outputs[i], date.Format(options[i]), $"{date} options[{i}] {rawOptions[i].GetRawText()}");
                m.Equal(outputs[i], ThirteenFormat.Format(date, options[i]), $"{date} ThirteenFormat options[{i}]");
            }
        }
        foreach (var e in Fixture.Array("formats", "gregorian"))
        {
            var date = Fixture.Gregorian(e.GetProperty("date"));
            var outputs = e.GetProperty("outputs").EnumerateArray().Select(x => x.GetString()).ToArray();
            m.Equal(options.Length, outputs.Length, $"{date} outputs");
            for (var i = 0; i < options.Length; i++, count++)
            {
                m.Equal(outputs[i], date.Format(options[i]), $"{date} options[{i}] {rawOptions[i].GetRawText()}");
            }
        }
        m.AssertNone("formats");
        Assert.Equal(21 * (44 + 19), count);
    }

    [Fact]
    public void NumericParsing_MatchesParseThirteenAndTryParseThirteen()
    {
        var m = new Mismatches();
        foreach (var e in Fixture.Array("numericParsing"))
        {
            var system = Fixture.SystemId(e.GetProperty("system"));
            var text = e.GetProperty("text").GetString()!;
            var expected = Fixture.OptionalThirteen(e.GetProperty("expected"));
            var ctx = $"{system.RawValue()} \"{text}\"";
            var ok = ThirteenDate.TryParseNumeric(text, system, out var parsed);
            m.Equal(expected is not null, ok, ctx + " TryParseNumeric result");
            m.Equal(expected, parsed, ctx + " TryParseNumeric value");
            if (expected is not null)
            {
                m.Equal(expected, ThirteenDate.ParseNumeric(text, system), ctx + " ParseNumeric");
                m.Equal(text, expected.Format(FormatOptions.Numeric), ctx + " exact inverse of the numeric formatter");
                m.Equal(system, expected.System, ctx + " system");
            }
            else
            {
                m.Throws<ThirteenException>(() => ThirteenDate.ParseNumeric(text, system), ctx);
            }
        }
        m.AssertNone("numericParsing");
    }

    // ---- Year stats and alignment ------------------------------------------------------------

    [Fact]
    public void YearStats_MatchExactJson()
    {
        var m = new Mismatches();
        foreach (var e in Fixture.Array("yearStats"))
        {
            var year = e.GetProperty("year").GetInt32();
            var system = Fixture.SystemId(e.GetProperty("system"));
            m.Json(JsonCompare.ToNode(new YearStats(year, system)), e, $"{year} {system.RawValue()}");
        }
        m.AssertNone("yearStats");
    }

    [Fact]
    public void MonthAlignments_MatchExactJson()
    {
        var m = new Mismatches();
        foreach (var e in Fixture.Array("monthAlignments"))
        {
            var year = e.GetProperty("year").GetInt32();
            var system = Fixture.SystemId(e.GetProperty("system"));
            m.Json(JsonCompare.ToNode(new MonthAlignment(year, system)), e, $"{year} {system.RawValue()}");
        }
        m.AssertNone("monthAlignments");
    }

    // ---- Layouts and slots (compact forms) ---------------------------------------------------

    [Fact]
    public void ThirteenYearLayouts_MatchCompactBuildThirteenYear()
    {
        var m = new Mismatches();
        foreach (var e in Fixture.Array("thirteenYearLayouts"))
        {
            var year = e.GetProperty("year").GetInt32();
            var system = Fixture.SystemId(e.GetProperty("system"));
            var layout = new ThirteenYearLayout(year, system);
            var compact = new JsonObject
            {
                ["year"] = layout.Year,
                ["system"] = system.RawValue(),
                ["displayYear"] = layout.DisplayYear,
                ["isLeapYear"] = layout.IsLeapYear,
                ["daysInYear"] = layout.DaysInYear,
                ["weekdays"] = new JsonArray(layout.Weekdays.Select(w => (JsonNode)(int)w).ToArray()),
                ["months"] = new JsonArray(layout.Months.Select(month =>
                {
                    var cells = month.Days.ToArray();
                    m.Equal(28, cells.Length, $"{year} {system.RawValue()} month {month.Month} cells");
                    return (JsonNode)new JsonObject
                    {
                        ["month"] = month.Month,
                        ["first"] = cells[0].Gregorian.ToIsoString(),
                        ["last"] = cells[^1].Gregorian.ToIsoString(),
                        ["gregorianMonthStarts"] = new JsonArray(cells.Where(c => c.IsGregorianMonthStart)
                            .Select(c => (JsonNode)new JsonArray(c.Thirteen.Day, c.Gregorian.Month)).ToArray()),
                    };
                }).ToArray()),
                ["intercalary"] = new JsonArray(layout.Intercalary.Select(o => (JsonNode)new JsonObject
                {
                    ["id"] = o.Id.RawValue(),
                    ["afterMonth"] = o.AfterMonth,
                    ["gregorian"] = o.Gregorian.ToIsoString(),
                    ["dayOfYear"] = o.DayOfYear,
                    ["gregorianWeekday"] = (int)o.GregorianWeekday,
                }).ToArray()),
            };
            m.Json(compact, e, $"{year} {system.RawValue()}");
        }
        m.AssertNone("thirteenYearLayouts");
    }

    [Fact]
    public void GregorianMonthLayouts_MatchCompactBuildGregorianMonth_ForBothWeekStarts()
    {
        var m = new Mismatches();
        foreach (var e in Fixture.Array("gregorianMonthLayouts"))
        {
            var year = e.GetProperty("year").GetInt32();
            var month = e.GetProperty("month").GetInt32();
            var system = Fixture.SystemId(e.GetProperty("system"));
            var weekStartsOn = (Weekday)e.GetProperty("weekStartsOn").GetInt32();
            var layout = new GregorianMonthLayout(year, month, system, weekStartsOn);
            var cells = layout.Days.ToArray();
            var compact = new JsonObject
            {
                ["year"] = layout.Year,
                ["month"] = layout.Month,
                ["system"] = system.RawValue(),
                ["weekStartsOn"] = (int)layout.WeekStartsOn,
                ["leadingBlanks"] = layout.LeadingBlanks,
                ["rows"] = layout.Weeks.Count,
                ["thirteenMonthStarts"] = new JsonArray(cells.Where(c => c.IsThirteenMonthStart).Select(c => (JsonNode)c.Gregorian.Day).ToArray()),
                ["intercalaryDays"] = new JsonArray(cells.Where(c => c.Thirteen.IsIntercalary).Select(c => (JsonNode)c.Gregorian.Day).ToArray()),
            };
            var ctx = $"{year}-{month} {system.RawValue()} weekStartsOn {(int)weekStartsOn}";
            m.Check(layout.Weeks.All(w => w.Count == 7), ctx + " rows of 7");
            m.Equal(GregorianDate.DaysInMonth(year, month), cells.Length, ctx + " day count");
            m.Json(compact, e, ctx);
        }
        m.AssertNone("gregorianMonthLayouts");
    }

    [Fact]
    public void Slots_MatchCompactThirteenSlots()
    {
        var m = new Mismatches();
        foreach (var e in Fixture.Array("slots"))
        {
            var year = e.GetProperty("year").GetInt32();
            var system = Fixture.SystemId(e.GetProperty("system"));
            var slots = ThirteenSlot.InYear(year, system);
            var compact = new JsonObject
            {
                ["year"] = year,
                ["system"] = system.RawValue(),
                ["slots"] = new JsonArray(slots.Select(s => (JsonNode)(s switch
                {
                    ThirteenMonthSlot ms => new JsonObject { ["kind"] = "month", ["month"] = ms.Month },
                    ThirteenIntercalarySlot ins => new JsonObject { ["kind"] = "intercalary", ["id"] = ins.Id.RawValue() },
                    _ => throw new InvalidOperationException(),
                })).ToArray()),
            };
            m.Json(compact, e, $"{year} {system.RawValue()}");
            m.Equal(slots.Count, slots.Select(s => s.Key).Distinct().Count(), $"{year} {system.RawValue()} unique keys");
        }
        m.AssertNone("slots");
    }

    // ---- Lookups, notable dates, arithmetic --------------------------------------------------

    [Fact]
    public void LabelLookups_MatchExactJson()
    {
        var m = new Mismatches();
        foreach (var e in Fixture.Array("labelLookups", "gregorian"))
        {
            var system = Fixture.SystemId(e.GetProperty("system"));
            var date = Fixture.Gregorian(e.GetProperty("gregorian"));
            var lookup = new GregorianLabelLookup(date, system);
            var node = new JsonObject { ["system"] = system.RawValue() };
            foreach (var (key, value) in (JsonObject)JsonCompare.ToNode(lookup)) node[key] = value?.DeepClone();
            m.Equal(date.SameLabel(system), lookup.SameLabel, $"{date} {system.RawValue()} SameLabel");
            m.Json(node, e, $"gregorian {date} {system.RawValue()}");
        }
        foreach (var e in Fixture.Array("labelLookups", "thirteen"))
        {
            var date = Fixture.Thirteen(e.GetProperty("thirteen"));
            var lookup = new ThirteenLabelLookup(date);
            m.Equal(date.SameLabelInGregorian, lookup.SameLabel, $"{date} SameLabelInGregorian");
            m.Json(JsonCompare.ToNode(lookup), e, $"thirteen {date}");
        }
        m.AssertNone("labelLookups");
    }

    [Fact]
    public void NotableDates_MatchCompactNotableDatesInYear()
    {
        var m = new Mismatches();
        foreach (var e in Fixture.Array("notableDates"))
        {
            var year = e.GetProperty("year").GetInt32();
            var system = Fixture.SystemId(e.GetProperty("system"));
            var dates = NotableDateInYear.InYear(year, system);
            m.Check(dates.Select(d => d.Notable).SequenceEqual(NotableDate.All), $"{year} order");
            var compact = new JsonObject
            {
                ["year"] = year,
                ["system"] = system.RawValue(),
                ["dates"] = new JsonArray(dates.Select(d => (JsonNode)new JsonObject
                {
                    ["id"] = d.Notable.Id,
                    ["gregorian"] = JsonCompare.ToNode(d.Gregorian),
                    ["thirteen"] = JsonCompare.ToNode(d.Thirteen),
                    ["sameLabel"] = d.SameLabel is null ? null : JsonCompare.ToNode<ThirteenDate>(d.SameLabel),
                }).ToArray()),
            };
            m.Json(compact, e, $"{year} {system.RawValue()}");
        }
        m.AssertNone("notableDates");
    }

    [Fact]
    public void Arithmetic_MatchesAddDays_AddMonths_SameSlotInYear()
    {
        var m = new Mismatches();
        foreach (var e in Fixture.Array("arithmetic", "addDays"))
        {
            var from = Fixture.Thirteen(e.GetProperty("from"));
            var days = e.GetProperty("days").GetInt64();
            var expected = Fixture.OptionalThirteen(e.GetProperty("expected"));
            var ctx = $"{from} + {days} days";
            if (expected is null) m.Throws<ThirteenException>(() => from.AddDays(days), ctx);
            else m.Equal(expected, from.AddDays(days), ctx);
        }
        foreach (var e in Fixture.Array("arithmetic", "addMonths"))
        {
            var from = Fixture.Thirteen(e.GetProperty("from"));
            var months = e.GetProperty("months").GetInt64();
            var expected = Fixture.OptionalThirteen(e.GetProperty("expected"));
            var ctx = $"{from} + {months} months";
            if (expected is null) m.Throws<ThirteenException>(() => from.AddMonths(months), ctx);
            else m.Equal(expected, from.AddMonths(months), ctx);
        }
        foreach (var e in Fixture.Array("arithmetic", "sameSlotInYear"))
        {
            var from = Fixture.Thirteen(e.GetProperty("from"));
            var year = e.GetProperty("year").GetInt32();
            m.Equal(Fixture.OptionalThirteen(e.GetProperty("expected")), from.SameSlotInYear(year), $"{from} to {year}");
        }
        m.AssertNone("arithmetic");
    }
}
