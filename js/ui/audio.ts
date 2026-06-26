import { BOOLEAN_OPTION, SLIDER_OPTION, OptionHandler } from '../options';
import Apple2IO from '../apple2io';
import { debug } from '../util';

/*
 * Audio Handling
 */

const QUANTUM_SIZE = 128;
const SAMPLE_SIZE = 1024;
const SAMPLE_RATE = 44000;

export const SOUND_ENABLED_OPTION = 'enable_sound';
export const SOUND_VOLUME_OPTION = 'sound_volume';

declare global {
    interface Window {
        webkitAudioContext: AudioContext;
    }
}

const AudioContext = window.AudioContext || window.webkitAudioContext;

export class Audio implements OptionHandler {
    private sound = true;
    private samples: number[][] = [];

    private audioContext;
    private audioNode;
    private gainNode: GainNode;
    private workletNode: AudioWorkletNode;
    private started = false;
    private volume = 1;

    ready: Promise<void>;

    constructor(io: Apple2IO, private updateIcon: Function) {
        this.audioContext = new AudioContext({
            sampleRate: SAMPLE_RATE,
        });
        this.gainNode = this.audioContext.createGain();
        this.gainNode.gain.value = this.volume;

        if (window.AudioWorklet) {
            const workletReady = this.audioContext.audioWorklet.addModule(
                './dist/audio_worker.bundle.js'
            );
            this.ready = workletReady
                .then(() => {
                    this.workletNode = new AudioWorkletNode(
                        this.audioContext,
                        'audio_worker'
                    );

                    io.sampleRate(this.audioContext.sampleRate, QUANTUM_SIZE);
                    io.addSampleListener((sample) => {
                        if (
                            this.sound &&
                            this.audioContext.state === 'running'
                        ) {
                            this.workletNode.port.postMessage(sample);
                        }
                    });
                    this.workletNode.connect(this.gainNode);
                    this.gainNode.connect(this.audioContext.destination);
                })
                .catch(console.error);
        } else {
            // TODO(flan): MDN says that createScriptProcessor is deprecated and
            // replaced by AudioWorklet. FF and Chrome support AudioWorklet, but
            // Safari does not (yet).
            this.audioNode = this.audioContext.createScriptProcessor(
                SAMPLE_SIZE,
                1,
                1
            );

            this.audioNode.onaudioprocess = (event) => {
                const data = event.outputBuffer.getChannelData(0);
                const sample = this.samples.shift();
                let idx = 0;
                let len = data.length;

                if (sample) {
                    len = Math.min(sample.length, len);
                    for (; idx < len; idx++) {
                        data[idx] = sample[idx];
                    }
                }

                for (; idx < data.length; idx++) {
                    data[idx] = 0.0;
                }
            };

            this.audioNode.connect(this.gainNode);
            this.gainNode.connect(this.audioContext.destination);
            io.sampleRate(this.audioContext.sampleRate, SAMPLE_SIZE);
            io.addSampleListener((sample) => {
                if (this.sound && this.audioContext.state === 'running') {
                    if (this.samples.length < 5) {
                        this.samples.push(sample);
                    }
                }
            });
            this.ready = Promise.resolve();
        }

        window.addEventListener('keydown', this.autoStart);
        if (window.ontouchstart !== undefined) {
            window.addEventListener('touchstart', this.autoStart);
        }
        window.addEventListener('mousedown', this.autoStart);

        debug('Sound initialized');
    }

    autoStart = () => {
        if (this.audioContext && !this.started) {
            this.samples = [];
            this.audioContext
                .resume()
                .then(() => {
                    this.started = true;
                })
                .catch((error) => {
                    console.warn('audio not started', error);
                });
        }
    };

    start = () => {
        if (this.audioContext) {
            this.samples = [];
            this.audioContext.resume().catch((error) => {
                console.warn('audio not resumed', error);
            });
        }
    };

    isEnabled = () => {
        return this.sound;
    };

    getOptions() {
        return [
            {
                name: 'Audio',
                options: [
                    {
                        name: SOUND_ENABLED_OPTION,
                        label: 'Enabled',
                        type: BOOLEAN_OPTION,
                        defaultVal: true,
                    },
                    {
                        name: SOUND_VOLUME_OPTION,
                        label: '',
                        type: SLIDER_OPTION,
                        min: 0,
                        max: 1,
                        step: 0.1,
                        defaultVal: 1,
                    },
                ],
            },
        ];
    }

    setOption = (name: string, value: boolean | number) => {
        switch (name) {
            case SOUND_ENABLED_OPTION:
                const oldValue = this.sound;
                this.sound = value as boolean;
                if (oldValue != value) this.updateIcon();
                this.updateVolumeControlState();
                break;
            case SOUND_VOLUME_OPTION:
                this.volume = value as number;
                this.gainNode.gain.value = this.volume;
                this.updateVolumeLabel(this.volume);
                break;
        }
    };

    private updateVolumeLabel(value: number) {
        const slide = document.getElementById('sound_volume');
        const label = slide?.parentElement?.querySelector('label');
        if (label) {
            label.textContent = `Volume: ${value.toFixed(1)}`;
        }
    }

    private updateVolumeControlState() {
        const slide = document.getElementById(
            'sound_volume'
        ) as HTMLInputElement | null;
        if (!slide) {
            return;
        }
        slide.disabled = !this.sound;
        const label = slide.parentElement?.querySelector('label');
        if (label) {
            label.classList.toggle('options-label--disabled', !this.sound);
        }
    }
}
