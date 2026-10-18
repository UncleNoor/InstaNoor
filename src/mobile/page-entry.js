'use strict';

// Injected by the Android app at document start on www.instagram.com. Unlike the
// desktop app there is no isolated world here: the network hooks and the features
// run together in the page, and talk to the app through window.InoorNative.

const { installPageHooks } = require('../shared/page-hooks');
const { normalizeSettings } = require('../shared/settings-schema');
const { startFeatures, pageConfig } = require('../preload/features');
const { scanFollowLists, diffSnapshots, IG_APP_ID } = require('../main/follow-tracker');
const { createBridge, base64ToBytes } = require('./bridge');

function main() {
  if (window !== window.top || !window.InoorNative || window.__instanoorStarted) return;
  window.__instanoorStarted = true;

  const settings = normalizeSettings(window.__inoorSettings);
  installPageHooks(pageConfig(settings));

  const bridge = createBridge(window.InoorNative);
  bridge.send('hello');

  let sheet = null;
  startFeatures({
    platform: 'android',
    settings,
    setCss(css) {
      // Constructed stylesheets are not subject to the page's CSP, unlike <style>.
      if (!sheet) {
        sheet = new CSSStyleSheet();
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      }
      sheet.replaceSync(css);
      return Promise.resolve();
    },
    send: (channel, data) => bridge.send(channel, data),
    invoke: (channel, data) => bridge.invoke(channel, data),
    on(channel, cb) {
      if (channel === 'gif:attach') {
        bridge.on(channel, (g) => cb({ ...g, bytes: g.b64 ? base64ToBytes(g.b64) : null }));
      } else {
        bridge.on(channel, (data) => cb(channel === 'settings:changed' ? normalizeSettings(data) : data));
      }
    },
    closeWindow: () => bridge.send('app:close'),
  });

  // Follower tracker: the app asks the page to scan, because only the page has
  // Instagram's cookies and same-origin access.
  let scan = null;
  bridge.on('follow:cancel', () => { if (scan) scan.cancelled = true; });
  bridge.on('follow:scan', async ({ userId, prev }) => {
    if (scan) return;
    scan = { cancelled: false };
    const csrf = () => (document.cookie.match(/(?:^|; )csrftoken=([^;]+)/) || [])[1] || '';
    try {
      const snap = await scanFollowLists(userId, {
        fetchPage: async (url) => {
          const r = await fetch(url, {
            credentials: 'include',
            headers: { 'X-IG-App-ID': IG_APP_ID, 'X-CSRFToken': csrf(), 'X-Requested-With': 'XMLHttpRequest' },
          });
          return { status: r.status, body: await r.text() };
        },
        onProgress: (p) => bridge.send('follow:progress', p),
        isCancelled: () => scan.cancelled,
      });
      const result = diffSnapshots(snap, prev);
      bridge.send('follow:done', { snapshot: { ...snap, result }, result });
    } catch (e) {
      bridge.send('follow:done', { error: e.message || String(e) });
    } finally {
      scan = null;
    }
  });
}

main();
