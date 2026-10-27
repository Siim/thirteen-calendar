import Foundation
import Testing
import ThirteenKit

private func day(_ iso: String) -> GregorianDate { EventsTest.day(iso) }
private func local(_ iso: String) -> LocalDateTime { EventsTest.local(iso) }

/// EventsModel on the fake store with the mockup data set (docs/EVENTS.md §6.2 `EventsModelTests`):
/// every access transition, "Show my events", shared loads, year caches and their invalidation and
/// key dedupe, visible-calendar persistence with the (source, title) fallback, the default calendar,
/// the access card's launch counter, pending changes and the moved drafts.
@Suite("Events model")
@MainActor
struct EventsModelTests {
    static let allCalendars = ["home", "family", "work", "running-club", "holidays", "birthdays"]

    // MARK: Access (§2.16)

    @Test func startsWithFullAccess() async throws {
        let (model, _) = EventsTest.model(store: try EventsTest.fake())
        #expect(model.accessCard == nil, "no card before access is read, so nothing flashes at launch")
        await model.start()
        #expect(model.authorization == .fullAccess && model.canShowEvents)
        #expect(model.calendars.map(\.id) == Self.allCalendars)
        #expect(model.visibleCalendarIDs == Set(Self.allCalendars), "every calendar starts visible")
        #expect(model.accessCard == nil)
        #expect(model.defaultCalendar?.id == "home", "the platform default")
        #expect(model.writableCalendars.map(\.id) == ["home", "family", "work", "running-club"])
    }

    @Test(arguments: [
        (FakeCalendarStore.Scenario.notDetermined, CalendarAccess.Card.notAsked),
        (.denied, .denied), (.writeOnly, .writeOnly), (.restricted, .restricted), (.empty, .noCalendars),
    ])
    func cardsForEachState(_ scenario: FakeCalendarStore.Scenario, _ card: CalendarAccess.Card) async throws {
        let (model, _) = EventsTest.model(store: try EventsTest.fake(scenario))
        await model.start()
        #expect(model.accessCard == card)
        #expect(!model.canShowEvents || scenario == .empty)
        await model.load(years: 2026...2026)
        #expect(model.occurrences(on: day("2026-10-19")).isEmpty)
    }

    @Test func noWritableCalendarHasNoCardButPlusAlerts() async throws {
        let (model, _) = EventsTest.model(store: try EventsTest.fake(.noWritable))
        await model.start()
        #expect(model.accessCard == nil)
        #expect(model.calendars.map(\.id) == ["holidays", "birthdays"])
        let route = CalendarAccess.newEventRoute(showsEvents: true, authorization: model.authorization, calendars: model.calendars)
        #expect(route == .alert(.noWritableCalendar))
    }

    @Test func plusRoutes() {
        func route(_ status: CalendarAuthorization, shows: Bool = true) -> CalendarAccess.NewEventRoute {
            CalendarAccess.newEventRoute(showsEvents: shows, authorization: status, calendars: [])
        }
        #expect(route(.notDetermined) == .requestAccess)
        #expect(route(.denied) == .alert(.accessDenied))
        #expect(route(.writeOnly) == .editor(writeOnly: true))
        #expect(route(.restricted) == .alert(.accessRestricted))
        #expect(route(.fullAccess) == .alert(.noCalendars))
        #expect(route(.fullAccess, shows: false) == .unavailable)
        #expect(CalendarAccess.settingsValue(.writeOnly) == "Add only" && CalendarAccess.settingsValue(.notDetermined) == "Not set up")
    }

    @Test func grantingAccessLoadsEverything() async throws {
        let fake = try EventsTest.fake(.notDetermined, grants: true)
        let (model, _) = EventsTest.model(store: fake)
        await model.start()
        #expect(model.accessCard == .notAsked && model.calendars.isEmpty)
        let status = await model.requestAccess()
        #expect(status == .fullAccess && model.authorization == .fullAccess && model.accessCard == nil)
        #expect(model.calendars.count == 6)
        await model.load(years: 2026...2026)
        #expect(model.occurrences(on: day("2026-10-19")).count == 5)
    }

