/**
 * What a Calendars list row says about a subscription (docs/EVENTS.md §2.16
 * "Subscription states", "Suspicious feed results"), and the few strings the
 * Calendars panel needs that the §2.19 catalogue does not have yet.
 */

import type { LocalDateTime } from '@thirteen/core';
import { withoutDashes } from '../../lib/labels.ts';
import { COPY, type CopyId, copy } from '../copy.ts';
import type { StoreCalendar, StoreSubscription } from '../store.ts';

/**
 * Strings of the Calendars panel that §2.19 has no id for. They follow the
 * boards (D2 and L1: the info button's "Calendar settings") and the §2.17 text
 * (the restore list's "local" and "subscription"). Reported for the
 * catalogue; `status.test.ts` keeps them free of dashes.
 */
export const PANEL_COPY = {
  /** The info button of a row (board D2, `title="Calendar settings"`); its description is the calendar's name. */
  settings: 'Calendar settings',
  /** The restore list's kinds (§2.17 step 2). */
  kindLocal: 'local',
  kindSubscription: 'subscription',
} as const;

/** The `subscribe.update.options` of §2.19, by interval. */
export const UPDATE_INTERVALS = ['PT1H', 'PT6H', 'P1D', 'P7D', 'manual'] as const;
export type UpdateInterval = (typeof UPDATE_INTERVALS)[number];

export function intervalLabel(interval: UpdateInterval): string {
  const options = copy('subscribe.update.options').split(' | ');
  return options[UPDATE_INTERVALS.indexOf(interval)] ?? interval;
}

/** The colour names of `calendars.colors`, in the §3.6 palette order. */
export function paletteColorNames(): readonly string[] {
  return copy('calendars.colors').split(' | ');
}

const INTERVAL_MS: Readonly<Record<string, number>> = { PT1H: 3_600_000, PT6H: 21_600_000, P1D: 86_400_000, P7D: 604_800_000 };

/** A UTC wall clock as epoch milliseconds. */
export function utcMillis(value: LocalDateTime): number {
  return Date.UTC(value.date.year, value.date.month - 1, value.date.day) + value.minute * 60_000;
}

const relativeFormat = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "now", "10 minutes ago", "2 hours ago", "yesterday", "3 days ago": the platform's relative time, dash-filtered (§2.19). */
export function relativeTime(thenMs: number, nowMs: number): string {
  const seconds = Math.round((thenMs - nowMs) / 1000);
  const abs = Math.abs(seconds);
  let text: string;
  if (abs < 60) text = relativeFormat.format(0, 'second');
  else if (abs < 3600) text = relativeFormat.format(Math.round(seconds / 60), 'minute');
  else if (abs < 86_400) text = relativeFormat.format(Math.round(seconds / 3600), 'hour');
  else if (abs < 30 * 86_400) text = relativeFormat.format(Math.round(seconds / 86_400), 'day');
  else if (abs < 365 * 86_400) text = relativeFormat.format(Math.round(seconds / (30 * 86_400)), 'month');
  else text = relativeFormat.format(Math.round(seconds / (365 * 86_400)), 'year');
  return withoutDashes(text);
}

/**
 * A subscription not updated for twice its interval, whatever the reason; manual feeds never warn
 * (§2.16). A feed that has never updated here (one restored from a backup) counts from when it was
 * added (`addedAt`), as on Windows (`SubscriptionService.IsStale`). The one rule of the web: the rows,
 * the Calendar toolbar's "Subscriptions not updated" and `lib/events/subscriptions.ts` all use it.
 */
export function isStaleSubscription(subscription: Pick<StoreSubscription, 'interval' | 'lastSuccessAt' | 'addedAt'>, nowMs: number): boolean {
  const interval = INTERVAL_MS[subscription.interval];
  const since = subscription.lastSuccessAt ?? subscription.addedAt ?? null;
  if (interval === undefined || since === null) return false;
  return nowMs - utcMillis(since) > 2 * interval;
}

/** The `subscribe.error.*` reason of a failed refresh, or null when the id is not one. */
export function errorReason(lastError: string | null): string | null {
  if (lastError === null || !lastError.startsWith('subscribe.error.') || !(lastError in COPY)) return null;
  return copy(lastError as Extract<CopyId, `subscribe.error.${string}`>);
}

/** The lines a subscription row shows under its name. */
export interface SubscriptionStatus {
  /** "Updated 10 minutes ago", "Updating" or the suspicious-result sentence; null when nothing is known yet. */
  readonly line: string | null;
  readonly tone: 'quiet' | 'warning' | 'updating';
  /** "Couldn't update. {reason}" (accent-text with the error icon). */
  readonly error: string | null;
  /** Offer "Try again". */
  readonly retry: boolean;
}

/**
 * A subscription row's status (§2.16): "Updating" while this tab refreshes it;
 * a held-back suspicious result; "Updated {relative time}" (with the warning
 * icon once it is stale, whatever the reason); "Couldn't update. {reason}" for
 * a failed refresh. Offline, network failures add no row error.
 */
export function subscriptionStatus(calendar: Pick<StoreCalendar, 'subscription'>, nowMs: number, offline = false): SubscriptionStatus | null {
  const subscription = calendar.subscription;
  if (subscription === null) return null;
  if (subscription.updating === true) return { line: copy('calendars.updating'), tone: 'updating', error: null, retry: false };
  if (subscription.lastError === 'feed-empty') return { line: copy('calendars.feedEmpty'), tone: 'warning', error: null, retry: true };
  if (subscription.lastError === 'feed-partial') return { line: copy('calendars.feedPartial'), tone: 'warning', error: null, retry: true };
  const stale = isStaleSubscription(subscription, nowMs);
  const reason = errorReason(subscription.lastError);
  const networkWhileOffline = offline && (subscription.lastError === 'subscribe.error.unreachable' || subscription.lastError === 'subscribe.error.webGeneric');
  const error = reason === null || networkWhileOffline ? null : copy('calendars.updateFailed', { reason });
  // One state per row (board D2: a failed refresh shows only "Couldn't update. {reason}"), except that a stale
  // feed always says how old its copy is, whatever the reason (§2.16), so a stale failing feed shows both.
  const updated = subscription.lastSuccessAt === null ? null : copy('calendars.updated', { 'relative time': relativeTime(utcMillis(subscription.lastSuccessAt), nowMs) });
  const line = error !== null && !stale ? null : updated;
  return { line, tone: stale ? 'warning' : 'quiet', error, retry: error !== null };
}
