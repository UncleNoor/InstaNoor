'use strict';

// Desktop preload for the Instagram window. Runs in an isolated world next to the
// page: it injects the network hooks into the page's own world, then starts the
// shared features with an Electron host.

const { ipcRenderer, webFrame } = require('electron');
const { buildPageScript } = require('../shared/page-hooks');
const { startFeatures, pageConfig } = require('./features');

const settings = ipcRenderer.sendSync('settings:get-sync');

// Must run before Instagram's own scripts so fetch/XHR are wrapped from the start.
webFrame.executeJavaScript(buildPageScript(pageConfig(settings)));

let cssKey = null;
startFeatures({
  platform: 'desktop',
  settings,
  async setCss(css) {
    const old = cssKey;
    cssKey = await webFrame.insertCSS(css);
    if (old) webFrame.removeInsertedCSS(old);
  },
  send: (channel, data) => ipcRenderer.send(channel, data),
  invoke: (channel, data) => ipcRenderer.invoke(channel, data),
  on: (channel, cb) => ipcRenderer.on(channel, (_e, data) => cb(data)),
  closeWindow: () => window.close(),
});
