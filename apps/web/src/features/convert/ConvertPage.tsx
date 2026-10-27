import {
  type CalendarSystemId,
  type GregorianDate,
  type ThirteenDate,
  convertThirteen,
  formatGregorian,
  formatThirteen,
  toISODate,
  toThirteen,
  tryParseThirteen,
} from '@thirteen/core';
import {
  Button,
  ComparisonCard,
  ComparisonTable,
  DatePlate,
  SectionHeading,
  useCalendarSystem,
  useComparison,
  useToday,
} from '@thirteen/ui';
import { useEffect, useRef } from 'react';
import { PageHeader } from '../../app/PageHeader.tsx';
import { navigate } from '../../app/router.ts';
import { useDocumentTitle } from '../../lib/useDocumentTitle.ts';
import { type ConvertParams, gregorianRoute, resolveConvertState, thirteenRoute } from './convertState.ts';
import { GregorianInput } from './GregorianInput.tsx';
import { LabelLookups } from './LabelLookups.tsx';
import { NotablePicks } from './NotablePicks.tsx';
import { ThirteenPicker } from './ThirteenPicker.tsx';
import styles from './ConvertPage.module.css';

/** History-state flag: this history entry's `?system=` has already been handled. */
const SYSTEM_HANDLED = 'thirteen.systemHandled';

/**
 * True the first time it is called for the current history entry, which it
 * then marks (in `history.state`, so the mark survives Back/Forward and reloads).
 */
function firstVisitOfEntry(): boolean {
  const state: unknown = window.history.state;
  const record = typeof state === 'object' && state !== null ? (state as Record<string, unknown>) : null;
  if (record?.[SYSTEM_HANDLED] === true) return false;
  window.history.replaceState({ ...record, [SYSTEM_HANDLED]: true }, '');
  return true;
}

/** §5.3 Convert: two-way converter with label lookups, the full breakdown and quick picks. URL-synced. */
export function ConvertPage(params: ConvertParams) {
  const today = useToday();
  const { systemId, system, setSystemId } = useCalendarSystem();
  const state = resolveConvertState(params, systemId, today);
  const comparison = useComparison(state.gregorian, systemId);

  // A shared ?system= link selects that system once, when it is opened. Coming back to the same history entry
  // later (Back/Forward, after switching systems elsewhere) keeps the reader's current choice: the page then
  // reads the link's date in that system.
  useEffect(() => {
    if (!firstVisitOfEntry()) return;
    if (params.system !== null && params.thirteen !== null && params.system !== systemId) setSystemId(params.system);
  }, [params.system, params.thirteen, systemId, setSystemId]);

  // Switching systems while a 13-month date is the input: re-express it in the new system.
  const previousSystem = useRef<CalendarSystemId>(systemId);
  useEffect(() => {
    const before = previousSystem.current;
    previousSystem.current = systemId;
    if (before === systemId || params.thirteen === null) return;
    const parsed = tryParseThirteen(params.thirteen, params.system ?? before);
    if (parsed && parsed.system !== systemId) navigate(thirteenRoute(convertThirteen(parsed, systemId)), { replace: true });
  }, [systemId, params.thirteen, params.system]);

  useDocumentTitle(`Convert ${formatGregorian(state.gregorian, { style: 'medium' })}`);

  const setGregorian = (date: GregorianDate) => navigate(gregorianRoute(date), { replace: true });
  const setThirteen = (date: ThirteenDate) => navigate(thirteenRoute(date), { replace: true });
  const swap = () => (state.source === 'gregorian' ? setThirteen(state.thirteen) : setGregorian(state.gregorian));

  const fromGregorian = state.source === 'gregorian';

  return (
    <div className={styles.page}>
      <PageHeader
        mark="§ III"
        kicker="Convert"
        title={
          <>
            Two calendars, <em>one day</em>
          </>
        }
        lede={`Enter a Gregorian date to read it in the ${system.name}, or pick a 13-month date (${
          system.id === 'ifc' ? 'any month, Sol and the intercalary days included' : 'any of the thirteen months or the festival days'
        }) to find its Gregorian twin.`}
      />

      <div>
        <section className={styles.converter} aria-label="Converter">
          <div className={styles.pane}>
            <h2 className={styles.paneTitle}>
              <span>From</span> {fromGregorian ? 'the Gregorian calendar' : `the ${system.shortName}`}
            </h2>
            {fromGregorian ? (
              <GregorianInput value={state.gregorian} today={today} onChange={setGregorian} />
            ) : (
              <ThirteenPicker value={state.thirteen} onChange={setThirteen} />
            )}
          </div>
          <div className={styles.swapColumn}>
            <div className={styles.swapInner}>
              <Button iconOnly icon="swap" onClick={swap} title="Swap the direction">
                {fromGregorian ? `Swap: enter a ${system.shortName} date instead` : 'Swap: enter a Gregorian date instead'}
              </Button>
              <span className={styles.swapHint} aria-hidden="true">
                swap
              </span>
            </div>
          </div>
          <div className={`${styles.pane} ${styles.paneOutput}`} aria-live="polite">
            <h2 className={styles.paneTitle}>
              <span>To</span> {fromGregorian ? `the ${system.shortName}` : 'the Gregorian calendar'}
            </h2>
            {fromGregorian ? (
              <DatePlate date={state.thirteen} size="lg" kicker={null} />
            ) : (
              <DatePlate date={state.gregorian} size="lg" kicker={null} />
            )}
            <p className={styles.resultCode}>
              <span>
                ISO <b>{toISODate(state.gregorian)}</b>
              </span>
              <span>
                {system.shortName} <b>{formatThirteen(state.thirteen, { style: 'numeric' })}</b>
              </span>
            </p>
          </div>
        </section>
        {state.error ? (
          <p className={styles.error} role="alert">
            {state.error} Showing today instead.
          </p>
        ) : null}
      </div>

      <section className={styles.section} aria-labelledby="label-lookup">
        <SectionHeading
          numeral="§ 1"
          id="label-lookup"
          title={
            <>
              Read this label <em>in the other calendar</em>
            </>
          }
          lede="The same month name and day number point to different days in the two calendars."
        />
        <LabelLookups
          source={state.source}
          gregorian={state.gregorian}
          thirteen={state.thirteen}
          onPickGregorian={setGregorian}
          onPickThirteen={setThirteen}
        />
      </section>

      <section className={styles.section} aria-labelledby="breakdown">
        <SectionHeading
          numeral="§ 2"
          id="breakdown"
          title={
            <>
              The full <em>comparison</em>
            </>
          }
        />
        <div className={styles.breakdown}>
          <ComparisonCard comparison={comparison} />
          <ComparisonTable comparison={comparison} />
        </div>
      </section>

      <section className={styles.section} aria-labelledby="notable">
        <SectionHeading
          numeral="§ 3"
          id="notable"
          title={
            <>
              Notable dates <em>in {state.gregorian.year}</em>
            </>
          }
          lede={`Fixed-date days of the Gregorian year and where they land in the ${system.shortName}. Pick one to convert it.`}
        />
        <NotablePicks
          year={state.gregorian.year}
          systemId={systemId}
          current={state.gregorian}
          onPick={(date) => (fromGregorian ? setGregorian(date) : setThirteen(toThirteen(date, systemId)))}
        />
      </section>
    </div>
  );
}
