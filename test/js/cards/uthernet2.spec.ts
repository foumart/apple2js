import Uthernet2, { fetchTarget, requestUrl } from '../../../js/cards/uthernet2';

/** Slot 3 window: $C0B4 mode, $C0B5/$C0B6 address, $C0B7 data. */
const MODE = 0xb4;
const ADDR_HI = 0xb5;
const ADDR_LO = 0xb6;
const DATA = 0xb7;

function setAddr(card: Uthernet2, addr: number) {
    card.ioSwitch(ADDR_HI, (addr >> 8) & 0xff);
    card.ioSwitch(ADDR_LO, addr & 0xff);
}

function readByte(card: Uthernet2, addr: number): number {
    setAddr(card, addr);
    return card.ioSwitch(DATA) ?? 0;
}

function writeByte(card: Uthernet2, addr: number, value: number) {
    setAddr(card, addr);
    card.ioSwitch(DATA, value);
}

function readWord(card: Uthernet2, addr: number): number {
    setAddr(card, addr);
    const hi = card.ioSwitch(DATA) ?? 0;
    const lo = card.ioSwitch(DATA) ?? 0;
    return (hi << 8) | lo;
}

/** A response from uthernet-*.php: marked as run, with the page's own type. */
function scriptReply(body: Uint8Array | string, type = ''): Response {
    const bytes =
        typeof body === 'string' ? new TextEncoder().encode(body) : body;
    const headers: Record<string, string> = { 'x-uthernet': '1' };
    if (type) {
        headers['x-uthernet-type'] = type;
    }
    return {
        ok: true,
        status: 200,
        headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
        text: async () => new TextDecoder().decode(bytes),
        arrayBuffer: async () =>
            bytes.buffer.slice(
                bytes.byteOffset,
                bytes.byteOffset + bytes.byteLength
            ),
    } as unknown as Response;
}

