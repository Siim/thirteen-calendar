/*
 * Thirteen's notifications-only service worker (docs/EVENTS.md §2.14, §6.5).
 *
 * The page registers it only when the user turns alerts on, and shows each
 * alert itself with registration.showNotification(...). This worker has one
 * job: when an alert is clicked, focus an open Thirteen tab and send it the
 * alert's route (#/day/{date}), or open Thirteen on that route.
 *
 * It has no fetch handler, caches nothing, handles no push messages and
 * downloads or sends nothing.
 */

'use strict';

/** The routes an alert may open: the day of the event. */
const ROUTE = /^#\/day\/\d{4}-\d{2}-\d{2}$/;

/** Thirteen's own page within this worker's scope (not privacy.html or support.html). */
function isThirteen(client, scope) {
  try {
    const url = new URL(client.url);
    return url.origin === scope.origin && (url.pathname === scope.pathname || url.pathname === `${scope.pathname}index.html`);
  } catch {
    return false;
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data;
  const route = data && typeof data.route === 'string' && ROUTE.test(data.route) ? data.route : '#/calendar';
  event.waitUntil(
    (async () => {
      const scope = new URL(self.registration.scope);
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const client = windows.find((candidate) => isThirteen(candidate, scope));
      if (client !== undefined) {
        const focused = await client.focus().catch(() => client);
        (focused ?? client).postMessage({ type: 'thirteen-route', route });
        return;
      }
      await self.clients.openWindow(new URL(route, scope).href);
    })(),
  );
});
