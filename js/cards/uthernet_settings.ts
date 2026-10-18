export type AddressMode = 'auto' | 'manual';
export type WebMode = 'http' | 'https-fallback' | 'https';

/** IPv4 settings in wire order. */
export interface NetConfig {
    ip: number[];
    mask: number[];
    gateway: number[];
    dns: number[];
}

export interface UthernetPrefs {
    enabled: boolean;
    slot: number;
    addressMode: AddressMode;
    ip: string;
    mask: string;
    gateway: string;
    dns: string;
    web: WebMode;
}

const prefs: UthernetPrefs = {
    enabled: true,
    slot: 3,
    addressMode: 'auto',
    ip: '',
    mask: '',
    gateway: '',
    dns: '',
    web: 'https-fallback',
};

const listeners: Array<() => void> = [];

export function getUthernetPrefs(): UthernetPrefs {
    return prefs;
}

export function setUthernetPrefs(next: Partial<UthernetPrefs>) {
    Object.assign(prefs, next);
    for (const listener of listeners) {
        listener();
    }
}

export function onUthernetPrefs(listener: () => void) {
    listeners.push(listener);
}

export function manualNet(next: UthernetPrefs = prefs): NetConfig | null {
    const ip = parseQuad(next.ip);
    const mask = parseQuad(next.mask);
    const gateway = parseQuad(next.gateway);
    const dns = parseQuad(next.dns);
    if (!ip || !mask || !gateway || !dns) {
        return null;
    }
    return { ip, mask, gateway, dns };
}

function parseQuad(text: string): number[] | null {
    const parts = text.split('.');
    if (parts.length !== 4) {
        return null;
    }
    const nums = parts.map((part) => Number(part));
    if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
        return null;
    }
    return nums;
}