describe('Uthernet II', () => {
    it('answers the monitor test and the IP65 probe', () => {
        const card = new Uthernet2();

        card.ioSwitch(MODE, 0x80);
        expect(card.ioSwitch(MODE) ?? 0).toBe(0x00);

        card.ioSwitch(MODE, 0x03);
        expect(card.ioSwitch(MODE)).toBe(0x03);

        // drivers/w5100.s: (0x07 XOR 0xD0) XOR RTR_hi XOR RTR_lo == 0
        setAddr(card, 0x0017);
        const hi = card.ioSwitch(DATA) ?? 0;
        const lo = card.ioSwitch(DATA) ?? 0;
        expect((0x07 ^ 0xd0) ^ hi ^ lo).toBe(0);

        // Real silicon returns 0x28. WGET treats 0x00 as virtual DNS.
        expect(readByte(card, 0x0028)).toBe(0x00);
        expect(readByte(card, 0x001a)).toBe(0x55);

        card.ioSwitch(MODE, 0x80);
        expect((card.ioSwitch(MODE) ?? 0) & 0x80).toBe(0);
        card.ioSwitch(MODE, 0x13);
        expect(card.ioSwitch(MODE)).toBe(0x13);
        expect(readByte(card, 0x0028)).toBe(0x00);
    });

    it('builds an HTTP URL from the request WGET sends', () => {
        const raw =
            'GET /gridlock/get.php?hash=abc&min=08&max=40 HTTP/1.0\r\n' +
            'Host: a2.foumartgames.com\r\n\r\n';
        expect(requestUrl(raw, 'a2.foumartgames.com', 80)).toBe(
            'http://a2.foumartgames.com/gridlock/get.php?hash=abc&min=08&max=40'
        );
        expect(fetchTarget('http://example.com/anything')).toBe(
            'uthernet-fetch.php?url=' +
                encodeURIComponent('http://example.com/anything')
        );
    });

    it('resolves a hostname and returns the fetch body as HTTP/1.0', async () => {
        const payload = new Uint8Array([0x53, 0x54, 0x41, 0x47, 0x45]);
        const fetchMock = jest.fn(async () => scriptReply(payload));
        const previous = global.fetch;
        global.fetch = fetchMock as typeof fetch;

        try {
            const card = new Uthernet2();
            card.ioSwitch(MODE, 0x13);
            // 4KB for sockets 0 and 1, matching drivers/w5100.s
            writeByte(card, 0x001a, 0x0a);
            writeByte(card, 0x001b, 0x0a);

            const host = 'a2.foumartgames.com';
            writeByte(card, 0x0500, 0x29);
            writeByte(card, 0x052a, host.length);
            setAddr(card, 0x052b);
            for (let i = 0; i < host.length; i++) {
                card.ioSwitch(DATA, host.charCodeAt(i));
            }
            writeByte(card, 0x0510, 0x00);
            writeByte(card, 0x0511, 80);
            writeByte(card, 0x0501, 0x01);

            expect(readByte(card, 0x0503)).toBe(0x13);
            expect(readByte(card, 0x050c)).toBe(10);
            expect(readByte(card, 0x0501)).toBe(0x00);

            writeByte(card, 0x0501, 0x04);
            expect(readByte(card, 0x0503)).toBe(0x17);

            const request =
                'GET /gridlock/get.php?hash=abc HTTP/1.0\r\n' +
                'Host: a2.foumartgames.com\r\n\r\n';
            setAddr(card, 0x5000);
            for (let i = 0; i < request.length; i++) {
                card.ioSwitch(DATA, request.charCodeAt(i));
            }
            writeByte(card, 0x0524, (request.length >> 8) & 0xff);
            writeByte(card, 0x0525, request.length & 0xff);
            writeByte(card, 0x0501, 0x20);

            await new Promise((resolve) => setTimeout(resolve, 0));

            const calls = (fetchMock as jest.Mock).mock.calls.map((args) =>
                decodeURIComponent(String(args[0]))
            );
            expect(
                calls.some((url) =>
                    url.includes(
                        'http://a2.foumartgames.com/gridlock/get.php?hash=abc'
                    )
                )
            ).toBe(true);
            const received = readWord(card, 0x0526);
            expect(received).toBeGreaterThan(12);

            setAddr(card, 0x7000);
            let text = '';
            for (let i = 0; i < received; i++) {
                text += String.fromCharCode(card.ioSwitch(DATA) ?? 0);
            }
            expect(text.startsWith('HTTP/1.0 200')).toBe(true);
            expect(text.endsWith('STAGE')).toBe(true);

            writeByte(card, 0x0528, (received >> 8) & 0xff);
            writeByte(card, 0x0529, received & 0xff);
            writeByte(card, 0x0501, 0x40);
            expect(readWord(card, 0x0526)).toBe(0);
            expect(readByte(card, 0x0503)).toBe(0x1c);
        } finally {
            global.fetch = previous;
        }
    });
});

function writeWord(card: Uthernet2, addr: number, value: number) {
    setAddr(card, addr);
    card.ioSwitch(DATA, (value >> 8) & 0xff);
    card.ioSwitch(DATA, value & 0xff);
}

function openMacRaw(card: Uthernet2) {
    card.ioSwitch(MODE, 0x13);
    writeByte(card, 0x001a, 0x0a);
    writeByte(card, 0x001b, 0x0a);
    writeByte(card, 0x0400, 0x44);
    writeByte(card, 0x0401, 0x01);
}

function sendFrame(card: Uthernet2, frame: Uint8Array) {
    setAddr(card, 0x4000);
    for (let i = 0; i < frame.length; i++) {
        card.ioSwitch(DATA, frame[i]);
    }
    writeWord(card, 0x0422, 0);
    writeWord(card, 0x0424, frame.length);
    writeByte(card, 0x0401, 0x20);
}

