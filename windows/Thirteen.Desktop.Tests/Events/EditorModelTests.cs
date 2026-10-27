using Thirteen.Core;
using Thirteen.Core.Events;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.Support;
using Thirteen.Desktop.ViewModels.Events;

namespace Thirteen.Desktop.Tests.Events;

/// <summary>
/// The editor's model (docs/EVENTS.md §2.11 to §2.14; task W7) over the mockup data set: defaults, all-day with Free,
/// midnight ends, validation with focus and announcements (out of range included), the repeat adaptation notices, the
/// later-events and retime notices, the span question with its losses lines, the discard question on every closing
/// path, the 13-month date field (typed dates, the 1583 floor) and its picker (leap-year stepping, the keyboard), the
/// repeat picker, Custom and the alert pickers. No user-visible text has an en or em dash.
/// </summary>
public class EditorModelTests
{
    private static readonly GregorianDate October19 = new(2026, 10, 19);

    private static async Task<(EditorFixture F, EventEditorViewModel Editor)> NewAsync(int? start = 600, int? end = 660, string day = "2026-10-19")
    {
        var f = await EditorFixture.CreateAsync();
        await f.Actions.NewEventAsync(GregorianDate.ParseIso(day), start, end, null);
        return (f, f.Ui.Editor!);
    }

    private static async Task<(EditorFixture F, EventEditorViewModel Editor)> EditAsync(string title, string day = "2026-10-19")
    {
        var f = await EditorFixture.CreateAsync();
        await f.Actions.EditAsync(f.Item(title, day), null);
        return (f, f.Ui.Editor!);
    }

    // ---- Defaults and fields --------------------------------------------------------------------------------------

    [Fact]
    public async Task ANewEventsFields()
    {
        var (f, editor) = await NewAsync();
        using var _ = f;
        Assert.Equal("New event", editor.Title);
        Assert.Equal("Add", editor.PrimaryText);
        Assert.Equal("Cancel", editor.CancelText);
        Assert.Equal("Ctrl+Enter saves", editor.SaveHint);
        Assert.False(editor.ShowsDelete);
        Assert.Equal("IFC Thu, Oct 12, 2026", editor.StartField.Text);
        Assert.Equal("Gregorian Monday, October 19, 2026", editor.StartField.Caption);
        Assert.Equal("Starts, IFC Thursday, October 12, 2026. Gregorian Monday, October 19, 2026", editor.StartField.AccessibleName);
        Assert.Equal(TimeSpan.FromHours(10), editor.StartTime);
        Assert.Equal(TimeSpan.FromHours(11), editor.EndTime);
        Assert.Equal("Never", editor.RepeatText);
        Assert.Equal("Repeat, Never", editor.RepeatName);
        Assert.False(editor.ShowsEndRepeat);
        Assert.Equal("Home", editor.SelectedCalendar!.Name);
        Assert.Equal("None", editor.SelectedAlert!.Label);
        Assert.False(editor.ShowsSecondAlert);
        Assert.Equal(0, editor.ShowAsIndex);                 // Busy
        Assert.Equal(5, editor.MinuteIncrement);
        Assert.False(editor.HasZoneNote);
        Assert.False(editor.IsDirty);
        AssertNoDashes(editor.CopyTexts());
    }

    [Fact]
    public async Task AnEditOpensWithTheOccurrence()
    {
        var (f, editor) = await EditAsync("Book club: Cotsworth");
        using var _ = f;
        Assert.Equal("Edit event", editor.Title);
        Assert.Equal("Save", editor.PrimaryText);
        Assert.True(editor.ShowsDelete);
        Assert.Equal("Delete event", editor.DeleteText);
        Assert.Equal("Book club: Cotsworth", editor.EventTitle);
        Assert.Equal("Raamatukoi", editor.Location);
        Assert.Equal("Every IFC month on the 12th", editor.RepeatText);
        Assert.True(editor.ShowsEndRepeat);
        Assert.Equal(0, editor.EndRepeatKind);
        Assert.Equal("1 hour before", editor.SelectedAlert!.Label);
        Assert.True(editor.ShowsSecondAlert);
        Assert.Equal("None", editor.SelectedSecondAlert!.Label);
        AssertNoDashes(editor.CopyTexts());
    }

