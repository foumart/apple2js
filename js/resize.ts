export function handleResize(embedded = false, fullscreenClass = 'full-page') {
    const fullscreen = document.body.classList.contains(fullscreenClass);
    const scrollBar = window.innerWidth / window.innerHeight > 560 / 640 && !fullscreen;
    document.body.style.overflowY = scrollBar ? "scroll" : "hidden";
    //document.body.style.overflowY = "hidden";

    const scrollerWidth = scrollBar ? (window.innerWidth - document.documentElement.clientWidth) : 0;
    const width = fullscreen ? 560 : 560 + scrollerWidth;

    //const display = document.querySelector('body .outer #display') as HTMLElement | null;

    let min = 2;
    if (fullscreen) {
        if (window.innerWidth / window.innerHeight > 2240 / 1536) {
            min = window.innerHeight / 384;
        } else {
            min = window.innerWidth / 560;
        }
    }

    const offset = 55;
    const height = fullscreen ? 384 : 384 * (560 / width);
    const widthScale = Math.max(0.2, 1 + (window.innerWidth - width) / (scrollBar ? width : 560));
    const heightScale = Math.max(0.2, 1 + (window.innerHeight - height - offset) / (scrollBar ? height + offset : 384 + offset));
    const scale = +Math.min(min, widthScale, heightScale).toFixed(3);
    document.documentElement.style.setProperty('--scale-factor', "" + scale);

    const outer = document.getElementsByClassName("outer")[0] as HTMLElement;
    outer.style.transformOrigin = `${window.innerWidth - width < 0 ? embedded ? "0%" : "0%" : "50%"} 0%`;
}
