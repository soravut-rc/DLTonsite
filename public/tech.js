/* ==========================================================================
   DLT Onsite — Technician app
   Single-page, hash-routed, no build step. Talks to the same REST API as the
   desk UI (/api/circuits, /api/upload, checkin / checkout).
   ========================================================================== */
(() => {
  'use strict';

  /* ------------------------------------------------------------------------
     Small helpers
     ------------------------------------------------------------------------ */
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (_) { return fallback; } },
    set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) { /* storage full or blocked */ } }
  };
  const LS = { profile: 'dlt_tech_profile_v1', index: 'dlt_tech_index_v1', recent: 'dlt_tech_recent_v1', ops: 'dlt_tech_ops_v1', jobs: 'dlt_tech_jobs_v1' };
  const normSn = s => String(s || '').trim().toUpperCase().replace(/[\s-]+/g, '');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const fmtTime = iso => {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
  };

  const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
  const ICON = {
    back: svg('<path d="M15 5l-7 7 7 7"/>'),
    search: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
    camera: svg('<path d="M4 8h3l1.6-2.4h6.8L17 8h3v11H4z"/><circle cx="12" cy="13.5" r="3.6"/>'),
    check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    alert: svg('<path d="M12 4l9 16H3z"/><path d="M12 10v4.5M12 17.6v.1"/>'),
    chevron: svg('<path d="M9 5l7 7-7 7"/>'),
    down: svg('<path d="M6 9l6 6 6-6"/>'),
    pin: svg('<path d="M12 21s7-6.2 7-11.5A7 7 0 005 9.5C5 14.800 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
    user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 20c1.2-4 4.200-5.500 8-5.500s6.800 1.500 8 5.500"/>'),
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    retry: svg('<path d="M20 11a8 8 0 10-2.400 5.700"/><path d="M20 5v6h-6"/>'),
    cloudOff: svg('<path d="M3 3l18 18"/><path d="M8.500 6.500A6 6 0 0118 10a4 4 0 012.500 7"/><path d="M6.500 18A4.500 4.500 0 016 9.100"/>'),
    list: svg('<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>')
  };

  /** RJ45 jack with its status LED — the "next action" badge on the Site screen. */
  const jack = led => `<div class="jack" aria-hidden="true"><i class="led led--${led}"></i><svg viewBox="0 0 40 36" fill="none"><path d="M5 6h30v18h-8v6H13v-6H5z" stroke="#7d8996" stroke-width="2" stroke-linejoin="round"/><g stroke="#d9a53a" stroke-width="2" stroke-linecap="square"><path d="M12 11v7M16 11v7M20 11v7M24 11v7M28 11v7"/></g></svg></div>`;

  const thaiDate = iso => {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('th-TH-u-ca-buddhist', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' });
  };

  /** Approval stamp (blue ink) — the same mark the reviewer sees in /admin. */
  const stampSvg = iso => `<svg class="stamp" viewBox="0 0 100 100" fill="none" stroke="currentColor" role="img" aria-label="ตราอนุมัติ ${esc(thaiDate(iso))}">
    <circle cx="50" cy="50" r="46" stroke-width="3"/><circle cx="50" cy="50" r="38" stroke-width="1.2"/>
    <defs><path id="stampRing" d="M50 50 m-31 0 a31 31 0 1 1 62 0 a31 31 0 1 1 -62 0"/></defs>
    <text font-size="9" font-weight="700" fill="currentColor" stroke="none" letter-spacing="1.2"><textPath href="#stampRing">ตรวจรับงาน · ตรวจรับงาน · ตรวจรับงาน ·</textPath></text>
    <text x="50" y="52" text-anchor="middle" font-size="15" font-weight="700" fill="currentColor" stroke="none">อนุมัติ</text>
    <text x="50" y="65" text-anchor="middle" font-size="7.5" font-weight="700" fill="currentColor" stroke="none">${esc(thaiDate(iso))}</text>
  </svg>`;

  /* ------------------------------------------------------------------------
     Global state
     ------------------------------------------------------------------------ */
  const S = {
    profile: store.get(LS.profile, { name: '', phone: '' }),
    index: [],                 // compact Site index for search
    indexLoaded: false,
    indexError: '',
    query: '',
    province: '',
    near: null,                // [{site, km}]
    site: null,                // { key, entry, circuits: [full circuit objects], loading, error }
    previews: {},              // `${so}|${slot}` -> data URL while upload is pending
    jobs: store.get(LS.jobs, []),  // pending photo uploads [{id, so, slot}]
    ops: store.get(LS.ops, []),    // un-synced field edits [{id, so, t, i, k, v}]
    opSeq: 0,
    sync: 'ok',                // ok | busy | offline
    cap: { busy: '', ocrNote: '', ocrPct: 0 },  // capture screen transient state
    recent: store.get(LS.recent, []),
    toastTimer: 0
  };
  S.opSeq = S.ops.reduce((m, o) => Math.max(m, o.id || 0), 0);

  /* ------------------------------------------------------------------------
     API
     ------------------------------------------------------------------------ */
  async function api(path, opts = {}) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeout || 30000);
    try {
      const res = await fetch(path, {
        method: opts.method || 'GET',
        headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: ctl.signal
      });
      let data = null;
      try { data = await res.json(); } catch (_) { /* non-JSON */ }
      if (!res.ok && !(data && data.incomplete)) {
        const err = new Error((data && (data.error || data.message)) || `เซิร์ฟเวอร์ตอบกลับผิดพลาด (${res.status})`);
        err.status = res.status;
        throw err;
      }
      return data;
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('การเชื่อมต่อช้าเกินไป');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /* ------------------------------------------------------------------------
     IndexedDB — holds photo data URLs until they are uploaded
     ------------------------------------------------------------------------ */
  const idb = (() => {
    let dbp;
    const open = () => dbp || (dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open('dlt_tech', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('photos');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
    const run = async (mode, fn) => {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('photos', mode);
        const r = fn(tx.objectStore('photos'));
        tx.oncomplete = () => resolve(r && r.result);
        tx.onerror = () => reject(tx.error);
      });
    };
    return {
      put: (k, v) => run('readwrite', s => s.put(v, k)).catch(() => {}),
      get: k => run('readonly', s => s.get(k)).catch(() => undefined),
      del: k => run('readwrite', s => s.delete(k)).catch(() => {})
    };
  })();

  /* ------------------------------------------------------------------------
     Site index (search)
     ------------------------------------------------------------------------ */
  function parseLL(str) {
    const m = String(str || '').match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    return m ? { lat: +m[1], lng: +m[2] } : null;
  }

  function buildIndex(list) {
    const map = new Map();
    for (const c of list) {
      const key = c.site_key || `${c.province}::${c.branch_name}`;
      let s = map.get(key);
      if (!s) {
        s = {
          key,
          name: c.site_name || c.short_branch_name || c.branch_name || key,
          province: c.province || '',
          region: c.region || '',
          address: c.address || '',
          ll: parseLL(c.lat_long),
          circ: [],
          q: ''
        };
        map.set(key, s);
      }
      if (!s.ll) s.ll = parseLL(c.lat_long);
      s.circ.push({
        so: c.so_number,
        svc: c.service_no || '',
        ck: Boolean(c.checkin_time),
        co: Boolean(c.checkout_time),
        ad: c.admin_status || '',
        lk: Boolean(c.locked),
        st: c.status || '',
        ph: c.onsite_photo_count ?? c.photo_count ?? 0,
        rq: c.onsite_required_count ?? c.required_photo_count ?? 0,
        up: c.updated_at || ''
      });
    }
    const out = [];
    for (const s of map.values()) {
      s.circ.sort((a, b) => a.so.localeCompare(b.so));
      s.q = `${s.name} ${s.province} ${s.region} ${s.address} ${s.circ.map(x => `${x.so} ${x.svc}`).join(' ')}`.toLowerCase();
      out.push(s);
    }
    out.sort((a, b) => a.province.localeCompare(b.province, 'th') || a.name.localeCompare(b.name, 'th'));
    return out;
  }

  function siteState(s) {
    const c = s.circ;
    if (c.every(x => x.ad === 'approved')) return 'done';
    if (c.some(x => x.ad === 'rejected' || x.st === 'issue')) return 'rework';
    if (c.every(x => x.co)) return 'submitted';
    if (c.some(x => x.ck || x.ph > 0)) return 'doing';
    return 'todo';
  }
  const STATE_LABEL = {
    todo: ['ยังไม่เริ่ม', ''],
    doing: ['กำลังทำ', 'chip--doing'],
    submitted: ['ส่งตรวจแล้ว', 'chip--ok'],
    done: ['ผ่านแล้ว', 'chip--ok'],
    rework: ['ต้องแก้ไข', 'chip--bad']
  };

  async function loadIndex() {
    const cached = store.get(LS.index, null);
    if (cached && Array.isArray(cached.sites)) {
      S.index = cached.sites;
      S.indexLoaded = true;
      if (isHome()) renderHomeResults();
    }
    try {
      const data = await api('/api/circuits', { timeout: 45000 });
      S.index = buildIndex(data.circuits || []);
      S.indexLoaded = true;
      S.indexError = '';
      store.set(LS.index, { at: Date.now(), sites: S.index });
    } catch (err) {
      S.indexError = S.index.length ? '' : err.message;
    }
    if (isHome()) renderHomeResults();
  }

  /* ------------------------------------------------------------------------
     Circuit model — the slots a technician has to fill
     ------------------------------------------------------------------------ */
  const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isNaN(n) ? null : n; };
  function parseTarget(str, fallback) {
    const m = String(str || '').match(/(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/);
    return m ? { dl: +m[1], ul: +m[2] } : fallback;
  }
  const apRoom = (ap, i) => (ap.room_type ? `ห้อง ${ap.room_type}` : (ap.room || `จุดที่ ${i + 1}`));
  const apPlace = ap => ap.location_detail || [ap.building && `อาคาร ${ap.building}`, ap.floor && `ชั้น ${ap.floor}`].filter(Boolean).join(' ');

  function snState(o) {
    const s = normSn(o.serial_no);
    const r = normSn(o.ocr_serial_no);
    if (s && r) return s === r ? 'matched' : 'mismatch';
    if (s) return o.sn_confirmed ? 'confirmed' : 'check';
    return 'missing';
  }
  const snOk = st => st === 'matched' || st === 'confirmed';

  const previewKey = (so, slot) => `${so}|${slot}`;
  const hasPhoto = (url, so, slot) => Boolean(url) || Boolean(S.previews[previewKey(so, slot)]);

  /** Build the ordered slot list for one circuit. */
  function modelOf(c) {
    const rt = c.router_info || {};
    const so = c.so_number;
    const slots = [];
    const rTarget = parseTarget(rt.speed_target || c.speed_pkg, { dl: 650, ul: 350 });
    const rPlace = [rt.room && `ห้อง ${String(rt.room).replace(/^ห้อง\s*/, '')}`, rt.floor && `ชั้น ${rt.floor}`].filter(Boolean).join(' · ');

    const mk = (o) => Object.assign({ so, done: false }, o);
    const rSn = snState(rt);
    slots.push(mk({
      key: 'router_device', kind: 'device', target: 'router', group: 'router',
      title: 'MikroTik · ถ่ายเครื่อง + Sticker S/N', place: rPlace,
      has: hasPhoto(rt.photo_device, so, 'router_device'), sn: rSn,
      done: hasPhoto(rt.photo_device, so, 'router_device') && snOk(rSn),
      blocked: rSn === 'mismatch', field: 'photo_device', obj: rt
    }));
    for (const [n, k] of [['2', 'lan2'], ['3', 'lan3']]) {
      const key = `router_${k}`;
      const has = hasPhoto(rt[`photo_${k}`], so, key);
      slots.push(mk({
        key, kind: 'speed', target: 'router', group: 'router', port: n,
        title: `MikroTik · เทสความเร็ว Port LAN ${n}`, place: rPlace,
        has, done: has, field: `photo_${k}`, obj: rt, minDl: rTarget.dl, minUl: rTarget.ul,
        dlKey: `speed_${k}_dl`, ulKey: `speed_${k}_ul`
      }));
    }

    const aps = Array.isArray(c.access_points) ? c.access_points : [];
    aps.forEach((ap, i) => {
      if (!ap || ap.checked === false) return;
      const room = apRoom(ap, i);
      const place = apPlace(ap);
      const lanT = parseTarget(ap.lan_target, { dl: 300, ul: 150 });
      const wifiT = parseTarget(ap.wifi_target, { dl: 50, ul: 20 });
      const sn = snState(ap);
      const base = { target: `ap:${i}`, group: `ap${i}`, apIndex: i, obj: ap, room, place, isGecc: ap.room_type === 'GECC' };
      slots.push(mk({
        ...base, key: `ap_${i}_device`, kind: 'device', title: `AP ${room} · ถ่ายเครื่อง + Sticker S/N`,
        has: hasPhoto(ap.photo_device, so, `ap_${i}_device`), sn,
        done: hasPhoto(ap.photo_device, so, `ap_${i}_device`) && snOk(sn), blocked: sn === 'mismatch', field: 'photo_device'
      }));
      slots.push(mk({
        ...base, key: `ap_${i}_wifi`, kind: 'speed', title: `AP ${room} · เทสความเร็ว WiFi`, mode: 'WiFi',
        has: hasPhoto(ap.photo_wifi, so, `ap_${i}_wifi`), done: hasPhoto(ap.photo_wifi, so, `ap_${i}_wifi`),
        field: 'photo_wifi', minDl: wifiT.dl, minUl: wifiT.ul, dlKey: 'speed_wifi_dl', ulKey: 'speed_wifi_ul'
      }));
      slots.push(mk({
        ...base, key: `ap_${i}_lan`, kind: 'speed', title: `AP ${room} · เทสความเร็วสาย LAN`, mode: 'สาย LAN',
        has: hasPhoto(ap.photo_lan, so, `ap_${i}_lan`), done: hasPhoto(ap.photo_lan, so, `ap_${i}_lan`),
        field: 'photo_lan', minDl: lanT.dl, minUl: lanT.ul, dlKey: 'speed_lan_dl', ulKey: 'speed_lan_ul'
      }));
    });
    return slots;
  }

  const HANDOVER = [
    { key: 'handover_page1', title: 'ใบส่งมอบงาน · หน้า 1/2', field: 'photo_handover_p1' },
    { key: 'handover_page2', title: 'ใบส่งมอบงาน · หน้า 2/2 (ลงนาม + ตราประทับ)', field: 'photo_handover_p2' }
  ];

  function handoverSlots() {
    const circuits = S.site.circuits;
    const c0 = circuits[0];
    return HANDOVER.map(h => {
      const url = circuits.map(c => (c.router_info || {})[h.field] || (h.field === 'photo_handover_p1' ? (c.router_info || {}).photo_signed_doc : '')).find(Boolean) || '';
      const has = hasPhoto(url, c0.so_number, h.key);
      return { key: h.key, so: c0.so_number, kind: 'handover', title: h.title, has, done: has, url, field: h.field, group: 'handover' };
    });
  }

  /** Aggregate view model for the whole Site. */
  function siteModel() {
    const circuits = S.site.circuits;
    const groups = circuits.map(c => {
      const slots = modelOf(c);
      return { circuit: c, slots, done: slots.filter(s => s.done).length, total: slots.length };
    });
    const ho = handoverSlots();
    const all = groups.flatMap(g => g.slots);
    const done = all.filter(s => s.done).length;
    const next = all.find(s => !s.done) || null;
    const checkedIn = circuits.some(c => c.checkin_time);
    const checkedOut = circuits.every(c => c.checkout_time);
    const blocked = all.filter(s => s.blocked);
    return {
      groups, ho, all, done, total: all.length, next,
      nextHandover: ho.find(h => !h.done) || null,
      ready: all.length > 0 && !next,
      checkedIn, checkedOut, blocked,
      rejected: circuits.find(c => c.admin_status === 'rejected'),
      approved: circuits.every(c => c.admin_status === 'approved'),
      // Approved sites are locked by the reviewer: view only for technicians.
      locked: circuits.some(c => c.locked) || circuits.every(c => c.admin_status === 'approved')
    };
  }

  const findCircuit = so => S.site && S.site.circuits.find(c => c.so_number === so);
  const slotByKey = (m, so, key) => m.all.find(s => s.so === so && s.key === key) || m.ho.find(s => s.so === so && s.key === key) || m.ho.find(s => s.key === key);

  /* ------------------------------------------------------------------------
     Edits → ops → PUT   (optimistic, survives reload)
     ------------------------------------------------------------------------ */
  function applyOp(c, op) {
    if (!c) return;
    if (op.t === 'router') {
      c.router_info = c.router_info || {};
      c.router_info[op.k] = op.v;
    } else if (op.t === 'ap') {
      const ap = (c.access_points || [])[op.i];
      if (ap) ap[op.k] = op.v;
    }
  }

  function setField(so, target, k, v) {
    const c = findCircuit(so);
    if (!c) return;
    const op = target === 'router' ? { t: 'router', k, v } : { t: 'ap', i: Number(target.split(':')[1]), k, v };
    op.id = ++S.opSeq;
    op.so = so;
    applyOp(c, op);
    S.ops.push(op);
    store.set(LS.ops, S.ops);
    scheduleFlush(so);
    updateSync();
  }

  const flushTimers = {};
  function scheduleFlush(so, delay = 700) {
    clearTimeout(flushTimers[so]);
    flushTimers[so] = setTimeout(() => pushCircuit(so), delay);
  }

  const pushChain = {};
  function pushCircuit(so) {
    pushChain[so] = (pushChain[so] || Promise.resolve()).then(() => doPush(so)).catch(() => {});
    return pushChain[so];
  }

  async function doPush(so) {
    const mine = S.ops.filter(o => o.so === so);
    if (!mine.length) return;
    const c = findCircuit(so);
    if (!c) return;
    const maxId = Math.max(...mine.map(o => o.id));
    const body = {
      router_info: c.router_info,
      access_points: c.access_points,
      is_draft: true,
      draft_saved_at: new Date().toISOString()
    };
    if (c.status === 'pending') { c.status = 'in_progress'; body.status = 'in_progress'; }
    try {
      const data = await api(`/api/circuits/${encodeURIComponent(so)}`, { method: 'PUT', body, timeout: 40000 });
      S.ops = S.ops.filter(o => !(o.so === so && o.id <= maxId));
      store.set(LS.ops, S.ops);
      // Sibling circuits share the handover scan — adopt what the server synced.
      const sibs = (data && (data.site_circuits || (data.circuit && data.circuit.site_circuits))) || [];
      for (const sib of sibs) {
        const local = findCircuit(sib.so_number);
        if (!local || local.so_number === so) continue;
        const keep = ['photo_handover_p1', 'photo_handover_p2', 'photo_signed_doc', 'doc_filled', 'doc_stamped'];
        local.router_info = local.router_info || {};
        for (const k of keep) if (sib.router_info && sib.router_info[k] !== undefined) local.router_info[k] = sib.router_info[k];
      }
      S.syncErr = false;
    } catch (err) {
      if (err.status === 423) { onLocked(err.message, so); return; }
      S.syncErr = true;
      setTimeout(() => pushCircuit(so), 8000);
    }
    updateSync();
  }

  /** The reviewer locked this Site while edits were still queued: drop them and show the locked view. */
  function onLocked(msg, so) {
    const entry = S.index.find(x => x.circ.some(c => c.so === so));
    const sos = new Set(entry ? entry.circ.map(c => c.so) : [so]);
    S.ops = S.ops.filter(o => !sos.has(o.so));
    S.jobs = S.jobs.filter(j => !sos.has(j.so));
    store.set(LS.ops, S.ops);
    store.set(LS.jobs, S.jobs);
    for (const k of Object.keys(S.previews)) if (sos.has(k.split('|')[0])) delete S.previews[k];
    S.syncErr = false;
    toast(msg || 'Site นี้ถูกล็อกแล้ว แก้ไขไม่ได้', 'bad');
    if (entry && S.site && S.site.key === entry.key) { S.site = null; location.hash = siteHref(entry.key); onRoute(); }
    updateSync();
  }

  /* ------------------------------------------------------------------------
     Photo upload queue
     ------------------------------------------------------------------------ */
  let queueRunning = false;
  let queueFails = 0;

  async function enqueuePhoto(so, slot, dataUrl) {
    const id = `${so}|${slot}|${Date.now()}`;
    S.previews[previewKey(so, slot)] = dataUrl;
    await idb.put(id, dataUrl);
    // Only the latest photo per slot matters.
    S.jobs = S.jobs.filter(j => !(j.so === so && j.slot === slot));
    S.jobs.push({ id, so, slot });
    store.set(LS.jobs, S.jobs);
    updateSync();
    runQueue();
  }

  async function runQueue() {
    if (queueRunning) return;
    queueRunning = true;
    try {
      while (S.jobs.length) {
        const job = S.jobs[0];
        const dataUrl = S.previews[previewKey(job.so, job.slot)] || await idb.get(job.id);
        if (!dataUrl) { S.jobs.shift(); continue; }
        S.previews[previewKey(job.so, job.slot)] = dataUrl;
        try {
          const res = await api('/api/upload', {
            method: 'POST', timeout: 90000,
            body: { circuitId: job.so, so_number: job.so, slot: job.slot, category: job.slot, dataUrl, data_url: dataUrl }
          });
          if (!res || !res.url) throw new Error('อัปโหลดไม่สำเร็จ');
          commitPhotoUrl(job.so, job.slot, res.url);
          S.jobs.shift();
          store.set(LS.jobs, S.jobs);
          idb.del(job.id);
          delete S.previews[previewKey(job.so, job.slot)];
          queueFails = 0;
          S.syncErr = false;
          updateSync();
          softRefresh();
        } catch (err) {
          if (err.status === 423) { onLocked(err.message, job.so); break; }
          queueFails++;
          S.syncErr = true;
          updateSync();
          await sleep(Math.min(30000, 4000 * queueFails));
          if (!navigator.onLine) break;
        }
      }
    } finally {
      queueRunning = false;
      updateSync();
    }
  }

  function commitPhotoUrl(so, slot, url) {
    if (slot.startsWith('handover_')) {
      const h = HANDOVER.find(x => x.key === slot);
      const c0 = findCircuit(so) || (S.site && S.site.circuits[0]);
      if (!c0) return;
      setField(c0.so_number, 'router', h.field, url);
      if (slot === 'handover_page1') {
        setField(c0.so_number, 'router', 'photo_signed_doc', url);
        setField(c0.so_number, 'router', 'doc_filled', true);
      } else {
        setField(c0.so_number, 'router', 'doc_stamped', true);
      }
      return;
    }
    if (slot.startsWith('router_')) {
      setField(so, 'router', `photo_${slot.replace('router_', '')}`, url);
      return;
    }
    const m = /^ap_(\d+)_(device|wifi|lan)$/.exec(slot);
    if (m) setField(so, `ap:${m[1]}`, `photo_${m[2]}`, url);
  }

  /* ------------------------------------------------------------------------
     Sync indicator
     ------------------------------------------------------------------------ */
  function pendingCount() {
    return S.jobs.length + new Set(S.ops.map(o => o.so)).size;
  }
  function updateSync() {
    const n = pendingCount();
    S.sync = n === 0 ? 'ok' : (!navigator.onLine || S.syncErr ? 'offline' : 'busy');
    const el = $('#syncChip');
    if (el) {
      el.dataset.state = S.sync;
      el.textContent = S.sync === 'ok' ? 'บันทึกแล้ว' : S.sync === 'busy' ? `กำลังส่ง ${n}` : `รอส่ง ${n}`;
      el.setAttribute('aria-label', el.textContent + (S.sync === 'offline' ? ' แตะเพื่อลองส่งอีกครั้ง' : ''));
    }
  }
  const syncChip = () => `<button type="button" class="sync" id="syncChip" data-act="sync" data-state="${S.sync}">${S.sync === 'ok' ? 'บันทึกแล้ว' : S.sync === 'busy' ? `กำลังส่ง ${pendingCount()}` : `รอส่ง ${pendingCount()}`}</button>`;

  function retryAll() {
    S.syncErr = false;
    queueFails = 0;
    runQueue();
    new Set(S.ops.map(o => o.so)).forEach(so => pushCircuit(so));
    updateSync();
  }

  /** Re-render the site/capture view if a background upload finished (without stealing focus from inputs). */
  function softRefresh() {
    if (document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    const r = parseRoute();
    if (r.name === 'site' || r.name === 'capture') render();
  }

  /* ------------------------------------------------------------------------
     Toast
     ------------------------------------------------------------------------ */
  function toast(msg, kind = '') {
    const el = $('#toast');
    el.textContent = msg;
    el.dataset.kind = kind;
    el.dataset.show = 'true';
    clearTimeout(S.toastTimer);
    S.toastTimer = setTimeout(() => { el.dataset.show = 'false'; }, 3200);
  }

  /* ------------------------------------------------------------------------
     Routing
     ------------------------------------------------------------------------ */
  function parseRoute() {
    const parts = (location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean).map(p => { try { return decodeURIComponent(p); } catch (_) { return p; } });
    if (parts[0] === 'so' && parts[1]) return { name: 'so', so: parts[1].toUpperCase() };
    if (parts[0] === 'site' && parts[1]) {
      if (parts[2] === 'step' && parts[3] && parts[4]) return { name: 'capture', key: parts[1], so: parts[3], slot: parts[4] };
      if (parts[2] === 'submit') return { name: 'submit', key: parts[1] };
      if (parts[2] === 'done') return { name: 'done', key: parts[1] };
      return { name: 'site', key: parts[1] };
    }
    return { name: 'home' };
  }
  const isHome = () => parseRoute().name === 'home';
  const siteHref = key => `#/site/${encodeURIComponent(key)}`;
  const stepHref = (key, so, slot) => `#/site/${encodeURIComponent(key)}/step/${encodeURIComponent(so)}/${encodeURIComponent(slot)}`;
  const go = hash => { location.hash = hash; };

  let lastRouteSig = '';
  async function onRoute() {
    let r = parseRoute();
    if (r.name === 'so') {
      // Deep link by circuit number (e.g. from the LINE bot): resolve to its Site.
      if (!S.indexLoaded && S.indexPromise) await S.indexPromise;
      const hit = S.index.find(s => s.circ.some(c => c.so === r.so));
      location.replace(hit ? siteHref(hit.key) : '#/');
      return;
    }
    const sig = `${r.name}|${r.key || ''}|${r.so || ''}|${r.slot || ''}`;
    const changed = sig !== lastRouteSig;
    lastRouteSig = sig;
    S.cap = { busy: '', ocrNote: '', ocrPct: 0 };
    if (r.name !== 'home') {
      const stale = S.site && S.site.key === r.key && Date.now() - (S.site.loadedAt || 0) > 60000 && pendingCount() === 0 && r.name === 'site';
      if (!S.site || S.site.key !== r.key || stale) await loadSite(r.key);
    }
    render();
    if (changed) {
      window.scrollTo(0, 0);
      const h = $('#app h1');
      if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    }
  }

  /* ------------------------------------------------------------------------
     Site loading
     ------------------------------------------------------------------------ */
  async function loadSite(key) {
    if (!S.indexLoaded && S.indexPromise) { S.site = { key, entry: null, circuits: [], loading: true, error: '' }; render(); await S.indexPromise; }
    const entry = S.index.find(s => s.key === key);
    S.site = { key, entry, circuits: [], loading: true, error: '' };
    render();
    try {
      const firstSo = entry ? entry.circ[0].so : null;
      if (!firstSo) throw new Error('ไม่พบ Site นี้ในรายการ');
      let circuits = [];
      const data = await api(`/api/circuits/${encodeURIComponent(firstSo)}`);
      const c0 = data.circuit || data;
      circuits = Array.isArray(data.site_circuits) && data.site_circuits.length ? data.site_circuits : null;
      if (!circuits) {
        circuits = await Promise.all(entry.circ.map(async x => {
          if (x.so === c0.so_number) return c0;
          const d = await api(`/api/circuits/${encodeURIComponent(x.so)}`);
          return d.circuit || d;
        }));
      }
      circuits = circuits.map(c => {
        c.router_info = c.router_info || {};
        c.access_points = Array.isArray(c.access_points) ? c.access_points : [];
        return c;
      }).sort((a, b) => String(a.so_number).localeCompare(String(b.so_number)));
      S.site.circuits = circuits;
      S.site.loading = false;
      S.site.loadedAt = Date.now();
      // Re-apply edits that never reached the server.
      const sos = new Set();
      for (const op of S.ops) {
        const c = circuits.find(x => x.so_number === op.so);
        if (c) { applyOp(c, op); sos.add(op.so); }
      }
      sos.forEach(so => scheduleFlush(so, 300));
      S.recent = [key, ...S.recent.filter(k => k !== key)].slice(0, 8);
      store.set(LS.recent, S.recent);
    } catch (err) {
      S.site.loading = false;
      S.site.error = err.message;
    }
  }

  /* ------------------------------------------------------------------------
     Rendering
     ------------------------------------------------------------------------ */
  const app = () => $('#app');

  function render() {
    const r = parseRoute();
    try {
      if (r.name === 'home') return renderHome();
      if (!S.site) return;
      if (S.site.loading) return renderSiteShell(skeleton());
      if (S.site.error) return renderSiteShell(errorBlock(S.site.error));
      if (r.name === 'site') return renderSite();
      if (r.name === 'capture') return renderCapture(r);
      if (r.name === 'submit') return renderSubmit();
      if (r.name === 'done') return renderDone();
    } catch (err) {
      console.error(err);
      app().innerHTML = `<main class="view" style="padding-top:24px">${errorBlock(err.message)}</main>`;
    }
  }

  const skeleton = () => `<div class="skeleton" style="height:150px;margin-top:16px"></div><div class="skeleton" style="height:76px;margin-top:12px"></div><div class="skeleton" style="height:76px;margin-top:12px"></div>`;
  const errorBlock = msg => `
    <div class="empty">${ICON.alert}<strong>เปิดข้อมูลไม่ได้</strong><span>${esc(msg)}</span>
      <div style="margin-top:16px"><button class="btn btn--secondary" data-act="reload">ลองใหม่</button></div>
    </div>`;

  function bar({ title, sub = '', back = '', right = '' }) {
    return `
      <header class="appbar">
        ${back ? `<a class="iconbtn" href="${back}" aria-label="ย้อนกลับ">${ICON.back}</a>` : `<span class="brandmark" aria-hidden="true">DLT</span>`}
        <div class="appbar__title"><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div>
        ${right}
      </header>`;
  }

  function renderSiteShell(inner) {
    app().innerHTML = `${bar({ title: S.site.entry ? S.site.entry.name : 'Site', sub: S.site.entry ? S.site.entry.province : '', back: '#/', right: syncChip() })}<main class="view">${inner}</main>`;
  }

  /* ----------------------------- Home ---------------------------------- */
  function renderHome() {
    const doing = S.index.filter(s => ['doing', 'rework'].includes(siteState(s)));
    app().innerHTML = `
      ${bar({ title: 'งานหน้างาน', sub: S.profile.name ? `ช่าง ${S.profile.name}` : 'ยังไม่ได้ระบุชื่อช่าง', right: `${syncChip()}<button class="iconbtn" data-act="profile" aria-label="ข้อมูลช่าง">${ICON.user}</button>` })}
      <main class="view" style="padding-top:16px">
        <label class="search">
          ${ICON.search}
          <span class="sr-only">ค้นหา Site</span>
          <input id="q" class="input" type="search" inputmode="search" enterkeyhint="search" autocomplete="off" placeholder="จังหวัด / สาขา / รหัส BINF" value="${esc(S.query)}" />
          <button type="button" class="iconbtn search__clear" data-act="clear-q" aria-label="ล้างคำค้น" ${S.query ? '' : 'hidden'}>${ICON.close}</button>
        </label>
        <div class="input-row" style="margin-top:12px">
          <button class="btn btn--quiet" data-act="near">${ICON.pin}ใกล้ฉัน</button>
          <button class="btn btn--quiet" data-act="provinces">${ICON.list}<span class="truncate">${S.province ? esc(S.province) : 'จังหวัด'}</span></button>
        </div>
        <div id="results"></div>
        <a class="footer-link" href="/?desk=1">เปิดหน้าสำหรับออฟฟิศ / ผู้ตรวจ →</a>
        <div style="text-align:center"><button class="btn btn--link" data-act="theme" id="themeBtn">ธีม: ${(window.dltTheme && window.dltTheme.label()) || 'อัตโนมัติ'}</button></div>
      </main>`;
    renderHomeResults();
    const q = $('#q');
    q.addEventListener('input', () => {
      S.query = q.value;
      S.near = null;
      $('[data-act="clear-q"]').hidden = !S.query;
      renderHomeResults();
    });
  }

  function siteRow(s, extra = '') {
    const st = siteState(s);
    const [label, cls] = STATE_LABEL[st];
    const ph = s.circ.reduce((a, x) => a + (x.ph || 0), 0);
    const rq = s.circ.reduce((a, x) => a + (x.rq || 0), 0);
    return `
      <a class="row site" href="${siteHref(s.key)}">
        <div class="row__main">
          <div class="site__name">${esc(s.name)}</div>
          <div class="site__meta">
            <span>${esc(s.province)}</span>
            <span>${s.circ.length} วงจร</span>
            ${st !== 'todo' && rq ? `<span class="num">รูป ${ph}/${rq}</span>` : ''}
            ${extra}
          </div>
        </div>
        <div class="row__end"><span class="chip ${cls}">${label}</span>${ICON.chevron}</div>
      </a>`;
  }

  function renderHomeResults() {
    const box = $('#results');
    if (!box) return;
    if (!S.indexLoaded) {
      box.innerHTML = S.indexError
        ? errorBlock(S.indexError)
        : `<div class="skeleton" style="height:76px;margin-top:20px"></div><div class="skeleton" style="height:76px;margin-top:12px"></div><div class="skeleton" style="height:76px;margin-top:12px"></div>`;
      return;
    }
    const q = S.query.trim().toLowerCase();
    let html = '';

    if (S.near) {
      html += `<h2 class="h-section">ใกล้คุณที่สุด</h2><div class="list">${S.near.map(n => siteRow(n.site, `<span>${n.km < 1 ? `${Math.round(n.km * 1000)} ม.` : `${n.km.toFixed(1)} กม.`}</span>`)).join('')}</div>`;
    } else if (q || S.province) {
      const words = q.split(/\s+/).filter(Boolean);
      const found = S.index.filter(s => (!S.province || s.province === S.province) && words.every(w => s.q.includes(w)));
      html += `<h2 class="h-section">${found.length ? `พบ ${found.length} Site` : 'ไม่พบ Site'}</h2>`;
      if (found.length) {
        html += `<div class="list">${found.slice(0, 40).map(s => siteRow(s)).join('')}</div>`;
        if (found.length > 40) html += `<p class="hint" style="text-align:center;margin-top:10px">แสดง 40 รายการแรก พิมพ์เพิ่มเพื่อกรอง</p>`;
      } else {
        html += `<div class="empty">${ICON.search}<strong>ไม่พบ Site ที่ตรงกับ “${esc(S.query)}”</strong>ลองพิมพ์ชื่อจังหวัด ชื่อสาขา หรือรหัสวงจร BINF</div>`;
      }
    } else {
      const doing = S.index.filter(s => ['doing', 'rework'].includes(siteState(s)));
      const recent = S.recent.map(k => S.index.find(s => s.key === k)).filter(s => s && !doing.includes(s));
      if (doing.length) html += `<h2 class="h-section">กำลังทำอยู่</h2><div class="list">${doing.slice(0, 12).map(s => siteRow(s)).join('')}</div>`;
      if (recent.length) html += `<h2 class="h-section">เปิดล่าสุด</h2><div class="list">${recent.slice(0, 6).map(s => siteRow(s)).join('')}</div>`;
      const sent = S.index.filter(s => ['submitted', 'done'].includes(siteState(s))).length;
      if (!doing.length && !recent.length) {
        html += `<div class="empty">${ICON.search}<strong>เริ่มจากค้นหา Site ของคุณ</strong>พิมพ์ชื่อจังหวัด ชื่อสาขา หรือรหัสวงจร BINF หรือกด “ใกล้ฉัน”</div>`;
      }
      html += `<p class="hint" style="text-align:center;margin-top:20px">ส่งงานแล้ว <b class="num">${sent}</b> จาก <b class="num">${S.index.length}</b> Site</p>`;
    }
    box.innerHTML = html;
  }

  /* ----------------------------- Site ---------------------------------- */
  function slotRow(s, key, nextKey, locked, viewOnly = false) {
    let icon = `<span class="state" aria-hidden="true"></span>`;
    let sub = 'ยังไม่ได้ถ่าย';
    if (s.kind === 'device' && s.has) {
      if (s.sn === 'mismatch') { icon = `<span class="state state--bad">${ICON.alert}</span>`; sub = 'S/N ไม่ตรงกับที่อ่านจากรูป — แตะเพื่อแก้'; }
      else if (s.sn === 'check') { icon = `<span class="state state--warn">${ICON.alert}</span>`; sub = 'ถ่ายแล้ว — รอตรวจ/ยืนยัน S/N'; }
      else if (s.sn === 'missing') { icon = `<span class="state state--warn">${ICON.alert}</span>`; sub = 'ถ่ายแล้ว — ยังไม่ได้ใส่ S/N'; }
      else { icon = `<span class="state state--done">${ICON.check}</span>`; sub = `S/N ${normSn(s.obj.serial_no)}`; }
    } else if (s.kind === 'speed' && s.has) {
      icon = `<span class="state state--done">${ICON.check}</span>`;
      const dl = s.obj[s.dlKey]; const ul = s.obj[s.ulKey];
      sub = dl || ul ? `ดาวน์โหลด ${dl || '-'} / อัปโหลด ${ul || '-'} Mbps` : 'ถ่ายแล้ว';
    } else if (s.kind === 'handover' && s.has) {
      icon = `<span class="state state--done">${ICON.check}</span>`;
      sub = 'ถ่ายแล้ว';
    } else if (s.key === nextKey) {
      icon = `<span class="state state--next">${ICON.camera}</span>`;
      sub = 'ทำต่อที่นี่';
    }
    if (!s.has && s.place && s.kind !== 'handover') sub = `${sub} · ${s.place}`;
    if (viewOnly) {
      return `
      <div class="row">
        ${icon}
        <div class="row__main"><div class="row__title">${esc(s.title)}</div><div class="row__sub">${esc(sub)}</div></div>
      </div>`;
    }
    return `
      <a class="row" href="${stepHref(key, s.so, s.key)}" ${locked ? 'aria-disabled="true" tabindex="-1"' : ''}>
        ${icon}
        <div class="row__main"><div class="row__title">${esc(s.title)}</div><div class="row__sub">${esc(sub)}</div></div>
        <div class="row__end">${ICON.chevron}</div>
      </a>`;
  }

  /** Every slot of every circuit as a port with an LED: green done · amber blink next · amber steady needs S/N · red blocked. */
  function portsOverview(m, site) {
    const nextId = m.next ? `${m.next.so}|${m.next.key}` : '';
    const portState = sl => (sl.blocked ? 'bad' : sl.done ? 'ok' : `${sl.so}|${sl.key}` === nextId ? 'next' : sl.has ? 'warn' : 'off');
    const WORD = { ok: 'เสร็จแล้ว', next: 'ทำต่อที่นี่', warn: 'ถ่ายแล้ว รอตรวจ S/N', bad: 'S/N ไม่ตรง', off: 'ยังไม่ได้ถ่าย' };
    const port = (sl, label) => {
      const st = portState(sl);
      return `<a class="port" href="${stepHref(site.key, sl.so, sl.key)}" aria-label="${esc(sl.title)} — ${WORD[st]}"${st === 'next' ? ' aria-current="true"' : ''}><i class="led ${st === 'off' ? '' : `led--${st}`}"></i><span>${label}</span></a>`;
    };
    const units = m.groups.map((g, gi) => {
      const parts = [];
      for (const sl of g.slots) {
        const last = parts[parts.length - 1];
        if (last && last.group === sl.group) last.slots.push(sl); else parts.push({ group: sl.group, slots: [sl], room: sl.room });
      }
      const cols = parts.map((pt, pi) => `<div class="grp"><div class="g">${pt.slots.map((sl, n) => port(sl, `${pi + 1}.${n + 1}`)).join('')}</div><div class="cap">${pt.group === 'router' ? 'MikroTik' : esc(`AP · ${String(pt.room || '').replace(/^ห้อง\s*/, '')}`)}</div></div>`).join('');
      return `<div class="unit"><div class="unit-top"><b>วงจรที่ ${gi + 1}</b><span>${esc(g.circuit.so_number)}</span><em>${g.done}/${g.total}</em></div><div class="ports">${cols}</div></div>`;
    }).join('');
    const ho = `<div class="unit"><div class="unit-top"><b>ใบส่งมอบงาน</b><span>ทั้ง Site ใช้ 1 ใบ</span><em>${m.ho.filter(h => h.done).length}/2</em></div><div class="ports"><div class="grp"><div class="g two">${m.ho.map((h, i) => {
      const st = h.done ? 'ok' : (m.nextHandover && m.nextHandover.key === h.key && m.ready) ? 'next' : 'off';
      return `<a class="port" href="${stepHref(site.key, h.so, h.key)}" aria-label="${esc(h.title)} — ${WORD[st]}"><i class="led ${st === 'off' ? '' : `led--${st}`}"></i><span>หน้า ${i + 1}</span></a>`;
    }).join('')}</div><div class="cap">สำเนาลงนาม + ตราประทับ</div></div></div></div>`;
    return `<section class="unit-wrap" aria-label="สถานะทุกช่องของทุกวงจร"><div class="unit-head"><span>ทุกวงจรใน Site นี้</span><b>${m.done}<small> / ${m.total}</small></b></div>${units}${ho}</section>`;
  }

  function renderSite() {
    const m = siteModel();
    const site = S.site;
    const e = site.entry;
    const multi = site.circuits.length > 1;
    const pct = m.total ? Math.round((m.done / m.total) * 100) : 0;
    const nextKey = m.next ? `${m.next.so}|${m.next.key}` : '';
    const firstCheckin = site.circuits.map(c => c.checkin_time).filter(Boolean).sort()[0];
    const locked = !m.checkedIn;
    const viewOnly = m.locked;

    let top = '';
    if (m.locked) {
      const when = site.circuits.map(c => c.admin_reviewed_at).filter(Boolean).sort().pop() || '';
      top = `<div class="banner banner--ok banner--locked"><div><strong>ผู้ตรวจรับอนุมัติและล็อกแล้ว</strong>งานของ Site นี้เสร็จสมบูรณ์ แก้ไขไม่ได้ หากต้องแก้ไขโปรดติดต่อผู้ตรวจรับ</div>${stampSvg(when)}</div>`;
    } else if (m.rejected) {
      top = `<div class="banner banner--bad">${ICON.alert}<div><strong>ผู้ตรวจส่งกลับให้แก้ไข</strong>${esc(m.rejected.admin_comment || m.rejected.admin_review_note || 'กรุณาตรวจรูปและ S/N อีกครั้ง')}</div></div>`;
    } else if (m.checkedOut) {
      top = `<div class="banner banner--info">${ICON.check}<div><strong>ส่งตรวจแล้ว${site.circuits[0].checkout_time ? ` เวลา ${fmtTime(site.circuits[0].checkout_time)}` : ''}</strong>รอผู้ตรวจรับตรวจสอบ ยังแก้ไขรูปได้หากต้องการ</div></div>`;
    }

    let hero = '';
    if (viewOnly) {
      hero = '';
    } else if (!m.checkedIn) {
      hero = `
        <section class="panel" style="margin-top:16px">
          <h2 style="font-size:1.25rem;font-weight:700;margin-bottom:4px">เช็คอินเข้างาน</h2>
          <p class="muted" style="margin-bottom:14px">บันทึกเวลาเข้า Site${multi ? ` (${site.circuits.length} วงจร เช็คอินพร้อมกัน)` : ''}</p>
          <label class="field"><span>ชื่อช่าง</span><input id="ciName" class="input" autocomplete="name" placeholder="ชื่อ-นามสกุล" value="${esc(S.profile.name)}" /></label>
          <label class="field"><span>เบอร์โทร</span><input id="ciPhone" class="input" type="tel" inputmode="tel" autocomplete="tel" placeholder="08x-xxx-xxxx" value="${esc(S.profile.phone)}" /></label>
          <button class="btn btn--primary" data-act="checkin">เช็คอิน</button>
          <p id="ciErr" class="hint" style="color:var(--bad)" role="alert"></p>
        </section>`;
    } else if (m.next) {
      hero = `
        <section class="hero">
          ${jack('next')}
          <div>
            <div class="hero__kicker">ถัดไป · ${String(m.done + 1).padStart(2, '0')} / ${m.total}</div>
            <div class="hero__title">${esc(m.next.title)}</div>
            <div class="hero__sub">${multi ? `วงจร ${esc(m.next.so)}` : esc(m.next.place || '')}</div>
          </div>
          <a class="btn" href="${stepHref(site.key, m.next.so, m.next.key)}">${ICON.camera}${m.next.has ? 'ตรวจ / แก้ไข' : 'ถ่ายรูป'}</a>
        </section>`;
    } else if (m.nextHandover) {
      hero = `
        <section class="hero">
          ${jack('next')}
          <div>
            <div class="hero__kicker">รูปหน้างานครบแล้ว</div>
            <div class="hero__title">ถ่ายใบส่งมอบงาน</div>
            <div class="hero__sub">ให้เจ้าหน้าที่ลงนามและประทับตราก่อน แล้วถ่ายทั้ง 2 หน้า</div>
          </div>
          <a class="btn" href="${stepHref(site.key, m.nextHandover.so, m.nextHandover.key)}">${ICON.camera}${esc(m.nextHandover.title.replace('ใบส่งมอบงาน · ', 'ถ่าย'))}</a>
        </section>`;
    } else {
      hero = `
        <section class="hero hero--ok">
          ${jack('ok')}
          <div>
            <div class="hero__kicker">ครบทุกรายการแล้ว</div>
            <div class="hero__title">พร้อมส่งงาน</div>
            <div class="hero__sub">กดปุ่ม “ส่งงาน” ด้านล่างเพื่อตรวจทานและส่งให้ผู้ตรวจรับ</div>
          </div>
        </section>`;
    }

    const groups = m.groups.map((g, gi) => {
      const c = g.circuit;
      const rt = c.router_info || {};
      const open = (gi === m.groups.findIndex(x => x.done < x.total) || (gi === 0 && m.groups.every(x => x.done === x.total))) ? 'open' : '';
      const complete = g.done === g.total;
      const title = multi ? `วงจร ${c.so_number}` : 'อุปกรณ์ที่ต้องถ่าย';
      const sub = multi ? `${rt.room ? `Rack ห้อง ${String(rt.room).replace(/^ห้อง\s*/, '')}` : 'MikroTik + Access Point'}` : 'MikroTik + Access Point';
      return `
        <details class="group" ${open}>
          <summary>
            <span class="state ${complete ? 'state--done' : ''}" aria-hidden="true">${complete ? ICON.check : ''}</span>
            <span><span class="group__title">${esc(title)}</span><br><span class="group__sub">${esc(sub)} · <span class="num">${g.done}/${g.total}</span></span></span>
            <span class="caret">${ICON.down}</span>
          </summary>
          ${g.slots.map(s => slotRow(s, site.key, nextKey.split('|')[1] === s.key && nextKey.split('|')[0] === s.so ? s.key : '', locked, viewOnly)).join('')}
        </details>`;
    }).join('');

    const hoDone = m.ho.filter(h => h.done).length;
    const hoGroup = `
      <details class="group" ${m.ready && hoDone < 2 ? 'open' : ''}>
        <summary>
          <span class="state ${hoDone === 2 ? 'state--done' : ''}" aria-hidden="true">${hoDone === 2 ? ICON.check : ''}</span>
          <span><span class="group__title">ใบส่งมอบงาน (ทั้ง Site ใช้ 1 ใบ)</span><br><span class="group__sub">ถ่ายหลังเจ้าหน้าที่ลงนาม · <span class="num">${hoDone}/2</span></span></span>
          <span class="caret">${ICON.down}</span>
        </summary>
        ${m.ho.map(h => slotRow(h, site.key, m.nextHandover && m.ready && m.nextHandover.key === h.key ? h.key : '', locked, viewOnly)).join('')}
      </details>`;

    const remain = m.total - m.done;
    let dockBtn;
    if (m.ready) dockBtn = `<a class="btn btn--primary" href="#/site/${encodeURIComponent(site.key)}/submit">ส่งงาน (Check-out)</a>`;
    else dockBtn = `<button class="btn" disabled>ส่งงาน (Check-out)</button>`;
    const dockNote = m.ready
      ? (hoDone < 2 ? 'ใบส่งมอบยังไม่ครบ — ส่งก่อนแล้วถ่ายตามหลังได้' : 'พร้อมส่ง')
      : `ยังขาดอีก ${remain} รายการ`;

    app().innerHTML = `
      ${bar({ title: e.name, sub: `${e.province}${firstCheckin ? ` · เข้า ${fmtTime(firstCheckin)}` : ''}`, back: '#/', right: syncChip() })}
      <main class="view has-dock">
        ${top}
        ${hero}
        ${m.checkedIn && !viewOnly ? portsOverview(m, site) : ''}
        ${locked ? `
          <div class="panel" style="margin-top:12px">
            <div class="row__title">งานใน Site นี้</div>
            <p class="muted" style="margin-top:2px">${site.circuits.length} วงจร · ถ่ายรูปหน้างาน ${m.total} รายการ + ใบส่งมอบงาน 2 หน้า<br>รายการจะขึ้นให้ทำทีละขั้นหลังเช็คอิน</p>
          </div>` : `<h2 class="h-section">รายการถ่ายรูป</h2>${groups}${hoGroup}`}
        <div class="panel" style="margin-top:16px">
          <div class="small muted">${esc(e.address || '')}</div>
          ${e.ll ? `<a class="btn btn--quiet btn--sm" style="margin-top:10px" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${e.ll.lat},${e.ll.lng}">${ICON.pin}เปิดแผนที่</a>` : ''}
        </div>
      </main>
      ${m.checkedIn && !m.checkedOut && !viewOnly ? `<div class="dock"><div class="dock__inner">${dockBtn}<div class="dock__note">${dockNote}</div></div></div>` : ''}`;
  }

  /* ----------------------------- Capture ------------------------------- */
  function renderCapture(r) {
    const m = siteModel();
    const slot = slotByKey(m, r.so, r.slot);
    if (!slot || m.locked) { go(siteHref(r.key)); return; }
    const c = findCircuit(slot.so) || S.site.circuits[0];
    const backHref = siteHref(r.key);
    const isHandover = slot.kind === 'handover';
    const photoUrl = isHandover ? (S.previews[previewKey(slot.so, slot.key)] || slot.url) : (S.previews[previewKey(slot.so, slot.key)] || slot.obj[slot.field]);
    const pending = Boolean(S.previews[previewKey(slot.so, slot.key)]);
    const total = m.total + 2;

    const guide = guideFor(slot);
    let body = '';

    body += `
      <div class="shot ${photoUrl ? 'shot--filled' : ''}">
        ${photoUrl ? `<img src="${esc(photoUrl)}" alt="รูปที่ถ่าย: ${esc(slot.title)}" />
          <span class="shot__tag ${pending ? 'shot__tag--wait' : ''}">${pending ? (S.sync === 'offline' ? 'เก็บในเครื่องแล้ว · รอสัญญาณเพื่อส่ง' : '<span class="spinner" style="width:14px;height:14px;border-width:2.5px"></span>กำลังส่งขึ้นระบบ') : `${ICON.check}ถ่ายแล้ว`}</span>`
        : `<div class="shot__empty">${ICON.camera}<span>ยังไม่มีรูป</span></div>`}
      </div>
      <input id="file" type="file" accept="image/*" capture="environment" hidden />
      <input id="fileAlt" type="file" accept="image/*" hidden />
      <button class="btn ${photoUrl ? 'btn--secondary' : 'btn--primary'}" style="margin-top:14px" data-act="shoot" ${S.cap.busy ? 'disabled' : ''}>
        ${S.cap.busy ? '<span class="spinner"></span>กำลังจัดการรูป…' : `${ICON.camera}${photoUrl ? 'ถ่ายใหม่' : 'เปิดกล้องถ่ายรูป'}`}
      </button>
      <div style="text-align:center"><button class="btn btn--link" data-act="pick">เลือกรูปจากอัลบั้ม</button></div>
      <ul class="guide">${guide.map(g => `<li>${esc(g)}</li>`).join('')}</ul>`;

    if (slot.kind === 'device' && slot.has) body += snPanel(slot);
    if (slot.kind === 'speed' && slot.has) body += speedPanel(slot);

    // dock
    const nxt = nextSlotAfter(m, slot);
    const [what, ...restTitle] = slot.title.split(' · ');
    const act = (restTitle.join(' · ') || what).replace(' + Sticker S/N', ' + S/N').replace('เทสความเร็วสาย LAN', 'เทสสาย LAN').replace('Port LAN', 'LAN');
    const barSub = S.site.circuits.length > 1 && !isHandover ? `${what} · วงจร ${slot.so.slice(-3)}` : what;
    app().innerHTML = `
      ${bar({ title: act, sub: barSub, back: backHref, right: syncChip() })}
      <main class="view has-dock" style="padding-top:16px">
        <p class="small muted" style="margin:0 0 10px">รายการที่ ${m.all.indexOf(slot) >= 0 ? m.all.indexOf(slot) + 1 : m.total + (slot.key === 'handover_page1' ? 1 : 2)} จาก ${total}</p>
        ${body}
      </main>
      <div class="dock"><div class="dock__inner">
        <button class="btn btn--primary" id="nextBtn" data-act="next" ${slot.done ? '' : 'disabled'}>${nxt.label}</button>
        <div class="dock__note" id="nextNote">${slot.done ? '' : (slot.has ? 'ตรวจ S/N ให้เรียบร้อยก่อน' : 'ถ่ายรูปก่อนจึงไปต่อได้')}</div>
      </div></div>`;

    $('#nextBtn').dataset.href = nxt.href;
    wireCapture(slot);
  }

  function guideFor(slot) {
    if (slot.kind === 'device') return ['ถ่ายให้เห็นตัวเครื่องและ Sticker ใหม่ (เลขวงจร / ครุภัณฑ์ / S/N) ชัดเจน', 'ถือกล้องนิ่ง ไม่ให้แสงสะท้อนที่ Sticker'];
    if (slot.kind === 'speed') return [`แคปหน้าจอผลเทสให้เห็นตัวเลข Download / Upload${slot.mode ? ` (ทดสอบผ่าน ${slot.mode})` : ''}`, `เกณฑ์ผ่าน: Download ≥ ${slot.minDl} / Upload ≥ ${slot.minUl} Mbps`].concat(slot.isGecc ? ['ห้อง GECC: ต้องลงทะเบียน Authen ก่อนเทส'] : []);
    return slot.key === 'handover_page2'
      ? ['ต้องเห็นลายเซ็นและตราประทับชัดเจน', 'วางกระดาษบนพื้นเรียบ ถ่ายให้เห็นครบทั้งแผ่น ไม่เอียง']
      : ['วางกระดาษบนพื้นเรียบ ถ่ายให้เห็นครบทั้งแผ่น ไม่เอียง', 'ตัวหนังสือต้องอ่านออกทุกบรรทัด'];
  }

  function snPanel(slot) {
    const o = slot.obj;
    const st = snState(o);
    const ocr = normSn(o.ocr_serial_no);
    const expected = normSn(o.expected_serial_no);
    let verdict = '';
    if (S.cap.ocrNote) verdict = `<div class="verdict verdict--info"><span class="spinner"></span>${esc(S.cap.ocrNote)}</div>`;
    else if (st === 'matched') verdict = `<div class="verdict verdict--ok">${ICON.check}S/N ตรงกับที่อ่านจากรูป</div>`;
    else if (st === 'confirmed') verdict = `<div class="verdict verdict--ok">${ICON.check}ยืนยัน S/N แล้ว</div>`;
    else if (st === 'mismatch') verdict = `<div class="verdict verdict--bad">${ICON.alert}ไม่ตรงกัน — ตรวจเลขบน Sticker</div>`;
    else if (st === 'check') verdict = `<div class="verdict verdict--warn">${ICON.alert}ดูเลขบน Sticker แล้วกดยืนยัน</div>`;
    else verdict = `<div class="verdict verdict--warn">${ICON.alert}ยังไม่ได้ใส่ S/N</div>`;

    let fix = '';
    if (st === 'mismatch') {
      fix = `
        <div class="panel" style="margin-top:12px">
          <p style="margin-bottom:10px">อ่านจากรูปได้ <b class="input--mono">${esc(ocr)}</b></p>
          <button class="btn btn--secondary" data-act="use-ocr" style="margin-bottom:8px">ใช้ค่าที่อ่านจากรูป</button>
          <button class="btn btn--quiet" data-act="confirm-typed">ที่พิมพ์ไว้ถูกแล้ว (ข้ามผลอ่านรูป)</button>
        </div>`;
    } else if (st === 'check' || st === 'missing') {
      fix = `<button class="btn btn--secondary" style="margin-top:12px" data-act="confirm-typed" ${st === 'missing' ? 'disabled' : ''}>ถูกต้อง ตรงกับ Sticker</button>`;
    }

    return `
      <section style="margin-top:22px" aria-labelledby="snh">
        <h2 id="snh" class="h-section" style="margin-top:0">เลข S/N ของอุปกรณ์</h2>
        <label class="field" style="margin-bottom:0"><span class="sr-only">เลข S/N</span>
          <input id="snInput" class="input input--mono" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text" placeholder="พิมพ์เลข S/N" value="${esc(o.serial_no || '')}" />
        </label>
        ${expected && expected !== normSn(o.serial_no) ? `<p class="hint">S/N ตามข้อมูลระบบ: <b class="input--mono">${esc(expected)}</b></p>` : ''}
        <div id="snVerdict">${verdict}</div>
        <div id="snFix">${fix}</div>
      </section>`;
  }

  function speedPanel(slot) {
    const o = slot.obj;
    const dl = o[slot.dlKey] ?? '';
    const ul = o[slot.ulKey] ?? '';
    const geccField = slot.isGecc && slot.kind === 'speed'
      ? `<button class="toggle" style="margin-top:12px" data-act="authen" aria-pressed="${o.gecc_authen_tested ? 'true' : 'false'}"><span class="state">${ICON.check}</span>ลงทะเบียน Authen แล้ว</button>`
      : '';
    return `
      <section style="margin-top:22px" aria-labelledby="sph">
        <h2 id="sph" class="h-section" style="margin-top:0">ผลทดสอบความเร็ว (Mbps)</h2>
        <div class="input-row">
          <label class="field" style="margin:0"><span>ดาวน์โหลด</span><input id="dl" class="input num" inputmode="decimal" placeholder="เช่น 612" value="${esc(dl)}" /></label>
          <label class="field" style="margin:0"><span>อัปโหลด</span><input id="ul" class="input num" inputmode="decimal" placeholder="เช่น 340" value="${esc(ul)}" /></label>
        </div>
        <div id="spVerdict">${speedVerdict(slot, dl, ul)}</div>
        ${geccField}
      </section>`;
  }

  function speedVerdict(slot, dl, ul) {
    const d = num(dl); const u = num(ul);
    if (d === null && u === null) return `<p class="hint">กรอกผลเทสเพื่อตรวจเกณฑ์ (ไม่บังคับ) · เกณฑ์ ≥ ${slot.minDl}/${slot.minUl}</p>`;
    if (d !== null && u !== null) {
      return d >= slot.minDl && u >= slot.minUl
        ? `<div class="verdict verdict--ok">${ICON.check}ผ่านเกณฑ์ (≥ ${slot.minDl}/${slot.minUl})</div>`
        : `<div class="verdict verdict--bad">${ICON.alert}ต่ำกว่าเกณฑ์ ต้อง ≥ ${slot.minDl}/${slot.minUl} — ลองเทสใหม่</div>`;
    }
    return `<p class="hint">กรอกให้ครบทั้งดาวน์โหลดและอัปโหลด</p>`;
  }

  function nextSlotAfter(m, slot) {
    const all = m.all;
    const at = all.indexOf(slot);
    const order = at < 0 ? all : all.slice(at + 1).concat(all.slice(0, at));
    const nxt = order.find(s => !s.done && s !== slot);
    if (nxt) return { href: stepHref(S.site.key, nxt.so, nxt.key), label: 'ถัดไป →' };
    if (slot.kind !== 'handover') {
      const h = m.ho.find(x => !x.done);
      if (h) return { href: stepHref(S.site.key, h.so, h.key), label: 'ไปถ่ายใบส่งมอบ →' };
    } else {
      const h = m.ho.find(x => !x.done && x !== slot);
      if (h) return { href: stepHref(S.site.key, h.so, h.key), label: 'ถัดไป →' };
    }
    return { href: siteHref(S.site.key), label: 'เสร็จ — กลับหน้า Site' };
  }

  function wireCapture(slot) {
    const file = $('#file'); const alt = $('#fileAlt');
    const handler = e => { const f = e.target.files && e.target.files[0]; if (f) onPhotoPicked(f, slot); e.target.value = ''; };
    file.addEventListener('change', handler);
    alt.addEventListener('change', handler);

    const sn = $('#snInput');
    if (sn) {
      sn.addEventListener('input', () => {
        const v = sn.value.toUpperCase();
        setField(slot.so, slot.target, 'serial_no', v);
        setField(slot.so, slot.target, 'sn_confirmed', false);
        refreshSnUi(slot);
      });
    }
    const dl = $('#dl'); const ul = $('#ul');
    if (dl && ul) {
      const onSpeed = () => {
        setField(slot.so, slot.target, slot.dlKey, dl.value.trim());
        setField(slot.so, slot.target, slot.ulKey, ul.value.trim());
        $('#spVerdict').innerHTML = speedVerdict(slot, dl.value, ul.value);
      };
      dl.addEventListener('input', onSpeed);
      ul.addEventListener('input', onSpeed);
    }
  }

  /** Re-evaluate S/N state after typing, patching only the verdict + dock (keeps the keyboard open). */
  function refreshSnUi(slot) {
    const m = siteModel();
    const fresh = slotByKey(m, slot.so, slot.key);
    if (!fresh) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = snPanel(fresh);
    $('#snVerdict').innerHTML = $('#snVerdict', tmp).innerHTML;
    $('#snFix').innerHTML = $('#snFix', tmp).innerHTML;
    const btn = $('#nextBtn');
    if (btn) { btn.disabled = !fresh.done; }
    const note = $('#nextNote');
    if (note) note.textContent = fresh.done ? '' : (fresh.has ? 'ตรวจ S/N ให้เรียบร้อยก่อน' : 'ถ่ายรูปก่อนจึงไปต่อได้');
  }

  async function onPhotoPicked(file, slot) {
    S.cap.busy = 'prep';
    render();
    try {
      const dataUrl = await compressImage(file);
      await enqueuePhoto(slot.so, slot.key, dataUrl);
      S.cap.busy = '';
      render();
      toast('บันทึกรูปแล้ว');
      if (slot.kind === 'device') runOcr(dataUrl, slot);
    } catch (err) {
      S.cap.busy = '';
      render();
      toast('ใช้รูปนี้ไม่ได้ ลองถ่ายใหม่อีกครั้ง', 'bad');
    }
  }

  async function compressImage(file, maxW = 1600, quality = 0.85) {
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (_) {
      bmp = await new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = reject;
        img.src = url;
      });
    }
    const w0 = bmp.width; const h0 = bmp.height;
    const scale = Math.min(1, maxW / Math.max(w0, h0));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w0 * scale);
    canvas.height = Math.round(h0 * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    if (bmp.close) bmp.close();
    return canvas.toDataURL('image/jpeg', quality);
  }

  /* ----------------------------- OCR ----------------------------------- */
  let tessPromise;
  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (!tessPromise) {
      tessPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
        s.onload = () => resolve(window.Tesseract);
        s.onerror = () => { tessPromise = null; reject(new Error('โหลด OCR ไม่ได้')); };
        document.head.appendChild(s);
      });
    }
    return tessPromise;
  }

  const LOOKALIKE = { O: '0', Q: '0', D: '0', I: '1', L: '1', S: '5', B: '8', Z: '2' };
  const likeKey = s => normSn(s).replace(/[OQDILSBZ]/g, ch => LOOKALIKE[ch]);
  const IGNORE = new Set(['MIKROTIK', 'ROUTERBOARD', 'TOTOLINK', 'TPLINK', 'DLINK', 'SERIAL', 'NUMBER', 'SERVICE', 'ROUTER', 'ACCESS', 'POINT', '1TOALL', 'RB3011', 'RB4011', 'RBD52G', 'A3002RU', 'ARCHER', 'USERNAME', 'PASSWORD', 'ADMIN', 'DEFAULT', 'MACADDRESS', 'INTERNET']);
  function snCandidates(text, hints) {
    const scored = new Map();
    const add = (tok, base) => {
      const t = tok.replace(/[^A-Z0-9]/g, '');
      if (t.length < 8 || t.length > 20 || IGNORE.has(t)) return;
      if (/^(BINF|BINL)/.test(t) || !/\d/.test(t)) return;
      let sc = base;
      if (hints.includes(t)) sc += 200;
      if (/[A-Z]/.test(t) && t.length >= 11 && t.length <= 17) sc += 20;
      if (sc > (scored.get(t) || 0)) scored.set(t, sc);
    };
    for (const line of String(text || '').toUpperCase().split(/\r?\n/)) {
      const isSn = /SERIAL|S\/N|\bSN\b|NUMBER/.test(line);
      const m = line.match(/(?:SERIAL\s*(?:NUMBER|NO\.?)?|S\/N|\bSN\b)[^A-Z0-9]*([A-Z0-9-]{8,20})/);
      if (m) add(m[1], 60);
      for (const tk of line.split(/[\s,:;|/\\()[\]]+/)) if (tk.length >= 8) add(tk, isSn ? 35 : 10);
    }
    return [...scored.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
  }

  async function runOcr(dataUrl, slot) {
    const hints = [normSn(slot.obj.serial_no), normSn(slot.obj.expected_serial_no)].filter(Boolean);
    const isHere = () => { const r = parseRoute(); return r.name === 'capture' && r.so === slot.so && r.slot === slot.key; };
    const setNote = (note) => { S.cap.ocrNote = note; if (isHere() && $('#snVerdict')) refreshSnUi(slot); };
    let found = [];
    try {
      setNote('กำลังอ่าน S/N จากรูป…');
      if ('BarcodeDetector' in window) {
        try {
          const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl; });
          const codes = await new BarcodeDetector().detect(img);
          for (const b of codes) {
            const v = normSn(b.rawValue);
            if (v.length >= 8 && !found.includes(v)) found.push(v);
          }
        } catch (_) { /* ignore */ }
      }
      if (!found.some(v => hints.includes(v))) {
        const T = await loadTesseract();
        const res = await T.recognize(dataUrl, 'eng');
        found = found.concat(snCandidates(res && res.data && res.data.text, hints).filter(v => !found.includes(v)));
      }
    } catch (_) { /* OCR is best-effort */ }
    S.cap.ocrNote = '';
    // OCR confuses look-alikes (O/0, I/1, S/5, B/8…). If a reading matches a known S/N apart from those, snap to it.
    found = found.map(v => hints.find(h => h.length === v.length && likeKey(h) === likeKey(v)) || v);
    const best = found.find(v => hints.includes(v)) || found[0] || '';
    if (best) {
      setField(slot.so, slot.target, 'ocr_serial_no', best);
      if (!normSn(slot.obj.serial_no)) setField(slot.so, slot.target, 'serial_no', best);
      toast(hints.includes(best) ? 'อ่าน S/N ได้ ตรงกับข้อมูลระบบ' : 'อ่าน S/N ได้แล้ว กรุณาตรวจ');
    } else if (isHere()) {
      toast('อ่าน S/N จากรูปไม่ได้ — ดูเลขบน Sticker แล้วกดยืนยัน');
    }
    if (isHere()) { const keepFocus = document.activeElement && document.activeElement.id === 'snInput'; if (!keepFocus) render(); else refreshSnUi(slot); }
  }

  /* ----------------------------- Submit -------------------------------- */
  function renderSubmit() {
    const m = siteModel();
    const site = S.site;
    if (m.locked) { go(siteHref(site.key)); return; }
    const rows = m.groups.map(g => {
      const c = g.circuit;
      const bad = g.slots.filter(s => s.blocked).length;
      const miss = g.slots.filter(s => !s.done).length;
      const ok = miss === 0 && bad === 0;
      return `
        <div class="row">
          <span class="state ${ok ? 'state--done' : 'state--bad'}">${ok ? ICON.check : ICON.alert}</span>
          <div class="row__main">
            <div class="row__title">${site.circuits.length > 1 ? `วงจร ${esc(c.so_number)}` : 'รูปหน้างานและ S/N'}</div>
            <div class="row__sub">${ok ? `ครบ ${g.total}/${g.total} รายการ` : `ยังขาด ${miss} รายการ${bad ? ` · S/N ไม่ตรง ${bad}` : ''}`}</div>
          </div>
        </div>`;
    }).join('');
    const hoDone = m.ho.filter(h => h.done).length;
    const needNote = !m.ready;
    app().innerHTML = `
      ${bar({ title: 'ตรวจก่อนส่งงาน', sub: site.entry.name, back: siteHref(site.key), right: syncChip() })}
      <main class="view has-dock" style="padding-top:16px">
        <div class="checklist">
          ${rows}
          <div class="row">
            <span class="state ${hoDone === 2 ? 'state--done' : 'state--warn'}">${hoDone === 2 ? ICON.check : ICON.alert}</span>
            <div class="row__main"><div class="row__title">ใบส่งมอบงาน</div><div class="row__sub">${hoDone === 2 ? 'ถ่ายครบ 2 หน้า' : `ถ่ายแล้ว ${hoDone}/2 หน้า — ส่งก่อนแล้วถ่ายตามหลังได้`}</div></div>
          </div>
        </div>
        ${pendingCount() ? `<div class="banner banner--info" id="pendBanner"><span class="spinner"></span><div><strong>มีรายการรอส่งขึ้นระบบ</strong>ระบบจะส่งให้ครบก่อนส่งงาน</div></div>` : ''}
        <label class="field" style="margin-top:18px"><span>หมายเหตุ ${needNote ? '(จำเป็น — ส่งทั้งที่ยังไม่ครบ)' : '(ไม่บังคับ)'}</span>
          <textarea id="note" class="input" rows="3" placeholder="${needNote ? 'บอกเหตุผลที่ส่งโดยยังไม่ครบ' : 'ถ้ามีเรื่องแจ้งผู้ตรวจ'}"></textarea>
        </label>
        <p id="subErr" class="hint" style="color:var(--bad)" role="alert"></p>
      </main>
      <div class="dock"><div class="dock__inner">
        <button class="btn btn--primary" id="submitBtn" data-act="submit">${m.ready ? 'ยืนยันส่งงาน' : 'ส่งทั้งที่ยังไม่ครบ'}</button>
        <a class="btn btn--quiet" href="${siteHref(site.key)}">กลับไปแก้ไข</a>
      </div></div>`;
  }

  async function doSubmit() {
    const m = siteModel();
    const btn = $('#submitBtn');
    const err = $('#subErr');
    const note = ($('#note').value || '').trim();
    err.textContent = '';
    if (!m.ready && note.length < 5) { err.textContent = 'กรุณาใส่หมายเหตุอย่างน้อย 5 ตัวอักษร'; $('#note').focus(); return; }
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>กำลังส่งงาน…';
    try {
      // Everything captured must be on the server before we close the job.
      const t0 = Date.now();
      retryAll();
      while (pendingCount() && Date.now() - t0 < 90000) await sleep(600);
      if (pendingCount()) throw new Error('ยังส่งรูปขึ้นระบบไม่ครบ — ตรวจสัญญาณอินเทอร์เน็ตแล้วลองใหม่');
      const so = S.site.circuits[0].so_number;
      const res = await api(`/api/circuits/${encodeURIComponent(so)}/checkout`, { method: 'POST', body: { note, force: !m.ready }, timeout: 45000 });
      if (res && res.ok === false) throw new Error(res.message || res.error || 'ยังส่งงานไม่ได้ รูปหรือ S/N ไม่ครบ');
      if (Array.isArray(res.site_circuits)) mergeCircuits(res.site_circuits);
      markIndexSubmitted();
      go(`#/site/${encodeURIComponent(S.site.key)}/done`);
    } catch (e) {
      err.textContent = e.message;
      btn.disabled = false;
      btn.textContent = m.ready ? 'ยืนยันส่งงาน' : 'ส่งทั้งที่ยังไม่ครบ';
    }
  }

  function mergeCircuits(fresh) {
    for (const f of fresh) {
      const local = findCircuit(f.so_number);
      if (!local) continue;
      for (const k of ['status', 'checkin_time', 'checkout_time', 'checkin_status', 'admin_status', 'is_draft', 'inspector_name', 'inspector_phone']) {
        if (f[k] !== undefined) local[k] = f[k];
      }
    }
  }

  function markIndexSubmitted() {
    const e = S.index.find(s => s.key === S.site.key);
    if (!e) return;
    for (const c of e.circ) { c.co = true; c.ck = true; }
    store.set(LS.index, { at: Date.now(), sites: S.index });
  }

  function renderDone() {
    const site = S.site;
    app().innerHTML = `
      ${bar({ title: 'ส่งงานแล้ว', sub: site.entry.name, right: syncChip() })}
      <main class="view">
        <div class="done">
          <div class="done__mark">${ICON.check}</div>
          <h2>ส่งตรวจเรียบร้อย</h2>
          <p class="muted">${esc(site.entry.name)} · ${site.circuits.length} วงจร<br>ผู้ตรวจรับจะตรวจสอบรูปและ S/N ต่อ</p>
        </div>
        <a class="btn btn--primary" href="#/">กลับไปเลือก Site ถัดไป</a>
        <div style="height:10px"></div>
        <a class="btn btn--quiet" href="${siteHref(site.key)}">ดูรายการของ Site นี้</a>
      </main>`;
  }

  /* ----------------------------- Dialogs ------------------------------- */
  function openSheet(title, bodyHtml, footHtml = '') {
    let dlg = $('#sheet');
    if (dlg) dlg.remove();
    dlg = document.createElement('dialog');
    dlg.id = 'sheet';
    dlg.className = 'sheet';
    dlg.setAttribute('aria-labelledby', 'sheetTitle');
    dlg.innerHTML = `<div class="sheet__head"><h2 id="sheetTitle">${esc(title)}</h2><button class="iconbtn" data-act="close-sheet" aria-label="ปิด">${ICON.close}</button></div><div class="sheet__body">${bodyHtml}</div>${footHtml ? `<div class="sheet__foot">${footHtml}</div>` : ''}`;
    document.body.appendChild(dlg);
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', () => dlg.remove());
    dlg.showModal();
    return dlg;
  }

  function openProvinceSheet() {
    const counts = new Map();
    for (const s of S.index) counts.set(s.province, (counts.get(s.province) || 0) + 1);
    const list = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], 'th'));
    openSheet('เลือกจังหวัด', `
      ${S.province ? `<button class="btn btn--quiet" data-act="pick-province" data-v="" style="margin-bottom:12px">ล้างตัวกรองจังหวัด</button>` : ''}
      <div class="province-grid">${list.map(([p, n]) => `<button data-act="pick-province" data-v="${esc(p)}"><span>${esc(p)}</span><small class="num">${n}</small></button>`).join('')}</div>`);
  }

  function openProfileSheet() {
    openSheet('ข้อมูลช่าง', `
      <label class="field"><span>ชื่อช่าง</span><input id="pfName" class="input" autocomplete="name" value="${esc(S.profile.name)}" /></label>
      <label class="field"><span>เบอร์โทร</span><input id="pfPhone" class="input" type="tel" inputmode="tel" autocomplete="tel" value="${esc(S.profile.phone)}" /></label>
      <p class="hint">ใช้เติมให้อัตโนมัติตอนเช็คอิน เก็บไว้ในเครื่องนี้เท่านั้น</p>`,
      `<button class="btn btn--primary" data-act="save-profile">บันทึก</button>`);
  }

  function findNear() {
    if (!navigator.geolocation) { toast('เครื่องนี้ไม่รองรับ GPS', 'bad'); return; }
    toast('กำลังหาตำแหน่ง…');
    navigator.geolocation.getCurrentPosition(pos => {
      const { latitude: la, longitude: lo } = pos.coords;
      const dist = (a, b) => {
        const R = 6371; const rad = x => x * Math.PI / 180;
        const dLa = rad(b.lat - a.lat); const dLo = rad(b.lng - a.lng);
        const h = Math.sin(dLa / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLo / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(h));
      };
      S.near = S.index.filter(s => s.ll).map(s => ({ site: s, km: dist({ lat: la, lng: lo }, s.ll) })).sort((a, b) => a.km - b.km).slice(0, 10);
      S.query = ''; S.province = '';
      render();
    }, () => toast('เปิดตำแหน่งไม่ได้ — อนุญาตการเข้าถึงตำแหน่งแล้วลองใหม่', 'bad'), { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  }

  async function doCheckin() {
    const name = ($('#ciName').value || '').trim();
    const phone = ($('#ciPhone').value || '').trim();
    const err = $('#ciErr');
    err.textContent = '';
    if (!name) { err.textContent = 'กรุณาใส่ชื่อช่าง'; $('#ciName').focus(); return; }
    const btn = $('[data-act="checkin"]');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>กำลังเช็คอิน…';
    try {
      S.profile = { name, phone };
      store.set(LS.profile, S.profile);
      const so = S.site.circuits[0].so_number;
      const res = await api(`/api/circuits/${encodeURIComponent(so)}/checkin`, { method: 'POST', body: { tech_name: name, tech_phone: phone } });
      const fresh = res.site_circuits || [res.circuit];
      mergeCircuits(fresh);
      for (const c of S.site.circuits) if (!c.checkin_time) c.checkin_time = new Date().toISOString();
      const e = S.index.find(s => s.key === S.site.key);
      if (e) e.circ.forEach(c => { c.ck = true; });
      toast('เช็คอินแล้ว');
      render();
    } catch (e) {
      err.textContent = e.message;
      btn.disabled = false;
      btn.textContent = 'เช็คอิน';
    }
  }

  /* ------------------------------------------------------------------------
     Event delegation
     ------------------------------------------------------------------------ */
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    const r = parseRoute();
    switch (act) {
      case 'sync': retryAll(); toast(pendingCount() ? 'กำลังส่งข้อมูลที่ค้างอยู่…' : 'บันทึกครบแล้ว'); break;
      case 'reload': location.reload(); break;
      case 'clear-q': S.query = ''; { const q = $('#q'); if (q) { q.value = ''; q.focus(); } el.hidden = true; renderHomeResults(); } break;
      case 'near': findNear(); break;
      case 'provinces': openProvinceSheet(); break;
      case 'pick-province': S.province = el.dataset.v || ''; S.near = null; $('#sheet') && $('#sheet').close(); render(); break;
      case 'profile': openProfileSheet(); break;
      case 'theme': { if (window.dltTheme) { window.dltTheme.cycle(); el.textContent = 'ธีม: ' + window.dltTheme.label(); } break; }
      case 'close-sheet': $('#sheet') && $('#sheet').close(); break;
      case 'save-profile':
        S.profile = { name: ($('#pfName').value || '').trim(), phone: ($('#pfPhone').value || '').trim() };
        store.set(LS.profile, S.profile);
        $('#sheet') && $('#sheet').close();
        render();
        break;
      case 'checkin': doCheckin(); break;
      case 'shoot': { const f = $('#file'); if (f) f.click(); break; }
      case 'pick': { const f = $('#fileAlt'); if (f) f.click(); break; }
      case 'next': { const h = el.dataset.href; if (h) go(h); break; }
      case 'submit': doSubmit(); break;
      case 'authen': {
        const m = siteModel();
        const slot = slotByKey(m, r.so, r.slot);
        if (slot) { setField(slot.so, slot.target, 'gecc_authen_tested', !slot.obj.gecc_authen_tested); el.setAttribute('aria-pressed', String(!!slot.obj.gecc_authen_tested)); }
        break;
      }
      case 'use-ocr': case 'confirm-typed': {
        const m = siteModel();
        const slot = slotByKey(m, r.so, r.slot);
        if (!slot) break;
        if (act === 'use-ocr') {
          setField(slot.so, slot.target, 'serial_no', normSn(slot.obj.ocr_serial_no));
          setField(slot.so, slot.target, 'sn_confirmed', false);
        } else {
          setField(slot.so, slot.target, 'ocr_serial_no', '');
          setField(slot.so, slot.target, 'sn_confirmed', true);
        }
        render();
        break;
      }
      default: break;
    }
  });

  window.addEventListener('hashchange', onRoute);
  window.addEventListener('online', () => { updateSync(); retryAll(); });
  window.addEventListener('offline', updateSync);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { new Set(S.ops.map(o => o.so)).forEach(so => pushCircuit(so)); } else { updateSync(); } });
  window.addEventListener('beforeunload', e => { if (S.jobs.length) { e.preventDefault(); e.returnValue = ''; } });

  /* ------------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------------ */
  (async function boot() {
    // Restore pending photo previews so the UI shows them straight away.
    for (const j of S.jobs) { const d = await idb.get(j.id); if (d) S.previews[previewKey(j.so, j.slot)] = d; }
    updateSync();
    S.indexPromise = loadIndex();
    onRoute();
    if (S.jobs.length) runQueue();
  })();
})();
