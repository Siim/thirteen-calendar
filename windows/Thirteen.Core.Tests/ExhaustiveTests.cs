using Thirteen.Core.Tests.Support;
using Xunit.Abstractions;

namespace Thirteen.Core.Tests;

/// <summary>
/// Every day of 0001-01-01..9999-12-31, in both systems, checked against <see cref="DateOnly"/> (the
/// BCL's own proleptic Gregorian calendar) and against the SPEC 1.1 / 1.2 day-of-year formulas written
/// out independently here, in both directions.
/// </summary>
public sealed class ExhaustiveTests(ITestOutputHelper output)
{
    /// <summary>Days in 0001-01-01..9999-12-31 (DateOnly.MaxValue.DayNumber + 1).</summary>
    public const int DaysInRange = 3_652_059;

    public static TheoryData<CalendarSystemId> Systems => new() { CalendarSystemId.Ifc, CalendarSystemId.Positivist };

    /// <summary>SPEC 1.1 / 1.2 mapping, written from the spec text, not from the engine.</summary>
    private static (int Month, int Day, IntercalaryDayId? Id) SpecMapping(CalendarSystemId system, int year, int dayOfYear)
    {
        var leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
        static (int, int, IntercalaryDayId?) MonthDay(int d) => ((d - 1) / 28 + 1, (d - 1) % 28 + 1, null);
        if (system == CalendarSystemId.Ifc)
        {
            if (!leap) return dayOfYear <= 364 ? MonthDay(dayOfYear) : (0, 0, IntercalaryDayId.YearDay);
            if (dayOfYear <= 168) return MonthDay(dayOfYear);
            if (dayOfYear == 169) return (0, 0, IntercalaryDayId.LeapDay);
            return dayOfYear <= 365 ? MonthDay(dayOfYear - 1) : (0, 0, IntercalaryDayId.YearDay);
        }
        if (dayOfYear <= 364) return MonthDay(dayOfYear);
        return dayOfYear == 365 ? (0, 0, IntercalaryDayId.YearDay) : (0, 0, IntercalaryDayId.LeapDay);
    }

    [Theory]
    [MemberData(nameof(Systems))]
    public void EveryGregorianDay_ConvertsBothWays_AndAgreesWithDateOnly(CalendarSystemId system)
    {
        var m = new Mismatches();
        var weekStartsOn = system == CalendarSystemId.Positivist ? 1 : 0;
        var numeric = FormatOptions.Numeric;
        ThirteenDate? previous = null;
        var count = 0;
        for (var n = DateOnly.MinValue.DayNumber; n <= DateOnly.MaxValue.DayNumber && m.Count < 25; n++, count++)
        {
            var d = DateOnly.FromDayNumber(n);
            // The engine's own JDN arithmetic, checked against the BCL.
            var g = GregorianDate.FromJulianDayNumber(n + GregorianDate.MinJulianDayNumber);
            if (g.Year != d.Year || g.Month != d.Month || g.Day != d.Day || g.DayOfYear != d.DayOfYear
                || g.Weekday.ToDayOfWeek() != d.DayOfWeek || g.JulianDayNumber != n + GregorianDate.MinJulianDayNumber
                || g.ToDateOnly() != d || GregorianDate.FromDateOnly(d) != g || g.LengthOfMonth != DateTime.DaysInMonth(d.Year, d.Month)
                || g.IsInLeapYear != DateTime.IsLeapYear(d.Year))
            {
                m.Check(false, $"{d:yyyy-MM-dd}: Gregorian arithmetic disagrees with DateOnly (got {g})");
                continue;
            }

            var t = ThirteenDate.FromGregorian(g, system);
            var (month, day, id) = SpecMapping(system, d.Year, d.DayOfYear);
            var mappingOk = id is { } expectedId
                ? t is ThirteenIntercalaryDate i && i.Id == expectedId && t.Weekday is null
                : t is ThirteenMonthDate md && md.Month == month && md.Day == day && (int)md.Weekday == (weekStartsOn + day - 1) % 7;
            if (!mappingOk || t.Year != d.Year || t.System != system || t.DayOfYear != d.DayOfYear
                || t.Gregorian != g || t.Gregorian.ToDateOnly() != d
                || !ThirteenDate.ParseNumeric(t.Format(numeric), system).Equals(t)
                || (previous is not null && !previous.AddDays(1).Equals(t)))
            {
                m.Check(false, $"{d:yyyy-MM-dd} {system.RawValue()}: got {t}, SPEC says {(id is null ? $"month {month} day {day}" : id.Value.RawValue())}");
            }
            previous = t;
        }
        m.AssertNone($"every day, {system.RawValue()}");
        Assert.Equal(DaysInRange, count);
        output.WriteLine($"{system.RawValue()}: {count:N0} Gregorian days converted both ways and checked against DateOnly");
    }

