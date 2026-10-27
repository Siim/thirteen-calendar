import { Icon, cx } from '@thirteen/ui';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import {
  APP_STORE_ID,
  type AssetKey,
  type DownloadPlatform,
  LICENSE_URL,
  PENDING_ASSETS,
  REPO_URL,
  appStoreUrl,
  assetUrl,
  detectPlatform,
  isAssetPublished,
  isWindowsOnArm,
  orderPlatforms,
  readPlatformHints,
} from '../lib/downloads.ts';
import styles from './DownloadRow.module.css';

export interface DownloadRowProps {
  /** `footer`: the slim row at the bottom of every page; `panel`: revealed from the header. */
  readonly variant?: 'footer' | 'panel';
  /** Heading id, so a surrounding landmark can be labelled by it. */
  readonly headingId?: string;
  readonly className?: string;
  /** Assets whose buttons stay hidden because they are not released yet (default `PENDING_ASSETS`). */
  readonly pendingAssets?: readonly AssetKey[];
}

const BASE = import.meta.env.BASE_URL;

/**
 * "Get the app": the App Store badge (only once the listing exists) and small
 * download buttons for macOS, Windows and Android (only for assets that are
 * released, see `PENDING_ASSETS`), with the visitor's own platform first, plus
 * the source link.
 */
export function DownloadRow({ variant = 'footer', headingId, className, pendingAssets = PENDING_ASSETS }: DownloadRowProps) {
  const primary = useMemo(() => detectPlatform(readPlatformHints()), []);
  const [arm, setArm] = useState(false);
  useEffect(() => {
    if (primary !== 'windows') return undefined;
    let live = true;
    void isWindowsOnArm().then((value) => {
      if (live) setArm(value);
    });
    return () => {
      live = false;
    };
  }, [primary]);

  const storeUrl = appStoreUrl(APP_STORE_ID);
  const published = (key: AssetKey) => isAssetPublished(key, pendingAssets);
  const items: { key: DownloadPlatform; node: ReactNode }[] = [];
  for (const platform of orderPlatforms(primary)) {
    const isPrimary = platform === primary;
    switch (platform) {
      case 'ios':
        if (storeUrl !== null) {
          items.push({
            key: platform,
            node: (
              <a className={styles.badge} href={storeUrl} rel="noopener">
                <img
                  className={styles.badgeLight}
                  src={`${BASE}badges/download-on-the-app-store-black.svg`}
                  alt="Download on the App Store"
                  width={120}
                  height={40}
                />
                <img
                  className={styles.badgeDark}
                  src={`${BASE}badges/download-on-the-app-store-white.svg`}
                  alt="Download on the App Store"
                  width={120}
                  height={40}
                />
              </a>
            ),
          });
        }
        break;
      case 'mac':
        if (!published('mac')) break;
        items.push({
          key: platform,
          node: (
            <a
              className={cx(styles.button, isPrimary && styles.primary)}
              href={assetUrl('mac')}
            >
              <Icon name="apple-logo" className={styles.logo} size={18} />
              <span className={styles.name}>
                <span className="t-sr-only">Download for</span> macOS
              </span>{' '}
              <span className={styles.meta}>DMG</span>
            </a>
          ),
        });
        break;
      case 'windows': {
        // The visitor's architecture first; a pending installer has no button.
        const keys = (arm ? (['windowsArm64', 'windowsX64'] as const) : (['windowsX64', 'windowsArm64'] as const)).filter(published);
        const [main, other] = keys;
        if (main === undefined) break;
        const label = (key: AssetKey) => (key === 'windowsArm64' ? 'ARM64' : 'x64');
        const mainButton = (
          <a
            className={cx(styles.button, other !== undefined && styles.pairMain, isPrimary && styles.primary)}
            href={assetUrl(main)}
          >
            <Icon name="windows-logo" className={styles.logo} size={18} />
            <span className={styles.name}>
              <span className="t-sr-only">Download for</span> Windows
            </span>{' '}
            <span className={styles.meta}>{label(main)}</span>
          </a>
        );
        items.push({
          key: platform,
          node:
            other === undefined ? (
              mainButton
            ) : (
              <span className={styles.pair}>
                {mainButton}
                <a className={cx(styles.button, styles.pairSide)} href={assetUrl(other)}>
                  <span className="t-sr-only">Download for Windows</span>{' '}
                  <span className={styles.meta}>{label(other)}</span>
                </a>
              </span>
            ),
        });
        break;
      }
      case 'android':
        if (!published('android')) break;
        items.push({
          key: platform,
          node: (
            <a
              className={cx(styles.button, isPrimary && styles.primary)}
              href={assetUrl('android')}
            >
              <Icon name="android-logo" className={styles.logo} size={18} />
              <span className={styles.name}>
                <span className="t-sr-only">Download for</span> Android
              </span>{' '}
              <span className={styles.meta}>APK</span>
            </a>
          ),
        });
        break;
    }
  }

  return (
    <div className={cx(styles.row, variant === 'panel' ? styles.panel : styles.footer, className)}>
      <h2 id={headingId} className={styles.heading}>
        Get the app
      </h2>
      <ul className={styles.list}>
        {items.map((item) => (
          <li key={item.key} className={styles.item}>
            {item.node}
          </li>
        ))}
      </ul>
      <p className={styles.source}>
        <a className={styles.sourceLink} href={REPO_URL} rel="noopener">
          <Icon name="github-logo" className={styles.logo} size={18} />
          <span>Source on GitHub</span>
        </a>
        <a className={styles.license} href={LICENSE_URL} rel="noopener license">
          MIT <span className="t-sr-only">license</span>
        </a>
      </p>
    </div>
  );
}