    [Fact]
    public async Task AllDayTurnsFreeAndBackRestoresTimesZoneAndBusy()
    {
        var (f, editor) = await NewAsync();
        using var _ = f;
        editor.AllDay = true;
        Assert.True(editor.Draft.AllDay);
        Assert.Null(editor.Draft.TimeZone);
        Assert.Equal(Availability.Free, editor.Draft.Availability);
        Assert.Equal(1, editor.ShowAsIndex);
        Assert.False(editor.ShowsTimes);
        editor.AllDay = false;
        Assert.Equal(LocalDateTime.Parse("2026-10-19T10:00"), editor.Draft.Start);
        Assert.Equal(LocalDateTime.Parse("2026-10-19T11:00"), editor.Draft.End);
        Assert.Equal("Europe/Tallinn", editor.Draft.TimeZone);
        Assert.Equal(Availability.Busy, editor.Draft.Availability);
    }

    [Fact]
    public async Task ShowAsChosenByTheUserIsKeptThroughAllDay()
    {
        var (f, editor) = await NewAsync();
        using var _ = f;
        editor.ShowAsIndex = 1;                                // Free, chosen
        editor.AllDay = true;
        editor.AllDay = false;
        Assert.Equal(Availability.Free, editor.Draft.Availability);
    }

    [Fact]
    public async Task AMidnightEndShowsTheNextDayAtMidnight()
    {
        var (f, editor) = await NewAsync(23 * 60, 1440);
        using var _ = f;
        Assert.Equal(new GregorianDate(2026, 10, 20), editor.EndField.Date);
        Assert.Equal("IFC Fri, Oct 13, 2026", editor.EndField.Text);
        Assert.Equal(TimeSpan.Zero, editor.EndTime);
        editor.EventTitle = "Late show";
        Assert.True(await editor.SaveAsync());
        var item = f.Item("Late show");
        Assert.Equal(new LocalDateTime(October19, 1440), item.End);
        Assert.Equal(item.FirstDay, item.LastDay);
    }

    [Fact]
    public async Task MovingStartsKeepsTheLength()
    {
        var (f, editor) = await NewAsync();
        using var _ = f;
        editor.StartTime = TimeSpan.FromHours(14);
        Assert.Equal(TimeSpan.FromHours(15), editor.EndTime);
        editor.StartField.Choose(new GregorianDate(2026, 10, 21));
        Assert.Equal(LocalDateTime.Parse("2026-10-21T14:00"), editor.Draft.Start);
        Assert.Equal(LocalDateTime.Parse("2026-10-21T15:00"), editor.Draft.End);
        Assert.Equal(new GregorianDate(2026, 10, 21), editor.EndField.Date);
    }

    // ---- Validation (§2.11 "Validation") --------------------------------------------------------------------------

    [Fact]
    public async Task AnEndBeforeTheStartIsShownUnderEndsAndFocused()
    {
        var (f, editor) = await NewAsync();
        using var _ = f;
        var focused = new List<EditorField>();
        editor.FocusRequested += focused.Add;
        editor.EndTime = TimeSpan.FromHours(9);
        Assert.False(await editor.SaveAsync());
        Assert.Equal("The end must be after the start.", editor.EndError);
        Assert.True(editor.HasEndError);
        Assert.Equal([EditorField.Ends], focused);
        Assert.Equal("The end must be after the start.", editor.Announcement);
        Assert.False(editor.IsClosed);
        Assert.False(f.Shows("New event"));
    }

    [Fact]
    public async Task ADateBefore1583IsRefused()
    {
        var (f, editor) = await NewAsync();
        using var _ = f;
        editor.StartField.Text = "1500-03-01";
        Assert.False(editor.StartField.CommitText());
        Assert.Equal("Choose a date from 1583 to 9999.", editor.StartField.Error);
        Assert.Equal("Choose a date from 1583 to 9999.", editor.StartError);
        Assert.Equal("IFC Thu, Oct 12, 2026", editor.StartField.Text);   // the field shows its date again
        Assert.Equal(October19, editor.Draft.Start.Date);
        var focused = new List<EditorField>();
        editor.FocusRequested += focused.Add;
        Assert.False(await editor.SaveAsync());
        Assert.Equal([EditorField.Starts], focused);
    }

