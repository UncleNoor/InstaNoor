'use strict';

// Bridge for InstaNoor's own windows (settings, GIF picker, follower tracker).
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => ipcRenderer.on(channel, (_e, data) => cb(data));

contextBridge.exposeInMainWorld('inoor', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (partial) => ipcRenderer.invoke('settings:set', partial),
  pickFolder: () => ipcRenderer.invoke('settings:pick-folder'),
  onSettings: on('settings:changed'),
  open: (what) => ipcRenderer.invoke('app:open', what),
  usage: () => ipcRenderer.invoke('usage:get'),

  gifSearch: (query, cursor) => ipcRenderer.invoke('gif:search', { query, cursor }),
  gifChoose: (gif) => ipcRenderer.invoke('gif:choose', gif),

  followLast: () => ipcRenderer.invoke('follow:last'),
  followScan: () => ipcRenderer.invoke('follow:scan'),
  followCancel: () => ipcRenderer.invoke('follow:cancel'),
  onFollowProgress: on('follow:progress'),
  openProfile: (username) => ipcRenderer.invoke('follow:open-profile', username),
});
