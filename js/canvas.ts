import { byte, Color, memory, MemoryPages, rom } from './types';
import RAM from './ram';
import {
    HiresPage,
    LoresPage,
    Region,
    VideoModes,
    VideoModesState,
    bank,
    pageNo,
} from './videomodes';

const dim = (c: Color, alpha = 0.75): Color => [
    (c[0] * alpha) & 255,
    (c[1] * alpha) & 255,
    (c[2] * alpha) & 255
];

const mix = (c1: Color, c2: Color, ratio = 0.5): Color => [
    Math.min(255, Math.max(0, (c1[0] * ratio + c2[0] * (1 - ratio)) | 0)),
    Math.min(255, Math.max(0, (c1[1] * ratio + c2[1] * (1 - ratio)) | 0)),
    Math.min(255, Math.max(0, (c1[2] * ratio + c2[2] * (1 - ratio)) | 0))
];

// hires colors
let orangeCol: Color;
let greenCol: Color;
let blueCol: Color;
let violetCol: Color;
let whiteCol: Color;
let blackCol: Color;

let _colors: Color[];
let dcolors: Color[];

// Composite pseudo display - dimming parts of the colored pixels
const colorMap = [
    [0, 0, 0, 0], // Black
    [0, 0,.5, 1], // Red
    [1,.7, 0, 0], // Dark Blue
    [1,.4,.6, 1], // Purple
    [.7,1,.6, 0], // Dark Green
    [1, 1, 1,.7], // Gray 1
    [1, 1,.7,.5], // Medium Blue
    [1, 1,.7,.6], // Light Blue
    [0,.6, 1,.7], // Brown
    [.5,.7,1, 1], // Orange
    [.7,1, 1, 1], // Gray 2
    [1,.7, 1, 1], // Pink
    [.9,1, 1,.5], // Light Green
    [.7,1, 1, 1], // Yellow
    [1, 1, 1,.7], // Aqua
    [1, 1, 1, 1], // White
];

setColors(0);

function setColors(colorPalette: number) {
    orangeCol = colorPalette === 2 ? [0x90, 0x90, 0x90] : colorPalette === 3 ? [0x94, 0x94, 0x94] : colorPalette ? [0xff, 0x65, 0x00] : [0xff, 0x6a, 0x3c];
    greenCol = colorPalette === 2  ? [0xa0, 0xa0, 0xa0] : colorPalette === 3 ? [0x5c, 0x5c, 0x5c] : colorPalette ? [0x00, 0xff, 0x00] : [0x14, 0xf5, 0x3c];
    blueCol = colorPalette === 2   ? [0xc0, 0xc0, 0xc0] : colorPalette === 3 ? [0x80, 0x80, 0x80] : colorPalette ? [0x09, 0x2a, 0xff] : [0x14, 0xcf, 0xfd];
    violetCol = colorPalette === 2 ? [0xb0, 0xb0, 0xb0] : colorPalette === 3 ? [0xac, 0xac, 0xac] : colorPalette ? [0xc9, 0x39, 0xc7] : [0xff, 0x44, 0xfd];
    whiteCol = colorPalette === 2  ? [0xff, 0xff, 0xff] : colorPalette === 3 ? [0xff, 0xff, 0xff] : colorPalette ? [0xff, 0xff, 0xff] : [0xff, 0xff, 0xff];
    blackCol = colorPalette === 2  ? [0x00, 0x00, 0x00] : colorPalette === 3 ? [0x00, 0x00, 0x00] : colorPalette ? [0x00, 0x00, 0x00] : [0x00, 0x00, 0x00];

    _colors = setLColors(colorPalette);
    dcolors = setDColors(colorPalette);
}

