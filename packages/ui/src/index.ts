/**
 * `@thirteen/ui`: React components, hooks and design tokens for Thirteen,
 * a rational almanac of the 13-month year. Pair with
 * `import '@thirteen/ui/styles.css'` once at the app root.
 * @packageDocumentation
 */

// Hooks & providers
export {
  type CalendarSystemContextValue,
  type CalendarSystemProviderProps,
  CalendarSystemProvider,
  SYSTEM_STORAGE_KEY,
  useCalendarSystem,
  useOptionalCalendarSystem,
} from './hooks/CalendarSystemProvider.tsx';
export {
  type ResolvedTheme,
  type ThemeContextValue,
  type ThemePreference,
  type ThemeProviderProps,
  PALETTE_STORAGE_KEY,
  THEME_PAPER,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  ThemeProvider,
  isThemePreference,
  themeBootScript,
  useTheme,
} from './hooks/useTheme.tsx';
export { type TodayProviderProps, TodayProvider, useClockToday, useToday } from './hooks/useToday.tsx';
export {
  useComparison,
  useDaysUntilYearDay,
  useGregorianMonthLayout,
  useGregorianYearLayouts,
  useMonthAlignment,
  useMonthLayout,
  useNotableDates,
  useThirteenSlots,
  useYearLayout,
  useYearStats,
} from './hooks/useCalendarData.ts';
export { type RovingFocus, useRovingFocus } from './hooks/useRovingFocus.ts';
export {
  EventStoreProvider,
  type EventStoreProviderProps,
  type UseOccurrencesOptions,
  useCalendars,
  useEventStore,
  useEventStoreState,
  useOccurrences,
  useOptionalEventStore,
} from './hooks/useEvents.ts';

// Event store (docs/EVENTS.md §6.5): the contract, the in-memory store and the mockup data set (§6.7)
export {
  type CalendarPatch,
  type DeleteRequest,
  type EditSpan,
  type EventStore,
  EventStoreError,
  type EventStoreErrorCode,
  type EventStoreState,
  type EventStoreStatus,
  type HeldRequest,
  type NewCalendar,
  type PendingChange,
  type ResolvedOccurrence,
  type SaveRequest,
  type StoreCalendar,
  type StoreOccurrence,
  type StoreSubscription,
  type WriteResult,
  type YearSnapshot,
} from './events/store.ts';
export { CALENDAR_PALETTE, MemoryEventStore, type MemoryEventStoreOptions } from './events/MemoryEventStore.ts';
export {
  type MockupAccounts,
  type MockupData,
  type MockupEventStoreOptions,
  createMockupEventStore,
  mockupCalendars,
  mockupData,
} from './events/mockup.ts';
export { deviceTimeZone, intlZoneResolver } from './events/intlZones.ts';
export { compareOccurrences, occurrenceKey, parseOccurrenceKey } from './events/order.ts';

// Event views (docs/EVENTS.md §2.3, §2.4, §2.7, §6.5): copy, labels and the Month and List components
export { COPY, type CopyId, type PluralCopy, copy, fill, plural } from './events/copy.ts';
export {
  type FlagOptions,
  bandLabel,
  barDate,
  barLabel,
  dayCount,
  formatTime,
  formatTimeRange,
  gregorianDayCaption,
  itemLabel,
  lastDay,
  monthCellLabel,
  occurrenceFlags,
  occurrenceTimeRange,
  prefers24HourClock,
  rowLabel,
  thirteenDayHeading,
} from './events/format.ts';
export { EventChip, type EventChipProps } from './events/EventChip.tsx';
export {
  type TimelineColumn,
  type TimelineCreate,
  type TimelineDays,
  type TimelinePreview,
  type TimelineProps,
  Timeline,
  WeekStrip,
  type WeekStripProps,
  columnLabel,
  stripDays,
} from './events/Timeline.tsx';
export {
  type MonthDensity,
  MonthEventGrid,
  type MonthEventGridProps,
  type MonthTarget,
} from './events/MonthEventGrid.tsx';
export { IntercalaryEventBand, type IntercalaryEventBandProps } from './events/IntercalaryEventBand.tsx';
export { type MonthDayLine, MonthDayList, type MonthDayListProps, monthDayLines } from './events/MonthDayList.tsx';
export {
  AgendaList,
  type AgendaListProps,
  AgendaRow,
  type AgendaRowProps,
  AgendaRows,
  type AgendaRowsProps,
  DayHeading,
  agendaMonthOf,
  agendaMonthTitle,
  agendaRowDetail,
  agendaRowTime,
  isInProgress,
} from './events/AgendaList.tsx';
export { ClockProvider, type ClockProviderProps, useNow, useUse24Hour } from './hooks/useClock.tsx';
export { useOccurrencesInYears } from './hooks/useOccurrencesInYears.ts';

// Event details, editor, date field, pickers, span questions and undo (§2.10 to §2.14, B5)
export * from './events/editor/index.ts';
export type { EventSnapshot, StoreCommitCause, StoreCommitFailure, StoreFailedCommit } from './events/store.ts';
// Today's Up next (§2.8, B7)
export {
  UP_NEXT_DAYS,
  UP_NEXT_MAX_ROWS,
  type UpNextGroup,
  type UpNextOptions,
  type UpNextResult,
  upNext,
} from './events/upNext.ts';
export { UpNextCard, type UpNextCardProps, UpNextDayHeading, upNextLinkClass } from './events/UpNextCard.tsx';
export { type UpNextState, useUpNext } from './hooks/useUpNext.ts';

