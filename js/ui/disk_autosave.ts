import { base64_json_parse, base64_json_stringify } from '../base64';
import DiskII from '../cards/disk2';
import {
    DriveNumber,
    DRIVE_NUMBERS,
    isNoFloppyDisk,
} from '../formats/types';
import type DriveLights from './drive_lights';

const AUTOSAVE_PREFIX = 'apple2js:autosave:';
const DEBOUNCE_MS = 1500;
const PERIODIC_MS = 5000;

/** Master switch — off while autosave perf/reliability is investigated. */
export const DISK_AUTOSAVE_ENABLED = false;

interface AutosaveRecord {
    v: 1;
    kind: 'json' | 'drive';
    payload: string;
}

function haveStorage(): boolean {
    return typeof window !== 'undefined' && !!window.localStorage;
}

/** URL/localStorage pref: autosave=true opts in when DISK_AUTOSAVE_ENABLED is false. */
export function readAutosaveEnabled(
    search: string | URLSearchParams = window.location.search
): boolean {
    if (!DISK_AUTOSAVE_ENABLED) return false;

    const params =
        typeof search === 'string'
            ? new URLSearchParams(
                  search.startsWith('?') ? search.slice(1) : search
              )
            : search;
    if (!params.has('autosave')) return true;
    return params.get('autosave') !== 'false';
}

function readHashDiskUrl(driveNo: DriveNumber): string | undefined {
    if (typeof window === 'undefined') return undefined;
    const hash = decodeURIComponent(window.location.hash || '').replace(
        /^#/,
        ''
    );
    if (!hash) return undefined;
    let file = hash.split('|')[driveNo - 1];
    if (!file) return undefined;
    if (!file.includes('.')) {
        file = 'json/disks/' + file + '.json';
    }
    return file;
}

