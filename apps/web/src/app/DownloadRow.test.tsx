import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DownloadRow } from './DownloadRow.tsx';

const RELEASES = 'https://github.com/Siim/thirteen-calendar/releases/latest/download/';
const WINDOWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

function row() {
  return within(screen.getByRole('heading', { name: 'Get the app' }).parentElement!);
}

function linkNames(): string[] {
  return row()
    .getAllByRole('link')
    .map((link) => link.textContent?.replace(/\s+/g, ' ').trim() ?? '');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DownloadRow', () => {
  it('hides the pending Mac DMG, the Windows installers and the App Store badge, and keeps Android and the source', () => {
    render(<DownloadRow />);
    expect(row().getByRole('link', { name: 'Download for Android APK' }).getAttribute('href')).toBe(`${RELEASES}Thirteen-android.apk`);
    expect(row().queryByRole('link', { name: /macOS/ })).toBeNull();
    expect(row().queryByRole('link', { name: /Windows/ })).toBeNull();
    expect(row().queryByRole('link', { name: 'Download on the App Store' })).toBeNull();
    expect(row().getByRole('link', { name: 'Source on GitHub' })).toBeTruthy();
    expect(row().getAllByRole('listitem')).toHaveLength(1);
  });

  it('a Windows visitor gets no Windows button while the installers are pending', () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(WINDOWS_UA);
    render(<DownloadRow />);
    expect(row().queryByRole('link', { name: /Windows/ })).toBeNull();
    expect(row().queryByRole('link', { name: /macOS/ })).toBeNull();
    expect(linkNames()[0]).toBe('Download for Android APK');
  });

  it('shows the macOS DMG once the Mac is no longer pending', () => {
    render(<DownloadRow pendingAssets={['windowsX64', 'windowsArm64']} />);
    expect(row().getByRole('link', { name: 'Download for macOS DMG' }).getAttribute('href')).toBe(`${RELEASES}Thirteen-mac.dmg`);
    expect(linkNames().slice(0, 2)).toEqual(['Download for macOS DMG', 'Download for Android APK']);
    expect(row().getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows both Windows installers, the visitor platform first, once nothing is pending', () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(WINDOWS_UA);
    render(<DownloadRow pendingAssets={[]} />);
    const items = row().getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(within(items[0]!).getByRole('link', { name: 'Download for Windows x64' }).getAttribute('href')).toBe(
      `${RELEASES}Thirteen-windows-x64-setup.exe`,
    );
    expect(within(items[0]!).getByRole('link', { name: 'Download for Windows ARM64' }).getAttribute('href')).toBe(
      `${RELEASES}Thirteen-windows-arm64-setup.exe`,
    );
  });

  it('with one Windows installer pending, shows the other one alone', () => {
    render(<DownloadRow pendingAssets={['windowsX64']} />);
    const links = row().getAllByRole('link', { name: /Windows/ });
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute('href')).toBe(`${RELEASES}Thirteen-windows-arm64-setup.exe`);
    expect(links[0]!.textContent?.replace(/\s+/g, ' ').trim()).toBe('Download for Windows ARM64');
  });
});