function readFrame(card: Uthernet2): Uint8Array | null {
    if (!readWord(card, 0x0426)) {
        return null;
    }
    const rd = readWord(card, 0x0428);
    setAddr(card, 0x6000 + (rd & 0x0fff));
    const size = ((card.ioSwitch(DATA) ?? 0) << 8) | (card.ioSwitch(DATA) ?? 0);
    const frame = new Uint8Array(Math.max(0, size - 2));
    for (let i = 0; i < frame.length; i++) {
        frame[i] = card.ioSwitch(DATA) ?? 0;
    }
    writeWord(card, 0x0428, (rd + size) & 0xffff);
    writeByte(card, 0x0401, 0x40);
    return frame;
}

function udpFrame(
    payload: Uint8Array,
    srcPort: number,
    dstPort: number,
    srcIp: number[],
    dstIp: number[]
): Uint8Array {
    const udp = new Uint8Array(8 + payload.length);
    udp[0] = srcPort >> 8;
    udp[1] = srcPort & 0xff;
    udp[2] = dstPort >> 8;
    udp[3] = dstPort & 0xff;
    udp[4] = udp.length >> 8;
    udp[5] = udp.length & 0xff;
    udp.set(payload, 8);
    const ip = new Uint8Array(20 + udp.length);
    ip[0] = 0x45;
    ip[2] = ip.length >> 8;
    ip[3] = ip.length & 0xff;
    ip[8] = 64;
    ip[9] = 17;
    ip.set(srcIp, 12);
    ip.set(dstIp, 16);
    ip.set(udp, 20);
    const frame = new Uint8Array(14 + ip.length);
    frame.fill(0xff, 0, 6);
    frame[6] = 0x00;
    frame[7] = 0x08;
    frame[8] = 0xdc;
    frame[11] = 0xa2;
    frame[12] = 0x08;
    frame.set(ip, 14);
    return frame;
}

function dhcp(kind: number): Uint8Array {
    const boot = new Uint8Array(300);
    boot[0] = 1;
    boot[1] = 1;
    boot[2] = 6;
    boot[4] = 0x11;
    boot[7] = 0x44;
    boot[28] = 0x00;
    boot[29] = 0x08;
    boot[30] = 0xdc;
    boot[33] = 0xa2;
    boot[236] = 0x63;
    boot[237] = 0x82;
    boot[238] = 0x53;
    boot[239] = 0x63;
    boot[240] = 53;
    boot[241] = 1;
    boot[242] = kind;
    boot[243] = 255;
    return udpFrame(boot, 68, 67, [0, 0, 0, 0], [255, 255, 255, 255]);
}