    [Fact]
    public async Task ADuplicateOfAHistoricalEventIsOutOfRangeUntilMoved()
    {
        using var f = await EditorFixture.CreateAsync();
        await StoreTesting.Put(f.Fake, "home", StoreTesting.Timed("old", "Battle of Lepanto", "1571-10-07T10:00", "1571-10-07T12:00"));
        await f.Actions.DuplicateAsync(f.Item("Battle of Lepanto", "1571-10-07"), null, null, null);
        var editor = f.Ui.Editor!;
        Assert.False(await editor.SaveAsync());
        Assert.Equal("Choose a date from 1583 to 9999.", editor.StartError);
        editor.StartField.Choose(October19);
        Assert.True(await editor.SaveAsync());
        Assert.True(f.Shows("Battle of Lepanto"));
    }

    [Theory]
    [InlineData("2026-M11-12", "2026-10-19")]
    [InlineData("2026-YD", "2026-12-31")]
    [InlineData("2026-10-26", "2026-10-26")]
    public async Task TypedDatesAreParsed(string text, string expected)
    {
        var (f, editor) = await NewAsync(day: "2026-10-01");
        using var _ = f;
        editor.StartField.Text = text;
        editor.StartField.CommitText();
        Assert.Null(editor.StartField.Error);
        Assert.Equal(GregorianDate.ParseIso(expected), editor.StartField.Date);
    }

    [Fact]
    public async Task UnreadableTypedTextGoesBack()
    {
        var (f, editor) = await NewAsync();
        using var _ = f;
        editor.StartField.Text = "next tuesday";
        Assert.False(editor.StartField.CommitText());
        Assert.Equal("IFC Thu, Oct 12, 2026", editor.StartField.Text);
        Assert.Null(editor.StartField.Error);
    }

    [Fact]
    public async Task AnInvalidUrlIsShownUnderUrl()
    {
        var (f, editor) = await NewAsync();
        using var _ = f;
        editor.Url = "not a web address";
        Assert.False(await editor.SaveAsync());
        Assert.Equal("Enter a web address, like example.com.", editor.UrlError);
        editor.Url = "example.com/agenda";
        Assert.True(await editor.SaveAsync());
        Assert.Equal("https://example.com/agenda", f.Fake.Find("home")!.Document!.Groups.Single(g => g.Master?.Summary == "New event").Master!.Url);
    }

    // ---- Repeat (§2.11 table, §2.13) ------------------------------------------------------------------------------

    [Fact]
    public async Task AMonthlyRepeatFollowsTheNewDaySilently()
    {
        var (f, editor) = await EditAsync("Book club: Cotsworth");
        using var _ = f;
        editor.StartField.Choose(new GregorianDate(2026, 10, 20));          // IFC October 13
        Assert.Null(editor.RepeatNotice);
        Assert.Equal("Every IFC month on the 13th", editor.RepeatText);
    }

    [Fact]
    public async Task AYearlyRepeatMovedToYearDaySaysHowItChanged()
    {
        var (f, editor) = await NewAsync();
        using var _ = f;
        f.Ui.PickRepeat = picker => picker.Rows.Single(r => r.Label == "Every year on IFC October 12");
        await editor.OpenRepeatPickerAsync();
        editor.StartField.Choose(new GregorianDate(2026, 12, 31));
        Assert.Equal("Repeat changed to Every Year Day.", editor.RepeatNotice);
        Assert.Equal(editor.RepeatNotice, editor.Announcement);
        AssertNoDashes(editor.CopyTexts());
    }

