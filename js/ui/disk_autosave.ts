import { base64_json_parse, base64_json_stringify } from '../base64';
import DiskII from '../cards/disk2';
import {
    DriveNumber,
    DRIVE_NUMBERS,
    isNibbleDisk,
    isNoFloppyDisk,
} from '../formats/types';
import type DriveLights from './drive_lights';

const AUTOSAVE_PREFIX = 'apple2js:autosave:';
const DEBOUNCE_MS = 2000;

interface AutosaveRecord {
    v: 1;
    kind: 'json' | 'drive';
    payload: string;
}

function haveStorage(): boolean {
    return typeof window !== 'undefined' && !!window.localStorage;
}

/** URL/localStorage pref: autosave=false disables automatic disk progress saves. */
export function readAutosaveEnabled(
    search: string | URLSearchParams = window.location.search
): boolean {
    const params =
        typeof search === 'string'
            ? new URLSearchParams(
                  search.startsWith('?') ? search.slice(1) : search
              )
            : search;
    if (!params.has('autosave')) return true;
    return params.get('autosave') !== 'false';
}

function storageKey(sourceUrl: string, driveNo: DriveNumber): string {
    try {
        const url = new URL(sourceUrl, window.location.href);
        return `${AUTOSAVE_PREFIX}${url.pathname}:${driveNo}`;
    } catch {
        return `${AUTOSAVE_PREFIX}${sourceUrl}:${driveNo}`;
    }
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

export function serializeDriveForAutosave(
    disk2: DiskII,
    driveNo: DriveNumber
): AutosaveRecord | null {
    const state = disk2.getState();
    const disk = state.drives[driveNo]?.disk;
    if (!disk || isNoFloppyDisk(disk)) {
        return null;
    }

    if (isNibbleDisk(disk)) {
        try {
            return {
                v: 1,
                kind: 'json',
                payload: disk2.getJSON(driveNo),
            };
        } catch {
            /* fall through to full drive state */
        }
    }

    return {
        v: 1,
        kind: 'drive',
        payload: base64_json_stringify(state.drives[driveNo]),
    };
}

export function restoreDriveFromAutosave(
    disk2: DiskII,
    driveNo: DriveNumber,
    record: AutosaveRecord
): boolean {
    if (record.kind === 'json') {
        disk2.setJSON(driveNo, record.payload);
        return true;
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
        window.localStorage.setItem(
            storageKey(sourceUrl, driveNo),
            JSON.stringify(record)
        );
        return true;
    } catch (error) {
        console.warn('Disk autosave failed', error);
        return false;
    }
}

export function loadDiskAutosave(
    disk2: DiskII,
    driveNo: DriveNumber,
    sourceUrl: string
): boolean {
    if (!haveStorage()) return false;

    const raw = window.localStorage.getItem(storageKey(sourceUrl, driveNo));
    if (!raw) return false;

    try {
        const record = JSON.parse(raw) as AutosaveRecord;
        if (record.v !== 1 || !record.payload) return false;
        return restoreDriveFromAutosave(disk2, driveNo, record);
    } catch (error) {
        console.warn('Disk autosave restore failed', error);
        return false;
    }
}

export function clearDiskAutosave(
    sourceUrl: string,
    driveNo: DriveNumber
): void {
    if (!haveStorage()) return;
    window.localStorage.removeItem(storageKey(sourceUrl, driveNo));
}

export function restoreDiskAutosaves(
    disk2: DiskII,
    driveLights: DriveLights
): void {
    if (!haveStorage() || !readAutosaveEnabled()) return;

    for (const driveNo of DRIVE_NUMBERS) {
        const sourceUrl = bootSourceUrls[driveNo];
        if (!sourceUrl) continue;
        if (loadDiskAutosave(disk2, driveNo, sourceUrl)) {
            driveLights.dirty(driveNo, false);
        }
    }
}

let disk2Ref: DiskII | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const pendingDirty = new Set<DriveNumber>();

function flushAutosaveForDrives(driveNos: DriveNumber[]) {
    if (!disk2Ref || !haveStorage() || !readAutosaveEnabled()) return;

    for (const driveNo of driveNos) {
        const sourceUrl = bootSourceUrls[driveNo];
        if (!sourceUrl) continue;
        if (!disk2Ref.getMetadata(driveNo).dirty) continue;
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
    flushAutosaveForDrives([...pendingDirty]);
    pendingDirty.clear();
}

function scheduleAutosave(driveNo: DriveNumber) {
    pendingDirty.add(driveNo);
    if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
        debounceTimer = null;
        flushAutosaveForDrives([...pendingDirty]);
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
}