function get16Colors(colorPalette: number): Color[] {
    return [
        colorPalette === 2 ? [0x00, 0x00, 0x00] : colorPalette === 3 ? [0x00, 0x00, 0x00] : colorPalette ? [0x00, 0x00, 0x00] : [0x00, 0x00, 0x00], // 0x0 black
        colorPalette === 2 ? [0x80, 0x80, 0x80] : colorPalette === 3 ? [0x80, 0x80, 0x80] : colorPalette ? [0xdd, 0x00, 0x33] : [0xe3, 0x1e, 0x60], // 0x1 deep red
        colorPalette === 2 ? [0x78, 0x78, 0x78] : colorPalette === 3 ? [0x85, 0x85, 0x85] : colorPalette ? [0x00, 0x00, 0x99] : [0x60, 0x4e, 0xbd], // 0x2 dark blue
        colorPalette === 2 ? [0xa8, 0xa8, 0xa8] : colorPalette === 3 ? [0xa1, 0xa1, 0xa1] : colorPalette ? [0xdd, 0x00, 0xdd] : [0xff, 0x44, 0xfd], // 0x3 purple
        colorPalette === 2 ? [0x88, 0x88, 0x88] : colorPalette === 3 ? [0x51, 0x51, 0x51] : colorPalette ? [0x00, 0x77, 0x00] : [0x00, 0xa3, 0x60], // 0x4 dark green
        colorPalette === 2 ? [0x99, 0x99, 0x99] : colorPalette === 3 ? [0x9c, 0x9c, 0x9c] : colorPalette ? [0x66, 0x66, 0x66] : [0x9c, 0x9c, 0x9c], // 0x5 dark gray
        colorPalette === 2 ? [0xb8, 0xb8, 0xb8] : colorPalette === 3 ? [0x88, 0x88, 0x88] : colorPalette ? [0x22, 0x22, 0xff] : [0x14, 0xcf, 0xfd], // 0x6 medium blue
        colorPalette === 2 ? [0xd4, 0xd4, 0xd4] : colorPalette === 3 ? [0xe1, 0xe1, 0xe1] : colorPalette ? [0x66, 0xaa, 0xff] : [0xd0, 0xc3, 0xff], // 0x7 light blue
        colorPalette === 2 ? [0x66, 0x66, 0x66] : colorPalette === 3 ? [0x3a, 0x3a, 0x3a] : colorPalette ? [0x88, 0x55, 0x22] : [0x60, 0x72, 0x03], // 0x8 brown
        colorPalette === 2 ? [0xa0, 0xa0, 0xa0] : colorPalette === 3 ? [0x9d, 0x9d, 0x9d] : colorPalette ? [0xff, 0x66, 0x00] : [0xff, 0x6a, 0x3c], // 0x9 orange
        colorPalette === 2 ? [0x99, 0x99, 0x99] : colorPalette === 3 ? [0x9c, 0x9c, 0x9c] : colorPalette ? [0x99, 0x99, 0x99] : [0x9c, 0x9c, 0x9c], // 0xa light gray
        colorPalette === 2 ? [0xcc, 0xcc, 0xcc] : colorPalette === 3 ? [0xcf, 0xcf, 0xcf] : colorPalette ? [0xff, 0x99, 0x88] : [0xff, 0xa0, 0xd0], // 0xb pink
        colorPalette === 2 ? [0xbb, 0xbb, 0xbb] : colorPalette === 3 ? [0x84, 0x84, 0x84] : colorPalette ? [0x00, 0xdd, 0x00] : [0x14, 0xf5, 0x3c], // 0xc green
        colorPalette === 2 ? [0xee, 0xee, 0xee] : colorPalette === 3 ? [0xb5, 0xb5, 0xb5] : colorPalette ? [0xff, 0xff, 0x00] : [0xd0, 0xdd, 0x8d], // 0xd yellow
        colorPalette === 2 ? [0xdd, 0xdd, 0xdd] : colorPalette === 3 ? [0xb8, 0xb8, 0xb8] : colorPalette ? [0x00, 0xff, 0x99] : [0x72, 0xff, 0xd0], // 0xe aquamarine
        colorPalette === 2 ? [0xff, 0xff, 0xff] : colorPalette === 3 ? [0xff, 0xff, 0xff] : colorPalette ? [0xff, 0xff, 0xff] : [0xff, 0xff, 0xff]  // 0xf white
    ];
}

// lores colors
function setLColors(colorPalette: number): Color[] {
    return get16Colors(colorPalette);
}

function setDColors(colorPalette: number): Color[] {
    return get16Colors(colorPalette);
};

//
const r4 = [
    0, // Black
    2, // Dark Blue
    4, // Dark Green
    6, // Medium Blue

    8, // Brown
    5, // Gray 1
    12, // Light Green
    14, // Aqua

    1, // Red
    3, // Purple
    10, // Gray 2
    7, // Pink

    9, // Orange
    11, // Light Blue
    13, // Yellow
    15, // White
] as const;

const notDirty: Region = {
    top: 193,
    bottom: -1,
    left: 561,
    right: -1,
} as const;

/****************************************************************************
 *
 * Text/Lores Graphics
 *
 ***************************************************************************/

export class LoresPage2D implements LoresPage {
    // $00-$3F inverse
    // $40-$7F flashing
    // $80-$FF normal

    private _buffer: memory[] = [];
    private _refreshing = false;
    private _blink = false;
    private _blinkInterval: ReturnType<typeof setInterval> | undefined;

    private highColorTextMode = false;

    dirty: Region = { ...notDirty };
    imageData: ImageData;

    constructor(
        private vm: VideoModes,
        private page: pageNo,
        private ram: RAM[],
        private charset: rom,
        private readonly e: boolean
    ) {
        this.imageData = this.vm.context.createImageData(560, 192);
        this.imageData.data.fill(0xff);
        const start = 0x4 * this.page;
        const end = start + 0x4;
        this._buffer[0] = this.ram[0].getBuffer(start, end);
        this._buffer[1] = this.ram[1]?.getBuffer(start, end);

        this.vm.setLoresPage(page, this);
    }

    private _drawPixel(data: Uint8ClampedArray, off: number, color: Color) {
        const c0 = color[0],
            c1 = color[1],
            c2 = color[2];
        data[off + 0] = data[off + 4] = c0;
        data[off + 1] = data[off + 5] = c1;
        data[off + 2] = data[off + 6] = c2;
    }

    private _drawHalfPixel(data: Uint8ClampedArray, off: number, color: Color) {
        const c0 = color[0],
            c1 = color[1],
            c2 = color[2];
        data[off + 0] = c0;
        data[off + 1] = c1;
        data[off + 2] = c2;
    }

