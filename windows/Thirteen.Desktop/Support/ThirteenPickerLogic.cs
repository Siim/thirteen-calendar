using System.Globalization;
using Thirteen.Core;

namespace Thirteen.Desktop.Support;

/// <summary>
/// The 13-month side of the converter: reads the converter's Gregorian day as (display year, slot,
/// month day) and turns each edit back into a Gregorian day. A port of the Apple apps'
/// <c>ThirteenPickerLogic</c>.
/// </summary>
public readonly record struct ThirteenPickerLogic(CalendarSystemId System, GregorianDate Day)
{
    /// <summary>The converter's day in the system.</summary>
    public ThirteenDate Thirteen => Day.ToThirteen(System);

    /// <summary>The system's year number (238 for Positivist 2026).</summary>
    public int DisplayYear => Thirteen.DisplayYear;

    /// <summary>The selectable positions of the year: 13 months plus the intercalary day(s) in place.</summary>
    public IReadOnlyList<ThirteenSlot> Slots => ThirteenSlot.InYear(Day.Year, System);

    /// <summary>The key of the slot holding the day ("month-11", "year-day"), matching <see cref="ThirteenSlot.Key"/>.</summary>
    public string SlotKey => Thirteen switch
    {
        ThirteenMonthDate date => "month-" + date.Month.ToString(CultureInfo.InvariantCulture),
        ThirteenIntercalaryDate date => date.Id.RawValue(),
        _ => "",
    };

    /// <summary>The day of the month (1..28), or null on an intercalary day.</summary>
    public int? MonthDay => Thirteen.MonthDate?.Day;

    /// <summary>
    /// Moves to the same slot in another display year. A leap-only day that does not exist in the target
    /// year (IFC Leap Day, Festival of Holy Women) falls back to the day before it (June 28 / Festival of
    /// All the Dead). Out-of-range years leave the day unchanged.
    /// </summary>
    public GregorianDate SettingDisplayYear(int displayYear)
    {
        int year;
        try
        {
            year = System.GregorianYear(displayYear);
        }
        catch (ThirteenException)
        {
            return Day;
        }
        if (Thirteen.SameSlotInYear(year) is { } same) return same.Gregorian;
        try
        {
            if (Thirteen.AddDays(-1).SameSlotInYear(year) is { } moved) return moved.Gregorian;
        }
        catch (ThirteenException)
        {
            // 1 January of year 1 has no day before it.
        }
        return new GregorianDate(year, 1, 1);
    }

    /// <summary>Moves to another slot of the same year, keeping the month day (day 1 when coming from an intercalary day).</summary>
    public GregorianDate SettingSlot(string key)
    {
        foreach (var slot in Slots)
        {
            if (slot.Key != key) continue;
            return slot switch
            {
                ThirteenMonthSlot month => new ThirteenMonthDate(Day.Year, month.Month, MonthDay ?? 1, System).Gregorian,
                ThirteenIntercalarySlot intercalary => intercalary.Occurrence.Gregorian,
                _ => Day,
            };
        }
        return Day;
    }

    /// <summary>Moves to another day (1..28) of the current month; no change on intercalary days.</summary>
    public GregorianDate SettingMonthDay(int monthDay)
    {
        if (Thirteen.MonthDate is not { } date || monthDay is < 1 or > ThirteenDate.DaysPerMonth) return Day;
        return new ThirteenMonthDate(date.Year, date.Month, monthDay, System).Gregorian;
    }

    /// <summary>Menu label of a slot: the month name, or the intercalary day's name.</summary>
    public static string Label(ThirteenSlot slot) => slot switch
    {
        ThirteenMonthSlot month => month.MonthInfo.Name,
        ThirteenIntercalarySlot intercalary => intercalary.Occurrence.Name,
        _ => "",
    };
}
