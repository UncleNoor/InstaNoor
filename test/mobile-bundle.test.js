'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { bundle } = require('../scripts/build-mobile');

const SRC = path.join(__dirname, '..', 'src', 'mobile');

test('Android page and tool bundles build into valid JavaScript', () => {
  for (const entry of ['page-entry.js', 'tool-bridge.js']) {
    const code = bundle(path.join(SRC, entry));
    assert.doesNotThrow(() => new Function(code), entry);
    assert.ok(!/require\(/.test(code.replace(/__req\(/g, '')), `${entry} still has a require()`);
  }
});

test('the Android page bundle does nothing outside the app', () => {
  // Without window.InoorNative (e.g. in a normal browser) the script must bail out.
  const code = bundle(path.join(SRC, 'page-entry.js'));
  const window = {};
  window.top = window;
  assert.doesNotThrow(() => new Function('window', 'document', code)(window, {}));
  assert.strictEqual(window.__instanoorStarted, undefined);
});
