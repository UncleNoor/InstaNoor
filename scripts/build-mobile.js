'use strict';

// Builds the web assets for the Android app into android/app/src/main/assets/.
// Runs automatically before every Gradle build (see android/app/build.gradle).
//
//   instanoor-page.js    injected into instagram.com (src/mobile/page-entry.js)
//   tools/*              Settings, GIF picker and Follower Tracker screens
//   block-patterns.json  network block list shared with the desktop app

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets');

// Minimal CommonJS bundler for our own relative requires.
function bundle(entry) {
  const modules = new Map(); // absolute path -> { id, code }
  const visit = (file) => {
    if (modules.has(file)) return modules.get(file).id;
    const id = modules.size;
    const entryRec = { id, code: '' };
    modules.set(file, entryRec);
    let code = fs.readFileSync(file, 'utf8');
    code = code.replace(/require\((['"])(\.{1,2}\/[^'"]+)\1\)/g, (_m, _q, rel) => {
      let target = path.resolve(path.dirname(file), rel);
      if (!target.endsWith('.js')) target += '.js';
      if (!fs.existsSync(target)) throw new Error(`${path.relative(ROOT, file)}: cannot find ${rel}`);
      return `__req(${visit(target)})`;
    });
    if (/require\(['"](?!\.)/.test(code)) throw new Error(`${path.relative(ROOT, file)} requires a package; mobile code must be dependency-free`);
    entryRec.code = code;
    return id;
  };
  visit(entry);
  const defs = [...modules.entries()].map(([file, m]) =>
    `/* ${path.relative(ROOT, file)} */\n${m.id}: function (module, exports, __req) {\n${m.code}\n}`);
  return `(function () {
'use strict';
var __defs = {
${defs.join(',\n')}
};
var __cache = {};
function __req(id) {
  if (__cache[id]) return __cache[id].exports;
  var module = { exports: {} };
  __cache[id] = module;
  __defs[id](module, module.exports, __req);
  return module.exports;
}
__req(0);
})();
`;
}

function write(rel, content) {
  const p = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function main() {
  fs.rmSync(OUT, { recursive: true, force: true });

  write('instanoor-page.js', bundle(path.join(ROOT, 'src', 'mobile', 'page-entry.js')));
  write('tools/bridge.js', bundle(path.join(ROOT, 'src', 'mobile', 'tool-bridge.js')));

  const renderer = path.join(ROOT, 'src', 'renderer');
  for (const f of fs.readdirSync(renderer)) {
    if (f === 'tool-preload.js') continue;
    let content = fs.readFileSync(path.join(renderer, f), 'utf8');
    if (f.endsWith('.html')) {
      if (!/<script src=/.test(content)) throw new Error(`${f} has no script tag`);
      content = content
        .replace('<script src=', '<script src="bridge.js"></script>\n  <script src=')
        .replace('<html lang="en">', '<html lang="en" class="android">');
    }
    write(`tools/${f}`, content);
  }

  const { TRACKING_PATTERNS, STORY_SEEN_PATTERNS } = require('../src/main/request-filter');
  write('block-patterns.json', JSON.stringify({
    tracking: TRACKING_PATTERNS.map((r) => r.source),
    storySeen: STORY_SEEN_PATTERNS.map((r) => r.source),
  }, null, 2));

  console.log(`Mobile assets written to ${path.relative(ROOT, OUT)}`);
}

if (require.main === module) main();
module.exports = { bundle };