function dnsQuery(name: string): Uint8Array {
    const bytes = [0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
    for (const label of name.split('.')) {
        bytes.push(label.length);
        for (let i = 0; i < label.length; i++) {
            bytes.push(label.charCodeAt(i));
        }
    }
    bytes.push(0, 0, 1, 0, 1);
    return udpFrame(
        Uint8Array.from(bytes),
        1025,
        53,
        [192, 168, 1, 2],
        [192, 168, 1, 1]
    );
}

function tcpFrame(
    seq: number,
    ack: number,
    flags: number,
    payload: Uint8Array,
    dstIp: number[]
): Uint8Array {
    const tcp = new Uint8Array(20 + payload.length);
    tcp[0] = 0x04;
    tcp[1] = 0x00;
    tcp[2] = 0x00;
    tcp[3] = 80;
    tcp[4] = (seq >>> 24) & 0xff;
    tcp[5] = (seq >>> 16) & 0xff;
    tcp[6] = (seq >>> 8) & 0xff;
    tcp[7] = seq & 0xff;
    tcp[8] = (ack >>> 24) & 0xff;
    tcp[9] = (ack >>> 16) & 0xff;
    tcp[10] = (ack >>> 8) & 0xff;
    tcp[11] = ack & 0xff;
    tcp[12] = 0x50;
    tcp[13] = flags;
    tcp[14] = 0x10;
    tcp.set(payload, 20);
    const ip = new Uint8Array(20 + tcp.length);
    ip[0] = 0x45;
    ip[2] = ip.length >> 8;
    ip[3] = ip.length & 0xff;
    ip[8] = 64;
    ip[9] = 6;
    ip.set([192, 168, 1, 2], 12);
    ip.set(dstIp, 16);
    ip.set(tcp, 20);
    const frame = new Uint8Array(14 + ip.length);
    frame[6] = 0x00;
    frame[7] = 0x08;
    frame[8] = 0xdc;
    frame[11] = 0xa2;
    frame[12] = 0x08;
    frame.set(ip, 14);
    return frame;
}

function udpChecksumOk(frame: Uint8Array): boolean {
    const ip = frame.subarray(14);
    const total = (ip[2] << 8) | ip[3];
    const udp = ip.subarray(20, total);
    let sum = 0;
    for (let i = 12; i < 20; i += 2) {
        sum += (ip[i] << 8) | ip[i + 1];
    }
    sum += ip[9];
    sum += udp.length;
    for (let i = 0; i + 1 < udp.length; i += 2) {
        sum += (udp[i] << 8) | udp[i + 1];
    }
    while (sum >>> 16) {
        sum = (sum & 0xffff) + (sum >>> 16);
    }
    return sum === 0xffff;
}

function ipPayload(frame: Uint8Array): Uint8Array {
    const ip = frame.subarray(14);
    const total = (ip[2] << 8) | ip[3];
    const ihl = (ip[0] & 0x0f) * 4;
    return ip.subarray(ihl, total);
}

describe('Uthernet II MACRAW', () => {
    it('offers a DHCP lease, answers DNS, and returns an HTTP body', async () => {
        const payload = new Uint8Array([0x48, 0x69]);
        const previous = global.fetch;
        global.fetch = jest.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('uthernet-net.php')) {
                return scriptReply(
                    JSON.stringify({
                        ip: '10.4.4.10',
                        mask: '255.255.255.0',
                        gateway: '10.4.4.1',
                        dns: '10.4.4.1',
                    })
                );
            }
            if (url.includes('uthernet-dns.php')) {
                return scriptReply('93.184.216.34');
            }
            return scriptReply(payload);
        }) as unknown as typeof fetch;

        try {
            const card = new Uthernet2();
            openMacRaw(card);
            expect(readByte(card, 0x0403)).toBe(0x42);

            sendFrame(card, dhcp(1));
            await new Promise((resolve) => setTimeout(resolve, 0));
            const offer = readFrame(card);
            expect(offer).not.toBeNull();
            const offerBoot = ipPayload(offer as Uint8Array).subarray(8);
            expect(offerBoot[0]).toBe(2);
            expect(Array.from(offerBoot.subarray(16, 20))).toEqual([10, 4, 4, 10]);
            expect(offerBoot[242]).toBe(2);
            expect(udpChecksumOk(offer as Uint8Array)).toBe(true);

            sendFrame(card, dhcp(3));
            const ack = readFrame(card);
            expect(ipPayload(ack as Uint8Array).subarray(8)[242]).toBe(5);

            sendFrame(card, dnsQuery('example.com'));
            await new Promise((resolve) => setTimeout(resolve, 0));
            const dns = readFrame(card);
            const dnsBody = ipPayload(dns as Uint8Array).subarray(8);
            expect(dnsBody[0]).toBe(0x00);
            expect(dnsBody[7]).toBe(1);
            expect(dnsBody[dnsBody.length - 6]).toBe(0);
            expect(dnsBody[dnsBody.length - 5]).toBe(4);
            const answer = dnsBody.subarray(dnsBody.length - 4);
            expect(Array.from(answer)).toEqual([93, 184, 216, 34]);

            sendFrame(
                card,
                tcpFrame(1000, 0, 0x02, new Uint8Array(0), [93, 184, 216, 34])
            );
            const synAck = readFrame(card);
            expect(ipPayload(synAck as Uint8Array)[13]).toBe(0x12);

            const req = new TextEncoder().encode(
                'GET /hello HTTP/1.0\r\nHost: example.com\r\n\r\n'
            );
            sendFrame(card, tcpFrame(1001, 0x1001, 0x18, req, [93, 184, 216, 34]));
            await new Promise((resolve) => setTimeout(resolve, 0));
            card.tick();

            let text = '';
            for (let i = 0; i < 6; i++) {
                const frame = readFrame(card);
                if (!frame) {
                    break;
                }
                const tcp = ipPayload(frame);
                const hlen = ((tcp[12] >> 4) & 0x0f) * 4;
                for (let n = hlen; n < tcp.length; n++) {
                    text += String.fromCharCode(tcp[n]);
                }
            }
            expect(text.startsWith('HTTP/1.0 200')).toBe(true);
            expect(text.endsWith('Hi')).toBe(true);
            const calls = (global.fetch as jest.Mock).mock.calls.map((args) =>
                decodeURIComponent(String(args[0]))
            );
            expect(calls.some((url) => url.includes('http://example.com/hello'))).toBe(true);
        } finally {
            global.fetch = previous;
        }
    });

    it('uses the relay and a virtual network when the page cannot run PHP', async () => {
        const relay = 'https://relay.example/apps/';
        const previous = global.fetch;
        global.fetch = jest.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url === 'uthernet-relay.json') {
                return {
                    ok: true,
                    json: async () => ({ relay: `${relay}uthernet-fetch.php` }),
                };
            }
            if (!url.startsWith(relay)) {
                // A dev server without PHP hands back the script's source.
                return { ok: true, status: 200, headers: { get: () => null } };
            }
            if (url.includes('uthernet-net.php')) {
                // The relay is not on this machine, so it reports no LAN.
                return scriptReply('null');
            }
            return scriptReply('<p>Hi', 'text/html; charset=utf-8');
        }) as unknown as typeof fetch;

        try {
            await jest.isolateModulesAsync(async () => {
                // A fresh module, so the relay lookup is not cached yet.
                const { default: Card } = await import(
                    '../../../js/cards/uthernet2'
                );
                const card = new Card();
                openMacRaw(card);

                sendFrame(card, dhcp(1));
                await new Promise((resolve) => setTimeout(resolve, 0));
                const offer = readFrame(card);
                expect(offer).not.toBeNull();
                const lease = ipPayload(offer as Uint8Array).subarray(8);
                expect(Array.from(lease.subarray(16, 20))).toEqual([
                    10, 0, 0, 2,
                ]);

                const server = [93, 184, 216, 34];
                sendFrame(
                    card,
                    tcpFrame(1000, 0, 0x02, new Uint8Array(0), server)
                );
                readFrame(card);
                const req = new TextEncoder().encode(
                    'GET /hello HTTP/1.0\r\nHost: example.com\r\n\r\n'
                );
                sendFrame(card, tcpFrame(1001, 0x1001, 0x18, req, server));
                await new Promise((resolve) => setTimeout(resolve, 0));
                card.tick();

                let text = '';
                for (let i = 0; i < 6; i++) {
                    const frame = readFrame(card);
                    if (!frame) {
                        break;
                    }
                    const tcp = ipPayload(frame);
                    const hlen = ((tcp[12] >> 4) & 0x0f) * 4;
                    for (let n = hlen; n < tcp.length; n++) {
                        text += String.fromCharCode(tcp[n]);
                    }
                }
                expect(text).toContain('Content-Type: text/html\r\n');
                expect(text.endsWith('<p>Hi')).toBe(true);
                const calls = (global.fetch as jest.Mock).mock.calls.map(
                    (args: unknown[]) => String(args[0])
                );
                expect(calls).toContain(
                    `${relay}uthernet-fetch.php?url=` +
                        encodeURIComponent('http://example.com/hello')
                );
            });
        } finally {
            global.fetch = previous;
        }
    });
});
