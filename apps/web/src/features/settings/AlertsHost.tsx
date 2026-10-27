/**
 * Alerts for the whole app (docs/EVENTS.md §2.14, §6.5): mounted once in
 * App.tsx. While alerts are on, an `AlertPlanner` asks for the
 * `thirteen-alerts` lock and plans in this tab once it has it; the route that
 * `alerts-sw.js` posts after a notification click (`#/day/{date}`) is opened
 * here.
 */
import { useEventStore, useUse24Hour } from '@thirteen/ui';
import { useEffect, useRef } from 'react';
import { navigate } from '../../app/router.ts';
import { ALERT_ROUTE, AlertPlanner, ROUTE_MESSAGE, alertsController } from '../../lib/events/alerts.ts';
import { useAlerts } from '../../lib/events/useAlerts.ts';

const BASE = import.meta.env.BASE_URL;

export function AlertsHost() {
  const store = useEventStore();
  const controller = alertsController();
  const { enabled } = useAlerts(controller);
  const use24Hour = useUse24Hour();
  const use24HourRef = useRef(use24Hour);
  use24HourRef.current = use24Hour;

  // An alert set in the editor may have just been allowed by the browser: read the permission again on every change.
  useEffect(() => store.subscribe(() => controller.refresh()), [store, controller]);

  useEffect(() => {
    if (!enabled) return undefined;
    const planner = new AlertPlanner({
      store,
      target: () => controller.target(),
      use24Hour: () => use24HourRef.current,
      icon: `${BASE}icon-192.png`,
    });
    planner.start();
    return () => planner.stop();
  }, [store, controller, enabled]);

  useEffect(() => {
    const container = typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? navigator.serviceWorker : null;
    if (container === null || container === undefined) return undefined;
    const onMessage = (event: MessageEvent<unknown>) => {
      const data = event.data as { type?: unknown; route?: unknown } | null;
      if (data === null || typeof data !== 'object' || data.type !== ROUTE_MESSAGE) return;
      if (typeof data.route !== 'string' || !ALERT_ROUTE.test(data.route)) return;
      navigate(data.route);
    };
    container.addEventListener('message', onMessage);
    container.startMessages?.();
    return () => container.removeEventListener('message', onMessage);
  }, []);

  return null;
}
