import MicroModal from 'micromodal';
import {
    ACTION_OPTION,
    BOOLEAN_OPTION,
    LABEL_OPTION,
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

const PANEL_EDGE_MARGIN = 5;

const SECTION_PANEL: Record<string, OptionsPanelId> = {
    'Render Mode': 'screen',
    Screen: 'screen',
    Audio: 'audio',
    Joystick: 'joystick',
    Type: 'system',
    'CPU Speed': 'system',
};

const PANEL_IDS: Record<OptionsPanelId, string> = {
    screen: 'options-panel-screen',
    audio: 'options-panel-audio',
    joystick: 'options-panel-joystick',
    system: 'options-panel-system',
};

type DragState = {
    panel: HTMLElement;
    offsetX: number;
    offsetY: number;
    pointerId: number;
};

export class OptionsModal {
    private dragState: DragState | null = null;
    private interactionsReady = false;

    constructor(private options: Options) {
        this.setupPanelInteractions();
    }

    private getModal(): HTMLElement | null {
        return document.getElementById('options-modal');
    }

    private getPanelElement(id: OptionsPanelId): HTMLElement | null {
        return document.getElementById(PANEL_IDS[id]);
    }

    private getPanelBody(id: OptionsPanelId): HTMLElement | null {
        const panel = document.getElementById(PANEL_IDS[id]);
        if (!panel) {
            return null;
        }
        return (
            panel.querySelector<HTMLElement>('.options-panel-body') ?? panel
        );
    }

    private getPanels(): Record<OptionsPanelId, HTMLElement | null> {
        return {
            screen: this.getPanelBody('screen'),
            audio: this.getPanelBody('audio'),
            joystick: this.getPanelBody('joystick'),
            system: this.getPanelBody('system'),
        };
    }

    private renderActionButton(option: Option): HTMLButtonElement {
        const { name, label } = option;
        const button = document.createElement('button');
        button.type = 'button';
        button.id = name;
        button.className = 'options-action';
        if (name === 'emulator_pause') {
            button.textContent = document.body.classList.contains(
                'apple2-paused'
            )
                ? 'Run'
                : 'Pause';
        } else {
            button.textContent = label;
        }
        button.addEventListener('click', () => {
            this.options.setOption(name, true);
        });
        return button;
    }

    private renderSection(section: OptionSection): HTMLElement {
        const { name, options } = section;
        const block = document.createElement('div');
        block.className = 'options-section';

        const skipSectionHeader = name === 'Joystick' || name === 'Audio';
        const listOptions: Option[] = [];

        if (!skipSectionHeader) {
            const headerRow = document.createElement('div');
            headerRow.className = 'options-section-header';
            const header = document.createElement('h3');
            header.textContent = name;
            headerRow.appendChild(header);

            for (const option of options) {
                if (name === 'CPU Speed' && option.type === ACTION_OPTION) {
                    headerRow.appendChild(this.renderActionButton(option));
                } else {
                    listOptions.push(option);
                }
            }
            block.appendChild(headerRow);
        } else {
            listOptions.push(...options);
        }

        const list = document.createElement('ul');
        for (const option of listOptions) {
            list.appendChild(this.renderOption(option));
        }
        block.appendChild(list);

        return block;
    }

    private renderOption(option: Option): HTMLLIElement {
        const { name, label, type } = option;
        const onInput = (evt: InputEvent & { target: HTMLInputElement }) => {
            if (
                [
                    'accelerator_toggle',
                    'scanlines_slide',
                    'half_pixel_shift_slide',
                    'sound_volume',
                ].includes(evt.target.id)
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

        if (type === LABEL_OPTION) {
            listItem.className = 'options-subheading';
            listItem.textContent = label;
            return listItem;
        }

        if (type === ACTION_OPTION) {
            listItem.appendChild(this.renderActionButton(option));
            return listItem;
        }

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
                    if (name === 'gl_canvas' || name === 'palette') {
                        container.classList.add('radio-group--inline');
                    }
                    for (const value of radioOption.values) {
                        const radioLabel = document.createElement('label');
                        radioLabel.className = 'radio-option';
                        const radioElement = document.createElement('input');
                        radioElement.setAttribute('type', 'radio');
                        radioElement.setAttribute('name', name);
                        radioElement.value = value.value;
                        radioElement.checked = value.value === String(selected);
                        radioElement.addEventListener('change', onChange);
                        const text = document.createElement('span');
                        text.textContent = value.name;
                        radioLabel.appendChild(radioElement);
                        radioLabel.appendChild(text);
                        container.appendChild(radioLabel);
                    }
                    container.id = name;
                    listItem.appendChild(container);
                    return listItem;
                }
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
        } else if (name == 'scanlines_slide') {
            const value = this.options.getOption('scanlines_slide') as number;
            labelElement.textContent = `${value}`;//Opacity:
            const disabled = !this.options.getOption(
                'show_scanlines'
            ) as boolean;
            (element as HTMLInputElement).disabled = disabled;
        } else if (name == 'half_pixel_shift_slide') {
            const value = this.options.getOption(
                'half_pixel_shift_slide'
            ) as number;
            labelElement.textContent = `${value}`;//Shift:
            const disabled = !this.options.getOption(
                'half_pixel_shift'
            ) as boolean;
            (element as HTMLInputElement).disabled = disabled;
        } else if (name == 'sound_volume') {
            const value = this.options.getOption('sound_volume') as number;
            labelElement.textContent = `Volume: ${value.toFixed(1)}`;
            const disabled = !this.options.getOption('enable_sound') as boolean;
            (element as HTMLInputElement).disabled = disabled;
        } else {
            labelElement.textContent = label;
        }

        labelElement.setAttribute('for', name);
        listItem.appendChild(labelElement);

        return listItem;
    }

    private getScaleFactor(): number {
        const value = getComputedStyle(document.documentElement)
            .getPropertyValue('--scale-factor')
            .trim();
        const scale = parseFloat(value);
        return Number.isFinite(scale) && scale > 0 ? scale : 1;
    }

    private setPanelMinimized(panel: HTMLElement, minimized: boolean) {
        if (minimized) {
            const scale = this.getScaleFactor();
            const width =
                Math.round(panel.getBoundingClientRect().width / scale);
            if (panel.dataset.floating !== 'true') {
                this.anchorPanelForDrag(panel);
            }
            panel.classList.add('options-panel--minimized');
            panel.style.boxSizing = 'border-box';
            panel.style.width = `${width}px`;
            panel.style.maxWidth = `${width}px`;
        } else {
            panel.classList.remove('options-panel--minimized');
            panel.style.width = '';
            panel.style.maxWidth = '';
            panel.style.boxSizing = '';
        }
        const btn = panel.querySelector<HTMLButtonElement>(
            '.options-panel-minimize'
        );
        if (btn) {
            btn.textContent = minimized ? '+' : '−';
            btn.setAttribute(
                'aria-label',
                minimized
                    ? `Expand ${panel.querySelector('.options-panel-title')?.textContent ?? ''} panel`
                    : `Minimize ${panel.querySelector('.options-panel-title')?.textContent ?? ''} panel`
            );
            btn.setAttribute('aria-expanded', String(!minimized));
        }
    }

    private resetPanelLayout() {
        for (const id of Object.keys(PANEL_IDS) as OptionsPanelId[]) {
            const panel = this.getPanelElement(id);
            if (!panel) {
                continue;
            }
            panel.classList.remove(
                'options-panel--hidden',
                'options-panel--floating',
                'options-panel--minimized'
            );
            this.setPanelMinimized(panel, false);
            panel.style.left = '';
            panel.style.top = '';
            panel.style.right = '';
            panel.style.bottom = '';
            panel.style.width = '';
            panel.style.maxWidth = '';
            panel.style.boxSizing = '';
            panel.style.height = '';
            delete panel.dataset.floating;
        }
    }

    private anchorPanelForDrag(panel: HTMLElement) {
        if (panel.dataset.floating === 'true') {
            return;
        }
        const modal = this.getModal();
        if (!modal) {
            return;
        }
        const scale = this.getScaleFactor();
        const rect = panel.getBoundingClientRect();
        const modalRect = modal.getBoundingClientRect();
        const left = (rect.left - modalRect.left) / scale;
        const top = (rect.top - modalRect.top) / scale;

        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        panel.style.height = 'auto';
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
        panel.dataset.floating = 'true';
        panel.classList.add('options-panel--floating');
    }

    private clampPanelPosition(
        left: number,
        top: number,
        panelW: number,
        panelH: number,
        modalW: number,
        modalH: number
    ) {
        const margin = PANEL_EDGE_MARGIN;
        const maxLeft = Math.max(margin, modalW - panelW - margin);
        const maxTop = Math.max(margin, modalH - panelH - margin);
        let minTop = margin;
        if (panelH > modalH - margin * 2) {
            minTop = modalH - panelH - margin;
        }
        return {
            left: Math.max(margin, Math.min(left, maxLeft)),
            top: Math.max(minTop, Math.min(top, maxTop)),
        };
    }

    private movePanel(panel: HTMLElement, clientX: number, clientY: number) {
        const modal = this.getModal();
        const drag = this.dragState;
        if (!modal || !drag) {
            return;
        }
        const scale = this.getScaleFactor();
        const modalRect = modal.getBoundingClientRect();
        const panelW = panel.offsetWidth;
        const panelH = panel.offsetHeight;
        const modalW = modal.clientWidth;
        const modalH = modal.clientHeight;

        let left = (clientX - drag.offsetX - modalRect.left) / scale;
        let top = (clientY - drag.offsetY - modalRect.top) / scale;

        const clamped = this.clampPanelPosition(
            left,
            top,
            panelW,
            panelH,
            modalW,
            modalH
        );

        panel.style.left = `${clamped.left}px`;
        panel.style.top = `${clamped.top}px`;
    }

    private onPointerMove = (evt: PointerEvent) => {
        if (!this.dragState || evt.pointerId !== this.dragState.pointerId) {
            return;
        }
        evt.preventDefault();
        this.movePanel(this.dragState.panel, evt.clientX, evt.clientY);
    };

    private onPointerUp = (evt: PointerEvent) => {
        if (!this.dragState || evt.pointerId !== this.dragState.pointerId) {
            return;
        }
        document.removeEventListener('pointermove', this.onPointerMove);
        document.removeEventListener('pointerup', this.onPointerUp);
        document.removeEventListener('pointercancel', this.onPointerUp);
        this.dragState = null;
    };

    private togglePanelMinimized(panel: HTMLElement) {
        this.setPanelMinimized(
            panel,
            !panel.classList.contains('options-panel--minimized')
        );
    }

    private closePanel(panel: HTMLElement) {
        panel.classList.add('options-panel--hidden');
        const modal = this.getModal();
        const visiblePanels = modal?.querySelectorAll(
            '.options-panel:not(.options-panel--hidden)'
        );
        if (!visiblePanels?.length) {
            this.closeModal();
        }
    }

    private setupPanelInteractions() {
        if (this.interactionsReady) {
            return;
        }
        const modal = this.getModal();
        if (!modal) {
            return;
        }

        modal.addEventListener('pointerdown', (evt) => {
            const target = evt.target as HTMLElement;
            if (
                target.closest('.options-panel-close') ||
                target.closest('.options-panel-minimize')
            ) {
                return;
            }
            const chrome = target.closest('.options-panel-chrome');
            if (!chrome) {
                return;
            }
            const panel = chrome.closest('.options-panel') as HTMLElement | null;
            if (!panel || panel.classList.contains('options-panel--hidden')) {
                return;
            }
            evt.preventDefault();
            this.anchorPanelForDrag(panel);
            const rect = panel.getBoundingClientRect();
            this.dragState = {
                panel,
                offsetX: evt.clientX - rect.left,
                offsetY: evt.clientY - rect.top,
                pointerId: evt.pointerId,
            };
            document.addEventListener('pointermove', this.onPointerMove);
            document.addEventListener('pointerup', this.onPointerUp);
            document.addEventListener('pointercancel', this.onPointerUp);
        });

        modal.addEventListener('click', (evt) => {
            const target = evt.target as HTMLElement;
            const minimizeBtn = target.closest('.options-panel-minimize');
            if (minimizeBtn) {
                evt.stopPropagation();
                const panel = minimizeBtn.closest(
                    '.options-panel'
                ) as HTMLElement | null;
                if (panel) {
                    this.togglePanelMinimized(panel);
                }
                return;
            }
            const closeBtn = target.closest('.options-panel-close');
            if (!closeBtn) {
                return;
            }
            evt.stopPropagation();
            const panel = closeBtn.closest('.options-panel') as HTMLElement | null;
            if (panel) {
                this.closePanel(panel);
            }
        });

        this.interactionsReady = true;
    }

    openModal = () => {
        const panels = this.getPanels();
        if (!panels.screen) {
            console.error('Cannot find options panel containers');
            return;
        }

        this.resetPanelLayout();
        this.setupPanelInteractions();

        for (const panel of Object.values(panels)) {
            if (panel) {
                panel.innerHTML = '';
            }
        }

        for (const section of this.options.getSections()) {
            const panelId = SECTION_PANEL[section.name] ?? 'system';
            panels[panelId]?.appendChild(this.renderSection(section));
        }

        const pauseBtn = document.getElementById('emulator_pause');
        if (pauseBtn) {
            const paused = document.body.classList.contains('apple2-paused');
            pauseBtn.textContent = paused ? 'Run' : 'Pause';
        }

        MicroModal.show('options-modal');
    };

    closeModal = () => {
        MicroModal.close('options-modal');
    };

    isOpen = () => {
        return (
            document
                .getElementById('options-modal')
                ?.classList.contains('is-open') ?? false
        );
    };

    toggleModal = () => {
        if (this.isOpen()) {
            this.closeModal();
        } else {
            this.openModal();
        }
    };
}
