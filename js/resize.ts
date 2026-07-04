import { getChromeLayoutHeight } from './embed_options';

const OUTER_LAYOUT_W = 560;

export function handleResize(embedded = false, fullscreenClass = 'full-page') {
    const fullscreen = document.body.classList.contains(fullscreenClass);
    const outer = document.getElementsByClassName("outer")[0] as HTMLElement;

    const keyboardVisible = document.body.classList.contains('keyboard-visible');
    const screenOnly = document.body.classList.contains('screen-only');

    const scrollBar = keyboardVisible;
    const embeddedEmbed = embedded && !fullscreen;

    // FoumartGames iframe host resizes the frame or enables inner scroll.
    if (!embeddedEmbed) {
        document.body.style.overflowY = scrollBar ? "scroll" : "hidden";
    }

    const scrollerWidth = scrollBar ? (window.innerWidth - document.documentElement.clientWidth) : 0;
    const width = fullscreen ? 560 : 560 + scrollerWidth;

    let min = 2;
    if (fullscreen) {
        if (window.innerWidth / window.innerHeight > 2240 / 1536) {
            min = window.innerHeight / 384;
        } else {
            min = window.innerWidth / 560;
        }
    }

    const height = fullscreen ? 384 : 384 * (560 / width);

    const offset = screenOnly ? 0 : !scrollBar ? 40 : 65;
    const display = document.querySelector('body .outer #display') as HTMLElement;
    if (embedded) {
        display.style.marginLeft = "0";
        display.style.borderRadius = screenOnly || !scrollBar ? "0" : "8px";
        display.style.padding = screenOnly || !scrollBar ? "0" : "4px";
        display.style.borderWidth = screenOnly || !scrollBar ? "0" : "3px";
    } else {
        display.style.borderRadius = !scrollBar ? "0" : "8px";
        display.style.padding = !scrollBar ? "0" : "4px";
        display.style.marginLeft = !scrollBar ? "0" : "-7px";
        display.style.borderWidth = !scrollBar ? "0" : "3px";
    }

    let scale: number;
    if (screenOnly) {
        scale = Math.floor(Math.max(0.2, Math.min(
            window.innerWidth / OUTER_LAYOUT_W,
            window.innerHeight / 384
        )) * 1000) / 1000;
        outer.style.transformOrigin = "50% 0%";
    } else if (embedded && !fullscreen) {
        // FoumartGames iframe embed with periphery (standalone uses embedded=false).
        const layoutH = getChromeLayoutHeight(keyboardVisible);
        scale = Math.floor(Math.max(0.2, Math.min(
            window.innerWidth / OUTER_LAYOUT_W,
            window.innerHeight / layoutH
        )) * 1000) / 1000;
        outer.style.transformOrigin = "50% 0%";
    } else {
        outer.style.transformOrigin =
            `${window.innerWidth - width < 0 ? "0%" : "50%"} 0%`;
        const widthScale = Math.max(0.2, 1 + (window.innerWidth - width) / (scrollBar ? width : 560));
        const heightDenom = scrollBar ? height + offset : 384 + offset;
        const heightScale = Math.max(
            0.2,
            1 + (window.innerHeight - height - offset) / heightDenom
        );
        scale = +Math.min(min, widthScale, heightScale).toFixed(3);
    }
    document.documentElement.style.setProperty('--scale-factor', "" + scale);
}
