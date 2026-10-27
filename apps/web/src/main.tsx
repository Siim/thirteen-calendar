import '@thirteen/ui/styles.css';
import { tryParseISODate, tryParseLocalDateTime } from '@thirteen/core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import { createAppEventStore } from './app/eventStore.ts';
import { Providers } from './app/Providers.tsx';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

// In the real query string, before the hash:
// `?today=YYYY-MM-DD` pins "today" for demos, `?now=YYYY-MM-DDTHH:MM` the wall clock, and
// `?store=mockup` runs on the mockup data set of docs/EVENTS.md §6.7 (screenshots, e2e), whose
// "now" is Monday, October 19, 2026 09:41 in Tallinn unless `today` or `now` say otherwise.
const params = new URLSearchParams(window.location.search);
const mockup = params.get('store') === 'mockup';
let pinnedToday = tryParseISODate(params.get('today') ?? '');
let pinnedNow = tryParseLocalDateTime(params.get('now') ?? '');
if (mockup) {
  const { mockupData } = await import('@thirteen/ui/mockup');
  const data = mockupData();
  pinnedNow ??= pinnedToday === null ? data.now : { date: pinnedToday, minute: data.now.minute };
  pinnedToday ??= data.today;
}
const store = await createAppEventStore({ mockup });

createRoot(root).render(
  <StrictMode>
    <Providers today={pinnedToday} now={pinnedNow} store={store}>
      <App />
    </Providers>
  </StrictMode>,
);
