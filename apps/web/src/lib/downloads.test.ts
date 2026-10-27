import { describe, expect, it } from 'vitest';
import {
  APP_STORE_ID,
  ASSETS,
  PENDING_ASSETS,
  RELEASE_BASE,
  REPO,
  appStoreUrl,
  assetUrl,
  detectPlatform,
  isAssetPublished,
  orderPlatforms,
} from './downloads.ts';

const UA = {
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  android: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
};

describe('release links', () => {
  it('point at the latest release of Siim/thirteen-calendar with the stable asset names', () => {
    expect(REPO).toBe('Siim/thirteen-calendar');
    expect(RELEASE_BASE).toBe('https://github.com/Siim/thirteen-calendar/releases/latest/download/');
    expect(Object.values(ASSETS)).toEqual([
      'Thirteen-mac.dmg',
      'Thirteen-windows-x64-setup.exe',
      'Thirteen-windows-arm64-setup.exe',
      'Thirteen-android.apk',
    ]);
    expect(assetUrl('android')).toBe('https://github.com/Siim/thirteen-calendar/releases/latest/download/Thirteen-android.apk');
  });

  it('has no App Store link until the ID is filled in', () => {
    expect(APP_STORE_ID).toBe('');
    expect(appStoreUrl()).toBeNull();
    expect(appStoreUrl('6824447935')).toBe('https://apps.apple.com/app/id6824447935');
  });

  it('holds back the Mac DMG and the Windows installers until they are released', () => {
    expect(PENDING_ASSETS).toEqual(['mac', 'windowsX64', 'windowsArm64']);
    expect(isAssetPublished('android')).toBe(true);
    expect(isAssetPublished('mac')).toBe(false);
    expect(isAssetPublished('windowsX64')).toBe(false);
    expect(isAssetPublished('windowsArm64')).toBe(false);
    expect(isAssetPublished('mac', [])).toBe(true);
    expect(isAssetPublished('windowsX64', [])).toBe(true);
    expect(isAssetPublished('mac', ['windowsX64', 'windowsArm64'])).toBe(true);
  });
});

describe('detectPlatform', () => {
  it('prefers User-Agent Client Hints', () => {
    expect(detectPlatform({ uaDataPlatform: 'Windows', userAgent: UA.linux })).toBe('windows');
    expect(detectPlatform({ uaDataPlatform: 'macOS' })).toBe('mac');
    expect(detectPlatform({ uaDataPlatform: 'Android' })).toBe('android');
    expect(detectPlatform({ uaDataPlatform: 'Linux', userAgent: UA.linux })).toBeNull();
  });

  it('falls back to the user agent string', () => {
    expect(detectPlatform({ userAgent: UA.mac })).toBe('mac');
    expect(detectPlatform({ userAgent: UA.iphone, maxTouchPoints: 5 })).toBe('ios');
    expect(detectPlatform({ userAgent: UA.windows })).toBe('windows');
    expect(detectPlatform({ userAgent: UA.android })).toBe('android');
    expect(detectPlatform({ userAgent: UA.linux })).toBeNull();
  });

  it('tells an iPad asking for the desktop site from a Mac by touch', () => {
    expect(detectPlatform({ userAgent: UA.mac, maxTouchPoints: 5 })).toBe('ios');
    expect(detectPlatform({ uaDataPlatform: 'macOS', maxTouchPoints: 5 })).toBe('ios');
  });
});

describe('orderPlatforms', () => {
  it('moves the visitor platform to the front and keeps the rest in order', () => {
    expect(orderPlatforms('android')).toEqual(['android', 'ios', 'mac', 'windows']);
    expect(orderPlatforms('windows')).toEqual(['windows', 'ios', 'mac', 'android']);
    expect(orderPlatforms(null)).toEqual(['ios', 'mac', 'windows', 'android']);
  });
});
