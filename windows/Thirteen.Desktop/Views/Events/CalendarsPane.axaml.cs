using Avalonia.Controls;
using Thirteen.Desktop.Services;
using Thirteen.Desktop.ViewModels;

namespace Thirteen.Desktop.Views.Events;

/// <summary>The Calendars pane; its actions open their dialogs over the pane's window.</summary>
public partial class CalendarsPane : UserControl
{
    private CalendarsPaneViewModel? _model;

    /// <summary>Creates the pane.</summary>
    public CalendarsPane()
    {
        InitializeComponent();
        DataContextChanged += (_, _) => Attach(DataContext as CalendarsPaneViewModel);
    }

    private void Attach(CalendarsPaneViewModel? model)
    {
        if (_model is not null)
        {
            _model.NewCalendarRequested -= OnNewCalendar;
            _model.SubscribeRequested -= OnSubscribe;
            _model.SettingsRequested -= OnSettings;
            _model.OpenFolderRequested -= OnOpenFolder;
        }
        _model = model;
        if (_model is not null)
        {
            _model.NewCalendarRequested += OnNewCalendar;
            _model.SubscribeRequested += OnSubscribe;
            _model.SettingsRequested += OnSettings;
            _model.OpenFolderRequested += OnOpenFolder;
        }
    }

    private Window? Owner => TopLevel.GetTopLevel(this) as Window;

    private async void OnNewCalendar()
    {
        if (_model is null || Owner is not { } owner) return;
        await EventDialogs.NewCalendarAsync(owner, _model.Store);
    }

    private async void OnSubscribe(string? link)
    {
        if (_model?.Subscriptions is not { } subscriptions || Owner is not { } owner) return;
        await EventDialogs.SubscribeAsync(owner, _model.Store, subscriptions, link);
    }

    private async void OnSettings(string id)
    {
        if (_model is null || Owner is not { } owner) return;
        var model = _model;
        await EventDialogs.SettingsAsync(owner, model.Store, model.Subscriptions, id, model.CanExport ? model.RequestExport : null);
    }

    private void OnOpenFolder()
    {
        if (_model is not null) FolderLauncher.Open(_model.Store.Folder);
    }
}
