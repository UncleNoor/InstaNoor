'use strict';

// Loaded first by the Settings, GIF picker and Follower Tracker screens in the
// Android app. Provides the same `window.inoor` API as the desktop app's
// src/renderer/tool-preload.js, backed by the native bridge.

const { SCHEMA, normalizeSettings } = require('../shared/settings-schema');
const { searchGifs } = require('../main/gif-providers');
const { createBridge } = require('./bridge');

// Settings that only make sense on a computer.
const DESKTOP_ONLY = new Set(['downloadFolder', 'keyboardShortcuts', 'wideLayout']);
const schema = SCHEMA.filter((s) => !DESKTOP_ONLY.has(s.key)).map((s) => (
  s.key === 'downloadButtons' ? { ...s, help: 'Saves to Downloads/InstaNoor on your phone.' } : s));

const bridge = createBridge(window.InoorNative);
let current = null;

async function load() {
  const r = await bridge.invoke('settings:get');
  current = normalizeSettings(r.settings);
  return { settings: current, schema, stats: r.stats };
}

// The GIF APIs are called through the app so CORS never gets in the way.
async function nativeFetch(url) {
  const r = await bridge.invoke('http:get', url);
  return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => JSON.parse(r.body) };
}

bridge.on('settings:changed', (s) => { current = normalizeSettings(s); });

window.inoor = {
  platform: 'android',
  getSettings: load,
  async setSettings(partial) {
    if (!current) await load();
    current = normalizeSettings({ ...current, ...partial });
    await bridge.invoke('settings:save', current);
    return current;
  },
  pickFolder: async () => null,
  onSettings: (cb) => bridge.on('settings:changed', (s) => cb(normalizeSettings(s))),
  open: (what) => bridge.invoke('app:open', what),
  usage: () => bridge.invoke('usage:get'),

  async gifSearch(query, cursor) {
    if (!current) await load();
    const { customerId } = await bridge.invoke('app:info');
    return searchGifs(nativeFetch, current, { query, cursor, customerId });
  },
  async gifChoose(gif) {
    if (!current) await load();
    return bridge.invoke('gif:choose', { gif, format: current.gifFormat });
  },

  followLast: () => bridge.invoke('follow:last'),
  followScan: () => bridge.invoke('follow:scan'),
  followCancel: () => bridge.send('follow:cancel'),
  onFollowProgress: (cb) => bridge.on('follow:progress', cb),
  openProfile: (username) => bridge.send('follow:open-profile', username),
};