// Primitives
export { Button, type ButtonProps } from './primitives/Button.tsx';
export { Dialog, type DialogCloseReason, type DialogProps } from './primitives/Dialog.tsx';
export { Icon, type IconName, type IconProps } from './primitives/Icon.tsx';
export {
  Menu,
  type MenuEntry,
  type MenuItem,
  MenuList,
  type MenuListProps,
  type MenuProps,
  type MenuSeparator,
} from './primitives/Menu.tsx';
export {
  FOCUSABLE_SELECTOR,
  Popover,
  type PopoverAnchor,
  type PopoverCloseReason,
  type PopoverPlacement,
  type PopoverPoint,
  type PopoverPosition,
  type PopoverProps,
  computePopoverPosition,
} from './primitives/Popover.tsx';
export {
  TOAST_DURATION_MS,
  TOAST_DURATION_WITH_ACTION_MS,
  type ToastAction,
  type ToastApi,
  type ToastCloseReason,
  type ToastHandle,
  type ToastOptions,
  ToastProvider,
  type ToastProviderProps,
  useToast,
} from './primitives/Toast.tsx';
export {
  SegmentedControl,
  type SegmentedControlProps,
  type SegmentedOption,
} from './primitives/SegmentedControl.tsx';
export { Switch, type SwitchProps } from './primitives/Switch.tsx';
export {
  Kicker,
  type KickerProps,
  Ordinal,
  Rule,
  SectionHeading,
  type SectionHeadingProps,
  Stat,
  type StatProps,
} from './primitives/Typeset.tsx';
export { VisuallyHidden, type VisuallyHiddenProps } from './primitives/VisuallyHidden.tsx';
export { YearStepper, type YearStepperProps } from './primitives/YearStepper.tsx';

// Calendar components
export { BlankCell, type CellSize, DateCell, type DateCellProps } from './components/DateCell/DateCell.tsx';
export {
  type DayMarks,
  type SharedRoving,
  ThirteenMonthGrid,
  type ThirteenMonthGridProps,
} from './components/ThirteenMonthGrid/ThirteenMonthGrid.tsx';
export { ThirteenYearGrid, type ThirteenYearGridProps } from './components/ThirteenYearGrid/ThirteenYearGrid.tsx';
export {
  IntercalaryDayToken,
  type IntercalaryDayTokenProps,
} from './components/IntercalaryDayToken/IntercalaryDayToken.tsx';
export {
  GregorianMonthGrid,
  type GregorianMonthGridProps,
} from './components/GregorianMonthGrid/GregorianMonthGrid.tsx';
export { SystemSwitcher, type SystemSwitcherProps } from './components/SystemSwitcher/SystemSwitcher.tsx';
export { ThemeToggle, type ThemeToggleProps } from './components/ThemeToggle/ThemeToggle.tsx';
export { ThemePicker, type ThemePickerProps } from './components/ThemePicker/ThemePicker.tsx';
export { MonthLengthBars, type MonthLengthBarsProps } from './components/MonthLengthBars/MonthLengthBars.tsx';
export {
  MonthBoundaryRibbon,
  type MonthBoundaryRibbonProps,
} from './components/MonthBoundaryRibbon/MonthBoundaryRibbon.tsx';
export {
  type WeekdayDriftRow,
  WeekdayDriftStrip,
  type WeekdayDriftStripProps,
} from './components/WeekdayDriftStrip/WeekdayDriftStrip.tsx';
export { ComparisonTable, type ComparisonTableProps } from './components/Comparison/ComparisonTable.tsx';
export { ComparisonCard, type ComparisonCardProps } from './components/Comparison/ComparisonCard.tsx';
export { YearProgress, type YearProgressProps } from './components/YearProgress/YearProgress.tsx';
export { DatePlate, type DatePlateProps } from './components/DatePlate/DatePlate.tsx';

// Helpers
export { cx } from './lib/cx.ts';
export {
  describeYearLength,
  formatPercent,
  gregorianToday,
  msUntilNextLocalMidnight,
  ordinalParts,
  pluralDays,
  sameGregorian,
} from './lib/dates.ts';
export {
  type Explanation,
  explainLabelDrift,
  explainMissingLabel,
  explainWeekdayShift,
  explainYearDayCountdown,
} from './lib/explain.ts';
export {
  dayAriaLabel,
  gregorianDayAriaLabel,
  gregorianLabel,
  systemShortName,
  thirteenLabel,
  withoutDashes,
} from './lib/labels.ts';
export {
  type NavigationKey,
  type ThirteenNavigationOptions,
  isNavigationKey,
  navigateGregorianMonth,
  navigateThirteen,
} from './lib/navigation.ts';
export { cssVars, reveal, type RevealKind } from './lib/reveal.ts';
export { readStorage, writeStorage } from './lib/storage.ts';
export {
  DEFAULT_PALETTE,
  PALETTE_GROUPS,
  PALETTE_IDS,
  PALETTES,
  type Palette,
  type PaletteColors,
  type PaletteGroup,
  type PaletteScheme,
  type ThemeMode,
  getPalette,
  isPaletteId,
  markHoleRole,
  paletteForcedMode,
  palettePaper,
} from './lib/palettes.ts';
export { applyColorSchemeMeta, applyThemeColor } from './lib/themeBoot.ts';

// The Calendars list and its dialogs, Windows and web (§2.15 to §2.17, B6).
export * from './events/calendars/index.ts';
