const Module = require('module');
const path = require('path');

const mockPath = path.resolve(__dirname, '../__mocks__/canvas-module.js');
const originalResolveFilename = Module._resolveFilename;

if (!originalResolveFilename.__canvasMockPatched) {
    Module._resolveFilename = function (request, parent, isMain, options) {
        if (request === 'canvas') {
            return mockPath;
        }
        return originalResolveFilename.call(this, request, parent, isMain, options);
    };
    Module._resolveFilename.__canvasMockPatched = true;
}
