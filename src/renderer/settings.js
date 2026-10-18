'use strict';

const $ = (id) => document.getElementById(id);
const form = $('form');
let settings = {};
const saveTimers = {};

function save(key, value, delay = 0) {
  clearTimeout(saveTimers[key]);
  saveTimers[key] = setTimeout(async () => {
    settings = await window.inoor.setSettings({ [key]: value });
  }, delay);
}

function linkify(text) {
  // Turns "developers.giphy.com" style hosts in help text into links.
  const frag = document.createDocumentFragment();
  const re = /\b((?:developers\.giphy\.com|partner\.klipy\.com))\b/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    frag.append(text.slice(last, m.index));
    const a = document.createElement('a');
    a.href = `https://${m[1]}`;
    a.target = '_blank';
    a.textContent = m[1];
    frag.append(a);
    last = m.index + m[0].length;
  }
  frag.append(text.slice(last));
  return frag;
}

function control(s) {
  const id = `f-${s.key}`;
  const v = settings[s.key];
  if (s.type === 'boolean') {
    const wrap = document.createElement('span');
    wrap.className = 'switch';
    const input = Object.assign(document.createElement('input'), { type: 'checkbox', id, checked: v, role: 'switch' });
    input.addEventListener('change', () => save(s.key, input.checked));
    wrap.append(input);
    return wrap;
  }
  if (s.type === 'select') {
    const sel = Object.assign(document.createElement('select'), { id });
    for (const [val, label] of s.options) sel.append(new Option(label, val, false, val === v));
    sel.addEventListener('change', () => save(s.key, sel.value));
    return sel;
  }
  if (s.type === 'number') {
    const input = Object.assign(document.createElement('input'), { type: 'number', id, value: v, min: s.min, max: s.max });
    input.addEventListener('input', () => save(s.key, Number(input.value || 0), 400));
    return input;
  }
  if (s.type === 'textarea') {
    const ta = Object.assign(document.createElement('textarea'), { id, value: v, spellcheck: false });
    ta.addEventListener('input', () => save(s.key, ta.value, 600));
    return ta;
  }
  if (s.type === 'folder') {
    const box = document.createElement('div');
    box.className = 'folder';
    const input = Object.assign(document.createElement('input'), { type: 'text', id, value: v, placeholder: 'Downloads/InstaNoor', readOnly: true });
    const pick = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Choose…' });
    pick.addEventListener('click', async () => {
      const dir = await window.inoor.pickFolder();
      if (dir) { input.value = dir; save(s.key, dir); }
    });
    const reset = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Default' });
    reset.addEventListener('click', () => { input.value = ''; save(s.key, ''); });
    box.append(input, pick, reset);
    return box;
  }
  const input = Object.assign(document.createElement('input'), { type: 'text', id, value: v, spellcheck: false });
  if (/Key$/.test(s.key)) input.type = 'password';
  input.addEventListener('input', () => save(s.key, input.value.trim(), 500));
  return input;
}

function render(schema) {
  form.textContent = '';
  const groups = new Map();
  for (const s of schema) {
    if (!groups.has(s.group)) {
      const fs = document.createElement('fieldset');
      fs.append(Object.assign(document.createElement('legend'), { textContent: s.group }));
      groups.set(s.group, fs);
      form.append(fs);
    }
    const row = document.createElement('div');
    const wide = ['text', 'textarea', 'folder'].includes(s.type);
    row.className = `field${wide ? ' wide' : ''}`;
    const label = Object.assign(document.createElement('label'), { htmlFor: `f-${s.key}`, textContent: s.label });
    row.append(label, control(s));
    if (s.help) {
      const p = document.createElement('p');
      p.className = 'help';
      p.append(linkify(s.help));
      row.append(p);
    }
    groups.get(s.group).append(row);
  }
}

function fmt(sec) {
  const m = Math.floor(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

async function refreshStats() {
  const { stats } = await window.inoor.getSettings();
  const u = await window.inoor.usage();
  $('stat-ads').textContent = stats.ads;
  $('stat-tracking').textContent = stats.tracking;
  $('stat-seen').textContent = stats.seen;
  $('stat-today').textContent = fmt(u.today);
}

(async () => {
  const data = await window.inoor.getSettings();
  settings = data.settings;
  render(data.schema);
  refreshStats();
  setInterval(refreshStats, 3000);
  window.inoor.onSettings((s) => { settings = s; });
  $('open-follow').addEventListener('click', () => window.inoor.open('follow'));
  $('open-downloads').addEventListener('click', () => window.inoor.open('downloads'));
})();
