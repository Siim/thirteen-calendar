/**
 * "Your data" of Settings > Calendar (docs/EVENTS.md §2.18, web): "Export all"
 * (the Export dialog with every calendar checked, §2.17, B6's
 * `useCalendarsDialogs().exportAll()`; it names secret links when a
 * subscription goes with them) and "Delete all
 * events", which asks "Delete every event and calendar saved in this browser?
 * This can't be undone." first, then removes every calendar of this browser,
 * local ones and subscriptions (§7.1 "Deleting your data").
 */
import { Button, Dialog, copy, useCalendars, useEventStore, useToast } from '@thirteen/ui';
import { useId, useRef, useState } from 'react';
import { useCalendarsDialogs } from '../calendar/CalendarsPane.tsx';
import own from './DataRows.module.css';
import styles from './SettingsPage.module.css';

export function DataRows() {
  const store = useEventStore();
  const calendars = useCalendars();
  const toast = useToast();
  const titleId = useId();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const empty = calendars.length === 0;

  const dialogs = useCalendarsDialogs();

  const deleteAll = async () => {
    setAsking(false);
    setBusy(true);
    toast.nextAction();
    try {
      for (const calendar of [...store.getState().calendars]) await store.deleteCalendar(calendar.id);
    } catch {
      console.warn('[thirteen] settings: delete-all-failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.row} role="group" aria-labelledby={titleId}>
      <h3 id={titleId} className={`${styles.label} ${own.heading}`}>
        {copy('settings.data')}
      </h3>
      <div className={styles.buttons}>
        <Button onClick={dialogs.exportAll} disabled={empty || busy}>
          {copy('settings.exportAll')}
        </Button>
        <Button ref={deleteButton} onClick={() => setAsking(true)} disabled={empty || busy}>
          {copy('settings.deleteAll')}
        </Button>
      </div>
      <Dialog
        open={asking}
        role="alertdialog"
        size="sm"
        compact="center"
        title={copy('settings.deleteAll.message')}
        onRequestClose={() => setAsking(false)}
        returnFocus={deleteButton}
        footer={
          <>
            <Button onClick={() => setAsking(false)} data-autofocus>
              {copy('editor.cancel')}
            </Button>
            <Button variant="solid" onClick={() => void deleteAll()}>
              {copy('settings.deleteAll')}
            </Button>
          </>
        }
      />
    </div>
  );
}
