'use strict';

// Preload for the Instagram window. Runs in an isolated world next to the page:
// it injects the network hooks into the page's own world, then adds InstaNoor's
// features on top of Instagram's DOM.

const { ipcRenderer, webFrame } = require('electron');
const { buildPageScript } = require('../shared/page-hooks');
const { buildCss } = require('./styles');
const { SPONSORED_LABELS, SUGGESTED_LABELS, NAV, POST, DM } = require('./selectors');
const { shortcodeToPk, parseIgPath, acceptsType, fileBaseName, formatDuration } = require('./helpers');

let settings = ipcRenderer.sendSync('settings:get-sync');
const pageConfig = (s) => ({ blockAds: s.blockAds, anonymousStories: s.anonymousStories, blockDmSeen: s.blockDmSeen });

// Must run before Instagram's own scripts so fetch/XHR are wrapped from the start.
webFrame.executeJavaScript(buildPageScript(pageConfig(settings)));

// ---------- media index (fed by the page hooks) ----------

const mediaByPk = new Map();
const mediaByCode = new Map();
const profileByUser = new Map();
const pendingLookups = new Map();
let lookupSeq = 0;

window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || e.data.source !== 'instanoor-page') return;
  const msg = e.data;
  if (msg.type === 'media') {
    for (const m of msg.media || []) {
      if (m.pk) mediaByPk.set(m.pk, m);
      if (m.code) mediaByCode.set(m.code, m);
    }
    for (const p of msg.profiles || []) profileByUser.set(p.username.toLowerCase(), p.url);
  } else if (msg.type === 'stat') {
    ipcRenderer.send('stats:add', { ads: msg.ads || 0, seen: msg.seen || 0 });
  } else if (msg.type === 'lookupDone') {
    const done = pendingLookups.get(msg.reqId);
    if (done) { pendingLookups.delete(msg.reqId); done(msg.ok); }
  }
});

function toPage(msg) {
  window.postMessage({ ...msg, source: 'instanoor-preload' }, location.origin);
}

function lookup(kind, key) {
  return new Promise((resolve) => {
    const reqId = ++lookupSeq;
    const timer = setTimeout(() => { pendingLookups.delete(reqId); resolve(false); }, 10000);
    pendingLookups.set(reqId, (ok) => { clearTimeout(timer); resolve(ok); });
    toPage({ type: 'lookup', kind, key, reqId });
  });
}

async function findMedia({ code, pk }) {
  const get = () => (pk && mediaByPk.get(pk)) || (code && mediaByCode.get(code)) || null;
  let m = get();
  if (m) return m;
  const id = pk || shortcodeToPk(code);
  if (id) {
    await lookup('media', id);
    m = get() || mediaByPk.get(id);
  }
  return m || null;
}

async function findProfilePic(username) {
  const key = username.toLowerCase();
  if (!profileByUser.has(key)) await lookup('user', username);
  return profileByUser.get(key) || null;
}

// ---------- small UI helpers ----------

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'onclick') node.addEventListener('click', v);
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

let toastTimer = null;
function toast(text, ms = 3200) {
  document.querySelectorAll('.inoor-toast').forEach((t) => t.remove());
  const t = el('div', { class: 'inoor-toast', role: 'status', text });
  document.documentElement.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), ms);
}

function closeOverlay() {
  document.querySelectorAll('.inoor-overlay[data-dismissable]').forEach((o) => o.remove());
}

function overlay(card, { dismissable = true } = {}) {
  closeOverlay();
  const o = el('div', { class: 'inoor-overlay' }, card);
  if (dismissable) {
    o.dataset.dismissable = '1';
    o.addEventListener('click', (e) => { if (e.target === o) o.remove(); });
  }
  document.documentElement.append(o);
  return o;
}

let cssKey = null;
async function applyCss() {
  const css = buildCss(settings);
  const old = cssKey;
  cssKey = await webFrame.insertCSS(css);
  if (old) webFrame.removeInsertedCSS(old);
}

// ---------- hiding ads, suggestions and the stories tray ----------

