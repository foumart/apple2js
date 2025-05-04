import { BOOLEAN_OPTION, OptionHandler, SLIDER_OPTION } from '../options';
import { Apple2 } from 'js/apple2';

export const SCREEN_MONO = 'mono_screen';
export const SCREEN_FULL_PAGE = 'full_page';
export const SCREEN_SCANLINE = 'show_scanlines';
export const SCREEN_SCANLINE_SLIDE = 'scanlines_slide';
export const SCREEN_GL = 'gl_canvas';
export const SCREEN_SMOOTH = 'smoothing';

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
                        name: SCREEN_MONO,
                        label: 'Monochrome Screen',
                        type: BOOLEAN_OPTION,
                        defaultVal: false,
                    },
                    {
                        name: SCREEN_SCANLINE,
                        label: 'Scanlines',
                        type: BOOLEAN_OPTION,
                        defaultVal: false,
                    },
                    {
                        name: SCREEN_SCANLINE_SLIDE,
                        label: 'opacity',
                        type: SLIDER_OPTION,
                        min: 0,
                        max: 1,
                        step: 0.1,
                        defaultVal: 0.5,
                    },
                    {
                        name: SCREEN_GL,
                        label: 'GL Renderer *',
                        type: BOOLEAN_OPTION,
                        defaultVal: true,
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

    setOption(name: string, value: boolean | number) {
        switch (name) {
            case SCREEN_FULL_PAGE:
                this.setFullPage(value as boolean);
                requestAnimationFrame(() => {
                    window.dispatchEvent(new Event('resize'));
                });
                break;
            case SCREEN_MONO:
                this.a2.getVideoModes().mono(value as boolean);
                break;
            case SCREEN_SCANLINE:
                this.a2.getVideoModes().scanlines(value as boolean);
                break;
            case SCREEN_SCANLINE_SLIDE:
                this.a2.getVideoModes().opacity(value as number);
                break;
            case SCREEN_GL:
                this.a2.switchRenderMode(value as boolean);
                break;
            case SCREEN_SMOOTH:
                this.a2.getVideoModes().smoothing(value as boolean);
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
