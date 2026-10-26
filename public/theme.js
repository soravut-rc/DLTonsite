/* Theme switch shared by /tech and /admin.
   Modes: auto (follow the device) → dark → light. The choice is remembered in localStorage;
   `?theme=dark|light|auto` in the URL sets it too (handy for sharing a screenshot setup).
   The resolved theme is written to <html data-theme="light|dark"> before first paint. */
(function () {
  var KEY = 'dlt_theme';
  var root = document.documentElement;
  var mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  var NAMES = { auto: 'อัตโนมัติ (ตามเครื่อง)', dark: 'มืด', light: 'สว่าง' };

  function stored() {
    try { var v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'auto'; } catch (e) { return 'auto'; }
  }
  function apply() {
    var mode = stored();
    var theme = mode === 'auto' ? (mq && mq.matches ? 'dark' : 'light') : mode;
    root.dataset.themeMode = mode;
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'dark' ? '#0b0e11' : '#1a2027';
  }
  function set(mode) {
    try { if (mode === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, mode); } catch (e) { /* storage blocked: keep for this page only */ }
    apply();
    document.dispatchEvent(new CustomEvent('dlt-theme', { detail: mode }));
  }

  try {
    var q = new URLSearchParams(location.search).get('theme');
    if (q === 'dark' || q === 'light' || q === 'auto') set(q); else apply();
  } catch (e) { apply(); }
  if (mq && mq.addEventListener) mq.addEventListener('change', function () { if (stored() === 'auto') apply(); });

  window.dltTheme = {
    mode: stored,
    label: function () { return NAMES[stored()]; },
    cycle: function () {
      var order = ['auto', 'dark', 'light'];
      var next = order[(order.indexOf(stored()) + 1) % 3];
      set(next);
      return next;
    }
  };
})();