    [Fact]
    public async Task MovingToYearDayDropsTheRepeatAndSaysLaterEventsGo()
    {
        var (f, editor) = await EditAsync("Book club: Cotsworth");
        using var _ = f;
        editor.StartField.Choose(new GregorianDate(2026, 12, 31));
        Assert.Equal("Repeat changed to Never: Year Day belongs to no month and no week.", editor.RepeatNotice);
        Assert.Null(editor.Draft.Recurrence);
        Assert.Equal("Saving for future events deletes every later event in this series.", editor.LaterNotice);

        // The span question offers only future events, with the losses line, in the destructive style.
        f.Ui.Answers.Enqueue(null);
        Assert.False(await editor.SaveAsync());
        var question = f.Ui.Questions.Single();
        Assert.Equal("Changing the repeat applies to this and all future events.", question.Message);
        Assert.Equal(["Save for future events"], question.Choices.Select(c => c.Text));
        Assert.Equal(ChoiceStyle.Destructive, question.Choices[0].Style);
        Assert.Contains("Every later event in this series will be deleted.", question.Lines);
        AssertNoDashes(question.Texts);
    }

    [Fact]
    public async Task PickingNeverOnTheFirstEventMakesItOneEvent()
    {
        var (f, editor) = await EditAsync("Book club: Cotsworth", "2026-01-12");
        using var _ = f;
        editor.SetRecurrence(null);
        Assert.Equal("The series becomes one event on Thursday, January 12, 2026.", editor.LaterNotice);
    }

    [Fact]
    public async Task RetimingTheFirstEventSaysWhichChangedEventsGo()
    {
        using var f = await EditorFixture.CreateAsync();
        // A changed occurrence (this event only) on IFC December 12 first.
        await f.Actions.EditAsync(f.Item("Book club: Cotsworth", "2026-12-14"), null);
        f.Ui.Editor!.Location = "Library";
        f.Ui.Answers.Enqueue(0);
        Assert.True(await f.Ui.Editor.SaveAsync());

        // The first event moves a month later: shifted 28 days, IFC December 12 passes Year Day and is no rule date.
        await f.Actions.EditAsync(f.Item("Book club: Cotsworth", "2026-01-12"), null);
        var editor = f.Ui.Editor!;
        editor.StartField.Choose(new GregorianDate(2026, 2, 9));
        Assert.Equal("Changes to 1 single event in this series will be removed when you save.", editor.ExceptionsNotice);
        f.Ui.Answers.Enqueue(null);
        Assert.False(await editor.SaveAsync());
        Assert.Contains(EditorStrings.SpanExceptionsDropped(1), f.Ui.Questions[^1].Lines);
        editor.StartField.Choose(new GregorianDate(2026, 1, 12));
        Assert.Null(editor.ExceptionsNotice);                                // undone in the editor: gone
    }

    [Fact]
    public async Task TheRepeatPickerListsBothCalendarsAndCustom()
    {
        var picker = new RepeatPickerViewModel(October19, CalendarSystemId.Ifc, null, null);
        Assert.Equal("Repeat", picker.Title);
        var labels = picker.Rows.Select(r => r.Label).ToList();
        Assert.Equal("Never", labels[0]);
        Assert.Contains("Every day", labels);
        Assert.Contains("Every week on Monday", labels);
        Assert.Contains("Every IFC month on the 12th", labels);
        Assert.Contains("Every IFC week on Thursday", labels);
        Assert.Equal("Custom", labels[^1]);
        Assert.Contains(picker.Sections, s => s.Header == "Gregorian calendar" && s.Footer == "These follow the Gregorian calendar, like every other calendar app.");
        Assert.Contains(picker.Sections, s => s.Footer == "Every 13-month month has 28 days, so monthly repeats never skip a month.");
        Assert.True(picker.Rows[0].IsSelected);
        AssertNoDashes(picker.Rows.Select(r => r.AccessibleName).Concat(picker.Sections.SelectMany(s => new[] { s.Header, s.Footer })));
        await Task.CompletedTask;
    }

