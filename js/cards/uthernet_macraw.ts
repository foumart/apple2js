import { debug } from '../util';
import {
    getUthernetPrefs,
    manualNet,
    NetConfig,
    onUthernetPrefs,
} from './uthernet_settings';

/**
 * Answers the Ethernet frames Contiki (and any other MACRAW stack) sends.
 * The browser has no raw socket, so DHCP, ARP, DNS and TCP are terminated
 * here. A finished HTTP request is loaded through the same host relay as
 * the hardware-TCP path.
 */

const GATEWAY_MAC = [0x02, 0x00, 0x00, 0x00, 0x00, 0x01];

const ETH_IP = 0x0800;
const ETH_ARP = 0x0806;

export interface MacRawHooks {
    /** Load a URL the emulated stack asked for. */
    load(url: string): Promise<Response>;
    /** Frames are waiting to be copied into the W5100 receive buffer. */
    onData(): void;
    /** HTTP request bytes plus the name DNS returned for this address. */
    urlFor(raw: string, host: string, port: number): string | null;
    /** LAN address, mask, gateway and DNS of the relay machine. */
    network(): Promise<NetConfig | null>;
    /** Real address for a hostname, or null when the name does not resolve. */
    resolve(name: string): Promise<string | null>;
}

interface DnsWait {
    name: string;
    client: number[];
    clientPort: number;
    server: number[];
    query: Uint8Array;
}

interface Conn {
    srcPort: number;
    dstIp: string;
    dstPort: number;
    host: string;
    expectSeq: number;
    sndUna: number;
    sndNxt: number;
    dataSeq: number;
    window: number;
    mss: number;
    http: number[];
    started: boolean;
    body: Uint8Array | null;
    finSent: boolean;
    stall: number;
    gen: number;
}

export default class MacRawHost {
    private out: Uint8Array[] = [];
    private conns: Conn[] = [];
    private names = new Map<string, string>();
    private dnsCache = new Map<string, string | null>();
    private dnsBusy = new Set<string>();
    private dnsWait: DnsWait | null = null;
    private net: NetConfig | null = null;
    private netStarted = false;
    private dhcpHold: Uint8Array | null = null;
    private ipId = 1;
    private gen = 1;
    private clientMac = [0x00, 0x08, 0xdc, 0xa2, 0xa2, 0xa2];
    private clientIp = [0, 0, 0, 0];

    constructor(private readonly hooks: MacRawHooks) {
        onUthernetPrefs(() => this.applyAddressChoice());
        this.requestNet();
    }

    private applyAddressChoice() {
        const prefs = getUthernetPrefs();
        if (prefs.addressMode !== 'manual') {
            this.net = null;
            this.netStarted = false;
            this.requestNet();
            return;
        }
        const manual = manualNet(prefs);
        if (!manual) {
            return;
        }
        this.net = manual;
        const held = this.dhcpHold;
        this.dhcpHold = null;
        if (held) {
            this.dhcp(held);
            this.flush();
        }
    }

    reset() {
        this.gen++;
        this.out = [];
        this.conns = [];
        this.names.clear();
        this.dnsCache.clear();
        this.dnsBusy.clear();
        this.dnsWait = null;
        this.dhcpHold = null;
    }

    peek(): Uint8Array | undefined {
        return this.out[0];
    }

    shift(): Uint8Array | undefined {
        return this.out.shift();
    }

    /** Move stalled TCP data. Called once per emulated frame. */
    poll() {
        for (let i = 0; i < this.conns.length; i++) {
            const conn = this.conns[i];
            if (!conn.body) {
                continue;
            }
            if (conn.sndUna !== conn.sndNxt) {
                conn.stall++;
                if (conn.stall >= 30 && this.out.length === 0) {
                    conn.stall = 0;
                    conn.sndNxt = conn.sndUna;
                    conn.finSent = false;
                }
            } else {
                conn.stall = 0;
            }
            this.transmit(conn);
        }
        this.flush();
    }

    handle(frame: Uint8Array) {
        if (frame.length < 14) {
            return;
        }
        const srcMac = [0, 1, 2, 3, 4, 5].map((i) => frame[6 + i]);
        if (sameMac(srcMac, GATEWAY_MAC)) {
            return;
        }
        this.clientMac = srcMac;
        const type = (frame[12] << 8) | frame[13];
        if (type === ETH_ARP) {
            this.arp(frame.subarray(14));
        } else if (type === ETH_IP && frame.length >= 34) {
            this.ipv4(frame.subarray(14));
        }
        this.flush();
    }

