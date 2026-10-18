import { debug } from '../util';
import { Card, Restorable, byte } from '../types';

/**
 * Uthernet II is a WIZnet W5100 on the slot I/O bus ($C0n4-$C0n7).
 * This is the virtual-W5100 subset AppleWin uses for DNS offload:
 * https://github.com/a2retrosystems/uthernet2/wiki/Virtual-W5100-with-DNS
 *
 * IP65's driver (drivers/w5100.s) must pass its probe, then GridLock's
 * WGET opens a TCP socket by hostname and writes a plain HTTP request.
 * The browser cannot open that TCP socket, so a finished request is
 * satisfied with fetch() and the response is handed back as HTTP bytes.
 */

const MEM_SIZE = 0x8000;

const REG = {
    MR: 0x0000,
    RTR: 0x0017,
    RCR: 0x0019,
    RMSR: 0x001a,
    TMSR: 0x001b,
    PTIMER: 0x0028,
} as const;

const SOCK = {
    MR: 0x00,
    CR: 0x01,
    SR: 0x03,
    DIPR: 0x0c,
    DPORT: 0x10,
    TX_FSR: 0x20,
    TX_RD: 0x22,
    TX_WR: 0x24,
    RX_RSR: 0x26,
    RX_RD: 0x28,
    DNS: 0x2a,
} as const;

const CMD = {
    OPEN: 0x01,
    LISTEN: 0x02,
    CONNECT: 0x04,
    DISCON: 0x08,
    CLOSE: 0x10,
    SEND: 0x20,
    RECV: 0x40,
} as const;

const SR = {
    CLOSED: 0x00,
    INIT: 0x13,
    LISTEN: 0x14,
    ESTABLISHED: 0x17,
    CLOSE_WAIT: 0x1c,
    MACRAW: 0x42,
} as const;

const MR = {
    INDIRECT: 0x01,
    AUTO_INC: 0x02,
    DNS: 0x08,
    RESET: 0x80,
} as const;

const PROTO = {
    TCP: 0x01,
    MACRAW: 0x04,
} as const;

const IO = {
    MODE: 0x04,
    ADDR_HI: 0x05,
    ADDR_LO: 0x06,
    DATA: 0x07,
} as const;

/** 1KB, 2KB, 4KB, 8KB. Sum of the four sockets is 8KB on a real chip. */
const BLOCK = [0x400, 0x800, 0x1000, 0x2000];

interface SocketState {
    host: string;
    rxWr: number;
    request: number[];
    pending: Uint8Array | null;
    pendingOff: number;
    fetchDone: boolean;
    started: boolean;
    gen: number;
}

export interface Uthernet2State {
    mem: Uint8Array;
    mode: number;
    ptr: number;
    rxWr: number[];
}

function blankSocket(): SocketState {
    return {
        host: '',
        rxWr: 0,
        request: [],
        pending: null,
        pendingOff: 0,
        fetchDone: false,
        started: false,
        gen: 0,
    };
}

function headerComplete(bytes: number[]): boolean {
    for (let i = 0; i <= bytes.length - 4; i++) {
        if (
            bytes[i] === 0x0d &&
            bytes[i + 1] === 0x0a &&
            bytes[i + 2] === 0x0d &&
            bytes[i + 3] === 0x0a
        ) {
            return true;
        }
    }
    return false;
}

function bytesToString(bytes: number[]): string {
    let text = '';
    for (let i = 0; i < bytes.length; i++) {
        text += String.fromCharCode(bytes[i]);
    }
    return text;
}

/**
 * Turn the HTTP request WGET wrote into a URL fetch() can load.
 * The hostname comes from DNS offload when the request has no Host header.
 */
export function requestUrl(raw: string, dnsHost: string, port: number): string | null {
    const end = raw.indexOf('\r\n\r\n');
    const head = end >= 0 ? raw.slice(0, end) : raw;
    const lines = head.split('\r\n');
    const request = /^(?:GET|POST|HEAD)\s+(\S+)\s+HTTP\//i.exec(lines[0] || '');
    let path = request ? request[1] : '';
    let host = dnsHost;
    for (let i = 1; i < lines.length; i++) {
        const found = /^host:\s*(.+)$/i.exec(lines[i]);
        if (found) {
            host = found[1].trim();
        }
    }
    if (!path) {
        const first = raw.split('\r')[0].trim();
        if (first.startsWith('/')) {
            path = first;
        }
    }
    if (!path || !host) {
        return null;
    }
    if (/^https?:\/\//i.test(path)) {
        return path;
    }
    if (!path.startsWith('/')) {
        path = `/${path}`;
    }
    if (port && port !== 80 && host.indexOf(':') < 0) {
        host = `${host}:${port}`;
    }
    return `http://${host}${path}`;
}

