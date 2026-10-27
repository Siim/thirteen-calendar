import SwiftUI
import ThirteenKit

// The access cards of docs/EVENTS.md §2.16 (board E): which card applies is
// `model.events.accessCard` (`CalendarAccess.card`); "Continue" is `await model.events.requestAccess()`
// (the system prompt), "Open Settings" / "Open System Settings" `CalendarAccess.openSystemSettings()`.
// Month (above the day list on compact, the top banner on regular), Week, Day and List show
// `CalendarAccessBanner`; Today's Up next holds the card's content (`AccessCardView(style:
// .embedded)`) and, after 3 launches without a decision, the one-line link `AccessLinkCard` ("See
// your events here"), which expands into the card. Never a modal, never at launch.

/// The card for the current access state above Month's day list, Week, Day and List, or nothing.
struct CalendarAccessBanner: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if let card = model.events.accessCard {
            AccessCardView(card: card)
        }
    }
}

/// One access card (board E): an icon tile, the title, the body and the state's one button.
struct AccessCardView: View {
    enum Style {
        /// A card of its own (Calendar's modes).
        case standalone
        /// The content only, inside another card (Today's Up next, §2.8).
        case embedded
    }

    let card: CalendarAccess.Card
    var style: Style = .standalone

    @Environment(AppModel.self) private var model
    @State private var isRequesting = false

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            if let symbol = Self.symbol(card) {
                Image(systemName: symbol)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Palette.accentText)
                    .frame(width: 36, height: 36)
                    .background(Palette.accentWash, in: .rect(cornerRadius: 10))
                    .padding(.bottom, Spacing.xxs)
                    .accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(Self.title(card))
                    .titleFont(.headline)
                    .foregroundStyle(Palette.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                Text(Self.body(card))
                    .font(Typography.text(.footnote))
                    .lineSpacing(3)
                    .foregroundStyle(Palette.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let button = Self.buttonTitle(card) {
                Button(button) { act() }
                    .buttonStyle(AccessPillButtonStyle())
                    .disabled(isRequesting)
                    .padding(.top, Spacing.xs)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .modifier(AccessCardChrome(style: style))
        .accessibilityElement(children: .contain)
    }

    private func act() {
        switch card {
        case .notAsked:
            isRequesting = true
            Task {
                await model.events.requestAccess()
                isRequesting = false
            }
        case .denied, .writeOnly:
            CalendarAccess.openSystemSettings()
        case .restricted, .noCalendars:
            break
        }
    }

    /// `access.openSettings` (Mac: "Open System Settings").
    static var settingsButton: String { CalendarAccess.settingsButton }

    /// The card's one button, or none.
    static func buttonTitle(_ card: CalendarAccess.Card) -> String? { CalendarAccess.buttonTitle(card) }

    /// The icon tile of board E, or none.
    static func symbol(_ card: CalendarAccess.Card) -> String? { CalendarAccess.symbol(card) }

    /// `access.*.title` (§2.19).
    static func title(_ card: CalendarAccess.Card) -> String { CalendarAccess.title(card) }

    /// `access.*.body` (§2.19), Apple forms, for this device.
    static func body(_ card: CalendarAccess.Card) -> String { CalendarAccess.body(card, device: CalendarAccess.deviceName) }
}

/// `today.seeEvents`: the one-line link Today's Up next collapses to after 3 launches without a
/// decision (§2.16 card persistence, board E2). It expands into the card.
struct AccessLinkCard: View {
    let expand: () -> Void

    var body: some View {
        Button(action: expand) {
            HStack(spacing: Spacing.m) {
                Image(systemName: "calendar")
                    .font(.system(size: 15, weight: .semibold))
                    .accessibilityHidden(true)
                Text("See your events here")
                    .font(Typography.text(.subheadline, weight: .semibold))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Palette.inkTertiary)
                    .accessibilityHidden(true)
            }
            .foregroundStyle(Palette.controlTint)
            .padding(.horizontal, Spacing.l)
            .padding(.vertical, Spacing.m)
            .frame(minHeight: 44)
            .background(Palette.paperRaised, in: .rect(cornerRadius: 14))
            .overlay { RoundedRectangle(cornerRadius: 14).strokeBorder(Palette.rule, lineWidth: 1) }
            .contentShape(.rect(cornerRadius: 14))
        }
        .buttonStyle(.plain)
    }
}

/// The card's background and outline (standalone), or nothing (embedded in another card).
private struct AccessCardChrome: ViewModifier {
    let style: AccessCardView.Style

    func body(content: Content) -> some View {
        switch style {
        case .standalone:
            content
                .padding(.horizontal, Spacing.l + 2)
                .padding(.vertical, Spacing.l)
                .background(Palette.paperRaised, in: .rect(cornerRadius: 20))
                .overlay { RoundedRectangle(cornerRadius: 20).strokeBorder(Palette.rule, lineWidth: 1) }
        case .embedded:
            content
        }
    }
}

/// The card's pill button (board E `.pillbtn`): the control tint with white text in light mode
/// (5.9:1 or more in every theme) and with the on-accent ink in dark mode (5.4:1 or more; white
/// would be about 3.3:1 there). 36 pt high inside a 44 pt target.
struct AccessPillButtonStyle: ButtonStyle {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.appTheme) private var theme

    func makeBody(configuration: Configuration) -> some View {
        let shape = RoundedRectangle(cornerRadius: dynamicTypeSize.isAccessibilitySize ? Radius.control : 18, style: .continuous)
        configuration.label
            .font(Typography.text(.subheadline, weight: .semibold))
            .multilineTextAlignment(.leading)
            .fixedSize(horizontal: false, vertical: true)
            .foregroundStyle(colorScheme == .dark ? Palette.onAccent.color(for: theme) : Color.white)
            .padding(.horizontal, Spacing.l)
            .padding(.vertical, Spacing.s)
            .frame(minHeight: 36)
            .background(Palette.controlTint, in: shape)
            .opacity(isEnabled ? (configuration.isPressed ? 0.75 : 1) : 0.5)
            .padding(.vertical, Spacing.xs)
            .contentShape(.rect)
    }
}