function hide(node, reason) {
  if (!node || node.dataset.inoorHide) return false;
  node.dataset.inoorHide = reason;
  node.style.setProperty('display', 'none', 'important');
  return true;
}

function unhideAll() {
  document.querySelectorAll('[data-inoor-hide]').forEach((n) => {
    n.style.removeProperty('display');
    delete n.dataset.inoorHide;
  });
}

function leafTexts(root, labels, maxTop) {
  const out = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const rootTop = maxTop ? root.getBoundingClientRect().top : 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.nodeValue.trim();
    if (t.length > 40 || !labels.has(t)) continue;
    const parent = n.parentElement;
    if (maxTop && t === 'Ad' && parent.getBoundingClientRect().top - rootTop > maxTop) continue;
    out.push(parent);
  }
  return out;
}

// Climbs from a label to the block that holds a group of suggested accounts.
function suggestionBlock(label) {
  let node = label;
  for (let i = 0; i < 7 && node.parentElement; i++) {
    node = node.parentElement;
    if (node.matches('main, body, nav, [role="navigation"]') || node.querySelector('article')) return null;
    if (node.querySelectorAll('a[href^="/"] img').length >= 2) return node;
  }
  return null;
}

let adsHidden = 0;
function hideJunk(where) {
  if (settings.blockAds || settings.hideSuggested) {
    for (const art of document.querySelectorAll(POST.article)) {
      if (Number(art.dataset.inoorChecked || 0) >= 8) continue;
      if (settings.blockAds && leafTexts(art, SPONSORED_LABELS, 90).length) {
        if (hide(art, 'ad')) adsHidden++;
      } else if (settings.hideSuggested && leafTexts(art, SUGGESTED_LABELS).length) {
        hide(art, 'suggested');
      }
      // Articles render in stages; re-check a few times before giving up.
      art.dataset.inoorChecked = String(Number(art.dataset.inoorChecked || 0) + 1);
    }
  }
  if (settings.hideSuggested && (where.kind === 'home' || where.kind === 'explore')) {
    for (const label of leafTexts(document.body, SUGGESTED_LABELS)) {
      if (label.closest('article,[data-inoor-hide]')) continue;
      hide(suggestionBlock(label), 'suggested');
    }
  }
  // Story ads: skip to the next story.
  if (settings.blockAds && where.kind === 'story') {
    const section = document.querySelector('section') || document.body;
    const label = leafTexts(section, SPONSORED_LABELS)[0];
    const next = label && label.getBoundingClientRect().height > 0 && document.querySelector(POST.storyNext);
    if (next) { next.closest('[role="button"],button,div').click(); adsHidden++; }
  }
  if (settings.hideStoriesTray && where.kind === 'home') {
    const canvases = document.querySelectorAll('main canvas');
    if (canvases.length >= 3) {
      let node = canvases[0];
      while (node.parentElement && node.parentElement.querySelectorAll('canvas').length < 3) node = node.parentElement;
      let tray = node.parentElement;
      while (tray && tray.parentElement && !tray.parentElement.matches('main') &&
        !tray.parentElement.querySelector('article') && tray.parentElement.querySelectorAll('canvas').length === tray.querySelectorAll('canvas').length) {
        tray = tray.parentElement;
      }
      if (tray && !tray.matches('main') && !tray.querySelector('article')) hide(tray, 'stories');
    }
  }
  if (adsHidden) {
    ipcRenderer.send('stats:add', { ads: adsHidden });
    adsHidden = 0;
  }
}

// ---------- wide layout ----------

function applyWideLayout(where) {
  if (!settings.wideLayout || where.kind !== 'home') return;
  const art = document.querySelector('main article');
  if (!art || art.dataset.inoorWide) return;
  art.dataset.inoorWide = '1';
  for (let node = art; node && !node.matches('main'); node = node.parentElement) {
    const mw = parseFloat(getComputedStyle(node).maxWidth);
    if (mw >= 400 && mw <= 700) {
      node.style.setProperty('max-width', 'min(860px, 96vw)', 'important');
      node.style.setProperty('width', '100%', 'important');
    }
  }
}

