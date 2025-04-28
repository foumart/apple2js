import { JSX } from 'preact';
import { DeepMemberOf, KnownKeys } from '../../types';

export const SPECIAL_KEY_MAP = {
    Shift: 'Shift',
    Enter: 'Return',
    CapsLock: 'Lock',
    Control: 'Control',
    Escape: 'Esc',
    Delete: 'Reset',
    Tab: 'Tab',
    Backspace: 'Delete',
    ArrowUp: '&uarr;',
    ArrowDown: '&darr;',
    ArrowRight: '&rarr;',
    ArrowLeft: '&larr;',
    // UiKit symbols
    UIKeyInputLeftArrow: '&larr;',
    UIKeyInputRightArrow: '&rarr;',
    UIKeyInputUpArrow: '&uarr;',
    UIKeyInputDownArrow: '&darr;',
    UIKeyInputEscape: 'Esc',
} as const;

export const isSpecialKey = (
    k: string
): k is KnownKeys<typeof SPECIAL_KEY_MAP> => {
    return k in SPECIAL_KEY_MAP;
};

export const SPECIAL_KEY_CODE = {
    Tab: 9,
    Return: 13,
    Esc: 27,
    '&uarr;': 11,
    '&darr;': 10,
    '&rarr;': 21,
    '&larr;': 8,
    Delete: 127,
} as const;

export const hasSpecialKeyCode = (
    k: string
): k is KnownKeys<typeof SPECIAL_KEY_CODE> => {
    return k in SPECIAL_KEY_CODE;
};

/**
 * Keyboard layout for the Apple ][ / ][+
 */
