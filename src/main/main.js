'use strict';

const path = require('path');
const fs = require('fs');
const {
  app, BrowserWindow, Menu, ipcMain, session, shell, dialog, net, Notification, nativeImage,
} = require('electron');
const { Store, todayKey } = require('./store');
const { SCHEMA } = require('../shared/settings-schema');
const { blockReason } = require('./request-filter');
const { searchGifs } = require('./gif-providers');
const { scanFollowLists, diffSnapshots } = require('./follow-tracker');

const IG_HOME = 'https://www.instagram.com/';
// Hosts that may load inside the app window. Everything else opens in the browser.
const IN_APP_HOSTS = /(^|\.)(instagram\.com|facebook\.com|accountscenter\.instagram\.com|fbcdn\.net|cdninstagram\.com)$/;
const RENDERER = (f) => path.join(__dirname, '..', 'renderer', f);

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// Present as regular Chrome; Instagram serves a degraded site to unknown browsers.
app.userAgentFallback = app.userAgentFallback
  .replace(/\s(Electron|instanoor|InstaNoor)\/\S+/gi, '');

let store;
const accountWindows = new Map(); // accountId -> BrowserWindow
const preparedSessions = new Set();
const stats = { ads: 0, tracking: 0, seen: 0 };
let settingsWin = null;
let followWin = null;
let gifWin = null;
let gifTarget = null; // webContents that asked for a GIF
let followScan = null; // { cancelled }

const partitionFor = (accountId) => `persist:ig-${accountId}`;

function allIgWindows() {
  return [...accountWindows.values()].filter((w) => !w.isDestroyed());
}

function focusedIgWindow() {
  const f = BrowserWindow.getFocusedWindow();
  if (f && [...accountWindows.values()].includes(f)) return f;
  const parent = f && f.getParentWindow && f.getParentWindow();
  if (parent && [...accountWindows.values()].includes(parent)) return parent;
  return accountWindows.get(store.data.lastAccount) || allIgWindows()[0] || null;
}

function broadcastSettings() {
  for (const w of [...allIgWindows(), settingsWin].filter((x) => x && !x.isDestroyed())) {
    w.webContents.send('settings:changed', store.settings);
  }
}

// ---------- sessions ----------

function prepareSession(ses) {
  if (preparedSessions.has(ses)) return;
  preparedSessions.add(ses);

  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, cb) => {
    const reason = blockReason(details.url, store.settings);
    if (reason === 'tracking') stats.tracking++;
    if (reason === 'story-seen') stats.seen++;
    cb({ cancel: !!reason });
  });

  ses.setPermissionRequestHandler((wc, permission, cb) => {
    cb(['notifications', 'media', 'clipboard-sanitized-write', 'fullscreen', 'pointerLock'].includes(permission));
  });

  // Instagram's own "download" links and anything else saved through the browser.
  ses.on('will-download', (_e, item) => {
    item.setSavePath(uniquePath(downloadDir(), item.getFilename()));
  });
}

// ---------- windows ----------

function createAccountWindow(accountId) {
  const existing = accountWindows.get(accountId);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return existing;
  }
  const account = store.data.accounts.find((a) => a.id === accountId);
  const ses = session.fromPartition(partitionFor(accountId));
  prepareSession(ses);

  const bounds = store.data.windowBounds || { width: 1200, height: 860 };
  const win = new BrowserWindow({
    ...bounds,
    minWidth: 380,
    minHeight: 500,
    title: account ? `InstaNoor — ${account.label}` : 'InstaNoor',
    backgroundColor: '#000000',
    autoHideMenuBar: process.platform !== 'darwin',
    icon: appIcon(),
    webPreferences: {
      session: ses,
      preload: path.join(__dirname, '..', 'preload', 'instagram.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // The preload loads sibling modules, which a sandboxed preload can't do.
      sandbox: false,
      spellcheck: true,
    },
  });
  accountWindows.set(accountId, win);
  store.data.lastAccount = accountId;
  store.save();

  const wc = win.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    if (isInAppUrl(url) && /instagram\.com/.test(url)) {
      wc.loadURL(url);
    } else {
      openExternal(url);
    }
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (!isInAppUrl(url)) {
      e.preventDefault();
      openExternal(url);
    }
  });

  // "(3) Instagram" → unread badge on the dock / taskbar.
  win.on('page-title-updated', (e, title) => {
    e.preventDefault();
    const m = /^\((\d+)\)/.exec(title);
    const count = m ? Number(m[1]) : 0;
    const label = account ? account.label : '';
    win.setTitle(`${count ? `(${count}) ` : ''}InstaNoor${label ? ` — ${label}` : ''}`);
    updateBadge();
  });

  const saveBounds = () => {
    if (!win.isMaximized() && !win.isMinimized() && !win.isFullScreen()) {
      store.data.windowBounds = win.getBounds();
      store.save();
    }
  };
  win.on('resize', saveBounds);
  win.on('move', saveBounds);
  win.on('closed', () => {
    accountWindows.delete(accountId);
    updateBadge();
  });

  win.loadURL(IG_HOME);
  return win;
}

