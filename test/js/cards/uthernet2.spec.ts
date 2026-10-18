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
        const fetchMock = jest.fn(
            async () =>
                ({
                    status: 200,
                    arrayBuffer: async () =>
                        payload.buffer.slice(
                            payload.byteOffset,
                            payload.byteOffset + payload.byteLength
                        ),
                }) as Response
        );
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

            const called = String(
                (fetchMock as jest.Mock).mock.calls[0][0]
            );
            expect(decodeURIComponent(called)).toBe(
                decodeURIComponent(
                    fetchTarget(
                        'http://a2.foumartgames.com/gridlock/get.php?hash=abc'
                    )
                )
            );
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
