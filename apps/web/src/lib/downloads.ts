/**
 * Where the native apps are published (design/DECISIONS.md, "Open source and release").
 * Release assets keep stable names, so `/releases/latest/download/<name>` always
 * points at the newest build.
 */

export const REPO = 'Siim/thirteen-calendar';
export const REPO_URL = `https://github.com/${REPO}`;
export const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;
export const RELEASE_BASE = `https://github.com/${REPO}/releases/latest/download/`;

/**
 * Apple ID of the iOS / iPadOS app. Empty until the App Store listing is live
 * (design/DECISIONS.md records 6824447935); while it is empty the App Store
 * badge is hidden.
 */
export const APP_STORE_ID: string = '';

export const ASSETS = {
  mac: 'Thirteen-mac.dmg',
  windowsX64: 'Thirteen-windows-x64-setup.exe',
  windowsArm64: 'Thirteen-windows-arm64-setup.exe',
  android: 'Thirteen-android.apk',
} as const;

export type AssetKey = keyof typeof ASSETS;

/**
 * Release assets that are not published yet. The download row hides their
 * buttons until this list is emptied, the same way an empty APP_STORE_ID hides
 * the App Store badge. The notarized Mac DMG (it needs an unlocked Mac session)
 * and the Windows installers follow shortly after 1.0.0; remove each key in the
 * same commit that publishes its asset.
 */
export const PENDING_ASSETS: readonly AssetKey[] = ['mac', 'windowsX64', 'windowsArm64'];

/** Whether an asset is published, so its download button may be shown. */
export function isAssetPublished(key: AssetKey, pending: readonly AssetKey[] = PENDING_ASSETS): boolean {
  return !pending.includes(key);
}

export function assetUrl(key: AssetKey): string {
  return RELEASE_BASE + ASSETS[key];
}

export function appStoreUrl(id: string = APP_STORE_ID): string | null {
  return /^\d+$/.test(id) ? `https://apps.apple.com/app/id${id}` : null;
}

/** The platforms the download row offers, in their default order. */
export type DownloadPlatform = 'ios' | 'mac' | 'windows' | 'android';

export const DEFAULT_ORDER: readonly DownloadPlatform[] = ['ios', 'mac', 'windows', 'android'];

export interface PlatformHints {
  /** `navigator.userAgentData.platform`, when the browser has it. */
  readonly uaDataPlatform?: string | null;
  readonly userAgent?: string;
  /** `navigator.maxTouchPoints` (iPadOS reports itself as a Mac). */
  readonly maxTouchPoints?: number;
}

interface UserAgentDataLike {
  readonly platform?: string;
  getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string; bitness?: string }>;
}

function userAgentData(): UserAgentDataLike | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return (navigator as Navigator & { userAgentData?: UserAgentDataLike }).userAgentData;
}

/** Reads the hints from `navigator` (empty outside a browser). */
export function readPlatformHints(): PlatformHints {
  if (typeof navigator === 'undefined') return {};
  return {
    uaDataPlatform: userAgentData()?.platform ?? null,
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
  };
}

/**
 * The visitor's platform, or null when it is none of ours (Linux, ChromeOS, bots).
 * Prefers User-Agent Client Hints and falls back to the user agent string.
 */
export function detectPlatform({ uaDataPlatform, userAgent = '', maxTouchPoints = 0 }: PlatformHints): DownloadPlatform | null {
  const hint = (uaDataPlatform ?? '').toLowerCase();
  if (hint === 'android') return 'android';
  if (hint === 'windows') return 'windows';
  if (hint === 'ios') return 'ios';
  if (hint === 'macos') return maxTouchPoints > 1 ? 'ios' : 'mac';
  if (hint === 'chrome os' || hint === 'chromeos' || hint === 'linux') return /android/i.test(userAgent) ? 'android' : null;

  const ua = userAgent;
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  // iPadOS Safari asks for desktop sites and says "Macintosh"; only touch gives it away.
  if (/macintosh|mac os x/i.test(ua)) return maxTouchPoints > 1 ? 'ios' : 'mac';
  if (/windows/i.test(ua)) return 'windows';
  return null;
}

/** The default order with the visitor's platform moved to the front. */
export function orderPlatforms(primary: DownloadPlatform | null, order: readonly DownloadPlatform[] = DEFAULT_ORDER): DownloadPlatform[] {
  if (primary === null || !order.includes(primary)) return [...order];
  return [primary, ...order.filter((platform) => platform !== primary)];
}

/**
 * Whether this Windows machine runs on ARM, from high-entropy client hints
 * (Chromium only). Resolves to false when unknown.
 */
export async function isWindowsOnArm(): Promise<boolean> {
  const data = userAgentData();
  if (!data?.getHighEntropyValues) return false;
  try {
    const values = await data.getHighEntropyValues(['architecture', 'bitness']);
    return values.architecture === 'arm';
  } catch {
    return false;
  }
}
