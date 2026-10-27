using System.ComponentModel;
using System.Globalization;
using Thirteen.Core;
using Thirteen.Desktop.Support;

namespace Thirteen.Desktop.ViewModels;

/// <summary>How a calendar is tinted: the Gregorian foil, the selected system's accent, or plain ink.</summary>
public enum CalendarTint
{
    /// <summary>The Gregorian calendar.</summary>
    Foil,

    /// <summary>The selected 13-month system.</summary>
    Accent,

    /// <summary>The other 13-month system.</summary>
    Ink,
}

/// <summary>One timeline entry.</summary>
public sealed record TimelineEvent(string Year, string Calendar, string Text, CalendarTint Tint, bool IsLast)
{
    /// <summary>Foil tint.</summary>
    public bool IsFoil => Tint == CalendarTint.Foil;

    /// <summary>Accent tint.</summary>
    public bool IsAccent => Tint == CalendarTint.Accent;

    /// <summary>Plain ink tint.</summary>
    public bool IsInk => Tint == CalendarTint.Ink;

    /// <summary>Whether a rule continues below the dot.</summary>
    public bool HasRule => !IsLast;

    /// <summary>"1582, Gregorian: ...".</summary>
    public string AutomationName => $"{Year}, {Calendar}: {Text}";
}

/// <summary>A calendar's summary card.</summary>
public sealed record CalendarStory(string Name, string Origin, string Summary, CalendarTint Tint, bool IsSelected)
{
    /// <summary>Foil tint.</summary>
    public bool IsFoil => Tint == CalendarTint.Foil;

    /// <summary>Accent tint.</summary>
    public bool IsAccent => Tint == CalendarTint.Accent;

    /// <summary>Plain ink tint.</summary>
    public bool IsInk => Tint == CalendarTint.Ink;

    /// <summary>The card for screen readers.</summary>
    public string AutomationName => $"{Name}{(IsSelected ? ", selected" : "")}. {Origin}. {Summary}";
}

/// <summary>
/// History: the three calendars' summaries and one merged, chronological timeline built from the
/// descriptors' history (SPEC 3.2). Engine text passes through <see cref="DisplayText.WithoutDashes"/>.
/// </summary>
public sealed class HistoryViewModel : PageViewModel
{
    private IReadOnlyList<TimelineEvent> _events = [];
    private IReadOnlyList<CalendarStory> _stories = [];

    /// <summary>Creates the page.</summary>
    public HistoryViewModel(MainViewModel shell) : base(shell, AppSection.History)
    {
        Build();
        State.PropertyChanged += OnStateChanged;
    }

    /// <inheritdoc />
    public override double ContentMaxWidth => 960;

    /// <summary>The opening line.</summary>
    public string Intro => "Three answers to one question: how to divide a solar year of 365¼ days into months and weeks.";

    /// <summary>Every event, oldest first (ties keep the order Gregorian, IFC, Positivist).</summary>
    public IReadOnlyList<TimelineEvent> Events
    {
        get => _events;
        private set => SetProperty(ref _events, value);
    }

    /// <summary>Gregorian, IFC, Positivist.</summary>
    public IReadOnlyList<CalendarStory> Stories
    {
        get => _stories;
        private set => SetProperty(ref _stories, value);
    }

    private void OnStateChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(AppState.System)) Build();
    }

    private void Build()
    {
        var selected = State.System;
        CalendarTint Tint(CalendarSystemId id) => id == selected ? CalendarTint.Accent : CalendarTint.Ink;
        var descriptors = new (ICalendarDescriptor Descriptor, CalendarTint Tint, bool Selected)[]
        {
            (GregorianCalendarInfo.Gregorian, CalendarTint.Foil, false),
            (CalendarSystem.Ifc, Tint(CalendarSystemId.Ifc), selected == CalendarSystemId.Ifc),
            (CalendarSystem.Positivist, Tint(CalendarSystemId.Positivist), selected == CalendarSystemId.Positivist),
        };
        var all = descriptors
            .SelectMany((d, order) => d.Descriptor.History.Select(e => (Order: order, e.Year, Text: DisplayText.WithoutDashes(e.Text), d.Descriptor.ShortName, d.Tint)))
            .OrderBy(e => e.Year).ThenBy(e => e.Order)
            .ToArray();
        Events = all.Select((e, i) => new TimelineEvent(e.Year.ToString(CultureInfo.InvariantCulture), e.ShortName.ToUpperInvariant(), e.Text, e.Tint, i == all.Length - 1)).ToArray();
        Stories = descriptors.Select(d => new CalendarStory(
            DisplayText.WithoutDashes(d.Descriptor.Name),
            $"{DisplayText.WithoutDashes(d.Descriptor.Inventor)} · {d.Descriptor.ProposedYear.ToString(CultureInfo.InvariantCulture)}",
            DisplayText.WithoutDashes(d.Descriptor.Summary),
            d.Tint,
            d.Selected)).ToArray();
    }
}
