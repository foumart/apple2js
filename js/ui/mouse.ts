import type Mouse from '../cards/mouse';
import { enableMouseMode } from './joystick';

type TouchEventWithTarget = TouchEvent & { target: HTMLCanvasElement };

function touchClientForEvent(event: TouchEvent): Touch | null {
    // touchend / touchcancel: touches that ended are only in changedTouches.
    if (event.type === 'touchend' || event.type === 'touchcancel') {
        return event.changedTouches.length > 0 ? event.changedTouches[0] : null;
    }
    if (event.targetTouches.length > 0) {
        return event.targetTouches[0];
    }
    return event.touches.length > 0 ? event.touches[0] : null;
}

function isCoarsePointer(e: PointerEvent): boolean {
    return e.pointerType === 'touch' || e.pointerType === 'pen';
}

/** True when the input sequence is driven by touch/pen (Pointer or Touch API). */
function isTouchDerivedMouseEvent(e: MouseEvent): boolean {
    const ui = e as MouseEvent & {
        sourceCapabilities?: { firesTouchEvents?: boolean } | null;
    };
    return ui.sourceCapabilities?.firesTouchEvents === true;
}

export class MouseUI {
    private mouse: Mouse;
    private canvas!: HTMLCanvasElement;
    private detachListeners: Array<() => void> = [];

    constructor(canvas: HTMLCanvasElement) {
        this.attach(canvas);
    }

    // Re-point all input handlers at a different canvas element. Used when the
    // active renderer (WebGL <-> 2D) is switched live, since each renderer owns
    // its own canvas.
    setCanvas(canvas: HTMLCanvasElement) {
        if (this.canvas === canvas) {
            return;
        }
        const mouseModeOn =
            this.canvas?.classList.contains('mouseMode') ?? false;
        this.detach();
        this.attach(canvas);
        if (mouseModeOn) {
            this.canvas.classList.add('mouseMode');
        }
    }

    private detach() {
        for (const off of this.detachListeners) {
            off();
        }
        this.detachListeners = [];
    }