/**
 * The stage host does not send Access-Control-Allow-Origin. A page served
 * from that host can fetch it directly. From localhost, Apache fetches it.
 */
export function fetchTarget(url: string): string {
    if (typeof location === 'undefined') {
        return url;
    }
    const host = location.hostname;
    if (host !== 'localhost' && host !== '127.0.0.1') {
        return url;
    }
    return `gridlock-fetch.php?url=${encodeURIComponent(url)}`;
}

export default class Uthernet2 implements Card, Restorable<Uthernet2State> {
    private mem = new Uint8Array(MEM_SIZE);
    private mode = 0;
    private ptr = 0;
    private sockets: SocketState[] = [0, 1, 2, 3].map(() => blankSocket());

    constructor() {
        this.reset();
        debug('Uthernet II');
    }

    reset() {
        for (let i = 0; i < 4; i++) {
            this.sockets[i].gen++;
        }
        this.mem.fill(0);
        this.mode = 0;
        this.ptr = 0;
        this.sockets = [0, 1, 2, 3].map(() => blankSocket());
        // Defaults a real W5100 has after reset. PTIMER is 0x28 on
        // silicon; 0x00 tells WGET this is a virtual chip with DNS offload.
        this.mem[REG.RTR] = 0x07;
        this.mem[REG.RTR + 1] = 0xd0;
        this.mem[REG.RCR] = 0x08;
        this.mem[REG.RMSR] = 0x55;
        this.mem[REG.TMSR] = 0x55;
        this.mem[REG.PTIMER] = 0x00;
    }

    private sockBase(sock: number): number {
        return 0x0400 + sock * 0x100;
    }

    private word(addr: number): number {
        return (this.mem[addr] << 8) | this.mem[(addr + 1) & 0x7fff];
    }

    private setWord(addr: number, value: number) {
        this.mem[addr] = (value >> 8) & 0xff;
        this.mem[(addr + 1) & 0x7fff] = value & 0xff;
    }

    /** TX or RX window for one socket, from TMSR ($001B) or RMSR ($001A). */
    private window(tx: boolean, sock: number): { base: number; size: number } {
        const sizes = this.mem[tx ? REG.TMSR : REG.RMSR];
        let offset = 0;
        for (let i = 0; i < sock; i++) {
            offset += BLOCK[(sizes >> (i * 2)) & 0x03];
        }
        const size = BLOCK[(sizes >> (sock * 2)) & 0x03];
        return { base: (tx ? 0x4000 : 0x6000) + offset, size };
    }

    private txFree(sock: number): number {
        const { size } = this.window(true, sock);
        const base = this.sockBase(sock);
        let used = (this.word(base + SOCK.TX_WR) - this.word(base + SOCK.TX_RD)) & 0xffff;
        if (used > size) {
            used = size;
        }
        return size - used;
    }

    private rxUsed(sock: number): number {
        const { size } = this.window(false, sock);
        const rd = this.word(this.sockBase(sock) + SOCK.RX_RD);
        let used = (this.sockets[sock].rxWr - rd) & 0xffff;
        if (used > size) {
            used = size;
        }
        return used;
    }

    private overlay(addr: number): number | undefined {
        if (addr < 0x0400 || addr >= 0x0800) {
            return undefined;
        }
        const sock = (addr >> 8) & 0x03;
        const off = addr & 0xff;
        if (off === SOCK.TX_FSR || off === SOCK.TX_FSR + 1) {
            const free = this.txFree(sock);
            return off === SOCK.TX_FSR ? (free >> 8) & 0xff : free & 0xff;
        }
        if (off === SOCK.RX_RSR || off === SOCK.RX_RSR + 1) {
            const used = this.rxUsed(sock);
            return off === SOCK.RX_RSR ? (used >> 8) & 0xff : used & 0xff;
        }
        return undefined;
    }

    private writeMode(value: number) {
        if (value & MR.RESET) {
            this.reset();
            this.mode = value & 0x7f;
        } else {
            this.mode = value & 0xff;
        }
        this.mem[REG.MR] = this.mode;
    }

