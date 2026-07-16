import { Apple2, State as Apple2State } from '../apple2';

/*
 * Full-machine save state (CPU + RAM + video + all slot cards) persisted to
 * IndexedDB. localStorage is not viable here: the RAMFactor card alone holds
 * 8 MB, which exceeds the ~5 MB localStorage quota once serialized.
 */

const DB_NAME = 'apple2js';
const DB_VERSION = 1;
const STORE = 'savestate';
const RECORD_VERSION = 1;

interface SaveStateRecord {
    v: number;
    savedAt: number;
    state: Apple2State;
}

function haveIdb(): boolean {
    return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) {
                db.createObjectStore(STORE);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function idbPut(key: string, value: unknown): Promise<void> {
    return openDb().then(
        (db) =>
            new Promise<void>((resolve, reject) => {
                const tx = db.transaction(STORE, 'readwrite');
                tx.objectStore(STORE).put(value, key);
                tx.oncomplete = () => {
                    db.close();
                    resolve();
                };
                tx.onerror = () => {
                    db.close();
                    reject(tx.error);
                };
                tx.onabort = () => {
                    db.close();
                    reject(tx.error);
                };
            })
    );
}

function idbGet(key: string): Promise<unknown> {
    return openDb().then(
        (db) =>
            new Promise<unknown>((resolve, reject) => {
                const tx = db.transaction(STORE, 'readonly');
                const req = tx.objectStore(STORE).get(key);
                req.onsuccess = () => {
                    db.close();
                    resolve(req.result);
                };
                req.onerror = () => {
                    db.close();
                    reject(req.error);
                };
            })
    );
}

function idbHasKey(key: string): Promise<boolean> {
    return openDb().then(
        (db) =>
            new Promise<boolean>((resolve, reject) => {
                const tx = db.transaction(STORE, 'readonly');
                const req = tx.objectStore(STORE).getKey(key);
                req.onsuccess = () => {
                    db.close();
                    resolve(req.result !== undefined);
                };
                req.onerror = () => {
                    db.close();
                    reject(req.error);
                };
            })
    );
}

function isThenable(value: unknown): value is Promise<unknown> {
    return (
        !!value &&
        (typeof value === 'object' || typeof value === 'function') &&
        typeof (value as { then?: unknown }).then === 'function'
    );
}

/**
 * Resolve any async card states (e.g. SmartPort) that `Apple2IO.getState()`
 * returns as unresolved Promises, so the snapshot is fully serializable.
 */
async function buildResolvedState(apple2: Apple2): Promise<Apple2State> {
    const state = apple2.getState();
    const cards = state.io?.cards as unknown[] | undefined;
    if (Array.isArray(cards)) {
        for (let idx = 0; idx < cards.length; idx++) {
            if (isThenable(cards[idx])) {
                cards[idx] = await cards[idx];
            }
        }
    }
    return state;
}

export async function saveFullState(
    apple2: Apple2,
    key: string
): Promise<boolean> {
    if (!haveIdb()) return false;
    try {
        const state = await buildResolvedState(apple2);
        const record: SaveStateRecord = {
            v: RECORD_VERSION,
            savedAt: Date.now(),
            state,
        };
        await idbPut(key, record);
        return true;
    } catch (error) {
        console.warn('Save state failed', error);
        return false;
    }
}

export async function loadFullState(
    apple2: Apple2,
    key: string
): Promise<boolean> {
    if (!haveIdb()) return false;
    try {
        const record = (await idbGet(key)) as SaveStateRecord | undefined;
        if (!record || !record.state) return false;
        apple2.setState(record.state);
        return true;
    } catch (error) {
        console.warn('Load state failed', error);
        return false;
    }
}

export async function hasFullState(key: string): Promise<boolean> {
    if (!haveIdb()) return false;
    try {
        return await idbHasKey(key);
    } catch {
        return false;
    }
}
