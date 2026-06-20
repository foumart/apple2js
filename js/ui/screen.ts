import { BOOLEAN_OPTION, OptionHandler, RADIO_OPTION, SLIDER_OPTION } from '../options';
import { Apple2 } from 'js/apple2';

export const SCREEN_FULL_PAGE = 'full_page';
export const SCREEN_SCANLINE = 'show_scanlines';
export const SCREEN_SCANLINE_SLIDE = 'scanlines_slide';
export const SCREEN_GL = 'gl_canvas';
export const SCREEN_SMOOTH = 'smoothing';
export const COLOR_PALETTE = 'palette';

declare global {
    interface Document {
        webkitCancelFullScreen: () => void;
        webkitIsFullScreen: boolean;
    }
    interface Element {
        webkitRequestFullScreen: (options?: unknown) => void;
    }
}
export class Screen implements OptionHandler {
    constructor(private a2: Apple2) {
        // If WebGL isn't available, the renderer is locked to 2D; disable the
        // toggle so the user can't pick an unsupported mode.
        void this.a2.ready.then(() => {
            if (!this.a2.isGLAvailable()) {
                void this.modifyDisabledAttribute(SCREEN_GL, true);
            }
        });
    }

    enterFullScreen = () => {
        const elem = document.getElementById('screen')!;
        if (document.fullscreenEnabled) {
            if (document.fullscreenElement) {
                void document.exitFullscreen();
            } else {
                void elem.requestFullscreen();
            }
        } else if (elem.webkitRequestFullScreen) {
            if (document.webkitIsFullScreen) {
                document.webkitCancelFullScreen();
            } else {
                elem.webkitRequestFullScreen();
            }
        }
    };

    getOptions() {
        return [
            {
                name: 'Screen',
                options: [
                    {
                        name: SCREEN_GL,
                        label: '',
                        type: RADIO_OPTION,
                        defaultVal: 'true',
                        values: [
                            { name: 'GL Renderer', value: 'true' },
                            { name: 'Canvas', value: 'false' },
                        ],
                    },
                    {
                        name: COLOR_PALETTE,
                        label: '',
                        type: SLIDER_OPTION,
                        min: 0,
                        max: 4,
                        step: 1,
                        defaultVal: 0,
                    },
                    {
                        name: SCREEN_SCANLINE,
                        label: 'Scanlines',
                        type: BOOLEAN_OPTION,
                        defaultVal: true,
                    },
                    {
                        name: SCREEN_SCANLINE_SLIDE,
                        label: '',
                        type: SLIDER_OPTION,
                        min: 0,
                        max: 1,
                        step: 0.1,
                        defaultVal: 0.5,
                    },
                    {
                        name: SCREEN_SMOOTH,
                        label: 'Smoothing',
                        type: BOOLEAN_OPTION,
                        defaultVal: true,
                    },
                    {
                        name: SCREEN_FULL_PAGE,
                        label: 'Full Screen',
                        type: BOOLEAN_OPTION,
                        defaultVal: false,
                    },
                ],
            },
        ];
    }

    async waitForParentElement(id: string): Promise<HTMLElement> {
        while (true) {
            const parentElement = document.getElementById(id)?.parentElement as HTMLElement;
            if (parentElement) {
                return parentElement;
            }
            await new Promise(resolve => requestAnimationFrame(resolve));
        }
    }

    async modifyDisabledAttribute(id: string, value: boolean) {
        const parentElement = await this.waitForParentElement(id);
        const inputElement = parentElement.querySelector("input") as HTMLInputElement;
        if (inputElement) {
            inputElement.disabled = value;
            const label = inputElement.parentElement?.getElementsByTagName("label")[0];
            if (label) label.style.color = value ? "grey" : "black";
        }
    }

    async getElement(id: string): Promise<HTMLElement> {
        const parentElement = await this.waitForParentElement(id);
        return parentElement;    
    }