    private pullTx(sock: number): number[] {
        const { base, size } = this.window(true, sock);
        const mask = size - 1;
        const regs = this.sockBase(sock);
        let ptr = this.word(regs + SOCK.TX_RD);
        const end = this.word(regs + SOCK.TX_WR);
        const out: number[] = [];
        let guard = 0;
        while (ptr !== end && guard < size) {
            out.push(this.mem[base + (ptr & mask)]);
            ptr = (ptr + 1) & 0xffff;
            guard++;
        }
        this.setWord(regs + SOCK.TX_RD, end);
        return out;
    }

    private pump(sock: number) {
        const state = this.sockets[sock];
        if (!state.pending) {
            this.noteDrained(sock);
            return;
        }
        const { base, size } = this.window(false, sock);
        if (size < 1) {
            return;
        }
        const mask = size - 1;
        let free = size - this.rxUsed(sock);
        while (free > 0 && state.pendingOff < state.pending.length) {
            this.mem[base + (state.rxWr & mask)] = state.pending[state.pendingOff++];
            state.rxWr = (state.rxWr + 1) & 0xffff;
            free--;
        }
        this.noteDrained(sock);
    }

    private noteDrained(sock: number) {
        const state = this.sockets[sock];
        const regs = this.sockBase(sock);
        if (this.mem[regs + SOCK.SR] !== SR.ESTABLISHED || !state.fetchDone) {
            return;
        }
        if (state.pending && state.pendingOff < state.pending.length) {
            return;
        }
        if (this.rxUsed(sock) === 0) {
            this.mem[regs + SOCK.SR] = SR.CLOSE_WAIT;
        }
    }

    private fail(sock: number) {
        this.sockets[sock].fetchDone = true;
        this.sockets[sock].pending = null;
        this.mem[this.sockBase(sock) + SOCK.SR] = SR.CLOSED;
    }

    private async fetchRequest(sock: number) {
        const state = this.sockets[sock];
        const gen = ++state.gen;
        const regs = this.sockBase(sock);
        const url = requestUrl(
            bytesToString(state.request),
            state.host,
            this.word(regs + SOCK.DPORT)
        );
        if (!url) {
            debug('Uthernet II: HTTP request had no host');
            this.fail(sock);
            return;
        }
        const target = fetchTarget(url);
        debug('Uthernet II fetch', target);
        try {
            const response = await fetch(target);
            const body = new Uint8Array(await response.arrayBuffer());
            if (gen !== this.sockets[sock].gen) {
                return;
            }
            const reason = response.status === 200 ? 'OK' : 'ERR';
            const header = `HTTP/1.0 ${response.status} ${reason}\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`;
            const head = new TextEncoder().encode(header);
            const all = new Uint8Array(head.length + body.length);
            all.set(head, 0);
            all.set(body, head.length);
            this.sockets[sock].pending = all;
            this.sockets[sock].pendingOff = 0;
            this.sockets[sock].fetchDone = true;
            this.pump(sock);
        } catch (err) {
            if (gen !== this.sockets[sock].gen) {
                return;
            }
            debug('Uthernet II fetch failed', err);
            this.fail(sock);
        }
    }

    private openSocket(sock: number) {
        const regs = this.sockBase(sock);
        const mode = this.mem[regs + SOCK.MR];
        const proto = mode & 0x07;
        const state = this.sockets[sock];
        state.gen++;
        state.rxWr = 0;
        state.request = [];
        state.pending = null;
        state.pendingOff = 0;
        state.fetchDone = false;
        state.started = false;
        this.setWord(regs + SOCK.TX_RD, 0);
        this.setWord(regs + SOCK.TX_WR, 0);
        this.setWord(regs + SOCK.RX_RD, 0);

        if (proto === PROTO.TCP && mode & MR.DNS) {
            const len = this.mem[regs + SOCK.DNS];
            let host = '';
            for (let i = 0; i < len; i++) {
                host += String.fromCharCode(this.mem[regs + SOCK.DNS + 1 + i]);
            }
            state.host = host;
            if (host) {
                this.mem[regs + SOCK.DIPR] = 10;
                this.mem[regs + SOCK.DIPR + 1] = 0;
                this.mem[regs + SOCK.DIPR + 2] = 0;
                this.mem[regs + SOCK.DIPR + 3] = 1;
            }
            this.mem[regs + SOCK.SR] = SR.INIT;
            return;
        }
        if (proto === PROTO.TCP) {
            state.host = '';
            this.mem[regs + SOCK.SR] = SR.INIT;
            return;
        }
        if (proto === PROTO.MACRAW) {
            this.mem[regs + SOCK.SR] = SR.MACRAW;
            return;
        }
        this.mem[regs + SOCK.SR] = SR.INIT;
    }