// ---------- downloads ----------

function articleCode(art) {
  for (const a of art.querySelectorAll(POST.permalink)) {
    const info = parseIgPath(new URL(a.href, location.href).pathname);
    if (info.kind === 'post') return info.code;
  }
  return null;
}

function largestVisibleMedia(root) {
  let best = null;
  let area = 0;
  for (const m of root.querySelectorAll('img, video')) {
    const r = m.getBoundingClientRect();
    const a = r.width * r.height;
    if (a > area && r.width > 150) { best = m; area = a; }
  }
  if (!best) return null;
  if (best.tagName === 'VIDEO') {
    const src = best.currentSrc || best.src;
    return src && !src.startsWith('blob:') ? { url: src, isVideo: true } : null;
  }
  const set = (best.srcset || '').split(',').map((s) => s.trim().split(/\s+/)).filter((p) => p[0]);
  set.sort((x, y) => parseInt(y[1] || '0', 10) - parseInt(x[1] || '0', 10));
  return { url: (set[0] && set[0][0]) || best.currentSrc || best.src, isVideo: false };
}

async function downloadMedia(media, fallbackRoot) {
  let files;
  if (media) {
    files = media.items.map((it, i) => ({ url: it.url, isVideo: it.isVideo, name: fileBaseName(media, i) }));
  } else {
    const found = fallbackRoot && largestVisibleMedia(fallbackRoot);
    if (!found) throw new Error('Could not find this media. Open the post and try again.');
    files = [{ ...found, name: `instagram_${Date.now()}` }];
  }
  toast(files.length > 1 ? `Downloading ${files.length} files…` : 'Downloading…');
  await ipcRenderer.invoke('download', files);
  toast(files.length > 1 ? `Saved ${files.length} files` : 'Saved');
}

async function downloadArticle(art) {
  try {
    const code = articleCode(art);
    await downloadMedia(code ? await findMedia({ code }) : null, art);
  } catch (e) {
    toast(e.message || 'Download failed');
  }
}

async function downloadCurrentPage() {
  const where = parseIgPath(location.pathname);
  try {
    if (where.kind === 'post') {
      await downloadMedia(await findMedia({ code: where.code }), document.querySelector('main') || document.body);
    } else if (where.kind === 'story') {
      const media = where.pk ? await findMedia({ pk: where.pk }) : null;
      await downloadMedia(media, document.querySelector('section') || document.body);
    } else if (where.kind === 'profile') {
      await showProfilePicture(where.username);
    } else {
      const art = currentArticle();
      if (art) await downloadArticle(art);
      else toast('Nothing to download here');
    }
  } catch (e) {
    toast(e.message || 'Download failed');
  }
}

async function showProfilePicture(username) {
  toast('Loading full-size picture…', 1500);
  const url = await findProfilePic(username);
  if (!url) return toast('Could not load the profile picture');
  const card = el('div', { class: 'inoor-card inoor-viewer' },
    el('img', { src: url, alt: `@${username}` }),
    el('div', { class: 'inoor-row', style: 'justify-content:center' },
      el('button', { class: 'inoor-btn inoor-primary', text: 'Download', onclick: () => ipcRenderer.invoke('download', [{ url, isVideo: false, name: `${username}_profile` }]).then(() => toast('Saved')) }),
      el('button', { class: 'inoor-btn', text: 'Close', onclick: closeOverlay })));
  overlay(card);
}