    @Test func refusingAccessShowsTheDeniedCard() async throws {
        let (model, _) = EventsTest.model(store: try EventsTest.fake(.notDetermined, grants: false))
        await model.start()
        await model.requestAccess()
        #expect(model.authorization == .denied && model.accessCard == .denied)
    }

    /// Access changing in Settings while Thirteen runs (every transition reaches the model through
    /// a store change): the cache goes away without full access and comes back with it.
    @Test func everyTransitionThroughAStoreChange() async throws {
        let fake = try EventsTest.fake()
        let (model, _) = EventsTest.model(store: fake)
        await model.start()
        await model.load(years: 2026...2026)
        #expect(!model.occurrences(on: day("2026-10-19")).isEmpty)
        for (scenario, card) in [
            (FakeCalendarStore.Scenario.denied, CalendarAccess.Card?.some(.denied)), (.writeOnly, .writeOnly), (.restricted, .restricted),
            (.fullAccess, nil), (.empty, .noCalendars), (.fullAccess, nil),
        ] {
            await fake.setScenario(scenario)
            await model.storeDidChange()
            #expect(model.accessCard == card, "\(scenario)")
            #expect(model.authorization == scenario.authorization)
        }
        #expect(model.cachedYears.isEmpty, "losing access dropped the cache")
        await model.load(years: 2026...2026)
        #expect(model.occurrences(on: day("2026-10-19")).count == 5)
    }

    // MARK: Show my events (§2.16)

    @Test func showMyEventsOffNeverAsks() async throws {
        let fake = try EventsTest.fake(.notDetermined)
        let defaults = EventsTest.freshDefaults()
        defaults.set(false, forKey: EventsModel.Keys.showsEvents)
        let (model, _) = EventsTest.model(store: fake, defaults: defaults)
        await model.start()
        #expect(!model.showsEvents && model.accessCard == nil, "no card while off")
        #expect(!model.hasReadAuthorization, "access is not even read")
        await model.requestAccess()
        #expect(await fake.authorizationStatus() == .notDetermined, "never asks while off")
        let route = CalendarAccess.newEventRoute(showsEvents: model.showsEvents, authorization: model.authorization, calendars: [])
        #expect(route == .unavailable, "no + while off")

        model.showsEvents = true
        try await waitUntil { model.hasReadAuthorization }
        #expect(model.accessCard == .notAsked, "turning it on again with access undecided shows the not-asked card")
        #expect(defaults.bool(forKey: EventsModel.Keys.showsEvents))
    }

    @Test func showMyEventsOffHidesEverything() async throws {
        let (model, _) = EventsTest.model(store: try EventsTest.fake())
        await model.start()
        await model.load(years: 2026...2026)
        #expect(!model.yearMarks(year: 2026).isEmpty)
        model.showsEvents = false
        try await waitUntil { model.cachedYears.isEmpty }
        #expect(!model.canShowEvents)
        #expect(model.occurrences(on: day("2026-10-19")).isEmpty && model.yearMarks(year: 2026).isEmpty)
        await model.load(years: 2026...2026)
        #expect(model.cachedYears.isEmpty, "nothing is fetched while off")
    }

    @Test func launchArgumentOverrideIsNotStored() throws {
        let defaults = EventsTest.freshDefaults()
        let model = EventsModel(store: try EventsTest.fake(), source: .fake(.fullAccess), deviceZone: EventsTest.zone, defaults: defaults, showsEvents: false)
        #expect(!model.showsEvents)
        #expect(defaults.object(forKey: EventsModel.Keys.showsEvents) == nil)
    }

    // MARK: Year caches

    @Test func loadsAreSharedAndCached() async throws {
        let store = RecordingStore(try EventsTest.fake())
        let (model, _) = EventsTest.model(store: store)
        await model.start()
        async let first: Void = model.load(years: 2026...2026)
        async let second: Void = model.load(years: 2026...2026)
        _ = await (first, second)
        #expect(await store.occurrenceCalls == 1, "two requests for one year while it loads make one query")
        await model.load(years: 2026...2026)
        #expect(await store.occurrenceCalls == 1, "a cached year is not fetched again")
        #expect(model.loadState(year: 2026) == .loaded && model.loadState(year: 2027) == .notLoaded)
    }

