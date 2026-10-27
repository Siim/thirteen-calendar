import { type GregorianDate, formatThirteen, intercalaryDaysInYear, toThirteen } from '@thirteen/core';
import { ComparisonTable, DatePlate, Dialog, IntercalaryDayToken, copy, useCalendarSystem, useComparison } from '@thirteen/ui';

function Content({ date }: { readonly date: GregorianDate }) {
  const { systemId } = useCalendarSystem();
  const comparison = useComparison(date, systemId);
  const thirteen = comparison.thirteen;
  const occurrence =
    thirteen.kind === 'intercalary'
      ? (intercalaryDaysInYear(date.year, systemId).find((d) => d.id === thirteen.id) ?? null)
      : null;
  return (
    <>
      {occurrence ? (
        <IntercalaryDayToken occurrence={occurrence} variant="plate" />
      ) : (
        <DatePlate date={thirteen} size="md" kicker={null} />
      )}
      <ComparisonTable comparison={comparison} variant="compact" />
    </>
  );
}

/**
 * "Day details" from a Month cell's context menu (§2.4): the day's comparison,
 * the same breakdown as Year mode's day sheet, in a dialog.
 */
export function DayDetailsDialog({ date, onClose }: { readonly date: GregorianDate | null; readonly onClose: () => void }) {
  const { systemId } = useCalendarSystem();
  return (
    <Dialog
      open={date !== null}
      onRequestClose={onClose}
      title={
        date === null ? copy('calendar.menu.dayDetails') : formatThirteen(toThirteen(date, systemId), { includeWeekday: true })
      }
      closeButton
      size="md"
    >
      {date !== null ? <Content date={date} /> : null}
    </Dialog>
  );
}