function addDownloadButtons(where) {
  if (!settings.downloadButtons) return;
  for (const art of document.querySelectorAll(POST.article)) {
    if (art.querySelector('.inoor-post-dl') || art.dataset.inoorHide) continue;
    if (!art.querySelector('img, video')) continue;
    if (getComputedStyle(art).position === 'static') art.style.position = 'relative';
    art.append(el('button', {
      class: 'inoor-btn inoor-post-dl', title: 'Download (D)', 'aria-label': 'Download', text: '⬇ Save',
      onclick: (e) => { e.preventDefault(); e.stopPropagation(); downloadArticle(art); },
    }));
  }
  const fixed = document.querySelector('.inoor-fixed-dl');
  const wantFixed = where.kind === 'story' || (where.kind === 'post' && !document.querySelector('main article'));
  if (wantFixed && !fixed) {
    document.documentElement.append(el('button', {
      class: 'inoor-btn inoor-fixed-dl', title: 'Download (D)', text: '⬇ Download',
      onclick: downloadCurrentPage,
    }));
  } else if (!wantFixed && fixed) {
    fixed.remove();
  }
  if (where.kind === 'profile') {
    const img = document.querySelector('header img[alt]');
    const holder = img && img.closest('header > div, header > section > div, header div');
    if (holder && !holder.querySelector('.inoor-profile-hd')) {
      if (getComputedStyle(holder).position === 'static') holder.style.position = 'relative';
      holder.append(el('button', {
        class: 'inoor-btn inoor-profile-hd', title: 'View full-size profile picture', text: 'HD',
        onclick: (e) => { e.preventDefault(); e.stopPropagation(); showProfilePicture(where.username); },
      }));
    }
  }
}

// ---------- video ----------

function handleVideos() {
  if (!settings.autoUnmute) return;
  for (const v of document.querySelectorAll('video:not([data-inoor-v])')) {
    v.dataset.inoorV = '1';
    v.addEventListener('play', () => {
      if (!v.muted || v.dataset.inoorUnmuted) return;
      v.dataset.inoorUnmuted = '1';
      const scope = v.closest('article') || v.parentElement.parentElement;
      const btn = scope && scope.querySelector(POST.mutedButton);
      if (btn) btn.closest('button,[role="button"]').click();
      else v.muted = false;
    });
  }
}

function currentVideo() {
  const scope = currentArticle() || document;
  return [...scope.querySelectorAll('video')].find((v) => v.getBoundingClientRect().height > 0) || null;
}

// ---------- navigation rules ----------

let lastPath = null;
function onLocation() {
  const where = parseIgPath(location.pathname);
  const params = new URLSearchParams(location.search);
  if (where.kind === 'home' && settings.feedMode !== 'default' && !params.get('variant')) {
    // Guard against a reload loop if Instagram ever drops the parameter itself.
    let last = 0;
    try { last = Number(sessionStorage.getItem('inoorFeedRedirect') || 0); } catch (e) { /* storage blocked */ }
    if (Date.now() - last > 15000) {
      try { sessionStorage.setItem('inoorFeedRedirect', String(Date.now())); } catch (e) { /* storage blocked */ }
      location.replace(`/?variant=${settings.feedMode}`);
      return where;
    }
  }
  if ((settings.hideReels && where.kind === 'reels-feed') ||
    (settings.hideReels && where.kind === 'post' && location.pathname.startsWith('/reels/')) ||
    (settings.hideExplore && where.kind === 'explore')) {
    location.replace('/');
    return where;
  }
  if (location.pathname !== lastPath) {
    lastPath = location.pathname;
    closeOverlay();
  }
  return where;
}

// ---------- DM GIF button ----------

function findComposer() {
  return [...document.querySelectorAll(DM.composer)].find((b) => b.getBoundingClientRect().height > 0) || null;
}

function placeGifButton(where) {
  let btn = document.querySelector('.inoor-gif-btn');
  const box = where.kind === 'dm-thread' ? findComposer() : null;
  if (!box) { if (btn) btn.remove(); return; }
  if (!btn) {
    btn = el('button', { class: 'inoor-btn inoor-gif-btn', title: 'Send a GIF (Ctrl+G)', 'aria-label': 'Send a GIF', text: 'GIF' });
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => ipcRenderer.invoke('gif:open'));
    document.documentElement.append(btn);
  }
  const r = box.getBoundingClientRect();
  btn.style.left = `${Math.max(8, r.left)}px`;
  btn.style.top = `${Math.max(8, r.top - 40)}px`;
}

function nearestFileInput(box, mime) {
  const inputs = [...document.querySelectorAll(DM.fileInput)].filter((i) => acceptsType(i.accept, mime));
  for (let node = box; node; node = node.parentElement) {
    const hit = inputs.find((i) => node.contains(i));
    if (hit) return hit;
  }
  return inputs[inputs.length - 1] || null;
}

