/** @jest-environment jsdom */
import DiskII, { Callbacks } from 'js/cards/disk2';
import Apple2IO from 'js/apple2io';
import { CPU6502 } from '@whscullin/cpu6502';
import { VideoModes } from 'js/videomodes';
import { BYTES_BY_TRACK_IMAGE } from '../formats/testdata/16sector';
import {
    clearDiskAutosave,
    getBootSourceUrl,
    readAutosaveEnabled,
    restoreDriveFromAutosave,
    saveDiskAutosave,
    serializeDriveForAutosave,
    setBootSourceUrl,
} from 'js/ui/disk_autosave';

jest.mock('js/apple2io');
jest.mock('js/videomodes');

describe('disk_autosave', () => {
    const callbacks: jest.Mocked<Callbacks> = {
        driveLight: jest.fn(),
        dirty: jest.fn(),
        label: jest.fn(),
    };

    let io: Apple2IO;
    let disk2: DiskII;

    beforeEach(async () => {
        localStorage.clear();
        io = new Apple2IO(
            {} as unknown as CPU6502,
            {} as unknown as VideoModes
        );
        disk2 = new DiskII(io, callbacks);
        await disk2.setBinary(1, 'TEST', 'po', BYTES_BY_TRACK_IMAGE);
    });

    it('readAutosaveEnabled defaults to true', () => {
        expect(readAutosaveEnabled('')).toBe(true);
        expect(readAutosaveEnabled('?embedded=true')).toBe(true);
    });

    it('readAutosaveEnabled respects autosave=false', () => {
        expect(readAutosaveEnabled('?autosave=false')).toBe(false);
        expect(readAutosaveEnabled('?embedded=true&autosave=false')).toBe(
            false
        );
    });

    it('uses pathname for stable storage keys across query params', async () => {
        setBootSourceUrl(1, 'https://example.com/games/gridlock.dsk?v=1');
        const record = serializeDriveForAutosave(disk2, 1);
        expect(record).not.toBeNull();
        saveDiskAutosave(disk2, 1, 'https://example.com/games/gridlock.dsk?v=1');
        expect(
            localStorage.getItem('apple2js:autosave:/games/gridlock.dsk:1')
        ).not.toBeNull();

        const disk2b = new DiskII(io, callbacks);
        await disk2b.setBinary(1, 'TEST', 'po', BYTES_BY_TRACK_IMAGE);
        setBootSourceUrl(1, 'https://example.com/games/gridlock.dsk?v=2');
        expect(getBootSourceUrl(1)).toContain('gridlock.dsk');

        const saved = localStorage.getItem(
            'apple2js:autosave:/games/gridlock.dsk:1'
        )!;
        const parsed = JSON.parse(saved);
        restoreDriveFromAutosave(disk2b, 1, parsed);
        expect(disk2b.getJSON(1)).toBe(record!.payload);
    });

    it('clearDiskAutosave removes stored progress', () => {
        setBootSourceUrl(1, 'https://example.com/game.dsk');
        saveDiskAutosave(disk2, 1, 'https://example.com/game.dsk');
        clearDiskAutosave('https://example.com/game.dsk', 1);
        expect(
            localStorage.getItem('apple2js:autosave:/game.dsk:1')
        ).toBeNull();
    });
});
