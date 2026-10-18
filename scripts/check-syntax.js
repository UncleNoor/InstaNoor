'use strict';

// Syntax-checks every JavaScript file under src/ (used by `npm run lint`).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return walk(p);
    return d.name.endsWith('.js') ? [p] : [];
  });
}

let failed = 0;
for (const file of walk(path.join(__dirname, '..', 'src'))) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (e) {
    failed++;
    process.stderr.write(e.stderr.toString());
  }
}
if (failed) process.exit(1);
console.log('All files OK');