ipcRenderer.on('gif:attach', (_e, gif) => {
  const box = findComposer();
  if (gif.bytes && box) {
    const file = new File([gif.bytes], gif.name, { type: gif.mime });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = nearestFileInput(box, gif.mime);
    if (input) {
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      toast('GIF attached — press Enter to send');
      return;
    }
    box.focus();
    const pasted = !box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    if (pasted) { toast('GIF attached — press Enter to send'); return; }
  }
  if (box && gif.link) {
    box.focus();
    document.execCommand('insertText', false, gif.link);
    toast('GIF link added — press Enter to send');
    return;
  }
  toast('Open a chat first, then pick a GIF');
});

// ---------- focus mode ----------

let todaySeconds = 0;
let unsent = 0;
let continuousSeconds = 0;
let idleSeconds = 0;
let snoozeUntil = 0;
let lastBreakNudge = 0;

ipcRenderer.invoke('usage:get').then((u) => { todaySeconds = u.today; });

function tickUsage() {
  const active = document.visibilityState === 'visible' && document.hasFocus();
  if (active) {
    todaySeconds++; unsent++; continuousSeconds++; idleSeconds = 0;
  } else if (++idleSeconds > 300) {
    continuousSeconds = 0;
  }
  if (unsent >= 15) {
    const n = unsent;
    unsent = 0;
    ipcRenderer.invoke('usage:add', n).then((u) => { todaySeconds = Math.max(todaySeconds, u.today); });
  }

  let timer = document.querySelector('.inoor-timer');
  if (settings.showTimer) {
    if (!timer) { timer = el('div', { class: 'inoor-timer', 'aria-live': 'off' }); document.documentElement.append(timer); }
    timer.textContent = `⏱ ${formatDuration(todaySeconds)} today`;
  } else if (timer) {
    timer.remove();
  }

  const limit = settings.dailyLimitMinutes * 60;
  if (limit && todaySeconds >= limit && Date.now() > snoozeUntil && !document.querySelector('.inoor-limit')) {
    document.querySelectorAll('video').forEach((v) => v.pause());
    const o = overlay(el('div', { class: 'inoor-card' },
      el('h2', { text: 'Daily limit reached' }),
      el('p', { text: `You've spent ${formatDuration(todaySeconds)} on Instagram today. Your limit is ${settings.dailyLimitMinutes} minutes.` }),
      el('div', { class: 'inoor-row' },
        el('button', { class: 'inoor-btn', text: '5 more minutes', onclick: () => { snoozeUntil = Date.now() + 5 * 60000; o.remove(); } }),
        el('button', { class: 'inoor-btn inoor-primary', text: 'Close window', onclick: () => window.close() }))), { dismissable: false });
    o.classList.add('inoor-limit');
  }

  const every = settings.breakReminderMinutes * 60;
  if (every && continuousSeconds >= every && continuousSeconds - lastBreakNudge >= every) {
    lastBreakNudge = continuousSeconds;
    toast(`You've been scrolling for ${Math.round(continuousSeconds / 60)} minutes. Time for a break?`, 8000);
  }
  if (continuousSeconds < lastBreakNudge) lastBreakNudge = 0;
}

// ---------- keyboard shortcuts ----------

function currentArticle() {
  const arts = [...document.querySelectorAll(POST.article)].filter((a) => !a.dataset.inoorHide);
  const mid = window.innerHeight * 0.4;
  return arts.find((a) => { const r = a.getBoundingClientRect(); return r.top <= mid && r.bottom > 80; }) ||
    arts.find((a) => a.getBoundingClientRect().top >= 0) || null;
}