    async isChecked(id: string): Promise<boolean> {
        const parentElement = await this.waitForParentElement(id);
        const inputElement = parentElement.querySelector("input") as HTMLInputElement;
        return inputElement.checked;
    }

    async getInputValue(id: string): Promise<string> {
        const parentElement = await this.waitForParentElement(id);
        const inputElement = parentElement.querySelector("input") as HTMLInputElement;
        return inputElement.value;
    }

    private paletteLabel(value: number): string {
        if (value === 4) {
            return 'MONO';
        }
        if (value === 3) {
            return 'B&W';
        }
        if (value === 2) {
            return 'GREY';
        }
        if (value === 1) {
            return 'RGB';
        }
        return 'CRT';
    }

    private applyPalette(value: number) {
        const vm = this.a2.getVideoModes();
        const isMono = value === 4;

        vm.mono(isMono);
        if (!isMono) {
            if (this.a2.isGL()) {
                vm.palette(value);
            } else {
                vm.composite(value === 0 || value === 3);
                vm.palette(value);
            }
        }
        this.repaint();
        void this.waitForParentElement(COLOR_PALETTE).then((element: HTMLElement) => {
            element.getElementsByTagName('label')[0].innerHTML =
                this.paletteLabel(value);
        });
    }

    // force a one-shot render when paused, while running the run loop repaints
    private repaint() {
        if (this.a2.isRunning()) {
            return;
        }
        this.a2.getVideoModes().refresh();
        this.a2.renderFrame();
    }

    // After a live renderer switch, the newly activated VideoModes starts with
    // default display settings. Re-apply the current UI option values (read
    // from the option inputs, which mirror the stored prefs) and refresh the
    // labels/controls that depend on which renderer is active.
    private async reapplyScreenOptions() {
        const vm = this.a2.getVideoModes();

        // applyPalette handles the renderer-specific color/composite mapping.
        this.applyPalette(Number(await this.getInputValue(COLOR_PALETTE)));

        const scanlines = await this.isChecked(SCREEN_SCANLINE);
        vm.scanlines(scanlines);
        vm.opacity(Number(await this.getInputValue(SCREEN_SCANLINE_SLIDE)));

        vm.smoothing(await this.isChecked(SCREEN_SMOOTH));

        void this.modifyDisabledAttribute(SCREEN_SCANLINE_SLIDE, !scanlines);
    }

    setOption(name: string, value: boolean | number | string) {
        switch (name) {
            case SCREEN_GL:
                if (this.a2.switchRenderMode(value === 'true' || value === true)) {
                    // Renderer changed live; re-sync the display options onto
                    // the newly activated renderer and refresh dependent labels.
                    void this.reapplyScreenOptions();
                }
                break;
            case COLOR_PALETTE:
                this.applyPalette(value as number);
                break;
            case SCREEN_SCANLINE:
                const vm = value as boolean;
                this.a2.getVideoModes().scanlines(vm);
                this.modifyDisabledAttribute("scanlines_slide", !vm);
                this.repaint();
                break;
            case SCREEN_SCANLINE_SLIDE:
                this.a2.getVideoModes().opacity(value as number);
                this.repaint();
                this.waitForParentElement("scanlines_slide").then((element: HTMLElement) => {
                    element.getElementsByTagName("label")[0].innerHTML = "Opacity: " + value;
                });
                break;
            case SCREEN_SMOOTH:
                this.a2.getVideoModes().smoothing(value as boolean);
                this.repaint();
                break;
            case SCREEN_FULL_PAGE:
                this.setFullPage(value as boolean);
                requestAnimationFrame(() => {
                    window.dispatchEvent(new Event('resize'));
                });
                break;
        }
    }

    private setFullPage(on: boolean) {
        // @ts-ignore
        const classList = this.a2._options.embedded ? 'embedded-page' : 'full-page';

        if (on) {
            document.body.classList.add(classList);
        } else {
            document.body.classList.remove(classList);
        }
    }
}
