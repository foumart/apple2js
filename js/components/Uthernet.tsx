import { useEffect } from 'preact/hooks';
import Apple2IO, { slot } from '../apple2io';
import Uthernet2 from '../cards/uthernet2';

/**
 * Uthernet II component properties.
 */
export interface UthernetProps {
    io: Apple2IO | undefined;
    slot: slot;
}

/**
 * Uthernet II card. No firmware, so it only occupies the slot I/O window.
 *
 * @param io Apple2IO object
 * @param slot Slot to register card in
 */
export const Uthernet = ({ io, slot }: UthernetProps) => {
    useEffect(() => {
        if (io) {
            io.setSlot(slot, new Uthernet2());
        }
    }, [io, slot]);

    return null;
};
