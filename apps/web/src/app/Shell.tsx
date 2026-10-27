import { formatGregorian, formatThirteen, gregorianDayOfYear, toThirteen } from '@thirteen/core';
import {
  Icon,
  SystemSwitcher,
  ThemePicker,
  ThemeToggle,
  cx,
  useCalendarSystem,
  useTheme,
  copy,
  useToast,
  useToday,
} from '@thirteen/ui';
import { type CSSProperties, type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { BrandMark } from './BrandMark.tsx';
import { DownloadRow } from './DownloadRow.tsx';
import { Link } from './Link.tsx';
import { CALENDAR_ROUTES, type Route, type RouteName } from './router.ts';
import styles from './Shell.module.css';

interface NavItem {
  readonly name: RouteName;
  readonly numeral: string;
  readonly label: string;
  readonly to: (year: number) => Route;
}

const NAV: readonly NavItem[] = [
  { name: 'today', numeral: 'I', label: 'Today', to: () => ({ name: 'today' }) },
  { name: 'calendar', numeral: 'II', label: copy('nav.calendar'), to: () => ({ name: 'calendar' }) },
  {
    name: 'convert',
    numeral: 'III',
    label: 'Convert',
    to: () => ({ name: 'convert', date: null, thirteen: null, system: null }),
  },
  { name: 'compare', numeral: 'IV', label: 'Compare', to: (year) => ({ name: 'compare', year }) },
  { name: 'history', numeral: 'V', label: 'History', to: () => ({ name: 'history' }) },
];

const BASE = import.meta.env.BASE_URL;

type Drawer = 'appearance' | 'download' | null;

export interface ShellProps {
  readonly route: Route;
  readonly children?: ReactNode;
}

/** The current theme's paper, ink and accent as three small dots (decorative). */
function ThemeChip() {
  const { paletteInfo, resolved } = useTheme();
  const colors = paletteInfo[resolved];
  const style = {
    '--chip-paper': colors.paper,
    '--chip-ink': colors.ink,
    '--chip-accent': colors.accent,
  } as CSSProperties;
  return (
    <span className={styles.chip} style={style} aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

/** Masthead (nameplate, folio, system + appearance + download controls), section nav, main, colophon. */
export function Shell({ route, children }: ShellProps) {
  const today = useToday();
  const { system } = useCalendarSystem();
  const mainRef = useRef<HTMLElement>(null);
  const appearanceButton = useRef<HTMLButtonElement>(null);
  const downloadButton = useRef<HTMLButtonElement>(null);
  const appearancePanel = useRef<HTMLElement>(null);
  const downloadPanel = useRef<HTMLElement>(null);
  const focusOnOpen = useRef(false);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const ids = useId();
  const appearanceId = `${ids}-appearance`;
  const downloadId = `${ids}-download`;
  const todayThirteen = formatThirteen(toThirteen(today, system.id), { includeWeekday: true });

  // A new page closes whichever panel was open.
  useEffect(() => setDrawer(null), [route.name]);

  // Another section is a "next action" (§2.11): a toast that stays closes, and its held change is written.
  const toast = useToast();
  const section = CALENDAR_ROUTES.has(route.name) ? 'calendar' : route.name;
  const shownSection = useRef(section);
  useEffect(() => {
    if (shownSection.current === section) return;
    shownSection.current = section;
    toast.nextAction();
  }, [section, toast]);

  // At large text sizes the phone's section row scrolls sideways: keep the current section in view.
  const navRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const list = navRef.current;
    const current = list?.querySelector<HTMLElement>('[aria-current="page"]');
    if (list === null || current == null || list.scrollWidth <= list.clientWidth) return;
    const left = current.getBoundingClientRect().left - list.getBoundingClientRect().left + list.scrollLeft;
    list.scrollLeft = Math.max(0, left - (list.clientWidth - current.offsetWidth) / 2);
  }, [section]);

  const toggle = (next: Exclude<Drawer, null>) => {
    const opening = drawer !== next;
    focusOnOpen.current = opening;
    setDrawer(opening ? next : null);
  };

  // An opened panel takes focus: the Theme panel follows the "Get the app" button in
  // the DOM, so without this, Tab and the screen reader cursor would skip past it.
  useEffect(() => {
    if (drawer === null || !focusOnOpen.current) return;
    focusOnOpen.current = false;
    const panel = drawer === 'appearance' ? appearancePanel.current : downloadPanel.current;
    const target =
      panel?.querySelector<HTMLElement>('input:checked') ??
      panel?.querySelector<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])');
    target?.focus();
  }, [drawer]);

  /** Escape inside a panel closes it and returns focus to its button. */
  const onDrawerKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    const button = drawer === 'appearance' ? appearanceButton.current : downloadButton.current;
    setDrawer(null);
    button?.focus();
  };

  return (
    <div className={styles.shell}>
      <a
        className={styles.skip}
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          mainRef.current?.focus();
        }}
      >
        Skip to content
      </a>

      <header className={styles.masthead}>
        <div className={styles.container}>
          <div className={styles.folio} data-reveal="rise">
            <span>
              <strong>Day {gregorianDayOfYear(today)}</strong> · {todayThirteen}
            </span>
            <span className={styles.folioRight}>Gregorian {formatGregorian(today, { includeWeekday: true })}</span>
          </div>
          <div className={styles.nameplate}>
            <Link to={{ name: 'today' }} className={styles.brand}>
              <BrandMark size={44} />
              <span className={styles.brandText}>
                <span className={styles.wordmark} translate="no">
                  Thirteen
                </span>
                <span className={styles.tagline}>A rational almanac of the thirteen-month year</span>
              </span>
            </Link>
            <div className={styles.controls}>
              <SystemSwitcher />
              <div className={styles.tools}>
                <button
                  ref={appearanceButton}
                  type="button"
                  className={cx(styles.tool, drawer === 'appearance' && styles.toolOpen)}
                  aria-expanded={drawer === 'appearance'}
                  aria-controls={appearanceId}
                  onClick={() => toggle('appearance')}
                >
                  <ThemeChip />
                  <span className={styles.toolLabel}>Theme</span>
                </button>
                <Link
                  to={{ name: 'settings' }}
                  className={cx(styles.tool, styles.toolIcon, route.name === 'settings' && styles.toolOpen)}
                  aria-current={route.name === 'settings' ? 'page' : undefined}
                  aria-label={copy('settings.title.web')}
                  title={copy('settings.title.web')}
                >
                  <Icon name="gear" size={18} />
                </Link>
                <button
                  ref={downloadButton}
                  type="button"
                  className={cx(styles.tool, drawer === 'download' && styles.toolOpen)}
                  aria-expanded={drawer === 'download'}
                  aria-controls={downloadId}
                  onClick={() => toggle('download')}
                >
                  <Icon name="download" size={17} />
                  <span className={styles.toolLabel}>Get the app</span>
                </button>
              </div>
            </div>
          </div>

          <section
            ref={appearancePanel}
            id={appearanceId}
            className={styles.drawer}
            hidden={drawer !== 'appearance'}
            aria-label="Theme and appearance"
            onKeyDown={onDrawerKeyDown}
          >
            <div className={styles.drawerBody}>
              <ThemePicker className={styles.picker} />
              <ThemeToggle size="md" showLabels showLegend className={styles.mode} />
            </div>
            <button
              type="button"
              className={styles.drawerClose}
              onClick={() => {
                setDrawer(null);
                appearanceButton.current?.focus();
              }}
            >
              <Icon name="close" size={16} />
              <span className="t-sr-only">Close</span>
            </button>
          </section>

          <section
            ref={downloadPanel}
            id={downloadId}
            className={styles.drawer}
            hidden={drawer !== 'download'}
            aria-labelledby={`${downloadId}-title`}
            onKeyDown={onDrawerKeyDown}
          >
            <div className={styles.drawerBody}>
              <DownloadRow variant="panel" headingId={`${downloadId}-title`} />
            </div>
            <button
              type="button"
              className={styles.drawerClose}
              onClick={() => {
                setDrawer(null);
                downloadButton.current?.focus();
              }}
            >
              <Icon name="close" size={16} />
              <span className="t-sr-only">Close</span>
            </button>
          </section>

          <div className={styles.rule} data-reveal="rule" />
        </div>
        <nav className={styles.navWrap} aria-label="Sections">
          <div className={styles.container}>
            <ul className={styles.nav} ref={navRef}>
              {NAV.map((item) => (
                <li key={item.name}>
                  <Link
                    to={item.to(today.year)}
                    className={styles.navLink}
                    aria-current={
                      route.name === item.name || (item.name === 'calendar' && CALENDAR_ROUTES.has(route.name)) ? 'page' : undefined
                    }
                  >
                    <span className={styles.navNumeral} aria-hidden="true">
                      {item.numeral}
                    </span>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </nav>
      </header>

      <main id="main-content" ref={mainRef} tabIndex={-1} className={styles.main}>
        <div className={styles.container}>{children}</div>
      </main>

      <footer className={styles.footer}>
        <div className={styles.container}>
          <DownloadRow variant="footer" className={styles.downloads} />
          <div className={styles.footerInner}>
            <span className={styles.footerMark} translate="no">
              <BrandMark size={28} />
              Thirteen
            </span>
            <p className={styles.colophon}>
              Thirteen months of exactly four weeks, plus a day or two that belong to no week at all. Every date
              here is computed by the <code>@thirteen/core</code> engine, checked day by day for the years 1 to 9999.
            </p>
            <div className={styles.footerMeta}>
              <ul className={styles.footerLinks}>
                <li>
                  <a href={`${BASE}privacy.html`}>Privacy</a>
                </li>
                <li>
                  <a href={`${BASE}support.html`}>Support</a>
                </li>
              </ul>
              <p>Set in Geist and Geist Mono</p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