function scrollArticle(dir) {
  const arts = [...document.querySelectorAll(POST.article)].filter((a) => !a.dataset.inoorHide);
  const target = dir > 0
    ? arts.find((a) => a.getBoundingClientRect().top > 70)
    : [...arts].reverse().find((a) => a.getBoundingClientRect().top < -10);
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function clickIcon(selector) {
  const art = currentArticle();
  const icon = (art || document).querySelector(selector);
  const btn = icon && icon.closest('button, [role="button"]');
  if (btn) btn.click();
}

const SHORTCUTS = [
  ['j / k', 'Next / previous post'],
  ['l', 'Like or unlike'],
  ['s', 'Save or unsave'],
  ['d', 'Download post, reel, story or profile picture'],
  ['m', 'Mute or unmute video'],
  ['p', 'Picture-in-picture'],
  ['g h', 'Go home'], ['g m', 'Go to messages'], ['g n', 'Go to notifications'], ['g s', 'Go to saved'],
  ['Ctrl+G', 'Send a GIF (in a chat)'],
  ['Ctrl+,', 'Settings'],
  ['Alt+← / →', 'Back / forward'],
  ['?', 'Show this help'],
];

function showShortcuts() {
  const rows = SHORTCUTS.map(([k, d]) => el('tr', {},
    el('td', { style: 'width:42%' }, ...k.split(' ').map((p) => (p === '/' ? ' / ' : el('kbd', { text: p })))),
    el('td', { text: d })));
  overlay(el('div', { class: 'inoor-card' },
    el('h2', { text: 'Keyboard shortcuts' }),
    el('table', {}, ...rows),
    el('div', { class: 'inoor-row' }, el('button', { class: 'inoor-btn inoor-primary', text: 'Close', onclick: closeOverlay }))));
}
ipcRenderer.on('ui:shortcuts', showShortcuts);

let gPending = 0;
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeOverlay(); return; }
  const t = e.target;
  const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'g') {
    if (parseIgPath(location.pathname).kind === 'dm-thread') {
      e.preventDefault();
      ipcRenderer.invoke('gif:open');
    }
    return;
  }
  if (!settings.keyboardShortcuts || typing || e.ctrlKey || e.metaKey || e.altKey) return;
  const key = e.key;
  if (Date.now() - gPending < 1200) {
    gPending = 0;
    const dest = { h: '/', m: '/direct/inbox/', n: '/notifications/', s: '/saved/' }[key];
    if (dest) { e.preventDefault(); location.assign(dest); }
    return;
  }
  const actions = {
    j: () => scrollArticle(1),
    k: () => scrollArticle(-1),
    l: () => clickIcon(POST.likeIcon),
    s: () => clickIcon(POST.saveIcon),
    d: () => downloadCurrentPage(),
    m: () => { const v = currentVideo(); if (v) v.muted = !v.muted; },
    p: () => { const v = currentVideo(); if (v) (document.pictureInPictureElement ? document.exitPictureInPicture() : v.requestPictureInPicture()).catch(() => toast('Picture-in-picture is not available for this video')); },
    g: () => { gPending = Date.now(); },
    '?': showShortcuts,
  };
  if (actions[key]) {
    e.preventDefault();
    e.stopPropagation();
    actions[key]();
  }
}, true);

// Clicking the Home icon should keep the chosen feed.
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest(NAV.home);
  if (a && settings.feedMode !== 'default' && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    e.stopPropagation();
    location.assign(`/?variant=${settings.feedMode}`);
  }
}, true);

// ---------- main loop ----------

let scheduled = false;
function runPass() {
  scheduled = false;
  if (!document.body) return;
  const where = onLocation();
  hideJunk(where);
  applyWideLayout(where);
  addDownloadButtons(where);
  handleVideos();
  placeGifButton(where);
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(runPass, 250);
}

ipcRenderer.on('settings:changed', (_e, next) => {
  settings = next;
  toPage({ type: 'config', config: pageConfig(settings) });
  unhideAll();
  document.querySelectorAll('[data-inoor-checked]').forEach((n) => delete n.dataset.inoorChecked);
  applyCss();
  schedule();
});

applyCss();
window.addEventListener('DOMContentLoaded', () => {
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', schedule);
  window.addEventListener('scroll', schedule, { passive: true });
  runPass();
  setInterval(schedule, 1000);
  setInterval(tickUsage, 1000);
});
