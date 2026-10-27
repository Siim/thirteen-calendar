import { useCalendars } from '@thirteen/ui';
import type { ReactNode } from 'react';
import { CalendarPage } from '../features/calendar/CalendarPage.tsx';
import { CalendarsDialogsProvider } from '../features/calendar/CalendarsPane.tsx';
import { EventActionsProvider } from '../features/calendar/EventActions.tsx';
import { ComparePage } from '../features/compare/ComparePage.tsx';
import { ConvertPage } from '../features/convert/ConvertPage.tsx';
import { HistoryPage } from '../features/history/HistoryPage.tsx';
import { AlertsHost } from '../features/settings/AlertsHost.tsx';
import { SettingsPage } from '../features/settings/SettingsPage.tsx';
import { TodayPage } from '../features/today/TodayPage.tsx';
import { useDefaultCalendar } from '../lib/preferences.ts';
import { NotFoundPage } from './NotFoundPage.tsx';
import { CALENDAR_ROUTES, type Route, useRoute } from './router.ts';
import { Shell } from './Shell.tsx';
import { useRevealOnce, useScrollReset, useSystemAttribute } from './useAppEffects.ts';

function RouteView({ route }: { readonly route: Route }) {
  if (CALENDAR_ROUTES.has(route.name)) return <CalendarPage route={route} />;
  switch (route.name) {
    case 'today':
      return <TodayPage />;
    case 'settings':
      return <SettingsPage />;
    case 'convert':
      return <ConvertPage date={route.date} thirteen={route.thirteen} system={route.system} />;
    case 'compare':
      return <ComparePage year={route.year} />;
    case 'history':
      return <HistoryPage />;
    case 'not-found':
      return <NotFoundPage path={route.path} />;
    default:
      return null;
  }
}

/** The event layers every screen shares: details and editor (§2.10, §2.11), and the Calendars dialogs (§2.17). */
function EventLayers({ children }: { readonly children?: ReactNode }) {
  const [defaultCalendar] = useDefaultCalendar(useCalendars());
  return (
    <EventActionsProvider defaultCalendarId={defaultCalendar?.id ?? null}>
      <CalendarsDialogsProvider>{children}</CalendarsDialogsProvider>
      <AlertsHost />
    </EventActionsProvider>
  );
}

/** The app: shell + hash-routed pages. Must be rendered inside <Providers>. */
export function App() {
  const route = useRoute();
  useRevealOnce();
  useScrollReset(route);
  useSystemAttribute();
  return (
    <EventLayers>
      <Shell route={route}>
        <RouteView route={route} />
      </Shell>
    </EventLayers>
  );
}