    private flush() {
        if (this.out.length) {
            this.hooks.onData();
        }
    }

    private queue(frame: Uint8Array) {
        this.out.push(frame);
    }

    private arp(packet: Uint8Array) {
        if (packet.length < 28) {
            return;
        }
        const op = (packet[6] << 8) | packet[7];
        if (op !== 1) {
            return;
        }
        const target = [24, 25, 26, 27].map((i) => packet[i]);
        if (target.every((b) => b === 0)) {
            return;
        }
        const reply = new Uint8Array(28);
        reply[1] = 1;
        reply[2] = 0x08;
        reply[4] = 6;
        reply[5] = 4;
        reply[7] = 2;
        put(reply, 8, GATEWAY_MAC);
        put(reply, 14, target);
        put(reply, 18, this.clientMac);
        put(reply, 24, [packet[14], packet[15], packet[16], packet[17]]);
        this.queue(ether(this.clientMac, GATEWAY_MAC, ETH_ARP, reply));
    }

    private ipv4(packet: Uint8Array) {
        const ihl = (packet[0] & 0x0f) * 4;
        if (ihl < 20 || packet.length < ihl) {
            return;
        }
        const src = [12, 13, 14, 15].map((i) => packet[i]);
        if (src.some((b) => b !== 0)) {
            this.clientIp = src;
        }
        const dst = [16, 17, 18, 19].map((i) => packet[i]);
        const proto = packet[9];
        const body = packet.subarray(ihl);
        if (proto === 1) {
            this.icmp(src, dst, body);
        } else if (proto === 17) {
            this.udp(src, dst, body);
        } else if (proto === 6) {
            this.tcp(src, dst, body);
        }
    }

    private icmp(src: number[], dst: number[], body: Uint8Array) {
        if (body.length < 8 || body[0] !== 8) {
            return;
        }
        const echo = body.slice();
        echo[0] = 0;
        echo[2] = 0;
        echo[3] = 0;
        const sum = finish(sumBytes(echo, 0, echo.length, 0));
        echo[2] = sum >> 8;
        echo[3] = sum & 0xff;
        this.queue(this.ipFrame(dst, src, 1, echo));
    }

    private udp(src: number[], dst: number[], body: Uint8Array) {
        if (body.length < 8) {
            return;
        }
        const srcPort = (body[0] << 8) | body[1];
        const dstPort = (body[2] << 8) | body[3];
        const payload = body.subarray(8);
        if (dstPort === 67) {
            this.dhcp(payload);
            return;
        }
        if (dstPort === 53) {
            this.dns(src, srcPort, dst, payload);
        }
    }

    private dhcp(payload: Uint8Array) {
        if (payload.length < 48 || payload[0] !== 1) {
            return;
        }
        const net = this.net;
        if (!net) {
            this.dhcpHold = payload.slice();
            this.requestNet();
            return;
        }
        const cookie = dhcpCookie(payload);
        if (cookie < 0) {
            return;
        }
        let kind = 1;
        for (let i = cookie + 4; i < payload.length && payload[i] !== 255; ) {
            const code = payload[i++];
            if (code === 0) {
                continue;
            }
            const len = payload[i++];
            if (code === 53 && len >= 1) {
                kind = payload[i];
            }
            i += len;
        }
        const replyType = kind === 1 ? 2 : 5;
        const boot = new Uint8Array(300);
        boot[0] = 2;
        boot[1] = 1;
        boot[2] = 6;
        boot.set(payload.subarray(4, 8), 4);
        boot[10] = payload[10];
        boot[11] = payload[11];
        if ((boot[10] & 0x80) === 0 && boot[10] === 0 && boot[11] === 0) {
            boot[10] = 0x80;
        }
        boot.set(net.ip, 16);
        boot.set(net.gateway, 20);
        boot.set(payload.subarray(28, 44), 28);
        const opts = dhcpOptions(replyType, net);
        // Full BOOTP keeps options at 236. The 6502 "light" client keeps
        // them immediately after chaddr. Write both.
        boot.set(opts, 44);
        boot.set(opts, 236);
        debug('Uthernet DHCP', replyType === 2 ? 'offer' : 'ack', net.ip.join('.'));
        const udp = datagram(67, 68, boot);
        sealUdp(net.gateway, [255, 255, 255, 255], udp);
        this.queue(
            this.ipFrame(
                net.gateway,
                [255, 255, 255, 255],
                17,
                udp,
                [0xff, 0xff, 0xff, 0xff, 0xff, 0xff]
            )
        );
    }

