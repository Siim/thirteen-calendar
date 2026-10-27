/**
 * The Alerts row of Settings > Calendar (docs/EVENTS.md §2.18, §2.14, web):
 * the switch "Show alerts" with its footer ("Alerts appear only while Thirteen
 * is open in a browser tab.", on phones and tablets "On phones and tablets,
 * alerts appear only while Thirteen is on screen."), or, where the browser
 * can't show alerts from web pages, that line instead of the switch.
 *
 * Turning the switch on asks for the notification permission (from the click)
 * and registers `alerts-sw.js`; turning it off unregisters it
 * (`lib/events/alerts.ts`). While the browser blocks notifications the switch
 * stays off and the row says so with `alert.web.blocked`.
 */
import { Switch, copy } from '@thirteen/ui';
import { useAlerts } from '../../lib/events/useAlerts.ts';
import styles from './SettingsPage.module.css';

export function AlertsRow() {
  const alerts = useAlerts();
  if (!alerts.supported) {
    return (
      <div className={styles.row} data-alerts-row="unsupported">
        <p className={styles.footer}>{copy('alert.web.unsupported')}</p>
      </div>
    );
  }
  const footer = alerts.mobile ? copy('settings.alerts.web.footer.mobile') : copy('settings.alerts.web.footer');
  const blocked = alerts.preference === 'on' && alerts.permission === 'denied';
  return (
    <div className={styles.row} data-alerts-row="supported">
      <Switch
        checked={alerts.enabled}
        onChange={(on) => void alerts.setEnabled(on)}
        label={copy('settings.alerts.web')}
        // The blocked line describes the switch too, so it is read whenever the switch is focused.
        description={blocked ? `${footer} ${copy('alert.web.blocked')}` : footer}
      />
      <p className={styles.footer} aria-hidden="true">
        {footer}
      </p>
      {blocked ? (
        <p className={styles.footer} aria-hidden="true">
          {copy('alert.web.blocked')}
        </p>
      ) : null}
      {/* Always in the page, so the line is announced when the browser refuses. */}
      <span className="t-sr-only" role="status">
        {blocked ? copy('alert.web.blocked') : ''}
      </span>
    </div>
  );
}