    private attach(canvas: HTMLCanvasElement) {
        this.canvas = canvas;

        const add = <E extends Event>(
            type: string,
            handler: (e: E) => void,
            opts?: AddEventListenerOptions
        ) => {
            const h = handler as EventListener;
            this.canvas.addEventListener(type, h, opts);
            this.detachListeners.push(() =>
                this.canvas.removeEventListener(type, h, opts)
            );
        };

        /**
         * While a touch/pen gesture is active, ignore compatibility mouse
         * events — they often carry wrong offsetX/Y (~0) and would overwrite
         * the position set by Pointer/touch handlers.
         */
        let touchLikeGestureActive = false;

        /** Map viewport client coordinates into the same space as mouse offsetX/Y. */
        const setFromClient = (clientX: number, clientY: number) => {
            const rect = this.canvas.getBoundingClientRect();
            const cw = this.canvas.clientWidth;
            const ch = this.canvas.clientHeight;
            if (cw <= 0 || ch <= 0 || rect.width <= 0 || rect.height <= 0) {
                return;
            }
            const x = ((clientX - rect.left) / rect.width) * cw;
            const y = ((clientY - rect.top) / rect.height) * ch;
            this.mouse.setMouseXY(x, y, cw, ch);
        };

        /** offsetX/Y on pointerdown match hit-testing (tap placement). */
        const setFromPointerOffset = (e: PointerEvent) => {
            if (e.target !== this.canvas) {
                return;
            }
            const cw = this.canvas.clientWidth;
            const ch = this.canvas.clientHeight;
            if (Number.isFinite(e.offsetX) && Number.isFinite(e.offsetY)) {
                this.mouse.setMouseXY(e.offsetX, e.offsetY, cw, ch);
            } else {
                setFromClient(e.clientX, e.clientY);
            }
        };

        const swallowIfMouseMode = (e: Event) => {
            if (this.canvas.classList.contains('mouseMode')) {
                e.preventDefault();
            }
        };

        /** Block page pan/scroll while using the emulated mouse or dragging with capture. */
        const swallowCoarseIfCapturingOrMouseMode = (e: PointerEvent) => {
            if (
                this.canvas.classList.contains('mouseMode') ||
                this.canvas.hasPointerCapture(e.pointerId)
            ) {
                e.preventDefault();
            }
        };

        if (typeof window.PointerEvent !== 'undefined') {
            const peOpts: AddEventListenerOptions = { passive: false };

            add(
                'pointermove',
                (e: PointerEvent) => {
                    if (!isCoarsePointer(e)) {
                        return;
                    }
                    setFromClient(e.clientX, e.clientY);
                    swallowCoarseIfCapturingOrMouseMode(e);
                },
                peOpts
            );

            add(
                'pointerdown',
                (e: PointerEvent) => {
                    if (!isCoarsePointer(e) || e.button !== 0) {
                        return;
                    }
                    touchLikeGestureActive = true;
                    setFromPointerOffset(e);
                    this.mouse.setMouseDown(true);
                    swallowIfMouseMode(e);
                    if (this.canvas.classList.contains('mouseMode')) {
                        try {
                            this.canvas.setPointerCapture(e.pointerId);
                        } catch {
                            // ignore
                        }
                    }
                },
                peOpts
            );

            const pointerUpLike = (e: PointerEvent) => {
                if (!isCoarsePointer(e)) {
                    return;
                }
                setFromClient(e.clientX, e.clientY);
                this.mouse.setMouseDown(false);
                swallowCoarseIfCapturingOrMouseMode(e);
                if (this.canvas.hasPointerCapture(e.pointerId)) {
                    this.canvas.releasePointerCapture(e.pointerId);
                }
                touchLikeGestureActive = false;
            };

            add('pointerup', pointerUpLike, peOpts);
            add('pointercancel', pointerUpLike, peOpts);

            /**
             * Safari still delivers touch scrolling alongside Pointer events.
             * touchmove preventDefault stops page pan while dragging on the canvas.
             */
            const touchBlockOpts: AddEventListenerOptions = { passive: false };
            const blockTouchScrollIfMouseMode = (e: TouchEvent) => {
                if (this.canvas.classList.contains('mouseMode')) {
                    e.preventDefault();
                }
            };
            add('touchmove', blockTouchScrollIfMouseMode, touchBlockOpts);
        } else if ('ontouchstart' in window) {
            const touchOpts: AddEventListenerOptions = { passive: false };

            const updateTouchXY = (event: TouchEventWithTarget) => {
                const touch = touchClientForEvent(event);
                if (!touch) {
                    return;
                }
                setFromClient(touch.clientX, touch.clientY);
            };

            add(
                'touchmove',
                (event: TouchEventWithTarget) => {
                    updateTouchXY(event);
                    swallowIfMouseMode(event);
                },
                touchOpts
            );

            add(
                'touchstart',
                (event: TouchEventWithTarget) => {
                    touchLikeGestureActive = true;
                    updateTouchXY(event);
                    this.mouse.setMouseDown(true);
                    swallowIfMouseMode(event);
                },
                touchOpts
            );

            add(
                'touchend',
                (event: TouchEventWithTarget) => {
                    updateTouchXY(event);
                    this.mouse.setMouseDown(false);
                    touchLikeGestureActive = false;
                },
                touchOpts
            );

            add(
                'touchcancel',
                (event: TouchEventWithTarget) => {
                    updateTouchXY(event);
                    this.mouse.setMouseDown(false);
                    touchLikeGestureActive = false;
                },
                touchOpts
            );
        }

        add(
            'mousemove',
            (event: MouseEvent & { target: HTMLCanvasElement }) => {
                if (
                    touchLikeGestureActive ||
                    isTouchDerivedMouseEvent(event)
                ) {
                    return;
                }
                const { offsetX, offsetY, target } = event;
                if (target !== this.canvas) {
                    return;
                }
                this.mouse.setMouseXY(
                    offsetX,
                    offsetY,
                    target.clientWidth,
                    target.clientHeight
                );
            }
        );

        add('mousedown', (event: MouseEvent) => {
            if (
                event.button !== 0 ||
                event.target !== this.canvas ||
                touchLikeGestureActive ||
                isTouchDerivedMouseEvent(event)
            ) {
                return;
            }
            this.mouse.setMouseDown(true);
        });

        add('mouseup', (event: MouseEvent) => {
            if (
                event.button !== 0 ||
                event.target !== this.canvas ||
                touchLikeGestureActive ||
                isTouchDerivedMouseEvent(event)
            ) {
                return;
            }
            this.mouse.setMouseDown(false);
        });
    }

    setMouse = (mouse: Mouse) => {
        this.mouse = mouse;
    };

    mouseMode = (on: boolean) => {
        enableMouseMode(on);
        if (on) {
            this.canvas.classList.add('mouseMode');
        } else {
            this.canvas.classList.remove('mouseMode');
        }
    };
}
