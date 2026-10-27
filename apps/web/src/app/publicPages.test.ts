import { describe, expect, it } from 'vitest';
import privacyHtml from '../../public/privacy.html?raw';
import supportHtml from '../../public/support.html?raw';
import { SAFARI_HELP_URL } from '../lib/events/storage.ts';

/**
 * The public privacy and support pages (docs/EVENTS.md §7.1, §7.5, §8.3 items 4 and 10; task B9):
 * the §7.1 texts, the published address and the `#install` help the Safari storage card links to.
 */

const SITE = 'https://thirteen.haugas.dev/';

/** The page's text as a reader sees it: tags removed, entities decoded, spaces collapsed. */
function text(html: string): string {
  const body = html.slice(html.indexOf('<body'));
  return body
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .replace(/ ([.,;:)])(?=\s|$)/g, '$1');
}

describe('privacy.html (§7.1)', () => {
  const page = text(privacyHtml);

  it('is published at the site of its own, with canonical and Open Graph URLs', () => {
    expect(privacyHtml).toContain(`<link rel="canonical" href="${SITE}privacy.html">`);
    expect(privacyHtml).toContain(`<meta property="og:url" content="${SITE}privacy.html">`);
    expect(privacyHtml).not.toMatch(/github\.io/);
  });

  it('has the summary, the collection statement and the new sections of §7.1', () => {
    for (const sentence of [
      'Thirteen collects no data. There are no accounts, no analytics, no ads and no tracking. Your events and settings stay on your devices and in the calendar accounts you already use, and Thirteen never sends them to us or to anyone else.',
      'Nothing. Thirteen does not collect, store on any server, sell or share any personal information.',
      'You can turn access off at any time in Settings > Privacy & Security > Calendars (on a Mac, in System Settings).',
      "You can turn access off in your phone's Settings under Apps > Thirteen > Permissions.",
      'Browsers may delete a site\'s storage on their own: Safari does so when you haven\'t opened a site for about a week, unless you added it to your Dock or Home Screen. Export your calendars to keep a copy.',
      'Apps for iPhone, iPad, Mac and Android: they make no network connections. Calendar syncing is done by your device\'s own accounts.',
      'it sends no cookies and does not tell the server which page asked, and it contains nothing about you or your other events.',
      'Apart from those downloads, the website only loads its own files from the server that hosts it, and it loads nothing from other sites.',
      'a small background script (a service worker) whose only job is to show those alerts and open the right day when you click one. It downloads nothing and sends nothing.',
      'Alerts are planned on your device and never sent anywhere.',
      'which calendars you hide in Thirteen and your default calendar for new events',
      'On the website, use Settings > Delete all events, or clear the site\'s data in your browser.',
    ]) {
      expect(page).toContain(sentence);
    }
    for (const heading of ['Your calendars and events', 'Network connections', 'Notifications', 'Deleting your data', 'Hosting and app stores', 'Children', 'Changes', 'Contact']) {
      expect(privacyHtml).toMatch(new RegExp(`<h2[^>]*>${heading}</h2>`));
    }
  });

  it('says that no Thirteen server sees subscriptions, that alerts are local and where settings stay (release 1.0)', () => {
    for (const sentence of [
      'There is no Thirteen server: the download goes straight from your computer or browser to the calendar\'s host, so we never see the link or the calendar.',
      'Calendars you subscribe to in your device\'s settings are downloaded by the system, not by Thirteen.',
      'They are local notifications, and no push service is involved.',
      'On a Mac they stay in the folder ~/Library/Containers/com.haugas.thirteen, and on Windows in %APPDATA%\\Thirteen, until you delete that folder.',
    ]) {
      expect(page).toContain(sentence);
    }
  });

  it('no longer says the apps never connect', () => {
    expect(page).not.toContain('The apps do not connect to the internet');
    expect(page).not.toContain('make no network connections. Every calendar calculation');
  });

  it('has no en or em dash', () => {
    expect(privacyHtml).not.toMatch(/[–—]/);
  });
});

describe('support.html (§7.1)', () => {
  const page = text(supportHtml);

  it('is published at the site of its own, with canonical and Open Graph URLs', () => {
    expect(supportHtml).toContain(`<link rel="canonical" href="${SITE}support.html">`);
    expect(supportHtml).toContain(`<meta property="og:url" content="${SITE}support.html">`);
    expect(supportHtml).not.toMatch(/github\.io/);
  });

  it('answers the offline question and the new questions of §7.1', () => {
    for (const sentence of [
      // §7.1's offline answer, corrected for the website, which has no offline cache (§1.2 non-goal).
      'Thirteen for iPhone, iPad, Mac and Android never connects to the internet; your device\'s accounts sync your calendars whenever it is online. The Windows app and the website connect only to download calendars you subscribe to. The website is not saved for offline use, so it needs a connection to open. Nothing is collected; see the privacy policy.',
      'Google and iCloud don\'t let web pages read their calendar links. Download the .ics file and import it, or use a Thirteen app instead.',
      // Windows ships after 1.0, so the answer must not send readers to it as if it were out.
      'Thirteen for iPhone, iPad, Mac and Android shows your Google and iCloud calendars directly, once they are in your device\'s calendars. Thirteen for Windows, when it is released, can subscribe to their links itself.',
      'In the Google Calendar app, open Settings > General and turn on Share Google Calendar data with other apps.',
      'Calendar on iPhone and Mac may show only the first date of a repeat set in Thirteen for Android.',
      'its editor calls such a repeat "Unsupported recurrence" or "Does not repeat". Editing the title there keeps the repeat.',
      'an all-day event saved with no alerts gets the account\'s default alert for all-day events, and a timed event gets none.',
      'Safari deletes a site\'s data when you haven\'t opened it for about a week',
    ]) {
      expect(page).toContain(sentence);
    }
    for (const question of [
      'Why can\'t I see my Google calendars on Android?',
      'Why can\'t the website subscribe to my Google or iCloud calendar?',
      'Will my 13-month repeats show in other calendar apps?',
      'Where are my events stored?',
      'Why did my events disappear from the website?',
      'Do new events get my account\'s default alerts?',
    ]) {
      expect(supportHtml).toContain(`<summary>${question}</summary>`);
    }
  });

  it('keeps the #install help the Safari storage card links to open on the page (§2.16)', () => {
    expect(SAFARI_HELP_URL).toBe('support.html#install');
    expect(supportHtml).toMatch(/<h2 id="install">Add Thirteen to your Dock or Home Screen<\/h2>/);
    expect(page).toContain('Safari on Mac: open thirteen.haugas.dev, then choose File > Add to Dock.');
    expect(page).toContain('iPhone and iPad: open thirteen.haugas.dev in Safari, tap Share, then Add to Home Screen.');
  });

  it('names the platforms of 1.0, with Windows later, and explains calendar access and subscribing', () => {
    expect(page).toContain('as an app for iPhone, iPad, Mac and Android, all built on the same calendar engine. A Windows app is coming in a later release.');
    expect(supportHtml).toContain('<summary>Why does Thirteen ask for access to my calendars?</summary>');
    expect(supportHtml).toContain('<summary>How do I subscribe to a calendar?</summary>');
    expect(page).toContain('repeats such as every 13-month month on the 12th need a calendar on the device or another CalDAV account.');
    expect(page).not.toContain('Does it work offline? Yes.');
  });

  it('no longer says Thirteen cannot read calendars', () => {
    expect(page).not.toContain('It does not read, change or sync your calendars');
  });

  it('has no en or em dash', () => {
    expect(supportHtml).not.toMatch(/[–—]/);
  });
});
