/* ==========================================================================
   DLT Onsite — Admin / review center
   Dashboard · review & lock · export · UAT tools. Vanilla JS, hash routes.
   All data comes from /api/admin/* (cookie session, see lib/admin.js).
   ========================================================================== */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const STATE = { approved: 'อนุมัติแล้ว', pending_review: 'รอตรวจ', rejected: 'ส่งกลับแก้ไข', working: 'กำลังทำ', todo: 'ยังไม่เริ่ม' };
  const STATE_ORDER = ['approved', 'pending_review', 'rejected', 'working', 'todo'];
  const REGIONS = ['ภาคกลาง', 'ภาคตะวันออกเฉียงเหนือ', 'ภาคใต้', 'ภาคเหนือ', 'ภาคตะวันออก', 'ภาคตะวันตก'];
  // One colour per circuit inside a Site (same palette as the desk UI)
  const CIRCUIT_COLORS = [
    { solid: '#2563eb', line: '#3b82f6', soft: '#eff6ff', ink: '#1e3a8a' },
    { solid: '#047857', line: '#10b981', soft: '#ecfdf5', ink: '#064e3b' },
    { solid: '#b45309', line: '#f59e0b', soft: '#fffbeb', ink: '#78350f' },
    { solid: '#7c3aed', line: '#8b5cf6', soft: '#f5f3ff', ink: '#4c1d95' },
    { solid: '#be123c', line: '#f43f5e', soft: '#fff1f2', ink: '#881337' }
  ];
  const SN_LABEL = {
    matched: ['ตรงกับ OCR', 'ok'], mismatch: ['ไม่ตรงกับ OCR', 'bad'], manual_only: ['กรอกเอง (ไม่มี OCR) — เทียบกับรูป', 'warn'],
    ocr_only: ['OCR อ่านได้ ช่างยังไม่กรอก', 'bad'], missing: ['ยังไม่ระบุ', 'bad']
  };

  const S = {
    me: null, configured: true,
    sites: [], loadedAt: 0,
    filter: 'pending_review', province: '', q: '',
    detailKey: '', detail: null, detailLoading: false,
    flags: new Set(),            // photos the reviewer marked "needs fixing": `${so}|${slot}`
    photos: [],                  // flat list for the lightbox
    provSort: { key: 'province', dir: 1 },
    busy: false
  };

  /* ------------------------------------------------------------------------
     Helpers
     ------------------------------------------------------------------------ */
  const dtFmt = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const fmtDT = iso => { const t = new Date(iso); return iso && !isNaN(t) ? dtFmt.format(t) : '-'; };
  const dayKey = d => new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 10);
  function ago(iso) {
    const t = new Date(iso).getTime();
    if (!iso || isNaN(t)) return '';
    const m = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (m < 60) return `${m} นาที`;
    if (m < 60 * 36) return `${Math.round(m / 60)} ชม.`;
    return `${Math.round(m / 1440)} วัน`;
  }
  const dur = m => (m == null ? '-' : m >= 60 ? `${Math.floor(m / 60)} ชม. ${m % 60} นาที` : `${m} นาที`);
  const median = arr => { const a = arr.filter(x => x != null).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
  const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
  const dispRouterAsset = raw => { const v = String(raw ?? '').trim(); return !v || v === '-' || /^สขจ\.[^/]*$/.test(v) || /^1\s*to\s*all$/i.test(v) ? '-' : v; };
  const dispApAsset = raw => { const v = String(raw ?? '').trim(); return !v || v === '-' || /^สข[^/]*\/[A-Za-z]+\d*$/.test(v) ? '-' : v; };
  const chip = (state, text) => `<span class="chip chip--${state}">${esc(text ?? STATE[state])}</span>`;

  let toastTimer = 0;
  function toast(msg, kind = '') {
    const el = $('#toast');
    el.textContent = msg; el.dataset.kind = kind; el.dataset.show = 'true';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.dataset.show = 'false'; }, 3600);
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin'
    });
    let data = null;
    try { data = await res.json(); } catch (_) { /* not JSON */ }
    if (res.status === 401 && data && data.need_login) {
      S.me = null;
      render();
      const e = new Error(data.error); e.status = 401; throw e;
    }
    if (!res.ok) {
      const e = new Error((data && (data.error || data.message)) || `เซิร์ฟเวอร์ตอบกลับผิดพลาด (${res.status})`);
      e.status = res.status; e.data = data;
      throw e;
    }
    return data;
  }

  /* ------------------------------------------------------------------------
     Data
     ------------------------------------------------------------------------ */
  async function loadSites() {
    const data = await api('/api/admin/sites');
    S.sites = data.sites || [];
    S.loadedAt = Date.now();
    const n = S.sites.filter(s => s.state === 'pending_review').length;
    const badge = $('#navPending');
    badge.hidden = n === 0;
    badge.textContent = n;
  }

  async function loadDetail(key) {
    S.detailKey = key;
    S.detailLoading = true;
    S.flags = new Set();
    renderDetail();
    try {
      S.detail = await api(`/api/admin/site?key=${encodeURIComponent(key)}`);
    } catch (e) {
      S.detail = null;
      if (e.status !== 401) toast(e.message, 'bad');
    }
    S.detailLoading = false;
    renderDetail();
  }

  /* ------------------------------------------------------------------------
     Routing
     ------------------------------------------------------------------------ */
  function route() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(p => { try { return decodeURIComponent(p); } catch (_) { return p; } });
    return { name: parts[0] || 'dashboard', key: parts.slice(1).join('/') };
  }
  const reviewHref = key => `#/review/${encodeURIComponent(key)}`;

  function render() {
    const r = route();
    $('#top').hidden = !S.me;
    if (!S.me) { renderLogin(); return; }
    $('#whoName').textContent = S.me.name;
    $$('.tabs a').forEach(a => { if (a.dataset.tab === r.name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    if (r.name === 'review') renderReview(r);
    else if (r.name === 'export') renderExport();
    else if (r.name === 'tools') renderTools();
    else renderDashboard();
  }

  /* ------------------------------------------------------------------------
     Login
     ------------------------------------------------------------------------ */
  function renderLogin() {
    const saved = (() => { try { return localStorage.getItem('dlt_admin_name') || ''; } catch (_) { return ''; } })();
    $('#view').dataset.page = 'login';
    $('#view').innerHTML = `
      <form class="login" id="loginForm">
        <h1>เข้าสู่ระบบผู้ตรวจรับ</h1>
        <p class="muted">สำหรับเจ้าหน้าที่ตรวจรับงานเท่านั้น</p>
        ${S.configured ? '' : '<div class="banner banner--bad" style="margin-bottom:14px"><div><b>ยังไม่ได้ตั้งรหัสผ่านบนระบบ</b>ต้องตั้ง Cloudflare secret ชื่อ ADMIN_PASSWORD ก่อนจึงจะเข้าสู่ระบบได้</div></div>'}
        <label class="field"><span>ชื่อผู้ตรวจ (บันทึกในประวัติการอนุมัติ)</span><input class="input" id="lgName" autocomplete="name" value="${esc(saved)}" required /></label>
        <label class="field"><span>รหัสผ่าน</span><input class="input" id="lgPass" type="password" autocomplete="current-password" required /></label>
        <button class="btn btn--primary" style="width:100%" type="submit" id="lgBtn">เข้าสู่ระบบ</button>
        <p class="err" id="lgErr" role="alert"></p>
      </form>`;
    (saved ? $('#lgPass') : $('#lgName')).focus();
    $('#loginForm').addEventListener('submit', async ev => {
      ev.preventDefault();
      const btn = $('#lgBtn'); const err = $('#lgErr');
      err.textContent = ''; btn.disabled = true; btn.textContent = 'กำลังเข้าสู่ระบบ…';
      try {
        const name = $('#lgName').value.trim();
        await api('/api/admin/login', { method: 'POST', body: { name, password: $('#lgPass').value } });
        try { localStorage.setItem('dlt_admin_name', name); } catch (_) { /* ignore */ }
        S.me = { name };
        await loadSites();
        render();
      } catch (e) {
        err.textContent = e.message;
        btn.disabled = false; btn.textContent = 'เข้าสู่ระบบ';
      }
    });
  }

  /* ------------------------------------------------------------------------
     Dashboard
     ------------------------------------------------------------------------ */
  function countBy(list, fn) { const m = {}; for (const x of list) { const k = fn(x); m[k] = (m[k] || 0) + 1; } return m; }

  function stackBar(counts, total, small = false) {
    return `<div class="stack ${small ? 'stack--sm' : ''}" role="img" aria-label="${STATE_ORDER.map(s => `${STATE[s]} ${counts[s] || 0}`).join(', ')}">${
      STATE_ORDER.map(s => `<i class="s-${s}" style="width:${total ? ((counts[s] || 0) / total) * 100 : 0}%"></i>`).join('')}</div>`;
  }

  function activityChart(sites) {
    const days = [];
    for (let i = 13; i >= 0; i--) days.push(dayKey(new Date(Date.now() - i * 86400e3)));
    const sub = countBy(sites.filter(s => s.submitted_at), s => dayKey(new Date(s.submitted_at)));
    const apr = countBy(sites.filter(s => s.state === 'approved' && s.reviewed_at), s => dayKey(new Date(s.reviewed_at)));
    const max = Math.max(3, ...days.map(d => Math.max(sub[d] || 0, apr[d] || 0)));
    const W = 560, H = 150, pad = 22, bw = 14, gap = (W - pad) / days.length;
    const y = v => H - 22 - (v / max) * (H - 40);
    let g = '';
    days.forEach((d, i) => {
      const x = pad + i * gap + 4;
      const a = sub[d] || 0; const b = apr[d] || 0;
      g += `<rect x="${x}" y="${y(a)}" width="${bw}" height="${H - 22 - y(a)}" rx="3" fill="oklch(0.47 0.18 258)"><title>${d}: ส่งตรวจ ${a} Site</title></rect>`;
      g += `<rect x="${x + bw + 2}" y="${y(b)}" width="${bw}" height="${H - 22 - y(b)}" rx="3" fill="oklch(0.5 0.13 152)"><title>${d}: อนุมัติ ${b} Site</title></rect>`;
      if (a) g += `<text x="${x + bw / 2}" y="${y(a) - 3}" text-anchor="middle">${a}</text>`;
      if (b) g += `<text x="${x + bw + 2 + bw / 2}" y="${y(b) - 3}" text-anchor="middle">${b}</text>`;
      if (i % 2 === 0 || i === days.length - 1) g += `<text x="${x + bw}" y="${H - 6}" text-anchor="middle">${d.slice(8)}/${d.slice(5, 7)}</text>`;
    });
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="จำนวน Site ที่ส่งตรวจและอนุมัติในแต่ละวัน 14 วันล่าสุด">
      <line x1="${pad}" y1="${H - 22}" x2="${W}" y2="${H - 22}" stroke="oklch(0.8 0.012 250)" />${g}</svg>`;
  }

  function renderDashboard() {
    const sites = S.sites;
    const total = sites.length;
    const c = countBy(sites, s => s.state);
    const circuits = sites.reduce((a, s) => a + s.circuits.length, 0);
    const circApproved = sites.filter(s => s.state === 'approved').reduce((a, s) => a + s.circuits.length, 0);
    const waiting = sites.filter(s => s.state === 'pending_review');
    const stale = sites.filter(s => s.state === 'working' && s.updated_at && Date.now() - new Date(s.updated_at) > 24 * 3600e3);
    const attention = waiting.filter(s => !s.ready);
    const medDur = median(sites.map(s => s.duration_min));
    const medWait = median(waiting.map(s => s.submitted_at ? Math.round((Date.now() - new Date(s.submitted_at)) / 60000) : null));

    const regions = Array.from(new Set([...REGIONS, ...sites.map(s => s.region)])).filter(r => sites.some(s => s.region === r));
    const regionRows = regions.map(r => {
      const list = sites.filter(s => s.region === r);
      const rc = countBy(list, s => s.state);
      return `<div class="region-row">
        <a href="#/review" data-region="${esc(r)}">${esc(r)}</a>
        ${stackBar(rc, list.length, true)}
        <span class="num small muted" style="text-align:right">${rc.approved || 0}/${list.length} Site</span>
      </div>`;
    }).join('');

    const provinces = Array.from(new Set(sites.map(s => s.province))).map(p => {
      const list = sites.filter(s => s.province === p);
      const pc = countBy(list, s => s.state);
      return { province: p, region: list[0].region, total: list.length, ...Object.fromEntries(STATE_ORDER.map(k => [k, pc[k] || 0])), progress: pct(pc.approved || 0, list.length) };
    });

    $('#view').dataset.page = 'dashboard';
    $('#view').innerHTML = `
      <div class="page">
        <div class="page-head">
          <div><h1>ภาพรวมโครงการ</h1><p class="muted small">อัปเดตล่าสุด ${fmtDT(new Date(S.loadedAt).toISOString())} · รีเฟรชอัตโนมัติทุก 1 นาที</p></div>
          <button class="btn btn--sm" id="refreshBtn" type="button">รีเฟรชตอนนี้</button>
        </div>

        <section class="section" aria-labelledby="hProgress">
          <h2 id="hProgress" class="sr-only" style="position:absolute;left:-9999px">ความคืบหน้ารวม</h2>
          <div class="overall"><b class="num">${c.approved || 0}</b><span>จาก <span class="num">${total}</span> Site อนุมัติแล้ว (<span class="num">${pct(c.approved || 0, total)}%</span>) · ${circApproved}/${circuits} วงจร</span></div>
          ${stackBar(c, total)}
          <div class="legend">${STATE_ORDER.map(s => `<a href="#/review" data-filter="${s}"><i class="dot s-${s}"></i>${STATE[s]} <b class="num">${c[s] || 0}</b></a>`).join('')}</div>
        </section>

        <section class="section">
          <h2>ต้องทำตอนนี้</h2>
          <div class="todo-list">
            <a class="todo-item" href="#/review" data-filter="pending_review" data-zero="${!waiting.length}"><b class="num">${waiting.length}</b><span>Site รอตรวจ${medWait != null ? ` · รอนานกลาง ~ ${dur(medWait)}` : ''}</span></a>
            <a class="todo-item" href="#/review" data-filter="pending_review" data-zero="${!attention.length}"><b class="num">${attention.length}</b><span>รอตรวจที่ระบบพบข้อสังเกต (รูปขาด / S/N / ความเร็ว)</span></a>
            <a class="todo-item" href="#/review" data-filter="rejected" data-zero="${!(c.rejected || 0)}"><b class="num">${c.rejected || 0}</b><span>ส่งกลับ รอช่างแก้ไข</span></a>
            <a class="todo-item" href="#/review" data-filter="working" data-zero="${!stale.length}"><b class="num">${stale.length}</b><span>กำลังทำแต่ไม่มีความเคลื่อนไหวเกิน 24 ชม.</span></a>
          </div>
        </section>

        <div class="grid2">
          <section class="section"><h2>ความคืบหน้าแต่ละภาค</h2>${regionRows || '<p class="muted">ยังไม่มีข้อมูล</p>'}</section>
          <section class="section">
            <h2>14 วันล่าสุด</h2>
            <div class="bars-legend small"><span class="legend"><span><i class="dot" style="background:oklch(0.47 0.18 258)"></i>ส่งตรวจ</span><span><i class="dot" style="background:oklch(0.5 0.13 152)"></i>อนุมัติ</span></span></div>
            ${activityChart(sites)}
            <p class="small muted" style="margin-top:8px">เวลาที่ช่างอยู่หน้างานต่อ Site (กลาง): <b class="num">${dur(medDur)}</b></p>
          </section>
        </div>

        <section class="section" style="margin-top:20px">
          <div class="page-head" style="margin-bottom:10px"><h2 style="margin:0">รายจังหวัด</h2><input class="input" id="provQ" style="max-width:260px" placeholder="ค้นหาจังหวัด / ภาค" aria-label="ค้นหาจังหวัด" /></div>
          <div class="table-wrap"><table>
            <thead><tr>
              <th><button data-sort="province">จังหวัด</button></th><th>ภาค</th>
              <th class="r"><button data-sort="total">Site</button></th>
              <th class="r"><button data-sort="approved">อนุมัติ</button></th><th class="r"><button data-sort="pending_review">รอตรวจ</button></th>
              <th class="r"><button data-sort="rejected">ส่งกลับ</button></th><th class="r"><button data-sort="working">กำลังทำ</button></th><th class="r"><button data-sort="todo">ยังไม่เริ่ม</button></th>
              <th><button data-sort="progress">ความคืบหน้า</button></th>
            </tr></thead>
            <tbody id="provBody"></tbody>
          </table></div>
        </section>
      </div>`;

    const body = () => {
      const q = ($('#provQ').value || '').trim().toLowerCase();
      const { key, dir } = S.provSort;
      const list = provinces.filter(p => !q || p.province.toLowerCase().includes(q) || p.region.toLowerCase().includes(q))
        .sort((a, b) => (typeof a[key] === 'string' ? a[key].localeCompare(b[key], 'th') : a[key] - b[key]) * dir);
      $('#provBody').innerHTML = list.map(p => `
        <tr class="link" data-province="${esc(p.province)}">
          <td><b>${esc(p.province)}</b></td><td class="muted">${esc(p.region)}</td>
          <td class="r num">${p.total}</td><td class="r num status-ok">${p.approved}</td><td class="r num">${p.pending_review}</td>
          <td class="r num ${p.rejected ? 'status-bad' : ''}">${p.rejected}</td><td class="r num">${p.working}</td><td class="r num muted">${p.todo}</td>
          <td><span class="minibar"><span class="stack stack--sm"><i class="s-approved" style="width:${p.progress}%"></i></span></span> <span class="num small">${p.progress}%</span></td>
        </tr>`).join('') || '<tr><td colspan="9" class="muted">ไม่พบจังหวัดที่ค้นหา</td></tr>';
    };
    body();
    $('#provQ').addEventListener('input', body);
    $$('th button[data-sort]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.sort;
      S.provSort = { key: k, dir: S.provSort.key === k ? -S.provSort.dir : (k === 'province' ? 1 : -1) };
      body();
    }));
    $('#provBody').addEventListener('click', e => {
      const tr = e.target.closest('tr[data-province]');
      if (tr) { S.province = tr.dataset.province; S.filter = 'all'; S.q = ''; location.hash = '#/review'; }
    });
    $('#refreshBtn').addEventListener('click', async () => { try { await loadSites(); renderDashboard(); toast('รีเฟรชแล้ว', 'ok'); } catch (e) { toast(e.message, 'bad'); } });
    $$('[data-filter]').forEach(a => a.addEventListener('click', () => { S.filter = a.dataset.filter; S.province = ''; S.q = ''; }));
    $$('[data-region]').forEach(a => a.addEventListener('click', () => { S.filter = 'all'; S.province = ''; S.q = a.dataset.region; }));
  }

  /* ------------------------------------------------------------------------
     Review — queue
     ------------------------------------------------------------------------ */
  function filteredSites() {
    const q = S.q.trim().toLowerCase();
    let list = S.sites.filter(s =>
      (S.filter === 'all' || s.state === S.filter) &&
      (!S.province || s.province === S.province) &&
      (!q || `${s.name} ${s.province} ${s.region} ${s.tech_name} ${s.circuits.map(c => `${c.so} ${c.service_no}`).join(' ')}`.toLowerCase().includes(q)));
    if (S.filter === 'pending_review') list = list.slice().sort((a, b) => String(a.submitted_at).localeCompare(String(b.submitted_at)));
    else if (S.filter === 'approved') list = list.slice().sort((a, b) => String(b.reviewed_at).localeCompare(String(a.reviewed_at)));
    return list;
  }

  function renderReview(r) {
    const view = $('#view');
    if (view.dataset.page !== 'review') {
      view.dataset.page = 'review';
      const provs = Array.from(new Set(S.sites.map(s => s.province))).sort((a, b) => a.localeCompare(b, 'th'));
      view.innerHTML = `
        <div class="review" id="reviewRoot">
          <aside class="queue" aria-label="รายการ Site">
            <div class="queue__tools">
              <div class="filters" id="filters"></div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                <input class="input" id="qInput" type="search" placeholder="ค้นหา Site / S/O / ช่าง" aria-label="ค้นหา" value="${esc(S.q)}" />
                <select class="select" id="provSel" aria-label="จังหวัด"><option value="">ทุกจังหวัด</option>${provs.map(p => `<option ${p === S.province ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>
              </div>
            </div>
            <div class="queue__list" id="queueList"></div>
          </aside>
          <section class="detail" id="detailPane" aria-live="polite"></section>
        </div>`;
      $('#qInput').addEventListener('input', e => { S.q = e.target.value; renderQueue(); });
      $('#provSel').addEventListener('change', e => { S.province = e.target.value; renderQueue(); });
      $('#filters').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (b) { S.filter = b.dataset.f; renderQueue(); } });
      $('#queueList').addEventListener('click', e => { const b = e.target.closest('[data-key]'); if (b) location.hash = reviewHref(b.dataset.key); });
    }
    $('#reviewRoot').dataset.mode = r.key ? 'detail' : 'list';
    renderQueue();
    if (r.key) {
      if (S.detailKey !== r.key || (!S.detail && !S.detailLoading)) loadDetail(r.key);
      else renderDetail();
    } else {
      S.detailKey = ''; S.detail = null;
      renderDetail();
    }
  }

  function renderQueue() {
    if (!$('#queueList')) return;
    const counts = countBy(S.sites, s => s.state);
    const tabs = [['pending_review', 'รอตรวจ'], ['rejected', 'ส่งกลับ'], ['approved', 'อนุมัติแล้ว'], ['working', 'กำลังทำ'], ['todo', 'ยังไม่เริ่ม'], ['all', 'ทั้งหมด']];
    $('#filters').innerHTML = tabs.map(([k, t]) => `<button type="button" class="fchip" data-f="${k}" aria-pressed="${S.filter === k}">${t} <small class="num">${k === 'all' ? S.sites.length : counts[k] || 0}</small></button>`).join('');
    const list = filteredSites();
    const key = route().key;
    $('#queueList').innerHTML = list.length ? list.slice(0, 300).map(s => {
      const flags = [];
      if (s.state === 'pending_review' || s.state === 'working') flags.push(s.ready ? '<span class="chip chip--ok">ระบบตรวจผ่านครบ</span>' : `<span class="chip chip--warn">ข้อสังเกต ${s.problems.length}</span>`);
      if (s.locked) flags.push('<span class="chip">ล็อกแล้ว</span>');
      const when = s.state === 'pending_review' ? `รอ ${ago(s.submitted_at)}` : s.state === 'approved' ? `อนุมัติ ${fmtDT(s.reviewed_at)}` : s.updated_at ? `อัปเดต ${ago(s.updated_at)} ที่แล้ว` : '';
      return `<button type="button" class="qitem" data-key="${esc(s.key)}" ${key === s.key ? 'aria-current="true"' : ''}>
        <div class="qitem__top"><span class="qitem__name">${esc(s.name)}</span>${chip(s.state)}</div>
        <div class="qitem__sub">${esc(s.province)} · ${s.circuits.length} วงจร${s.tech_name ? ` · ช่าง ${esc(s.tech_name)}` : ''}${when ? ` · ${esc(when)}` : ''}</div>
        ${flags.length ? `<div class="qitem__flags">${flags.join('')}</div>` : ''}
      </button>`;
    }).join('') : '<div class="empty">ไม่มีรายการในตัวกรองนี้</div>';
  }

  /* ------------------------------------------------------------------------
     Review — detail
     ------------------------------------------------------------------------ */
  const placeOf = o => [o.room && `ห้อง ${String(o.room).replace(/^ห้อง\s*/, '')}`, o.floor && `ชั้น ${o.floor}`, o.building && `อาคาร ${o.building}`].filter(Boolean).join(' · ') || '-';

  function deviceTable(c) {
    const rt = c.router_info || {};
    const aps = (c.access_points || []).filter(a => a && a.checked !== false);
    const sn = c.checks.sn || [];
    const rows = [{ label: 'MikroTik Router', place: placeOf(rt), model: `MikroTik ${rt.model || ''}`.trim(), asset: dispRouterAsset(rt.asset_no), chk: sn[0] }];
    aps.forEach((a, i) => rows.push({ label: `Access Point ${i + 1}`, place: placeOf(a), model: `${a.brand || ''} ${a.model || ''}`.trim(), asset: dispApAsset(a.asset_no), chk: sn[i + 1] }));
    return `<h3>อุปกรณ์และ S/N</h3><div class="table-wrap"><table>
      <thead><tr><th>อุปกรณ์</th><th>ติดตั้งที่</th><th>ยี่ห้อ / รุ่น</th><th>เลขครุภัณฑ์</th><th>S/N ที่ช่างกรอก</th><th>S/N จาก OCR</th><th>ผลเทียบ</th></tr></thead>
      <tbody>${rows.map(r => {
        const [txt, cls] = SN_LABEL[r.chk && r.chk.status] || ['-', 'warn'];
        return `<tr><td><b>${esc(r.label)}</b></td><td>${esc(r.place)}</td><td>${esc(r.model || '-')}</td><td>${esc(r.asset)}</td>
          <td class="mono">${esc((r.chk && r.chk.manual) || '-')}</td><td class="mono">${esc((r.chk && r.chk.ocr) || '-')}</td><td class="status-${cls}">${esc(txt)}</td></tr>`;
      }).join('')}</tbody></table></div>`;
  }

  function speedTable(c) {
    const val = (d, u) => (d == null && u == null ? '-' : `${d ?? '-'} / ${u ?? '-'}`);
    return `<h3>ผลทดสอบความเร็ว (ดาวน์โหลด / อัปโหลด Mbps)</h3><div class="table-wrap"><table>
      <thead><tr><th>รายการ</th><th class="r">ค่าที่ช่างกรอก</th><th class="r">เกณฑ์ขั้นต่ำ</th><th>ผล</th></tr></thead>
      <tbody>${c.checks.speeds.map(s => {
        let res = '<span class="status-warn">ไม่มีค่าที่กรอก — ดูจากรูป</span>';
        if (s.status === 'pass') res = '<span class="status-ok">ผ่านเกณฑ์</span>';
        else if (s.status === 'fail') res = '<span class="status-bad">ต่ำกว่าเกณฑ์</span>';
        else if (!s.hasPhoto) res = '<span class="status-bad">ยังไม่มีรูปและค่า</span>';
        return `<tr><td>${esc(s.label)}</td><td class="r num">${val(s.dl, s.ul)}</td><td class="r num">≥ ${s.minDl} / ${s.minUl}</td><td>${res}</td></tr>`;
      }).join('')}</tbody></table></div>
      ${c.checks.gecc.length ? `<p class="small" style="margin-top:8px">ห้อง GECC: ${c.checks.gecc.map(g => `${esc(g.label)} — <span class="status-${g.authen ? 'ok' : 'warn'}">${g.authen ? 'ยืนยัน Authen แล้ว' : 'ยังไม่ยืนยัน Authen'}</span>`).join(' · ')}</p>` : ''}`;
  }

  function shot(so, slot, label, url, extra = '') {
    const key = `${so}|${slot}`;
    const flagged = S.flags.has(key);
    const idx = url ? S.photos.push({ url, so, slot, label, key }) - 1 : -1;
    return `<div class="shot ${extra}" data-flagged="${flagged}">
      ${url ? `<button type="button" class="shot__img" data-open="${idx}" aria-label="ดูรูป ${esc(label)}"><img src="${esc(url)}" alt="${esc(label)}" loading="lazy" /></button>
        <button type="button" class="shot__flag" data-flag="${esc(key)}" aria-pressed="${flagged}">${flagged ? 'ติดธงแล้ว' : 'ติดธง'}</button>`
        : `<div class="shot__img none">ไม่มีรูป</div>`}
      <div class="shot__cap">${esc(label)}</div></div>`;
  }

  function renderDetail() {
    const pane = $('#detailPane');
    if (!pane) return;
    if (!S.detailKey) {
      pane.innerHTML = '<div class="empty"><p><b>เลือก Site จากรายการด้านซ้าย</b></p><p class="small">เริ่มจากกลุ่ม “รอตรวจ” — เรียงจากรอนานสุดก่อน</p></div>';
      return;
    }
    if (S.detailLoading || !S.detail) {
      pane.innerHTML = S.detailLoading ? '<div class="empty">กำลังโหลด…</div>' : '<div class="empty">ไม่พบข้อมูล Site นี้ <a href="#/review">กลับไปรายการ</a></div>';
      return;
    }
    const keepScroll = pane.scrollTop;
    S.photos = [];
    const { site, circuits } = S.detail;
    const first = circuits[0];
    const multi = circuits.length > 1;
    const state = site.state;

    let banner = '';
    if (state === 'approved') banner = `<div class="banner banner--ok"><div><b>อนุมัติและล็อกแล้ว — ช่างแก้ไขไม่ได้</b>โดย ${esc(site.reviewer || '-')} เมื่อ ${fmtDT(site.reviewed_at)}${site.review_note ? ` · “${esc(site.review_note)}”` : ''}<br><span class="small">Admin ยังแก้ไขข้อมูลได้ (ระบบบันทึกประวัติ) หรือปลดล็อกเพื่อกลับไปตรวจใหม่</span></div></div>`;
    else if (state === 'rejected') banner = `<div class="banner banner--bad"><div><b>ส่งกลับให้ช่างแก้ไข — รอช่างส่งงานใหม่</b>${esc(site.review_note || '')}<br><span class="small">โดย ${esc(site.reviewer || '-')} เมื่อ ${fmtDT(site.reviewed_at)}</span></div></div>`;
    else if (state === 'working') banner = '<div class="banner banner--warn"><div><b>ช่างยังไม่ส่งตรวจ</b>ข้อมูลที่เห็นอาจยังไม่ครบ</div></div>';
    else if (state === 'todo') banner = '<div class="banner banner--info"><div><b>ยังไม่มีการทำงานใน Site นี้</b></div></div>';

    const sys = site.ready
      ? '<div class="banner banner--ok"><div><b>ระบบตรวจผ่านครบ</b>รูปครบ · S/N ตรง · ความเร็วถึงเกณฑ์ · ใบส่งมอบครบ 2 หน้า (ยังต้องดูรูปเทียบข้อมูลด้วยตา)</div></div>'
      : `<div class="banner banner--warn"><div><b>ระบบพบข้อสังเกต</b><ul>${circuits.map(c => c.checks.problems.length ? `<li>${multi ? `<b>${esc(c.so_number)}</b>: ` : ''}${c.checks.problems.map(esc).join(' · ')}</li>` : '').join('')}</ul></div></div>`;

    const canApprove = state !== 'todo';
    const actions = `
      <div class="actions">
        ${state === 'approved'
          ? '<button class="btn" data-act="unlock" type="button">ปลดล็อก (กลับเป็นรอตรวจ)</button>'
          : `<button class="btn btn--ok" data-act="approve" type="button" ${canApprove ? '' : 'disabled'}>อนุมัติและล็อก</button>`}
        <button class="btn btn--bad" data-act="reject" type="button" ${state === 'todo' ? 'disabled' : ''}>ส่งกลับให้ช่างแก้ไข</button>
        <span class="spacer"></span>
        <a class="btn btn--sm" href="/?so=${encodeURIComponent(first.so_number)}&desk=1" target="_blank" rel="noopener" title="เปิดหน้าแก้ไขข้อมูล (Admin แก้ได้แม้ล็อก)">แก้ไขข้อมูลเอง ↗</a>
        <a class="btn btn--sm" href="/api/circuits/${encodeURIComponent(first.so_number)}/report.docx">รายงาน Word</a>
        <a class="btn btn--sm" href="/report.html?id=${encodeURIComponent(first.so_number)}" target="_blank" rel="noopener">พิมพ์ / PDF</a>
      </div>`;

    const circuitHtml = circuits.map((c, i) => {
      const col = CIRCUIT_COLORS[i % CIRCUIT_COLORS.length];
      const slots = (c.completeness && c.completeness.onsiteSlots) || [];
      return `<section class="circuit" style="--cc-solid:${col.solid};--cc-line:${col.line};--cc-soft:${col.soft};--cc-ink:${col.ink}" aria-label="วงจร ${esc(c.so_number)}">
        <div class="circuit__head">
          <h2>${multi ? `วงจรที่ ${i + 1} · ` : ''}${esc(c.so_number)} <span style="font-weight:500;opacity:.9">· ${esc(c.service_no || '')}</span></h2>
          <span>${chip(c.admin_status === 'approved' ? 'approved' : c.admin_status === 'rejected' ? 'rejected' : c.admin_status === 'pending_review' ? 'pending_review' : (c.checkin_time ? 'working' : 'todo'))}
          <span class="chip">รูปหน้างาน ${c.checks.onsite.up}/${c.checks.onsite.req}</span></span>
        </div>
        <div class="circuit__body">
          ${deviceTable(c)}
          ${speedTable(c)}
          <h3>รูปถ่ายหน้างาน <span class="small muted" style="font-weight:400">· คลิกเพื่อขยาย · “ติดธง” รูปที่ต้องให้ช่างแก้</span></h3>
          <div class="photos">${slots.map(s => shot(c.so_number, s.slotKey, s.shortName, s.photoUrl)).join('')}</div>
        </div>
      </section>`;
    }).join('');

    const hoSlots = (first.completeness && first.completeness.handoverSlots) || [];
    const handover = `<section class="section" style="margin-top:22px"><h2>ใบส่งมอบงาน (1 ใบต่อ Site)</h2>
      <div class="handover">${hoSlots.map(s => shot(first.so_number, s.slotKey, s.shortName, s.photoUrl)).join('')}</div></section>`;

    const hist = [];
    const seen = new Set();
    circuits.forEach(c => (c.admin_history || []).forEach(h => { const k = `${h.at}|${h.action}|${h.by}`; if (!seen.has(k)) { seen.add(k); hist.push(h); } }));
    hist.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const ACT = { approve: 'อนุมัติและล็อก', reject: 'ส่งกลับให้แก้ไข', unlock: 'ปลดล็อก', edit: 'Admin แก้ไขข้อมูล' };
    const history = `<section class="section"><h2>ประวัติการตรวจ</h2>${hist.length
      ? `<ul class="history">${hist.map(h => `<li><time>${fmtDT(h.at)}</time><span><b>${esc(ACT[h.action] || h.action)}</b> · ${esc(h.by)}${h.note ? ` — ${esc(h.note)}` : ''}</span></li>`).join('')}</ul>`
      : '<p class="muted">ยังไม่มีประวัติ</p>'}</section>`;

    pane.innerHTML = `<div class="detail__inner">
      <a class="btn btn--quiet btn--sm back-only" href="#/review">← กลับไปรายการ</a>
      <div class="dhead">
        <div>
          <h1>${esc(site.name)}</h1>
          <div class="meta"><span>${esc(site.province)} · ${esc(site.region)}</span><span>${circuits.length} วงจร</span>
            <span>ช่าง <b>${esc(site.tech_name || '-')}</b>${site.tech_phone ? ` (<a href="tel:${esc(site.tech_phone)}">${esc(site.tech_phone)}</a>)` : ''}</span>
            <span>เข้า <b>${fmtDT(site.checkin_at)}</b></span><span>ส่งตรวจ <b>${fmtDT(site.submitted_at)}</b></span><span>ใช้เวลา <b>${dur(site.duration_min)}</b></span></div>
        </div>
        ${chip(state)}
      </div>
      ${actions}${banner}${sys}${circuitHtml}${handover}${history}
    </div>`;
    pane.scrollTop = keepScroll;
  }

  /* ------------------------------------------------------------------------
     Dialogs & review actions
     ------------------------------------------------------------------------ */
  function openDialog({ title, body, confirm, tone = 'primary', onConfirm }) {
    const dlg = $('#dlg');
    dlg.innerHTML = `<form method="dialog" id="dlgForm">
      <div class="dlg__head"><h2>${esc(title)}</h2></div>
      <div class="dlg__body">${body}<p class="err" id="dlgErr" role="alert"></p></div>
      <div class="dlg__foot"><button class="btn" type="button" id="dlgCancel">ยกเลิก</button><button class="btn btn--${tone}" type="submit" id="dlgOk">${esc(confirm)}</button></div></form>`;
    $('#dlgCancel').onclick = () => dlg.close();
    $('#dlgForm').onsubmit = async ev => {
      ev.preventDefault();
      const ok = $('#dlgOk'); const err = $('#dlgErr');
      err.textContent = ''; ok.disabled = true;
      try { await onConfirm(dlg); dlg.close(); } catch (e) { err.textContent = e.message; ok.disabled = false; }
    };
    dlg.showModal();
    const f = dlg.querySelector('textarea, input'); if (f) f.focus();
  }

  async function sendReview(decision, note, override = false) {
    const first = S.detail.circuits[0];
    const queueBefore = filteredSites().map(s => s.key);
    const res = await api('/api/admin/review', { method: 'POST', body: { so: first.so_number, decision, note, override } });
    S.detail = { site: res.site, circuits: res.circuits };
    await loadSites();
    renderQueue();
    renderDetail();
    // Keep the queue moving: after finishing a Site go to the next one waiting.
    if (decision !== 'unlock' && S.filter === 'pending_review') {
      const i = queueBefore.indexOf(S.detailKey);
      const next = queueBefore.slice(i + 1).concat(queueBefore.slice(0, Math.max(0, i))).find(k => S.sites.find(s => s.key === k && s.state === 'pending_review'));
      if (next) { toast(decision === 'approve' ? 'อนุมัติและล็อกแล้ว — ไป Site ถัดไป' : 'ส่งกลับแล้ว — ไป Site ถัดไป', 'ok'); location.hash = reviewHref(next); return; }
    }
    toast(decision === 'approve' ? 'อนุมัติและล็อกแล้ว' : decision === 'reject' ? 'ส่งกลับให้ช่างแก้ไขแล้ว' : 'ปลดล็อกแล้ว', 'ok');
  }

  function flaggedList() {
    return S.detail.circuits.flatMap(c => ((c.completeness && c.completeness.onsiteSlots) || [])
      .concat((c.completeness && c.completeness.handoverSlots) || [])
      .filter(s => S.flags.has(`${c.so_number}|${s.slotKey}`))
      .map(s => `${S.detail.circuits.length > 1 ? `${c.so_number} · ` : ''}${s.shortName}`));
  }

  function actApprove() {
    const { site } = S.detail;
    const flagged = flaggedList();
    const notices = [];
    if (!site.ready) notices.push(`<b>ระบบพบข้อสังเกต</b><ul>${S.detail.circuits.map(c => c.checks.problems.length ? `<li>${esc(c.so_number)}: ${c.checks.problems.map(esc).join(' · ')}</li>` : '').join('')}</ul>`);
    if (flagged.length) notices.push(`<b>คุณติดธงรูปไว้ ${flagged.length} รูป</b><ul>${flagged.map(f => `<li>${esc(f)}</li>`).join('')}</ul>`);
    const needAck = notices.length > 0;
    openDialog({
      title: `อนุมัติและล็อก “${site.name}”`,
      confirm: 'อนุมัติและล็อก', tone: 'ok',
      body: `<p style="margin-bottom:12px">เมื่ออนุมัติ ข้อมูลและรูปทั้ง ${site.circuits.length} วงจรของ Site นี้จะถูกล็อก ช่างแก้ไขไม่ได้อีก</p>
        ${needAck ? `<div class="banner banner--warn" style="margin:0 0 12px"><div>${notices.join('')}</div></div>
          <label class="checks" style="margin-bottom:12px"><span style="display:inline-flex;gap:8px;align-items:center"><input type="checkbox" id="ack" /> ฉันตรวจแล้ว ขออนุมัติทั้งที่มีข้อสังเกตข้างต้น</span></label>` : ''}
        <label class="field"><span>หมายเหตุ (ไม่บังคับ)</span><textarea class="textarea" id="dlgNote" style="min-height:70px"></textarea></label>`,
      onConfirm: async () => {
        if (needAck && !$('#ack').checked) throw new Error('กรุณาติ๊กยืนยันว่าตรวจแล้ว');
        await sendReview('approve', $('#dlgNote').value.trim(), needAck);
      }
    });
  }

  function actReject() {
    const { site } = S.detail;
    const flagged = flaggedList();
    const pre = flagged.length ? `รูปที่ต้องแก้ไข:\n${flagged.map(f => `- ${f}`).join('\n')}\n\n` : '';
    openDialog({
      title: `ส่งกลับให้ช่างแก้ไข “${site.name}”`,
      confirm: 'ส่งกลับ', tone: 'danger',
      body: `<p style="margin-bottom:12px">ช่างจะเห็นข้อความนี้ในแอป เปิดแก้ไขได้ และต้องกดส่งงานใหม่</p>
        <label class="field"><span>สิ่งที่ต้องแก้ไข</span><textarea class="textarea" id="dlgNote" placeholder="เช่น ถ่ายรูป Sticker S/N ใหม่ให้เห็นตัวเลขชัดเจน">${esc(pre)}</textarea></label>
        ${site.problems.length ? '<button class="btn btn--sm" type="button" id="addSys">ใส่ข้อสังเกตจากระบบ</button>' : ''}`,
      onConfirm: async () => {
        const note = $('#dlgNote').value.trim();
        if (note.length < 3) throw new Error('กรุณาระบุสิ่งที่ต้องแก้ไข');
        await sendReview('reject', note);
      }
    });
    const add = $('#addSys');
    if (add) add.onclick = () => { const t = $('#dlgNote'); t.value = `${t.value.trim()}${t.value.trim() ? '\n' : ''}${site.problems.map(p => `- ${p}`).join('\n')}`; };
  }

  function actUnlock() {
    const { site } = S.detail;
    openDialog({
      title: `ปลดล็อก “${site.name}”`,
      confirm: 'ปลดล็อก', tone: 'primary',
      body: `<p style="margin-bottom:12px">Site จะกลับเป็น “รอตรวจ” และช่างแก้ไขได้อีกครั้ง ถ้าต้องการให้ช่างแก้เรื่องใดให้ใช้ “ส่งกลับให้ช่างแก้ไข” แทน</p>
        <label class="field"><span>เหตุผล</span><textarea class="textarea" id="dlgNote" style="min-height:70px"></textarea></label>`,
      onConfirm: async () => {
        const note = $('#dlgNote').value.trim();
        if (note.length < 3) throw new Error('กรุณาระบุเหตุผลที่ปลดล็อก');
        await sendReview('unlock', note);
      }
    });
  }

  /* ------------------------------------------------------------------------
     Lightbox
     ------------------------------------------------------------------------ */
  let lbIndex = 0;
  function openLightbox(i) {
    lbIndex = i;
    const lb = $('#lightbox');
    drawLightbox();
    if (!lb.open) lb.showModal();
  }
  function drawLightbox() {
    const p = S.photos[lbIndex];
    if (!p) return;
    const flagged = S.flags.has(p.key);
    $('#lightbox').innerHTML = `<div class="lb">
      <div class="lb__bar">
        <span class="grow">${esc(p.so)} · ${esc(p.label)} <span class="num" style="opacity:.7;font-weight:400">(${lbIndex + 1}/${S.photos.length})</span></span>
        <button class="btn btn--sm" data-lb="prev" type="button" aria-label="รูปก่อนหน้า">←</button>
        <button class="btn btn--sm" data-lb="next" type="button" aria-label="รูปถัดไป">→</button>
        <button class="btn btn--sm ${flagged ? 'on' : ''}" data-lb="flag" type="button" aria-pressed="${flagged}">${flagged ? 'ติดธงแล้ว' : 'ติดธงรูปนี้'}</button>
        <a class="btn btn--sm" href="${esc(p.url)}" target="_blank" rel="noopener">เปิดเต็มจอ</a>
        <button class="btn btn--sm" data-lb="close" type="button">ปิด (Esc)</button>
      </div>
      <div class="lb__stage" id="lbStage"><img src="${esc(p.url)}" alt="${esc(p.label)}" /></div></div>`;
  }
  function toggleFlag(key) {
    if (S.flags.has(key)) S.flags.delete(key); else S.flags.add(key);
  }

  /* ------------------------------------------------------------------------
     Export
     ------------------------------------------------------------------------ */
  const exp = { states: new Set(['approved']), region: '', province: '', level: 'sites', selected: new Set(), zip: null };

  function exportSites() {
    return S.sites.filter(s => (!exp.states.size || exp.states.has(s.state)) && (!exp.region || s.region === exp.region) && (!exp.province || s.province === exp.province));
  }
  const filename = h => {
    if (!h) return '';
    const m = /filename\*=UTF-8''([^;]+)/i.exec(h) || /filename="?([^";]+)"?/i.exec(h);
    try { return m ? decodeURIComponent(m[1]) : ''; } catch (_) { return m ? m[1] : ''; }
  };
  const safe = s => String(s).replace(/[\\/:*?"<>|]+/g, '_').trim();

  function renderExport() {
    const view = $('#view');
    view.dataset.page = 'export';
    const regions = Array.from(new Set(S.sites.map(s => s.region))).sort((a, b) => REGIONS.indexOf(a) - REGIONS.indexOf(b));
    const provs = Array.from(new Set(S.sites.filter(s => !exp.region || s.region === exp.region).map(s => s.province))).sort((a, b) => a.localeCompare(b, 'th'));
    const counts = countBy(S.sites, s => s.state);
    view.innerHTML = `
      <div class="page">
        <div class="page-head"><div><h1>ส่งออกข้อมูลและเอกสาร</h1><p class="muted small">เลือกขอบเขตข้อมูลก่อน แล้วเลือกว่าจะส่งออกเป็นตารางภาพรวมหรือเอกสารรายงาน</p></div></div>

        <section class="section" aria-labelledby="hScope">
          <h2 id="hScope">1. เลือกขอบเขต</h2>
          <div class="checks" role="group" aria-label="สถานะ">${STATE_ORDER.map(s => `<label><input type="checkbox" data-state="${s}" ${exp.states.has(s) ? 'checked' : ''} /> ${STATE[s]} <span class="muted num">(${counts[s] || 0})</span></label>`).join('')}</div>
          <div class="formgrid" style="margin-top:12px;max-width:560px">
            <label class="field" style="margin:0"><span>ภาค</span><select class="select" id="exRegion"><option value="">ทุกภาค</option>${regions.map(r => `<option ${r === exp.region ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></label>
            <label class="field" style="margin:0"><span>จังหวัด</span><select class="select" id="exProv"><option value="">ทุกจังหวัด</option>${provs.map(p => `<option ${p === exp.province ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label>
          </div>
          <p class="hint" id="exCount"></p>
        </section>

        <section class="section" aria-labelledby="hCsv">
          <h2 id="hCsv">2. ตารางภาพรวม (CSV เปิดด้วย Excel)</h2>
          <div class="checks" role="radiogroup" aria-label="ระดับข้อมูล">
            <label><input type="radio" name="level" value="sites" ${exp.level === 'sites' ? 'checked' : ''} /> ระดับ Site (1 แถวต่อ Site)</label>
            <label><input type="radio" name="level" value="circuits" ${exp.level === 'circuits' ? 'checked' : ''} /> ระดับวงจร (1 แถวต่อวงจร พร้อมรายละเอียดอุปกรณ์ S/N ความเร็ว)</label>
          </div>
          <div class="row-actions"><a class="btn btn--primary" id="csvBtn" href="#">ดาวน์โหลด CSV</a></div>
        </section>

        <section class="section" aria-labelledby="hDocs">
          <h2 id="hDocs">3. เอกสารรายงานรายสถานที่ (Word / PDF)</h2>
          <p class="muted small" style="margin-bottom:10px">1 Site = 1 ไฟล์ รวมทุกวงจร พร้อมรูปถ่ายและใบส่งมอบ · ปกติควรส่งออกเฉพาะ “อนุมัติแล้ว”</p>
          <div class="row-actions" style="margin:0 0 10px">
            <button class="btn btn--primary" id="zipBtn" type="button">ดาวน์โหลดที่เลือกเป็น ZIP (Word)</button>
            <button class="btn btn--sm" id="selAll" type="button">เลือกทั้งหมด</button>
            <button class="btn btn--sm" id="selNone" type="button">ไม่เลือก</button>
            <span class="muted small" id="selCount"></span>
          </div>
          <div id="zipProg" hidden><div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i id="zipBar" style="transform:scaleX(0)"></i></div><p class="small muted" id="zipMsg" style="margin-top:6px"></p></div>
          <div class="table-wrap" style="max-height:520px;overflow:auto"><table>
            <thead><tr><th style="width:36px"></th><th>จังหวัด</th><th>Site</th><th>วงจร</th><th>สถานะ</th><th>เอกสาร</th></tr></thead>
            <tbody id="docBody"></tbody></table></div>
        </section>
      </div>`;

    const refresh = () => {
      const list = exportSites();
      $('#exCount').textContent = `ขอบเขตนี้มี ${list.length} Site · ${list.reduce((a, s) => a + s.circuits.length, 0)} วงจร`;
      const q = new URLSearchParams();
      if (exp.states.size) q.set('state', Array.from(exp.states).join(','));
      if (exp.region) q.set('region', exp.region);
      if (exp.province) q.set('province', exp.province);
      $('#csvBtn').href = `/api/admin/export/${exp.level === 'sites' ? 'sites' : 'circuits'}.csv?${q}`;
      exp.selected = new Set(Array.from(exp.selected).filter(k => list.some(s => s.key === k)));
      $('#docBody').innerHTML = list.slice(0, 400).map(s => `<tr>
        <td><input type="checkbox" data-sel="${esc(s.key)}" ${exp.selected.has(s.key) ? 'checked' : ''} aria-label="เลือก ${esc(s.name)}" /></td>
        <td>${esc(s.province)}</td><td><b>${esc(s.name)}</b></td><td class="num">${s.circuits.length}</td><td>${chip(s.state)}</td>
        <td><a class="btn btn--sm" href="/api/circuits/${encodeURIComponent(s.circuits[0].so)}/report.docx">Word</a>
          <a class="btn btn--sm" href="/report.html?id=${encodeURIComponent(s.circuits[0].so)}" target="_blank" rel="noopener">พิมพ์ / PDF</a></td></tr>`).join('')
        || '<tr><td colspan="6" class="muted">ไม่มี Site ในขอบเขตนี้</td></tr>';
      $('#selCount').textContent = `เลือกแล้ว ${exp.selected.size} Site`;
      $('#zipBtn').disabled = exp.selected.size === 0 || Boolean(exp.zip);
    };
    refresh();

    $$('[data-state]').forEach(cb => cb.addEventListener('change', () => { cb.checked ? exp.states.add(cb.dataset.state) : exp.states.delete(cb.dataset.state); refresh(); }));
    $('#exRegion').addEventListener('change', e => { exp.region = e.target.value; exp.province = ''; renderExport(); });
    $('#exProv').addEventListener('change', e => { exp.province = e.target.value; refresh(); });
    $$('input[name=level]').forEach(r => r.addEventListener('change', () => { exp.level = r.value; refresh(); }));
    $('#docBody').addEventListener('change', e => {
      const k = e.target.dataset && e.target.dataset.sel;
      if (!k) return;
      e.target.checked ? exp.selected.add(k) : exp.selected.delete(k);
      $('#selCount').textContent = `เลือกแล้ว ${exp.selected.size} Site`;
      $('#zipBtn').disabled = exp.selected.size === 0 || Boolean(exp.zip);
    });
    $('#selAll').addEventListener('click', () => { exportSites().slice(0, 400).forEach(s => exp.selected.add(s.key)); refresh(); });
    $('#selNone').addEventListener('click', () => { exp.selected.clear(); refresh(); });
    $('#zipBtn').addEventListener('click', bulkZip);
  }

  function loadJsZip() {
    if (window.JSZip) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('โหลดตัวสร้างไฟล์ ZIP ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่'));
      document.head.appendChild(s);
    });
  }

  async function bulkZip() {
    const list = S.sites.filter(s => exp.selected.has(s.key));
    if (!list.length) return;
    exp.zip = true;
    const bar = $('#zipBar'); const msg = $('#zipMsg');
    $('#zipProg').hidden = false; $('#zipBtn').disabled = true;
    const fails = [];
    try {
      await loadJsZip();
      const zip = new window.JSZip();
      let done = 0;
      const set = (frac, text) => { bar.style.transform = `scaleX(${frac})`; msg.textContent = text; };
      set(0, `กำลังสร้างเอกสาร 0/${list.length}`);
      const queue = list.slice();
      const worker = async () => {
        while (queue.length) {
          const s = queue.shift();
          try {
            const res = await fetch(`/api/circuits/${encodeURIComponent(s.circuits[0].so)}/report.docx`, { credentials: 'same-origin' });
            if (!res.ok) throw new Error(String(res.status));
            const name = safe(filename(res.headers.get('Content-Disposition')) || `${s.circuits[0].so}.docx`);
            zip.folder(safe(s.province)).file(name, await res.blob());
          } catch (e) { fails.push(`${s.name} (${e.message})`); }
          done++;
          set(done / list.length * 0.9, `กำลังสร้างเอกสาร ${done}/${list.length}`);
        }
      };
      await Promise.all([worker(), worker()]);
      set(0.92, 'กำลังบีบอัดไฟล์ ZIP…');
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, m => set(0.92 + m.percent / 100 * 0.08, `กำลังบีบอัดไฟล์ ZIP ${Math.round(m.percent)}%`));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `DLT_Onsite_Reports_${dayKey(new Date())}.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      set(1, fails.length ? `เสร็จแล้ว ${list.length - fails.length}/${list.length} ไฟล์ · ล้มเหลว: ${fails.join(', ')}` : `เสร็จแล้ว ${list.length} ไฟล์`);
      toast(fails.length ? 'ZIP พร้อมแล้ว แต่บางไฟล์สร้างไม่สำเร็จ' : 'ดาวน์โหลด ZIP แล้ว', fails.length ? 'bad' : 'ok');
    } catch (e) {
      msg.textContent = e.message;
      toast(e.message, 'bad');
    } finally {
      exp.zip = null;
      const b = $('#zipBtn'); if (b) b.disabled = exp.selected.size === 0;
    }
  }

  /* ------------------------------------------------------------------------
     UAT tools
     ------------------------------------------------------------------------ */
  function renderTools() {
    $('#view').dataset.page = 'tools';
    const changed = S.sites.filter(s => s.state !== 'todo').length;
    $('#view').innerHTML = `
      <div class="page">
        <div class="page-head"><div><h1>เครื่องมือสำหรับ UAT</h1><p class="muted small">ใช้ตอนทดสอบเท่านั้น — ล้างข้อมูลที่กรอกกลับเป็นค่าเริ่มต้นของระบบ</p></div></div>
        <section class="section danger">
          <h2>ล้างข้อมูลรายสถานที่</h2>
          <p class="muted" style="margin-bottom:12px">ลบข้อมูลที่ช่างกรอก รูปถ่าย และสถานะการตรวจของ Site ที่เลือก ระบบสำรองข้อมูลก่อนล้างทุกครั้ง</p>
          <label class="field" style="max-width:520px"><span>เลือก Site</span>
            <input class="input" id="rsSite" list="rsList" placeholder="พิมพ์ชื่อ Site หรือจังหวัด" />
            <datalist id="rsList">${S.sites.filter(s => s.state !== 'todo').map(s => `<option value="${esc(`${s.province} · ${s.name}`)}"></option>`).join('')}</datalist>
            <span class="hint">แสดงเฉพาะ Site ที่มีการทำงานแล้ว (${changed} Site)</span></label>
          <button class="btn btn--danger" id="rsBtn" type="button">ล้าง Site นี้</button>
        </section>
        <section class="section danger">
          <h2>ล้างข้อมูลทั้งหมด</h2>
          <p class="muted" style="margin-bottom:12px">ล้างทุก Site ที่มีการทำงาน (${changed} Site) กลับเป็นค่าเริ่มต้น ใช้ก่อนเริ่มใช้งานจริงหลังจบ UAT</p>
          <button class="btn btn--danger" id="rsAllBtn" type="button" ${changed ? '' : 'disabled'}>ล้างทั้งหมด</button>
        </section>
      </div>`;
    $('#rsBtn').addEventListener('click', () => {
      const site = S.sites.find(s => `${s.province} · ${s.name}` === $('#rsSite').value.trim());
      if (!site) { toast('เลือก Site จากรายการที่ขึ้นมา', 'bad'); return; }
      confirmReset(`ล้างข้อมูล “${site.name}”`, 'RESET', { site_key: site.key, confirm: 'RESET' });
    });
    $('#rsAllBtn').addEventListener('click', () => confirmReset('ล้างข้อมูลทั้งหมด', 'RESET ALL', { scope: 'all', confirm: 'RESET ALL' }));
  }

  function confirmReset(title, phrase, payload) {
    openDialog({
      title, confirm: 'ล้างข้อมูล', tone: 'danger',
      body: `<p style="margin-bottom:12px">การล้างข้อมูลย้อนกลับจากหน้านี้ไม่ได้ (ระบบเก็บสำเนาสำรองไว้ใน R2)</p>
        <label class="field"><span>พิมพ์ <b class="mono">${esc(phrase)}</b> เพื่อยืนยัน</span><input class="input" id="rsConfirm" autocomplete="off" /></label>`,
      onConfirm: async () => {
        if ($('#rsConfirm').value.trim() !== phrase) throw new Error(`พิมพ์ ${phrase} ให้ตรงเพื่อยืนยัน`);
        const r = await api('/api/admin/reset', { method: 'POST', body: payload });
        await loadSites();
        toast(`ล้างแล้ว ${r.reset} วงจร · ลบรูป ${r.photos_deleted} ไฟล์`, 'ok');
        render();
      }
    });
  }

  /* ------------------------------------------------------------------------
     Events
     ------------------------------------------------------------------------ */
  document.addEventListener('click', e => {
    const open = e.target.closest('[data-open]');
    if (open) { openLightbox(Number(open.dataset.open)); return; }
    const flag = e.target.closest('[data-flag]');
    if (flag) { toggleFlag(flag.dataset.flag); renderDetail(); return; }
    const act = e.target.closest('[data-act]');
    if (act && S.detail) {
      if (act.dataset.act === 'approve') actApprove();
      else if (act.dataset.act === 'reject') actReject();
      else if (act.dataset.act === 'unlock') actUnlock();
      return;
    }
    const lb = e.target.closest('[data-lb]');
    if (lb) {
      const a = lb.dataset.lb;
      if (a === 'close') $('#lightbox').close();
      else if (a === 'next') { lbIndex = (lbIndex + 1) % S.photos.length; drawLightbox(); }
      else if (a === 'prev') { lbIndex = (lbIndex - 1 + S.photos.length) % S.photos.length; drawLightbox(); }
      else if (a === 'flag') { toggleFlag(S.photos[lbIndex].key); drawLightbox(); renderDetail(); }
      return;
    }
    if (e.target.closest('#lbStage img')) $('#lbStage').classList.toggle('zoom');
    else if (e.target === $('#lightbox')) $('#lightbox').close();
  });

  document.addEventListener('keydown', e => {
    if (!$('#lightbox').open || !S.photos.length) return;
    if (e.key === 'ArrowRight') { lbIndex = (lbIndex + 1) % S.photos.length; drawLightbox(); }
    else if (e.key === 'ArrowLeft') { lbIndex = (lbIndex - 1 + S.photos.length) % S.photos.length; drawLightbox(); }
    else if (e.key.toLowerCase() === 'f') { toggleFlag(S.photos[lbIndex].key); drawLightbox(); renderDetail(); }
  });

  $('#logoutBtn').addEventListener('click', async () => {
    try { await api('/api/admin/logout', { method: 'POST', body: {} }); } catch (_) { /* ignore */ }
    S.me = null; S.sites = []; S.detail = null; S.detailKey = '';
    render();
  });

  window.addEventListener('hashchange', render);

  // Keep dashboard / queue fresh while the page is open.
  setInterval(async () => {
    if (!S.me || document.hidden || $('#dlg').open || $('#lightbox').open) return;
    const page = $('#view').dataset.page;
    if (page !== 'dashboard' && page !== 'review') return;
    try {
      await loadSites();
      if (page === 'dashboard') renderDashboard(); else renderQueue();
    } catch (_) { /* next tick */ }
  }, 60000);

  /* ------------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------------ */
  (async function boot() {
    try {
      const me = await api('/api/admin/me');
      S.configured = me.configured;
      if (me.admin) { S.me = { name: me.name }; await loadSites(); }
    } catch (e) { /* show login */ }
    render();
  })();
})();