// prettier-ignore
export const keys2 = [
    [
        ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', ':', '-', 'Reset'],
        ['Esc', 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', 'REPT', 'Return'],
        ['Control', 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', '&larr;', '&rarr;'],
        ['Shift', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/', 'Shift'],
        ['PW', '&nbsp;'],
    ],
    [
        ['!', '"', '#', '$', '%', '&', "'", '(', ')', '0', '*', '=', 'Reset'],
        ['Esc', 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', '@', 'REPT', 'Return'],
        ['Control', 'A', 'S', 'D', 'F', 'BELL', 'H', 'J', 'K', 'L', '+', '&larr;', '&rarr;'],
        ['Shift', 'Z', 'X', 'C', 'V', 'B', '^', ']', '<', '>', '?', 'Shift'],
        ['PW', '&nbsp;'],
    ],
] as const;

export type Key2 = DeepMemberOf<typeof keys2>;

/**
 * Keyboard layout for the Apple //e
 */
// prettier-ignore
export const keys2e = [
    [
        ['Esc', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'Delete'],
        ['Tab', 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']', '\\'],
        ['Control', 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', '"', 'Return'],
        ['Shift', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/', 'Shift'],
        ['Lock', '`', 'PW', 'OPEN_APPLE', '&nbsp;', 'CLOSED_APPLE', '&larr;', '&rarr;', '&darr;', '&uarr;'],
    ],
    [
        ['Esc', '!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '_', '+', 'Delete'],
        ['Tab', 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '{', '}', '|'],
        ['Control', 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ':', "'", 'Return'],
        ['Shift', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', '<', '>', '?', 'Shift'],
        ['Caps', '~', 'PW', 'OPEN_APPLE', '&nbsp;', 'CLOSED_APPLE', '&larr;', '&rarr;', '&darr;', '&uarr;'],
    ],
] as const;

/** Shifted */
const ShiftED = {
    '!': '1',
    '@': '2',
    '#': '3',
    $: '4',
    '%': '5',
    '^': '6',
    '&': '7',
    '*': '8',
    '(': '9',
    ')': '0',
    _: '-',
    '+': '=',
    '{': '[',
    '}': ']',
    '|': '\\',
    ':': ';',
    "'": '"',
    '<': ',',
    '>': '.',
    '?': '/',
    '~': '`',
} as const;

export const isShiftyKey = (k: string): k is KnownKeys<typeof ShiftED> => {
    return k in ShiftED;
};

export type Key2e = DeepMemberOf<typeof keys2e>;

export type Key = Key2 | Key2e;

export type KeyFunction = (key: KeyboardEvent) => void;

/**
 * Convert a DOM keyboard event into an ASCII equivalent that
 * an Apple II can recognize.
 *
 * @param evt Event to convert
 * @param caps Caps Lock state
 * @returns a tuple of:
 *     * `key`: the symbol of the key
 *     * `keyLabel`: the label on the keycap
 *     * `keyCode`: the corresponding byte for the Apple II
 */
export const mapKeyboardEvent = (
    event: KeyboardEvent,
    caps: boolean = false,
    control: boolean = false
) => {
    let key: string;
    if (isSpecialKey(event.key)) {
        key = SPECIAL_KEY_MAP[event.key];
    } else if (event.key === 'Alt') {
        key = event.location === 1 ? 'OPEN_APPLE' : 'CLOSED_APPLE';
    } else {
        key = event.key;
    }

    let keyLabel = key;
    if (key.length === 1) {
        if (isShiftyKey(key)) {
            keyLabel = ShiftED[key];
        } else {
            keyLabel = key.toUpperCase();
        }
    }

    let keyCode = 0xff;
    if (hasSpecialKeyCode(key)) {
        keyCode = SPECIAL_KEY_CODE[key];
    } else if (key.length === 1) {
        keyCode = key.charCodeAt(0);
    }
    if ((caps || control) && keyCode >= 0x61 && keyCode <= 0x7a) {
        keyCode -= 0x20;
    }
    if (control && keyCode >= 0x40 && keyCode < 0x60) {
        keyCode -= 0x40;
    }

    return { key, keyLabel, keyCode };
};

/**
 * Convert a mouse event into an ASCII character based on the
 * data attached to the target DOM element.
 *
 * @param event Event to convert
 * @param shifted Shift key state
 * @param controlled Control key state
 * @param caps Caps Lock state
 * @param e //e status
 * @returns ASCII character
 */
export const mapMouseEvent = (
    event: JSX.TargetedMouseEvent<HTMLElement>,
    shifted: boolean,
    controlled: boolean,
    caps: boolean,
    e: boolean
) => {
    const keyLabel = event.currentTarget?.dataset.key2 ?? '';
    let key = event.currentTarget?.dataset[shifted ? 'key2' : 'key1'] ?? '';
    let keyCode = 0xff;

    switch (key) {
        case 'BELL':
            key = 'G';
            break;
        case 'Return':
            key = '\r';
            break;
        case 'Tab':
            key = '\t';
            break;
        case 'Delete':
            key = '\x7F';
            break;
        case '&larr;':
            key = '\x08';
            break;
        case '&rarr;':
            key = '\x15';
            break;
        case '&darr;':
            key = '\x0A';
            break;
        case '&uarr;':
            key = '\x0B';
            break;
        case '&nbsp;':
            key = ' ';
            break;
        case 'Esc':
            key = '\x1B';
            break;
        default:
            break;
    }

    if (key.length === 1) {
        if (controlled && key >= '@' && key <= '_') {
            keyCode = key.charCodeAt(0) - 0x40;
        } else if (e && !shifted && !caps && key >= 'A' && key <= 'Z') {
            keyCode = key.charCodeAt(0) + 0x20;
        } else {
            keyCode = key.charCodeAt(0);
        }
    }
    return { keyCode, key, keyLabel };
};

/**
 * Remap keys so that upper and lower are a tuple per row instead of
 * separate rows
 *
 * @param inKeys keys2 or keys2e
 * @returns Keys remapped
 */
export const keysAsTuples = (
    inKeys: typeof keys2e | typeof keys2
): string[][][] => {
    const rows = [];
    for (let idx = 0; idx < inKeys[0].length; idx++) {
        const upper = inKeys[0][idx];
        const lower = inKeys[1][idx];
        const keys = [];
        for (let jdx = 0; jdx < upper.length; jdx++) {
            keys.push([upper[jdx], lower[jdx]]);
        }
        rows.push(keys);
    }
    return rows;
};