    private finishNet(net: NetConfig) {
        if (getUthernetPrefs().addressMode === 'manual') {
            return;
        }
        this.net = net;
        const held = this.dhcpHold;
        this.dhcpHold = null;
        if (held) {
            this.dhcp(held);
            this.flush();
        }
    }

    private requestNet() {
        if (getUthernetPrefs().addressMode === 'manual') {
            this.applyAddressChoice();
            return;
        }
        if (this.netStarted) {
            return;
        }
        this.netStarted = true;
        void this.hooks.network().then(
            (net) => {
                if (net) {
                    this.finishNet(net);
                } else {
                    this.netStarted = false;
                }
            },
            () => {
                this.netStarted = false;
            }
        );
    }

    private dns(src: number[], srcPort: number, dst: number[], query: Uint8Array) {
        if (query.length < 12 || (query[2] & 0x80) !== 0) {
            return;
        }
        const name = dnsName(query, 12);
        if (!name) {
            return;
        }
        const wait: DnsWait = {
            name,
            client: src,
            clientPort: srcPort,
            server: dst,
            query,
        };
        this.dnsWait = wait;
        if (this.dnsCache.has(name)) {
            this.replyDns(wait, this.dnsCache.get(name) ?? null);
            return;
        }
        if (this.dnsBusy.has(name)) {
            return;
        }
        this.dnsBusy.add(name);
        void this.hooks.resolve(name).then(
            (ip) => {
                this.dnsBusy.delete(name);
                this.dnsCache.set(name, ip);
                if (this.dnsWait && this.dnsWait.name === name) {
                    this.replyDns(this.dnsWait, ip);
                    this.flush();
                }
            },
            () => {
                this.dnsBusy.delete(name);
                this.dnsCache.set(name, null);
                if (this.dnsWait && this.dnsWait.name === name) {
                    this.replyDns(this.dnsWait, null);
                    this.flush();
                }
            }
        );
    }

    private replyDns(wait: DnsWait, ip: string | null) {
        const parts = ip ? ip.split('.').map((n) => Number(n)) : null;
        if (parts && parts.length === 4 && parts.every((n) => n >= 0 && n <= 255)) {
            this.names.set(ip as string, wait.name);
            debug('Uthernet DNS', wait.name, ip);
        } else {
            debug('Uthernet DNS', wait.name, 'not found');
        }
        const answer = dnsAnswer(wait.query, parts && parts.length === 4 ? parts : null);
        const udp = datagram(53, wait.clientPort, answer);
        sealUdp(wait.server, wait.client, udp);
        this.queue(this.ipFrame(wait.server, wait.client, 17, udp));
    }

    private tcp(_src: number[], dst: number[], body: Uint8Array) {
        if (body.length < 20) {
            return;
        }
        const srcPort = (body[0] << 8) | body[1];
        const dstPort = (body[2] << 8) | body[3];
        const seq = read32(body, 4);
        const ack = read32(body, 8);
        const hlen = ((body[12] >> 4) & 0x0f) * 4;
        const flags = body[13];
        const window = (body[14] << 8) | body[15];
        const payload = hlen <= body.length ? body.subarray(hlen) : body.subarray(0, 0);
        let conn = this.conns.find(
            (c) => c.srcPort === srcPort && c.dstPort === dstPort && c.dstIp === dst.join('.')
        );

        if (flags & 0x02) {
            if (!conn) {
                conn = {
                    srcPort,
                    dstIp: dst.join('.'),
                    dstPort,
                    host: this.names.get(dst.join('.')) || dst.join('.'),
                    expectSeq: (seq + 1) >>> 0,
                    sndUna: 0x1001,
                    sndNxt: 0x1001,
                    dataSeq: 0x1001,
                    window: window || 1024,
                    mss: mssOf(body, hlen),
                    http: [],
                    started: false,
                    body: null,
                    finSent: false,
                    stall: 0,
                    gen: this.gen,
                };
                this.conns.push(conn);
                debug('Uthernet TCP', conn.host, dstPort);
            }
            conn.expectSeq = (seq + 1) >>> 0;
            conn.window = window || conn.window;
            this.segment(conn, new Uint8Array(0), 0x1000, 0x12, (seq + 1) >>> 0);
            return;
        }
        if (!conn || flags & 0x04) {
            return;
        }
        conn.window = window || conn.window;
        if (seqGte(ack, conn.sndUna) && seqGte(conn.sndNxt, ack)) {
            conn.sndUna = ack;
            conn.stall = 0;
        }
        if (seq === conn.expectSeq && payload.length) {
            for (let i = 0; i < payload.length; i++) {
                conn.http.push(payload[i]);
            }
            conn.expectSeq = (conn.expectSeq + payload.length) >>> 0;
        }
        if (flags & 0x01 && seq === conn.expectSeq) {
            conn.expectSeq = (conn.expectSeq + 1) >>> 0;
        }
        if (payload.length || flags & 0x01) {
            this.segment(conn, new Uint8Array(0), conn.sndNxt, 0x10, conn.expectSeq);
        }
        if (!conn.started && headerDone(conn.http)) {
            conn.started = true;
            void this.fetch(conn);
        } else {
            this.transmit(conn);
        }
    }

