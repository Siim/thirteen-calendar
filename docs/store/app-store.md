# App Store metadata: Thirteen for iPhone and iPad

The text for the App Store Connect record of Thirteen 1.0.0. Thirteen is free, has no in-app
purchases and collects no data. It shows and edits the user's own calendars through EventKit
(docs/EVENTS.md §7.3), so the category, description, keywords, promotional text and review notes say
so. Every length below was counted with `python3 -c 'print(len("..."))'` against App Store Connect's
limits; count again after any edit. No field contains an en dash or an em dash (design/DECISIONS.md,
"Copy").

| Field | Value |
|---|---|
| Name | `Thirteen: 13-Month Calendar` (27 of 30) |
| Apple ID | `6824447935` (store URL `https://apps.apple.com/app/id6824447935`, live only after approval) |
| Bundle ID | `com.haugas.thirteen` (the Mac target uses the same id, so a Mac App Store build could join this record later as a universal purchase) |
| SKU | `thirteen-calendar` |
| Team | Haugas Development OU (`5ZJ9N8WURW`) |
| Platforms | iOS and iPadOS 26 or later |
| Price | Free, all territories |
| Primary language | English (U.S.) |
| Copyright | `2026 Haugas Development OU` |
| Version / build | `1.0.0` / `1` (`MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` in `apple/project.yml`; see [RELEASING.md](../RELEASING.md)) |

## Name

`Thirteen: 13-Month Calendar` (27 characters). The plain name "Thirteen" is taken on the App Store. The name
under the icon on the home screen stays "Thirteen" (`INFOPLIST_KEY_CFBundleDisplayName` in
`apple/project.yml`).

## Subtitle (30 characters max)

`Events in 13 months of 28 days` (30)

Alternative: `Your events in 13 months` (24)

## Promotional text (170 characters max)

Can be changed at any time without a new build.

```
Your own events in 13 months of 28 days, with every Gregorian date beside them. Every 13th is a Friday, every 12th a Thursday, and Year Day belongs to no week at all.
```

(166 characters)

## Description (4000 characters max)

```
Thirteen shows the year as 13 months of exactly 28 days, with your own events in it. Every month is four full weeks, so a date falls on the same weekday in every month of every year. Thirteen puts each day next to its Gregorian date, converts dates in both directions and shows where the two calendars part ways.

The default is the International Fixed Calendar. Moses B. Cotsworth presented it in 1902, and Eastman Kodak used it internally from 1928 to 1989. It adds a month called Sol between June and July, starts every month on a Sunday and makes every 13th a Friday. Year Day (31 December) and, in leap years, Leap Day (17 June) belong to no month and no week. You can switch to Auguste Comte's Positivist calendar from 1849, whose months are named after Moses, Homer, Aristotle and ten others, and whose year 1 is 1789.

CALENDAR
Your events in 13 months. With your permission, Thirteen shows the calendars already on your iPhone or iPad, from iCloud, Google, Exchange and other accounts, with the Gregorian date beside every 13-month one. Look at a day, a month, the whole year or a list; on iPad also a week. Add, edit, move and delete events as in the Calendar app, with alerts, notes, links and repeats. Thirteen adds repeats that only a 13-month calendar has, such as every Year Day or every Leap Day, and, in calendars that can keep them, every 13-month month on the 12th. Changes sync through your own accounts, so they show up in your other calendar apps too. Choose which calendars to show and where new events go.

The Year view shows all 13 months as identical 4 x 7 grids, with Year Day and Leap Day in their places. The Gregorian overlay puts the ordinary date in every cell and marks where each Gregorian month begins. Tap any day for the full comparison.

TODAY
Today's 13-month date with its fixed weekday and the real one, and your next events. How far the month name has drifted from the Gregorian date with the same name, how much of the year has gone, and how many days are left until Year Day.

CONVERT
Gregorian to 13-month or the other way round, including Sol, Year Day and Leap Day, for any year from 1 to 9999. You can also look up which day "October 12" names in the other calendar.

COMPARE
Gregorian months run from 28 to 31 days. These all run 28. See the month lengths side by side, a ribbon showing where the month boundaries fall, the year's Friday the 13ths, quarter lengths and how the fixed weekdays drift against the real ones.

HISTORY
One timeline for the Gregorian calendar, the International Fixed Calendar and the Positivist calendar: who proposed what, and when.

Five themes in light and dark, plus three that are always dark. On iPad, Thirteen has a sidebar, works in several windows at once and supports keyboard shortcuts.

Everything except your events works without calendar access. No account, no ads, no tracking and no in-app purchases. Thirteen makes no network connections of its own: your calendars sync through your device's accounts, and your settings stay on your device.
```

