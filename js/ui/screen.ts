import { BOOLEAN_OPTION, OptionHandler } from '../options';
import { Apple2 } from 'js/apple2';

export const SCREEN_MONO = 'mono_screen';
export const SCREEN_FULL_PAGE = 'full_page';
export const SCREEN_SCANLINE = 'show_scanlines';
export const SCREEN_GL = 'gl_canvas';

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
                        label: 'Mono Screen',
                        type: BOOLEAN_OPTION,
                        defaultVal: false,
                    },
                    {
                        name: SCREEN_SCANLINE,
                        label: 'Show Scanlines',
                        type: BOOLEAN_OPTION,
                        defaultVal: false,
                    },
                    {
                        name: SCREEN_FULL_PAGE,
                        label: 'Full Page',
                        type: BOOLEAN_OPTION,
                        defaultVal: false,
                    },
                    {
                        name: SCREEN_GL,
                        label: 'GL Renderer *',
                        type: BOOLEAN_OPTION,
                        defaultVal: true,
                    },
                ],
            },
        ];
    }

    setOption(name: string, value: boolean) {
        switch (name) {
            case SCREEN_MONO:
                this.a2.getVideoModes().mono(value);
                break;
            case SCREEN_FULL_PAGE:
                this.setFullPage(value);
                break;
            case SCREEN_SCANLINE:
                this.a2.getVideoModes().scanlines(value);
                break;
            case SCREEN_GL:
                this.a2.switchRenderMode(value);
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
