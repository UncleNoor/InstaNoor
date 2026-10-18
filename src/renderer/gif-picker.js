'use strict';

const $ = (id) => document.getElementById(id);
const grid = $('grid');
const status = $('status');
const RECENT_KEY = 'inoor-recent-gifs';
let mode = 'trending';
let query = '';
let cursor = null;
let loading = false;
let generation = 0;
let busy = false;

function readRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch (e) { return []; }
}
function pushRecent(gif) {
  const list = [gif, ...readRecent().filter((g) => g.id !== gif.id)].slice(0, 40);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
}

function setStatus(text, { error = false, settingsButton = false } = {}) {
  status.textContent = text;
  status.classList.toggle('error', error);
  if (settingsButton) {
    const b = Object.assign(document.createElement('button'), { className: 'primary', textContent: 'Open Settings' });
    b.addEventListener('click', () => window.inoor.open('settings'));
    status.append(document.createElement('br'), b);
  }
}

function tile(gif) {
  const b = document.createElement('button');
  b.className = 'gif';
  b.title = gif.title || 'GIF';
  const img = new Image();
  img.src = gif.preview;
  img.alt = gif.title || 'GIF';
  img.loading = 'lazy';
  img.width = gif.width;
  img.height = gif.height;
  b.append(img);
  b.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    b.classList.add('sending');
    try {
      pushRecent(gif);
      await window.inoor.gifChoose(gif);
    } catch (e) {
      b.classList.remove('sending');
      setStatus(cleanError(e), { error: true });
    } finally {
      busy = false;
    }
  });
  return b;
}

function cleanError(e) {
  return String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

async function load(reset) {
  if (mode === 'recent') {
    grid.textContent = '';
    const list = readRecent();
    list.forEach((g) => grid.append(tile(g)));
    setStatus(list.length ? '' : 'GIFs you send will show up here.');
    return;
  }
  if (loading || (!reset && cursor === null)) return;
  const gen = reset ? ++generation : generation;
  if (reset) { grid.textContent = ''; cursor = undefined; }
  loading = true;
  setStatus('Loading…');
  try {
    const res = await window.inoor.gifSearch(query, cursor);
    if (gen !== generation) return;
    res.results.forEach((g) => grid.append(tile(g)));
    cursor = res.next;
    setStatus(grid.children.length ? '' : 'No GIFs found.');
  } catch (e) {
    if (gen !== generation) return;
    const msg = cleanError(e);
    setStatus(msg, { error: true, settingsButton: /API key/i.test(msg) });
  } finally {
    loading = false;
  }
}

function selectTab(next) {
  mode = next;
  $('tab-trending').setAttribute('aria-selected', String(next === 'trending'));
  $('tab-recent').setAttribute('aria-selected', String(next === 'recent'));
  $('tab-trending').textContent = query ? 'Results' : 'Trending';
  load(true);
}

let debounce;
$('q').addEventListener('input', (e) => {
  clearTimeout(debounce);
  debounce = setTimeout(() => { query = e.target.value.trim(); selectTab('trending'); }, 300);
});
$('tab-trending').addEventListener('click', () => selectTab('trending'));
$('tab-recent').addEventListener('click', () => selectTab('recent'));
grid.addEventListener('scroll', () => {
  if (grid.scrollTop + grid.clientHeight > grid.scrollHeight - 400) load(false);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });

window.inoor.getSettings().then(({ settings }) => {
  $('powered').textContent = `Powered by ${settings.gifProvider === 'klipy' ? 'KLIPY' : 'GIPHY'}`;
  load(true);
});