    private _checkInverse(val: byte) {
        let inverse = false;
        if (this.e) {
            if (!this.vm._80colMode && !this.vm.altCharMode) {
                inverse = (val & 0xc0) === 0x40 && this._blink;
            }
        } else {
            inverse = !(val & 0x80 || (val & 0x40 && this._blink));
        }
        return inverse;
    }

    bank0(): MemoryPages {
        return {
            start: () => this._start(),
            end: () => this._end(),
            read: (page, off) => this._read(page, off, 0),
            write: (page, off, val) => this._write(page, off, val, 0),
        };
    }

    bank1(): MemoryPages {
        return {
            start: () => this._start(),
            end: () => this._end(),
            read: (page, off) => this._read(page, off, 1),
            write: (page, off, val) => this._write(page, off, val, 1),
        };
    }

    // These are used by both bank 0 and 1

    private _start() {
        return 0x04 * this.page;
    }

    private _end() {
        return 0x04 * this.page + 0x03;
    }

    private _read(page: byte, off: byte, bank: bank) {
        const addr = (page << 8) | off,
            base = addr & 0x3ff;
        return this._buffer[bank][base];
    }

    private _write(page: byte, off: byte, val: byte, bank: bank) {
        const addr = (page << 8) | off;
        const base = addr & 0x3ff;
        let fore, back;

        if (this._buffer[bank][base] === val && !this._refreshing) {
            return;
        }
        this._buffer[bank][base] = val;

        const col = (base % 0x80) % 0x28;
        const adj = off - col;

        // 000001cd eabab000 -> 000abcde
        const ab = adj & 0x18;
        const cd = (page & 0x03) << 1;
        const ee = adj >> 7;
        const row = ab | cd | ee;

        const data = this.imageData.data;
        if (row < 24 && col < 40) {
            let y = row << 3;
            if (y < this.dirty.top) {
                this.dirty.top = y;
            }
            y += 8;
            if (y > this.dirty.bottom) {
                this.dirty.bottom = y;
            }
            let x = col * 14;
            if (x < this.dirty.left) {
                this.dirty.left = x;
            }
            x += 14;
            if (x > this.dirty.right) {
                this.dirty.right = x;
            }

            if (
                this.vm.textMode ||
                this.vm.hiresMode ||
                (this.vm.mixedMode && row > 19)
            ) {
                if (this.vm._80colMode) {
                    const inverse = this._checkInverse(val);

                    fore = inverse ? blackCol : whiteCol;
                    back = inverse ? whiteCol : blackCol;

                    if (!this.vm.altCharMode) {
                        val = val >= 0x40 && val < 0x80 ? val - 0x40 : val;
                    }

                    let offset =
                        (col * 14 + (bank ? 0 : 1) * 7 + row * 560 * 8) * 4;

                    for (let jdx = 0; jdx < 8; jdx++) {
                        let b = this.charset[val * 8 + jdx];
                        for (let idx = 0; idx < 7; idx++) {
                            const color = b & 0x01 ? back : fore;
                            this._drawHalfPixel(data, offset, color);
                            b >>= 1;
                            offset += 4;
                        }
                        offset += 553 * 4;
                    }
                } else {
                    val = this._buffer[0][base];

                    const inverse = this._checkInverse(val);

                    fore = inverse ? blackCol : whiteCol;
                    back = inverse ? whiteCol : blackCol;

                    if (!this.vm.altCharMode) {
                        val = val >= 0x40 && val < 0x80 ? val - 0x40 : val;
                    }

                    let offset = (col * 14 + row * 560 * 8) * 4;

                    if (this.highColorTextMode) {
                        fore = _colors[this._buffer[1][base] >> 4];
                        back = _colors[this._buffer[1][base] & 0x0f];
                    }

                    if (this.e) {
                        for (let jdx = 0; jdx < 8; jdx++) {
                            let b = this.charset[val * 8 + jdx];
                            for (let idx = 0; idx < 7; idx++) {
                                const color = b & 0x01 ? back : fore;
                                this._drawPixel(data, offset, color);
                                b >>= 1;
                                offset += 8;
                            }
                            offset += 546 * 4;
                        }
                    } else {
                        const colorMode =
                            this.vm.mixedMode &&
                            !this.vm.textMode &&
                            !this.vm.monoMode;
                        // var val0 = col > 0 ? _buffer[0][base - 1] : 0;
                        // var val2 = col < 39 ? _buffer[0][base + 1] : 0;

                        for (let jdx = 0; jdx < 8; jdx++) {
                            let odd = !(col & 0x1);
                            let b = this.charset[val * 8 + jdx] << 1;
                            if (colorMode) {
                                // var b0 = charset[val0 * 8 + jdx];
                                // var b2 = charset[val2 * 8 + jdx];
                                if (inverse) {
                                    b ^= 0x1ff;
                                }
                            }

                            for (let idx = 0; idx < 7; idx++) {
                                let color;
                                if (colorMode) {
                                    if (b & 0x80) {
                                        if ((b & 0x1c0) !== 0x80) {
                                            color = whiteCol;
                                        } else {
                                            color = odd ? violetCol : greenCol;
                                        }
                                    } else {
                                        color = blackCol;
                                    }
                                    odd = !odd;
                                } else {
                                    color = b & 0x80 ? fore : back;
                                }
                                this._drawPixel(data, offset, color);
                                b <<= 1;
                                offset += 8;
                            }
                            offset += 546 * 4;
                        }
                    }
                }
            } else {
                if (this.vm._80colMode && !this.vm.an3State) {
                    let offset =
                        (col * 14 + (bank ? 0 : 1) * 7 + row * 560 * 8) * 4;
                    if (this.vm.monoMode) {
                        for (let jdx = 0; jdx < 8; jdx++) {
                            let b = jdx < 4 ? val & 0x0f : val >> 4;
                            b |= b << 4;
                            b |= b << 8;
                            if (col & 0x1) {
                                b >>= 2;
                            }
                            for (let idx = 0; idx < 7; idx++) {
                                const color = b & 0x01 ? whiteCol : blackCol;
                                this._drawHalfPixel(data, offset, color);
                                b >>= 1;
                                offset += 4;
                            }
                            offset += 553 * 4;
                        }
                    } else {
                        if (bank & 0x1) {
                            val = ((val & 0x77) << 1) | ((val & 0x88) >> 3);
                        }
                        for (let jdx = 0; jdx < 8; jdx++) {
                            const color =
                                _colors[jdx < 4 ? val & 0x0f : val >> 4];
                            for (let idx = 0; idx < 7; idx++) {
                                this._drawHalfPixel(data, offset, color);
                                offset += 4;
                            }
                            offset += 553 * 4;
                        }
                    }
                } else if (bank === 0) {
                    let offset = (col * 14 + row * 560 * 8) * 4;

                    if (this.vm.monoMode) {
                        for (let jdx = 0; jdx < 8; jdx++) {
                            let b = jdx < 4 ? val & 0x0f : val >> 4;
                            b |= b << 4;
                            b |= b << 8;
                            if (col & 0x1) {
                                b >>= 2;
                            }
                            for (let idx = 0; idx < 14; idx++) {
                                const color = b & 0x0001 ? whiteCol : blackCol;
                                this._drawHalfPixel(data, offset, color);
                                b >>= 1;
                                offset += 4;
                            }
                            offset += 546 * 4;
                        }
                    } else {
                        for (let jdx = 0; jdx < 8; jdx++) {
                            const color =
                                _colors[jdx < 4 ? val & 0x0f : val >> 4];
                            for (let idx = 0; idx < 3; idx++) {
                                this._drawPixel(data, offset, color);
                                offset += 8;
                            }
                            offset += 546 * 4;
                        }
                    }
                }
            }
        }
    }

