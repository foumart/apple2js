import Apple2IO from './apple2io';
import {
    HiresPage,
    LoresPage,
    VideoModes,
    VideoModesState,
} from './videomodes';
import { HiresPage2D, LoresPage2D, VideoModes2D } from './canvas';
import { HiresPageGL, LoresPageGL, VideoModesGL } from './gl';
import ROM from './roms/rom';
import { Apple2IOState } from './apple2io';
import {
    CPU6502,
    CpuState,
    Debugger,
    DebuggerContainer,
    FLAVOR_6502,
    FLAVOR_ROCKWELL_65C02,
} from '@whscullin/cpu6502';
import MMU, { MMUState } from './mmu';
import RAM, { RAMState } from './ram';

import SYMBOLS from './symbols';

import { ReadonlyUint8Array, Restorable, rom } from './types';
import { processGamepad } from './ui/gamepad';

export interface Apple2Options {
    characterRom: string;
    enhanced: boolean;
    e: boolean;
    gl: boolean;
    rom: string;
    canvas: HTMLCanvasElement;
    canvas2: HTMLCanvasElement;
    tick: () => void;
}

export interface Stats {
    cycles: number;
    frames: number;
    renderedFrames: number;
}

export interface State {
    cpu: CpuState;
    vm: VideoModesState;
    io: Apple2IOState;
    mmu: MMUState | undefined;
    ram: RAMState[] | undefined;
}

export interface VideoModeMix {
    vm: VideoModes;
    gr: LoresPage;
    gr2: LoresPage;
    hgr: HiresPage;
    hgr2: HiresPage;
}

export class Apple2 implements Restorable<State>, DebuggerContainer {
    private paused = false;

    private theDebugger: Debugger | undefined;

    private runTimer: number | null = null;
    private runAnimationFrame: number | null = null;
    private cpu: CPU6502;

    private GL: VideoModeMix;
    private CV: VideoModeMix;

    private gr: LoresPage;
    private gr2: LoresPage;
    private hgr: HiresPage;
    private hgr2: HiresPage;
    private vm: VideoModes;

    private io: Apple2IO;
    private mmu: MMU | undefined;
    private ram: RAM[] | undefined;
    private characterRom: rom;
    private rom: ROM;

    private tick: () => void;

    private stats: Stats = {
        cycles: 0,
        frames: 0,
        renderedFrames: 0,
    };

    public ready: Promise<void>;
    private _options: Apple2Options;
    private _oldVm: VideoModes;
    private initialized: boolean = false;

    constructor(options: Apple2Options) {
        this.ready = this.init(options);
        this.ready.then(() => {
            //this.initialized = true;
        });
    }

    async init(options: Apple2Options) {
        this._options = options;
        const romImportPromise = import(
            `./roms/system/${options.rom}`
        ) as Promise<{
            default: new () => ROM;
        }>;
        const characterRomImportPromise = import(
            `./roms/character/${options.characterRom}`
        ) as Promise<{ default: ReadonlyUint8Array }>;

        this.cpu = new CPU6502({
            flavor: options.enhanced ? FLAVOR_ROCKWELL_65C02 : FLAVOR_6502,
        });

        this.createVideoMode(options);

        const [{ default: Apple2ROM }, { default: characterRom }] =
            await Promise.all([
                romImportPromise,
                characterRomImportPromise,
                this.vm.ready,
            ]);

        this.rom = new Apple2ROM();
        this.characterRom = characterRom;

        this.ram = [new RAM(0x00, 0xbf)];
        if (options.e) {
            this.ram.push(new RAM(0x00, 0xbf));
        }

        this.createVideoModeLink(options);

        this.io = new Apple2IO(this.cpu, this.vm);
        this.tick = options.tick;

        if (options.e) {
            this.mmu = new MMU(
                this.cpu,
                this._options.gl ? this.GL : this.CV,
                this.io,
                this.ram,
                this.rom
            );
            this.cpu.addPageHandler(this.mmu);
        } else {
            this.cpu.addPageHandler(this.ram[0]);
            this.cpu.addPageHandler(this.gr);
            this.cpu.addPageHandler(this.gr2);
            this.cpu.addPageHandler(this.hgr);
            this.cpu.addPageHandler(this.hgr2);
            this.cpu.addPageHandler(this.io);
            this.cpu.addPageHandler(this.rom);
        }
    }

    createVideoMode(options: Apple2Options) {
        const VideoModes = options.gl ? VideoModesGL : VideoModes2D;
        this.vm = new VideoModes(options.gl ? options.canvas : options.canvas2, options.e);
    }

