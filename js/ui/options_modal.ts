import MicroModal from 'micromodal';
import {
    BOOLEAN_OPTION,
    SELECT_OPTION,
    RADIO_OPTION,
    Option,
    OptionSection,
    Options,
    SelectOption,
    RadioOption,
    SLIDER_OPTION,
    SliderOption,
} from '../options';

type OptionsPanelId = 'screen' | 'audio' | 'joystick' | 'system';

const SECTION_PANEL: Record<string, OptionsPanelId> = {
    Screen: 'screen',
    Audio: 'audio',
    Joystick: 'joystick',
    Type: 'system',
    'CPU Speed': 'system',
};

export class OptionsModal {
    constructor(private options: Options) {}

    private createPanel(id: OptionsPanelId): HTMLElement {
        const panel = document.createElement('div');
        panel.className = `options-panel options-panel--${id}`;
        return panel;
    }

    private createPanelsGrid(): Record<OptionsPanelId, HTMLElement> {
        const grid = document.createElement('div');
        grid.className = 'options-panels';

        const panels: Record<OptionsPanelId, HTMLElement> = {
            screen: this.createPanel('screen'),
            audio: this.createPanel('audio'),
            joystick: this.createPanel('joystick'),
            system: this.createPanel('system'),
        };

        for (const panel of Object.values(panels)) {
            grid.appendChild(panel);
        }

        const content = document.querySelector('#options-modal-content');
        content?.appendChild(grid);

        return panels;
    }

    private renderSection(section: OptionSection): HTMLElement {
        const { name, options } = section;
        const block = document.createElement('div');
        block.className = 'options-section';

        const header = document.createElement('h3');
        header.textContent = name;
        block.appendChild(header);

        const list = document.createElement('ul');
        for (const option of options) {
            list.appendChild(this.renderOption(option));
        }
        block.appendChild(list);

        return block;
    }

    private renderOption(option: Option): HTMLLIElement {
        const { name, label, type } = option;
        const onInput = (evt: InputEvent & { target: HTMLInputElement }) => {
            if (
                ['accelerator_toggle', 'palette', 'scanlines_slide'].includes(
                    evt.target.id
                )
            ) {
                this.options.setOption(name, Number(evt.target.value));
            }
        };
        const onChange = (evt: InputEvent & { target: HTMLInputElement }) => {
            const { target } = evt;
            switch (type) {
                case BOOLEAN_OPTION:
                    this.options.setOption(name, target.checked);
                    break;
                default:
                    this.options.setOption(name, target.value);
            }
        };

        const listItem = document.createElement('li');

        let element: HTMLElement;
        switch (type) {
            case BOOLEAN_OPTION:
                {
                    const inputElement = document.createElement('input');
                    const checked = this.options.getOption(name) as boolean;
                    inputElement.setAttribute('type', 'checkbox');
                    inputElement.checked = checked;
                    element = inputElement;
                }
                break;
            case SELECT_OPTION:
                {
                    const selectOption = option as SelectOption;
                    const selectElement = document.createElement('select');
                    const selected = this.options.getOption(name) as string;
                    for (const value of selectOption.values) {
                        const optionElement = document.createElement('option');
                        optionElement.value = value.value;
                        optionElement.textContent = value.name;
                        optionElement.selected = value.value === selected;
                        selectElement.appendChild(optionElement);
                    }
                    element = selectElement;
                }
                break;
            case RADIO_OPTION:
                {
                    const radioOption = option as RadioOption;
                    const selected = this.options.getOption(name) as string;
                    const container = document.createElement('span');
                    container.classList.add('radio-group');
                    for (const value of radioOption.values) {
                        const radioElement = document.createElement('input');
                        radioElement.setAttribute('type', 'radio');
                        radioElement.setAttribute('name', name);
                        radioElement.value = value.value;
                        radioElement.checked = value.value === String(selected);
                        const radioLabel = document.createElement('label');
                        radioLabel.textContent = value.name;
                        container.appendChild(radioElement);
                        container.appendChild(radioLabel);
                    }
                    element = container;
                }
                break;
            case SLIDER_OPTION:
                {
                    const selectOption = option as SliderOption;
                    const inputElement = document.createElement('input');
                    const value = this.options.getOption(name) as number;
                    inputElement.setAttribute('type', 'range');
                    inputElement.setAttribute(
                        'min',
                        selectOption.min?.toString() || '0'
                    );
                    inputElement.setAttribute(
                        'max',
                        selectOption.max?.toString() || '100'
                    );
                    inputElement.setAttribute(
                        'step',
                        selectOption.step?.toString() || '1'
                    );
                    inputElement.value = value.toString();
                    element = inputElement;
                }
                break;
            default: {
                const inputElement = document.createElement('input');
                const value = this.options.getOption(name) as string;
                inputElement.value = value;
                element = inputElement;
            }
        }
        element.id = name;
        element.addEventListener('input', onInput);
        element.addEventListener('change', onChange);
        listItem.appendChild(element);
        const labelElement = document.createElement('label');

        if (name == 'accelerator_toggle') {
            const value = this.options.getOption(
                'accelerator_toggle'
            ) as string;
            labelElement.textContent = `${value} mHz`;
        } else if (name == 'palette') {
            const value = this.options.getOption('palette') as number;
            labelElement.textContent =
                value == 4
                    ? 'MONO'
                    : value == 3
                      ? 'B/W'
                      : value == 2
                        ? 'GREY'
                        : value
                          ? 'RGB'
                          : 'CRT';
        } else if (name == 'scanlines_slide') {
            const value = this.options.getOption('scanlines_slide') as number;
            labelElement.textContent = `Opacity: ${value}`;
            const disabled = !this.options.getOption(
                'show_scanlines'
            ) as boolean;
            (element as HTMLInputElement).disabled = disabled;
        } else {
            labelElement.textContent = label;
        }

        labelElement.setAttribute('for', name);
        listItem.appendChild(labelElement);

        return listItem;
    }

    openModal = () => {
        const content = document.querySelector('#options-modal-content');
        if (content) {
            content.innerHTML = '';
            const panels = this.createPanelsGrid();

            for (const section of this.options.getSections()) {
                const panelId = SECTION_PANEL[section.name] ?? 'system';
                panels[panelId].appendChild(this.renderSection(section));
            }
        } else {
            console.error('Cannot find target div#options-modal-content');
        }
        MicroModal.show('options-modal');
    };
}
