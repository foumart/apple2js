export function handleResize(fullscreenClass = 'full-page') {
    const fullscreen = document.body.classList.contains(fullscreenClass);
    const scrollBar = window.innerWidth / window.innerHeight > 580 / 640 && !fullscreen;
    document.body.style.overflowY = scrollBar ? "scroll" : "hidden";

    const scrollerWidth = scrollBar ? (window.innerWidth - document.documentElement.clientWidth) / 2 : 0;
    const width = fullscreen ? 580 : 584 + (scrollBar ? scrollerWidth : 0);

    let min = 2;
    if (fullscreen) {
        if (window.innerWidth / window.innerHeight > 2240 / 1536) {
            min = window.innerHeight / 384;
        } else {
            min = window.innerWidth / 580;
        }
    }

    const scale = +Math.min(min, Math.max(0.5, 1 + (window.innerWidth - width) / width)).toFixed(3);
    document.documentElement.style.setProperty('--scale-factor', "" + scale);

    const outer = document.getElementsByClassName("outer")[0] as HTMLElement;
    outer.style.transformOrigin = `${window.innerWidth - width < 0 ? "0%" : "50%"} 0%`;
}