    refresh() {
        this.highColorTextMode =
            !this.vm.an3State && this.vm.textMode && !this.vm._80colMode;

        let addr = 0x400 * this.page;
        this._refreshing = true;
        for (let idx = 0; idx < 0x400; idx++, addr++) {
            this._write(addr >> 8, addr & 0xff, this._buffer[0][idx], 0);
            if (this.vm._80colMode) {
                this._write(addr >> 8, addr & 0xff, this._buffer[1][idx], 1);
            }
        }
        this._refreshing = false;
    }

    blink() {
        let addr = 0x400 * this.page;
        this._refreshing = true;
        this._blink = !this._blink;
        for (let idx = 0; idx < 0x400; idx++, addr++) {
            const b = this._buffer[0][idx];
            if ((b & 0xc0) === 0x40) {
                this._write(addr >> 8, addr & 0xff, this._buffer[0][idx], 0);
            }
        }
        this._refreshing = false;
    }

    start() {
        if (!this._blinkInterval) {
            this._blinkInterval = setInterval(() => this.blink(), 267);
        }
        return this._start();
    }

    end() {
        return this._end();
    }

    read(page: byte, off: byte) {
        return this._read(page, off, 0);
    }

    write(page: byte, off: byte, val: byte) {
        return this._write(page, off, val, 0);
    }

    private rowToBase(row: number) {
        const ab = (row >> 3) & 3;
        const cd = (row >> 1) & 0x3;
        const e = row & 1;
        return (cd << 8) | (e << 7) | (ab << 5) | (ab << 3);
    }

    private mapCharCode(charCode: byte) {
        charCode &= 0x7f;
        if (charCode < 0x20) {
            charCode += 0x40;
        }
        if (!this.e && charCode >= 0x60) {
            charCode -= 0x40;
        }
        return charCode;
    }

    getText() {
        let buffer = '',
            line,
            charCode;
        let row, col, base;
        for (row = 0; row < 24; row++) {
            base = this.rowToBase(row);
            line = '';
            if (this.e && this.vm._80colMode) {
                for (col = 0; col < 80; col++) {
                    charCode = this.mapCharCode(
                        this._buffer[1 - (col % 2)][base + Math.floor(col / 2)]
                    );
                    line += String.fromCharCode(charCode);
                }
            } else {
                for (col = 0; col < 40; col++) {
                    charCode = this.mapCharCode(this._buffer[0][base + col]);
                    line += String.fromCharCode(charCode);
                }
            }
            line = line.trimEnd();
            buffer += line + '\n';
        }
        return buffer;
    }
}

/****************************************************************************
 *
 * Hires Graphics
 *
 ***************************************************************************/

export class HiresPage2D implements HiresPage {
    public imageData: ImageData;
    dirty: Region = { ...notDirty };

    private _buffer: memory[] = [];
    private _refreshing = false;

