'use strict';

// Code in this file runs inside Instagram's own JavaScript world (the preload
// stringifies these functions and injects them), so every function here must be
// self-contained: no imports, no closures over module scope. The pure helpers
// are also exported for the unit tests.

function isFilledObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0;
}

// True when a JSON object from Instagram's API represents a paid ad.
function isAdNode(obj, depth) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  depth = depth || 0;
  if (depth > 3) return false;
  if (obj.ad_id !== undefined && obj.ad_id !== null && obj.ad_id !== '' && obj.ad_id !== 0) return true;
  if (obj.is_ad === true || obj.is_sponsored === true) return true;
  if (isFilledObject(obj.injected) || isFilledObject(obj.ad)) return true;
  if (Array.isArray(obj.ad_metadata) && obj.ad_metadata.length > 0) return true;
  if (typeof obj.__typename === 'string' && /Sponsored|(^|[a-z])Ad(Media|Item|Unit|Story)\b/.test(obj.__typename)) return true;
  // Wrappers used by feeds, reels and stories: {node: ...}, {media: ...}, {media_or_ad: ...}
  for (const k of ['node', 'media', 'media_or_ad', 'item']) {
    if (obj[k] && isAdNode(obj[k], depth + 1)) return true;
  }
  return false;
}

// Removes ad entries from every array in a parsed JSON value, in place.
// Returns the number of entries removed.
function scrubAds(value) {
  let removed = 0;
  const stack = [value];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object') continue;
    if (Array.isArray(cur)) {
      for (let i = cur.length - 1; i >= 0; i--) {
        if (isAdNode(cur[i])) {
          cur.splice(i, 1);
          removed++;
        } else if (cur[i] && typeof cur[i] === 'object') {
          stack.push(cur[i]);
        }
      }
    } else {
      for (const k in cur) {
        const v = cur[k];
        if (v && typeof v === 'object') stack.push(v);
      }
    }
  }
  return removed;
}

function bestCandidate(list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  let best = null;
  let bestArea = -1;
  for (const c of list) {
    if (!c || !c.url) continue;
    const area = (c.width || 0) * (c.height || 0);
    if (area > bestArea) { best = c; bestArea = area; }
  }
  return best ? best.url : null;
}

function mediaUrlOf(obj) {
  const video = bestCandidate(obj.video_versions);
  if (video) return { url: video, isVideo: true };
  const image = bestCandidate(obj.image_versions2 && obj.image_versions2.candidates) || obj.display_url || null;
  if (image) return { url: image, isVideo: false };
  return null;
}

// Finds posts, reels, stories and profile pictures in a parsed API response.
function extractMedia(value) {
  const media = [];
  const profiles = [];
  const seen = new Set();
  const stack = [value];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object') continue;
    if (!Array.isArray(cur)) {
      if ((cur.image_versions2 || cur.video_versions) && (cur.pk || cur.id || cur.code)) {
        const pk = String(cur.pk || String(cur.id || '').split('_')[0] || '');
        const key = pk || cur.code;
        if (!seen.has(key)) {
          seen.add(key);
          const own = mediaUrlOf(cur);
          const children = Array.isArray(cur.carousel_media)
            ? cur.carousel_media.map(mediaUrlOf).filter(Boolean)
            : [];
          if (own || children.length) {
            media.push({
              pk,
              code: cur.code || null,
              username: (cur.user && cur.user.username) || (cur.owner && cur.owner.username) || null,
              takenAt: cur.taken_at || null,
              items: children.length ? children : [own],
            });
          }
        }
      }
      if (typeof cur.username === 'string') {
        const hd = (cur.hd_profile_pic_url_info && cur.hd_profile_pic_url_info.url) ||
          bestCandidate(cur.hd_profile_pic_versions) || cur.profile_pic_url_hd || null;
        if (hd) profiles.push({ username: cur.username, url: hd });
      }
    }
    for (const k in cur) {
      const v = cur[k];
      if (v && typeof v === 'object') stack.push(v);
    }
  }
  return { media, profiles };
}

const STORY_SEEN_RE = /PolarisAPIReelSeenMutation|StoriesV\d*SeenMutation|ReelSeenMutation|viewSeenAt|\/stories\/reel\/seen|\/api\/v1\/media\/seen/i;
const DM_SEEN_RE = /MarkThreadRead|MarkThreadSeen|MarkItemSeen|mark_item_seen|mark_seen|DirectMarkSeen|markThreadAsRead/i;
// Lightspeed (DM websocket) task label for "mark thread read".
const DM_SEEN_WS_RE = /\\*"label\\*"\s*:\s*\\*"21\\*"/;

// Decides whether an outgoing request is a "seen" receipt the user asked to hide.
function classifySeenRequest(text, opts) {
  if (!text) return null;
  if (opts.anonymousStories && STORY_SEEN_RE.test(text)) return 'story';
  if (opts.blockDmSeen && DM_SEEN_RE.test(text)) return 'dm';
  return null;
}

