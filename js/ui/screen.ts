import { BOOLEAN_OPTION, LABEL_OPTION, OptionHandler, RADIO_OPTION, SLIDER_OPTION } from '../options';
import { Apple2 } from 'js/apple2';

export const SCREEN_FULL_PAGE = 'full_page';
export const SCREEN_SCANLINE = 'show_scanlines';
export const SCREEN_SCANLINE_SLIDE = 'scanlines_slide';
export const SCREEN_HALF_SHIFT = 'half_pixel_shift';
export const SCREEN_HALF_SHIFT_SLIDE = 'half_pixel_shift_slide';
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
            void this.modifyDisabledAttribute(SCREEN_HALF_SHIFT, this.a2.isGL());
            void this.updateHalfShiftControls();
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
                name: 'Render Mode',
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
                        name: 'monitor_type_heading',
                        label: 'Monitor type',
                        type: LABEL_OPTION,
                        defaultVal: '',
                    },
                    {
                        name: COLOR_PALETTE,
                        label: '',
                        type: RADIO_OPTION,
                        defaultVal: '0',
                        values: [
                            { name: 'CRT', value: '0' },
                            { name: 'RGB', value: '1' },
                            { name: 'GREY', value: '2' },
                            { name: 'B/W', value: '3' },
                            { name: 'MONO', value: '4' },
                        ],
                    },
                    {
                        name: SCREEN_HALF_SHIFT,
                        label: 'Half-Pixel Shift',
                        type: BOOLEAN_OPTION,
                        defaultVal: true,
                    },
                    {
                        name: SCREEN_HALF_SHIFT_SLIDE,
                        label: '',
                        type: SLIDER_OPTION,
                        min: 0,
                        max: 1,
                        step: 0.1,
                        defaultVal: 0.8,
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
        const inputElements = parentElement.querySelectorAll('input');
        inputElements.forEach((inputElement) => {
            (inputElement as HTMLInputElement).disabled = value;
        });
        const label = parentElement.getElementsByTagName('label')[0];
        if (label) {
            label.classList.toggle('options-label--disabled', value);
        }
    }

    async getElement(id: string): Promise<HTMLElement> {
        const parentElement = await this.waitForParentElement(id);
        return parentElement;    
    }

    async isChecked(id: string): Promise<boolean> {
        const parentElement = await this.waitForParentElement(id);
        const inputElement = parentElement.querySelector(
            'input[type="checkbox"]'
        ) as HTMLInputElement;
        return inputElement.checked;
    }

    async getInputValue(id: string): Promise<string> {
        const parentElement = await this.waitForParentElement(id);
        const radio = parentElement.querySelector(
            'input[type="radio"]:checked'
        ) as HTMLInputElement | null;
        if (radio) {
            return radio.value;
        }
        const inputElement = parentElement.querySelector(
            'input'
        ) as HTMLInputElement;
        return inputElement.value;
    }

    private shiftSliderToBlend(slider: number): number {
        return 1 - slider;
    }

    private async updateHalfShiftControls() {
        const disabled =
            this.a2.isGL() || !(await this.isChecked(SCREEN_HALF_SHIFT));
        void this.modifyDisabledAttribute(SCREEN_HALF_SHIFT, this.a2.isGL());
        void this.modifyDisabledAttribute(SCREEN_HALF_SHIFT_SLIDE, disabled);
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

        if (!this.a2.isGL()) {
            vm.halfPixelShift(await this.isChecked(SCREEN_HALF_SHIFT));
            vm.halfPixelShiftAmount(
                this.shiftSliderToBlend(
                    Number(await this.getInputValue(SCREEN_HALF_SHIFT_SLIDE))
                )
            );
        }

        void this.modifyDisabledAttribute(SCREEN_SCANLINE_SLIDE, !scanlines);
        void this.updateHalfShiftControls();
    }

    setOption(name: string, value: boolean | number | string) {
        switch (name) {
            case SCREEN_GL:
                if (this.a2.switchRenderMode(value === 'true' || value === true)) {
                    void this.reapplyScreenOptions();
                }
                void this.updateHalfShiftControls();
                break;
            case COLOR_PALETTE:
                this.applyPalette(Number(value));
                break;
            case SCREEN_SCANLINE:
                const vm = value as boolean;
                this.a2.getVideoModes().scanlines(vm);
                this.modifyDisabledAttribute("scanlines_slide", !vm);
                this.repaint();
                break;
            case SCREEN_HALF_SHIFT:
                if (!this.a2.isGL()) {
                    this.a2.getVideoModes().halfPixelShift(value as boolean);
                    void this.updateHalfShiftControls();
                    this.repaint();
                }
                break;
            case SCREEN_HALF_SHIFT_SLIDE:
                if (!this.a2.isGL()) {
                    this.a2
                        .getVideoModes()
                        .halfPixelShiftAmount(
                            this.shiftSliderToBlend(value as number)
                        );
                    this.repaint();
                    void this.waitForParentElement(SCREEN_HALF_SHIFT_SLIDE).then(
                        (element: HTMLElement) => {
                            element.getElementsByTagName('label')[0].innerHTML =
                                '' + value;//Shift:
                        }
                    );
                }
                break;
            case SCREEN_SCANLINE_SLIDE:
                this.a2.getVideoModes().opacity(value as number);
                this.repaint();
                this.waitForParentElement("scanlines_slide").then((element: HTMLElement) => {
                    element.getElementsByTagName("label")[0].innerHTML = "" + value;//Opacity: 
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