    highColorHGRMode: boolean;
    oneSixtyMode: boolean;
    mixedDHRMode: boolean;
    monoDHRMode: boolean;
    colorDHRMode: boolean = true;

    constructor(
        private vm: VideoModes,
        private page: pageNo,
        private ram: RAM[]
    ) {
        this.imageData = this.vm.context.createImageData(560, 192);
        this.imageData.data.fill(0xff);

        const start = 0x20 * this.page;
        const end = start + 0x20;
        this._buffer[0] = this.ram[0].getBuffer(start, end);
        this._buffer[1] = this.ram[1]?.getBuffer(start, end);

        this.vm.setHiresPage(page, this);
    }

    private _drawPixel(data: Uint8ClampedArray, off: number, color: Color) {
        const c0 = color[0],
            c1 = color[1],
            c2 = color[2];

        data[off + 0] = data[off + 4] = c0;
        data[off + 1] = data[off + 5] = c1;
        data[off + 2] = data[off + 6] = c2;
    }

    private _drawHalfPixel(data: Uint8ClampedArray, off: number, color: Color) {
        const c0 = color[0],
            c1 = color[1],
            c2 = color[2];

        data[off + 0] = c0;
        data[off + 1] = c1;
        data[off + 2] = c2;
    }

    //
    // 160x192 pixels alternate 3 and 4 base pixels wide
    //

    private _draw3Pixel(data: Uint8ClampedArray, off: number, color: Color) {
        const c0 = color[0],
            c1 = color[1],
            c2 = color[2];

        data[off + 0] = data[off + 4] = data[off + 8] = c0;
        data[off + 1] = data[off + 5] = data[off + 9] = c1;
        data[off + 2] = data[off + 6] = data[off + 10] = c2;
    }

    private _draw4Pixel(data: Uint8ClampedArray, off: number, color: Color) {
        const c0 = color[0],
            c1 = color[1],
            c2 = color[2];

        data[off + 0] = data[off + 4] = data[off + 8] = data[off + 12] = c0;
        data[off + 1] = data[off + 5] = data[off + 9] = data[off + 13] = c1;
        data[off + 2] = data[off + 6] = data[off + 10] = data[off + 14] = c2;
    }

    bank0(): MemoryPages {
        return {
            start: () => this._start(),
            end: () => this._end(),
            read: (page, off) => this._read(page, off, 0),
            write: (page, off, val) => this._write(page, off, val, 0),
        };
    }

    bank1(): MemoryPages {
        return {
            start: () => this._start(),
            end: () => this._end(),
            read: (page, off) => this._read(page, off, 1),
            write: (page, off, val) => this._write(page, off, val, 1),
        };
    }

    private _start() {
        return 0x20 * this.page;
    }

    private _end() {
        return 0x020 * this.page + 0x1f;
    }

    private _read(page: byte, off: byte, bank: bank) {
        const addr = (page << 8) | off,
            base = addr & 0x1fff;
        return this._buffer[bank][base];
    }

