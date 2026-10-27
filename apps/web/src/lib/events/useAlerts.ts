/**
 * The web alerts switch for React (docs/EVENTS.md §2.14, §2.18): Settings'
 * "Show alerts" row and the editor's alert pickers read it.
 *
 * - `supported` false: hide both pickers and the switch; Settings shows
 *   `alert.web.unsupported`.
 * - The editor calls `alertChosen()` straight from the gesture that sets an
 *   alert other than None (the permission prompt needs it), and shows
 *   `alert.web.blocked` under the picker while `permission` is `'denied'`.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { type AlertsController, type AlertsState, alertsController } from './alerts.ts';

export interface UseAlerts extends AlertsState {
  /** The Settings switch; call it from the click. */
  setEnabled(on: boolean): Promise<AlertsState>;
  /** An alert was set in the editor; call it from the gesture. */
  alertChosen(): Promise<AlertsState>;
}

export function useAlerts(controller: AlertsController = alertsController()): UseAlerts {
  const state = useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.getState(),
    () => controller.getState(),
  );
  const setEnabled = useCallback((on: boolean) => controller.setEnabled(on), [controller]);
  const alertChosen = useCallback(() => controller.alertChosen(), [controller]);
  return { ...state, setEnabled, alertChosen };
}