// Parses an Instagram response body. Handles the "for (;;);" anti-JSON-hijack
// prefix and newline-separated multi-part (deferred) GraphQL payloads.
function parseIgBody(text) {
  let prefix = '';
  let body = text;
  const m = /^\s*for\s*\(;;\);/.exec(body);
  if (m) { prefix = m[0]; body = body.slice(m[0].length); }
  try {
    return { prefix, parts: [JSON.parse(body)], sep: null };
  } catch (e) {
    const sep = body.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
    const chunks = body.split(sep);
    if (chunks.length < 2) return null;
    const parts = [];
    for (const c of chunks) {
      if (!c.trim()) { parts.push(null); continue; }
      try { parts.push(JSON.parse(c)); } catch (e2) { return null; }
    }
    return { prefix, parts, sep };
  }
}

function serializeIgBody(parsed) {
  if (parsed.sep === null) return parsed.prefix + JSON.stringify(parsed.parts[0]);
  return parsed.prefix + parsed.parts.map((p) => (p === null ? '' : JSON.stringify(p))).join(parsed.sep);
}

// Inspects one response body: indexes media, removes ads. Returns the new body
// text, or null when the body should be passed through untouched.
function processIgBody(text, cfg, report) {
  if (typeof text !== 'string' || text.length < 2) return null;
  const parsed = parseIgBody(text);
  if (!parsed) return null;
  let removed = 0;
  for (const part of parsed.parts) {
    if (!part) continue;
    if (cfg.blockAds) removed += scrubAds(part);
    const found = extractMedia(part);
    if (found.media.length || found.profiles.length) report({ type: 'media', media: found.media, profiles: found.profiles });
  }
  if (removed) report({ type: 'stat', ads: removed });
  return removed ? serializeIgBody(parsed) : null;
}

