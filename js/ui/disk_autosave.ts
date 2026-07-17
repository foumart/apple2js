import { base64_json_parse, base64_json_stringify } from '../base64';
import DiskII from '../cards/disk2';
import {
    DriveNumber,
    DRIVE_NUMBERS,
    isNoFloppyDisk,
} from '../formats/types';
import type DriveLights from './drive_lights';

const AUTOSAVE_PREFIX = 'apple2js:autosave:';
const DEBOUNCE_MS = 2500;
const PERIODIC_MS = 5000;

/** Master switch for automatic disk-image persistence across reloads. */
export const DISK_AUTOSAVE_ENABLED = false;

interface AutosaveRecord {
    v: 1;
    kind: 'json' | 'drive';
    payload: string;
    /** Wall-clock ms when this record was written (newest wins on restore). */
    savedAt?: number;
}

function haveStorage(): boolean {
    return typeof window !== 'undefined' && !!window.localStorage;
}

/** URL/localStorage pref: autosave=false opts out when DISK_AUTOSAVE_ENABLED is on. */
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
        return url.pathname.replace(/^\/games\//i, '/game/').toLowerCase();
    } catch {
        const path = sourceUrl.split('?')[0].split('#')[0];
        return path.replace(/^\/games\//i, '/game/').toLowerCase();
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
): { key: string; raw: string; record: AutosaveRecord } | null {
    if (!haveStorage()) return null;

    let best: { key: string; raw: string; record: AutosaveRecord } | null =
        null;
    let bestScore = -1;

    for (const key of storageKeyCandidates(sourceUrl, driveNo)) {
        const raw = window.localStorage.getItem(key);
        if (!raw) continue;

        try {
            const record = JSON.parse(raw) as AutosaveRecord;
            if (record.v !== 1 || !record.payload) continue;
            if (record.kind === 'json') continue;

            const score = record.savedAt ?? record.payload.length;
            if (score > bestScore) {
                bestScore = score;
                best = { key, raw, record };
            }
        } catch {
            continue;
        }
    }

    return best;
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
        savedAt: Date.now(),
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

    try {
        const driveState = base64_json_parse(record.payload) as {
            disk?: unknown;
        };
        if (!driveState?.disk) {
            return false;
        }

        const current = disk2.getState();
        current.drives[driveNo] = driveState as (typeof current.drives)[number];
        disk2.setState(current);

        const restored = disk2.getState().drives[driveNo]?.disk;
        return !!restored && !isNoFloppyDisk(restored);
    } catch (error) {
        console.warn('restoreDriveFromAutosave failed', error);
        return false;
    }
}

export function saveDiskAutosave(
    disk2: DiskII,
    driveNo: DriveNumber,
    sourceUrl: string,
    opts?: { manual?: boolean }
): boolean {
    if (!haveStorage()) return false;
    if (!opts?.manual && !modifiedSinceBoot.has(driveNo)) return false;

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
        const record = found.record;
        if (record.kind === 'json') {
            window.localStorage.removeItem(found.key);
            return false;
        }
        const ok = await restoreDriveFromAutosave(disk2, driveNo, record);
        if (ok) {
            // Migrate legacy keys without re-serializing (avoids clobbering good
            // data if the in-memory restore is incomplete for any reason).
            const canonicalKey = primaryStorageKey(sourceUrl, driveNo);
            if (found.key !== canonicalKey) {
                window.localStorage.setItem(canonicalKey, found.raw);
                window.localStorage.removeItem(found.key);
            }
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

    const sourceCandidates = new Set<string>([sourceUrl]);
    const hashUrl = readHashDiskUrl(driveNo);
    if (hashUrl) {
        sourceCandidates.add(hashUrl);
    }

    for (const candidate of sourceCandidates) {
        if (!hasDiskAutosave(candidate, driveNo)) continue;
        if (await loadDiskAutosave(disk2, driveNo, candidate)) {
            driveLights.dirty(driveNo, false);
            console.info(
                'Disk autosave restored for drive',
                driveNo,
                canonicalPath(candidate)
            );
            return true;
        }
    }

    if (
        [...sourceCandidates].some((candidate) =>
            hasDiskAutosave(candidate, driveNo)
        )
    ) {
        console.warn(
            'Disk autosave present but restore failed for drive',
            driveNo,
            canonicalPath(sourceUrl)
        );
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

/*
 * Manual save/load state. Unlike the automatic hooks, these are user-initiated
 * (a single serialize on click) and intentionally bypass DISK_AUTOSAVE_ENABLED.
 * They persist the raw disk image, which is where DOS/ProDOS games (e.g. the
 * GridLock SETTINGS file) store progress.
 */

/** Persist disk progress for every drive that holds a disk. */
export function saveStateNow(disk2: DiskII): boolean {
    if (!haveStorage()) return false;

    let saved = false;
    for (const driveNo of DRIVE_NUMBERS) {
        const sourceUrl = getActiveDiskSourceUrl(driveNo);
        if (!sourceUrl) continue;
        if (saveDiskAutosave(disk2, driveNo, sourceUrl, { manual: true })) {
            saved = true;
        }
    }
    return saved;
}

/** Restore disk progress for every drive that has a saved state. */
export async function loadStateNow(
    disk2: DiskII,
    driveLights: DriveLights
): Promise<boolean> {
    if (!haveStorage()) return false;

    let restored = false;
    for (const driveNo of DRIVE_NUMBERS) {
        const sourceUrl = getActiveDiskSourceUrl(driveNo);
        if (!sourceUrl) continue;
        if (!hasDiskAutosave(sourceUrl, driveNo)) continue;
        if (await loadDiskAutosave(disk2, driveNo, sourceUrl)) {
            driveLights.dirty(driveNo, false);
            restored = true;
        }
    }
    return restored;
}

/** Whether any active drive has a saved state on disk. */
export function hasSavedState(disk2: DiskII): boolean {
    if (!haveStorage()) return false;
    // disk2 is accepted for symmetry / future per-disk checks.
    void disk2;
    for (const driveNo of DRIVE_NUMBERS) {
        const sourceUrl = getActiveDiskSourceUrl(driveNo);
        if (sourceUrl && hasDiskAutosave(sourceUrl, driveNo)) {
            return true;
        }
    }
    return false;
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
/** Drives the player has written to since autosave hooks were armed. */
const modifiedSinceBoot = new Set<DriveNumber>();
const lastDirtyAt = new Map<DriveNumber, number>();

function flushAutosaveForDrives(
    driveNos: DriveNumber[],
    force = false,
    manual = false
) {
    if (!disk2Ref || !haveStorage() || !readAutosaveEnabled()) return;

    for (const driveNo of driveNos) {
        const sourceUrl = getActiveDiskSourceUrl(driveNo);
        if (!sourceUrl) continue;
        if (!manual && !modifiedSinceBoot.has(driveNo)) continue;
        if (!force && !disk2Ref.getMetadata(driveNo).dirty) continue;
        saveDiskAutosave(disk2Ref, driveNo, sourceUrl, { manual });
    }
}

function flushAllDirty() {
    if (!disk2Ref) return;
    const now = Date.now();
    for (const driveNo of DRIVE_NUMBERS) {
        if (!modifiedSinceBoot.has(driveNo)) continue;
        if (!disk2Ref.getMetadata(driveNo).dirty) continue;
        const last = lastDirtyAt.get(driveNo) ?? 0;
        if (now - last < DEBOUNCE_MS) continue;
        pendingDirty.add(driveNo);
    }
    flushAutosaveForDrives([...pendingDirty], true, false);
    pendingDirty.clear();
}

function scheduleAutosave(driveNo: DriveNumber) {
    // IMPORTANT: the dirty callback fires on EVERY nibble written to disk
    // (thousands of times during a single BSAVE). Serializing synchronously
    // here froze the emulator loop, so only ever (re)arm a debounce timer that
    // coalesces the writes into a single save once activity settles.
    pendingDirty.add(driveNo);
    if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
        debounceTimer = null;
        flushAutosaveForDrives([...pendingDirty], false, false);
        pendingDirty.clear();
    }, DEBOUNCE_MS);
}

/** Hook drive dirty events and page unload to persist modified disks. */
export function initDiskAutosave(disk2: DiskII, driveLights: DriveLights) {
    if (!haveStorage() || !readAutosaveEnabled()) return;

    disk2Ref = disk2;
    modifiedSinceBoot.clear();
    lastDirtyAt.clear();

    const originalDirty = driveLights.dirty.bind(driveLights);
    driveLights.dirty = (driveNo: DriveNumber, dirty: boolean) => {
        originalDirty(driveNo, dirty);
        if (dirty) {
            modifiedSinceBoot.add(driveNo);
            lastDirtyAt.set(driveNo, Date.now());
            scheduleAutosave(driveNo);
        }
    };

    window.addEventListener('pagehide', flushAllDirty);
    window.addEventListener('beforeunload', flushAllDirty);

    setInterval(() => {
        flushAutosaveForDrives([...DRIVE_NUMBERS]);
    }, PERIODIC_MS);
}