    [Theory]
    [MemberData(nameof(Systems))]
    public void EveryThirteenMonthDate_OfEveryYear_LandsOnConsecutiveDateOnlyDays(CalendarSystemId system)
    {
        var m = new Mismatches();
        var total = 0;
        for (var year = GregorianDate.MinYear; year <= GregorianDate.MaxYear && m.Count < 25; year++)
        {
            var leap = DateTime.IsLeapYear(year);
            var jan1 = new DateOnly(year, 1, 1);
            var index = 0;

            void Expect(ThirteenDate t)
            {
                var expected = jan1.AddDays(index++);
                if (t.Gregorian.ToDateOnly() != expected || !ThirteenDate.FromGregorian(GregorianDate.FromDateOnly(expected), system).Equals(t)
                    || t.DayOfYear != expected.DayOfYear)
                {
                    m.Check(false, $"{t}: expected {expected:yyyy-MM-dd}, got {t.Gregorian}");
                }
            }

            // Chronological order from the SPEC: IFC Leap Day after June 28 (month 6); year-end days after
            // month 13, Positivist All the Dead before Holy Women.
            for (var month = 1; month <= 13; month++)
            {
                for (var day = 1; day <= 28; day++) Expect(new ThirteenMonthDate(year, month, day, system));
                if (system == CalendarSystemId.Ifc && month == 6 && leap) Expect(new ThirteenIntercalaryDate(year, IntercalaryDayId.LeapDay, system));
            }
            Expect(new ThirteenIntercalaryDate(year, IntercalaryDayId.YearDay, system));
            if (system == CalendarSystemId.Positivist && leap) Expect(new ThirteenIntercalaryDate(year, IntercalaryDayId.LeapDay, system));

            m.Equal(leap ? 366 : 365, index, $"{year} {system.RawValue()} day count");
            m.Equal(leap, ThirteenIntercalaryDate.IsValid(year, IntercalaryDayId.LeapDay, system), $"{year} leap-day validity");
            total += index;
        }
        m.AssertNone($"every 13-month date, {system.RawValue()}");
        Assert.Equal(DaysInRange, total);
        output.WriteLine($"{system.RawValue()}: {total:N0} 13-month dates mapped to consecutive DateOnly days");
    }

    [Fact]
    public void Invariants_HoldInEveryYear()
    {
        var m = new Mismatches();
        for (var year = 1; year <= 9999; year++)
        {
            // IFC Sol 1 = 18 June, IFC December 1 = 3 December, Year Day = 31 December, every year (SPEC 2).
            m.Equal(new GregorianDate(year, 6, 18), new ThirteenMonthDate(year, 7, 1).Gregorian, $"{year} Sol 1");
            m.Equal(new GregorianDate(year, 12, 3), new ThirteenMonthDate(year, 13, 1).Gregorian, $"{year} December 1");
            m.Equal(new GregorianDate(year, 12, 31), new ThirteenIntercalaryDate(year, IntercalaryDayId.YearDay).Gregorian, $"{year} Year Day");
            if (DateTime.IsLeapYear(year))
            {
                m.Equal(new GregorianDate(year, 6, 17), new ThirteenIntercalaryDate(year, IntercalaryDayId.LeapDay).Gregorian, $"{year} Leap Day");
                m.Equal(new GregorianDate(year, 12, 31), new ThirteenIntercalaryDate(year, IntercalaryDayId.LeapDay, CalendarSystemId.Positivist).Gregorian, $"{year} Holy Women");
            }
        }
        // In 2023 every IFC fixed weekday equals the real weekday.
        for (var doy = 1; doy <= 364; doy++)
        {
            var g = GregorianDate.FromDayOfYear(2023, doy);
            m.Equal(0, new Comparison(g).WeekdayShift ?? -1, $"{g} weekdayShift");
        }
        m.AssertNone("invariants");
    }
}