    private async fetch(conn: Conn) {
        const gen = conn.gen;
        let raw = '';
        const http = conn.http;
        for (let i = 0; i < http.length; i++) {
            raw += String.fromCharCode(http[i]);
        }
        const url = this.hooks.urlFor(raw, conn.host, conn.dstPort);
        if (!url) {
            this.fail(conn, gen);
            return;
        }
        debug('Uthernet TCP fetch', url);
        try {
            const response = await this.hooks.load(url);
            const body = new Uint8Array(await response.arrayBuffer());
            if (gen !== conn.gen || gen !== this.gen) {
                return;
            }
            conn.body = httpBytes(
                response.status,
                body,
                response.headers?.get('content-type') || ''
            );
            conn.dataSeq = conn.sndNxt;
            this.transmit(conn);
            this.flush();
        } catch (err) {
            debug('Uthernet TCP fetch failed', err);
            this.fail(conn, gen);
        }
    }

    private fail(conn: Conn, gen: number) {
        if (gen !== conn.gen || gen !== this.gen) {
            return;
        }
        const text = new TextEncoder().encode(
            'HTTP/1.0 502 ERR\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'
        );
        conn.body = text;
        conn.dataSeq = conn.sndNxt;
        this.transmit(conn);
        this.flush();
    }

    private transmit(conn: Conn) {
        if (!conn.body) {
            return;
        }
        const acked = seqDelta(conn.sndUna, conn.dataSeq);
        let off = seqDelta(conn.sndNxt, conn.dataSeq);
        const windowEnd = acked + Math.max(conn.window, 1);
        let guard = 0;
        while (off < conn.body.length && off < windowEnd && guard < 8) {
            const n = Math.min(conn.mss, conn.body.length - off, windowEnd - off);
            if (n <= 0) {
                break;
            }
            const last = off + n >= conn.body.length;
            const flags = last ? 0x19 : 0x18;
            this.segment(conn, conn.body.subarray(off, off + n), conn.sndNxt, flags, conn.expectSeq);
            conn.sndNxt = (conn.sndNxt + n + (last ? 1 : 0)) >>> 0;
            if (last) {
                conn.finSent = true;
            }
            off += n;
            guard++;
        }
    }

    private segment(conn: Conn, payload: Uint8Array, seq: number, flags: number, ack: number) {
        const headLen = flags & 0x02 ? 24 : 20;
        const tcp = new Uint8Array(headLen + payload.length);
        tcp[0] = conn.dstPort >> 8;
        tcp[1] = conn.dstPort & 0xff;
        tcp[2] = conn.srcPort >> 8;
        tcp[3] = conn.srcPort & 0xff;
        write32(tcp, 4, seq);
        write32(tcp, 8, ack);
        tcp[12] = (headLen / 4) << 4;
        tcp[13] = flags;
        tcp[14] = 0x10;
        if (flags & 0x02) {
            tcp[20] = 2;
            tcp[21] = 4;
            tcp[22] = 0x05;
            tcp[23] = 0xb4;
        }
        tcp.set(payload, headLen);
        const src = conn.dstIp.split('.').map((n) => Number(n));
        const sum = transportSum(src, this.clientIp, 6, tcp);
        tcp[16] = sum >> 8;
        tcp[17] = sum & 0xff;
        this.queue(this.ipFrame(src, this.clientIp, 6, tcp));
    }

