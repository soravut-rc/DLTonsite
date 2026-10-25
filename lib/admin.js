'use strict';
/**
 * Admin back-office for the Worker: login, review/lock workflow, site summaries,
 * CSV exports and the UAT reset tool.
 *
 * Kept in its own module so worker.js only needs a handful of hook lines.
 * Everything here is stateless between requests except what lives on the circuit
 * objects themselves (they are persisted to R2 by the worker).
 *
 * Auth: one shared password in the Cloudflare secret ADMIN_PASSWORD. Login sets an
 * HttpOnly, SameSite=Strict cookie signed with HMAC-SHA256 (key derived from the
 * password, so changing the password signs everybody out).
 */

const COOKIE = 'dlt_admin';
const SESSION_SECONDS = 12 * 3600;
const enc = new TextEncoder();
const dec = new TextDecoder();

/* --------------------------------------------------------------------------
   Crypto helpers (Web Crypto — available in Workers and Node >= 20)
   -------------------------------------------------------------------------- */
function b64url(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(str) {
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, ch => ch.charCodeAt(0));
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

/** Constant-time string comparison (compares fixed-length MACs of both inputs). */
async function safeEqual(a, b, salt) {
  const [x, y] = await Promise.all([hmac(salt, `cmp:${a}`), hmac(salt, `cmp:${b}`)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function authenticate(request, env) {
  const secret = env && env.ADMIN_PASSWORD;
  if (!secret) return null;
  const m = (request.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return null;
  const [payload, sig] = m[1].split('.');
  if (!payload || !sig) return null;
  const expect = b64url(await hmac(`session:${secret}`, payload));
  if (!(await safeEqual(expect, sig, secret))) return null;
  try {
    const data = JSON.parse(dec.decode(b64urlToBytes(payload)));
    if (!data || !data.e || data.e < Date.now() / 1000) return null;
    return { name: String(data.n || 'Admin') };
  } catch (_) {
    return null;
  }
}

async function makeSession(secret, name) {
  const payload = b64url(enc.encode(JSON.stringify({ n: name, e: Math.floor(Date.now() / 1000) + SESSION_SECONDS })));
  const sig = b64url(await hmac(`session:${secret}`, payload));
  return `${payload}.${sig}`;
}

const cookieAttrs = (url, maxAge) => `Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${url.protocol === 'https:' ? '; Secure' : ''}`;

/* --------------------------------------------------------------------------
   Display helpers — the seed data carries placeholders instead of real asset numbers
   (kept in sync with displayRouterAssetNo / displayApAssetNo in public/app.js)
   -------------------------------------------------------------------------- */
function displayRouterAssetNo(raw) {
  const v = String(raw ?? '').trim();
  if (!v || v === '-' || /^สขจ\.[^/]*$/.test(v) || /^1\s*to\s*all$/i.test(v)) return '-';
  return v;
}

function displayApAssetNo(raw) {
  const v = String(raw ?? '').trim();
  if (!v || v === '-' || /^สข[^/]*\/[A-Za-z]+\d*$/.test(v)) return '-';
  return v;
}

/** Copy of the circuits with placeholder asset numbers replaced by "-" (for reports/exports). */
function forReport(circuits) {
  const clone = typeof structuredClone === 'function' ? structuredClone(circuits) : JSON.parse(JSON.stringify(circuits));
  for (const c of clone) {
    if (c.router_info) c.router_info.asset_no = displayRouterAssetNo(c.router_info.asset_no);
    if (Array.isArray(c.access_points)) {
      for (const ap of c.access_points) if (ap) ap.asset_no = displayApAssetNo(ap.asset_no);
    }
  }
  return clone;
}

/**
 * The docx generator resolves photos synchronously from an in-memory map; in production the
 * photos live in R2, so fetch the ones this report needs first.
 */
async function loadPhotoMap(env, circuits, uploadsMap) {
  const map = new Map();
  const srcs = new Set();
  const text = JSON.stringify(circuits.map(c => [c.router_info, c.access_points]));
  for (const m of text.matchAll(/\/uploads\/[^"\\]+/g)) srcs.add(m[0]);
  await Promise.all(Array.from(srcs).map(async src => {
    if (uploadsMap && uploadsMap.has(src)) { map.set(src, uploadsMap.get(src)); return; }
    if (!env || !env.PHOTOS_BUCKET) return;
    try {
      const obj = await env.PHOTOS_BUCKET.get(src.replace(/^\//, ''));
      if (!obj) return;
      const mime = (obj.httpMetadata && obj.httpMetadata.contentType) || 'image/jpeg';
      const buf = Buffer.from(await obj.arrayBuffer());
      map.set(src, `data:${mime};base64,${buf.toString('base64')}`);
    } catch (_) { /* photo missing → report shows the placeholder box */ }
  }));
  return map;
}

/* --------------------------------------------------------------------------
   Review model
   -------------------------------------------------------------------------- */
const STATE_TH = {
  todo: 'ยังไม่เริ่ม',
  working: 'กำลังทำ',
  pending_review: 'รอตรวจ',
  rejected: 'ส่งกลับแก้ไข',
  approved: 'อนุมัติแล้ว'
};

const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isNaN(n) ? null : n; };
function parseTarget(str, fallback) {
  const m = String(str || '').match(/(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/);
  return m ? { dl: +m[1], ul: +m[2] } : fallback;
}
function speedRow(label, dl, ul, t, hasPhoto) {
  const d = num(dl);
  const u = num(ul);
  let status = 'none';
  if (d !== null || u !== null) status = (d !== null && u !== null && d >= t.dl && u >= t.ul) ? 'pass' : 'fail';
  return { label, dl: d, ul: u, minDl: t.dl, minUl: t.ul, status, hasPhoto: Boolean(hasPhoto) };
}

/** Everything an admin needs to judge one circuit, computed once on the server. */
function circuitChecks(c, comp) {
  const rt = c.router_info || {};
  const speeds = [];
  const rT = parseTarget(rt.speed_target || c.speed_pkg, { dl: 650, ul: 350 });
  speeds.push(speedRow('MikroTik · Port LAN 2', rt.speed_lan2_dl, rt.speed_lan2_ul, rT, rt.photo_lan2));
  speeds.push(speedRow('MikroTik · Port LAN 3', rt.speed_lan3_dl, rt.speed_lan3_ul, rT, rt.photo_lan3));
  const gecc = [];
  (Array.isArray(c.access_points) ? c.access_points : []).forEach((ap, i) => {
    if (!ap || ap.checked === false) return;
    const room = ap.room_type ? `ห้อง ${ap.room_type}` : (ap.room || `จุดที่ ${i + 1}`);
    speeds.push(speedRow(`AP ${i + 1} (${room}) · WiFi`, ap.speed_wifi_dl, ap.speed_wifi_ul, parseTarget(ap.wifi_target, { dl: 50, ul: 20 }), ap.photo_wifi));
    speeds.push(speedRow(`AP ${i + 1} (${room}) · สาย LAN`, ap.speed_lan_dl, ap.speed_lan_ul, parseTarget(ap.lan_target, { dl: 300, ul: 150 }), ap.photo_lan));
    if (ap.room_type === 'GECC') gecc.push({ label: `AP ${i + 1} (${room})`, authen: Boolean(ap.gecc_authen_tested || ap.gecc_authen_wifi) });
  });
  const sn = (comp.snRecheckItems || []).map(i => ({
    label: i.label, room: i.room, manual: i.manualSn, ocr: i.ocrSn, status: i.status,
    ok: i.status === 'matched' || (i.status === 'manual_only' && Boolean(i.manualSn))
  }));
  const snIssues = sn.filter(x => x.status === 'mismatch' || x.status === 'missing' || x.status === 'ocr_only').length;
  const speedFails = speeds.filter(s => s.status === 'fail').length;
  const problems = [];
  if (!comp.isOnsitePhotoComplete) problems.push(`รูปหน้างานขาด ${comp.onsiteRequiredCount - comp.onsiteUploadedCount} รูป`);
  if (comp.snMismatchCount) problems.push(`S/N ไม่ตรง ${comp.snMismatchCount} จุด`);
  if (comp.snMissingCount) problems.push(`S/N ยังไม่ระบุ ${comp.snMissingCount} จุด`);
  if (speedFails) problems.push(`ความเร็วต่ำกว่าเกณฑ์ ${speedFails} รายการ`);
  if (!comp.isHandoverComplete) problems.push(`ใบส่งมอบ ${comp.handoverUploadedCount}/2 หน้า`);
  const geccPending = gecc.filter(g => !g.authen).length;
  if (geccPending) problems.push(`GECC ยังไม่ยืนยัน Authen ${geccPending} จุด`);
  return {
    onsite: { up: comp.onsiteUploadedCount, req: comp.onsiteRequiredCount, ok: comp.isOnsitePhotoComplete, missing: comp.missingOnsitePhotoLabels || [] },
    handover: { n: comp.handoverUploadedCount, ok: comp.isHandoverComplete },
    sn, snIssues, speeds, speedFails, gecc, problems,
    ready: problems.length === 0
  };
}

function siteStateOf(circuits) {
  if (circuits.every(c => c.admin_status === 'approved')) return 'approved';
  if (circuits.some(c => c.admin_status === 'pending_review')) return 'pending_review';
  if (circuits.some(c => c.admin_status === 'rejected')) return 'rejected';
  if (circuits.some(c => c.checkin_time || c.status === 'in_progress' || c.status === 'completed' || c.status === 'issue' || c.inspector_name)) return 'working';
  return 'todo';
}

const maxIso = list => list.filter(Boolean).sort().slice(-1)[0] || '';
const minIso = list => list.filter(Boolean).sort()[0] || '';

function summarizeSite(key, circuits, h) {
  const rows = circuits.map(c => {
    const comp = h.evaluateCircuitCompleteness(c);
    const chk = circuitChecks(c, comp);
    return {
      so: c.so_number, service_no: c.service_no || '', status: c.status || 'pending',
      admin_status: c.admin_status || 'none', locked: Boolean(c.locked),
      onsite: [chk.onsite.up, chk.onsite.req], handover: chk.handover.n,
      sn_issues: chk.snIssues, speed_fails: chk.speedFails, ready: chk.ready, problems: chk.problems
    };
  });
  const first = circuits[0];
  const checkin = minIso(circuits.map(c => c.checkin_time));
  const submitted = circuits.every(c => c.checkout_time) ? maxIso(circuits.map(c => c.checkout_time)) : '';
  let duration = null;
  if (checkin && submitted) {
    const d = Math.round((new Date(submitted) - new Date(checkin)) / 60000);
    if (d >= 0) duration = d;
  }
  const reviewedCirc = circuits.filter(c => c.admin_reviewed_at).sort((a, b) => String(b.admin_reviewed_at).localeCompare(String(a.admin_reviewed_at)))[0];
  return {
    key,
    name: h.extractSiteNameServer(first),
    province: first.province || '',
    region: first.region || '',
    state: siteStateOf(circuits),
    locked: circuits.every(c => c.locked),
    tech_name: first.inspector_name || '',
    tech_phone: first.inspector_phone || '',
    checkin_at: checkin,
    submitted_at: submitted,
    duration_min: duration,
    reviewed_at: reviewedCirc ? reviewedCirc.admin_reviewed_at : '',
    reviewer: reviewedCirc ? (reviewedCirc.admin_reviewer || reviewedCirc.admin_name || '') : '',
    review_note: reviewedCirc ? (reviewedCirc.admin_review_note || reviewedCirc.admin_comment || '') : '',
    updated_at: maxIso(circuits.map(c => c.updated_at)),
    ready: rows.every(r => r.ready),
    problems: Array.from(new Set(rows.flatMap(r => r.problems))),
    circuits: rows
  };
}

function groupSites(h) {
  const groups = new Map();
  for (const c of h.circuitsMap.values()) {
    const key = h.getSiteGroupKeyServer(c);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  for (const list of groups.values()) list.sort((a, b) => String(a.so_number).localeCompare(String(b.so_number)));
  return groups;
}

function buildSites(h) {
  const out = [];
  for (const [key, list] of groupSites(h)) out.push(summarizeSite(key, list, h));
  return out.sort((a, b) => a.province.localeCompare(b.province, 'th') || a.name.localeCompare(b.name, 'th'));
}

function siteDetail(key, h) {
  const list = groupSites(h).get(key);
  if (!list) return null;
  const summary = summarizeSite(key, list, h);
  const circuits = list.map(c => {
    const comp = h.evaluateCircuitCompleteness(c);
    return { ...h.enrichCircuit(c), checks: circuitChecks(c, comp), admin_history: c.admin_history || [] };
  });
  return { site: summary, circuits };
}

/* --------------------------------------------------------------------------
   CSV exports
   -------------------------------------------------------------------------- */
const esc = val => {
  const s = String(val ?? '').replace(/\r?\n/g, ' ');
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (headers, rows) => '\uFEFF' + [headers, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
const fmtTime = iso => {
  const t = new Date(iso).getTime();
  return isNaN(t) ? '' : new Date(t + 7 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
};
const spd = (dl, ul) => (dl || ul ? `${dl || '-'}/${ul || '-'}` : '');

function pickSites(h, url) {
  const states = (url.searchParams.get('state') || '').split(',').filter(Boolean);
  const region = url.searchParams.get('region') || '';
  const province = url.searchParams.get('province') || '';
  return buildSites(h).filter(s =>
    (!states.length || states.includes(s.state)) &&
    (!region || s.region === region) &&
    (!province || s.province === province));
}

function sitesCsv(sites) {
  const headers = ['ภาค', 'จังหวัด', 'Site', 'จำนวนวงจร', 'เลขที่วงจร (S/O)', 'สถานะ', 'ล็อก', 'ช่าง', 'เบอร์ช่าง', 'เวลาเข้า Site', 'เวลาส่งตรวจ', 'ระยะเวลา (นาที)', 'รูปหน้างาน (ครบ/ทั้งหมด)', 'ใบส่งมอบ (หน้า)', 'ข้อสังเกตจากระบบ', 'ผู้ตรวจ', 'เวลาตรวจ', 'หมายเหตุผู้ตรวจ'];
  const rows = sites.map(s => [
    s.region, s.province, s.name, s.circuits.length, s.circuits.map(c => c.so).join(' '),
    STATE_TH[s.state], s.locked ? 'ล็อกแล้ว' : '', s.tech_name, s.tech_phone,
    fmtTime(s.checkin_at), fmtTime(s.submitted_at), s.duration_min ?? '',
    `${s.circuits.reduce((a, c) => a + c.onsite[0], 0)}/${s.circuits.reduce((a, c) => a + c.onsite[1], 0)}`,
    `${Math.min(...s.circuits.map(c => c.handover))}/2`,
    s.problems.join(' ; '), s.reviewer, fmtTime(s.reviewed_at), s.review_note
  ]);
  return toCsv(headers, rows);
}

function circuitsCsv(sites, h) {
  const circuits = [];
  const siteOf = new Map();
  for (const s of sites) for (const c of s.circuits) { const obj = h.circuitsMap.get(c.so); if (obj) { circuits.push(obj); siteOf.set(c.so, s); } }
  const report = forReport(circuits);
  const maxAp = Math.min(4, Math.max(1, ...report.map(c => (c.access_points || []).filter(a => a && a.checked !== false).length)));
  const headers = ['S/O', 'เลขวงจร (Service)', 'ภาค', 'จังหวัด', 'Site', 'แพ็กเกจ', 'สถานะตรวจรับ', 'ล็อก', 'ช่าง', 'เบอร์ช่าง', 'เวลาเข้า', 'เวลาส่งตรวจ', 'ผู้ตรวจ', 'เวลาตรวจ', 'หมายเหตุผู้ตรวจ',
    'รูปหน้างาน', 'ใบส่งมอบ (หน้า)', 'S/N ไม่ตรง/ยังไม่ระบุ', 'Router รุ่น', 'Router เลขครุภัณฑ์', 'Router S/N', 'Router S/N (OCR)', 'Router ห้อง', 'Router LAN2 DL/UL', 'Router LAN3 DL/UL'];
  for (let i = 1; i <= maxAp; i++) headers.push(`AP${i} ห้อง`, `AP${i} ยี่ห้อ/รุ่น`, `AP${i} เลขครุภัณฑ์`, `AP${i} S/N`, `AP${i} S/N (OCR)`, `AP${i} WiFi DL/UL`, `AP${i} LAN DL/UL`);
  headers.push('หมายเหตุหน้างาน');
  const rows = report.map(c => {
    const s = siteOf.get(c.so_number);
    const comp = h.evaluateCircuitCompleteness(c);
    const rt = c.router_info || {};
    const aps = (c.access_points || []).filter(a => a && a.checked !== false);
    const row = [
      c.so_number, c.service_no || '', c.region || '', c.province || '', s ? s.name : '', c.speed_pkg || '',
      STATE_TH[siteStateOf([c])], c.locked ? 'ล็อกแล้ว' : '', c.inspector_name || '', c.inspector_phone || '',
      fmtTime(c.checkin_time), fmtTime(c.checkout_time), c.admin_reviewer || c.admin_name || '', fmtTime(c.admin_reviewed_at), c.admin_review_note || c.admin_comment || '',
      `${comp.onsiteUploadedCount}/${comp.onsiteRequiredCount}`, `${comp.handoverUploadedCount}/2`, comp.snMismatchCount + comp.snMissingCount,
      rt.model || '', rt.asset_no, rt.serial_no || '', rt.ocr_serial_no || '', rt.room || '', spd(rt.speed_lan2_dl, rt.speed_lan2_ul), spd(rt.speed_lan3_dl, rt.speed_lan3_ul)
    ];
    for (let i = 0; i < maxAp; i++) {
      const a = aps[i];
      row.push(
        a ? (a.room || a.room_type || '') : '', a ? `${a.brand || ''} ${a.model || ''}`.trim() : '', a ? a.asset_no : '',
        a ? (a.serial_no || '') : '', a ? (a.ocr_serial_no || '') : '',
        a ? spd(a.speed_wifi_dl, a.speed_wifi_ul) : '', a ? spd(a.speed_lan_dl, a.speed_lan_ul) : ''
      );
    }
    row.push(c.remarks || '');
    return row;
  });
  return toCsv(headers, rows);
}

/* --------------------------------------------------------------------------
   Route handler
   -------------------------------------------------------------------------- */
const LOCKED_MSG = 'วงจรนี้ผ่านการตรวจรับและล็อกแล้ว แก้ไขไม่ได้ หากต้องแก้ไขโปรดติดต่อผู้ตรวจรับ (Admin)';
const NEED_LOGIN = { error: 'กรุณาเข้าสู่ระบบผู้ตรวจรับ (Admin) ที่หน้า /admin ก่อน', need_login: true };

const ADMIN_FIELDS = ['admin_status', 'admin_name', 'admin_comment', 'admin_reviewed_at', 'admin_reviewer', 'admin_review_time', 'admin_review_note', 'locked', 'locked_at', 'locked_by', 'admin_history'];

/** Technicians cannot write review/lock fields — drop them from their PUT bodies. */
function stripProtectedFields(body) {
  if (body && typeof body === 'object') for (const f of ADMIN_FIELDS) delete body[f];
  return body;
}

/** Block technician writes (PUT/checkin/checkout/upload/LINE) on locked circuits. Returns a 423 Response or null. */
async function guardWrite(request, url, h, adm) {
  if (adm) return null;
  const p = url.pathname;
  const m = request.method;
  let circuit = null;
  let siteWide = false;
  let mm;
  if ((m === 'PUT' || m === 'POST') && (mm = /^\/api\/circuits\/([^/]+)$/.exec(p))) {
    circuit = h.findCircuitByIdOrSo(decodeURIComponent(mm[1]));
  } else if (m === 'POST' && (mm = /^\/api\/circuits\/([^/]+)\/(checkin|checkout)$/.exec(p))) {
    circuit = h.findCircuitByIdOrSo(decodeURIComponent(mm[1]));
    siteWide = true;
  } else if (m === 'POST' && p === '/api/upload') {
    const body = await request.clone().json().catch(() => ({}));
    circuit = h.findCircuitByIdOrSo(body.so_number || body.circuitId);
  }
  if (!circuit) return null;
  const locked = siteWide ? h.getSiteCircuitsServer(circuit).some(c => c.locked) : Boolean(circuit.locked);
  return locked ? h.jsonResponse({ error: LOCKED_MSG, locked: true }, 423) : null;
}

/** Called when an admin saves a locked circuit through the regular PUT — leave a trace. */
function noteAdminEdit(circuit, adm) {
  if (!adm || !circuit || !circuit.locked) return;
  pushHistory(circuit, { at: new Date().toISOString(), by: adm.name, action: 'edit', note: 'แก้ไขข้อมูลหลังล็อก' });
}

function pushHistory(circuit, entry) {
  circuit.admin_history = [...(circuit.admin_history || []), entry].slice(-50);
}

async function handle(request, env, url, h, adm) {
  const p = url.pathname;
  const method = request.method;
  const isAdminPath = /^\/api\/admin\/(login|logout|me|sites|site|review|reset|export\/(?:sites|circuits)\.csv)$/.test(p);
  const aliasMatch = /^\/api\/circuits\/([^/]+)\/admin-review$/.exec(p);
  if (!isAdminPath && !aliasMatch) return null;

  const json = (data, status = 200) => h.jsonResponse(data, status);

  // CSRF belt-and-braces on top of SameSite=Strict: state-changing calls must come from this origin.
  if (method === 'POST') {
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return json({ error: 'คำขอไม่ได้มาจากหน้าเว็บของระบบ' }, 403);
  }

  if (p === '/api/admin/me' && method === 'GET') {
    return json({ admin: Boolean(adm), name: adm ? adm.name : '', configured: Boolean(env && env.ADMIN_PASSWORD) });
  }

  if (p === '/api/admin/login' && method === 'POST') {
    const secret = env && env.ADMIN_PASSWORD;
    if (!secret) return json({ error: 'ยังไม่ได้ตั้งรหัสผ่านผู้ตรวจรับ (ADMIN_PASSWORD) บนระบบ' }, 503);
    const body = await request.json().catch(() => ({}));
    const name = String(body.name || '').trim().slice(0, 60);
    if (name.length < 2) return json({ error: 'กรุณาใส่ชื่อผู้ตรวจรับ' }, 400);
    if (!(await safeEqual(String(body.password || ''), secret, secret))) {
      await sleep(700);
      return json({ error: 'รหัสผ่านไม่ถูกต้อง' }, 401);
    }
    const res = json({ ok: true, name });
    res.headers.append('Set-Cookie', `${COOKIE}=${await makeSession(secret, name)}; ${cookieAttrs(url, SESSION_SECONDS)}`);
    return res;
  }

  if (p === '/api/admin/logout' && method === 'POST') {
    const res = json({ ok: true });
    res.headers.append('Set-Cookie', `${COOKIE}=; ${cookieAttrs(url, 0)}`);
    return res;
  }

  if (!adm) return json(NEED_LOGIN, 401);

  if (p === '/api/admin/sites' && method === 'GET') {
    return json({ generated_at: new Date().toISOString(), sites: buildSites(h) });
  }

  if (p === '/api/admin/site' && method === 'GET') {
    const detail = siteDetail(url.searchParams.get('key') || '', h);
    return detail ? json(detail) : json({ error: 'ไม่พบ Site นี้' }, 404);
  }

  if (p === '/api/admin/export/sites.csv' && method === 'GET') {
    return csvResponse(sitesCsv(pickSites(h, url)), 'DLT_Onsite_Sites');
  }
  if (p === '/api/admin/export/circuits.csv' && method === 'GET') {
    return csvResponse(circuitsCsv(pickSites(h, url), h), 'DLT_Onsite_Circuits');
  }

  if ((p === '/api/admin/review' || aliasMatch) && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    if (aliasMatch) {
      body.so = decodeURIComponent(aliasMatch[1]);
      body.decision = body.decision === 'rejected' ? 'reject' : body.decision === 'approved' ? 'approve' : body.decision;
      body.note = body.note ?? body.admin_comment ?? body.adminComment;
      if (body.approve_whole_site === undefined) body.whole_site = false;
    }
    return review(env, url, h, adm, body);
  }

  if (p === '/api/admin/reset' && method === 'POST') {
    return resetData(env, h, adm, await request.json().catch(() => ({})));
  }

  return null;
}

function csvResponse(text, base) {
  const stamp = fmtTime(new Date().toISOString()).replace(/[: ]/g, '-');
  return new Response(text, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${base}_${stamp}.csv"`,
      'Cache-Control': 'no-store'
    }
  });
}

async function review(env, url, h, adm, body) {
  const json = (d, s = 200) => h.jsonResponse(d, s);
  const decision = String(body.decision || '');
  if (!['approve', 'reject', 'unlock'].includes(decision)) return json({ error: 'ไม่รู้จักคำสั่ง (approve / reject / unlock)' }, 400);
  const circuit = h.findCircuitByIdOrSo(body.so);
  if (!circuit) return json({ error: `ไม่พบวงจร ${body.so}` }, 404);
  const note = String(body.note || '').trim();
  const targets = body.whole_site === false ? [circuit] : h.getSiteCircuitsServer(circuit);

  if (decision === 'reject' && note.length < 3) return json({ error: 'กรุณาระบุสิ่งที่ช่างต้องแก้ไข' }, 400);

  if (decision === 'approve' && !body.override) {
    const problems = targets
      .map(t => ({ so: t.so_number, list: circuitChecks(t, h.evaluateCircuitCompleteness(t)).problems }))
      .filter(x => x.list.length);
    if (problems.length) {
      return json({ error: 'ยังมีข้อสังเกตที่ระบบตรวจพบ ยืนยันอนุมัติทั้งที่ยังมีข้อสังเกตหรือไม่', needs_override: true, problems }, 409);
    }
  }

  const now = new Date().toISOString();
  for (const t of targets) {
    t.admin_name = adm.name;
    t.admin_reviewer = adm.name;
    t.admin_comment = note;
    t.admin_review_note = note;
    t.admin_reviewed_at = now;
    t.admin_review_time = now;
    if (decision === 'approve') {
      t.admin_status = 'approved';
      t.locked = true;
      t.locked_at = now;
      t.locked_by = adm.name;
      t.status = 'completed';
      t.is_draft = false;
      t.checkin_status = 'checked_out';
      if (!t.checkout_time) t.checkout_time = now;
    } else if (decision === 'reject') {
      t.admin_status = 'rejected';
      t.locked = false;
      t.locked_at = '';
      t.locked_by = '';
      t.status = 'issue';
      // Reopen the job so the technician can fix it and submit again.
      t.prev_checkout_time = t.checkout_time || t.prev_checkout_time || '';
      t.checkin_status = 'checked_in';
      t.checkout_time = '';
    } else {
      t.admin_status = 'pending_review';
      t.locked = false;
      t.locked_at = '';
      t.locked_by = '';
    }
    t.updated_at = now;
    pushHistory(t, { at: now, by: adm.name, action: decision, note });
  }
  await h.persist(env, targets.map(t => t.so_number));

  const sos = targets.map(t => t.so_number).join(', ');
  const msg = decision === 'approve'
    ? `🎉 [ผู้ตรวจรับอนุมัติแล้ว — ล็อกข้อมูล]\nวงจร: ${sos} (${circuit.province})\nผู้ตรวจ: ${adm.name}${note ? `\nหมายเหตุ: ${note}` : ''}\n📄 รายงาน: ${url.origin}/api/circuits/${encodeURIComponent(circuit.so_number)}/report.docx`
    : decision === 'reject'
      ? `⚠️ [ผู้ตรวจรับส่งกลับให้แก้ไข]\nวงจร: ${sos} (${circuit.province})\nผู้ตรวจ: ${adm.name}\nสิ่งที่ต้องแก้ไข: ${note}\n👉 ${url.origin}/tech#/so/${encodeURIComponent(circuit.so_number)}`
      : `🔓 [ผู้ตรวจรับปลดล็อก]\nวงจร: ${sos}`;
  h.addLineMessage(circuit.line_user_id || 'sim_tech_01', 'bot', msg, '', circuit.so_number);

  return json({ ok: true, ...siteDetail(h.getSiteGroupKeyServer(circuit), h) });
}

/* --------------------------------------------------------------------------
   UAT reset — puts circuits back to their seed state and deletes their photos
   -------------------------------------------------------------------------- */
async function resetData(env, h, adm, body) {
  const json = (d, s = 200) => h.jsonResponse(d, s);
  let sos = [];
  if (body.scope === 'all') {
    if (body.confirm !== 'RESET ALL') return json({ error: 'พิมพ์ยืนยัน "RESET ALL" เพื่อล้างข้อมูลทั้งหมด' }, 400);
    sos = Array.from(h.modifiedSoNumbers);
  } else {
    if (body.confirm !== 'RESET') return json({ error: 'พิมพ์ยืนยัน "RESET" เพื่อล้างข้อมูล' }, 400);
    if (body.site_key) {
      sos = (groupSites(h).get(body.site_key) || []).map(c => c.so_number);
    } else if (Array.isArray(body.so_numbers)) {
      sos = body.so_numbers.map(String);
    }
    if (!sos.length) return json({ error: 'ไม่ระบุ Site หรือวงจรที่จะล้าง' }, 400);
  }

  // Safety net: keep a copy of the saved state before touching anything.
  let backupKey = '';
  if (env && env.PHOTOS_BUCKET) {
    const snapshot = Array.from(h.modifiedSoNumbers).map(so => h.circuitsMap.get(so)).filter(Boolean);
    backupKey = `backup/state-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    await env.PHOTOS_BUCKET.put(backupKey, JSON.stringify({ by: adm.name, circuits: snapshot }), { httpMetadata: { contentType: 'application/json' } });
  }

  let photos = 0;
  for (const so of sos) {
    const prefix = `uploads/${encodeURIComponent(so)}/`;
    if (env && env.PHOTOS_BUCKET) {
      let cursor;
      do {
        const page = await env.PHOTOS_BUCKET.list({ prefix, cursor });
        const keys = page.objects.map(o => o.key);
        if (keys.length) { await env.PHOTOS_BUCKET.delete(keys); photos += keys.length; }
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
    }
    for (const k of Array.from(h.uploadsMap.keys())) if (k.startsWith(`/${prefix}`)) h.uploadsMap.delete(k);
    h.modifiedSoNumbers.delete(so);
    h.reseed(so);
  }
  await h.persist(env, []);
  return json({ ok: true, reset: sos.length, photos_deleted: photos, backup: backupKey });
}

module.exports = {
  authenticate,
  handle,
  guardWrite,
  stripProtectedFields,
  noteAdminEdit,
  loadPhotoMap,
  forReport,
  displayRouterAssetNo,
  displayApAssetNo,
  circuitChecks,
  buildSites
};
