/* Colour system for the desk UI (/) — makes the Tailwind palette themeable.
   Tailwind (CDN) is told to read every palette colour from CSS variables, with separate sets for
   backgrounds (--bg-*), text (--tx-*) and borders/rings (--bd-*), so "bg-slate-900 text-white" stays a
   dark chip in dark mode while "text-slate-900" becomes light. Light mode = Tailwind's own values.
   Dark mode = the "rack at night" palette used by /tech and /admin (theme.js sets <html data-theme>).
   Load order: theme.js → tailwind CDN → this file. */
(function () {
  var SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
  var PAL = {"slate":["248 250 252","241 245 249","226 232 240","203 213 225","148 163 184","100 116 139","71 85 105","51 65 85","30 41 59","15 23 42","2 6 23"],"emerald":["236 253 245","209 250 229","167 243 208","110 231 183","52 211 153","16 185 129","5 150 105","4 120 87","6 95 70","6 78 59","2 44 34"],"indigo":["238 242 255","224 231 255","199 210 254","165 180 252","129 140 248","99 102 241","79 70 229","67 56 202","55 48 163","49 46 129","30 27 75"],"rose":["255 241 242","255 228 230","254 205 211","253 164 175","251 113 133","244 63 94","225 29 72","190 18 60","159 18 57","136 19 55","76 5 25"],"amber":["255 251 235","254 243 199","253 230 138","252 211 77","251 191 36","245 158 11","217 119 6","180 83 9","146 64 14","120 53 15","69 26 3"],"blue":["239 246 255","219 234 254","191 219 254","147 197 253","96 165 250","59 130 246","37 99 235","29 78 216","30 64 175","30 58 138","23 37 84"],"teal":["240 253 250","204 251 241","153 246 228","94 234 212","45 212 191","20 184 166","13 148 136","15 118 110","17 94 89","19 78 74","4 47 46"],"purple":["250 245 255","243 232 255","233 213 255","216 180 254","192 132 252","168 85 247","147 51 234","126 34 206","107 33 168","88 28 135","59 7 100"],"orange":["255 247 237","255 237 213","254 215 170","253 186 116","251 146 60","249 115 22","234 88 12","194 65 12","154 52 18","124 45 18","67 20 7"]};
  var FAMS = Object.keys(PAL);
  var SURFACE = [27, 33, 40];

  var num = function (s) { return s.split(' ').map(Number); };
  var str = function (a) { return a.map(function (v) { return Math.round(v); }).join(' '); };
  var mix = function (a, b, t) { return a.map(function (v, i) { return v * (1 - t) + b[i] * t; }); };
  var at = function (fam, shade) { return num(PAL[fam][SHADES.indexOf(shade)]); };

  // dark overrides, per kind: var name suffix -> "r g b"
  var dark = { bg: {}, tx: {}, bd: {} };
  dark.bg['white'] = '27 33 40';
  dark.tx['white'] = '255 255 255';
  dark.bd['white'] = '255 255 255';

  var SL_BG = { 50: '21 26 32', 100: '35 43 52', 200: '43 52 61', 300: '61 73 85', 400: '85 97 109', 500: '111 123 135', 600: '143 155 167', 700: '47 57 68', 800: '15 19 23', 900: '11 14 17', 950: '7 9 11' };
  var SL_TX = { 500: '143 155 167', 600: '169 180 191', 700: '196 204 213', 800: '220 226 232', 900: '230 235 240', 950: '243 246 249' };
  var SL_BD = { 50: '35 43 52', 100: '43 52 61', 200: '52 62 72', 300: '70 82 95', 400: '100 112 124' };
  Object.keys(SL_BG).forEach(function (s) { dark.bg['slate-' + s] = SL_BG[s]; });
  Object.keys(SL_TX).forEach(function (s) { dark.tx['slate-' + s] = SL_TX[s]; });
  Object.keys(SL_BD).forEach(function (s) { dark.bd['slate-' + s] = SL_BD[s]; });

  FAMS.filter(function (f) { return f !== 'slate'; }).forEach(function (f) {
    // soft tints: blend the deep shades into the surface so they stay calm
    dark.bg[f + '-50'] = str(mix(at(f, 950), SURFACE, 0.55));
    dark.bg[f + '-100'] = str(mix(at(f, 900), SURFACE, 0.5));
    dark.bg[f + '-200'] = str(mix(at(f, 800), SURFACE, 0.55));
    dark.tx[f + '-500'] = str(at(f, 400));
    dark.tx[f + '-600'] = str(at(f, 400));
    dark.tx[f + '-700'] = str(at(f, 300));
    dark.tx[f + '-800'] = str(at(f, 200));
    dark.tx[f + '-900'] = str(at(f, 100));
    dark.tx[f + '-950'] = str(at(f, 50));
    dark.bd[f + '-100'] = str(mix(at(f, 900), SURFACE, 0.45));
    dark.bd[f + '-200'] = str(mix(at(f, 800), SURFACE, 0.4));
    dark.bd[f + '-300'] = str(mix(at(f, 700), SURFACE, 0.3));
  });

  var light = '', night = '';
  ['bg', 'tx', 'bd'].forEach(function (kind) {
    light += '--' + kind + '-white:255 255 255;';
    FAMS.forEach(function (f) {
      SHADES.forEach(function (s, i) { light += '--' + kind + '-' + f + '-' + s + ':' + PAL[f][i] + ';'; });
    });
    Object.keys(dark[kind]).forEach(function (k) { night += '--' + kind + '-' + k + ':' + dark[kind][k] + ';'; });
  });

  // circuit colours (inline styles in app.js use var(--ccN-solid|line|mid|soft|ink))
  var CC = [
    { solid: '#2563eb', line: '#3b82f6', mid: '#dbeafe', soft: '#eff6ff', ink: '#1e3a8a', dmid: '#172a4d', dsoft: '#101b33', dink: '#bfd3ff' },
    { solid: '#047857', line: '#10b981', mid: '#d1fae5', soft: '#ecfdf5', ink: '#064e3b', dmid: '#14402f', dsoft: '#0e2a1f', dink: '#a7f0cf' },
    { solid: '#b45309', line: '#f59e0b', mid: '#fde68a', soft: '#fffbeb', ink: '#78350f', dmid: '#473410', dsoft: '#2e2209', dink: '#fde68a' },
    { solid: '#7c3aed', line: '#8b5cf6', mid: '#ede9fe', soft: '#f5f3ff', ink: '#4c1d95', dmid: '#2e2352', dsoft: '#1e1736', dink: '#ddd0ff' },
    { solid: '#be123c', line: '#f43f5e', mid: '#ffe4e6', soft: '#fff1f2', ink: '#881337', dmid: '#4d1a26', dsoft: '#321018', dink: '#ffc2cd' }
  ];
  CC.forEach(function (c, i) {
    var p = '--cc' + i + '-';
    light += p + 'deep:' + c.ink + ';' + p + 'solid:' + c.solid + ';' + p + 'line:' + c.line + ';' + p + 'mid:' + c.mid + ';' + p + 'soft:' + c.soft + ';' + p + 'ink:' + c.ink + ';';
    night += p + 'mid:' + c.dmid + ';' + p + 'soft:' + c.dsoft + ';' + p + 'ink:' + c.dink + ';';
  });
  light += '--ok-ink:#047857;--page-ink:#0f172a;';
  night += '--ok-ink:#6ee7a0;--page-ink:#e6ebf0;';

  var css = ':root{' + light + '}'
    + ':root[data-theme="dark"]{' + night + '}'
    + 'body{background-color:rgb(var(--bg-slate-50));color:rgb(var(--tx-slate-900))}'
    + '::-webkit-scrollbar-track{background:rgb(var(--bg-slate-100))}'
    + '::-webkit-scrollbar-thumb{background:rgb(var(--bd-slate-300))}'
    + '::-webkit-scrollbar-thumb:hover{background:rgb(var(--bd-slate-400))}'
    // the signature pad is always a white sheet with dark ink
    + '.sig-canvas{background-color:#fff!important}'
    // LINE-style chat bubbles stay light, so their text must stay dark
    + '[data-theme="dark"] .bg-\\[\\#a6e379\\]{color:#0f172a!important}'
    + '[data-theme="dark"] .bg-\\[\\#a6e379\\] *{color:inherit}';
  // Bright fills (300-500) that carry dark text in light mode (e.g. bg-amber-400 + text-amber-950) keep that dark text.
  FAMS.filter(function (f) { return f !== 'slate'; }).forEach(function (f) {
    [300, 400, 500].forEach(function (s) {
      css += '[data-theme="dark"] .bg-' + f + '-' + s + '[class*="text-' + f + '-8"],'
        + '[data-theme="dark"] .bg-' + f + '-' + s + '[class*="text-' + f + '-9"]{color:rgb(' + PAL[f][10] + ')}';
    });
  });
  var el = document.createElement('style');
  el.id = 'desk-theme';
  el.textContent = css;
  document.head.appendChild(el);

  // Tailwind: colours come from the variables above
  var ref = function (kind, name) { return 'rgb(var(--' + kind + '-' + name + ') / <alpha-value>)'; };
  var build = function (kind) {
    var o = { white: ref(kind, 'white') };
    FAMS.forEach(function (f) { o[f] = {}; SHADES.forEach(function (s) { o[f][s] = ref(kind, f + '-' + s); }); });
    return o;
  };
  var bg = build('bg');
  window.tailwind = window.tailwind || {};
  window.tailwind.config = {
    theme: { extend: { backgroundColor: bg, gradientColorStops: bg, textColor: build('tx'), borderColor: build('bd'), ringColor: build('bd'), divideColor: build('bd') } }
  };
})();
