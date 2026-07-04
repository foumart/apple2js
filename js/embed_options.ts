export const OUTER_LAYOUT_W = 560;
export const OUTER_CHROME_H = 422;
export const OUTER_KEYBOARD_H = 655;

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

/** Canonical 1× layout height for embed scale (844÷2 chrome, 1310÷2 keyboard). */
export function getChromeLayoutHeight(keyboardVisible: boolean): number {
    return keyboardVisible ? OUTER_KEYBOARD_H : OUTER_CHROME_H;
}