function updateBadge() {
  let total = 0;
  for (const w of allIgWindows()) {
    const m = /^\((\d+)\)/.exec(w.getTitle());
    if (m) total += Number(m[1]);
  }
  try { app.setBadgeCount(total); } catch (e) { /* unsupported on this platform */ }
}

function isInAppUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && IN_APP_HOSTS.test(u.hostname);
  } catch (e) {
    return false;
  }
}

function openExternal(url) {
  // Unwrap Instagram's link shim (l.instagram.com/?u=...).
  try {
    const u = new URL(url);
    if (u.hostname === 'l.instagram.com' && u.searchParams.get('u')) url = u.searchParams.get('u');
    if (!/^https?:$/.test(new URL(url).protocol)) return;
  } catch (e) {
    return;
  }
  shell.openExternal(url);
}

function appIcon() {
  const p = path.join(__dirname, '..', '..', 'build', 'icon.png');
  return fs.existsSync(p) ? nativeImage.createFromPath(p) : undefined;
}

function toolWindow(file, opts = {}) {
  const parent = focusedIgWindow();
  const win = new BrowserWindow({
    width: opts.width || 520,
    height: opts.height || 640,
    parent: opts.modal ? parent : undefined,
    title: opts.title || 'InstaNoor',
    autoHideMenuBar: true,
    backgroundColor: '#111111',
    icon: appIcon(),
    webPreferences: {
      preload: RENDERER('tool-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(RENDERER(file));
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  return win;
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) return settingsWin.focus();
  settingsWin = toolWindow('settings.html', { title: 'InstaNoor Settings', width: 620, height: 760 });
  settingsWin.on('closed', () => { settingsWin = null; });
}

function openFollowTools() {
  if (followWin && !followWin.isDestroyed()) return followWin.focus();
  followWin = toolWindow('follow.html', { title: 'Follower Tracker', width: 640, height: 760 });
  followWin.on('closed', () => {
    followWin = null;
    if (followScan) followScan.cancelled = true;
  });
}

function openGifPicker(target) {
  gifTarget = target;
  if (gifWin && !gifWin.isDestroyed()) return gifWin.focus();
  gifWin = toolWindow('gif-picker.html', { title: 'Send a GIF', width: 460, height: 620, modal: true });
  gifWin.on('closed', () => { gifWin = null; });
}

// ---------- downloads ----------

function downloadDir() {
  const dir = store.settings.downloadFolder || path.join(app.getPath('downloads'), 'InstaNoor');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function uniquePath(dir, filename) {
  const clean = filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 180) || 'instagram';
  const ext = path.extname(clean);
  const base = clean.slice(0, clean.length - ext.length);
  let p = path.join(dir, clean);
  for (let i = 2; fs.existsSync(p); i++) p = path.join(dir, `${base} (${i})${ext}`);
  return p;
}

const EXT_BY_TYPE = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic', 'image/gif': '.gif', 'video/mp4': '.mp4', 'video/quicktime': '.mov' };

function fileExt(url, contentType, isVideo) {
  const m = /\.(jpe?g|png|webp|heic|mp4|mov|gif)$/i.exec(new URL(url).pathname);
  if (m) return `.${m[1].toLowerCase().replace('jpeg', 'jpg')}`;
  return EXT_BY_TYPE[String(contentType || '').split(';')[0].trim()] || (isVideo ? '.mp4' : '.jpg');
}

async function downloadFiles(ses, files) {
  const saved = [];
  for (const f of files) {
    const res = await ses.fetch(f.url);
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    const name = f.name + fileExt(f.url, res.headers.get('content-type'), f.isVideo);
    const p = uniquePath(downloadDir(), name);
    fs.writeFileSync(p, buf);
    saved.push(p);
  }
  return saved;
}

// ---------- menu ----------

function buildMenu() {
  const go = (p) => () => {
    const w = focusedIgWindow();
    if (w) w.webContents.loadURL(new URL(p, IG_HOME).toString());
  };
  const accountItems = store.data.accounts.map((a, i) => ({
    label: a.label,
    accelerator: i < 9 ? `CmdOrCtrl+Shift+${i + 1}` : undefined,
    click: () => createAccountWindow(a.id),
  }));

  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: openSettings },
        { label: 'Follower Tracker…', accelerator: 'CmdOrCtrl+Shift+F', click: openFollowTools },
        { label: 'Open Downloads Folder', click: () => shell.openPath(downloadDir()) },
        { type: 'separator' },
        { role: process.platform === 'darwin' ? 'close' : 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Back', accelerator: 'Alt+Left', click: () => { const w = focusedIgWindow(); if (w) w.webContents.navigationHistory.goBack(); } },
        { label: 'Forward', accelerator: 'Alt+Right', click: () => { const w = focusedIgWindow(); if (w) w.webContents.navigationHistory.goForward(); } },
        { type: 'separator' },
        { role: 'reload' }, { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }, { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Go',
      submenu: [
        { label: 'Home (Following)', accelerator: 'CmdOrCtrl+1', click: go('/?variant=following') },
        { label: 'Favorites', accelerator: 'CmdOrCtrl+2', click: go('/?variant=favorites') },
        { label: 'Messages', accelerator: 'CmdOrCtrl+3', click: go('/direct/inbox/') },
        { label: 'Notifications', accelerator: 'CmdOrCtrl+4', click: go('/notifications/') },
        { label: 'Saved', accelerator: 'CmdOrCtrl+5', click: go('/saved/') },
        { label: 'Search', accelerator: 'CmdOrCtrl+K', click: go('/explore/search/') },
      ],
    },
    {
      label: 'Accounts',
      submenu: [
        ...accountItems,
        { type: 'separator' },
        { label: 'Add Account…', click: addAccount },
        { label: 'Rename Current Account…', click: renameCurrentAccount },
        { label: 'Remove Current Account…', click: removeCurrentAccount, enabled: store.data.accounts.length > 1 },
      ],
    },
    {
      role: 'help',
      submenu: [
        { label: 'Keyboard Shortcuts', accelerator: 'Shift+/', registerAccelerator: false, click: () => { const w = focusedIgWindow(); if (w) w.webContents.send('ui:shortcuts'); } },
        { label: 'Project on GitHub', click: () => shell.openExternal('https://github.com/UncleNoor/InstaNoor') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function currentAccountId() {
  const w = focusedIgWindow();
  for (const [id, win] of accountWindows) if (win === w) return id;
  return store.data.lastAccount;
}

function addAccount() {
  const n = store.data.accounts.length + 1;
  let id;
  do { id = `acct${Date.now().toString(36)}`; } while (store.data.accounts.some((a) => a.id === id));
  store.data.accounts.push({ id, label: `Account ${n}` });
  store.save();
  buildMenu();
  createAccountWindow(id);
}

async function renameCurrentAccount() {
  const id = currentAccountId();
  const acct = store.data.accounts.find((a) => a.id === id);
  const w = focusedIgWindow();
  if (!acct || !w) return;
  // Use the logged-in username as the label: there is no native prompt dialog.
  const username = await w.webContents.executeJavaScript(`(async () => {
    const r = await fetch('/api/v1/accounts/current_user/?edit=true', {
      credentials: 'include', headers: { 'X-IG-App-ID': '936619743392459', 'X-Requested-With': 'XMLHttpRequest' },
    });
    const j = await r.json();
    return (j.user && j.user.username) || '';
  })()`, true).catch(() => '');
  const { response } = await dialog.showMessageBox(w, {
    type: 'question',
    message: 'Rename account',
    detail: username ? `Use "@${username}" as the name for this account?` : 'Could not read the username. Log in first, then try again.',
    buttons: username ? ['Rename', 'Cancel'] : ['OK'],
  });
  if (username && response === 0) {
    acct.label = `@${username}`;
    store.save();
    buildMenu();
    w.setTitle(`InstaNoor — ${acct.label}`);
  }
}

async function removeCurrentAccount() {
  if (store.data.accounts.length < 2) return;
  const id = currentAccountId();
  const acct = store.data.accounts.find((a) => a.id === id);
  const w = focusedIgWindow();
  const { response } = await dialog.showMessageBox(w, {
    type: 'warning',
    message: `Remove ${acct ? acct.label : 'this account'}?`,
    detail: 'You will be logged out and its window will close.',
    buttons: ['Remove', 'Cancel'],
    defaultId: 1,
  });
  if (response !== 0) return;
  await session.fromPartition(partitionFor(id)).clearStorageData();
  store.data.accounts = store.data.accounts.filter((a) => a.id !== id);
  if (store.data.lastAccount === id) store.data.lastAccount = store.data.accounts[0].id;
  store.save();
  buildMenu();
  if (w) w.close();
  if (!allIgWindows().length) createAccountWindow(store.data.lastAccount);
}

// ---------- IPC ----------

function registerIpc() {
  ipcMain.on('settings:get-sync', (e) => { e.returnValue = store.settings; });
  ipcMain.handle('settings:get', () => ({ settings: store.settings, schema: SCHEMA, stats }));
  ipcMain.handle('settings:set', (_e, partial) => {
    const s = store.updateSettings(partial || {});
    broadcastSettings();
    return s;
  });
  ipcMain.handle('settings:pick-folder', async (e) => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('app:open', (_e, what) => {
    if (what === 'settings') openSettings();
    if (what === 'follow') openFollowTools();
    if (what === 'downloads') shell.openPath(downloadDir());
  });
  ipcMain.on('stats:add', (_e, s) => {
    if (s && Number.isFinite(s.ads)) stats.ads += s.ads;
    if (s && Number.isFinite(s.seen)) stats.seen += s.seen;
  });

  // Focus mode
  ipcMain.handle('usage:add', (_e, seconds) => {
    const s = Math.max(0, Math.min(120, Number(seconds) || 0));
    return { today: store.addUsage(s), day: todayKey() };
  });
  ipcMain.handle('usage:get', () => ({ today: store.data.usage[todayKey()] || 0, history: store.data.usage }));

  // Downloads
  ipcMain.handle('download', async (e, files) => {
    if (!Array.isArray(files) || !files.length) throw new Error('Nothing to download');
    const valid = files.filter((f) => f && typeof f.url === 'string' && /^https:\/\//.test(f.url) && typeof f.name === 'string');
    const saved = await downloadFiles(e.sender.session, valid);
    if (Notification.isSupported()) {
      const n = new Notification({ title: 'Saved', body: saved.length > 1 ? `${saved.length} files saved` : path.basename(saved[0]), silent: true });
      n.on('click', () => shell.showItemInFolder(saved[0]));
      n.show();
    }
    return saved;
  });

  // GIFs
  ipcMain.handle('gif:open', (e) => openGifPicker(e.sender));
  ipcMain.handle('gif:search', (_e, args) => searchGifs(net.fetch, store.settings, { ...args, customerId: store.data.customerId }));
  ipcMain.handle('gif:choose', async (_e, gif) => {
    const target = gifTarget;
    if (!target || target.isDestroyed()) throw new Error('The chat window was closed.');
    const format = store.settings.gifFormat;
    const pageLink = gif.page || gif.gif || gif.mp4;
    if (format === 'link' || (!gif.mp4 && !gif.gif)) {
      target.send('gif:attach', { link: pageLink });
    } else {
      const useMp4 = format === 'mp4' ? !!gif.mp4 : !gif.gif;
      const url = useMp4 ? gif.mp4 : gif.gif;
      if (!/^https:\/\//.test(url)) throw new Error('Invalid GIF URL');
      const res = await net.fetch(url);
      if (!res.ok) throw new Error(`Could not download the GIF (${res.status})`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      target.send('gif:attach', {
        bytes,
        mime: useMp4 ? 'video/mp4' : 'image/gif',
        name: `gif-${Date.now()}.${useMp4 ? 'mp4' : 'gif'}`,
        link: pageLink,
      });
    }
    if (gifWin && !gifWin.isDestroyed()) gifWin.close();
    const w = BrowserWindow.fromWebContents(target);
    if (w) w.focus();
    return true;
  });

  // Follower tracker
  ipcMain.handle('follow:last', async () => {
    const userId = await currentUserId();
    if (!userId) return { loggedIn: false };
    const snap = store.readSnapshot(userId);
    return { loggedIn: true, snapshot: snap ? { takenAt: snap.takenAt, followers: snap.followers.length, following: snap.following.length } : null, result: snap && snap.result ? snap.result : null };
  });
  ipcMain.handle('follow:scan', async (e) => {
    if (followScan) throw new Error('A scan is already running.');
    const win = accountWindows.get(currentAccountIdForFollow());
    if (!win || win.isDestroyed()) throw new Error('Open your Instagram window first.');
    const userId = await currentUserId();
    if (!userId) throw new Error('Log in to Instagram first.');
    const prev = store.readSnapshot(userId);
    followScan = { cancelled: false };
    const reply = e.sender;
    try {
      const snap = await scanFollowLists(userId, {
        runInPage: (code) => win.webContents.executeJavaScript(code, true),
        onProgress: (p) => { if (!reply.isDestroyed()) reply.send('follow:progress', p); },
        isCancelled: () => followScan.cancelled || win.isDestroyed(),
      });
      const result = diffSnapshots(snap, prev);
      store.writeSnapshot(userId, { ...snap, result });
      return result;
    } finally {
      followScan = null;
    }
  });
  ipcMain.handle('follow:cancel', () => { if (followScan) followScan.cancelled = true; });
  ipcMain.handle('follow:open-profile', (_e, username) => {
    const win = accountWindows.get(currentAccountIdForFollow());
    if (win && /^[\w.]+$/.test(username)) {
      win.webContents.loadURL(`${IG_HOME}${username}/`);
      win.focus();
    }
  });
}

function currentAccountIdForFollow() {
  return accountWindows.has(store.data.lastAccount) ? store.data.lastAccount : [...accountWindows.keys()][0];
}

async function currentUserId() {
  const id = currentAccountIdForFollow();
  if (!id) return null;
  const cookies = await session.fromPartition(partitionFor(id)).cookies.get({ url: IG_HOME, name: 'ds_user_id' });
  return cookies[0] ? cookies[0].value : null;
}

// ---------- lifecycle ----------

app.whenReady().then(() => {
  store = new Store(app.getPath('userData'));
  registerIpc();
  buildMenu();
  createAccountWindow(store.data.lastAccount);

  app.on('browser-window-focus', (_e, w) => {
    for (const [id, win] of accountWindows) {
      if (win === w && store.data.lastAccount !== id) {
        store.data.lastAccount = id;
        store.save();
      }
    }
  });
  app.on('activate', () => {
    if (!allIgWindows().length) createAccountWindow(store.data.lastAccount);
  });
});

app.on('second-instance', () => {
  const w = focusedIgWindow();
  if (w) {
    if (w.isMinimized()) w.restore();
    w.focus();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (store) store.flush();
});