    [Fact]
    public async Task ChoosingARepeatAndItsEnd()
    {
        var (f, editor) = await NewAsync();
        using var _ = f;
        f.Ui.PickRepeat = picker => picker.Rows.Single(r => r.Label == "Every IFC month on the 12th");
        await editor.OpenRepeatPickerAsync();
        Assert.Equal("Every IFC month on the 12th", editor.RepeatText);
        Assert.True(editor.ShowsEndRepeat);
        editor.EndRepeatKind = 2;
        editor.EndRepeatCount = 6;
        Assert.Equal(new RepeatEnd.CountEnd(6), editor.Draft.Recurrence!.End);
        Assert.Equal("times", editor.EndRepeatTimesText);
        editor.EndRepeatKind = 1;
        editor.EndRepeatField.Choose(new GregorianDate(2027, 3, 1));
        Assert.IsType<RepeatEnd.UntilEnd>(editor.Draft.Recurrence!.End);
        editor.EventTitle = "Monthly review";
        Assert.True(await editor.SaveAsync());
        Assert.True(f.Shows("Monthly review", "2026-11-16"));             // IFC November 12
    }

    [Fact]
    public async Task AnEndRepeatBeforeTheStartIsAnError()
    {
        var (f, editor) = await NewAsync();
        using var _ = f;
        editor.SetRecurrence(new EventRecurrence(RepeatRule.Of(RRule.Parse("FREQ=DAILY")), RepeatEnd.Never));
        editor.EndRepeatKind = 1;
        editor.EndRepeatField.Choose(new GregorianDate(2026, 10, 1));
        Assert.False(await editor.SaveAsync());
        Assert.Equal("The repeat must end after the event starts.", editor.EndRepeatError);
    }

    [Fact]
    public async Task CustomRepeatDescribesItselfLive()
    {
        var custom = new CustomRepeatViewModel(October19, CalendarSystemId.Ifc, null);
        custom.Frequency = 1;
        custom.Interval = 2;
        custom.Weekdays.Single(w => w.Name == "Thursday").IsChecked = true;
        Assert.Contains("Every 2 weeks", custom.Description, StringComparison.Ordinal);
        Assert.StartsWith("Next:", custom.Next, StringComparison.Ordinal);
        Assert.Equal("2 weeks", custom.UnitText);
        Assert.Equal("weeks", custom.UnitWord);
        AssertNoDashes([custom.Description, custom.Next, .. custom.Notes, custom.Title, custom.DoneText]);
        await Task.CompletedTask;
    }

    // ---- Alerts (§2.14) -------------------------------------------------------------------------------------------

    [Fact]
    public async Task AlertsAndASecondAlert()
    {
        var (f, editor) = await NewAsync();
        using var _ = f;
        Assert.Contains(editor.AlertOptions, o => o.Label == "15 minutes before");
        editor.SelectedAlert = editor.AlertOptions.Single(o => o.Label == "15 minutes before");
        Assert.True(editor.ShowsSecondAlert);
        editor.SelectedSecondAlert = editor.SecondAlertOptions.Single(o => o.Label == "1 day before");
        Assert.Equal(2, editor.Draft.Alarms.Count);
        editor.SelectedAlert = editor.AlertOptions.Single(o => o.Alarm is null);
        Assert.Single(editor.Draft.Alarms);
        AssertNoDashes(editor.AlertOptions.Select(o => o.Label));
    }

    [Fact]
    public async Task AllDayAlertsAreAtATimeOfDay()
    {
        var (f, editor) = await NewAsync(null, null);
        using var _ = f;
        Assert.Contains(editor.AlertOptions, o => o.Label.Contains("09:00", StringComparison.Ordinal));
    }

    // ---- Closing (§2.11 "Leaving asks first") ---------------------------------------------------------------------

    [Fact]
    public async Task AnUnchangedEditorClosesWithoutAsking()
    {
        var (f, editor) = await EditAsync("Dentist, Dr. Tamm");
        using var _ = f;
        Assert.True(await editor.RequestCloseAsync());
        Assert.Empty(f.Ui.Questions);
        Assert.True(editor.IsClosed);
    }

    [Fact]
    public async Task AChangedEditAsksDiscardChanges()
    {
        var (f, editor) = await EditAsync("Dentist, Dr. Tamm");
        using var _ = f;
        editor.Notes = "Bring the X-rays.";
        Assert.False(await editor.RequestCloseAsync());                 // Keep editing
        var question = f.Ui.Questions.Single();
        Assert.Equal("Discard changes?", question.Title);
        Assert.Equal(["Discard changes"], question.Choices.Select(c => c.Text));
        Assert.Equal("Keep editing", question.CancelText);
        Assert.False(editor.IsClosed);

        f.Ui.Answers.Enqueue(0);
        Assert.True(await editor.RequestCloseAsync());
        Assert.True(editor.IsClosed);
        Assert.Equal("", f.Group("home", "dentist")!.Master!.Description ?? "");
    }

