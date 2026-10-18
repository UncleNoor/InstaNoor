'use strict';

const { NAV } = require('./selectors');

// Colour themes. Instagram's stylesheet reads "r,g,b" triplets from these
// custom properties, e.g. rgb(var(--ig-primary-background)).
const THEMES = {
  amoled: {
    bg: '0,0,0', bg2: '0,0,0', elevated: '18,18,18', highlight: '28,28,28',
    text: '245,245,245', text2: '168,168,168', separator: '38,38,38', link: '224,241,255',
  },
  midnight: {
    bg: '13,17,33', bg2: '17,22,42', elevated: '24,30,56', highlight: '34,42,76',
    text: '230,235,250', text2: '150,160,190', separator: '40,48,80', link: '140,180,255',
  },
  sepia: {
    bg: '244,236,216', bg2: '236,226,203', elevated: '250,244,230', highlight: '228,216,188',
    text: '60,47,30', text2: '110,95,70', separator: '214,200,170', link: '120,72,20',
  },
};

function themeCss(name) {
  const t = THEMES[name];
  if (!t) return '';
  return `
:root, :root body, .__ig-light-mode, .__ig-dark-mode, html {
  --ig-primary-background: ${t.bg} !important;
  --ig-secondary-background: ${t.bg2} !important;
  --ig-elevated-background: ${t.elevated} !important;
  --ig-elevated-highlight-background: ${t.highlight} !important;
  --ig-highlight-background: ${t.highlight} !important;
  --ig-banner-background: ${t.elevated} !important;
  --ig-primary-text: ${t.text} !important;
  --ig-secondary-text: ${t.text2} !important;
  --ig-tertiary-text: ${t.text2} !important;
  --ig-separator: ${t.separator} !important;
  --ig-elevated-separator: ${t.separator} !important;
  --ig-stroke: ${t.separator} !important;
  --ig-link: ${t.link} !important;
  --web-wash: rgb(${t.bg}) !important;
  --surface-background: rgb(${t.elevated}) !important;
  --card-background: rgb(${t.elevated}) !important;
  --primary-text: rgb(${t.text}) !important;
  --secondary-text: rgb(${t.text2}) !important;
  --divider: rgb(${t.separator}) !important;
}
html, body { background-color: rgb(${t.bg}) !important; }`;
}

// Styles for InstaNoor's own UI (all classes are prefixed with "inoor-").
const UI_CSS = `
.inoor-btn {
  all: unset; box-sizing: border-box; cursor: pointer; z-index: 2147483000;
  font: 600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #fff; background: rgba(0,0,0,.62); backdrop-filter: blur(6px);
  border: 1px solid rgba(255,255,255,.18); border-radius: 999px; padding: 7px 11px;
  display: inline-flex; align-items: center; gap: 6px; transition: background .15s, transform .1s;
}
.inoor-btn:hover { background: rgba(0,0,0,.82); }
.inoor-btn:active { transform: scale(.96); }
.inoor-btn:focus-visible { outline: 2px solid #4f9cff; outline-offset: 2px; }
.inoor-post-dl { position: absolute; top: 12px; right: 52px; opacity: 0; }
article:hover .inoor-post-dl, .inoor-post-dl:focus-visible { opacity: 1; }
.inoor-fixed-dl { position: fixed; right: 20px; bottom: 20px; }
.inoor-gif-btn { position: fixed; }
.inoor-profile-hd { position: absolute; left: 50%; bottom: -14px; transform: translateX(-50%); font-size: 11px; padding: 5px 9px; }
.inoor-timer {
  position: fixed; left: 12px; bottom: 12px; z-index: 2147483000; pointer-events: none;
  font: 600 12px/1 -apple-system, "Segoe UI", Roboto, sans-serif; color: #fff;
  background: rgba(0,0,0,.6); border-radius: 999px; padding: 6px 10px;
}
.inoor-toast {
  position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); z-index: 2147483600;
  font: 500 14px/1.35 -apple-system, "Segoe UI", Roboto, sans-serif; color: #fff;
  background: #262626; border-radius: 10px; padding: 11px 16px; box-shadow: 0 6px 24px rgba(0,0,0,.4);
  max-width: min(480px, 90vw); animation: inoor-in .18s ease-out;
}
@keyframes inoor-in { from { opacity: 0; transform: translate(-50%, 8px); } }
.inoor-overlay {
  position: fixed; inset: 0; z-index: 2147483500; background: rgba(0,0,0,.86);
  display: flex; align-items: center; justify-content: center; padding: 24px;
  font: 400 15px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif; color: #f5f5f5;
}
.inoor-card { background: #1c1c1c; border-radius: 16px; padding: 24px 28px; max-width: 460px; width: 100%; box-shadow: 0 20px 60px rgba(0,0,0,.5); }
.inoor-card h2 { margin: 0 0 8px; font-size: 20px; }
.inoor-card p { margin: 0 0 16px; color: #bdbdbd; }
.inoor-card .inoor-row { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.inoor-card .inoor-primary { background: #0095f6; border-color: #0095f6; }
.inoor-card table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
.inoor-card td { padding: 5px 0; vertical-align: top; }
.inoor-card kbd { font: 600 12px ui-monospace, monospace; background: #333; border-radius: 5px; padding: 2px 6px; margin-right: 3px; }
.inoor-viewer img { max-width: 90vw; max-height: 80vh; border-radius: 12px; display: block; margin: 0 auto 16px; }
.inoor-viewer { text-align: center; }
`;

// Touch screens: no hover, a bottom tab bar, and a floating InstaNoor menu button.
const MOBILE_CSS = `
.inoor-post-dl { opacity: 1; top: 10px; right: 46px; padding: 6px 9px; }
.inoor-fixed-dl { bottom: 84px; right: 14px; }
.inoor-timer { bottom: auto; top: 8px; left: 50%; transform: translateX(-50%); }
.inoor-toast { bottom: 90px; }
.inoor-menu-btn {
  position: fixed; right: 14px; bottom: 136px; width: 40px; height: 40px; padding: 0;
  justify-content: center; font-size: 17px; border-radius: 50%;
  background: linear-gradient(135deg, #0f9b8e, #3a47d5 55%, #8e2de2); border: 0; opacity: .88;
}
.inoor-sheet { display: grid; gap: 10px; }
.inoor-sheet .inoor-btn { justify-content: center; padding: 13px; font-size: 15px; border-radius: 10px; }
.inoor-card { padding: 20px; }
`;

function buildCss(s, platform) {
  const parts = [UI_CSS, themeCss(s.theme)];
  if (platform === 'android') parts.push(MOBILE_CSS);
  if (s.hideReels) parts.push(`${NAV.reels} { display: none !important; }`);
  if (s.hideExplore) parts.push(`${NAV.explore} { display: none !important; }`);
  if (!s.downloadButtons) parts.push('.inoor-post-dl, .inoor-fixed-dl, .inoor-profile-hd { display: none !important; }');
  if (s.customCss) parts.push(s.customCss);
  return parts.join('\n');
}

module.exports = { buildCss, THEMES };