    @Test func occurrencesOfADay() async throws {
        let (model, _) = EventsTest.model(store: try EventsTest.fake())
        await model.start()
        await model.load(years: 2026...2026)
        #expect(model.occurrences(on: day("2026-10-19")).map(\.title) == [
            "Autumn school break", "Sprint planning", "1:1 with Marta", "Dentist, Dr. Tamm", "Book club: Cotsworth",
        ], "the mockup's Monday in §5.3 order-key order")
        #expect(model.occurrence(key: "home/dentist|2026-10-19T15:40")?.title == "Dentist, Dr. Tamm")
    }

    /// An event crossing January 1 is in both years' caches; every merge dedupes by key (§3.2).
    @Test func yearMergesDedupeByKey() async throws {
        let (model, _) = EventsTest.model(store: try EventsTest.fake())
        await model.start()
        await model.load(years: 2026...2027)
        #expect(model.cachedYears == [2026, 2027])
        let winter = model.occurrences(from: day("2026-12-30"), through: day("2027-01-02")).filter { $0.title == "Winter break" }
        #expect(winter.count == 1)
        #expect(model.occurrences(inYear: 2027).contains { $0.key == "family/winter-break|2026-12-28" }, "also in 2027's cache")
        let agenda = model.agenda(from: day("2026-12-30"), through: day("2027-01-02"), system: .ifc)
        #expect(agenda.count == 4 && agenda.allSatisfy { day in day.items.filter { $0.key == "family/winter-break|2026-12-28" }.count == 1 })
    }

    @Test func changesInvalidateTheCache() async throws {
        let fake = try EventsTest.fake()
        let store = RecordingStore(fake)
        let (model, _) = EventsTest.model(store: store)
        await model.start()
        await model.load(years: 2026...2026)
        let calls = await store.occurrenceCalls
        // Another app adds an event; the change notice refetches the cached years.
        var draft = try EventDraft(newOn: day("2026-10-20"), now: EventsTest.now, calendarID: "home", timeZone: EventsTest.zone)
        draft.title = "Added elsewhere"
        _ = try await fake.save(draft: draft, span: .thisEvent, target: .new)
        #expect(!model.occurrences(on: day("2026-10-20")).contains { $0.title == "Added elsewhere" })
        await model.storeDidChange()
        #expect(await store.occurrenceCalls > calls, "the cached year was fetched again")
        #expect(model.occurrences(on: day("2026-10-20")).contains { $0.title == "Added elsewhere" })
    }

    @Test func savingThroughTheModelReloads() async throws {
        let (model, _) = EventsTest.model(store: try EventsTest.fake())
        await model.start()
        await model.load(years: 2026...2026)
        var draft = try EventDraft(newOn: day("2026-10-22"), now: EventsTest.now, calendarID: "family", timeZone: EventsTest.zone)
        draft.title = "Dinner"
        let result = try await model.save(draft: draft, span: .thisEvent, target: .new)
        #expect(result.key != nil)
        let dinner = try #require(model.occurrences(on: day("2026-10-22")).first { $0.title == "Dinner" })
        #expect(dinner.start == local("2026-10-22T09:00") && dinner.end == local("2026-10-22T10:00"))
    }

    @Test func yearIntervals() throws {
        let (model, _) = EventsTest.model(store: try EventsTest.fake())
        let interval = try #require(model.interval(year: 2026))
        #expect(interval.start == EventsTest.instant("2026-01-01T00:00") && interval.end == EventsTest.instant("2027-01-01T00:00"))
        let last = try #require(model.interval(year: 9999))
        #expect(last.end == EventsTest.instant("9999-12-31T24:00"), "9999 ends at 9999-12-31T24:00, never a year-10000 date")
        #expect(model.interval(year: 0) == nil)
    }

    @Test func yearMarks() async throws {
        let (model, _) = EventsTest.model(store: try EventsTest.fake())
        await model.start()
        await model.load(years: 2026...2026)
        let marks = model.yearMarks(year: 2026)
        let today = try #require(marks.first { $0.gregorian == day("2026-10-19") })
        #expect(today.count == model.occurrences(on: day("2026-10-19")).count)
        #expect(today.calendarIDs.count <= 3)
        model.showsEventsInYear = false
        #expect(model.yearMarks(year: 2026).isEmpty, "Show events in Year view off")
    }

    // MARK: Calendars (§2.15, §3.2)

    @Test func hiddenCalendarsPersistAndAreNotFetched() async throws {
        let defaults = EventsTest.freshDefaults()
        let (model, _) = EventsTest.model(store: try EventsTest.fake(), defaults: defaults)
        await model.start()
        await model.load(years: 2026...2026)
        model.setVisible(false, calendarID: "work")
        try await waitUntil { !model.occurrences(on: day("2026-10-19")).contains { $0.calendarID == "work" } }
        #expect(!model.isVisible("work"))

        let (reloaded, _) = EventsTest.model(store: try EventsTest.fake(), defaults: defaults)
        await reloaded.start()
        #expect(!reloaded.isVisible("work") && reloaded.isVisible("home"))
        await reloaded.load(years: 2026...2026)
        #expect(!reloaded.occurrences(on: day("2026-10-19")).contains { $0.calendarID == "work" })

        model.setVisible(false, account: "icloud")
        #expect(!model.isVisible("home") && !model.isVisible("family"))
        model.setVisible(true, account: "icloud")
        #expect(model.isVisible("home") && model.isVisible("family") && !model.isVisible("work"))
    }

    /// A calendar whose id changed (re-created by a sync) is matched by (source, title); one Thirteen
    /// never saw is shown.
    @Test func visibilityFallsBackToSourceAndTitle() async throws {
        let defaults = EventsTest.freshDefaults()
        let (model, _) = EventsTest.model(store: try EventsTest.fake(), defaults: defaults)
        await model.start()
        model.setVisible(false, calendarID: "work")

        let original = try EventsTest.mockup()
        var calendars = original.calendars.map { info -> CalendarInfo in
            var info = info
            if info.id == "work" { info.id = "work-recreated" }
            return info
        }
        var added = original.calendars[0]
        added.id = "new-calendar"
        added.title = "Brand new"
        calendars.append(added)
        let changed = FakeCalendarStore.Mockup(
            now: original.now, deviceZone: original.deviceZone, calendars: calendars, events: original.events, occurrences: original.occurrences)
        let (reloaded, _) = EventsTest.model(store: try EventsTest.fake(mockup: changed), defaults: defaults)
        await reloaded.start()
        #expect(!reloaded.isVisible("work-recreated"), "matched by (sourceTitle, title)")
        #expect(reloaded.isVisible("new-calendar"), "a calendar added since is shown")
        #expect(reloaded.isVisible("home"))
    }

    @Test func accountGroupsInPlatformOrder() async throws {
        let (model, _) = EventsTest.model(store: try EventsTest.fake())
        await model.start()
        #expect(model.accountGroups.map(\.title) == ["iCloud", "liis.kask@example.com", "Subscribed", "Other"])
        #expect(model.accountGroups[0].calendars.map(\.id) == ["home", "family"])
        model.setCollapsed(true, account: "google")
        #expect(model.isCollapsed("google") && !model.isCollapsed("icloud"))
    }

    @Test func collapsedGroupsPersist() async throws {
        let defaults = EventsTest.freshDefaults()
        let (model, _) = EventsTest.model(store: try EventsTest.fake(), defaults: defaults)
        model.setCollapsed(true, account: "google")
        let (reloaded, _) = EventsTest.model(store: try EventsTest.fake(), defaults: defaults)
        #expect(reloaded.isCollapsed("google"))
    }

    @Test func defaultCalendarFallsBackSilently() async throws {
        let defaults = EventsTest.freshDefaults()
        let (model, _) = EventsTest.model(store: try EventsTest.fake(), defaults: defaults)
        await model.start()
        model.setDefaultCalendar(id: "work")
        #expect(model.defaultCalendar?.id == "work")
        model.setDefaultCalendar(id: "holidays")
        #expect(model.defaultCalendar?.id == "work", "a read-only calendar cannot be the default")

        let original = try EventsTest.mockup()
        let without = FakeCalendarStore.Mockup(
            now: original.now, deviceZone: original.deviceZone, calendars: original.calendars.filter { $0.id != "work" && $0.title != "Work" },
            events: original.events, occurrences: original.occurrences)
        let (reloaded, _) = EventsTest.model(store: try EventsTest.fake(mockup: without), defaults: defaults)
        await reloaded.start()
        #expect(reloaded.defaultCalendar?.id == "home", "the chosen calendar is gone: the platform default")
    }

    // MARK: The access card's launch counter (§2.16)

    @Test func accessCardCollapsesAfterThreeLaunches() async throws {
        let defaults = EventsTest.freshDefaults()
        for launch in 1...4 {
            let (model, _) = EventsTest.model(store: try EventsTest.fake(.notDetermined), defaults: defaults)
            await model.start()
            #expect(model.accessCardCollapsed == (launch == 4), "launch \(launch)")
            model.noteAccessCardShown()
            model.noteAccessCardShown()
        }
        #expect(defaults.integer(forKey: EventsModel.Keys.accessCardLaunches) == 4, "counted once per launch")
        let (granted, _) = EventsTest.model(store: try EventsTest.fake(), defaults: defaults)
        await granted.start()
        #expect(!granted.accessCardCollapsed, "a decision ends it")
        granted.noteAccessCardShown()
        #expect(defaults.integer(forKey: EventsModel.Keys.accessCardLaunches) == 4)
    }

    // MARK: Pending changes and moves

    @Test func pendingChangesShowInTheViews() async throws {
        let (model, _) = EventsTest.model(store: try EventsTest.fake())
        await model.start()
        await model.load(years: 2026...2026)
        let dentist = try #require(model.occurrence(key: "home/dentist|2026-10-19T15:40"))
        let moved = try #require(model.movedOccurrence(dentist, to: local("2026-10-20T14:00")))
        #expect(moved.start == local("2026-10-20T14:00") && moved.end == local("2026-10-20T14:40"))
        #expect(moved.startUtc == local("2026-10-20T11:00"), "the new start instant, for alerts")
        let id = UUID()
        model.setPending(.init(entryID: id, key: dentist.key, kind: .move(moved)))
        #expect(!model.occurrences(on: day("2026-10-19")).contains { $0.key == dentist.key })
        #expect(model.occurrences(on: day("2026-10-20")).contains { $0.key == dentist.key && $0.start == local("2026-10-20T14:00") })
        #expect(model.occurrence(key: dentist.key)?.start == local("2026-10-20T14:00"))
        model.clearPending(entryID: id)
        model.setPending(.init(entryID: id, key: dentist.key, kind: .delete))
        #expect(!model.occurrences(on: day("2026-10-19")).contains { $0.key == dentist.key } && model.occurrence(key: dentist.key) == nil)
        model.clearPending(entryID: id)
        #expect(model.occurrences(on: day("2026-10-19")).contains { $0.key == dentist.key })
    }

    @Test func movedDrafts() async throws {
        let (model, _) = EventsTest.model(store: try EventsTest.fake())
        await model.start()
        let dentist = try #require(try await model.event(key: "home/dentist|2026-10-19T15:40"))
        let timed = try #require(model.movedDraft(dentist, toDeviceStart: local("2026-10-23T08:15")))
        #expect(timed.start == local("2026-10-23T08:15") && timed.end == local("2026-10-23T08:55") && timed.timeZone == dentist.event.draft.timeZone)
        #expect(try dentist.event.draft.changedFields(to: timed) == [.time], "a move changes the time group only")

        let breakKey = "family/school-break|2026-10-19"
        let schoolBreak = try #require(try await model.event(key: breakKey))
        let allDay = try #require(model.movedDraft(schoolBreak, toDeviceStart: local("2026-10-26T13:00")))
        #expect(allDay.start == local("2026-10-26T00:00") && allDay.end == local("2026-11-01T24:00"), "seven days, from the drop's date")
    }

    /// The Year dots follow pending changes, also when one pending change replaces another of the
    /// same count (a move undone, then another event moved).
    @Test func yearMarksFollowEveryPendingChange() async throws {
        let (model, _) = EventsTest.model(store: try EventsTest.fake())
        await model.start()
        await model.load(years: 2026...2026)
        func count(_ iso: String) -> Int { model.yearMarks(year: 2026).first { $0.gregorian == day(iso) }?.count ?? 0 }
        let base = (oct19: count("2026-10-19"), nov2: count("2026-11-02"), nov9: count("2026-11-09"))
        let dentist = try #require(model.occurrence(key: "home/dentist|2026-10-19T15:40"))
        let bookClub = try #require(model.occurrence(key: "home/book-club|2026-10-19T19:00"))

        let first = UUID()
        model.setPending(.init(entryID: first, key: dentist.key, kind: .move(try #require(model.movedOccurrence(dentist, to: local("2026-11-02T15:40"))))))
        #expect(count("2026-10-19") == base.oct19 - 1 && count("2026-11-02") == base.nov2 + 1)
        model.clearPending(entryID: first)
        let second = UUID()
        model.setPending(.init(entryID: second, key: bookClub.key, kind: .move(try #require(model.movedOccurrence(bookClub, to: local("2026-11-09T19:00"))))))
        #expect(count("2026-11-02") == base.nov2, "the undone move is gone from the dots")
        #expect(count("2026-11-09") == base.nov9 + 1 && count("2026-10-19") == base.oct19 - 1)
        model.clearPending(entryID: second)
        #expect(count("2026-10-19") == base.oct19 && count("2026-11-09") == base.nov9)
    }

    // MARK: Lifecycle

    /// A second `start()` while the first is still reading access waits for it (a `new-event`
    /// link at a cold launch must see access as read, CalendarNavigationTests).
    @Test func aSecondStartWaitsForTheFirst() async throws {
        let (model, _) = EventsTest.model(store: try EventsTest.fake(.denied))
        let first = Task { await model.start() }
        await Task.yield()
        await model.start()
        #expect(model.hasReadAuthorization && model.authorization == .denied && model.accessCard == .denied)
        await first.value
    }

    /// A burst of store changes (another app saving a batch, a sync) is coalesced (§6.2 Changes):
    /// the first change starts a refresh, and every change that arrives while it runs is one more
    /// refresh (the stream keeps only the newest), never one per change.
    @Test func aBurstOfStoreChangesIsCoalesced() async throws {
        let store = RecordingStore(try EventsTest.fake(), ownChanges: true)
        let (model, _) = EventsTest.model(store: store)
        await model.start()
        await model.load(years: 2026...2026)
        let fetchesBefore = await store.occurrenceCalls
        let refreshes = RefreshCounter()
        model.onChange = { refreshes.count += 1 }
        for _ in 0..<10 { store.sendChange() }
        try await waitUntil { refreshes.count >= 2 }
        try await Task.sleep(for: .milliseconds(300))
        #expect(refreshes.count == 2, "ten changes: the first, then one for the nine that came while it ran")
        #expect(await store.occurrenceCalls == fetchesBefore + 2, "the one cached year fetched once per refresh")
        // A change on its own is a refresh of its own.
        store.sendChange()
        try await waitUntil { refreshes.count >= 3 }
        try await Task.sleep(for: .milliseconds(300))
        #expect(refreshes.count == 3)
    }

    @Test func sameEventIgnoresDetachedSuffix() {
        #expect(EventsModel.sameEvent("ABC", "ABC/RID=123456"))
        #expect(!EventsModel.sameEvent("ABC", "ABD"))
    }

    // MARK: Helpers

    private func waitUntil(_ condition: @MainActor () -> Bool) async throws {
        for _ in 0..<200 {
            if condition() { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        Issue.record("condition not met in 2 s")
    }
}

/// Counts the model's change callbacks.
@MainActor
private final class RefreshCounter {
    var count = 0
}
