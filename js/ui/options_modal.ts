import MicroModal from 'micromodal';
import {
    BOOLEAN_OPTION,
    SELECT_OPTION,
    Options,
    SelectOption,
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
                    element.addEventListener('change', onChange);
                    listItem.appendChild(element);
                    const labelElement = document.createElement('label');

                    // TODO: to be improved
                    if (name == "accelerator_toggle") {
                        const value = this.options.getOption("accelerator_toggle") as string;
                        labelElement.textContent = `${value} mHz`;
                    } else if (name == "mono_screen") {
                        const gl = this.options.getOption("gl_canvas") as boolean;
                        labelElement.textContent = gl ? "Color Monitor" : "Digital Output";
                    } else if (name == "palette") {
                        const gl = this.options.getOption("gl_canvas") as boolean;
                        const value = this.options.getOption("palette") as number;
                        labelElement.textContent = value == 3 ? gl ? "B/W" : "4 BIT" : value == 2 ? gl ? "CHROMA" : "CONTRAST" : value ? gl ? "RGB" : "IIGS" : gl ? "CRT" : "NTSC";
                        const disabled = !this.options.getOption("mono_screen") as boolean;
                        (element as HTMLInputElement).disabled = disabled;
                    } else if (name == "scanlines_slide") {
                        const value = this.options.getOption("scanlines_slide") as number;
                        labelElement.textContent = `Opacity: ${value}`;
                        const disabled = !this.options.getOption("show_scanlines") as boolean;
                        (element as HTMLInputElement).disabled = disabled;
                    } else if (name == "composite") {
                        const disabled = this.options.getOption("gl_canvas") as boolean;
                        (element as HTMLInputElement).disabled = disabled;
                        labelElement.textContent = label;
                    } else {
                        labelElement.textContent = label;
                    }

                    labelElement.setAttribute('for', name);
                    listItem.appendChild(labelElement);

                    list.appendChild(listItem);
                }
                content.appendChild(list);
            }
            const reloadElement = document.createElement('i');
            reloadElement.style.marginLeft = '20px';
            reloadElement.textContent = '* Reload page to take effect';
            content.append(reloadElement);
        } else {
            console.error('Cannot find target div#options-modal-content');
        }
        MicroModal.show('options-modal');
    };
}
