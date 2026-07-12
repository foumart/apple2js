export const OUTER_LAYOUT_W = 560;
export const OUTER_CHROME_H = 422;
export const OUTER_KEYBOARD_H = 630;
const SCREEN_LAYOUT_H = 384;

/** Disk image path from ?disk= query (legacy), not the show/hide periphery flag. */
export function readDiskQueryPath(): string | null {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('disk')) return null;
    const val = params.get('disk');
    if (val === 'false' || val === 'true') return null;
    return val;
}

/** URL/localStorage pref: disk=false hides #periphery1 (disk load/save controls). */
export function readShowDiskParam(search: string | URLSearchParams): boolean {
    const params =
        typeof search === 'string'
            ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
            : search;
    if (!params.has('disk')) return true;
    return params.get('disk') !== 'false';
}

export function applyShowDisk(showDisk: boolean) {
    const diskPanel = document.getElementById('periphery1');
    if (diskPanel) diskPanel.style.display = showDisk ? '' : 'none';
    document.body.classList.toggle('hide-disk', !showDisk);
}

/** Canonical 1× layout height for embed scale (844÷2 chrome, 1260÷2 keyboard). */
export function getChromeLayoutHeight(keyboardVisible: boolean): number {
    return keyboardVisible ? OUTER_KEYBOARD_H : OUTER_CHROME_H;
}

function setElementDisplay(id: string, display: string) {
    const el = document.getElementById(id);
    if (el) el.style.display = display;
}

/** Screen-only embed: hide chrome and scale the display to fill the viewport. */
export function applyEmbeddedScreenLayout(showDisk = false) {
    const body = document.body;
    body.classList.add('embedded-page', 'screen-only');
    body.classList.remove('keyboard-open', 'full-page');
    body.style.background = '#c4c1a0';

    setElementDisplay('reset-row', 'none');
    setElementDisplay('lights', 'none');
    setElementDisplay('periphery1', showDisk ? 'flex' : 'none');
    setElementDisplay('periphery3', 'none');
    setElementDisplay('exit-fullscreen', 'none');
    body.classList.toggle('hide-disk', !showDisk);

    const outer = document.querySelector('.outer') as HTMLElement | null;
    if (outer) {
        outer.style.width = `${OUTER_LAYOUT_W}px`;
        outer.style.border = '0';
        outer.style.borderRadius = '0';
    }

    const display = document.getElementById('display');
    if (display) {
        display.style.margin = '0';
        display.style.padding = '0';
        display.style.border = '0';
        display.style.borderRadius = '0';
        const overscan = display.querySelector('.overscan') as HTMLElement | null;
        if (overscan) {
            overscan.style.padding = '0';
            overscan.style.border = '0';
            overscan.style.borderRadius = '0';
        }
    }

    syncEmbeddedScreenScale();
    document.documentElement.classList.remove('apple2-embedded-boot');
}

export function syncEmbeddedScreenScale() {
    const body = document.body;
    if (!body.classList.contains('screen-only')) return;

    const outer = document.querySelector('.outer') as HTMLElement | null;
    if (!outer) return;

    body.classList.remove('layout-ready');

    const scale =
        Math.floor(
            Math.max(
                0.2,
                Math.min(
                    window.innerWidth / OUTER_LAYOUT_W,
                    window.innerHeight / SCREEN_LAYOUT_H
                )
            ) * 1000
        ) / 1000;

    document.documentElement.style.setProperty('--scale-factor', String(scale));
    outer.style.transformOrigin = '50% 0%';
    body.classList.add('layout-ready');
}
