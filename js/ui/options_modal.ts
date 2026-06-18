import MicroModal from 'micromodal';
import {
    BOOLEAN_OPTION,
    SELECT_OPTION,
    RADIO_OPTION,
    Options,
    SelectOption,
    RadioOption,
    SLIDER_OPTION,
    SliderOption,
} from '../options';

export class OptionsModal {
    constructor(private options: Options) {}

    openModal = () => {
        const content = document.querySelector('#options-modal-content');
        if (content) {
            content.innerHTML = '';
            for (const section of this.options.getSections()) {
                const { name, options } = section;

                // Section header
                const header = document.createElement('h3');
                header.textContent = name;
                content.appendChild(header);

                // Preferences
                const list = document.createElement('ul');
                for (const option of options) {
                    const { name, label, type } = option;
                    const onInput = (
                        evt: InputEvent & { target: HTMLInputElement }
                    ) => {
                        if (["accelerator_toggle", "palette", "scanlines_slide"].includes(evt.target.id)) {
                            this.options.setOption(name, Number(evt.target.value));
                        }
                    }
                    const onChange = (
                        evt: InputEvent & { target: HTMLInputElement }
                    ) => {
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
                                const inputElement =
                                    document.createElement('input');
                                const checked = this.options.getOption(
                                    name
                                ) as boolean;
                                inputElement.setAttribute('type', 'checkbox');
                                inputElement.checked = checked;
                                element = inputElement;
                            }
                            break;
                        case SELECT_OPTION:
                            {
                                const selectOption = option as SelectOption;
                                const selectElement =
                                    document.createElement('select');
                                const selected = this.options.getOption(
                                    name
                                ) as string;
                                for (const value of selectOption.values) {
                                    const optionElement =
                                        document.createElement('option');
                                    optionElement.value = value.value;
                                    optionElement.textContent = value.name;
                                    optionElement.selected =
                                        value.value === selected;
                                    selectElement.appendChild(optionElement);
                                }
                                element = selectElement;
                            }
                            break;
                        case RADIO_OPTION:
                            {
                                const radioOption = option as RadioOption;
                                const selected = this.options.getOption(
                                    name
                                ) as string;
                                const container =
                                    document.createElement('span');
                                container.classList.add('radio-group');
                                for (const value of radioOption.values) {
                                    const radioElement =
                                        document.createElement('input');
                                    radioElement.setAttribute('type', 'radio');
                                    radioElement.setAttribute('name', name);
                                    radioElement.value = value.value;
                                    radioElement.checked =
                                        value.value === String(selected);
                                    const radioLabel =
                                        document.createElement('label');
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
                                const inputElement =
                                    document.createElement('input');
                                const value = this.options.getOption(
                                    name
                                ) as number;
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
                            const inputElement =
                                document.createElement('input');
                            const value = this.options.getOption(
                                name
                            ) as string;
                            inputElement.value = value;
                            element = inputElement;
                        }
                    }
                    element.id = name;
                    element.addEventListener('input', onInput);
                    element.addEventListener('change', onChange);
                    listItem.appendChild(element);
                    const labelElement = document.createElement('label');

                    // TODO: to be improved
                    if (name == "accelerator_toggle") {
                        const value = this.options.getOption("accelerator_toggle") as string;
                        labelElement.textContent = `${value} mHz`;
                    } else if (name == "palette") {
                        const value = this.options.getOption("palette") as number;
                        // CRT / RGB / GREY / B&W / MONO (same labels for both renderers).
                        labelElement.textContent = value == 4 ? "MONO" : value == 3 ? "B&W" : value == 2 ? "GREY" : value ? "RGB" : "CRT";
                    } else if (name == "scanlines_slide") {
                        const value = this.options.getOption("scanlines_slide") as number;
                        labelElement.textContent = `Opacity: ${value}`;
                        const disabled = !this.options.getOption("show_scanlines") as boolean;
                        (element as HTMLInputElement).disabled = disabled;
                    } else {
                        labelElement.textContent = label;
                    }

                    labelElement.setAttribute('for', name);
                    listItem.appendChild(labelElement);

                    list.appendChild(listItem);
                }
                content.appendChild(list);
            }
        } else {
            console.error('Cannot find target div#options-modal-content');
        }
        MicroModal.show('options-modal');
    };
}