    [Fact]
    public async Task AChangedNewEventAsksDiscardThisEvent()
    {
        var (f, editor) = await NewAsync();
        using var _ = f;
        editor.EventTitle = "Something";
        f.Ui.Answers.Enqueue(0);
        Assert.True(await editor.RequestCloseAsync());
        var question = f.Ui.Questions.Single();
        Assert.Equal("Discard this event?", question.Title);
        Assert.Equal(["Discard event"], question.Choices.Select(c => c.Text));
        Assert.False(f.Shows("Something"));
    }

    [Fact]
    public async Task CancelCommandAsksToo()
    {
        var (f, editor) = await NewAsync();
        using var _ = f;
        editor.Location = "Tartu";
        await editor.CancelCommand.ExecuteAsync(null);
        Assert.Single(f.Ui.Questions);
        Assert.False(editor.IsClosed);
    }

    // ---- The 13-month date picker (§2.12) -------------------------------------------------------------------------

    private static DateFieldViewModel Field(string date, bool limitRange = true) =>
        new("Starts", CalendarSystemId.Ifc, GregorianDate.ParseIso(date), () => October19, limitRange);

    [Fact]
    public void ThePickerShowsTheMonthInBothCalendars()
    {
        var picker = Field("2026-10-19").CreatePicker();
        Assert.Equal("IFC", picker.ThirteenTabTitle);
        Assert.Equal("Gregorian", picker.GregorianTabTitle);
        Assert.Equal("2026", picker.YearText);
        Assert.Equal("Oct", picker.SelectedSlot!.Short);
        Assert.Equal("October, month 11 of 13", picker.SelectedSlot.Name);
        Assert.Equal(28, picker.Days.Count);
        Assert.Equal(7, picker.Columns.Count);
        var selected = picker.SelectedDay!;
        Assert.Equal("12", selected.Day);
        Assert.Equal("19", selected.GregorianDay);
        Assert.Equal("Thursday, October 12. Gregorian Monday, October 19", selected.Name);
        Assert.Equal("Today", selected.Status);
        Assert.Equal("Gregorian Monday, October 19, 2026", picker.Footer);
        Assert.Contains(picker.Slots, s => s.Short == "YD" && s.Name == "Year Day, belongs to no month");
        Assert.DoesNotContain(picker.Slots, s => s.Short == "LD");          // 2026 is no leap year
        AssertNoDashes(picker.Slots.Select(s => s.Name).Concat(picker.Days.Select(d => d.Name)).Append(picker.Footer));
    }

    [Fact]
    public void SteppingToAYearWithoutLeapDayFallsBack()
    {
        var picker = Field("2028-06-17").CreatePicker();                    // Leap Day 2028
        Assert.True(picker.IsIntercalary);
        Assert.False(picker.ShowsGrid);
        Assert.Equal("LD", picker.BadgeCode);
        Assert.Equal("Leap Day 2028", picker.BadgeTitle);
        Assert.Contains(picker.Slots, s => s.Name == "Leap Day, leap years only");
        picker.StepYear(-1);
        Assert.Equal(new GregorianDate(2027, 6, 17), picker.Date);         // IFC June 28, 2027
        Assert.Equal("2027 has no Leap Day, so the date moved to June 28.", picker.Caption);
    }

    [Fact]
    public void TheStartsFieldOfALeapDayRepeatStepsLeapYears()
    {
        var field = Field("2028-06-17");
        field.StepsLeapYears = true;
        var picker = field.CreatePicker();
        picker.StepYear(1);
        Assert.Equal(2032, picker.Date.Year);
        Assert.True(picker.IsIntercalary);
        Assert.Equal("Every Leap Day happens only in leap years, so the year moved to 2032.", picker.Caption);
        picker.Done();
        Assert.Equal(picker.Date, field.Date);
    }

