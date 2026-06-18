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

// Minimal interface for input handlers (e.g. the mouse UI) that need to be
// re-pointed at a different canvas element when the active renderer changes.
export interface CanvasRebindable {
    setCanvas(canvas: HTMLCanvasElement): void;
}

const PAUSED_BODY_CLASS = 'apple2-paused';

export class Apple2 implements Restorable<State>, DebuggerContainer {
    private paused = false;

    private theDebugger: Debugger | undefined;

    private runTimer: number | null = null;
    private runAnimationFrame: number | null = null;
    private cpu: CPU6502;

    private GL: VideoModeMix | undefined;
    private CV: VideoModeMix;

    private glVm: VideoModes | undefined;
    private cvVm: VideoModes;
    private glAvailable = true;
    private mouseUI: CanvasRebindable | undefined;

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
    private initialized: boolean = false;

    public _shouldRestartTypeDefault: string;
    public _shouldRestartType: string = "apple2enh";
    public _shouldRestartScreen: boolean = false;

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

        // Build both renderer backends up front so we can switch between them on the fly.
        // The 2D backend is always available (and is the fallback when WebGL is missing);
        // the GL backend may fail to initialize.
        this.createVideoModes(options);

        const [{ default: Apple2ROM }, { default: characterRom }] =
            await Promise.all([
                romImportPromise,
                characterRomImportPromise,
                this.glVm?.ready ?? Promise.resolve(),
                this.cvVm.ready,
            ]);

        this.rom = new Apple2ROM();
        this.characterRom = characterRom;

        this.ram = [new RAM(0x00, 0xbf)];
        if (options.e) {
            this.ram.push(new RAM(0x00, 0xbf));
        }

        // Both page stacks bind to the *same* RAM (via shared subarray views),
        // so memory stays consistent regardless of which renderer is active.
        this.createVideoModeLinks(options);
        this.activateVideoMode(this._options.gl);

        this.io = new Apple2IO(this.cpu, this.vm);
        this.tick = options.tick;

