import Prefs from './prefs';

import { driveLights, initUI, updateUI } from './ui/apple2';
import Printer from './ui/printer';
import { MouseUI } from './ui/mouse';

import DiskII from './cards/disk2';
import Parallel from './cards/parallel';
import RAMFactor from './cards/ramfactor';
import SmartPort from './cards/smartport';
import Thunderclock from './cards/thunderclock';
import Mouse from './cards/mouse';

import { Apple2 } from './apple2';
import { handleResize } from './resize';

const prefs = new Prefs();
const romVersion = prefs.readPref('computer_type2e');
let enhanced = false;
let rom: string;
let characterRom: string;
let keyboardLayout: string;

switch (romVersion) {
    case 'apple2e':
        rom = 'apple2e';
        characterRom = 'apple2e_char';
        keyboardLayout = 'apple2e';
        break;
    case 'apple2rm':
        rom = 'apple2e';
        characterRom = 'rmfont_char';
        enhanced = true;
        keyboardLayout = 'apple2e';
        break;
    case 'apple2ex':
        rom = 'apple2ex';
        characterRom = 'apple2enh_char';
        enhanced = true;
        keyboardLayout = 'apple2e';
        break;
    default:
        rom = 'apple2enh';
        characterRom = 'apple2enh_char';
        enhanced = true;
        keyboardLayout = 'apple2e';
}

const options = {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    canvas: document.querySelector<HTMLCanvasElement>('#screen')!,
    canvas2: document.querySelector<HTMLCanvasElement>('#screen2')!,
    gl: prefs.readPref('gl_canvas', 'true') === 'true',
    rom,
    characterRom,
    e: true,
    enhanced,
    tick: updateUI,
};

export const apple2 = new Apple2(options);
apple2.ready
    .then(() => {
        const io = apple2.getIO();
        const cpu = apple2.getCPU();

        const printer = new Printer('#printer-modal .paper');
        const mouseUI = new MouseUI(options.gl ? options.canvas : options.canvas2);

        const parallel = new Parallel(printer);
        const slinky = new RAMFactor(8 * 1024 * 1024);
        const disk2 = new DiskII(io, driveLights);
        const clock = new Thunderclock();
        const smartport = new SmartPort(cpu, driveLights, { block: !enhanced });
        const mouse = new Mouse(cpu, mouseUI);

        io.setSlot(1, parallel);
        io.setSlot(2, slinky);
        io.setSlot(4, mouse);
        io.setSlot(5, clock);
        io.setSlot(6, disk2);
        io.setSlot(7, smartport);

        initUI(apple2, disk2, smartport, printer, options.e, keyboardLayout);
    })
    .catch(console.error);


window.addEventListener('resize', () => handleResize());
requestAnimationFrame(() => {
    apple2.getVideoModes().smoothing(true);
    window.dispatchEvent(new Event('resize'));
});
