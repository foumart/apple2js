import { debug } from '../util';
import { Card, Restorable, byte } from '../types';
import MacRawHost, { httpBytes } from './uthernet_macraw';
import { getUthernetPrefs } from './uthernet_settings';

/**
 * Uthernet II is a WIZnet W5100 on the slot I/O bus ($C0n4-$C0n7).
 *
 * Two stacks are used in the field. WGET opens a hardware TCP socket and,
 * on AppleWin's virtual chip, offloads DNS. Contiki opens socket 0 in
 * MACRAW mode and sends its own DHCP, DNS and TCP frames. The browser
 * cannot open either kind of socket, so a finished HTTP request is loaded
 * by uthernet-fetch.php and handed back as HTTP bytes.
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
    const scheme = port === 443 ? 'https' : 'http';
    if (port && port !== 80 && port !== 443 && host.indexOf(':') < 0) {
        host = `${host}:${port}`;
    }
    return `${scheme}://${host}${path}`;
}

/**
 * Ask this page's own host to load the URL. A page cannot fetch arbitrary
 * sites itself: an HTTPS emulator page is not allowed to read an HTTP URL,
 * and other origins do not send Access-Control-Allow-Origin.
 */
export function fetchTarget(url: string): string {
    return `uthernet-fetch.php?url=${encodeURIComponent(url)}`;
}

/**
 * Plain HTTP is what the Apple sends. When that host answers only on
 * HTTPS, load the secure URL and still hand the Apple a plain response.
 */
async function loadUrl(url: string): Promise<Response> {
    const mode = getUthernetPrefs().web;
    let target = url;
    if (mode === 'https' && target.startsWith('http://')) {
        target = `https://${target.slice('http://'.length)}`;
    }
    const first = await fetch(fetchTarget(target));
    if (
        mode !== 'https-fallback' ||
        first.ok ||
        !target.startsWith('http://') ||
        first.status !== 502
    ) {
        return first;
    }
    return fetch(fetchTarget(`https://${target.slice('http://'.length)}`));
}

async function loadNetwork(): Promise<import('./uthernet_settings').NetConfig | null> {
    try {
        const response = await fetch('uthernet-net.php');
        if (!response.ok) {
            return null;
        }
        const body = await readJson(response);
        if (!body) {
            return null;
        }
        const ip = parseIp(body.ip);
        const mask = parseIp(body.mask);
        const gateway = parseIp(body.gateway);
        const dns = parseIp(body.dns);
        if (!ip || !mask || !gateway || !dns) {
            return null;
        }
        return { ip, mask, gateway, dns };
    } catch {
        return null;
    }
}

async function readJson(
    response: Response
): Promise<{ ip?: string; mask?: string; gateway?: string; dns?: string } | null> {
    const text = (await response.text()).trim();
    if (!text) {
        return null;
    }
    const body = JSON.parse(text) as {
        ip?: string;
        mask?: string;
        gateway?: string;
        dns?: string;
    } | null;
    if (!body || typeof body !== 'object') {
        return null;
    }
    return body;
}

async function resolveName(name: string): Promise<string | null> {
    try {
        const response = await fetch(
            `uthernet-dns.php?name=${encodeURIComponent(name)}`
        );
        if (!response.ok) {
            return null;
        }
        const text = (await response.text()).trim();
        return parseIp(text) ? text : null;
    } catch {
        return null;
    }
}

function parseIp(text: string | undefined): number[] | null {
    if (!text) {
        return null;
    }
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

export default class Uthernet2 implements Card, Restorable<Uthernet2State> {
    private mem = new Uint8Array(MEM_SIZE);
    private mode = 0;
    private ptr = 0;
    private sockets: SocketState[] = [0, 1, 2, 3].map(() => blankSocket());
    private mac: MacRawHost;

    constructor() {
        this.mac = new MacRawHost({
            load: (url) => loadUrl(url),
            onData: () => this.drainMac(0),
            urlFor: requestUrl,
            network: () => loadNetwork(),
            resolve: (name) => resolveName(name),
        });
        this.reset();
        debug('Uthernet II');
    }

    reset() {
        this.mac.reset();
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
            const response = await loadUrl(url);
            const body = new Uint8Array(await response.arrayBuffer());
            if (gen !== this.sockets[sock].gen) {
                return;
            }
            const type = response.headers?.get('content-type') || '';
            this.sockets[sock].pending = httpBytes(response.status, body, type);
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
                if (proto === PROTO.MACRAW) {
                    if (chunk.length) {
                        this.mac.handle(Uint8Array.from(chunk));
                    }
                    this.drainMac(sock);
                    break;
                }
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

    /** Copy one MACRAW reply into the socket receive buffer. */
    private enqueueMac(sock: number, frame: Uint8Array): boolean {
        const packet = new Uint8Array(frame.length + 2);
        const size = frame.length + 2;
        packet[0] = size >> 8;
        packet[1] = size & 0xff;
        packet.set(frame, 2);
        const { base, size: win } = this.window(false, sock);
        if (win < 1 || packet.length > win - this.rxUsed(sock)) {
            return false;
        }
        const mask = win - 1;
        const state = this.sockets[sock];
        for (let i = 0; i < packet.length; i++) {
            this.mem[base + (state.rxWr & mask)] = packet[i];
            state.rxWr = (state.rxWr + 1) & 0xffff;
        }
        return true;
    }

    private drainMac(sock: number) {
        for (;;) {
            const frame = this.mac.peek();
            if (!frame) {
                return;
            }
            if (!this.enqueueMac(sock, frame)) {
                return;
            }
            this.mac.shift();
        }
    }

    tick() {
        this.mac.poll();
        this.drainMac(0);
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
