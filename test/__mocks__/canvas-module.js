function createCanvas(width = 300, height = 150) {
    const canvas = {
        width,
        height,
        getContext() {
            return {
                canvas,
                fillRect() {},
                clearRect() {},
                getImageData(w, h) {
                    return {
                        width: w,
                        height: h,
                        data: new Uint8ClampedArray(w * h * 4),
                    };
                },
                putImageData() {},
                drawImage() {},
                fillStyle: '',
                strokeStyle: '',
                font: '',
                textAlign: 'start',
                textBaseline: 'alphabetic',
                fillText() {},
                measureText() {
                    return { width: 0 };
                },
                createImageData(w, h) {
                    return {
                        width: w,
                        height: h,
                        data: new Uint8ClampedArray(w * h * 4),
                    };
                },
            };
        },
        toBuffer() {
            return Buffer.alloc(0);
        },
        toDataURL() {
            return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
        },
    };
    return canvas;
}

module.exports = {
    createCanvas,
    loadImage: async () => ({ width: 0, height: 0 }),
    Image: class Image {},
};
