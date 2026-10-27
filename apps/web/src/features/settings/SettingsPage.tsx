import { Button, Switch, copy, useCalendars } from '@thirteen/ui';
import { useId, useState } from 'react';
import { KEYBOARD_HELP_TITLE, KeyboardHelp } from '../calendar/KeyboardHelp.tsx';
import { useDocumentTitle } from '../../lib/useDocumentTitle.ts';
import { useDefaultCalendar, useSingleKeyShortcuts, useYearDots } from '../../lib/preferences.ts';
import { AlertsRow } from './AlertsRow.tsx';
import { DataRows } from './DataRows.tsx';
import styles from './SettingsPage.module.css';

/** "Default calendar" (§2.18): a picker of writable calendars, grouped by account, and where new events go. */
function DefaultCalendarRow() {
  const calendars = useCalendars();
  const [current, setCurrent] = useDefaultCalendar(calendars);
  const id = useId();
  const footerId = `${id}-footer`;
  const writable = calendars.filter((calendar) => calendar.writable);
  const groups = [...new Set(writable.map((calendar) => calendar.accountTitle))];
  return (
    <div className={styles.row}>
      <div className={styles.field}>
        <label htmlFor={id} className={styles.label}>
          {copy('settings.defaultCalendar')}
        </label>
        <select
          id={id}
          className={styles.select}
          value={current?.id ?? ''}
          disabled={writable.length === 0}
          aria-describedby={current !== null ? footerId : undefined}
          onChange={(event) => setCurrent(event.currentTarget.value)}
        >
          {groups.map((group) => (
            <optgroup key={group} label={group}>
              {writable
                .filter((calendar) => calendar.accountTitle === group)
                .map((calendar) => (
                  <option key={calendar.id} value={calendar.id}>
                    {calendar.title}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </div>
      {current !== null ? (
        <p id={footerId} className={styles.footer}>
          {copy('settings.defaultCalendar.footer', { name: current.title })}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The web's Settings page (`#/settings`, docs/EVENTS.md §2.18): the Calendar
 * group. Theme and system stay in the header. The Alerts row and the Your data
 * rows are their own modules (./AlertsRow.tsx, ./DataRows.tsx).
 */
export function SettingsPage() {
  useDocumentTitle(copy('settings.title.web'));
  const [yearDots, setYearDots] = useYearDots();
  const [singleKey, setSingleKey] = useSingleKeyShortcuts();
  const singleKeyFooter = useId();
  const [helpOpen, setHelpOpen] = useState(false);
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{copy('settings.title.web')}</h1>
      <section className={styles.group} aria-labelledby="settings-calendar">
        <h2 id="settings-calendar" className={styles.groupTitle}>
          {copy('settings.group')}
        </h2>
        <DefaultCalendarRow />
        <div className={styles.row}>
          <Switch checked={yearDots} onChange={setYearDots} label={copy('settings.yearDots')} />
        </div>
        <AlertsRow />
        <div className={styles.row}>
          <Switch
            checked={singleKey}
            onChange={setSingleKey}
            label={copy('settings.singleKey')}
            description={copy('settings.singleKey.footer')}
          />
          <p className={styles.footer} id={singleKeyFooter} aria-hidden="true">
            {copy('settings.singleKey.footer')}
          </p>
          <div className={styles.buttons}>
            <Button size="sm" onClick={() => setHelpOpen(true)}>
              {KEYBOARD_HELP_TITLE}
            </Button>
          </div>
          <KeyboardHelp open={helpOpen} onClose={() => setHelpOpen(false)} singleKey={singleKey} />
        </div>
        <DataRows />
      </section>
    </div>
  );
}
