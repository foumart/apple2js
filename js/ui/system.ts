import { SLIDER_OPTION, SELECT_OPTION, OptionHandler } from '../options';
import Apple2IO from '../apple2io';
import { Apple2 } from '../apple2';

export const SYSTEM_TYPE_APPLE2E = 'computer_type2e';
export const SYSTEM_TYPE_APPLE2 = 'computer_type2';
export const SYSTEM_CPU_ACCELERATED = 'accelerator_toggle';

export class System implements OptionHandler {
    constructor(
        private a2: Apple2,
        private io: Apple2IO,
        private e: boolean
    ) {}

    getOptions() {
        return [
            {
                name: 'Type',
                options: this.e
                    ? [
                          {
                              name: SYSTEM_TYPE_APPLE2E,
                              label: ' *',
                              type: SELECT_OPTION,
                              defaultVal: 'apple2enh',
                              values: [
                                  {
                                      value: 'apple2enh',
                                      name: 'Enhanced Apple //e',
                                  },
                                  {
                                      value: 'apple2e',
                                      name: 'Apple //e',
                                  },
                                  {
                                      value: 'apple2rm',
                                      name: 'Enhanced Apple //e (Reactive Micro)',
                                  },
                                  {
                                      value: 'apple2ex',
                                      name: 'Apple //e Extended Debugging',
                                  },
                              ],
                          },
                      ]
                    : [
                          {
                              name: SYSTEM_TYPE_APPLE2,
                              label: ' *',
                              type: SELECT_OPTION,
                              defaultVal: 'apple2plus',
                              values: [
                                  {
                                      value: 'apple2plus',
                                      name: 'Apple ][+',
                                  },
                                  {
                                      value: 'apple2',
                                      name: 'Autostart Apple ][',
                                  },
                                  {
                                      value: 'apple213',
                                      name: '13 Sector Apple ][',
                                  },
                                  {
                                      value: 'original',
                                      name: 'Apple ][',
                                  },
                                  {
                                      value: 'apple2j',
                                      name: 'Apple ][j+',
                                  },
                                  {
                                      value: 'apple2lc',
                                      name: 'Apple ][+ (lowercase font)',
                                  },
                                  {
                                      value: 'apple2pig',
                                      name: 'Apple ][+ (pig font)',
                                  },
                                  {
                                      value: 'pravetz82',
                                      name: 'Pravetz 82',
                                  },
                              ],
                          },
                      ],
            },
            {
                name: 'CPU Speed',
                options: [
                    {
                        name: SYSTEM_CPU_ACCELERATED,
                        label: '1 mHz',
                        type: SLIDER_OPTION,
                        min: 1,
                        max: 10,
                        step: 1,
                        defaultVal: 1,
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

    async getElement(id: string): Promise<HTMLElement> {
        const parentElement = await this.waitForParentElement(id);
        return parentElement;    
    }

    setOption(name: string, value: number | string) {
        switch (name) {
            case SYSTEM_CPU_ACCELERATED:
                {
                    const kHz = Number(value) * 1023;
                    this.io.updateKHz(kHz);

                    this.waitForParentElement("accelerator_toggle").then((element: HTMLElement) => {
                        element.getElementsByTagName("label")[0].innerHTML = Math.round(kHz/1023) + " mHz";
                    });
                }
                break;
            case SYSTEM_TYPE_APPLE2E:
                {
                    this.a2.shouldRestartType = String(value);
                    this.getElement("options-modal-warning").then((element: HTMLElement) => {
                        const divs = element.getElementsByTagName("div");
                        if (!this.a2.shouldRestart) divs[0].innerHTML = "";
                        else if (this.a2.shouldRestartType) divs[0].innerHTML = "*** Restart Pending ***";
                    });
                }
                break;
        }
    }
}
