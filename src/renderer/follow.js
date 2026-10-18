'use strict';

const $ = (id) => document.getElementById(id);
const TABS = [
  ['notFollowingBack', "Don't follow you back"],
  ['unfollowedYou', 'Unfollowed you'],
  ['newFollowers', 'New followers'],
  ['fans', "You don't follow back"],
];
let result = null;
let tab = 'notFollowingBack';

function cleanError(e) {
  return String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

function when(ts) {
  return ts ? new Date(ts).toLocaleString() : 'never';
}

function renderTabs() {
  const nav = $('tabs');
  nav.textContent = '';
  for (const [key, label] of TABS) {
    const b = document.createElement('button');
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(key === tab));
    b.append(label);
    const c = document.createElement('span');
    c.className = 'count';
    c.textContent = result[key].length;
    b.append(c);
    b.addEventListener('click', () => { tab = key; renderTabs(); renderList(); });
    nav.append(b);
  }
}

function visibleUsers() {
  const f = $('filter').value.trim().toLowerCase();
  return result[tab].filter((u) => !f || u.username.toLowerCase().includes(f) || u.fullName.toLowerCase().includes(f));
}

function renderList() {
  const list = $('list');
  list.textContent = '';
  const users = visibleUsers();
  if (!users.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = tab === 'unfollowedYou' && !result.previousScanAt
      ? 'Run another scan later to see who unfollowed you.'
      : 'Nobody here.';
    list.append(li);
    return;
  }
  for (const u of users) {
    const li = document.createElement('li');
    const img = new Image();
    img.src = u.pic;
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    const who = document.createElement('div');
    who.className = 'who';
    const name = document.createElement('strong');
    name.textContent = `@${u.username}${u.verified ? ' ✓' : ''}`;
    const full = document.createElement('span');
    full.textContent = u.fullName;
    who.append(name, full);
    const open = Object.assign(document.createElement('button'), { textContent: 'Open' });
    open.addEventListener('click', () => window.inoor.openProfile(u.username));
    li.append(img, who, open);
    list.append(li);
  }
}

function show(r) {
  result = r;
  $('results').hidden = false;
  renderTabs();
  renderList();
}

async function refreshLast() {
  const info = await window.inoor.followLast();
  $('scan').disabled = !info.loggedIn;
  if (!info.loggedIn) {
    $('last').textContent = 'Log in to Instagram in the main window first, then reopen this window.';
    return;
  }
  $('last').textContent = info.snapshot
    ? `Last scan: ${when(info.snapshot.takenAt)} — ${info.snapshot.followers} followers, ${info.snapshot.following} following.`
    : 'No scans yet.';
  if (info.result && !result) show(info.result);
}

$('scan').addEventListener('click', async () => {
  $('error').textContent = '';
  $('scan').disabled = true;
  $('cancel').hidden = false;
  $('progress').textContent = 'Starting…';
  try {
    show(await window.inoor.followScan());
    $('progress').textContent = 'Done.';
  } catch (e) {
    $('error').textContent = cleanError(e);
    $('progress').textContent = '';
  } finally {
    $('scan').disabled = false;
    $('cancel').hidden = true;
    refreshLast();
  }
});
$('cancel').addEventListener('click', () => window.inoor.followCancel());
$('filter').addEventListener('input', () => result && renderList());
$('copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText(visibleUsers().map((u) => u.username).join('\n'));
  $('copy').textContent = 'Copied';
  setTimeout(() => { $('copy').textContent = 'Copy usernames'; }, 1500);
});
window.inoor.onFollowProgress((p) => {
  $('progress').textContent = p.waiting
    ? `Instagram asked us to slow down — waiting… (${p.count} ${p.kind} so far)`
    : `Reading ${p.kind}… ${p.count}`;
});

refreshLast();
