import { BOOLEAN_OPTION, OptionHandler, SLIDER_OPTION } from '../options';
import { Apple2 } from 'js/apple2';

export const SCREEN_MONO = 'mono_screen';
export const SCREEN_FULL_PAGE = 'full_page';
export const SCREEN_SCANLINE = 'show_scanlines';
export const SCREEN_SCANLINE_SLIDE = 'scanlines_slide';
export const SCREEN_GL = 'gl_canvas';
export const SCREEN_SMOOTH = 'smoothing';
export const COMPOSITE = 'composite';
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
                        label: 'GL Renderer *',
                        type: BOOLEAN_OPTION,
                        defaultVal: true,
                    },
                    {
                        name: SCREEN_MONO,
                        label: 'Color Display',
                        type: BOOLEAN_OPTION,
                        defaultVal: true,
                    },
                    {
                        name: COLOR_PALETTE,
                        label: '',
                        type: SLIDER_OPTION,
                        min: 0,
                        max: 3,
                        step: 1,
                        defaultVal: 0,
                    },
                    {
                        name: COMPOSITE,
                        label: 'Composite Idealized',
                        type: BOOLEAN_OPTION,
                        defaultVal: false,
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

    // After a live renderer switch, the newly activated VideoModes starts with
    // default display settings. Re-apply the current UI option values (read
    // from the option inputs, which mirror the stored prefs) and refresh the
    // labels/controls that depend on which renderer is active.
    private async reapplyScreenOptions() {
        const vm = this.a2.getVideoModes();
        const isGL = this.a2.isGL();

        const mono = !(await this.isChecked(SCREEN_MONO));
        vm.mono(mono);

        const paletteVal = Number(await this.getInputValue(COLOR_PALETTE));
        if (!mono) {
            vm.palette(paletteVal);
        }

        const scanlines = await this.isChecked(SCREEN_SCANLINE);
        vm.scanlines(scanlines);
        vm.opacity(Number(await this.getInputValue(SCREEN_SCANLINE_SLIDE)));

        vm.smoothing(await this.isChecked(SCREEN_SMOOTH));

        if (!isGL) {
            vm.composite(await this.isChecked(COMPOSITE));
        }

        void this.waitForParentElement(SCREEN_MONO).then((element: HTMLElement) => {
            element.getElementsByTagName("label")[0].innerHTML = `Color ${isGL ? "Monitor" : "Video Card"}`;
        });
        void this.waitForParentElement(COLOR_PALETTE).then((element: HTMLElement) => {
            element.getElementsByTagName("label")[0].innerHTML = isGL
                ? `${paletteVal == 3 ? "B/W" : paletteVal == 2 ? "GREY" : paletteVal ? "RGB" : "CRT"}`
                : `${paletteVal == 3 ? "4 BIT" : paletteVal == 2 ? "GREY" : paletteVal ? "IIGS" : "NTSC"}`;
        });

        void this.modifyDisabledAttribute(COLOR_PALETTE, mono);
        void this.modifyDisabledAttribute(COMPOSITE, mono || isGL);
        void this.modifyDisabledAttribute(SCREEN_SCANLINE_SLIDE, !scanlines);
    }

    setOption(name: string, value: boolean | number) {
        switch (name) {
            case SCREEN_GL:
                if (this.a2.switchRenderMode(value as boolean)) {
                    // Renderer changed live; re-sync the display options onto
                    // the newly activated renderer and refresh dependent labels.
                    void this.reapplyScreenOptions();
                }
                break;
            case SCREEN_MONO:
                const mono = !(value as boolean);
                this.a2.getVideoModes().mono(mono);
                this.modifyDisabledAttribute("palette", mono);
                this.modifyDisabledAttribute("composite", mono);
                this.waitForParentElement("mono_screen").then((element: HTMLElement) => {
                    element.getElementsByTagName("label")[0].innerHTML = `Color ${this.a2.isGL() ? "Monitor" : "Video Card"}`;
                    //this.modifyDisabledAttribute("composite", this.a2.isGL());
                });
                break;
            case COLOR_PALETTE:
                this.a2.getVideoModes().palette(value as number);
                this.waitForParentElement("palette").then((element: HTMLElement) => {
                    element.getElementsByTagName("label")[0].innerHTML = this.a2.isGL()
                        ? `${value == 3 ? "B/W" : value == 2 ? "GREY" : value ? "RGB" : "CRT"}`
                        : `${value == 3 ? "4 BIT" : value == 2 ? "GREY" : value ? "IIGS" : "NTSC"}`
                });
                break;
            case SCREEN_SCANLINE:
                const vm = value as boolean;
                this.a2.getVideoModes().scanlines(vm);
                this.modifyDisabledAttribute("scanlines_slide", !vm);
                break;
            case SCREEN_SCANLINE_SLIDE:
                this.a2.getVideoModes().opacity(value as number);
                this.waitForParentElement("scanlines_slide").then((element: HTMLElement) => {
                    element.getElementsByTagName("label")[0].innerHTML = "Opacity: " + value;
                });
                break;
            case SCREEN_SMOOTH:
                this.a2.getVideoModes().smoothing(value as boolean);
                break;
            case COMPOSITE:
                this.a2.getVideoModes().composite(value as boolean);
                // TODO
                //this.modifyDisabledAttribute("composite", true);
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