    [Fact]
    public void TheEditorsRangeStartsIn1583()
    {
        var picker = Field("1583-01-05").CreatePicker();
        Assert.False(picker.CanStepYear(-1));
        Assert.False(picker.PreviousYearCommand.CanExecute(null));
        picker.MoveDays(-10);
        Assert.Equal(new GregorianDate(1583, 1, 5), picker.Date);
        Assert.True(Field("0001-01-05", limitRange: false).CreatePicker().CanStepYear(1));
    }

    [Fact]
    public void TheKeyboardMovesThroughIntercalaryDays()
    {
        var picker = Field("2028-06-16").CreatePicker();                    // IFC June 28, 2028
        picker.MoveDays(1);
        Assert.True(picker.IsIntercalary);                                  // Leap Day
        picker.MoveDays(1);
        Assert.Equal(new GregorianDate(2028, 6, 18), picker.Date);         // Sol 1
        picker.MoveDays(-1);
        Assert.True(picker.IsIntercalary);
        picker.MoveRows(1);                                                 // from an intercalary day: the day after it
        Assert.Equal(new GregorianDate(2028, 6, 18), picker.Date);
    }

    [Fact]
    public void RowsMonthsAndEdges()
    {
        var picker = Field("2026-10-19").CreatePicker();                    // IFC October 12
        picker.MoveRows(1);
        Assert.Equal(new GregorianDate(2026, 10, 26), picker.Date);        // IFC October 19
        picker.MoveRows(2);
        Assert.Equal(new GregorianDate(2026, 11, 9), picker.Date);         // IFC November 5
        picker.MoveMonths(-1);
        Assert.Equal(new GregorianDate(2026, 10, 12), picker.Date);        // IFC October 5
        picker.MoveToMonthEdge(end: true);
        Assert.Equal(new GregorianDate(2026, 11, 4), picker.Date);         // IFC October 28
        picker.MoveToMonthEdge(end: false);
        Assert.Equal(new GregorianDate(2026, 10, 8), picker.Date);         // IFC October 1
    }

    [Fact]
    public void CancelLeavesTheFieldAndTheTabIsRemembered()
    {
        var field = Field("2026-10-19");
        var tabs = new List<PickerTab>();
        ThirteenDatePickerViewModel.TabChosen += tabs.Add;
        try
        {
            var picker = field.CreatePicker();
            picker.MoveDays(3);
            picker.Cancel();
            Assert.Equal(October19, field.Date);
            picker.IsGregorianTab = true;
            Assert.Equal([PickerTab.Gregorian], tabs);
            Assert.Equal("IFC Sunday, October 15, 2026", picker.Footer);      // the picker's own selection
        }
        finally
        {
            ThirteenDatePickerViewModel.TabChosen -= tabs.Add;
            ThirteenDatePickerViewModel.LastTab = PickerTab.Thirteen;
        }
    }

    [Fact]
    public void TheGregorianTabSetsTheDate()
    {
        var field = Field("2026-10-19");
        var picker = field.CreatePicker();
        picker.GregorianSelection = new DateTime(2026, 12, 31);
        Assert.True(picker.IsIntercalary);
        picker.Done();
        Assert.Equal(new GregorianDate(2026, 12, 31), field.Date);
        Assert.Equal("Year Day 2026", field.Text);
    }

    // ---- Span questions (§2.11) -----------------------------------------------------------------------------------

    [Fact]
    public void DeleteQuestions()
    {
        var single = SpanQuestions.ForDelete(repeating: false);
        Assert.Equal("Delete this event?", single.Question.Title);
        Assert.Equal("Cancel", single.Question.CancelText);
        var repeating = SpanQuestions.ForDelete(repeating: true);
        Assert.Equal([EditSpan.This, EditSpan.Future], repeating.Spans);
        AssertNoDashes(single.Question.Texts.Concat(repeating.Question.Texts));
    }

    internal static void AssertNoDashes(IEnumerable<string?> texts)
    {
        foreach (var text in texts.Where(t => t is not null))
        {
            Assert.False(text!.Contains('–') || text.Contains('—'), $"A dash in: {text}");
        }
    }
}