    createVideoModeLink(options: Apple2Options) {
        if (options.gl && this.GL || !options.gl && this.CV) return;

        const LoresPage = options.gl ? LoresPageGL : LoresPage2D;
        const HiresPage = options.gl ? HiresPageGL : HiresPage2D;
        this.gr = new LoresPage(
            this.vm,
            1,
            this.ram as RAM[],
            this.characterRom,
            options.e
        );
        this.gr2 = new LoresPage(
            this.vm,
            2,
            this.ram as RAM[],
            this.characterRom,
            options.e
        );
        this.hgr = new HiresPage(this.vm, 1, this.ram as RAM[]);
        this.hgr2 = new HiresPage(this.vm, 2, this.ram as RAM[]);

        if (options.gl) {
            this.GL = {
                vm: this.vm,
                gr: this.gr,
                gr2: this.gr2,
                hgr: this.hgr,
                hgr2: this.hgr2,
            };
        } else {
            this.CV = {
                vm: this.vm,
                gr: this.gr,
                gr2: this.gr2,
                hgr: this.hgr,
                hgr2: this.hgr2,
            };
        }
    }

    /**
     * Runs the emulator. If the emulator is already running, this does
     * nothing. When this function exits either `runTimer` or
     * `runAnimationFrame` will be non-null.
     */
    run() {
        this.paused = false;
        if (this.runTimer || this.runAnimationFrame) {
            return; // already running
        }

        this.theDebugger = new Debugger(this.cpu, this);
        this.theDebugger.addSymbols(SYMBOLS);

        const interval = 30;

        let now,
            last = Date.now();
        const runFn = () => {
            const kHz = this.io.getKHz();
            now = Date.now();

            const stepMax = kHz * interval;
            let step = (now - last) * kHz;
            last = now;
            if (step > stepMax) {
                step = stepMax;
            }

            if (this.theDebugger) {
                this.theDebugger.stepCycles(step);
            } else {
                this.cpu.stepCycles(step);
            }
            if (this.mmu) {
                this.mmu.resetVB();
            }
            if (this.io.annunciator(0)) {
                const imageData = this.io.blit();
                if (imageData) {
                    this.vm.blit(imageData);
                    this.stats.renderedFrames++;
                }
            } else {
                if (this.vm.blit()) {
                    this.stats.renderedFrames++;
                }
            }
            this.stats.cycles = this.cpu.getCycles();
            this.stats.frames++;
            this.io.tick();
            this.tick();
            processGamepad(this.io);

            if (!this.paused && requestAnimationFrame) {
                this.runAnimationFrame = requestAnimationFrame(runFn);
            }
        };
        if (requestAnimationFrame) {
            this.runAnimationFrame = requestAnimationFrame(runFn);
        } else {
            this.runTimer = window.setInterval(runFn, interval);
        }
    }

    stop() {
        this.paused = true;
        if (this.runTimer) {
            clearInterval(this.runTimer);
        }
        if (this.runAnimationFrame) {
            cancelAnimationFrame(this.runAnimationFrame);
        }
        this.runTimer = null;
        this.runAnimationFrame = null;
    }

    isRunning() {
        return !this.paused;
    }

    getState(): State {
        const state: State = {
            cpu: this.cpu.getState(),
            vm: this.vm.getState(),
            io: this.io.getState(),
            mmu: this.mmu?.getState(),
            ram: this.ram?.map((bank) => bank.getState()),
        };

        return state;
    }

    setState(state: State) {
        this.cpu.setState(state.cpu);
        this.vm.setState(state.vm);
        this.io.setState(state.io);
        if (this.mmu && state.mmu) {
            this.mmu.setState(state.mmu);
        }
        if (this.ram) {
            this.ram.forEach((bank, idx) => {
                if (state.ram) {
                    bank.setState(state.ram[idx]);
                }
            });
        }
    }

    reset() {
        this.cpu.reset();
    }

    getStats(): Stats {
        return this.stats;
    }

    getCPU() {
        return this.cpu;
    }

    getIO() {
        return this.io;
    }

    getMMU() {
        return this.mmu;
    }

    getROM() {
        return this.rom;
    }

    getVideoModes() {
        return this.vm;
    }

    getDebugger() {
        return this.theDebugger;
    }

    isGL() {
        return this._options.gl;
    }

    switchRenderMode(value: boolean) {
        if (!this.initialized) {
            this.initialized = true;
            return;
        };

        this._options.gl = value;

        console.log("Instant render mode switch not implemented yet!");
        if (!this._oldVm) return;
        //

        //this._oldVm = this.vm;
        this.createVideoMode(this._options);
        this.createVideoModeLink(this._options);

        this.io.switchVideoMode(this._options.gl ? this.GL : this.CV);

        if (this.mmu) {
            this.mmu.switchVideoMode(this._options.gl ? this.GL : this.CV)
        } else {
            this.cpu.addPageHandler(this.gr);
            this.cpu.addPageHandler(this.gr2);
            this.cpu.addPageHandler(this.hgr);
            this.cpu.addPageHandler(this.hgr2);
        }
    }
}
