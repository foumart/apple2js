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

export let shouldRestart: boolean = true;

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
    constructor(private a2: Apple2) {}

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
                        label: 'Color Monitor',
                        type: BOOLEAN_OPTION,
                        defaultVal: true,
                    },
                    {
                        name: COLOR_PALETTE,
                        label: 'Composite',
                        type: SLIDER_OPTION,
                        min: 0,
                        max: 1,
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
                        label: 'Opacity: 0.5',
                        type: SLIDER_OPTION,
                        min: 0,
                        max: 1,
                        step: 0.1,
                        defaultVal: 0.5,
                    },
                    {
                        name: COMPOSITE,
                        label: 'Idealized',
                        type: BOOLEAN_OPTION,
                        defaultVal: false,
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

    setOption(name: string, value: boolean | number) {
        switch (name) {
            case SCREEN_GL:
                this.a2.switchRenderMode(value as boolean);
                shouldRestart = !shouldRestart;
                const elementIds = ["mono_screen", "palette", "show_scanlines", "scanlines_slide", "composite", "smoothing"];
                elementIds.forEach(id => {
                    if (id == "palette") {
                        this.isChecked("mono_screen").then((checked: boolean)=>{
                            this.modifyDisabledAttribute(id, shouldRestart || !checked);
                        });
                    } else if (id == "scanlines_slide") {
                        this.isChecked("show_scanlines").then((checked: boolean)=>{
                            this.modifyDisabledAttribute(id, shouldRestart || !checked);
                        });
                    } else {
                        this.modifyDisabledAttribute(id, shouldRestart);
                    }
                });
                this.getElement("options-modal-warning").then((element: HTMLElement) => {
                    const divs = element.getElementsByTagName("div");
                    divs[0].innerHTML = shouldRestart ? "*** Reload Pending ***" : "";
                });
                break;
            case SCREEN_MONO:
                const mono = !(value as boolean);
                this.a2.getVideoModes().mono(mono);
                this.modifyDisabledAttribute("palette", mono);
                this.waitForParentElement("mono_screen").then((element: HTMLElement) => {
                    element.getElementsByTagName("label")[0].innerHTML = `${this.a2.isGL() ? "Color Monitor" : "Video Card"}`;
                    this.modifyDisabledAttribute("composite", this.a2.isGL());
                });
                break;
            case COLOR_PALETTE:
                this.a2.getVideoModes().palette(value as number);
                this.waitForParentElement("palette").then((element: HTMLElement) => {
                    element.getElementsByTagName("label")[0].innerHTML = this.a2.isGL()
                        ? `${value ? "RGB" : "Composite"}`
                        : `${value ? "IIGS" : "NTSC"}`
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
        if (on) {
            document.body.classList.add('full-page');
        } else {
            document.body.classList.remove('full-page');
        }
    }
}