        if (options.e) {
            this.mmu = new MMU(
                this.cpu,
                this._options.gl ? (this.GL as VideoModeMix) : this.CV,
                this.io,
                this.ram,
                this.rom
            );
            this.cpu.addPageHandler(this.mmu);
        } else {
            this.cpu.addPageHandler(this.ram[0]);
            this.addVideoPageHandlers();
            this.cpu.addPageHandler(this.io);
            this.cpu.addPageHandler(this.rom);
        }
    }

    // Construct the video mode backends (canvas contexts). The 2D backend is
    // always created; the GL backend is attempted and may be unavailable on
    // machines lacking the required WebGL extensions. If GL is requested but
    // unavailable we fall back to 2D.
    private createVideoModes(options: Apple2Options) {
        this.cvVm = new VideoModes2D(options.canvas2, options.e);

        try {
            this.glVm = new VideoModesGL(options.canvas, options.e);
            this.glAvailable = true;
        } catch (e) {
            this.glVm = undefined;
            this.glAvailable = false;
            console.log(e);
            if (options.gl) {
                this._options.gl = false;
            }
        }

        this.vm = this._options.gl && this.glVm ? this.glVm : this.cvVm;
    }

    private createMix(
        vm: VideoModes,
        gl: boolean,
        options: Apple2Options
    ): VideoModeMix {
        const LoresPage = gl ? LoresPageGL : LoresPage2D;
        const HiresPage = gl ? HiresPageGL : HiresPage2D;
        const gr = new LoresPage(
            vm,
            1,
            this.ram as RAM[],
            this.characterRom,
            options.e
        );
        const gr2 = new LoresPage(
            vm,
            2,
            this.ram as RAM[],
            this.characterRom,
            options.e
        );
        const hgr = new HiresPage(vm, 1, this.ram as RAM[]);
        const hgr2 = new HiresPage(vm, 2, this.ram as RAM[]);
        return { vm, gr, gr2, hgr, hgr2 };
    }

    private createVideoModeLinks(options: Apple2Options) {
        this.CV = this.createMix(this.cvVm, false, options);
        this.GL = this.glVm
            ? this.createMix(this.glVm, true, options)
            : undefined;
    }

    private activateVideoMode(gl: boolean) {
        const mix = gl && this.GL ? this.GL : this.CV;
        this.vm = mix.vm;
        this.gr = mix.gr;
        this.gr2 = mix.gr2;
        this.hgr = mix.hgr;
        this.hgr2 = mix.hgr2;
    }

    private addVideoPageHandlers() {
        this.cpu.addPageHandler(this.gr);
        this.cpu.addPageHandler(this.gr2);
        this.cpu.addPageHandler(this.hgr);
        this.cpu.addPageHandler(this.hgr2);
    }

    private syncPausedBodyClass() {
        if (typeof document !== 'undefined') {
            document.body.classList.toggle(PAUSED_BODY_CLASS, this.paused);
        }
    }

    // Runs the emulator. If the emulator is already running, this does nothing.
    // When this function exits either `runTimer` or `runAnimationFrame` will be non-null.
    run() {
        this.paused = false;
        this.syncPausedBodyClass();
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
            this.renderFrame();
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

     // Render a single frame from the active renderer. Used by the run loop and
     // for one-shot repaints (e.g. after a live renderer switch or a display
     // option change while paused)
    renderFrame() {
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
    }

    stop() {
        this.paused = true;
        this.syncPausedBodyClass();
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

    get shouldRestartType() {
        return this._shouldRestartType;
    }
    get shouldRestartScreen() {
        return this._shouldRestartScreen;
    }
    get shouldRestart() {
        return this._shouldRestartType != this._shouldRestartTypeDefault || this._shouldRestartScreen;
    }
    set shouldRestartTypeDefault(value: string) {
        this._shouldRestartTypeDefault = value;
    }
    set shouldRestartType(value: string) {
        if (!this._shouldRestartTypeDefault) {
            this._shouldRestartTypeDefault = value;
        }
        this._shouldRestartType = value;
    }
    set shouldRestartScreen(value: boolean) {
        this._shouldRestartScreen = value;
    }

    isGLAvailable() {
        return this.glAvailable;
    }

    setMouseUI(mouseUI: CanvasRebindable) {
        this.mouseUI = mouseUI;
    }

    // Switch the active renderer (WebGL <-> 2D) live, without restarting the
    // emulator. Both renderer stacks share the same RAM, so only the rendered
    // representation needs to be rebuilt. All video soft-switch flags are
    // transferred to the newly activated renderer.
    switchRenderMode(value: boolean): boolean {
        // The options layer applies the stored preference once at startup; the
        // renderer already matches it, so swallow that initial invocation.
        if (!this.initialized) {
            this.initialized = true;
            return false;
        }

        // Can't enable GL when it isn't available, and ignore no-op switches.
        if (value && !this.GL) {
            return false;
        }
        if (value === this._options.gl) {
            return false;
        }

        const wasRunning = this.isRunning();
        if (wasRunning) {
            this.stop();
        }

        // Capture the complete video state so every soft switch (text, mixed,
        // hires, page, 80col, altchar, an3) carries over to the new renderer.
        const vmState = this.vm.getState();

        this._options.gl = value;
        const mix = value ? (this.GL as VideoModeMix) : this.CV;

        this.vm = mix.vm;
        this.gr = mix.gr;
        this.gr2 = mix.gr2;
        this.hgr = mix.hgr;
        this.hgr2 = mix.hgr2;

        this.io.switchVideoMode(mix);
        if (this.mmu) {
            this.mmu.switchVideoMode(mix);
        } else {
            this.addVideoPageHandlers();
        }

        this.vm.setState(vmState);

        this.swapCanvas(value);
        this.vm.refresh();

        // Paint the newly activated renderer immediately. While running the run
        // loop would repaint anyway, but when paused nothing else would, leaving
        // the freshly-shown canvas blank.
        this.renderFrame();

        if (wasRunning) {
            this.run();
        }

        return true;
    }

    private swapCanvas(gl: boolean) {
        const active = gl ? this._options.canvas : this._options.canvas2;
        const inactive = gl ? this._options.canvas2 : this._options.canvas;
        inactive.style.display = 'none';
        active.style.display = '';
        this.mouseUI?.setCanvas(active);
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new Event('resize'));
        }
    }
}
