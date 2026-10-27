import SwiftUI
import ThirteenKit

// Calendar's Year mode (docs/EVENTS.md §2.3, task A5): the existing Year screen plus event dots
// under each day (`model.events.yearMarks(year:)`, up to three 4 pt dots in the colours of the
// first three calendars with events that day; none while "Show events in Year view" is off or
// events cannot be shown), the `year.cell.events` accessible value ("3 events"), dots on the
// intercalary badges, and month titles that open Month mode. Selecting a day still opens the day
// sheet. On compact width the year stepper stays above the grids and the system choice lives in
// the title menu; on regular width the toolbar pages and holds the system menu.

/// Calendar's Year mode: the 13 month grids of the year of `model.calendarDate`, with event dots.
struct YearModeView: View {
    var compact = false

    var body: some View {
        YearView(showsStepper: compact, showsSystemMenu: !compact)
    }
}