    private command(sock: number, cmd: number) {
        const regs = this.sockBase(sock);
        const mode = this.mem[regs + SOCK.MR];
        const proto = mode & 0x07;
        switch (cmd) {
            case CMD.OPEN:
                this.openSocket(sock);
                break;
            case CMD.LISTEN:
                this.mem[regs + SOCK.SR] = SR.LISTEN;
                break;
            case CMD.CONNECT:
                if (proto === PROTO.TCP && this.sockets[sock].host) {
                    this.sockets[sock].request = [];
                    this.sockets[sock].started = false;
                    this.sockets[sock].fetchDone = false;
                    this.sockets[sock].pending = null;
                    this.mem[regs + SOCK.SR] = SR.ESTABLISHED;
                } else {
                    this.mem[regs + SOCK.SR] = SR.CLOSED;
                }
                break;
            case CMD.DISCON:
            case CMD.CLOSE:
                this.sockets[sock].gen++;
                this.sockets[sock].pending = null;
                this.sockets[sock].fetchDone = true;
                this.mem[regs + SOCK.SR] = SR.CLOSED;
                break;
            case CMD.SEND: {
                const chunk = this.pullTx(sock);
                if (proto === PROTO.TCP && this.mem[regs + SOCK.SR] === SR.ESTABLISHED) {
                    const state = this.sockets[sock];
                    for (let i = 0; i < chunk.length; i++) {
                        state.request.push(chunk[i]);
                    }
                    if (!state.started && headerComplete(state.request)) {
                        state.started = true;
                        void this.fetchRequest(sock);
                    }
                }
                break;
            }
            case CMD.RECV:
                this.pump(sock);
                break;
            default:
                break;
        }
    }

    private readData(): number {
        const addr = this.ptr;
        const over = this.overlay(addr);
        const value = over === undefined ? this.mem[addr] : over;
        if (this.mode & MR.AUTO_INC) {
            this.ptr = (addr + 1) & 0x7fff;
        }
        return value;
    }

    private writeData(value: number) {
        const addr = this.ptr;
        this.mem[addr] = value & 0xff;
        if (addr === REG.MR) {
            this.writeMode(value);
        } else if (addr >= 0x0400 && addr < 0x0800 && (addr & 0xff) === SOCK.CR) {
            this.command((addr >> 8) & 0x03, value & 0xff);
            this.mem[addr] = 0;
        }
        if (this.mode & MR.AUTO_INC) {
            this.ptr = (addr + 1) & 0x7fff;
        }
    }

    ioSwitch(off: byte, val?: byte): byte | undefined {
        switch (off & 0x0f) {
            case IO.MODE:
                if (val !== undefined) {
                    this.writeMode(val);
                }
                return this.mode;
            case IO.ADDR_HI:
                if (val !== undefined) {
                    this.ptr = ((val & 0xff) << 8) | (this.ptr & 0x00ff);
                }
                return (this.ptr >> 8) & 0xff;
            case IO.ADDR_LO:
                if (val !== undefined) {
                    this.ptr = (this.ptr & 0xff00) | (val & 0xff);
                }
                return this.ptr & 0xff;
            case IO.DATA:
                if (val !== undefined) {
                    this.writeData(val);
                    return val;
                }
                return this.readData();
            default:
                return 0;
        }
    }

    read(): byte {
        return 0;
    }

    write() {
        // No card ROM.
    }

    tick() {
        for (let sock = 0; sock < 4; sock++) {
            this.pump(sock);
        }
    }

    getState(): Uthernet2State {
        return {
            mem: new Uint8Array(this.mem),
            mode: this.mode,
            ptr: this.ptr,
            rxWr: this.sockets.map((s) => s.rxWr),
        };
    }

    setState(state: Uthernet2State) {
        this.reset();
        this.mem.set(state.mem.subarray(0, MEM_SIZE));
        this.mode = state.mode & 0xff;
        this.ptr = state.ptr & 0x7fff;
        for (let i = 0; i < 4; i++) {
            this.sockets[i].rxWr = state.rxWr[i] & 0xffff;
            // The bytes already in the RX window are restored. An in-flight
            // fetch is not, so a still-open socket ends once those bytes drain.
            this.sockets[i].fetchDone = true;
        }
    }
}
