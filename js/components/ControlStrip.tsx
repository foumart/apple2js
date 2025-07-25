import { h } from 'preact';
import { useCallback, useContext, useEffect, useState } from 'preact/hooks';
import { CPUMeter } from './CPUMeter';
import { Inset } from './Inset';
import { useHotKey } from './hooks/useHotKey';
import { AudioControl } from './AudioControl';
import { ClipboardCopy } from './ClipboardCopy';
import { ClipboardPaste } from './ClipboardPaste';
import { OptionsModal } from './OptionsModal';
import { OptionsContext } from './OptionsContext';
import { Printer } from './Printer';
import { ControlButton } from './ControlButton';
import { Cassette } from './Cassette';
import { Apple2 as Apple2Impl } from '../apple2';
import { JoyStick } from '../ui/joystick';
import { Screen, SCREEN_FULL_PAGE } from '../ui/screen';
import { System } from '../ui/system';

import Apple2IO from 'js/apple2io';
import { VideoModes } from 'js/videomodes';

import styles from './css/ControlStrip.module.scss';

const README = 'https://github.com/whscullin/apple2js#readme';

interface ControlStripProps {
    apple2: Apple2Impl | undefined;
    e: boolean;
    toggleDebugger: () => void;
}

/**
 * Strip containing containing controls for various system
 * characteristics, like CPU speed, audio, and the system
 * options panel.
 *
 * @param apple2 Apple2 object
 * @param e Whether or not this is a //e
 * @returns ControlStrip component
 */
export const ControlStrip = ({
    apple2,
    e,
    toggleDebugger,
}: ControlStripProps) => {
    const [showOptions, setShowOptions] = useState(false);
    const [io, setIO] = useState<Apple2IO>();
    const [vm, setVM] = useState<VideoModes>();
    const options = useContext(OptionsContext);

    useEffect(() => {
        if (apple2) {
            const io = apple2.getIO();
            const vm = apple2.getVideoModes();
            setIO(io);
            setVM(vm);

            const system = new System(apple2, io, e);
            options.addOptions(system);

            const screen = new Screen(apple2);
            options.addOptions(screen);

            const joystick = new JoyStick(io);
            options.addOptions(joystick);
        }
    }, [apple2, e, options]);

    const doReset = useCallback(() => apple2?.reset(), [apple2]);

    const doReadme = useCallback(() => window.open(README, '_blank'), []);

    const doShowOptions = useCallback(() => setShowOptions(true), []);

    const doCloseOptions = useCallback(() => setShowOptions(false), []);

    const doToggleFullPage = useCallback(
        () =>
            options.setOption(
                SCREEN_FULL_PAGE,
                !options.getOption(SCREEN_FULL_PAGE)
            ),
        [options]
    );

    useHotKey('F2', doToggleFullPage);
    useHotKey('F4', doShowOptions);
    useHotKey('F12', doReset);

    return (
        <div className={styles.resetRow}>
            <OptionsModal isOpen={showOptions} onClose={doCloseOptions} />
            <Inset>
                <CPUMeter apple2={apple2} />
                <ControlButton
                    onClick={toggleDebugger}
                    title="Toggle Debugger"
                    icon="bug"
                />
                <AudioControl apple2={apple2} />
                <Printer io={io} slot={1} />
                <Cassette io={io} />
                <div style={{ flexGrow: 0, width: 16 }} />
                <ClipboardCopy vm={vm} />
                <ClipboardPaste io={io} />
                <div style={{ flexGrow: 1 }} />
                <ControlButton onClick={doReadme} title="About" icon="info" />
                <ControlButton
                    onClick={doShowOptions}
                    title="Options (F4)"
                    icon="cog"
                />
            </Inset>
            {e && (
                <div className={styles.reset} onClick={doReset}>
                    Reset
                </div>
            )}
        </div>
    );
};