function canonicalPath(sourceUrl: string): string {
    try {
        const url = new URL(sourceUrl, window.location.href);
        return url.pathname.replace(/^\/games\//i, '/game/');
    } catch {
        return sourceUrl;
    }
}

function diskBasename(sourceUrl: string): string | undefined {
    try {
        const url = new URL(sourceUrl, window.location.href);
        return url.pathname.split('/').filter(Boolean).pop()?.toLowerCase();
    } catch {
        const parts = sourceUrl.split('/').filter(Boolean);
        return parts.pop()?.split('?')[0]?.toLowerCase();
    }
}

/** Primary stable key: normalized pathname + drive number. */
function primaryStorageKey(
    sourceUrl: string,
    driveNo: DriveNumber
): string {
    return `${AUTOSAVE_PREFIX}${canonicalPath(sourceUrl)}:${driveNo}`;
}

function storageKeyCandidates(
    sourceUrl: string,
    driveNo: DriveNumber
): string[] {
    const keys: string[] = [];
    const seen = new Set<string>();
    const add = (key: string) => {
        if (!seen.has(key)) {
            seen.add(key);
            keys.push(key);
        }
    };

    add(primaryStorageKey(sourceUrl, driveNo));

    try {
        const url = new URL(sourceUrl, window.location.href);
        add(`${AUTOSAVE_PREFIX}${url.pathname}:${driveNo}`);
        add(
            `${AUTOSAVE_PREFIX}${url.pathname.toLowerCase()}:${driveNo}`
        );
    } catch {
        add(`${AUTOSAVE_PREFIX}${sourceUrl}:${driveNo}`);
    }

    const baseName = diskBasename(sourceUrl);
    if (haveStorage() && baseName) {
        const suffix = `:${driveNo}`;
        for (let idx = 0; idx < window.localStorage.length; idx++) {
            const key = window.localStorage.key(idx);
            if (
                key?.startsWith(AUTOSAVE_PREFIX) &&
                key.endsWith(suffix) &&
                key.toLowerCase().includes(baseName)
            ) {
                add(key);
            }
        }
    }

    return keys;
}

const bootSourceUrls: Partial<Record<DriveNumber, string>> = {};

/** Remember which catalog/URL image was loaded into a drive (autosave key). */
export function setBootSourceUrl(driveNo: DriveNumber, url: string) {
    if (!url || url.startsWith('local:')) return;
    bootSourceUrls[driveNo] = url;
}

export function getBootSourceUrl(
    driveNo: DriveNumber
): string | undefined {
    return bootSourceUrls[driveNo];
}

/** Boot disk URL from tracked load or the page hash fragment. */
export function getActiveDiskSourceUrl(
    driveNo: DriveNumber
): string | undefined {
    return bootSourceUrls[driveNo] ?? readHashDiskUrl(driveNo);
}

function readAutosaveRaw(
    sourceUrl: string,
    driveNo: DriveNumber
): { key: string; raw: string } | null {
    if (!haveStorage()) return null;
    for (const key of storageKeyCandidates(sourceUrl, driveNo)) {
        const raw = window.localStorage.getItem(key);
        if (raw) {
            return { key, raw };
        }
    }
    return null;
}

export function serializeDriveForAutosave(
    disk2: DiskII,
    driveNo: DriveNumber
): AutosaveRecord | null {
    const state = disk2.getState();
    const disk = state.drives[driveNo]?.disk;
    if (!disk || isNoFloppyDisk(disk)) {
        return null;
    }

    // Store the full drive state (raw nibble tracks). Sector-based JSON from
    // getJSON() re-parses tracks and corrupts modified DOS/ProDOS disks.
    return {
        v: 1,
        kind: 'drive',
        payload: base64_json_stringify(state.drives[driveNo]),
    };
}

export function hasDiskAutosave(
    sourceUrl: string,
    driveNo: DriveNumber
): boolean {
    return readAutosaveRaw(sourceUrl, driveNo) !== null;
}

export async function restoreDriveFromAutosave(
    disk2: DiskII,
    driveNo: DriveNumber,
    record: AutosaveRecord
): Promise<boolean> {
    if (record.kind === 'json') {
        // Legacy sector JSON saves are unreliable after in-game disk writes.
        return false;
    }

    const driveState = base64_json_parse(record.payload);
    const current = disk2.getState();
    current.drives[driveNo] = driveState as (typeof current.drives)[number];
    disk2.setState(current);
    return true;
}

export function saveDiskAutosave(
    disk2: DiskII,
    driveNo: DriveNumber,
    sourceUrl: string
): boolean {
    if (!haveStorage()) return false;

    const record = serializeDriveForAutosave(disk2, driveNo);
    if (!record) return false;

    try {
        const key = primaryStorageKey(sourceUrl, driveNo);
        window.localStorage.setItem(key, JSON.stringify(record));
        return true;
    } catch (error) {
        console.warn('Disk autosave failed', error);
        return false;
    }
}

export async function loadDiskAutosave(
    disk2: DiskII,
    driveNo: DriveNumber,
    sourceUrl: string
): Promise<boolean> {
    const found = readAutosaveRaw(sourceUrl, driveNo);
    if (!found) return false;

    try {
        const record = JSON.parse(found.raw) as AutosaveRecord;
        if (record.v !== 1 || !record.payload) return false;
        if (record.kind === 'json') {
            window.localStorage.removeItem(found.key);
            return false;
        }
        const ok = await restoreDriveFromAutosave(disk2, driveNo, record);
        if (ok) {
            // Migrate legacy keys to the canonical key.
            saveDiskAutosave(disk2, driveNo, sourceUrl);
        }
        return ok;
    } catch (error) {
        console.warn('Disk autosave restore failed', error);
        return false;
    }
}

/** Restore saved progress for a boot disk, if present. */
export async function tryRestoreDiskAutosave(
    disk2: DiskII,
    driveNo: DriveNumber,
    sourceUrl: string,
    driveLights: DriveLights
): Promise<boolean> {
    if (!haveStorage() || !readAutosaveEnabled()) return false;
    if (!hasDiskAutosave(sourceUrl, driveNo)) return false;
    if (await loadDiskAutosave(disk2, driveNo, sourceUrl)) {
        driveLights.dirty(driveNo, false);
        return true;
    }
    return false;
}

export function clearDiskAutosave(
    sourceUrl: string,
    driveNo: DriveNumber
): void {
    if (!haveStorage()) return;
    for (const key of storageKeyCandidates(sourceUrl, driveNo)) {
        window.localStorage.removeItem(key);
    }
}

export async function restoreDiskAutosaves(
    disk2: DiskII,
    driveLights: DriveLights
): Promise<void> {
    if (!haveStorage() || !readAutosaveEnabled()) return;

    for (const driveNo of DRIVE_NUMBERS) {
        const sourceUrl = getActiveDiskSourceUrl(driveNo);
        if (!sourceUrl) continue;
        await tryRestoreDiskAutosave(disk2, driveNo, sourceUrl, driveLights);
    }
}

let disk2Ref: DiskII | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const pendingDirty = new Set<DriveNumber>();

function flushAutosaveForDrives(
    driveNos: DriveNumber[],
    force = false
) {
    if (!disk2Ref || !haveStorage() || !readAutosaveEnabled()) return;

    for (const driveNo of driveNos) {
        const sourceUrl = getActiveDiskSourceUrl(driveNo);
        if (!sourceUrl) continue;
        if (!force && !disk2Ref.getMetadata(driveNo).dirty) continue;
        saveDiskAutosave(disk2Ref, driveNo, sourceUrl);
    }
}

function flushAllDirty() {
    if (!disk2Ref) return;
    for (const driveNo of DRIVE_NUMBERS) {
        if (disk2Ref.getMetadata(driveNo).dirty) {
            pendingDirty.add(driveNo);
        }
    }
    flushAutosaveForDrives([...pendingDirty], true);
    pendingDirty.clear();
}

function scheduleAutosave(driveNo: DriveNumber) {
    pendingDirty.add(driveNo);
    flushAutosaveForDrives([driveNo], true);
    if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
        debounceTimer = null;
        flushAutosaveForDrives([...pendingDirty], true);
        pendingDirty.clear();
    }, DEBOUNCE_MS);
}

/** Hook drive dirty events and page unload to persist modified disks. */
export function initDiskAutosave(disk2: DiskII, driveLights: DriveLights) {
    if (!haveStorage() || !readAutosaveEnabled()) return;

    disk2Ref = disk2;

    const originalDirty = driveLights.dirty.bind(driveLights);
    driveLights.dirty = (driveNo: DriveNumber, dirty: boolean) => {
        originalDirty(driveNo, dirty);
        if (dirty) {
            scheduleAutosave(driveNo);
        }
    };

    window.addEventListener('pagehide', flushAllDirty);
    window.addEventListener('beforeunload', flushAllDirty);

    setInterval(() => {
        flushAutosaveForDrives([...DRIVE_NUMBERS]);
    }, PERIODIC_MS);
}