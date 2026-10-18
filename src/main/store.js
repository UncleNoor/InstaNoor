'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { normalizeSettings } = require('../shared/settings-schema');

// Small JSON-file store in the app's userData folder. Writes are debounced and
// atomic (write to a temp file, then rename).
class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'instanoor.json');
    this.data = this._load();
    this._timer = null;
  }

  _load() {
    let raw = {};
    try { raw = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (e) { /* first run */ }
    const accounts = Array.isArray(raw.accounts) && raw.accounts.length
      ? raw.accounts.filter((a) => a && typeof a.id === 'string')
      : [{ id: 'main', label: 'Account 1' }];
    return {
      settings: normalizeSettings(raw.settings),
      accounts,
      lastAccount: accounts.some((a) => a.id === raw.lastAccount) ? raw.lastAccount : accounts[0].id,
      usage: raw.usage && typeof raw.usage === 'object' ? raw.usage : {},
      windowBounds: raw.windowBounds || null,
      customerId: typeof raw.customerId === 'string' ? raw.customerId : crypto.randomUUID(),
    };
  }

  save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 300);
  }

  flush() {
    clearTimeout(this._timer);
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  get settings() { return this.data.settings; }

  updateSettings(partial) {
    this.data.settings = normalizeSettings({ ...this.data.settings, ...partial });
    this.save();
    return this.data.settings;
  }

  addUsage(seconds, day = todayKey()) {
    const usage = this.data.usage;
    usage[day] = (usage[day] || 0) + seconds;
    // Keep ~3 months of history.
    const keys = Object.keys(usage).sort();
    while (keys.length > 90) delete usage[keys.shift()];
    this.save();
    return usage[day];
  }

  snapshotFile(userId) {
    return path.join(this.dir, 'follow-snapshots', `${String(userId).replace(/\D/g, '')}.json`);
  }

  readSnapshot(userId) {
    try { return JSON.parse(fs.readFileSync(this.snapshotFile(userId), 'utf8')); } catch (e) { return null; }
  }

  writeSnapshot(userId, snap) {
    const f = this.snapshotFile(userId);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(snap));
  }
}

function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

module.exports = { Store, todayKey };
