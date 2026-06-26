/** @jest-environment jsdom */
import { screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { Options } from 'js/options';

import { BOOLEAN_OPTION, SELECT_OPTION, OptionHandler } from 'js/options';
import { OptionsModal } from 'js/ui/options_modal';

jest.mock('micromodal');

const mockOptionHandler: OptionHandler = {
    getOptions() {
        return [
            {
                name: 'Section 1',
                options: [
                    {
                        name: 'option_1',
                        label: 'Option 1',
                        type: BOOLEAN_OPTION,
                        defaultVal: false,
                    },
                    {
                        name: 'option_2',
                        label: 'Option 2',
                        type: SELECT_OPTION,
                        defaultVal: 'select_1',
                        values: [
                            {
                                name: 'Select 1',
                                value: 'select_1',
                            },
                            {
                                name: 'Select 2',
                                value: 'select_2',
                            },
                        ],
                    },
                ],
            },
            {
                name: 'Section 2',
                options: [
                    {
                        name: 'option_3',
                        label: 'Option 3',
                        type: BOOLEAN_OPTION,
                        defaultVal: true,
                    },
                ],
            },
        ];
    },

    setOption: jest.fn(),
};

describe('OptionsModal', () => {
    let options: Options;
    let modal: OptionsModal;
    beforeEach(() => {
        options = new Options();
        options.addOptions(mockOptionHandler);
        modal = new OptionsModal(options);
    });
    afterEach(() => {
        localStorage.clear();
    });

    describe('openModal', () => {
        beforeEach(() => {
            const display = document.createElement('div');
            display.id = 'display';
            const modal = document.createElement('div');
            modal.id = 'options-modal';
            modal.className = 'modal options-modal';
            for (const id of [
                'options-panel-screen',
                'options-panel-audio',
                'options-panel-joystick',
                'options-panel-system',
            ]) {
                const panel = document.createElement('div');
                panel.id = id;
                modal.appendChild(panel);
            }
            display.appendChild(modal);
            document.body.appendChild(display);
        });

        afterEach(() => {
            jest.resetAllMocks();
            document.getElementById('display')?.remove();
        });

        it('renders', () => {
            modal.openModal();
            expect(
                document.getElementById('options-panel-screen')
            ).toMatchSnapshot();
        });

        it('toggles booleans', () => {
            modal.openModal();
            const toggle = screen.getByText('Option 3');
            userEvent.click(toggle);
            expect(mockOptionHandler.setOption).toHaveBeenCalledWith(
                'option_3',
                false
            );
        });

        it('selects', () => {
            modal.openModal();
            const combobox = screen.getByRole('combobox');
            userEvent.selectOptions(combobox, 'select_2');

            expect(mockOptionHandler.setOption).toHaveBeenCalledWith(
                'option_2',
                'select_2'
            );
        });
    });

    describe('getOption', () => {
        beforeEach(() => {
            options = new Options();
            options.addOptions(mockOptionHandler);
            modal = new OptionsModal(options);
        });
        it('gets boolean', () => {
            expect(options.getOption('option_1')).toEqual(false);
            expect(options.getOption('option_3')).toEqual(true);
        });

        it('gets selector', () => {
            expect(options.getOption('option_2')).toEqual('select_1');
        });
    });

    describe('setOption', () => {
        it('sets boolean', () => {
            options.setOption('option_1', true);
            expect(mockOptionHandler.setOption).toHaveBeenCalledWith(
                'option_1',
                true
            );
        });

        it('sets selector', () => {
            options.setOption('option_2', 'select_2');
            expect(mockOptionHandler.setOption).toHaveBeenCalledWith(
                'option_2',
                'select_2'
            );
        });
    });
});
