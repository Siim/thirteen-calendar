using System.Globalization;

namespace Thirteen.Desktop.Support;

/// <summary>The copy of Today's Up next and the day details' Events section (docs/EVENTS.md §2.8, §2.9, catalogue §2.19 <c>today.*</c>), verbatim.</summary>
public static class TodayStrings
{
    /// <summary><c>today.upNext</c></summary>
    public const string UpNext = "Up next";

    /// <summary><c>today.now</c></summary>
    public const string Now = "Now";

    /// <summary><c>calendar.today</c>, the first group's heading.</summary>
    public const string Today = "Today";

    /// <summary><c>today.tomorrow</c></summary>
    public const string Tomorrow = "Tomorrow";

    /// <summary><c>today.showAll</c></summary>
    public const string ShowAll = "Show all in Calendar";

    /// <summary><c>today.moreNext7</c> (plural): "5 more in the next 7 days".</summary>
    public static string MoreNext7(int n) => n == 1 ? "1 more in the next 7 days" : $"{n.ToString(CultureInfo.InvariantCulture)} more in the next 7 days";

    /// <summary><c>today.emptyToday</c></summary>
    public const string EmptyToday = "Nothing else today.";

    /// <summary><c>today.emptyWeek</c></summary>
    public const string EmptyWeek = "No events in the next 7 days.";

    /// <summary><c>event.openInCalendar</c></summary>
    public const string OpenInCalendar = "Open in Calendar";

    /// <summary>The day details' Events heading (the pane's eyebrows are upper case: "DAY DETAILS").</summary>
    public const string EventsHeading = "EVENTS";
}