(3,035 characters.) Two claims are worded for what this build does:

- "on iPad also a week": iPhone has no Week mode (compact width shows Day instead, docs/EVENTS.md §2.1).
- "in calendars that can keep them, every 13-month month on the 12th": a release build offers the
  13-month repeats that are not plain yearly rules (form (b), docs/EVENTS.md §4.3) only in calendars on
  the device, CalDAV and other accounts, not in iCloud or Google calendars, until gates V1 and V2 pass
  (`CalendarSourcePolicy.gates` in `apple/Shared/Events/CalendarStore.swift`), and never in Exchange.
  Every Year Day and Every Leap Day work in every calendar. When those gates pass, this sentence can
  drop "in calendars that can keep them".

## Keywords (100 characters max, comma separated, no spaces)

```
planner,agenda,fixed,international,cotsworth,positivist,comte,gregorian,leap,reform,converter,ifc
```

(97 characters.) Words already in the name and subtitle ("thirteen", "13-month",
"calendar", "events", "months", "days") are left out, since App Store search indexes those fields
anyway.

## Category

- Primary: **Productivity**. Thirteen now shows, adds and edits the user's own events, which is what
  calendar apps do, and the App Store files calendar apps (Apple's Calendar among them) under
  Productivity. There is no Calendar category.
- Secondary: **Reference**. Convert, Compare and History are reference material on calendar systems,
  and they work without calendar access.

Both targets set `LSApplicationCategoryType` to `public.app-category.productivity`
(`apple/project.yml`), which matches the primary category.

## Calendar access

`apple/project.yml` sets one usage string for both apps, `NSCalendarsFullAccessUsageDescription`:

> Thirteen shows the events from your calendars in its 13-month views and saves the events you add or change to the calendar you choose.

There is no `NSCalendarsWriteOnlyAccessUsageDescription` and no legacy `NSCalendarsUsageDescription`
(full access only, TN3152). The Mac app also has the sandbox entitlement
`com.apple.security.personal-information.calendars`. `scripts/release/ios-upload.sh` and
`scripts/release/mac-dmg.sh` stop if the archived app lacks the usage string.

## Age rating questionnaire

Every answer is "None" or "No", which gives the lowest rating (4+). Events are private to the user;
"User-generated content" is about content shared with other users, so the answers do not change with
events.

| Section | Question | Answer |
|---|---|---|
| In-app controls | Parental controls | No |
| | Age assurance | No |
| Capabilities | Unrestricted web access | No |
| | User-generated content | No |
| | Messaging and chat | No |
| | Advertising | No |
| Mature themes | Profanity or crude humor | None |
| | Horror or fear themes | None |
| | Alcohol, tobacco or drug use or references | None |
| Medical or wellness | Medical or treatment information | None |
| | Health or wellness topics | No |
| Sexuality or nudity | Mature or suggestive themes, sexual content, nudity | None |
| Violence | Cartoon or fantasy violence, realistic violence, prolonged graphic or sadistic violence, guns or other weapons | None |
| Chance-based activities | Simulated gambling | None |
| | Gambling | No |
| | Contests | None |
| | Loot boxes | No |

## App Privacy

- Data collection: **"No, we do not collect data from this app."** The App Privacy section then
  shows **Data Not Collected**. Apple counts data as collected only when it leaves the device in a way
  the developer or its partners can access. Thirteen reads and writes events on the device through
  EventKit; the sync with iCloud, Google or Exchange is done by the operating system under the user's
  own accounts and never reaches Haugas Development OU (docs/EVENTS.md §7.2).
- Tracking: none. No third-party SDKs (the only package is `ThirteenKit`, this repository's own), no
  advertising identifier, no analytics, no crash reporting SDK.
- Network: the apps make no network connections. Checked on 2026-10-27 in `apple/Shared`,
  `apple/iOS`, `apple/macOS` and `apple/ThirteenKit/Sources`: no `URLSession`, `Network` framework,
  `NWConnection`, `NWPathMonitor`, `WKWebView`, `SFSafariViewController`, CloudKit, StoreKit,
  AdSupport or tracking APIs, and no `webcal` handling (the apps register only the `thirteen` URL
  scheme). The Mac app is sandboxed without `com.apple.security.network.client`, so it cannot open a
  connection at all. What leaves the app is handed to other apps by the system, on the user's tap:
  an event's URL opens in the browser, its location opens in Maps (`maps:`), "Open in Calendar" opens
  Apple's Calendar (`calshow:`), and the access cards open Settings. Subscribed calendars are fetched
  by the system's Calendar, never by Thirteen.
- Privacy policy URL: required even for apps that collect nothing (URLs below).
- Privacy manifest: `apple/Shared/Resources/PrivacyInfo.xcprivacy`, bundled by both app targets
  because `Shared` is a source path. It declares `NSPrivacyTracking` false, no tracking domains, no
  collected data types, and `NSPrivacyAccessedAPICategoryUserDefaults` with reason `CA92.1` (the app
  keeps its settings in `UserDefaults`). EventKit is not a required-reason API.
  `scripts/release/ios-upload.sh` checks the archived app for `PrivacyInfo.xcprivacy` and refuses to
  upload without it, naming that path.
- Export compliance: `ITSAppUsesNonExemptEncryption` is `NO` in the Info.plist, so App Store
  Connect does not ask the encryption questions for each build.

Answer the questionnaire again if any of this changes: a network call, an SDK, logging of event text
to anything that is uploaded (docs/EVENTS.md §1.4).

## Review notes

No demo account is needed. Contact for App Review: the account holder's details in App Store
Connect. Paste this into App Review Information, Notes (2,592 of 4,000 characters):

```
Thirteen shows the 13-month International Fixed Calendar (and Comte's Positivist calendar) next to the Gregorian calendar, with the user's own events in it. No account or demo login is needed: there is no sign-in of any kind, no in-app purchase and no content shared with other users.

Every screen is reachable from the tab bar on iPhone or the sidebar on iPad: Today, Calendar, Convert, Compare and History. The calendar switcher (International Fixed / Positivist) is in the toolbar menu. Settings is the gear button in the navigation bar on iPhone and in the sidebar on iPad.

CALENDAR ACCESS
Thirteen reads and writes the device's calendars through EventKit (full access) to show the user's events in its 13-month views and to save the events the user adds or changes. It never asks at launch. It asks only when the user taps Continue on the "See your events in 13 months" card in the Calendar tab, or taps + to add an event. The system prompt then shows the purpose string: "Thirteen shows the events from your calendars in its 13-month views and saves the events you add or change to the calendar you choose."
If access is denied, every other feature works, and the Calendar tab still shows the 13-month calendar without events, with a card that opens Settings.

HOW TO SEE EVENTS
1. Open the Calendar tab, tap Continue and allow Full Access. Events already in the device's calendars appear in Day, Month, Year and List (and Week on iPad), each day with its Gregorian date.
2. Tap +, enter a title, tap Starts and pick a 13-month date, for example 2028, Leap Day. Set Repeat to "Every Leap Day" and tap Add. The event appears in Apple's Calendar app on Saturday, June 17, 2028, and every four years after that.
3. To try it without a leap year: pick Year Day 2026 and "Every Year Day"; it appears on Thursday, December 31, 2026.
In iCloud and Google calendars this version offers only the 13-month repeats that are also plain yearly repeats, such as Every Year Day and Every Leap Day. The others are shown disabled with the note "(calendar) can't keep 13-month repeats"; they can be used in a calendar On My iPhone or in another CalDAV account.

LINKS
The app handles thirteen:// links, for example thirteen://today, thirteen://month/2026/11, thirteen://new-event?date=2026-10-19 and thirteen://convert?thirteen=2024-LD, but no feature depends on them.

PRIVACY
Thirteen makes no network connections and contains no third-party SDKs, analytics or advertising. Event data stays on the device; syncing with iCloud, Google or Exchange is done by the system's own accounts, not by Thirteen.
```

## URLs

| Field | URL |
|---|---|
| Support URL (required) | `https://thirteen.haugas.dev/support.html` |
| Privacy Policy URL (required) | `https://thirteen.haugas.dev/privacy.html` |
| Marketing URL (optional) | `https://thirteen.haugas.dev/` |

The Support and Privacy pages are `apps/web/public/support.html` and `apps/web/public/privacy.html`,
published with the web app by `.github/workflows/pages.yml`. They must be live on
`https://thirteen.haugas.dev/` before the app is submitted for review.

## Screenshots

Two sets, both made by `apple/scripts/screenshots.sh` and captured on the fake store with the mockup
data set (`fixtures/mockup/mockup-events.json`, no real accounts), today fixed to Monday, 19 October
2026 (IFC Thursday, October 12), the Almanac light theme, the status bar at 9:41 and 12-hour time
(en_US, since the listing is English (U.S.)). Both sets are retaken in en_US now that the Week and
Day timelines no longer clip the 12-hour now label ("9:41 AM" used to show as ":41 AM"); a set from
before that fix is in en_GB (24-hour time, "09:41" in the status bar) and must not be uploaded.
Upload them in this order:

| # | File | Shows |
|---|---|---|
| 1 | `01-today.png` | Today with Up next |
| 2 | `02-month.png` | Calendar, Month with events |
| 3 | `03-week.png` | iPad: the Week timeline. iPhone: the Day timeline with its week strip (compact width has no Week mode) |
| 4 | `04-editor.png` | The event editor with the 13-month repeat picker shown |
| 5 | `05-year.png` | Year with the Gregorian overlay |
| 6 | `06-convert.png` | Convert |

- iPhone 6.9-inch, exactly 1320 x 2868 px, from the iPhone 17 Pro Max simulator "Thirteen Shots
  iPhone 17 Pro Max": `docs/store/screenshots/iphone-6.9/01-today.png` to `06-convert.png`
  (`apple/scripts/screenshots.sh --store --locale en_US`).
- iPad 13-inch, exactly 2064 x 2752 px, from the iPad Pro 13-inch simulator "Thirteen Shots iPad
  Pro 13": `docs/store/screenshots/ipad-13/01-today.png` to `06-convert.png`
  (`apple/scripts/screenshots.sh --store --ipad --locale en_US`).

Passing `--locale en_US` keeps the sets in en_US whatever the script's default is (`--list` prints
the locale a run will use). `04-editor.png` comes from the UI test
`EventEditorUITests/testRepeatPicker` (the editor with the 13-month repeat picker pushed),
`06-convert.png` from the deep link `thirteen://convert?thirteen=2026-M11-12`, the others from
launch arguments.

App Store Connect scales these down for the smaller iPhone and iPad sizes. Before uploading, check each
image for a notification banner and for its exact size (`sips -g pixelWidth -g pixelHeight <file>`).
