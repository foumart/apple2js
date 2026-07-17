require('./canvas-mock-register');

const JsdomEnvironment =
    require('jest-environment-jsdom').default ||
    require('jest-environment-jsdom');

module.exports = JsdomEnvironment;