function installPageHooks(initialCfg) {
  if (window.__instanoorHooks) return;
  window.__instanoorHooks = true;
  const cfg = Object.assign({}, initialCfg);
  const API_RE = /\/(api\/graphql|graphql\/query|api\/v1\/)/;

  const report = (msg) => {
    try {
      msg.source = 'instanoor-page';
      window.postMessage(msg, location.origin);
    } catch (e) { /* ignore */ }
  };

  // Lookups requested by the preload (e.g. a download of a post that hasn't been
  // indexed yet). The response flows through the fetch hook below, which indexes it.
  const lookup = async (msg) => {
    const urls = {
      user: '/api/v1/users/web_profile_info/?username=' + encodeURIComponent(msg.key),
      media: '/api/v1/media/' + encodeURIComponent(msg.key) + '/info/',
    };
    let ok = false;
    try {
      const r = await window.fetch(urls[msg.kind], {
        credentials: 'include',
        headers: { 'X-IG-App-ID': '936619743392459', 'X-Requested-With': 'XMLHttpRequest' },
      });
      ok = r.ok;
      await r.text();
    } catch (e) { /* reported as not ok */ }
    report({ type: 'lookupDone', reqId: msg.reqId, ok });
  };

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== 'instanoor-preload') return;
    if (e.data.type === 'config') Object.assign(cfg, e.data.config);
    if (e.data.type === 'lookup') lookup(e.data);
  });

  const bodyToText = (body) => {
    if (!body) return '';
    if (typeof body === 'string') return body;
    if (body instanceof URLSearchParams) return body.toString();
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      let s = '';
      body.forEach((v, k) => { if (typeof v === 'string') s += k + '=' + v + '&'; });
      return s;
    }
    return '';
  };
  const headersToText = (h) => {
    if (!h) return '';
    try { return Array.from(new Headers(h).entries()).map((p) => p.join(':')).join('\n'); } catch (e) { return ''; }
  };
  const FAKE_OK = '{"status":"ok","data":{}}';

  // ---- fetch ----
  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    const reqText = url + '\n' + bodyToText(init && init.body) + '\n' + headersToText((init && init.headers) || (input && input.headers));
    const seen = classifySeenRequest(reqText, cfg);
    if (seen) {
      report({ type: 'stat', seen: 1, kind: seen });
      return new Response(FAKE_OK, { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const res = await origFetch.apply(this, arguments);
    if (!API_RE.test(url) || !res.ok) return res;
    try {
      const text = await res.clone().text();
      const changed = processIgBody(text, cfg, report);
      if (changed === null) return res;
      const out = new Response(changed, { status: res.status, statusText: res.statusText, headers: res.headers });
      Object.defineProperty(out, 'url', { value: res.url });
      return out;
    } catch (e) {
      return res;
    }
  };

  // ---- XMLHttpRequest ----
  const XHR = XMLHttpRequest.prototype;
  const origOpen = XHR.open;
  const origSend = XHR.send;
  const origSetHeader = XHR.setRequestHeader;
  XHR.open = function (method, url) {
    this.__inoorUrl = String(url);
    this.__inoorHeaders = '';
    this.__inoorDone = undefined;
    return origOpen.apply(this, arguments);
  };
  XHR.setRequestHeader = function (k, v) {
    this.__inoorHeaders = (this.__inoorHeaders || '') + k + ':' + v + '\n';
    return origSetHeader.apply(this, arguments);
  };
  XHR.send = function (body) {
    const seen = classifySeenRequest((this.__inoorUrl || '') + '\n' + bodyToText(body) + '\n' + (this.__inoorHeaders || ''), cfg);
    if (!seen) return origSend.apply(this, arguments);
    report({ type: 'stat', seen: 1, kind: seen });
    const xhr = this;
    const define = (k, v) => Object.defineProperty(xhr, k, { configurable: true, get: () => v });
    setTimeout(() => {
      define('readyState', 4);
      define('status', 200);
      define('statusText', 'OK');
      define('responseText', FAKE_OK);
      define('response', xhr.responseType === 'json' ? JSON.parse(FAKE_OK) : FAKE_OK);
      for (const t of ['readystatechange', 'load', 'loadend']) xhr.dispatchEvent(new Event(t));
    }, 30);
  };

  const patchGetter = (prop) => {
    const desc = Object.getOwnPropertyDescriptor(XHR, prop);
    if (!desc || !desc.get) return;
    Object.defineProperty(XHR, prop, {
      configurable: true,
      enumerable: desc.enumerable,
      get() {
        const original = desc.get.call(this);
        if (this.readyState !== 4 || !API_RE.test(this.__inoorUrl || '')) return original;
        if (this.responseType !== '' && this.responseType !== 'text' && this.responseType !== 'json') return original;
        if (this.__inoorDone === undefined) {
          this.__inoorDone = null;
          try {
            const raw = this.responseType === 'json' ? JSON.stringify(original) : original;
            this.__inoorDone = processIgBody(raw, cfg, report);
          } catch (e) { /* pass through */ }
        }
        if (this.__inoorDone === null) return original;
        if (this.responseType === 'json' && prop === 'response') return JSON.parse(this.__inoorDone);
        return this.__inoorDone;
      },
    });
  };
  patchGetter('responseText');
  patchGetter('response');

  // ---- WebSocket (DM read receipts) ----
  const origWsSend = WebSocket.prototype.send;
  const decoder = new TextDecoder('utf-8', { fatal: false });
  WebSocket.prototype.send = function (data) {
    if (cfg.blockDmSeen && /edge-chat|chat-e2ee|instagram\.com/.test(this.url || '')) {
      let text = '';
      try {
        if (typeof data === 'string') text = data;
        else if (data instanceof ArrayBuffer) text = decoder.decode(new Uint8Array(data));
        else if (ArrayBuffer.isView(data)) text = decoder.decode(data);
      } catch (e) { /* ignore */ }
      if (text && (DM_SEEN_WS_RE.test(text) || DM_SEEN_RE.test(text))) {
        report({ type: 'stat', seen: 1, kind: 'dm' });
        return undefined;
      }
    }
    return origWsSend.apply(this, arguments);
  };

  // ---- media embedded in the initial HTML ----
  const scanEmbedded = () => {
    for (const s of document.querySelectorAll('script[type="application/json"]')) {
      if (s.__inoorScanned) continue;
      s.__inoorScanned = true;
      const t = s.textContent || '';
      if (t.indexOf('image_versions2') < 0 && t.indexOf('profile_pic_url') < 0) continue;
      try {
        const found = extractMedia(JSON.parse(t));
        if (found.media.length || found.profiles.length) report({ type: 'media', media: found.media, profiles: found.profiles });
      } catch (e) { /* ignore */ }
    }
  };
  document.addEventListener('DOMContentLoaded', scanEmbedded);
  setInterval(scanEmbedded, 3000);
}

// Builds the source code that the preload injects into the page.
function buildPageScript(cfg) {
  const fns = [isFilledObject, isAdNode, scrubAds, bestCandidate, mediaUrlOf, extractMedia, classifySeenRequest,
    parseIgBody, serializeIgBody, processIgBody, installPageHooks];
  return '(function(){' +
    'const STORY_SEEN_RE=' + STORY_SEEN_RE.toString() + ';' +
    'const DM_SEEN_RE=' + DM_SEEN_RE.toString() + ';' +
    'const DM_SEEN_WS_RE=' + DM_SEEN_WS_RE.toString() + ';' +
    fns.map((f) => f.toString()).join('\n') +
    '\ninstallPageHooks(' + JSON.stringify(cfg) + ');})();';
}

module.exports = {
  isAdNode, scrubAds, extractMedia, classifySeenRequest, parseIgBody, serializeIgBody,
  processIgBody, buildPageScript,
};