    private _write(page: byte, off: byte, val: byte, bank: bank) {
        const addr = (page << 8) | off;
        const base = addr & 0x1fff;

        if (this._buffer[bank][base] === val && !this._refreshing) {
            return;
        }
        this._buffer[bank][base] = val;

        const col = (base % 0x80) % 0x28;
        const adj = off - col;

        // 000001cd eabab000 -> 000abcde
        const ab = adj & 0x18;
        const cd = (page & 0x03) << 1;
        const e = adj >> 7;

        const rowa = ab | cd | e,
            rowb = base >> 10;

        const data = this.imageData.data;
        let dx, dy;
        if (rowa < 24 && col < 40 && (this.vm.hiresMode || this._refreshing)) {
            let y = (rowa << 4) | (rowb << 1);
            if (y < this.dirty.top) {
                this.dirty.top = y;
            }
            y += 1;
            if (y > this.dirty.bottom) {
                this.dirty.bottom = y;
            }
            let x = col * 14 - 2;
            if (x < this.dirty.left) {
                this.dirty.left = x;
            }
            x += 18;
            if (x > this.dirty.right) {
                this.dirty.right = x;
            }

            dy = (rowa << 4) | (rowb << 1);
            let bz, b0, b1, b2, b3, b4, c;
            if (this.oneSixtyMode && !this.vm.monoMode) {
                // 1 byte = two pixels, but 3:4 ratio
                const c3 = val & 0xf;
                const c4 = val >> 4;

                dx = col * 2 + (bank ^ 1);
                const offset = dx * 28 + dy * 280 * 4;

                this._draw3Pixel(data, offset, dcolors[c3]);
                this._draw4Pixel(data, offset + 12, dcolors[c4]);
            } else if (this.vm.doubleHiresMode) {
                val &= 0x7f;

                // Every 4 bytes is 7 pixels
                // 2 bytes per bank

                // b0       b1       b2       b3
                //  c0  c1    c2  c3    c4  c5    c6
                // 76543210 76543210 76543210 76543210
                //  1111222  2333344  4455556  6667777

                const mod = col % 2,
                    mcol = col - mod,
                    baseOff = base - mod;
                bz = this._buffer[0][baseOff - 1];
                b0 = this._buffer[1][baseOff];
                b1 = this._buffer[0][baseOff];
                b2 = this._buffer[1][baseOff + 1];
                b3 = this._buffer[0][baseOff + 1];
                b4 = this._buffer[1][baseOff + 2];
                c = [
                    0,
                    (b0 & 0x0f) >> 0, // 0
                    ((b0 & 0x70) >> 4) | ((b1 & 0x01) << 3), // 1
                    (b1 & 0x1e) >> 1, // 2
                    ((b1 & 0x60) >> 5) | ((b2 & 0x03) << 2), // 3
                    (b2 & 0x3c) >> 2, // 4
                    ((b2 & 0x40) >> 6) | ((b3 & 0x07) << 1), // 5
                    (b3 & 0x78) >> 3, // 6
                    0,
                ]; // 7
                const hb = [
                    0,
                    b0 & 0x80, // 0
                    b0 & 0x80, // 1
                    b1 & 0x80, // 2
                    b2 & 0x80, // 3
                    b2 & 0x80, // 4
                    b3 & 0x80, // 5
                    b3 & 0x80, // 6
                    0,
                ]; // 7
                if (col > 0) {
                    c[0] = (bz & 0x78) >> 3;
                    hb[0] = bz & 0x80;
                }
                if (col < 39) {
                    c[8] = b4 & 0x0f;
                    hb[8] = b4 & 0x80;
                }
                dx = mcol * 14;
                let offset = dx * 4 + dy * 280 * 4;

                let monoColor = null;
                if (this.vm.monoMode || this.monoDHRMode) {
                    monoColor = whiteCol;
                }

                for (let idx = 1; idx < 8; idx++) {
                    const hbs = hb[idx];
                    const dcolor = dcolors[r4[c[idx]]];
                    let bits = c[idx - 1] | (c[idx] << 4) | (c[idx + 1] << 8);
                    for (let jdx = 0; jdx < 4; jdx++, offset += 4) {
                        if (monoColor) {
                            if (bits & 0x10) {
                                this._drawHalfPixel(data, offset, monoColor);
                            } else {
                                this._drawHalfPixel(data, offset, blackCol);
                            }
                        } else if (this.mixedDHRMode) {
                            if (hbs) {
                                this._drawHalfPixel(data, offset, dcolor);
                            } else {
                                if (bits & 0x10) {
                                    this._drawHalfPixel(data, offset, whiteCol);
                                } else {
                                    this._drawHalfPixel(data, offset, blackCol);
                                }
                            }
                        } else if (this.colorDHRMode) {
                            const clr = this.vm.composited ? colorMap[r4[c[idx]]][jdx] : 1;

                            // pseudo composite half-pixels imitation
                            let pixelColor;
                            if (clr * 10 % 2) pixelColor = dim(dcolor, clr);
                            else if (clr < 1) pixelColor = dim(mix(dcolor, [clr*160, clr*160, clr*160], 1 - clr), clr);
                            else pixelColor = dcolor;

                            this._drawHalfPixel(data, offset, pixelColor as Color);
                        } else if (
                            c[idx] !== c[idx - 1] &&
                            c[idx] !== c[idx + 1] &&
                            ((bits & 0x1c) === 0x1c ||
                                (bits & 0x70) === 0x70 ||
                                (bits & 0x38) === 0x38)
                        ) {
                            this._drawHalfPixel(data, offset, whiteCol);
                        } else if (
                            bits & 0x38 ||
                            c[idx] === c[idx + 1] ||
                            c[idx] === c[idx - 1]
                        ) {
                            this._drawHalfPixel(data, offset, dcolor);
                        } else if (bits & 0x28) {
                            this._drawHalfPixel(data, offset, dim(dcolor));
                        } else {
                            this._drawHalfPixel(data, offset, blackCol);
                        }
                        bits >>= 1;
                    }
                }

                if (!this._refreshing) {
                    this._refreshing = true;
                    const bb: bank = bank ? 0 : 1;
                    for (let rr = addr - 1; rr <= addr + 1; rr++) {
                        const vv = this._read(rr >> 8, rr & 0xff, bb);
                        this._write(rr >> 8, rr & 0xff, vv, bb);
                    }
                    this._refreshing = false;
                }
            } else {
                val = this._buffer[0][base];
                const hbs = val & 0x80;
                val &= 0x7f;
                dx = col * 14 - 2;
                b0 = col > 0 ? this._buffer[0][base - 1] : 0;
                b2 = col < 39 ? this._buffer[0][base + 1] : 0;
                val |= (b2 & 0x3) << 7;
                let v0 = b0 & 0x20,
                    v1 = b0 & 0x40,
                    v2 = val & 0x1,
                    odd = !(col & 0x1),
                    color;
                const oddCol = hbs ? orangeCol : greenCol;
                const evenCol = hbs ? blueCol : violetCol;

                let offset = dx * 4 + dy * 280 * 4;

                const monoColor = this.vm.monoMode ? whiteCol : null;

                for (let idx = 0; idx < 9; idx++, offset += 8) {
                    val >>= 1;

                    if (v1) {
                        if (monoColor) {
                            color = monoColor;
                        } else if (this.highColorHGRMode) {
                            color = dcolors[this._buffer[1][base] >> 4];
                        } else if (v0 || v2) {
                            color = whiteCol;
                        } else {
                            color = odd ? oddCol : evenCol;
                        }
                    } else {
                        if (monoColor) {
                            color = blackCol;
                        } else if (this.highColorHGRMode) {
                            color = dcolors[this._buffer[1][base] & 0x0f];
                        } else if (odd && v2 && v0) {
                            color = v0 ? dim(evenCol) : evenCol;
                        } else if (!odd && v0 && v2) {
                            color = v2 ? dim(oddCol) : oddCol;
                        } else {
                            color = blackCol;
                        }
                    }

                    if (dx > -1 && dx < 560) {
                        this._drawPixel(data, offset, color);
                    }
                    dx += 2;

                    v0 = v1;
                    v1 = v2;
                    v2 = val & 0x01;
                    odd = !odd;
                }
            }
        }
    }

