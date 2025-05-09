import {
    dateToUint32,
    readFileName,
    writeFileName,
    uint32ToDate,
} from './utils';
import { FileEntry, readEntries, writeEntries } from './file_entry';
import { STORAGE_TYPES, ACCESS_TYPES } from './constants';
import { byte, word } from 'js/types';
import { ProDOSVolume } from '.';

export const DIRECTORY_OFFSETS = {
    PREV: 0x00,
    NEXT: 0x02,
    STORAGE_TYPE: 0x04,
    NAME_LENGTH: 0x04,
    DIRECTORY_NAME: 0x05,
    RESERVED_1: 0x14,
    CREATION: 0x1c,
    CASE_BITS: 0x20,
    VERSION: 0x20,
    MIN_VERSION: 0x21,
    ACCESS: 0x22,
    ENTRY_LENGTH: 0x23,
    ENTRIES_PER_BLOCK: 0x24,
    FILE_COUNT: 0x25,
    PARENT: 0x27,
    PARENT_ENTRY_NUMBER: 0x29,
    PARENT_ENTRY_LENGTH: 0x2a,
} as const;

export class Directory {
    prev: word = 0;
    next: word = 0;
    storageType: byte = STORAGE_TYPES.DIRECTORY;
    name: string = 'Untitled';
    creation: Date = new Date();
    access: byte = ACCESS_TYPES.ALL;
    entryLength = 0x27;
    entriesPerBlock: byte = 23;
    fileCount = 0;
    parent: word = 0;
    parentEntryLength: byte = 0;
    parentEntryNumber: byte = 0;
    entries: FileEntry[] = [];

    constructor(
        private volume: ProDOSVolume,
        private fileEntry: FileEntry
    ) {}

    async init() {
        await this.read();
    }

    async read(fileEntry?: FileEntry) {
        this.fileEntry = fileEntry ?? this.fileEntry;

        const readBlock = await this.volume
            .disk()
            .read(this.fileEntry.keyPointer);
        const block = new DataView(readBlock.buffer);

        this.prev = block.getUint16(DIRECTORY_OFFSETS.PREV, true);
        this.next = block.getUint16(DIRECTORY_OFFSETS.NEXT, true);
        this.storageType = block.getUint8(DIRECTORY_OFFSETS.STORAGE_TYPE) >> 4;
        const nameLength = block.getUint8(DIRECTORY_OFFSETS.NAME_LENGTH) & 0xf;
        const caseBits = block.getUint8(DIRECTORY_OFFSETS.CASE_BITS);
        this.name = readFileName(
            block,
            DIRECTORY_OFFSETS.DIRECTORY_NAME,
            nameLength,
            caseBits
        );
        this.creation = uint32ToDate(
            block.getUint32(DIRECTORY_OFFSETS.CREATION, true)
        );
        this.access = block.getUint8(DIRECTORY_OFFSETS.ACCESS);
        this.entryLength = block.getUint8(DIRECTORY_OFFSETS.ENTRY_LENGTH);
        this.entriesPerBlock = block.getUint8(
            DIRECTORY_OFFSETS.ENTRIES_PER_BLOCK
        );
        this.fileCount = block.getUint16(DIRECTORY_OFFSETS.FILE_COUNT, true);
        this.parent = block.getUint16(DIRECTORY_OFFSETS.PARENT, true);
        this.parentEntryNumber = block.getUint8(
            DIRECTORY_OFFSETS.PARENT_ENTRY_NUMBER
        );
        this.parentEntryLength = block.getUint8(
            DIRECTORY_OFFSETS.PARENT_ENTRY_LENGTH
        );

        this.entries = await readEntries(this.volume, block, this);
    }

    async write() {
        const readBlock = await this.volume
            .disk()
            .read(this.fileEntry.keyPointer);
        const block = new DataView(readBlock.buffer);

        const nameLength = this.name.length & 0x0f;
        block.setUint8(
            DIRECTORY_OFFSETS.STORAGE_TYPE,
            (this.storageType << 4) & nameLength
        );
        const caseBits = writeFileName(
            block,
            DIRECTORY_OFFSETS.DIRECTORY_NAME,
            this.name
        );
        block.setUint32(
            DIRECTORY_OFFSETS.CREATION,
            dateToUint32(this.creation),
            true
        );
        block.setUint16(DIRECTORY_OFFSETS.CASE_BITS, caseBits);
        block.setUint8(DIRECTORY_OFFSETS.ACCESS, this.access);
        block.setUint8(DIRECTORY_OFFSETS.ENTRY_LENGTH, this.entryLength);
        block.setUint8(
            DIRECTORY_OFFSETS.ENTRIES_PER_BLOCK,
            this.entriesPerBlock
        );
        block.setUint16(DIRECTORY_OFFSETS.FILE_COUNT, this.fileCount, true);
        block.setUint16(DIRECTORY_OFFSETS.PARENT, this.parent, true);
        block.setUint8(
            DIRECTORY_OFFSETS.PARENT_ENTRY_NUMBER,
            this.parentEntryNumber
        );
        block.setUint8(
            DIRECTORY_OFFSETS.PARENT_ENTRY_LENGTH,
            this.parentEntryLength
        );

        const vdh = await this.volume.vdh();
        await writeEntries(this.volume, block, vdh);
    }
}