    private ipFrame(
        src: number[],
        dst: number[],
        proto: number,
        payload: Uint8Array,
        ethDst: number[] = this.clientMac
    ): Uint8Array {
        const ip = new Uint8Array(20 + payload.length);
        ip[0] = 0x45;
        ip[2] = ip.length >> 8;
        ip[3] = ip.length & 0xff;
        ip[4] = this.ipId >> 8;
        ip[5] = this.ipId & 0xff;
        this.ipId = (this.ipId + 1) & 0xffff;
        ip[8] = 64;
        ip[9] = proto;
        put(ip, 12, src);
        put(ip, 16, dst);
        const sum = finish(sumBytes(ip, 0, 20, 0));
        ip[10] = sum >> 8;
        ip[11] = sum & 0xff;
        ip.set(payload, 20);
        return ether(ethDst, GATEWAY_MAC, ETH_IP, ip);
    }
}

function ether(dst: number[], src: number[], type: number, payload: Uint8Array): Uint8Array {
    const frame = new Uint8Array(Math.max(60, 14 + payload.length));
    put(frame, 0, dst);
    put(frame, 6, src);
    frame[12] = type >> 8;
    frame[13] = type & 0xff;
    frame.set(payload, 14);
    return frame;
}

function sealUdp(src: number[], dst: number[], udp: Uint8Array) {
    const sum = transportSum(src, dst, 17, udp);
    udp[6] = sum >> 8;
    udp[7] = sum & 0xff;
}

function datagram(srcPort: number, dstPort: number, payload: Uint8Array): Uint8Array {
    const udp = new Uint8Array(8 + payload.length);
    udp[0] = srcPort >> 8;
    udp[1] = srcPort & 0xff;
    udp[2] = dstPort >> 8;
    udp[3] = dstPort & 0xff;
    udp[4] = udp.length >> 8;
    udp[5] = udp.length & 0xff;
    udp.set(payload, 8);
    return udp;
}

function put(into: Uint8Array, at: number, bytes: number[]) {
    for (let i = 0; i < bytes.length; i++) {
        into[at + i] = bytes[i];
    }
}

function sameMac(a: number[], b: number[]): boolean {
    return a.every((bte, i) => bte === b[i]);
}

function read32(data: Uint8Array, at: number): number {
    return (
        ((data[at] << 24) | (data[at + 1] << 16) | (data[at + 2] << 8) | data[at + 3]) >>>
        0
    );
}

function write32(data: Uint8Array, at: number, value: number) {
    data[at] = (value >>> 24) & 0xff;
    data[at + 1] = (value >>> 16) & 0xff;
    data[at + 2] = (value >>> 8) & 0xff;
    data[at + 3] = value & 0xff;
}

function seqDelta(later: number, earlier: number): number {
    return (later - earlier) >>> 0;
}

function seqGte(a: number, b: number): boolean {
    return seqDelta(a, b) < 0x80000000;
}

function sumBytes(data: Uint8Array, off: number, len: number, sum: number): number {
    let i = 0;
    while (i + 1 < len) {
        sum += (data[off + i] << 8) | data[off + i + 1];
        i += 2;
    }
    if (i < len) {
        sum += data[off + i] << 8;
    }
    return sum;
}

function finish(sum: number): number {
    while (sum >>> 16) {
        sum = (sum & 0xffff) + (sum >>> 16);
    }
    return (~sum) & 0xffff;
}

function transportSum(src: number[], dst: number[], proto: number, segment: Uint8Array): number {
    let sum = 0;
    sum += (src[0] << 8) | src[1];
    sum += (src[2] << 8) | src[3];
    sum += (dst[0] << 8) | dst[1];
    sum += (dst[2] << 8) | dst[3];
    sum += proto;
    sum += segment.length;
    return finish(sumBytes(segment, 0, segment.length, sum)) || 0xffff;
}

