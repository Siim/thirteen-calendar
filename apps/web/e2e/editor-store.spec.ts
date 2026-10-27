import { type Page, expect, test } from '@playwright/test';

/**
 * Details and the editor on the IndexedDB store with events another app made (docs/EVENTS.md §2.10,
 * §2.11, §2.13, §4.7; task B5): a repeat set in another app (two RRULEs, `editable: false`) shows
 * "Keep: ..." and saves for this event only or for all events, and a new date applies to this event
 * only; a series that starts before 1583 (`historical`) offers only Delete event and Edit alerts, and
 * changing a series' alerts is an "all events" change with no Undo.
 */

test.use({ locale: 'en-GB', timezoneId: 'Europe/Tallinn', reducedMotion: 'reduce', viewport: { width: 1280, height: 900 } });
// Each test imports a file into IndexedDB first; give a loaded machine room (as views.spec.ts does).
test.describe.configure({ timeout: 90_000 });

const FILE = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Example Corp//Calendar Export 4.2//EN',
  'X-WR-CALNAME:Other app',
  'BEGIN:VEVENT',
  'UID:b5-foreign@example.com',
  'DTSTAMP:20261015T080000Z',
  'SUMMARY:Board call',
  'DTSTART;TZID=Europe/Tallinn:20261001T100000',
  'DTEND;TZID=Europe/Tallinn:20261001T110000',
  'RRULE:FREQ=WEEKLY;BYDAY=TH;UNTIL=20261231T215959Z',
  'RRULE:FREQ=MONTHLY;BYMONTHDAY=20;COUNT=4',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:b5-founding@example.com',
  'DTSTAMP:20261015T080000Z',
  'SUMMARY:Founding day',
  'DTSTART;VALUE=DATE:15001019',
  'DTEND;VALUE=DATE:15001020',
  'RRULE:FREQ=YEARLY',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n');

const occurrence = (page: Page, uid: string, start: string) => page.locator(`[data-key*="/${uid}|${start}"]`).first();

async function importFile(page: Page): Promise<void> {
  await page.goto('/#/list/2026-10-01');
  const pane = page.locator('[data-calendars-pane]').first();
  await expect(pane.getByRole('button', { name: 'Import .ics file' })).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await pane.getByRole('button', { name: 'Import .ics file' }).click();
  await (await chooser).setFiles([{ name: 'other-app.ics', mimeType: 'text/calendar', buffer: Buffer.from(FILE) }]);
  const box = page.getByRole('dialog', { name: 'Import events' });
  await expect(box.getByText('2 events in other-app.ics')).toBeVisible();
  await box.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByText('Added 2, updated 0, unchanged 0.').first()).toBeVisible();
  await expect(occurrence(page, 'b5-foreign@example.com', '2026-10-22T10:00')).toBeVisible();
}

test('a repeat set in another app: Keep, this event or all events, and a new date for this event only (§2.11, §2.13)', async ({ page }) => {
  await importFile(page);
  await occurrence(page, 'b5-foreign@example.com', '2026-10-22T10:00').click();
  await page.getByRole('dialog', { name: 'Board call' }).getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit event' });
  await editor.getByRole('button', { name: /^Repeat / }).click();
  const keep = page.getByRole('radiogroup', { name: 'Repeat' }).getByRole('radio').first();
  await expect(keep).toHaveAccessibleName(/^Keep: /);
  await expect(keep).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(editor.getByRole('combobox', { name: 'End repeat' })).toBeDisabled();

  await editor.getByLabel('Title').fill('Board call (video)');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  const asked = page.getByRole('alertdialog', { name: 'This is a repeating event.' });
  await expect(asked.getByText('Its repeat was set in another app. Save your changes for this event only, or for all events?')).toBeVisible();
  await expect(asked.getByRole('button')).toHaveText(['Save for this event only', 'Save for all events', 'Cancel']);
  await asked.getByRole('button', { name: 'Save for all events' }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByText('Event saved.').first()).toBeVisible();
  // "All events" is never undoable (§2.11 table).
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);
  // Every occurrence has the new title, and the series keeps its own first date.
  for (const start of ['2026-10-01T10:00', '2026-10-20T10:00', '2026-10-22T10:00']) {
    await expect(occurrence(page, 'b5-foreign@example.com', start)).toContainText('Board call (video)');
  }

  // A new date on such a series applies to this event only.
  await occurrence(page, 'b5-foreign@example.com', '2026-10-29T10:00').click();
  await page.getByRole('dialog', { name: 'Board call (video)' }).getByRole('button', { name: 'Edit', exact: true }).click();
  const start = editor.getByRole('button', { name: /^Starts, / });
  await start.focus();
  await page.keyboard.type('2026-10-30');
  await page.keyboard.press('Enter');
  await expect(start).toHaveAccessibleName(/Gregorian Friday, October 30, 2026$/);
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  const dateAsked = page.getByRole('alertdialog', { name: 'This is a repeating event.' });
  await expect(dateAsked.getByText('Its repeat was set in another app, so a new date can apply to this event only.')).toBeVisible();
  await expect(dateAsked.getByRole('button')).toHaveText(['Save for this event only', 'Cancel']);
  await dateAsked.getByRole('button', { name: 'Save for this event only' }).click();
  await expect(editor).toBeHidden();
  await expect(occurrence(page, 'b5-foreign@example.com', '2026-10-29T10:00')).toContainText('Board call (video)');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
});

test('a series that starts before 1583: Delete event and Edit alerts only, and its alerts change with no Undo (§2.10, §3.5)', async ({ page }) => {
  await importFile(page);
  await page.goto('/#/list/2026-10-19');
  const row = occurrence(page, 'b5-founding@example.com', '2026-10-19');
  await row.click();
  const details = page.getByRole('dialog', { name: 'Founding day' });
  await expect(details.getByText(/can’t change events that start before 1583, except to delete them or change their alerts\./)).toBeVisible();
  await expect(details.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  await expect(details.getByRole('button', { name: 'Delete event' })).toBeVisible();

  // Delete this event only, then Undo: nothing was written.
  await details.getByRole('button', { name: 'Delete event' }).click();
  const asked = page.getByRole('alertdialog', { name: 'This is a repeating event.' });
  await expect(asked.getByRole('button')).toHaveText(['Delete this event only', 'Delete all future events', 'Cancel']);
  await asked.getByRole('button', { name: 'Delete this event only' }).click();
  await expect(row).toHaveCount(0);
  await expect(page.getByText('Event deleted.').first()).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(row).toBeVisible();

  const supported = await page.evaluate(() => 'Notification' in window && 'serviceWorker' in navigator && navigator.serviceWorker !== undefined);
  await row.click();
  const editAlerts = details.getByRole('button', { name: 'Edit alerts' });
  if (!supported) {
    // §2.14: where the browser can't show alerts the pickers are hidden, so Edit alerts is not offered.
    await expect(editAlerts).toHaveCount(0);
    return;
  }
  await editAlerts.click();
  const editor = page.getByRole('dialog', { name: 'Edit alerts' });
  await expect(editor.getByLabel('Title')).toHaveCount(0);
  await editor.getByRole('combobox', { name: 'Alert' }).selectOption({ label: 'On the day at 09:00' });
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByText('Event saved.').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);
  await row.click();
  await expect(details.getByText('On the day at 09:00')).toBeVisible();
});
