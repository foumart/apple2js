import Apple2IO, { slot } from '../apple2io';
import Uthernet2, { detectNetwork } from '../cards/uthernet2';
import {
    AddressMode,
    setUthernetPrefs,
    WebMode,
} from '../cards/uthernet_settings';
import {
    BOOLEAN_OPTION,
    SELECT_OPTION,
    TEXT_OPTION,
    OptionHandler,
} from '../options';

const ENABLED = 'uthernet_enabled';
const SLOT = 'uthernet_slot';
const ADDRESS = 'uthernet_address';
const IP = 'uthernet_ip';
const MASK = 'uthernet_mask';
const GATEWAY = 'uthernet_gateway';
const DNS = 'uthernet_dns';
const WEB = 'uthernet_web';

const MANUAL_FIELDS = [IP, MASK, GATEWAY, DNS];

let boundIo: Apple2IO | null = null;
let boundCard: Uthernet2 | null = null;

/** Remember the card installed by the machine setup so the options can move it. */
export function bindUthernet(io: Apple2IO, card: Uthernet2) {
    boundIo = io;
    boundCard = card;
}

export class Network implements OptionHandler {
    private enabled = true;
    private slotNo = 3;
    private addressMode: AddressMode = 'auto';
    private ip = '';
    private mask = '';
    private gateway = '';
    private dns = '';
    private web: WebMode = 'https-fallback';
    private placed: slot | null = 3;
    private detected: Record<string, string> | null = null;
    private detecting = false;

    constructor() {
        document.addEventListener('apple2:options-open', () => {
            this.syncAddressFields();
        });
    }

    getOptions() {
        const slots = [1, 2, 3, 4, 5, 6, 7].map((n) => ({
            name: `Slot ${n}`,
            value: String(n),
        }));
        return [
            {
                name: 'Card',
                options: [
                    {
                        name: ENABLED,
                        label: 'Uthernet II',
                        type: BOOLEAN_OPTION,
                        defaultVal: true,
                    },
                    {
                        name: SLOT,
                        label: 'Expansion',
                        type: SELECT_OPTION,
                        defaultVal: '3',
                        values: slots,
                    },
                ],
            },
            {
                name: 'Address',
                options: [
                    {
                        name: ADDRESS,
                        label: 'Address',
                        type: SELECT_OPTION,
                        defaultVal: 'auto',
                        values: [
                            { name: 'Automatic', value: 'auto' },
                            { name: 'Manual', value: 'manual' },
                        ],
                    },
                    {
                        name: IP,
                        label: 'IP',
                        type: TEXT_OPTION,
                        defaultVal: '',
                    },
                    {
                        name: MASK,
                        label: 'Netmask',
                        type: TEXT_OPTION,
                        defaultVal: '',
                    },
                    {
                        name: GATEWAY,
                        label: 'Gateway',
                        type: TEXT_OPTION,
                        defaultVal: '',
                    },
                    {
                        name: DNS,
                        label: 'DNS',
                        type: TEXT_OPTION,
                        defaultVal: '',
                    },
                ],
            },
            {
                name: 'Web',
                options: [
                    {
                        name: WEB,
                        label: '',
                        type: SELECT_OPTION,
                        defaultVal: 'https-fallback',
                        values: [
                            { name: 'HTTP only', value: 'http' },
                            {
                                name: 'HTTPS if HTTP fails',
                                value: 'https-fallback',
                            },
                            { name: 'Always HTTPS', value: 'https' },
                        ],
                    },
                ],
            },
        ];
    }

    setOption(name: string, value: string | boolean | number) {
        switch (name) {
            case ENABLED:
                this.enabled = value === true || value === 'true' || value === 1;
                break;
            case SLOT:
                this.slotNo = Number(value) || 3;
                break;
            case ADDRESS:
                this.addressMode = value === 'manual' ? 'manual' : 'auto';
                break;
            case IP:
                this.ip = String(value);
                break;
            case MASK:
                this.mask = String(value);
                break;
            case GATEWAY:
                this.gateway = String(value);
                break;
            case DNS:
                this.dns = String(value);
                break;
            case WEB:
                this.web =
                    value === 'http' || value === 'https'
                        ? value
                        : 'https-fallback';
                break;
            default:
                return;
        }
        setUthernetPrefs({
            enabled: this.enabled,
            slot: this.slotNo,
            addressMode: this.addressMode,
            ip: this.ip,
            mask: this.mask,
            gateway: this.gateway,
            dns: this.dns,
            web: this.web,
        });
        this.placeCard();
        this.syncAddressFields();
    }

    private placeCard() {
        if (!boundIo || !boundCard) {
            return;
        }
        if (!this.enabled) {
            if (this.placed != null) {
                boundIo.setSlot(this.placed, null);
                this.placed = null;
            }
            return;
        }
        const next = this.slotNo as slot;
        if (next < 1 || next > 7) {
            return;
        }
        if (this.placed === next) {
            return;
        }
        const occupant = boundIo.getSlot(next);
        if (occupant && occupant !== boundCard) {
            return;
        }
        if (this.placed != null) {
            boundIo.setSlot(this.placed, null);
        }
        boundIo.setSlot(next, boundCard);
        this.placed = next;
    }

    /**
     * Automatic shows the detected address, greyed out, without storing it.
     * Manual puts back the address the user typed.
     */
    private syncAddressFields() {
        const manual = this.addressMode === 'manual';
        const saved: Record<string, string> = {
            [IP]: this.ip,
            [MASK]: this.mask,
            [GATEWAY]: this.gateway,
            [DNS]: this.dns,
        };
        for (const id of MANUAL_FIELDS) {
            const field = document.getElementById(id) as HTMLInputElement | null;
            if (!field) {
                continue;
            }
            field.disabled = !manual;
            if (manual) {
                this.showField(id, saved[id]);
            } else if (this.detected) {
                this.showField(id, this.detected[id]);
            }
        }
        if (!manual && !this.detected && !this.detecting) {
            void this.showDetected();
        }
    }

    /**
     * Show the lease Contiki's DHCP gets: the LAN address uthernet-net.php
     * reports on this machine, or the virtual network when there is none.
     */
    private async showDetected() {
        if (this.addressMode !== 'auto' || this.detecting) {
            return;
        }
        this.detecting = true;
        const found = await detectNetwork();
        this.detecting = false;
        if (this.addressMode !== 'auto') {
            return;
        }
        this.detected = {
            [IP]: found.ip.join('.'),
            [MASK]: found.mask.join('.'),
            [GATEWAY]: found.gateway.join('.'),
            [DNS]: found.dns.join('.'),
        };
        this.showField(IP, this.detected[IP]);
        this.showField(MASK, this.detected[MASK]);
        this.showField(GATEWAY, this.detected[GATEWAY]);
        this.showField(DNS, this.detected[DNS]);
    }

    private showField(id: string, value: string | undefined) {
        const field = document.getElementById(id) as HTMLInputElement | null;
        if (field) {
            field.value = value ?? '';
            field.setAttribute('value', field.value);
        }
    }
}