function dnsAnswer(query: Uint8Array, ip: number[] | null): Uint8Array {
    const answer = new Uint8Array(query.length + (ip ? 16 : 0));
    answer.set(query);
    answer[2] = 0x81;
    answer[3] = ip ? 0x80 : 0x83;
    if (!ip) {
        return answer;
    }
    const a = query.length;
    answer[6] = 0x00;
    answer[7] = 0x01;
    answer[a] = 0xc0;
    answer[a + 1] = 0x0c;
    answer[a + 2] = 0x00;
    answer[a + 3] = 0x01;
    answer[a + 4] = 0x00;
    answer[a + 5] = 0x01;
    answer[a + 9] = 60;
    answer[a + 10] = 0x00;
    answer[a + 11] = 0x04;
    answer[a + 12] = ip[0];
    answer[a + 13] = ip[1];
    answer[a + 14] = ip[2];
    answer[a + 15] = ip[3];
    return answer;
}

function dnsName(packet: Uint8Array, at: number): string | null {
    const labels: string[] = [];
    let i = at;
    while (i < packet.length) {
        const len = packet[i++];
        if (len === 0) {
            return labels.join('.');
        }
        if ((len & 0xc0) === 0xc0 || i + len > packet.length) {
            return null;
        }
        let label = '';
        for (let n = 0; n < len; n++) {
            label += String.fromCharCode(packet[i++]);
        }
        labels.push(label);
    }
    return null;
}

function mssOf(tcp: Uint8Array, hlen: number): number {
    let mss = 536;
    for (let i = 20; i + 1 < hlen && i < tcp.length; ) {
        const kind = tcp[i++];
        if (kind === 0) {
            break;
        }
        if (kind === 1) {
            continue;
        }
        const len = tcp[i++];
        if (kind === 2 && len === 4 && i + 1 < tcp.length) {
            mss = (tcp[i] << 8) | tcp[i + 1];
        }
        i += Math.max(0, len - 2);
    }
    if (mss < 1) {
        mss = 536;
    }
    return Math.min(mss, 1000);
}

function headerDone(bytes: number[]): boolean {
    for (let i = 0; i <= bytes.length - 4; i++) {
        if (bytes[i] === 13 && bytes[i + 1] === 10 && bytes[i + 2] === 13 && bytes[i + 3] === 10) {
            return true;
        }
    }
    return false;
}

function dhcpCookie(payload: Uint8Array): number {
    const spots = [236, 44];
    for (let s = 0; s < spots.length; s++) {
        const i = spots[s];
        if (
            i + 4 <= payload.length &&
            payload[i] === 0x63 &&
            payload[i + 1] === 0x82 &&
            payload[i + 2] === 0x53 &&
            payload[i + 3] === 0x63
        ) {
            return i;
        }
    }
    return -1;
}

function dhcpOptions(replyType: number, net: NetConfig): Uint8Array {
    const bytes: number[] = [0x63, 0x82, 0x53, 0x63];
    const opt = (code: number, data: number[]) => {
        bytes.push(code, data.length);
        for (let i = 0; i < data.length; i++) {
            bytes.push(data[i]);
        }
    };
    opt(53, [replyType]);
    opt(54, net.gateway);
    opt(51, [0x00, 0x01, 0x51, 0x80]);
    opt(1, net.mask);
    opt(3, net.gateway);
    opt(6, net.dns);
    bytes.push(255);
    return Uint8Array.from(bytes);
}

export function httpBytes(status: number, body: Uint8Array, contentType = ''): Uint8Array {
    const reason = status === 200 ? 'OK' : 'ERR';
    const head = httpHead(status, reason, body, contentType);
    const prefix = new TextEncoder().encode(head);
    const all = new Uint8Array(prefix.length + body.length);
    all.set(prefix, 0);
    all.set(body, prefix.length);
    return all;
}

function httpHead(status: number, reason: string, body: Uint8Array, contentType: string): string {
    return (
        `HTTP/1.0 ${status} ${reason}\r\n` +
        `Content-Type: ${mimeFor(contentType, body)}\r\n` +
        `Content-Length: ${body.length}\r\n` +
        `Connection: close\r\n\r\n`
    );
}

function mimeFor(contentType: string, body: Uint8Array): string {
    const clean = contentType.split(';')[0].trim();
    // Contiki displays a page only when the type contains "html".
    if (/html/i.test(clean) || looksLikeHtml(body)) {
        return 'text/html';
    }
    return clean || 'application/octet-stream';
}

function looksLikeHtml(body: Uint8Array): boolean {
    let i = 0;
    while (
        i < body.length &&
        (body[i] === 9 || body[i] === 10 || body[i] === 13 || body[i] === 32)
    ) {
        i++;
    }
    return body[i] === 0x3c;
}