    refresh() {
        this.highColorHGRMode =
            !this.vm.an3State && this.vm.hiresMode && !this.vm._80colMode;
        this.oneSixtyMode = this.vm.flag === 1 && this.vm.doubleHiresMode;
        this.mixedDHRMode = this.vm.flag === 2 && this.vm.doubleHiresMode;
        this.monoDHRMode = this.vm.flag === 3 && this.vm.doubleHiresMode;

        let addr = 0x2000 * this.page;
        this._refreshing = true;
        for (let idx = 0; idx < 0x2000; idx++, addr++) {
            const page = addr >> 8;
            const off = addr & 0xff;
            this._write(page, off, this._buffer[0][idx], 0);
            if (this.vm._80colMode) {
                this._write(page, off, this._buffer[1][idx], 1);
            }
        }
        this._refreshing = false;
    }

    start() {
        return this._start();
    }

    end() {
        return this._end();
    }

    read(page: byte, off: byte) {
        return this._read(page, off, 0);
    }

    write(page: byte, off: byte, val: byte) {
        return this._write(page, off, val, 0);
    }
}

export class VideoModes2D implements VideoModes {
    private _grs: LoresPage[] = [];
    private _hgrs: HiresPage[] = [];
    private _screenContext: CanvasRenderingContext2D;
    private _canvas: HTMLCanvasElement;
    private _left: number;
    private _top: number;
    private _refreshFlag: boolean = true;

    public ready = Promise.resolve();

    textMode: boolean;
    mixedMode: boolean;
    hiresMode: boolean;
    pageMode: pageNo;
    _80colMode: boolean;
    altCharMode: boolean;
    an3State: boolean;
    doubleHiresMode: boolean;

    flag = 0;
    monoMode = false;

    colorPalette = 0;

    context: CanvasRenderingContext2D;
    public smoothed: boolean;
    public composited: boolean;

    constructor(
        private screen: HTMLCanvasElement,
        private e: boolean
    ) {
        this._canvas = document.createElement('canvas');
        const { width, height } = { width: 560, height: 384 };
        this._canvas.width = width;
        this._canvas.height = height;

        const context = this._canvas.getContext('2d');
        const screenContext = this.screen.getContext('2d');
        if (!context || !screenContext) {
            throw new Error('No 2d context');
        }
        this.context = context;

        this._screenContext = screenContext;
        this._screenContext.imageSmoothingEnabled = false;
        this._left = (this.screen.width - 560) / 2;
        this._top = (this.screen.height - 384) / 2;
    }

    _refresh() {
        this.doubleHiresMode =
            !this.an3State && this.hiresMode && this._80colMode;

        this._refreshFlag = true;
    }

    refresh() {
        this._refresh();
    }

    reset() {
        this.textMode = true;
        this.mixedMode = false;
        this.hiresMode = true;
        this.pageMode = 1;

        this._80colMode = false;
        this.altCharMode = false;

        this.flag = 0;
        this.an3State = true;

        this._refresh();
    }

    setLoresPage(page: pageNo, lores: LoresPage) {
        this._grs[page - 1] = lores;
    }

    setHiresPage(page: pageNo, hires: HiresPage) {
        this._hgrs[page - 1] = hires;
    }

    getLoresPage(page: pageNo) {
        return this._grs[page - 1];
    }

    getHiresPage(page: pageNo) {
        return this._hgrs[page - 1];
    }

    text(on: boolean) {
        const old = this.textMode;
        this.textMode = on;
        if (on) {
            this.flag = 0;
        }
        if (old !== on) {
            this._refresh();
        }
    }

    _80col(on: boolean) {
        if (!this.e) {
            return;
        }

        const old = this._80colMode;
        this._80colMode = on;

        if (old !== on) {
            this._refresh();
        }
    }

    altChar(on: boolean) {
        if (!this.e) {
            return;
        }

        const old = this.altCharMode;
        this.altCharMode = on;
        if (old !== on) {
            this._refresh();
        }
    }

    hires(on: boolean) {
        const old = this.hiresMode;
        this.hiresMode = on;
        if (!on) {
            this.flag = 0;
        }

        if (old !== on) {
            this._refresh();
        }
    }

    an3(on: boolean) {
        if (!this.e) {
            return;
        }

        const old = this.an3State;
        this.an3State = on;

        if (on) {
            this.flag =
                ((this.flag << 1) | (this._80colMode ? 0x0 : 0x1)) & 0x3;
        }

        if (old !== on) {
            this._refresh();
        }
    }

    doubleHires(on: boolean) {
        this.an3(!on);
    }

    mixed(on: boolean) {
        const old = this.mixedMode;
        this.mixedMode = on;
        if (old !== on) {
            this._refresh();
        }
    }

    page(pageNo: pageNo) {
        const old = this.pageMode;
        this.pageMode = pageNo;
        if (old !== pageNo) {
            this._refresh();
        }
    }

    isText() {
        return this.textMode;
    }

    isMixed() {
        return this.mixedMode;
    }

    isPage2() {
        return this.pageMode === 2;
    }

    isHires() {
        return this.hiresMode;
    }

    isDoubleHires() {
        return this.doubleHiresMode;
    }

    is80Col() {
        return this._80colMode;
    }

    isAltChar() {
        return this.altCharMode;
    }

    buildScreen(mainData: ImageData, mixData?: ImageData | null) {
        // TODO(whscullin): - figure out 80 column offset
        const { x, y } = this._80colMode ? { x: 0, y: 0 } : { x: 0, y: 0 };

        if (mixData) {
            this.context.putImageData(mainData, x, y, 0, 0, 560, 160);
            this.context.putImageData(mixData, x, y, 0, 160, 560, 32);
        } else {
            this.context.putImageData(mainData, x, y);
        }
        return this._canvas;
    }

    updateImage(
        mainData: ImageData,
        mainDirty: Region,
        mixData?: ImageData | null,
        mixDirty?: Region | null
    ) {
        let blitted = false;

        if (mainDirty.bottom !== -1 || (mixDirty && mixDirty.bottom !== -1)) {
            const imageData = this.buildScreen(mainData, mixData);
            this._screenContext.drawImage(
                imageData,
                0,
                0,
                560,
                192,
                this._left,
                this._top,
                560,
                384
            );
            blitted = true;
        }
        return blitted;
    }

    blit(altData?: ImageData) {
        let blitted = false;
        const hgr = this._hgrs[this.pageMode - 1];
        const gr = this._grs[this.pageMode - 1];

        if (this._refreshFlag) {
            hgr.refresh();
            gr.refresh();
            this._refreshFlag = false;
        }

        if (altData) {
            blitted = this.updateImage(altData, {
                top: 0,
                left: 0,
                right: 560,
                bottom: 192,
            });
        } else if (this.hiresMode && !this.textMode) {
            blitted = this.updateImage(
                hgr.imageData,
                hgr.dirty,
                this.mixedMode ? gr.imageData : null,
                this.mixedMode ? gr.dirty : null
            );
        } else {
            blitted = this.updateImage(gr.imageData, gr.dirty);
        }
        hgr.dirty = { ...notDirty };
        gr.dirty = { ...notDirty };

        return blitted;
    }

    getState(): VideoModesState {
        return {
            textMode: this.textMode,
            mixedMode: this.mixedMode,
            hiresMode: this.hiresMode,
            pageMode: this.pageMode,
            _80colMode: this._80colMode,
            altCharMode: this.altCharMode,
            an3State: this.an3State,
            flag: this.flag,
        };
    }

    setState(state: VideoModesState) {
        this.textMode = state.textMode;
        this.mixedMode = state.mixedMode;
        this.hiresMode = state.hiresMode;
        this.pageMode = state.pageMode;
        this._80colMode = state._80colMode;
        this.altCharMode = state.altCharMode;
        this.an3State = state.an3State;
        this.flag = state.flag;

        this._refresh();
    }

    mono(on: boolean) {
        if (on) {
            this.screen.classList.add('mono');
        } else {
            this.screen.classList.remove('mono');
        }
        this.monoMode = on;
        this._refresh();
    }

    scanlines(on: boolean) {
        // Can't apply scanline filter to canvas
        const parent = this.screen.parentElement;
        if (parent) {
            if (on) {
                parent.classList.add('scanlines');
            } else {
                parent.classList.remove('scanlines');
            }
        }
    }

    opacity(value: number) {
        const parent = this.screen.parentElement;
        if (parent) {
            parent.style.setProperty('--after-opacity', String(value));
        }
    }

    composite(value: boolean) {
        this.composited = value;
        //if (value) console.log("Composite idealized not implemented yet!", value);
        this.refresh();
    }

    smoothing(value: boolean) {
        this.smoothed = value;
        if (this.screen.parentElement) {
            //console.log(on ? "2d crisp-edges" : "2d pixelated");
            this.screen.parentElement.style.imageRendering = value ? "auto" : "pixelated";
            this.screen.style.imageRendering = value ? "auto" : "pixelated";
            this.screen.parentElement.style.setProperty('--image-rendering', value ? "auto" : "pixelated");
        }
        window.dispatchEvent(new Event('resize'));
    }

    palette(value: number) {
        const parent = this.screen.parentElement;
        if (parent) {
            this.colorPalette = value;
            setColors(this.colorPalette);
            this.refresh();
        }
    }

    getText() {
        return this._grs[this.pageMode - 1].getText();
    }

    async getCanvasAsBlob() {
        return new Promise<Blob>((resolve, reject) => {
            this.screen.toBlob((blob) => {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(new Error('Could not read canvas'));
                }
            });
        });
    }
}
