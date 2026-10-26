let allCircuits = [];
let globalStats = null;
let currentCircuit = null;
let splitPdfVisible = false;
let browseMode = 'province'; // 'province' (default quick grid) or 'all' (list view)
let selectedSubBranch = '';  // Sub-branch filter within a province
let gpsSortCenter = null;    // { lat, lng } when sorting by nearest GPS
let currentModalStep = 'step1'; // 'step1' | 'step23' | 'step4' | 'info' | 'all'
const sigPads = {};

const STATUS_BADGE = {
  pending: { label: '⏳ รอดำเนินการ', cls: 'bg-slate-100 text-slate-700 border-slate-300' },
  in_progress: { label: '🔧 กำลังดำเนินการ', cls: 'bg-amber-50 text-amber-800 border-amber-300' },
  completed: { label: '✅ ส่งมอบครบถ้วน', cls: 'bg-emerald-50 text-emerald-800 border-emerald-300' },
  issue: { label: '⚠️ ติดปัญหา/รอแก้ไข', cls: 'bg-rose-50 text-rose-800 border-rose-300' }
};

const AP_MODEL_PRESETS = {
  'TOTOLINK': ['A3002RU', 'X5000R', 'N302R Plus'],
  'TP-LINK': ['Archer C6', 'Archer AX10', 'Archer AX23', 'EAP225'],
  'D-LINK': ['DIR-825', 'DIR-842', 'COVR-1100']
};

// เกณฑ์ความเร็วและรายละเอียดตามประเภทห้องจากข้อกำหนดช่างเข้าดำเนินการ
const ROOM_SPECS = {
  'GPS': {
    code: 'GPS',
    fullLabel: 'ศูนย์เดินรถ GPS (ห้อง GPS)',
    shortRoom: 'ห้อง GPS',
    ssid: 'GPS',
    lanMinDl: 350,
    lanMinUl: 200,
    wifiMinDl: 50,
    wifiMinUl: 20,
    isGecc: false
  },
  'GECC': {
    code: 'GECC',
    fullLabel: 'ประชาสัมพันธ์ GECC (ห้อง GECC)',
    shortRoom: 'ห้อง GECC',
    ssid: 'GECC',
    lanMinDl: 300,
    lanMinUl: 150,
    wifiMinDl: 50,
    wifiMinUl: 20,
    isGecc: true
  },
  'DLS': {
    code: 'DLS',
    fullLabel: 'ห้องอบรม DLS (ห้อง DLS)',
    shortRoom: 'ห้อง DLS',
    ssid: 'DLS',
    lanMinDl: 300,
    lanMinUl: 150,
    wifiMinDl: 50,
    wifiMinUl: 20,
    isGecc: false
  },
  'VICC': {
    code: 'VICC',
    fullLabel: 'ตรวจสภาพ VICC (ห้อง VICC)',
    shortRoom: 'ห้อง VICC',
    ssid: 'VICC',
    lanMinDl: 350,
    lanMinUl: 200,
    wifiMinDl: 50,
    wifiMinUl: 20,
    isGecc: false
  }
};

function detectRoomSpec(roomStr = '') {
  const u = (roomStr || '').toUpperCase();
  if (u.includes('GECC') || u.includes('ประชาสัมพันธ์')) return ROOM_SPECS.GECC;
  if (u.includes('DLS') || u.includes('DSL') || u.includes('อบรม')) return ROOM_SPECS.DLS;
  if (u.includes('VICC') || u.includes('ตรวจสภาพ')) return ROOM_SPECS.VICC;
  return ROOM_SPECS.GPS;
}

// ============================================================================
// Initialization & Persistent Technician Profile (รองรับช่าง 40-50 คน)
// ============================================================================
function loadGlobalTechProfile() {
  try {
    const savedName = localStorage.getItem('dlt_tech_name') || '';
    const savedPhone = localStorage.getItem('dlt_tech_phone') || '';
    const gName = document.getElementById('globalTechName');
    const gPhone = document.getElementById('globalTechPhone');
    if (gName && savedName) gName.value = savedName;
    if (gPhone && savedPhone) gPhone.value = savedPhone;
    return { name: savedName, phone: savedPhone };
  } catch (_) {
    return { name: '', phone: '' };
  }
}

function saveGlobalTechProfile() {
  try {
    const gName = document.getElementById('globalTechName')?.value.trim() ||
      document.getElementById('modalQuickTechName')?.value.trim() || '';
    const gPhone = document.getElementById('globalTechPhone')?.value.trim() ||
      document.getElementById('modalQuickTechPhone')?.value.trim() || '';
    if (gName) localStorage.setItem('dlt_tech_name', gName);
    if (gPhone) localStorage.setItem('dlt_tech_phone', gPhone);
    const topNameEl = document.getElementById('globalTechName');
    const topPhoneEl = document.getElementById('globalTechPhone');
    if (topNameEl && gName && topNameEl.value !== gName) topNameEl.value = gName;
    if (topPhoneEl && gPhone && topPhoneEl.value !== gPhone) topPhoneEl.value = gPhone;
  } catch (_) {}
}

window.addEventListener('DOMContentLoaded', async () => {
  loadGlobalTechProfile();
  initSignaturePad('sigInspector');
  initSignaturePad('sigReceiver');
  await refreshAllData();

  // Support direct circuit link via URL query param: ?so=BINF3480006
  const params = new URLSearchParams(window.location.search);
  const targetSo = params.get('so') || params.get('circuit') || params.get('id');
  if (targetSo) {
    const cleanSo = targetSo.trim().toUpperCase();
    setTimeout(() => {
      openInspectionModal(cleanSo);
    }, 200);
  }
});

function toggleSopBanner() {
  const el = document.getElementById('sopBanner');
  if (el) el.classList.toggle('hidden');
}

function calculateClientStats(circuits) {
  const rows = circuits || [];
  const statusCounts = { pending: 0, in_progress: 0, completed: 0, issue: 0 };
  const byRegion = {};
  const byProvince = {};
  for (const r of rows) {
    const st = statusCounts[r.status] !== undefined ? r.status : 'pending';
    statusCounts[st]++;
    if (!byRegion[r.region]) byRegion[r.region] = { total: 0, pending: 0, in_progress: 0, completed: 0, issue: 0 };
    byRegion[r.region].total++;
    byRegion[r.region][st]++;
    const pKey = `${r.region}__${r.province}`;
    if (!byProvince[pKey]) byProvince[pKey] = { region: r.region, province: r.province, total: 0, completed: 0, in_progress: 0, pending: 0, issue: 0 };
    byProvince[pKey].total++;
    byProvince[pKey][st]++;
  }
  return {
    total: rows.length,
    withLegacyPdf: rows.filter(r => r.legacy_pdf_path).length,
    statusCounts,
    adminCounts: { working: 0, pending_review: 0, approved: 0, rejected: 0, sn_mismatch: 0, incomplete_photos: 0 },
    byRegion,
    provinces: Object.values(byProvince).sort((a, b) => (a.province || '').localeCompare(b.province || '', 'th'))
  };
}

async function refreshAllData() {
  try {
    const [statsRes, circuitsRes] = await Promise.all([
      fetch('/api/stats').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/circuits').then(r => r.json())
    ]);
    allCircuits = circuitsRes.circuits || [];
    globalStats = (statsRes && statsRes.statusCounts) ? statsRes : calculateClientStats(allCircuits);

    renderHeaderAndCards();
    populateProvinceDropdown();
    renderRecentCircuits();
    applyCircuitFilters();
    renderDashboard();
  } catch (err) {
    console.error('Failed to load data:', err);
    showToast('เกิดข้อผิดพลาดในการโหลดข้อมูล: ' + err.message, true);
  }
}

function showToast(msg, isError = false) {
  const el = document.getElementById('toastBox');
  el.textContent = msg;
  el.className = `fixed bottom-4 right-4 z-50 px-4 py-3 rounded-xl shadow-xl border text-xs font-semibold transition ${
    isError ? 'bg-rose-700 text-white border-rose-500' : 'bg-slate-900 text-white border-slate-700'
  }`;
  el.classList.remove('hidden');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}

// ============================================================================
// Header, KPI Cards, & Tabs
// ============================================================================
function renderHeaderAndCards() {
  if (!globalStats) return;
  const statusCounts = globalStats.statusCounts || { pending: 0, in_progress: 0, completed: 0, issue: 0 };
  const adminCounts = globalStats.adminCounts || globalStats.adminStatusCounts || {};
  const total = globalStats.total !== undefined ? globalStats.total : allCircuits.length;
  const withLegacyPdf = globalStats.withLegacyPdf || 0;
  const completed = statusCounts.completed || 0;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  document.getElementById('hdrTotalCircuits').textContent = total;
  document.getElementById('hdrProgressText').textContent = `${completed} / ${total} (${pct}%)`;
  document.getElementById('hdrProgressBar').style.width = `${pct}%`;

  document.getElementById('countAll').textContent = total;
  const elWithPdf = document.getElementById('countWithPdf');
  if (elWithPdf) elWithPdf.textContent = withLegacyPdf;
  document.getElementById('countPending').textContent = statusCounts.pending || 0;
  document.getElementById('countInProgress').textContent = statusCounts.in_progress || 0;
  document.getElementById('countCompleted').textContent = statusCounts.completed || 0;
  document.getElementById('countIssue').textContent = statusCounts.issue || 0;

  const adminBadge = document.getElementById('adminQueueBadge');
  if (adminBadge) {
    const waitCnt = adminCounts.pending_review || 0;
    adminBadge.textContent = waitCnt;
    adminBadge.className = waitCnt > 0
      ? 'px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold'
      : 'px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-700 text-[10px] font-bold';
  }
}

function switchTab(tab) {
  const views = {
    circuits: document.getElementById('viewCircuits'),
    linebot: document.getElementById('viewLinebot'),
    admin: document.getElementById('viewAdmin'),
    dashboard: document.getElementById('viewDashboard')
  };
  const btns = {
    circuits: document.getElementById('tabBtnCircuits'),
    linebot: document.getElementById('tabBtnLinebot'),
    admin: document.getElementById('tabBtnAdmin'),
    dashboard: document.getElementById('tabBtnDashboard')
  };

  Object.keys(views).forEach(k => {
    if (views[k]) {
      if (k === tab) views[k].classList.remove('hidden');
      else views[k].classList.add('hidden');
    }
    if (btns[k]) {
      const baseCls = 'px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 whitespace-nowrap';
      btns[k].className = k === tab
        ? `${baseCls} bg-slate-900 text-white`
        : `${baseCls} text-slate-600 hover:bg-slate-200/70`;
    }
  });

  if (tab === 'linebot') {
    loadLineBotTab();
  } else if (tab === 'admin') {
    loadAdminOverview();
  }
}

// ============================================================================
// Recent Circuits History (LocalStorage Quick Access for Field Techs)
// ============================================================================
function getRecentCircuitIds() {
  try {
    const raw = localStorage.getItem('dlt_recent_circuits');
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

function addRecentCircuit(soNumber) {
  if (!soNumber) return;
  try {
    const list = getRecentCircuitIds().filter(id => id !== soNumber);
    list.unshift(soNumber);
    localStorage.setItem('dlt_recent_circuits', JSON.stringify(list.slice(0, 8)));
    renderRecentCircuits();
  } catch (_) {}
}

function clearRecentCircuits() {
  localStorage.removeItem('dlt_recent_circuits');
  renderRecentCircuits();
}

function renderRecentCircuits() {
  const box = document.getElementById('recentCircuitsBox');
  const listEl = document.getElementById('recentCircuitsList');
  if (!box || !listEl) return;

  const ids = getRecentCircuitIds();
  const items = ids.map(so => allCircuits.find(c => c.so_number === so)).filter(Boolean);
  if (items.length === 0) {
    box.classList.add('hidden');
    return;
  }

  box.classList.remove('hidden');
  listEl.innerHTML = items.map(c => {
    const shortBranch = extractShortSubBranchLabel(c);
    const dotCls = c.status === 'completed' ? 'bg-emerald-500' : c.status === 'in_progress' ? 'bg-amber-500' : 'bg-slate-400';
    return `
      <button type="button" onclick="openInspectionModal('${c.so_number}')" class="px-2.5 py-1 rounded-md bg-slate-50 hover:bg-slate-100 border border-slate-200 text-xs flex items-center gap-1.5 shrink-0 transition">
        <span class="w-1.5 h-1.5 rounded-full ${dotCls}"></span>
        <span class="font-semibold text-slate-900">${c.so_number}</span>
        <span class="text-slate-500 truncate max-w-[140px]">${c.province} • ${shortBranch}</span>
      </button>
    `;
  }).join('');
}

// ============================================================================
// Helper: Extract Physical Site Name & Group Circuits by Site / Same Rack
// ============================================================================
let currentSiteCircuits = []; // All circuits belonging to the currently open Site/Rack

function extractSiteNameClient(c) {
  if (!c) return '';
  if (c.site_name && String(c.site_name).trim()) return String(c.site_name).trim();
  const branch = String(c.branch_name || '').trim();
  if (c.province === 'กรุงเทพมหานคร' && c.short_branch_name === 'สขพ.5 จตุจักร' && !branch.includes('สขพ.5')) {
    return String(c.customer_site_name || branch).trim();
  }
  if (c.short_branch_name && String(c.short_branch_name).trim()) {
    return String(c.short_branch_name).trim();
  }
  const raw = String(c.customer_site_name || branch || '').trim();
  if (!raw) return `สขจ.${c.province || ''}`;
  const cleaned = raw
    .replace(/\s*วงจรที่\s*\d+.*$/i, '')
    .replace(/\s*\(.*$/, '')
    .trim();
  return cleaned || raw;
}

function getSiteKeyClient(c) {
  if (!c) return '';
  if (c.site_key) return c.site_key;
  return `${(c.province || '').trim()}::${extractSiteNameClient(c)}`;
}

function getCircuitsForSite(targetCircuit) {
  if (!targetCircuit) return [];
  const key = getSiteKeyClient(targetCircuit);
  const matched = allCircuits.filter(item => getSiteKeyClient(item) === key);
  if (matched.length === 0) return [targetCircuit];
  return matched.sort((a, b) => String(a.so_number || '').localeCompare(String(b.so_number || '')));
}

function extractSubBranchGroup(c) {
  return extractSiteNameClient(c);
}

function extractShortSubBranchLabel(c) {
  const grp = extractSiteNameClient(c);
  const rm = c.router_summary?.room ? `ห้อง${c.router_summary.room}` : '';
  const fl = c.router_summary?.floor ? `ชั้น ${c.router_summary.floor}` : '';
  const extra = [fl, rm].filter(Boolean).join(' ');
  return extra ? `${grp} (${extra})` : grp;
}

// ============================================================================
// Filters, Province Quick Grid & Circuits List Rendering
// ============================================================================
function populateProvinceDropdown() {
  const region = document.getElementById('filterRegion').value;
  const provSelect = document.getElementById('filterProvince');
  const currentVal = provSelect.value;

  const provMap = {};
  for (const c of allCircuits) {
    if (region && c.region !== region) continue;
    provMap[c.province] = (provMap[c.province] || 0) + 1;
  }
  const sortedProvs = Object.keys(provMap).sort((a, b) => a.localeCompare(b, 'th'));

  provSelect.innerHTML = `<option value="">เลือกจังหวัด (${sortedProvs.length} จังหวัด)</option>` +
    sortedProvs.map(p => `<option value="${p}">${p} (${provMap[p]} วงจร)</option>`).join('');

  if (sortedProvs.includes(currentVal)) {
    provSelect.value = currentVal;
  }
}

function updateRegionPillsUi(selectedRegion) {
  const pills = document.querySelectorAll('#regionPillsBar .reg-pill');
  pills.forEach(btn => {
    const r = btn.getAttribute('data-region') ?? btn.getAttribute('data-reg') ?? '';
    if (r === (selectedRegion || '')) {
      btn.className = 'reg-pill active px-2.5 py-1 rounded-md text-xs font-semibold shrink-0 bg-slate-900 text-white transition';
    } else {
      btn.className = 'reg-pill px-2.5 py-1 rounded-md text-xs font-medium shrink-0 bg-slate-100 hover:bg-slate-200 text-slate-700 transition';
    }
  });
}

function selectRegionQuick(region) {
  document.getElementById('filterRegion').value = region;
  selectedSubBranch = '';
  gpsSortCenter = null;
  updateRegionPillsUi(region);
  populateProvinceDropdown();
  document.getElementById('filterProvince').value = '';
  applyCircuitFilters();
}

function onRegionChange() {
  const region = document.getElementById('filterRegion').value;
  selectedSubBranch = '';
  gpsSortCenter = null;
  updateRegionPillsUi(region);
  populateProvinceDropdown();
  applyCircuitFilters();
}

function onProvinceDropdownChange() {
  const province = document.getElementById('filterProvince').value;
  if (province) {
    const found = allCircuits.find(c => c.province === province);
    if (found && document.getElementById('filterRegion').value && document.getElementById('filterRegion').value !== found.region) {
      document.getElementById('filterRegion').value = '';
      updateRegionPillsUi('');
    }
  }
  selectedSubBranch = '';
  gpsSortCenter = null;
  applyCircuitFilters();
}

function selectProvinceFromGrid(province) {
  const provSelect = document.getElementById('filterProvince');
  const found = allCircuits.find(c => c.province === province);
  if (found && document.getElementById('filterRegion').value && document.getElementById('filterRegion').value !== found.region) {
    document.getElementById('filterRegion').value = '';
    updateRegionPillsUi('');
    populateProvinceDropdown();
  }
  provSelect.value = province;
  selectedSubBranch = '';
  gpsSortCenter = null;
  applyCircuitFilters();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function backToProvinceGrid() {
  document.getElementById('filterProvince').value = '';
  document.getElementById('filterSearch').value = '';
  document.getElementById('btnClearSearch')?.classList.add('hidden');
  selectedSubBranch = '';
  gpsSortCenter = null;
  setBrowseMode('province');
}

function toggleBrowseMode() {
  if (browseMode === 'province') {
    setBrowseMode('all');
  } else {
    backToProvinceGrid();
  }
}

function setBrowseMode(mode) {
  browseMode = mode;
  const btn = document.getElementById('btnToggleViewMode');
  if (btn) {
    btn.textContent = browseMode === 'province' ? 'ดูทั้งหมด' : 'แยกตามจังหวัด';
  }
  applyCircuitFilters();
}

function onSearchInputChanged() {
  const q = document.getElementById('filterSearch').value;
  const clearBtn = document.getElementById('btnClearSearch');
  if (clearBtn) {
    clearBtn.classList.toggle('hidden', !q.trim());
  }
  gpsSortCenter = null;
  applyCircuitFilters();
}

function clearSearchInput() {
  const input = document.getElementById('filterSearch');
  if (input) input.value = '';
  document.getElementById('btnClearSearch')?.classList.add('hidden');
  applyCircuitFilters();
}

function setQuickStatus(status) {
  document.getElementById('filterStatus').value = status;
  if (status) {
    browseMode = 'all';
  }
  const cardIds = {
    '': 'statCardAll',
    'pending': 'statCardPending',
    'in_progress': 'statCardInProgress',
    'completed': 'statCardCompleted',
    'issue': 'statCardIssue'
  };
  Object.entries(cardIds).forEach(([k, id]) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (k === status) {
      el.classList.add('border-slate-900');
      el.classList.remove('border-slate-200');
    } else {
      el.classList.remove('border-slate-900');
      el.classList.add('border-slate-200');
    }
  });
  applyCircuitFilters();
}

function resetFilters() {
  document.getElementById('filterSearch').value = '';
  document.getElementById('btnClearSearch')?.classList.add('hidden');
  document.getElementById('filterRegion').value = '';
  updateRegionPillsUi('');
  populateProvinceDropdown();
  document.getElementById('filterProvince').value = '';
  selectedSubBranch = '';
  gpsSortCenter = null;
  browseMode = 'province';
  const btn = document.getElementById('btnToggleViewMode');
  if (btn) btn.textContent = 'ดูทั้งหมด';
  setQuickStatus('');
}

function parseLatLng(str) {
  if (!str) return null;
  const m = String(str).match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);
  if (isNaN(lat) || isNaN(lng)) return null;
  return { lat, lng };
}

function calcDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findNearestCircuitsByGps() {
  if (!navigator.geolocation) {
    showToast('เบราว์เซอร์นี้ไม่รองรับ GPS กรุณาพิมพ์ชื่อจังหวัดหรือสาขาในช่องค้นหา', true);
    return;
  }
  showToast('กำลังค้นหาสาขาขนส่งที่ใกล้พิกัดปัจจุบันของคุณ...');
  navigator.geolocation.getCurrentPosition(
    pos => {
      gpsSortCenter = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      document.getElementById('filterRegion').value = '';
      updateRegionPillsUi('');
      populateProvinceDropdown();
      document.getElementById('filterProvince').value = '';
      selectedSubBranch = '';
      browseMode = 'all';
      applyCircuitFilters();
      showToast('เรียงลำดับวงจรจากสาขาที่อยู่ใกล้คุณที่สุดแล้ว');
    },
    err => {
      showToast('ไม่สามารถดึงพิกัด GPS ได้ (' + err.message + ') กรุณาเลือกภาค/จังหวัดแทน', true);
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function selectSubBranchChip(groupName) {
  selectedSubBranch = groupName;
  applyCircuitFilters();
}

function renderSubBranchChips(provinceCircuits) {
  const box = document.getElementById('subBranchChipsBox');
  const bar = document.getElementById('subBranchChipsBar');
  if (!box || !bar) return;

  if (!provinceCircuits || provinceCircuits.length <= 1) {
    box.classList.add('hidden');
    return;
  }

  const groupCounts = {};
  for (const c of provinceCircuits) {
    const g = extractSubBranchGroup(c);
    groupCounts[g] = (groupCounts[g] || 0) + 1;
  }
  const groups = Object.keys(groupCounts);
  if (groups.length <= 1 && provinceCircuits.length <= 2) {
    box.classList.add('hidden');
    return;
  }

  box.classList.remove('hidden');
  const allActive = !selectedSubBranch;
  let html = `
    <button type="button" onclick="selectSubBranchChip('')" class="px-2.5 py-1 rounded-md text-xs font-semibold transition ${
      allActive ? 'bg-slate-900 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
    }">
      ทั้งหมด (${provinceCircuits.length})
    </button>
  `;
  html += groups.map(g => {
    const active = selectedSubBranch === g;
    return `
      <button type="button" onclick="selectSubBranchChip('${g.replace(/'/g, "\\'")}')" class="px-2.5 py-1 rounded-md text-xs font-medium transition ${
        active ? 'bg-slate-900 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
      }">
        ${g} (${groupCounts[g]})
      </button>
    `;
  }).join('');
  bar.innerHTML = html;
}

function renderProvinceQuickGrid(regionFilter) {
  const container = document.getElementById('provinceQuickCardsContainer');
  const subtitle = document.getElementById('provinceGridSubtitle');
  if (!container) return;

  const byProv = {};
  for (const c of allCircuits) {
    if (regionFilter && c.region !== regionFilter) continue;
    if (!byProv[c.province]) {
      byProv[c.province] = {
        province: c.province,
        region: c.region,
        total: 0,
        completed: 0,
        in_progress: 0,
        subBranches: new Set()
      };
    }
    byProv[c.province].total++;
    if (c.status === 'completed') byProv[c.province].completed++;
    if (c.status === 'in_progress') byProv[c.province].in_progress++;
    byProv[c.province].subBranches.add(extractSubBranchGroup(c));
  }

  const provList = Object.values(byProv).sort((a, b) => {
    if (a.province === 'กรุงเทพมหานคร') return -1;
    if (b.province === 'กรุงเทพมหานคร') return 1;
    return a.province.localeCompare(b.province, 'th');
  });

  if (subtitle) {
    subtitle.textContent = regionFilter
      ? `${regionFilter} (${provList.length} จังหวัด)`
      : `ทั้งหมด ${provList.length} จังหวัด`;
  }

  container.innerHTML = provList.map(p => {
    const subArr = Array.from(p.subBranches);
    const subPreview = subArr.slice(0, 2).join(', ') + (subArr.length > 2 ? ` +${subArr.length - 2}` : '');

    return `
      <button type="button" onclick="selectProvinceFromGrid('${p.province}')" class="text-left bg-white hover:bg-slate-50 p-3 rounded-xl border border-slate-200 hover:border-slate-400 transition flex flex-col justify-between gap-2">
        <div>
          <div class="flex items-start justify-between gap-1">
            <span class="font-bold text-slate-900 text-sm leading-tight">${p.province}</span>
            <span class="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px] font-semibold shrink-0">
              ${p.total} วงจร
            </span>
          </div>
          <p class="text-[11px] text-slate-500 mt-1 line-clamp-1">${subPreview}</p>
        </div>

        <div class="pt-1.5 border-t border-slate-100 flex items-center justify-between text-[11px]">
          <span class="${p.completed > 0 ? 'text-emerald-700 font-semibold' : 'text-slate-400'}">
            ส่งมอบ ${p.completed}/${p.total}
          </span>
          <span class="text-slate-600 font-medium">เลือก →</span>
        </div>
      </button>
    `;
  }).join('');
}

function applyCircuitFilters() {
  const q = document.getElementById('filterSearch').value.trim().toLowerCase();
  const region = document.getElementById('filterRegion').value;
  const province = document.getElementById('filterProvince').value;
  const status = document.getElementById('filterStatus').value;

  const provGridBox = document.getElementById('provinceQuickGridBox');
  const listWrapper = document.getElementById('circuitsListWrapper');
  const selProvBanner = document.getElementById('selectedProvinceBanner');
  const subBranchBox = document.getElementById('subBranchChipsBox');

  const shouldShowProvinceGrid =
    browseMode === 'province' && !province && !q && !status && !gpsSortCenter;

  if (shouldShowProvinceGrid) {
    provGridBox?.classList.remove('hidden');
    listWrapper?.classList.add('hidden');
    renderProvinceQuickGrid(region);
    return;
  }

  provGridBox?.classList.add('hidden');
  listWrapper?.classList.remove('hidden');

  if (province) {
    selProvBanner?.classList.remove('hidden');
    const provTitle = document.getElementById('selectedProvinceTitle');
    if (provTitle) provTitle.textContent = `จังหวัด${province}`;
    const provCircuits = allCircuits.filter(c => c.province === province);
    const doneCnt = provCircuits.filter(c => c.status === 'completed').length;
    const provMeta = document.getElementById('selectedProvinceMeta');
    if (provMeta) {
      provMeta.textContent = `(${provCircuits.length} วงจร • ส่งมอบแล้ว ${doneCnt}/${provCircuits.length})`;
    }
    renderSubBranchChips(provCircuits);
  } else {
    selProvBanner?.classList.add('hidden');
    subBranchBox?.classList.add('hidden');
  }

  let filtered = allCircuits.filter(c => {
    if (region && !province && c.region !== region) return false;
    if (province && c.province !== province) return false;
    if (status && c.status !== status) return false;
    if (province && selectedSubBranch) {
      if (extractSubBranchGroup(c) !== selectedSubBranch) return false;
    }
    if (q) {
      const rSn = c.router_summary?.serial_no || '';
      const rRoom = `${c.router_summary?.room || ''} อาคาร ${c.router_summary?.building || ''} ชั้น ${c.router_summary?.floor || ''}`;
      const apSns = (c.ap_summary || []).map(a => `${a.serial_no || ''} ${a.room || ''}`).join(' ');
      const hay = `${c.so_number} ${c.service_no} ${c.region} ${c.province} ${c.branch_name} ${c.address} ${rSn} ${rRoom} ${apSns}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (gpsSortCenter) {
    filtered = filtered.map(c => {
      const pt = parseLatLng(c.lat_long);
      const distKm = pt ? calcDistanceKm(gpsSortCenter.lat, gpsSortCenter.lng, pt.lat, pt.lng) : 9999;
      return { ...c, _distKm: distKm };
    }).sort((a, b) => a._distKm - b._distKm);
  }

  document.getElementById('showingCount').textContent = filtered.length;
  const tags = [];
  if (gpsSortCenter) tags.push('เรียงตามระยะทาง');
  if (region) tags.push(region);
  if (province) tags.push(`จ.${province}`);
  if (selectedSubBranch) tags.push(selectedSubBranch);
  if (status) tags.push(STATUS_BADGE[status]?.label || status);
  if (q) tags.push(`ค้นหา "${q}"`);
  document.getElementById('activeFilterSummary').textContent = tags.length ? `(${tags.join(' • ')})` : '';

  renderCircuitsGrid(filtered);
}

function renderCircuitsGrid(list) {
  const container = document.getElementById('circuitsContainer');
  if (list.length === 0) {
    container.innerHTML = `
      <div class="col-span-full bg-white p-8 rounded-xl border border-slate-200 text-center space-y-2">
        <p class="text-slate-600 text-sm font-medium">ไม่พบข้อมูลวงจรที่ค้นหา</p>
        <button onclick="resetFilters()" class="px-3.5 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold">
          ล้างตัวกรอง
        </button>
      </div>
    `;
    return;
  }

  const siteGroupsMap = new Map();
  for (const c of list) {
    const sKey = getSiteKeyClient(c);
    if (!siteGroupsMap.has(sKey)) {
      siteGroupsMap.set(sKey, []);
    }
    siteGroupsMap.get(sKey).push(c);
  }

  const siteGroups = Array.from(siteGroupsMap.values()).map(group => {
    const sKey = getSiteKeyClient(group[0]);
    const fullSiteCircuits = allCircuits
      .filter(item => getSiteKeyClient(item) === sKey)
      .sort((a, b) => String(a.so_number || '').localeCompare(String(b.so_number || '')));
    return fullSiteCircuits.length > 0 ? fullSiteCircuits : group;
  });

  container.innerHTML = siteGroups.map(siteCircuits => {
    const primary = siteCircuits[0];
    const siteName = extractSiteNameClient(primary);
    const totalInSite = siteCircuits.length;
    const completedInSite = siteCircuits.filter(x => x.status === 'completed').length;
    const inProgInSite = siteCircuits.filter(x => x.status === 'in_progress').length;
    const siteStatus = completedInSite === totalInSite
      ? 'completed'
      : (inProgInSite > 0 || completedInSite > 0)
        ? 'in_progress'
        : (siteCircuits.some(x => x.status === 'issue') ? 'issue' : 'pending');
    const badge = STATUS_BADGE[siteStatus] || STATUS_BADGE.pending;
    const hasDraft = hasSiteSavedDraft(siteCircuits);
    const siteHandoverCount = Math.max(...siteCircuits.map(x => Number(x.handover_scan_count || 0)), 0);

    const multi = totalInSite > 1;
    const circuitsRowsHtml = siteCircuits.map((c, idx) => {
      const rModel = c.router_summary?.model || 'RB3011';
      const rSn = c.router_summary?.serial_no || '-';
      const apList = c.ap_summary || [];
      const apRooms = apList.length > 0
        ? apList.map(a => a.room || `AP ${a.ap_no}`).join(', ')
        : 'ไม่มี AP';
      const photosOk = c.onsite_photo_count ?? c.photo_count ?? 0;
      const photosReq = c.onsite_required_count ?? c.expected_photo_count ?? 9;
      const col = circuitColorOf(idx);

      return `
        <div class="p-2.5 rounded-lg text-xs space-y-1 ${multi ? '' : 'bg-slate-50 border border-slate-200'}" style="${multi ? `border:2px solid ${col.line};background:${col.soft};` : ''}">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-1.5">
              ${multi ? `<span class="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0" style="background:${col.solid}">${idx + 1}</span>` : ''}
              <span class="font-bold font-mono" style="${multi ? `color:${col.ink}` : 'color:rgb(var(--tx-slate-900))'}">${c.so_number}</span>
              ${multi ? `<span class="text-[11px] font-semibold" style="color:${col.ink}">(วงจรที่ ${idx + 1})</span>` : ''}
            </div>
            <span class="text-[11px] ${multi ? 'font-semibold px-1.5 py-0.5 rounded bg-white' : 'text-slate-500'}" style="${multi ? `color:${col.ink};border:1px solid ${col.line}` : ''}">รูป ${photosOk}/${photosReq}</span>
          </div>
          <div class="text-[11px] text-slate-700 flex items-center justify-between gap-2">
            <span class="truncate">Router: <strong>${rModel}</strong> (${rSn})</span>
            <span class="truncate text-slate-600">AP: ${apRooms}</span>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="bg-white rounded-xl border border-slate-200 hover:border-slate-400 transition flex flex-col justify-between">
        <div class="p-4 space-y-3">
          <!-- Site Header -->
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="flex items-center gap-1.5 flex-wrap mb-1">
                <span class="text-[11px] font-semibold bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                  จ.${primary.province}
                </span>
                ${totalInSite > 1 ? `<span class="text-[11px] font-semibold bg-slate-100 text-slate-700 px-2 py-0.5 rounded">${totalInSite} วงจร</span>` : ''}
                ${hasDraft && siteStatus !== 'completed' ? `<span class="text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 rounded">มีร่างบันทึกไว้</span>` : ''}
              </div>
              <h3 class="font-bold text-slate-900 text-sm sm:text-base leading-snug">
                ${siteName}
              </h3>
              <p class="text-xs text-slate-500 mt-0.5">
                ใบส่งมอบงาน: ${siteHandoverCount}/2 หน้า
                ${primary.inspector_name ? ` • ช่าง: ${primary.inspector_name}` : ''}
              </p>
            </div>
            <span class="text-[11px] font-semibold px-2 py-0.5 rounded border shrink-0 ${badge.cls}">
              ${badge.label}
            </span>
          </div>

          <!-- Circuits List -->
          <div class="space-y-1.5">
            ${circuitsRowsHtml}
          </div>
        </div>

        <!-- Clean Actions Footer -->
        <div class="px-4 py-2.5 bg-slate-50 border-t border-slate-100 rounded-b-xl flex items-center justify-between gap-2">
          <div class="flex items-center gap-1.5">
            <a href="/report.html?id=${encodeURIComponent(primary.so_number)}" target="_blank" class="px-2.5 py-1.5 rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 text-xs font-medium">
              รายงาน PDF
            </a>
            <a href="/api/circuits/${encodeURIComponent(primary.so_number)}/report.docx" class="px-2.5 py-1.5 rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 text-xs font-medium">
              Word
            </a>
          </div>

          <button onclick="openInspectionModal('${primary.so_number}')" class="px-3.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition">
            ${hasDraft && siteStatus !== 'completed' ? 'ทำต่อจากร่าง →' : 'เข้าบันทึกงาน →'}
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// ============================================================================
// Dashboard & 77 Provinces Summary
// ============================================================================
function renderDashboard() {
  if (!globalStats) return;

  const regionOrder = ['ภาคกลาง', 'ภาคตะวันออกเฉียงเหนือ', 'ภาคใต้', 'ภาคเหนือ', 'ภาคตะวันออก', 'ภาคตะวันตก'];
  const regList = document.getElementById('regionProgressList');
  regList.innerHTML = regionOrder.map(reg => {
    const d = globalStats.byRegion[reg] || { total: 0, completed: 0, in_progress: 0, pending: 0, issue: 0 };
    const pct = d.total > 0 ? Math.round((d.completed / d.total) * 100) : 0;
    return `
      <div onclick="filterByRegionFromDash('${reg}')" class="p-3 rounded-xl border border-slate-200 hover:border-indigo-400 cursor-pointer transition bg-slate-50/50">
        <div class="flex items-center justify-between text-xs sm:text-sm mb-1.5">
          <span class="font-bold text-slate-800">${reg} <span class="text-slate-500 font-normal">(${d.total} วงจร)</span></span>
          <span class="text-xs font-semibold text-emerald-700">ส่งมอบแล้ว ${d.completed}/${d.total} (${pct}%)</span>
        </div>
        <div class="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden flex">
          <div class="bg-emerald-500 h-full" style="width: ${pct}%"></div>
        </div>
        <div class="flex items-center gap-4 mt-1.5 text-[11px] text-slate-500">
          <span>✅ ส่งมอบแล้ว: <strong>${d.completed}</strong></span>
          <span>🔧 กำลังทำ: <strong>${d.in_progress}</strong></span>
          <span>⏳ รอดำเนินการ: <strong>${d.pending}</strong></span>
          <span>⚠️ ติดปัญหา: <strong>${d.issue}</strong></span>
        </div>
      </div>
    `;
  }).join('');

  const rmEl = document.getElementById('routerModelStats');
  rmEl.innerHTML = Object.entries(globalStats.routerModels || {}).map(([m, cnt]) => `
    <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
      <span class="font-semibold text-slate-700 text-xs">${m}</span>
      <span class="text-base font-bold text-indigo-700">${cnt} <small class="text-[11px] font-normal text-slate-500">ตัว</small></span>
    </div>
  `).join('');

  document.getElementById('totalApBadge').textContent = `รวม ${globalStats.totalApCount || 0} ตัว`;
  const apEl = document.getElementById('apBrandStats');
  apEl.innerHTML = Object.entries(globalStats.apBrands || {}).map(([b, cnt]) => `
    <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
      <span class="font-semibold text-slate-700 text-xs">${b}</span>
      <span class="text-base font-bold text-emerald-700">${cnt} <small class="text-[11px] font-normal text-slate-500">ตัว</small></span>
    </div>
  `).join('');

  renderProvinceTable();
}

function renderProvinceTable() {
  if (!globalStats) return;
  const q = (document.getElementById('provSearchInput')?.value || '').trim().toLowerCase();
  const tbody = document.getElementById('provinceTableBody');
  const list = (globalStats.provinces || []).filter(p => !q || p.province.toLowerCase().includes(q) || p.region.toLowerCase().includes(q));

  tbody.innerHTML = list.map(p => {
    const pct = p.total > 0 ? Math.round((p.completed / p.total) * 100) : 0;
    return `
      <tr class="hover:bg-indigo-50/40 transition">
        <td class="py-2.5 px-3 font-bold text-slate-800">${p.province}</td>
        <td class="py-2.5 px-3 text-slate-600">${p.region}</td>
        <td class="py-2.5 px-3 text-center font-semibold">${p.total}</td>
        <td class="py-2.5 px-3 text-center font-bold text-emerald-600">${p.completed}</td>
        <td class="py-2.5 px-3 text-center font-semibold text-amber-600">${p.in_progress}</td>
        <td class="py-2.5 px-3 text-center text-slate-500">${p.pending}</td>
        <td class="py-2.5 px-3 w-40">
          <div class="flex items-center gap-2">
            <div class="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
              <div class="bg-emerald-500 h-full" style="width:${pct}%"></div>
            </div>
            <span class="text-xs font-semibold text-slate-600 w-9 text-right">${pct}%</span>
          </div>
        </td>
        <td class="py-2.5 px-3 text-right">
          <button onclick="filterByProvinceFromDash('${p.region}', '${p.province}')" class="px-2.5 py-1 rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold text-xs">
            ดูวงจร (${p.total}) →
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function filterByRegionFromDash(region) {
  switchTab('circuits');
  selectRegionQuick(region);
}

function filterByProvinceFromDash(region, province) {
  switchTab('circuits');
  document.getElementById('filterRegion').value = region;
  updateRegionPillsUi(region);
  populateProvinceDropdown();
  document.getElementById('filterProvince').value = province;
  selectedSubBranch = '';
  applyCircuitFilters();
}

// ============================================================================
// Inspection Workspace Modal (Steps 1 - 4 & Mobile Wizard Stepper)
// ============================================================================
const MODAL_STEPS_ORDER = ['info', 'step1', 'step23', 'step4', 'all'];

function setModalStep(step) {
  currentModalStep = step || 'info';
  const sections = {
    info: document.getElementById('modalSectionInfo'),
    step1: document.getElementById('modalSectionStep1'),
    step23: document.getElementById('modalSectionStep23'),
    step4: document.getElementById('modalSectionStep4')
  };

  Object.entries(sections).forEach(([key, el]) => {
    if (!el) return;
    if (currentModalStep === 'all' || currentModalStep === key) {
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  });

  document.querySelectorAll('.modal-step-btn').forEach(btn => {
    const s = btn.getAttribute('data-step');
    if (s === currentModalStep) {
      btn.className = 'modal-step-btn px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap bg-slate-900 text-white transition';
    } else {
      btn.className = 'modal-step-btn px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap bg-white text-slate-700 border border-slate-300 hover:bg-slate-100 transition';
    }
  });

  const nextBtn = document.getElementById('btnNextStep');
  if (nextBtn) {
    if (currentModalStep === 'info') nextBtn.textContent = 'ถัดไป: 2. ตู้ Rack →';
    else if (currentModalStep === 'step1') nextBtn.textContent = 'ถัดไป: 3. ห้อง AP →';
    else if (currentModalStep === 'step23') nextBtn.textContent = 'ถัดไป: 4. ใบส่งมอบ →';
    else if (currentModalStep === 'step4') nextBtn.textContent = 'ดูรวมทุกข้อ →';
    else nextBtn.textContent = 'ไปข้อ 1 (Check-in) →';
  }

  const formPane = document.getElementById('modalFormPane');
  if (formPane) formPane.scrollTo({ top: 0, behavior: 'smooth' });
}

function goModalStepDelta(delta) {
  const mainOrder = ['info', 'step1', 'step23', 'step4', 'all'];
  let idx = mainOrder.indexOf(currentModalStep);
  if (idx === -1) idx = 0;
  const nextIdx = Math.max(0, Math.min(mainOrder.length - 1, idx + delta));
  setModalStep(mainOrder[nextIdx]);
}

async function openInspectionModal(soNumber) {
  try {
    const res = await fetch(`/api/circuits/${encodeURIComponent(soNumber)}`);
    if (!res.ok) throw new Error('ไม่พบข้อมูลวงจร');
    const data = await res.json();
    const fetchedCircuit = data.circuit || data;
    addRecentCircuit(soNumber);

    // Determine all circuits belonging to this physical Site / Rack cabinet
    const siteSummaries = Array.isArray(data.site_circuits) && data.site_circuits.length > 0
      ? data.site_circuits
      : getCircuitsForSite(fetchedCircuit);

    const fullSiteList = await Promise.all(
      siteSummaries.map(async item => {
        if (item.so_number === fetchedCircuit.so_number) return fetchedCircuit;
        const r = await fetch(`/api/circuits/${encodeURIComponent(item.so_number)}`);
        if (!r.ok) return item;
        const d = await r.json();
        return d.circuit || d;
      })
    );

    fullSiteList.sort((a, b) => String(a.so_number || '').localeCompare(String(b.so_number || '')));
    fullSiteList.forEach(sc => {
      if (!sc.router_info) sc.router_info = {};
      if (!Array.isArray(sc.access_points) || sc.access_points.length === 0) {
        sc.access_points = [
          createDefaultAp(1, sc.province, 'ห้อง GPS'),
          createDefaultAp(2, sc.province, 'ห้อง GECC')
        ];
      }
    });

    // Check if there is a newer local draft in localStorage (e.g. mobile browser tab reloaded while walking between rooms)
    const restoredInfo = restoreSiteDraftFromLocalIfNewer(fullSiteList);

    currentSiteCircuits = fullSiteList;
    currentCircuit = currentSiteCircuits[0];

    populateInspectionModal();
    ensureModalAutoSaveListenerBound();
    renderSiteRoomsQuickJumpBar();

    if (restoredInfo.restored) {
      updateDraftStatusUi('restored', restoredInfo.savedAtText);
      showToast(`กู้คืนข้อมูลร่างล่าสุด (${restoredInfo.savedAtText}) เรียบร้อย`);
    } else if (hasSiteSavedDraft(currentSiteCircuits)) {
      const latestDraftIso = currentSiteCircuits.map(c => c.draft_saved_at || c.updated_at || '').filter(Boolean).sort().pop();
      const timeStr = latestDraftIso ? new Date(latestDraftIso).toLocaleTimeString('th-TH') : 'ล่าสุด';
      updateDraftStatusUi('saved', `ร่างล่าสุด ${timeStr}`);
    } else {
      updateDraftStatusUi('ready', 'บันทึกอัตโนมัติ');
    }

    // Start at Step 1: 1. ข้อมูลสาขา & Check-in
    setModalStep('info');
    document.getElementById('inspectionModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  } catch (err) {
    showToast(err.message, true);
  }
}

function closeInspectionModal() {
  if (currentCircuit) {
    try {
      saveSiteDraftToLocal('ปิดหน้าต่างชั่วคราว');
    } catch (_) {}
  }
  document.getElementById('inspectionModal').classList.add('hidden');
  document.getElementById('legacyPdfIframe').src = 'about:blank';
  splitPdfVisible = false;
  document.getElementById('modalPdfPane').classList.add('hidden');
  document.body.style.overflow = '';
}

// ============================================================================
// Auto-Save Draft (2-Layer: LocalStorage + Server R2) & Room-by-Room Navigation
// ============================================================================
let autoSaveLocalTimer = null;
let autoSaveServerTimer = null;
let modalAutoSaveBound = false;
let isSavingDraftInFlight = false;

function getSiteDraftStorageKey(circuitOrSiteKey) {
  if (!circuitOrSiteKey) return '';
  const key = typeof circuitOrSiteKey === 'string'
    ? circuitOrSiteKey
    : getSiteKeyClient(circuitOrSiteKey);
  return key ? `dlt_site_draft_v1_${key}` : '';
}

function hasSiteSavedDraft(siteCircuits) {
  const list = Array.isArray(siteCircuits) ? siteCircuits : (siteCircuits ? [siteCircuits] : []);
  if (list.length === 0) return false;
  if (list.some(c => Boolean(c.is_draft) || (c.status === 'in_progress' && !c.checkout_time))) {
    return true;
  }
  try {
    const storageKey = getSiteDraftStorageKey(list[0]);
    if (storageKey) {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.circuits) && parsed.circuits.length > 0) {
          return true;
        }
      }
    }
  } catch (_) {}
  return false;
}

function saveSiteDraftToLocal(reason = 'แก้ไขข้อมูล') {
  if (!currentCircuit) return null;
  try {
    syncApInputsFromDom();
    syncAdditionalSiteCircuitsFromDom();
    const primaryPayload = collectFormPayload();

    const snapshotCircuits = (Array.isArray(currentSiteCircuits) && currentSiteCircuits.length > 0 ? currentSiteCircuits : [currentCircuit]).map((sc, idx) => {
      if (idx === 0) {
        return {
          ...sc,
          ...primaryPayload,
          is_draft: true,
          draft_saved_at: new Date().toISOString()
        };
      }
      return {
        ...sc,
        branch_name: primaryPayload.branch_name || sc.branch_name,
        lat_long: primaryPayload.lat_long || sc.lat_long,
        address: primaryPayload.address || sc.address,
        inspector_name: primaryPayload.inspector_name || sc.inspector_name,
        inspector_phone: primaryPayload.inspector_phone || sc.inspector_phone,
        inspection_date: primaryPayload.inspection_date || sc.inspection_date,
        is_draft: true,
        draft_saved_at: new Date().toISOString()
      };
    });

    const storageKey = getSiteDraftStorageKey(currentCircuit);
    if (!storageKey) return null;
    const savedAt = new Date().toISOString();
    const record = {
      site_key: getSiteKeyClient(currentCircuit),
      saved_at: savedAt,
      reason,
      circuits: snapshotCircuits
    };
    localStorage.setItem(storageKey, JSON.stringify(record));
    return record;
  } catch (_) {
    return null;
  }
}

function restoreSiteDraftFromLocalIfNewer(siteList) {
  if (!Array.isArray(siteList) || siteList.length === 0) return { restored: false };
  try {
    const storageKey = getSiteDraftStorageKey(siteList[0]);
    if (!storageKey) return { restored: false };
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { restored: false };
    const localDraft = JSON.parse(raw);
    if (!localDraft || !Array.isArray(localDraft.circuits) || !localDraft.saved_at) return { restored: false };

    const localTs = Date.parse(localDraft.saved_at) || 0;
    const serverTs = Math.max(
      ...siteList.map(sc => Math.max(Date.parse(sc.draft_saved_at || '') || 0, Date.parse(sc.updated_at || '') || 0))
    );

    if (localTs > serverTs + 2000) {
      for (let i = 0; i < siteList.length; i++) {
        const sc = siteList[i];
        const match = localDraft.circuits.find(lc => lc.so_number === sc.so_number);
        if (!match) continue;
        siteList[i] = {
          ...sc,
          ...match,
          router_info: {
            ...(sc.router_info || {}),
            ...(match.router_info || {}),
            photo_device: match.router_info?.photo_device || sc.router_info?.photo_device || '',
            photo_lan2: match.router_info?.photo_lan2 || sc.router_info?.photo_lan2 || '',
            photo_lan3: match.router_info?.photo_lan3 || sc.router_info?.photo_lan3 || '',
            photo_handover_p1: match.router_info?.photo_handover_p1 || sc.router_info?.photo_handover_p1 || '',
            photo_handover_p2: match.router_info?.photo_handover_p2 || sc.router_info?.photo_handover_p2 || ''
          },
          access_points: Array.isArray(match.access_points) && match.access_points.length > 0
            ? match.access_points
            : sc.access_points
        };
      }
      const savedAtText = new Date(localDraft.saved_at).toLocaleTimeString('th-TH');
      return { restored: true, savedAtText };
    }
  } catch (_) {}
  return { restored: false };
}

function updateDraftStatusUi(state, detail = '') {
  const topBadge = document.getElementById('modalTopDraftBadge');
  const bannerText = document.getElementById('draftLiveStatusText');
  const nowStr = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

  if (state === 'saving') {
    if (topBadge) {
      topBadge.classList.remove('hidden');
      topBadge.className = 'px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200';
      topBadge.textContent = 'กำลังเซฟร่าง...';
    }
    if (bannerText) bannerText.textContent = 'กำลังบันทึกร่างอัตโนมัติ...';
  } else if (state === 'local_saved') {
    if (topBadge) {
      topBadge.classList.remove('hidden');
      topBadge.className = 'px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200';
      topBadge.textContent = `เซฟในเครื่อง ${nowStr}`;
    }
    if (bannerText) bannerText.textContent = `เซฟในเครื่องแล้ว (${nowStr})`;
  } else if (state === 'saved' || state === 'restored') {
    if (topBadge) {
      topBadge.classList.remove('hidden');
      topBadge.className = 'px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200';
      topBadge.textContent = `เซฟร่างแล้ว ${nowStr}`;
    }
    if (bannerText) bannerText.textContent = `บันทึกร่างล่าสุด ${nowStr}`;
  } else {
    if (bannerText && detail) bannerText.textContent = detail;
  }
}

function scheduleAutoSaveDraft(reason = 'แก้ไขข้อมูล', immediateServer = false) {
  if (!currentCircuit) return;
  if (autoSaveLocalTimer) clearTimeout(autoSaveLocalTimer);
  autoSaveLocalTimer = setTimeout(() => {
    saveSiteDraftToLocal(reason);
    updateDraftStatusUi('local_saved', reason);
    renderSiteRoomsQuickJumpBar();
  }, 200);

  if (autoSaveServerTimer) clearTimeout(autoSaveServerTimer);
  const delayMs = immediateServer ? 350 : 2200;
  autoSaveServerTimer = setTimeout(() => {
    saveDraftInspection({ silent: true, isAuto: true, roomLabel: reason });
  }, delayMs);
}

function ensureModalAutoSaveListenerBound() {
  if (modalAutoSaveBound) return;
  const formPane = document.getElementById('modalFormPane');
  if (!formPane) return;
  modalAutoSaveBound = true;

  formPane.addEventListener('input', e => {
    const t = e.target;
    if (!t || t.type === 'file') return;
    scheduleAutoSaveDraft('กรอกข้อมูลหน้างาน', false);
  });

  formPane.addEventListener('change', e => {
    const t = e.target;
    if (!t || t.type === 'file') return;
    scheduleAutoSaveDraft('อัปเดตตัวเลือกหน้างาน', false);
  });
}

async function saveDraftInspection(options = {}) {
  const { silent = false, isAuto = false, roomLabel = '' } = options;
  if (!currentCircuit) return false;
  saveSiteDraftToLocal(roomLabel || 'กดบันทึกร่าง');
  if (isSavingDraftInFlight && isAuto) return true;
  isSavingDraftInFlight = true;
  updateDraftStatusUi('saving', roomLabel || 'บันทึกร่างทั้ง Site');
  try {
    const ok = await saveCurrentInspection(true, {
      isDraft: true,
      isAuto,
      roomLabel
    });
    const nowStr = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    if (ok) {
      updateDraftStatusUi('saved', `เซฟเมื่อ ${nowStr}`);
      renderSiteRoomsQuickJumpBar();
      if (!silent) {
        showToast('บันทึกร่างเรียบร้อยแล้ว เดินไปห้องถัดไปได้เลย');
      }
    }
    return ok;
  } finally {
    isSavingDraftInFlight = false;
  }
}

async function saveRoomDraftAndNotify(roomLabel) {
  await saveDraftInspection({ silent: true, isAuto: false, roomLabel });
  showToast(`บันทึกร่าง "${roomLabel}" เรียบร้อย`);
}

function renderSiteRoomsQuickJumpBar() {
  const bar = document.getElementById('siteRoomsQuickJumpBar');
  if (!bar || !currentCircuit) return;
  const siteList = Array.isArray(currentSiteCircuits) && currentSiteCircuits.length > 0 ? currentSiteCircuits : [currentCircuit];
  const multi = siteList.length > 1;
  const pills = [];

  siteList.forEach((sc, cIdx) => {
    const rt = sc.router_info || {};
    const rPhotos = (rt.photo_device ? 1 : 0) + (rt.photo_lan2 ? 1 : 0) + (rt.photo_lan3 ? 1 : 0);
    const rSn = cIdx === 0
      ? (document.getElementById('rSerialNo')?.value.trim() || rt.serial_no || '')
      : (document.getElementById(`sc_${cIdx}_rSn`)?.value.trim() || rt.serial_no || '');
    const rRoom = cIdx === 0
      ? (document.getElementById('rRoom')?.value.trim() || rt.room || 'วิชาการ')
      : (document.getElementById(`sc_${cIdx}_rRoom`)?.value.trim() || rt.room || 'วิชาการ');

    const rDone = rPhotos >= 3 && Boolean(rSn);
    const rDraft = !rDone && (rPhotos > 0 || Boolean(rSn));
    const rCls = rDone
      ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
      : rDraft
        ? 'bg-amber-50 text-amber-800 border-amber-300'
        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50';

    const dot = multi ? `<span class="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0" style="${circuitBadgeStyle(cIdx)}">${cIdx + 1}</span>` : '';
    pills.push(`
      <button type="button" onclick="jumpToSiteRoom(${cIdx}, 'router', 0)" class="px-2 py-0.5 rounded border text-[11px] font-medium flex items-center gap-1 transition ${rCls}">
        ${dot}<span>${multi ? `วงจร ${cIdx + 1}: ` : ''}Rack (${rRoom})</span>
        <span class="font-bold">${rPhotos}/3</span>
      </button>
    `);

    const aps = Array.isArray(sc.access_points) ? sc.access_points : [];
    aps.forEach((ap, apIdx) => {
      const spec = detectRoomSpec(ap.room);
      const apPhotos = (ap.photo_device ? 1 : 0) + (ap.photo_wifi ? 1 : 0) + (ap.photo_lan ? 1 : 0);
      const apDone = apPhotos >= 3 && Boolean(ap.serial_no);
      const apDraft = !apDone && (apPhotos > 0 || Boolean(ap.serial_no));
      const apCls = apDone
        ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
        : apDraft
          ? 'bg-amber-50 text-amber-800 border-amber-300'
          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50';

      pills.push(`
        <button type="button" onclick="jumpToSiteRoom(${cIdx}, 'ap', ${apIdx})" class="px-2 py-0.5 rounded border text-[11px] font-medium flex items-center gap-1 transition ${apCls}">
          ${dot}<span>${multi ? `วงจร ${cIdx + 1}: ` : ''}${ap.room || spec.shortRoom}</span>
          <span class="font-bold">${apPhotos}/3</span>
        </button>
      `);
    });
  });

  bar.innerHTML = pills.join('');
}

function jumpToSiteRoom(cIdx, type, apIdx = 0) {
  if (type === 'router') {
    if (currentModalStep !== 'all' && currentModalStep !== 'step1') {
      setModalStep('step1');
    }
    const targetId = cIdx === 0 ? 'modalSectionStep1' : `siteCircuitRouterCard_${cIdx}`;
    const el = document.getElementById(targetId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.classList.add('ring-2', 'ring-slate-900');
      setTimeout(() => el.classList.remove('ring-2', 'ring-slate-900'), 1400);
    }
    return;
  }

  if (type === 'ap') {
    if (currentModalStep !== 'all' && currentModalStep !== 'step23') {
      setModalStep('step23');
    }
    const targetId = cIdx === 0 ? `c1_apCard_${apIdx}` : `sc_${cIdx}_apCard_${apIdx}`;
    const el = document.getElementById(targetId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.classList.add('ring-2', 'ring-slate-900');
      setTimeout(() => el.classList.remove('ring-2', 'ring-slate-900'), 1400);
    }
  }
}

function toggleSplitLegacyPdf() {
  if (!currentCircuit) return;
  const pane = document.getElementById('modalPdfPane');
  const iframe = document.getElementById('legacyPdfIframe');

  if (!currentCircuit.legacy_pdf_path) {
    showToast('วงจรนี้ไม่มีไฟล์ PDF ของปีที่แล้ว', true);
    return;
  }

  splitPdfVisible = !splitPdfVisible;
  if (splitPdfVisible) {
    pane.classList.remove('hidden');
    const pdfUrl = '/' + encodeURI(currentCircuit.legacy_pdf_path);
    if (iframe.src !== location.origin + pdfUrl) {
      iframe.src = pdfUrl;
    }
    document.getElementById('legacyPdfLabel').textContent = `ไฟล์ปีที่แล้ว: ${currentCircuit.legacy_pdf_path}`;
  } else {
    pane.classList.add('hidden');
  }
}

function createDefaultAp(apNo, province, roomName) {
  const spec = detectRoomSpec(roomName);
  return {
    ap_no: apNo,
    checked: true,
    brand: 'TOTOLINK',
    model: 'A3002RU',
    serial_no: '',
    ocr_serial_no: '',
    asset_no: '-',
    room: spec.shortRoom,
    room_type: spec.code,
    floor: '1',
    building: '1',
    sticker_done: false,
    gecc_wan_to_lan: false,
    gecc_remote_done: false,
    gecc_anydesk_id: '',
    gecc_authen_wifi: false,
    speed_wifi_dl: '',
    speed_wifi_ul: '',
    speed_lan_dl: '',
    speed_lan_ul: '',
    speed_note: '',
    photo_device: '',
    photo_wifi: '',
    photo_lan: ''
  };
}

function compareSnStringsClient(manualSn, ocrSn) {
  const norm = v => String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = norm(manualSn);
  const o = norm(ocrSn);
  if (!m && !o) return { status: 'missing', label: 'ยังไม่ระบุ S/N', cls: 'bg-slate-100 text-slate-500' };
  if (m && o) {
    if (m === o) return { status: 'matched', label: '✓ S/N ตรงกัน', cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200' };
    return { status: 'mismatch', label: `S/N ไม่ตรง (${m} ≠ ${o})`, cls: 'bg-rose-50 text-rose-700 border border-rose-200' };
  }
  if (m && !o) return { status: 'manual_only', label: 'ระบุ S/N แล้ว', cls: 'bg-slate-100 text-slate-700' };
  return { status: 'ocr_only', label: 'อ่านจาก OCR แล้ว', cls: 'bg-amber-50 text-amber-700 border border-amber-200' };
}

function validateRouterSnRecheck() {
  const manualVal = document.getElementById('rSerialNo')?.value || '';
  const ocrVal = document.getElementById('rOcrSerialNo')?.value || '';
  const badge = document.getElementById('rSnRecheckBadge');
  if (badge) {
    const cmp = compareSnStringsClient(manualVal, ocrVal);
    badge.className = `px-2 py-0.5 rounded text-[11px] font-semibold ${cmp.cls}`;
    badge.textContent = cmp.label;
  }
  if (currentCircuit && currentCircuit.router_info) {
    currentCircuit.router_info.serial_no = manualVal.trim().toUpperCase();
    currentCircuit.router_info.ocr_serial_no = ocrVal.trim().toUpperCase();
  }
  renderModalCompletenessBar();
}

function copyRouterOcrToManual() {
  const ocrVal = (document.getElementById('rOcrSerialNo')?.value || '').trim().toUpperCase();
  if (!ocrVal) {
    showToast('ยังไม่มีค่า S/N จาก OCR', true);
    return;
  }
  const manualEl = document.getElementById('rSerialNo');
  if (manualEl) {
    manualEl.value = ocrVal;
    updateRouterStickerPreview();
    validateRouterSnRecheck();
    showToast(`คัดลอกค่า OCR (${ocrVal}) แล้ว`);
  }
}

function copyApOcrToManual(idx) {
  const ocrEl = document.getElementById(`apOcrSn_${idx}`);
  const manualEl = document.getElementById(`apSn_${idx}`);
  const ocrVal = (ocrEl?.value || '').trim().toUpperCase();
  if (!ocrVal) {
    showToast('ยังไม่มีค่า S/N จาก OCR', true);
    return;
  }
  if (manualEl) {
    manualEl.value = ocrVal;
    onApSpeedOrStickerInput(idx);
    showToast(`ยืนยัน S/N (${ocrVal}) แล้ว`);
  }
}

function renderModalCompletenessBar() {
  if (!currentCircuit) return;
  const siteList = Array.isArray(currentSiteCircuits) && currentSiteCircuits.length > 0 ? currentSiteCircuits : [currentCircuit];
  const multi = siteList.length > 1;

  const onsiteSlots = [];
  let siteP1Url = '';
  let siteP2Url = '';

  siteList.forEach((sc, cIdx) => {
    const prefix = multi ? `[วงจร ${cIdx + 1}] ` : '';
    const rt = sc.router_info || {};
    const aps = Array.isArray(sc.access_points) ? sc.access_points : [];

    onsiteSlots.push({ label: `${prefix}MikroTik`, ok: Boolean(rt.photo_device), isHandover: false });
    onsiteSlots.push({ label: `${prefix}Port 2`, ok: Boolean(rt.photo_lan2), isHandover: false });
    onsiteSlots.push({ label: `${prefix}Port 3`, ok: Boolean(rt.photo_lan3), isHandover: false });

    aps.forEach((ap, i) => {
      const rm = detectRoomSpec(ap.room);
      onsiteSlots.push({ label: `${prefix}AP#${i + 1} (${rm.code})`, ok: Boolean(ap.photo_device), isHandover: false });
      onsiteSlots.push({ label: `${prefix}WiFi (${rm.code})`, ok: Boolean(ap.photo_wifi), isHandover: false });
      onsiteSlots.push({ label: `${prefix}LAN (${rm.code})`, ok: Boolean(ap.photo_lan), isHandover: false });
    });

    if (!siteP1Url && (rt.photo_handover_p1 || rt.photo_signed_doc)) {
      siteP1Url = rt.photo_handover_p1 || rt.photo_signed_doc;
    }
    if (!siteP2Url && rt.photo_handover_p2) {
      siteP2Url = rt.photo_handover_p2;
    }
  });

  const handoverSlots = [
    { label: `ใบส่งมอบ หน้า 1/2`, ok: Boolean(siteP1Url), isHandover: true },
    { label: `ใบส่งมอบ หน้า 2/2`, ok: Boolean(siteP2Url), isHandover: true }
  ];

  const slots = [...onsiteSlots, ...handoverSlots];
  const onsiteUploaded = onsiteSlots.filter(s => s.ok).length;
  const onsiteTotal = onsiteSlots.length;
  const handoverUploaded = handoverSlots.filter(s => s.ok).length;

  const photoBadge = document.getElementById('modalPhotoCompletenessBadge');
  if (photoBadge) {
    if (onsiteUploaded >= onsiteTotal && handoverUploaded >= 2) {
      photoBadge.className = 'text-[11px] font-semibold px-2.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200';
      photoBadge.textContent = `✓ รูปหน้างาน ${onsiteUploaded}/${onsiteTotal} • ใบส่งมอบ 2/2 หน้า`;
    } else {
      photoBadge.className = 'text-[11px] font-semibold px-2.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200';
      photoBadge.textContent = `รูปหน้างาน ${onsiteUploaded}/${onsiteTotal} • ใบส่งมอบ ${handoverUploaded}/2 หน้า`;
    }
  }

  const hCount0 = (siteP1Url ? 1 : 0) + (siteP2Url ? 1 : 0);
  const scannerBadge = document.getElementById('scannerHandoverStatusBadge');
  if (scannerBadge) {
    if (hCount0 >= 2) {
      scannerBadge.className = 'px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-[11px] font-semibold text-emerald-700';
      scannerBadge.textContent = '✓ สแกนครบ 2/2 หน้า';
    } else {
      scannerBadge.className = 'px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-[11px] font-medium text-slate-600';
      scannerBadge.textContent = `สแกนแล้ว ${hCount0}/2 หน้า`;
    }
  }

  const missingBar = document.getElementById('modalMissingPhotosBar');
  if (missingBar) {
    missingBar.innerHTML = slots.map(s => `
      <span class="px-2 py-0.5 rounded border text-[11px] ${
        s.ok
          ? 'bg-emerald-50 border-emerald-200 text-emerald-700 font-medium'
          : 'bg-white border-slate-200 text-slate-500'
      }">${s.ok ? '✓' : '·'} ${s.label}</span>
    `).join('');
  }

  const savedProfile = loadGlobalTechProfile();
  const quickName = document.getElementById('modalQuickTechName');
  if (quickName) {
    if (currentCircuit.inspector_name) quickName.value = currentCircuit.inspector_name;
    else if (!quickName.value && savedProfile.name) quickName.value = savedProfile.name;
  }
  const quickPhone = document.getElementById('modalQuickTechPhone');
  if (quickPhone) {
    if (currentCircuit.inspector_phone) quickPhone.value = currentCircuit.inspector_phone;
    else if (!quickPhone.value && savedProfile.phone) quickPhone.value = savedProfile.phone;
  }

  const checkinText = document.getElementById('modalCheckinStatusText');
  if (checkinText) {
    if (currentCircuit.checkout_time) {
      checkinText.className = 'text-xs font-semibold text-emerald-700';
      checkinText.textContent = `ส่งตรวจแล้ว (${new Date(currentCircuit.checkout_time).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })})`;
    } else if (currentCircuit.checkin_time) {
      checkinText.className = 'text-xs font-semibold text-blue-700';
      checkinText.textContent = `Check-in แล้ว (${new Date(currentCircuit.checkin_time).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })})`;
    } else {
      checkinText.className = 'text-xs text-slate-500';
      checkinText.textContent = `ยังไม่ Check-in (${siteList.length} วงจร)`;
    }
  }

  const adminBadge = document.getElementById('modalAdminVerifyBadge');
  if (adminBadge) {
    const st = currentCircuit.admin_status || '';
    if (st === 'approved') {
      adminBadge.className = 'px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200';
      adminBadge.textContent = `✓ อนุมัติแล้ว`;
    } else if (st === 'pending_review') {
      adminBadge.className = 'px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200';
      adminBadge.textContent = 'รอตรวจรับ';
    } else if (st === 'rejected') {
      adminBadge.className = 'px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200';
      adminBadge.textContent = `แก้ไข: ${currentCircuit.admin_comment || currentCircuit.admin_review_note || ''}`;
    } else {
      adminBadge.className = 'px-2 py-0.5 rounded text-[11px] text-slate-500 bg-slate-100';
      adminBadge.textContent = 'รอส่งงาน';
    }
  }
  renderSiteRoomsQuickJumpBar();
  renderSiteCircuitsInfo();
}

async function checkInCurrentModalCircuit() {
  if (!currentCircuit) return;
  const savedProfile = loadGlobalTechProfile();
  const quickName = document.getElementById('modalQuickTechName')?.value.trim();
  const formName = document.getElementById('fInspectorName')?.value.trim();
  const techName = quickName || formName || currentCircuit.inspector_name || savedProfile.name || prompt('กรุณาระบุชื่อช่างผู้เข้าหน้างาน (Check-in ทั้ง Site):', 'ช่างหน้างาน');
  if (!techName) return;

  if (document.getElementById('fInspectorName')) document.getElementById('fInspectorName').value = techName;
  if (document.getElementById('modalQuickTechName')) document.getElementById('modalQuickTechName').value = techName;

  const techPhone = document.getElementById('modalQuickTechPhone')?.value.trim() || document.getElementById('fInspectorPhone')?.value.trim() || currentCircuit.inspector_phone || savedProfile.phone || '';
  if (document.getElementById('fInspectorPhone') && techPhone) document.getElementById('fInspectorPhone').value = techPhone;
  if (document.getElementById('modalQuickTechPhone') && techPhone) document.getElementById('modalQuickTechPhone').value = techPhone;
  saveGlobalTechProfile();

  const latLong = document.getElementById('fLatLong')?.value.trim() || currentCircuit.lat_long || '';
  const linkSoNumbers = (currentSiteCircuits || []).map(c => c.so_number);

  try {
    const res = await fetch(`/api/circuits/${encodeURIComponent(currentCircuit.so_number)}/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tech_name: techName,
        tech_phone: techPhone,
        lat_long: latLong,
        link_so_numbers: linkSoNumbers
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Check-in ไม่สำเร็จ');
    currentCircuit = data.circuit;
    const nowIso = currentCircuit.checkin_time || new Date().toISOString();
    (currentSiteCircuits || []).forEach(sc => {
      sc.inspector_name = techName;
      sc.inspector_phone = techPhone;
      sc.checkin_status = 'checked_in';
      sc.checkin_time = nowIso;
      if (sc.status === 'pending') sc.status = 'in_progress';
    });
    const radioInProg = document.querySelector('input[name="circuitStatus"][value="in_progress"]');
    if (radioInProg) radioInProg.checked = true;
    renderModalCompletenessBar();
    const allSos = (currentSiteCircuits || [currentCircuit]).map(x => x.so_number).join(', ');
    showToast(`📍 Check-in ทั้ง Site สำเร็จ! (${allSos})`);
    await refreshAllData();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function checkOutCurrentModalCircuit() {
  if (!currentCircuit) return;
  await saveCurrentInspection(true);
  try {
    const res = await fetch(`/api/circuits/${encodeURIComponent(currentCircuit.so_number)}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: false })
    });
    const data = await res.json();

    if (!res.ok || !data.ok) {
      const c = data.completeness;
      if (c) {
        const missingOnsite = c.missingOnsitePhotoLabels || c.missingPhotoLabels || [];
        const missingText = missingOnsite.join('\n- ') || 'ไม่มี';
        const confirmForce = confirm(
          `⚠️ ระบบตรวจสอบพบว่าข้อมูลอุปกรณ์หน้างานใน Site นี้ยังไม่ครบถ้วนก่อนแจ้งผู้ตรวจรับงาน:\n` +
          `📷 รูปอุปกรณ์+ผลเทสหน้างาน: ${c.onsiteUploadedCount ?? c.uploadedPhotos ?? 0}/${c.onsiteRequiredCount ?? c.requiredPhotos ?? 8} รูป\n` +
          (missingOnsite.length ? `- ขาดรูปหน้างาน:\n- ${missingText}\n` : '') +
          (c.hasMissingSn ? `- ยังไม่ได้กรอกยืนยันรหัส S/N ให้ครบทุกอุปกรณ์\n` : '') +
          `(หมายเหตุ: ใบแบบส่งมอบงานประจำ Site หน้า 1 และ 2 สามารถใช้ Scanner สแกนตามหลังได้)\n` +
          `\nต้องการยืนยันส่งข้อมูลทั้ง Site ให้เจ้าหน้าที่ตรวจรับงานของบริษัทตรวจสอบทันทีหรือไม่?`
        );
        if (!confirmForce) return;

        const resForce = await fetch(`/api/circuits/${encodeURIComponent(currentCircuit.so_number)}/checkout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force: true })
        });
        const dataForce = await resForce.json();
        if (!resForce.ok) throw new Error(dataForce.error || 'ส่งตรวจงานไม่สำเร็จ');
        currentCircuit = dataForce.circuit;
      } else {
        throw new Error(data.error || 'ส่งตรวจงานไม่สำเร็จ');
      }
    } else {
      currentCircuit = data.circuit;
    }

    const nowIso = currentCircuit.checkout_time || new Date().toISOString();
    (currentSiteCircuits || []).forEach(sc => {
      sc.checkin_status = 'checked_out';
      sc.checkout_time = nowIso;
      sc.admin_status = 'pending_review';
    });

    const radioComp = document.querySelector('input[name="circuitStatus"][value="completed"]');
    if (radioComp) radioComp.checked = true;
    renderModalCompletenessBar();
    const allSos = (currentSiteCircuits || [currentCircuit]).map(x => x.so_number).join(', ');
    showToast(`🏁 ส่งงานทั้ง Site (${allSos}) ให้เจ้าหน้าที่ตรวจรับงานตรวจสอบแล้ว!`);
    await refreshAllData();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function downloadWordReportFromModal(targetSo = '') {
  if (!currentCircuit) return;
  await saveCurrentInspection(true);
  const so = targetSo || currentCircuit.so_number;
  window.location.href = `/api/circuits/${encodeURIComponent(so)}/report.docx`;
}

function populateInspectionModal() {
  const c = currentCircuit;
  const siteList = Array.isArray(currentSiteCircuits) && currentSiteCircuits.length > 0 ? currentSiteCircuits : [c];
  const siteName = extractSiteNameClient(c);
  const allSosComma = siteList.map(sc => sc.so_number).join(', ');

  document.getElementById('modalSoBadge').textContent = siteList.length > 1
    ? `${siteList.length} วงจร (${allSosComma})`
    : c.so_number;
  document.getElementById('modalTitle').textContent = siteName;
  document.getElementById('modalSubtitle').textContent = `${c.region} • จังหวัด${c.province} • S/O: ${allSosComma}`;

  const rackSummaryEl = document.getElementById('modalSiteRackSummaryLabel');
  if (rackSummaryEl) {
    rackSummaryEl.textContent = `${siteList.length} วงจร (${allSosComma})`;
  }

  const s1Badge = document.getElementById('step1Circuit1Badge');
  if (s1Badge) s1Badge.textContent = `วงจรที่ 1: ${c.so_number}`;
  const s1Text = document.getElementById('step1PrimarySoText');
  if (s1Text) s1Text.textContent = `วงจรที่ 1: ${c.so_number}`;
  const s23Badge = document.getElementById('step23Circuit1Badge');
  if (s23Badge) s23Badge.textContent = `วงจรที่ 1: ${c.so_number}`;
  const s23Text = document.getElementById('step23PrimarySoText');
  if (s23Text) s23Text.textContent = `วงจรที่ 1: ${c.so_number}`;
  const s4Text = document.getElementById('step4PrimarySoText');
  if (s4Text) s4Text.textContent = `รวมทั้ง Site (${siteList.length} วงจร)`;
  const stBarSo = document.getElementById('statusBarSoLabel');
  if (stBarSo) stBarSo.textContent = `${siteName} (${allSosComma})`;

  // Render Site Rack Circuit jump pills + other Sites in the same province
  const sameBar = document.getElementById('sameProvinceCircuitsBar');
  if (sameBar) {
    sameBar.innerHTML = '';
  }

  const linkPdf = document.getElementById('linkOpenLegacyNewTab');
  if (c.legacy_pdf_path) {
    linkPdf.href = '/' + encodeURI(c.legacy_pdf_path);
    linkPdf.classList.remove('hidden');
  } else {
    linkPdf.classList.add('hidden');
  }

  if (splitPdfVisible && c.legacy_pdf_path) {
    document.getElementById('legacyPdfIframe').src = '/' + encodeURI(c.legacy_pdf_path);
    document.getElementById('legacyPdfLabel').textContent = `ไฟล์ปีที่แล้ว: ${c.legacy_pdf_path}`;
  }

  // Status radio
  const stRadios = document.querySelectorAll('input[name="circuitStatus"]');
  stRadios.forEach(r => { r.checked = (r.value === (c.status || 'pending')); });

  // Location & Circuit
  document.getElementById('fSoNumber').value = c.so_number || '';
  document.getElementById('fServiceNo').value = c.service_no || '';
  document.getElementById('fSpeedPkg').value = c.speed_pkg || '1000Mbps/500Mbps';
  document.getElementById('fBranchName').value = c.branch_name || '';
  document.getElementById('fLatLong').value = c.lat_long || '';
  document.getElementById('fAddress').value = c.address || '';

  // Step 1: Router (MikroTik) for Circuit #1
  const rt = c.router_info || {};
  document.getElementById('chkMktSticker').checked = Boolean(rt.sticker_done);
  document.getElementById('chkMktSpeed').checked = Boolean(rt.speed_tested);

  const rModelVal = rt.model || 'RB3011';
  const rRadios = document.querySelectorAll('input[name="routerModel"]');
  let matchedRadio = false;
  rRadios.forEach(r => {
    if (r.value === rModelVal || (rModelVal.includes('750') && r.value.includes('750')) || (rModelVal.includes('D52G') && r.value.includes('D52G'))) {
      r.checked = true;
      matchedRadio = true;
    }
  });
  if (!matchedRadio && rRadios[rRadios.length - 1]) rRadios[rRadios.length - 1].checked = true;
  const customModelEl = document.getElementById('rCustomModel');
  if (customModelEl) customModelEl.value = rModelVal;

  document.getElementById('rSerialNo').value = rt.serial_no || '';
  const ocrEl = document.getElementById('rOcrSerialNo');
  if (ocrEl) ocrEl.value = rt.ocr_serial_no || '';
  document.getElementById('rAssetNo').value = displayRouterAssetNo(rt.asset_no);
  document.getElementById('rRoom').value = rt.room || 'วิชาการ';
  document.getElementById('rFloor').value = rt.floor || '1';
  document.getElementById('rBuilding').value = rt.building || '1';
  document.getElementById('rLan2Dl').value = rt.speed_lan2_dl || '';
  document.getElementById('rLan2Ul').value = rt.speed_lan2_ul || '';
  document.getElementById('rLan3Dl').value = rt.speed_lan3_dl || '';
  document.getElementById('rLan3Ul').value = rt.speed_lan3_ul || '';

  updateRouterStickerPreview();
  validateRouterSnRecheck();
  validateRouterSpeeds();

  renderPhotoSlot('slotRouterDevice', 'router_device', `1) รูปอุปกรณ์ MikroTik + Sticker (${c.so_number})`, rt.photo_device, url => {
    currentCircuit.router_info.photo_device = url;
    renderModalCompletenessBar();
  });
  renderPhotoSlot('slotRouterLan2', 'router_lan2', `2) รูปผลทดสอบ Port 2 (${c.so_number})`, rt.photo_lan2, url => {
    currentCircuit.router_info.photo_lan2 = url;
    renderModalCompletenessBar();
  });
  renderPhotoSlot('slotRouterLan3', 'router_lan3', `3) รูปผลทดสอบ Port 3 (${c.so_number})`, rt.photo_lan3, url => {
    currentCircuit.router_info.photo_lan3 = url;
    renderModalCompletenessBar();
  });

  // Steps 2 & 3: Access Points for Circuit #1
  renderAccessPointCards();

  // Step 4: 1 Shared Scanned Paper Handover Form per Site (Page 1/2 & Page 2/2 covering up to 4 circuits)
  let sharedP1 = rt.photo_handover_p1 || rt.photo_signed_doc || '';
  let sharedP2 = rt.photo_handover_p2 || '';
  for (const sc of siteList) {
    const srt = sc.router_info || {};
    if (!sharedP1 && (srt.photo_handover_p1 || srt.photo_signed_doc)) sharedP1 = srt.photo_handover_p1 || srt.photo_signed_doc;
    if (!sharedP2 && srt.photo_handover_p2) sharedP2 = srt.photo_handover_p2;
  }
  rt.photo_handover_p1 = sharedP1;
  rt.photo_signed_doc = sharedP1;
  rt.photo_handover_p2 = sharedP2;

  document.getElementById('chkDocFilled').checked = Boolean(rt.doc_filled || sharedP1);
  document.getElementById('chkDocStamped').checked = Boolean(rt.doc_stamped || sharedP2);
  renderPhotoSlot(
    'slotSignedDocPhoto',
    'handover_page1',
    `1) สำเนาแบบส่งมอบงาน หน้าที่ 1/2`,
    sharedP1,
    url => {
      (currentSiteCircuits || [currentCircuit]).forEach(sc => {
        if (!sc.router_info) sc.router_info = {};
        sc.router_info.photo_handover_p1 = url;
        sc.router_info.photo_signed_doc = url;
        if (url) sc.router_info.doc_filled = true;
      });
      renderModalCompletenessBar();
    }
  );
  renderPhotoSlot(
    'slotSignedDocPage2Photo',
    'handover_page2',
    `2) สำเนาแบบส่งมอบงาน หน้าที่ 2/2 (พร้อมตราประทับ)`,
    sharedP2,
    url => {
      (currentSiteCircuits || [currentCircuit]).forEach(sc => {
        if (!sc.router_info) sc.router_info = {};
        sc.router_info.photo_handover_p2 = url;
        if (url) sc.router_info.doc_stamped = true;
      });
      renderModalCompletenessBar();
    }
  );

  const todayThai = formatThaiDateToday();
  const savedProfile = loadGlobalTechProfile();
  document.getElementById('fRemarks').value = c.remarks || '';
  document.getElementById('fInspectorName').value = c.inspector_name || savedProfile.name || '';
  document.getElementById('fInspectorPhone').value = c.inspector_phone || savedProfile.phone || '';
  document.getElementById('fInspectionDate').value = c.inspection_date || todayThai;
  if (document.getElementById('fReceiverName')) document.getElementById('fReceiverName').value = c.receiver_name || '';
  if (document.getElementById('fReceiverPosition')) document.getElementById('fReceiverPosition').value = c.receiver_position || '';
  if (document.getElementById('fReceiverPhone')) document.getElementById('fReceiverPhone').value = c.receiver_phone || '';
  if (document.getElementById('fReceivedDate')) document.getElementById('fReceivedDate').value = c.received_date || todayThai;

  loadSignatureToCanvas('sigInspector', c.inspector_signature);
  loadSignatureToCanvas('sigReceiver', c.receiver_signature);
  document.getElementById('modalSaveStatus').textContent = c.updated_at ? `อัปเดตล่าสุด: ${new Date(c.updated_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}` : 'ยังไม่เคยบันทึก';

  // Render Circuit #2, #3... directly in the same modal page (Step 1, Step 2-3, Step 5-6)
  renderAdditionalSiteCircuitsInModal();
  renderModalCompletenessBar();
  updateHandoverPaperCheatSheet();
  renderSiteCircuitsInfo();
  colorizeSiteCircuitFrames();
}

// Router asset numbers in the data are auto-filled placeholders (province / company name), not real asset numbers → show "-"
function displayRouterAssetNo(raw) {
  const v = String(raw ?? '').trim();
  if (!v || v === '-' || /^สขจ\.[^/]*$/.test(v) || /^1\s*to\s*all$/i.test(v)) return '-';
  return v;
}

// Same for Access Point asset numbers: the data holds "<สาขา>/<ห้อง>" placeholders (e.g. สขจ.นครพนม/GECC) → show "-"
function displayApAssetNo(raw) {
  const v = String(raw ?? '').trim();
  if (!v || v === '-' || /^สข[^/]*\/[A-Za-z]+\d*$/.test(v)) return '-';
  return v;
}

// One colour per circuit (cycles after 5) so each circuit is easy to tell apart at a glance
// Values live in desk-theme.js (light + dark) so a theme switch recolours every frame without re-rendering
const CIRCUIT_COLORS = [
  { solid: 'var(--cc0-solid)', line: 'var(--cc0-line)', mid: 'var(--cc0-mid)', soft: 'var(--cc0-soft)', ink: 'var(--cc0-ink)', deep: 'var(--cc0-deep)' }, // blue
  { solid: 'var(--cc1-solid)', line: 'var(--cc1-line)', mid: 'var(--cc1-mid)', soft: 'var(--cc1-soft)', ink: 'var(--cc1-ink)', deep: 'var(--cc1-deep)' }, // green
  { solid: 'var(--cc2-solid)', line: 'var(--cc2-line)', mid: 'var(--cc2-mid)', soft: 'var(--cc2-soft)', ink: 'var(--cc2-ink)', deep: 'var(--cc2-deep)' }, // amber
  { solid: 'var(--cc3-solid)', line: 'var(--cc3-line)', mid: 'var(--cc3-mid)', soft: 'var(--cc3-soft)', ink: 'var(--cc3-ink)', deep: 'var(--cc3-deep)' }, // violet
  { solid: 'var(--cc4-solid)', line: 'var(--cc4-line)', mid: 'var(--cc4-mid)', soft: 'var(--cc4-soft)', ink: 'var(--cc4-ink)', deep: 'var(--cc4-deep)' }  // rose
];
function circuitColorOf(idx) {
  return CIRCUIT_COLORS[((idx % CIRCUIT_COLORS.length) + CIRCUIT_COLORS.length) % CIRCUIT_COLORS.length];
}
// Inline-style helpers so every tab uses the same colour for the same circuit
const circuitFrameStyle = idx => `border:2px solid ${circuitColorOf(idx).line};background:${circuitColorOf(idx).soft};`;
const circuitBadgeStyle = idx => `background:${circuitColorOf(idx).solid};color:#fff;`;

// Access Point cards inside a circuit: same hue as the circuit, a different shade per AP (solid → dark → light)
function apToneOf(cIdx, apIdx) {
  const c = circuitColorOf(cIdx);
  return [
    { band: c.solid, text: '#fff', border: c.solid },
    { band: c.deep, text: '#fff', border: c.deep },
    { band: c.line, text: c.deep, border: c.line }
  ][((apIdx % 3) + 3) % 3];
}
// Odd APs (2nd, 4th…) also get a tinted body so neighbouring AP cards are told apart at a glance
const apCardStyle = (cIdx, apIdx) => `border:2px solid ${apToneOf(cIdx, apIdx).border};background:${apIdx % 2 ? circuitColorOf(cIdx).mid : 'rgb(var(--bg-white))'};`;
const apCardClass = apIdx => (apIdx % 2 ? 'circuit-tint' : '');
const apPillStyle = (cIdx, apIdx) => `background:${apToneOf(cIdx, apIdx).band};color:${apToneOf(cIdx, apIdx).text};`;
// 8px colour bar across the top of the card; negative margins cancel the card padding (px)
const apTopBarHtml = (cIdx, apIdx, pad) => `<div style="height:8px;background:${apToneOf(cIdx, apIdx).band};margin:-${pad}px -${pad}px 12px"></div>`;

function circuitLabelHtml(idx, text) {
  const col = circuitColorOf(idx);
  return `<div class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg" style="background:${col.mid}">
    <span class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0" style="background:${col.solid}">${idx + 1}</span>
    <span class="text-sm font-bold" style="color:${col.ink}">${text}</span>
  </div>`;
}

// Circuit #1 blocks live in static HTML: colour them only when the Site has more than 1 circuit
function colorizeSiteCircuitFrames() {
  const multi = Array.isArray(currentSiteCircuits) && currentSiteCircuits.length > 1 && currentCircuit;
  const col = circuitColorOf(0);
  const so = multi ? currentSiteCircuits[0].so_number : '';
  [['circuit1RouterFrame', 'วงจรที่ 1 · Router (ตู้ Rack)'], ['circuit1ApsFrame', 'วงจรที่ 1 · Access Point']].forEach(([id, label]) => {
    const frame = document.getElementById(id);
    const lab = document.getElementById(`${id}Label`);
    if (!frame || !lab) return;
    frame.classList.toggle('circuit-tint', Boolean(multi));
    if (multi) {
      frame.style.cssText = `${circuitFrameStyle(0)} border-radius:12px; padding:12px;`;
      lab.innerHTML = circuitLabelHtml(0, `${label} · ${so}`);
      lab.classList.remove('hidden');
    } else {
      frame.style.cssText = '';
      lab.innerHTML = '';
      lab.classList.add('hidden');
    }
  });
  ['step1Circuit1Badge', 'step23Circuit1Badge'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.cssText = multi ? `background:${col.solid};color:#fff;border-color:${col.solid};` : '';
  });
}

// Tab 1: summary of every circuit in this Site (only when the Site has more than 1 circuit)
function renderSiteCircuitsInfo() {
  const box = document.getElementById('siteCircuitsInfoBox');
  if (!box) return;
  const list = Array.isArray(currentSiteCircuits) ? currentSiteCircuits : [];
  if (list.length <= 1) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const row = (label, value) => `
    <div class="flex gap-2 text-xs leading-snug">
      <span class="w-24 shrink-0 text-slate-600">${label}</span>
      <span class="min-w-0 flex-1 text-slate-800 break-words">${value || '<span class="text-slate-400">-</span>'}</span>
    </div>`;
  const fmtTime = iso => iso ? new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }) : '';

  const cards = list.map((sc, idx) => {
    const rt = sc.router_info || {};
    const aps = (Array.isArray(sc.access_points) ? sc.access_points : []).filter(ap => ap && ap.checked !== false);
    const st = STATUS_BADGE[sc.status] || STATUS_BADGE.pending;

    // Photo progress for this circuit: router 3 + AP 3 each
    let have = [rt.photo_device, rt.photo_lan2, rt.photo_lan3].filter(Boolean).length;
    let need = 3;
    aps.forEach(ap => {
      need += 3;
      have += [ap.photo_device, ap.photo_wifi, ap.photo_lan].filter(Boolean).length;
    });

    const rack = [rt.room && `ห้อง${String(rt.room).replace(/^ห้อง\s*/, '')}`, rt.floor && `ชั้น ${rt.floor}`, rt.building && `อาคาร ${rt.building}`].filter(Boolean).join(' ');
    const router = [rt.model || 'RB3011', rt.serial_no && `S/N ${rt.serial_no}`].filter(Boolean).join(' · ');
    const apLines = aps.length
      ? aps.map((ap, i) => {
          const room = ap.room_type ? `ห้อง ${ap.room_type}` : (ap.room || `จุดที่ ${i + 1}`);
          const dev = [ap.brand, ap.model].filter(Boolean).join(' ');
          return `<div>${esc(room)}${dev ? ` · ${esc(dev)}` : ''}${ap.serial_no ? ` · S/N ${esc(ap.serial_no)}` : ''}</div>`;
        }).join('')
      : '';
    const checkin = sc.checkin_time
      ? `Check-in ${fmtTime(sc.checkin_time)}${sc.checkout_time ? ` · ส่งตรวจ ${fmtTime(sc.checkout_time)}` : ''}`
      : 'ยังไม่ได้ Check-in';

    const col = circuitColorOf(idx);
    const isOpen = sc.so_number === currentCircuit.so_number;
    const jumpBtn = (step, label) => `<button type="button" onclick="setModalStep('${step}'); scrollToSiteCircuitCard(${idx});" class="px-2.5 py-1 rounded-lg text-[11px] font-semibold" style="background:${col.soft};color:${col.ink};border:1px solid ${col.line}">${label}</button>`;

    return `
      <div class="rounded-xl overflow-hidden circuit-tint" style="border:2px solid ${col.line};background:${col.soft}">
        <div class="flex items-center justify-between gap-2 flex-wrap px-3 py-2" style="background:${col.mid}">
          <div class="flex items-center gap-2 min-w-0">
            <span class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0" style="background:${col.solid}">${idx + 1}</span>
            <span class="text-sm font-bold" style="color:${col.ink}">วงจรที่ ${idx + 1} · ${esc(sc.so_number)}</span>
            ${isOpen ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-white" style="color:${col.ink};border:1px solid ${col.line}">กำลังเปิดอยู่</span>` : ''}
          </div>
          <span class="px-2 py-0.5 rounded border text-[11px] font-semibold ${st.cls}">${st.label}</span>
        </div>
        <div class="p-3 space-y-1.5">
          ${row('Service No.', esc(sc.service_no))}
          ${row('ความเร็วสัญญา', esc(sc.speed_pkg))}
          ${row('สถานที่', esc(sc.branch_name))}
          ${row('ตู้ Rack', esc(rack))}
          ${row('Router', esc(router))}
          ${row('Access Point', apLines ? `${apLines}` : '')}
          ${row('รูปหน้างาน', `<span class="font-semibold" style="color:${have >= need ? 'var(--ok-ink)' : col.ink}">${have}/${need} รูป</span>`)}
          ${row('สถานะเข้างาน', esc(checkin))}
          <div class="pt-1.5 flex gap-1.5 flex-wrap">
            ${jumpBtn('step1', 'ไปที่ Router วงจรนี้ →')}
            ${jumpBtn('step23', 'ไปที่ Access Point →')}
          </div>
        </div>
      </div>`;
  }).join('');

  box.innerHTML = `
    <div class="flex items-center justify-between gap-2">
      <h4 class="text-xs font-bold text-slate-900">ข้อมูลทุกวงจรใน Site นี้ (${list.length} วงจร)</h4>
      <span class="text-[11px] text-slate-500">สรุปอ่านอย่างเดียว</span>
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-2.5">${cards}</div>`;
  box.classList.remove('hidden');
}

async function switchCircuitInModal(soNumber) {
  if (currentCircuit && currentCircuit.so_number === soNumber) return;
  await openInspectionModal(soNumber);
}

function setRouterRoom(roomName) {
  document.getElementById('rRoom').value = roomName;
  updateHandoverPaperCheatSheet();
}

function onRouterModelPresetChange(modelVal) {
  const customEl = document.getElementById('rCustomModel');
  if (customEl) customEl.value = modelVal;
  updateRouterStickerPreview();
}

function resetRouterForNewDevice() {
  if (!confirm('ยืนยันการล้างรหัส S/N เดิมของ MikroTik เพื่อกรอกข้อมูลเครื่องใหม่ที่เปลี่ยนระหว่างปีหรือไม่?')) return;
  const snEl = document.getElementById('rSerialNo');
  const ocrEl = document.getElementById('rOcrSerialNo');
  if (snEl) snEl.value = '';
  if (ocrEl) ocrEl.value = '';
  updateRouterStickerPreview();
  validateRouterSnRecheck();
  if (snEl) snEl.focus();
  showToast('🔄 ล้างรหัส S/N เดิมแล้ว กรุณาเลือกรุ่นและสแกน/กรอก S/N ของเครื่อง MikroTik ใหม่');
}

function updateRouterStickerPreview() {
  const so = document.getElementById('fSoNumber')?.value || '-';
  const asset = document.getElementById('rAssetNo')?.value || '-';
  const customModel = document.getElementById('rCustomModel')?.value.trim();
  const modelEl = document.querySelector('input[name="routerModel"]:checked');
  const model = customModel || (modelEl ? modelEl.value : 'RB3011');
  const sn = document.getElementById('rSerialNo')?.value || '-';
  const preview = document.getElementById('routerStickerPreview');
  if (preview) {
    preview.innerHTML = `เลขที่วงจร: <strong>${so}</strong> | เลขครุภัณฑ์: <strong>${asset}</strong> | ยี่ห้อ/รุ่น: <strong>MikroTik ${model}</strong> | SN: <strong>${sn}</strong>`;
  }
  updateHandoverPaperCheatSheet();
}

function validateRouterSpeeds() {
  const checkBadge = (dlStr, ulStr, minDl, minUl, badgeId) => {
    const badge = document.getElementById(badgeId);
    if (!badge) return;
    const dl = parseFloat(dlStr);
    const ul = parseFloat(ulStr);
    if (isNaN(dl) && isNaN(ul)) {
      badge.className = 'text-[11px] font-bold px-2 py-0.5 rounded bg-slate-200 text-slate-600';
      badge.textContent = `เกณฑ์ ≥ ${minDl}/${minUl} Mbps`;
      return;
    }
    if (dl >= minDl && ul >= minUl) {
      badge.className = 'text-[11px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300';
      badge.textContent = `✅ ผ่านเกณฑ์ (${dl}/${ul}M)`;
    } else {
      badge.className = 'text-[11px] font-bold px-2 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-300';
      badge.textContent = `⚠️ ต่ำกว่าเกณฑ์ ${minDl}/${minUl}M`;
    }
  };

  checkBadge(
    document.getElementById('rLan2Dl')?.value,
    document.getElementById('rLan2Ul')?.value,
    650, 350,
    'badgeLan2Pass'
  );
  checkBadge(
    document.getElementById('rLan3Dl')?.value,
    document.getElementById('rLan3Ul')?.value,
    650, 350,
    'badgeLan3Pass'
  );
}

// ============================================================================
// Dynamic Access Points & Rooms (Steps 2 & 3: ปรับเพิ่ม / ยุบห้อง / เปลี่ยนอุปกรณ์ระหว่างปี)
// ============================================================================
function syncApInputsFromDom() {
  if (!currentCircuit || !Array.isArray(currentCircuit.access_points)) return;
  currentCircuit.access_points.forEach((ap, idx) => {
    const brandEl = document.getElementById(`apBrand_${idx}`);
    if (!brandEl) return;
    ap.brand = brandEl.value;
    ap.model = document.getElementById(`apModel_${idx}`).value;
    ap.serial_no = document.getElementById(`apSn_${idx}`).value.trim().toUpperCase();
    const ocrEl = document.getElementById(`apOcrSn_${idx}`);
    if (ocrEl) ap.ocr_serial_no = ocrEl.value.trim().toUpperCase();
    ap.asset_no = document.getElementById(`apAsset_${idx}`).value.trim();
    ap.room = document.getElementById(`apRoom_${idx}`).value.trim();
    ap.floor = document.getElementById(`apFloor_${idx}`).value.trim();
    ap.building = document.getElementById(`apBuilding_${idx}`).value.trim();
    ap.speed_wifi_dl = document.getElementById(`apWifiDl_${idx}`).value.trim();
    ap.speed_wifi_ul = document.getElementById(`apWifiUl_${idx}`).value.trim();
    ap.speed_lan_dl = document.getElementById(`apLanDl_${idx}`).value.trim();
    ap.speed_lan_ul = document.getElementById(`apLanUl_${idx}`).value.trim();
    const noteEl = document.getElementById(`apSpeedNote_${idx}`);
    if (noteEl) ap.speed_note = noteEl.value.trim();

    const chkSticker = document.getElementById(`apChkSticker_${idx}`);
    if (chkSticker) ap.sticker_done = chkSticker.checked;

    const chkWanLan = document.getElementById(`apGeccWanToLan_${idx}`);
    if (chkWanLan) ap.gecc_wan_to_lan = chkWanLan.checked;

    const chkRemoteDone = document.getElementById(`apGeccRemoteDone_${idx}`);
    if (chkRemoteDone) ap.gecc_remote_done = chkRemoteDone.checked;

    const anydeskEl = document.getElementById(`apGeccAnydesk_${idx}`);
    if (anydeskEl) ap.gecc_anydesk_id = anydeskEl.value.trim();

    const chkAuthen = document.getElementById(`apGeccAuthen_${idx}`);
    if (chkAuthen) ap.gecc_authen_wifi = chkAuthen.checked;
  });
}

function addAccessPointByRoomType(roomTypeCode) {
  syncApInputsFromDom();
  const nextNo = currentCircuit.access_points.length + 1;
  const spec = ROOM_SPECS[roomTypeCode] || ROOM_SPECS.GPS;
  currentCircuit.access_points.push(createDefaultAp(nextNo, currentCircuit.province, spec.shortRoom));
  renderAccessPointCards();
  renderModalCompletenessBar();
  scheduleAutoSaveDraft(`เพิ่มห้อง ${spec.shortRoom}`, true);
  showToast(`➕ เพิ่ม ${spec.fullLabel} (AP ตัวที่ ${nextNo}) เรียบร้อยแล้ว`);
}

function addCustomRoomAccessPoint() {
  syncApInputsFromDom();
  const customRoom = prompt('ระบุชื่อห้องที่เพิ่มใหม่ในปีนี้ (เช่น ห้องอบรม DLS 2, ห้องงานทะเบียน, ห้องสอบใบขับขี่):', 'ห้องอบรม DLS 2');
  if (!customRoom || !customRoom.trim()) return;
  const nextNo = currentCircuit.access_points.length + 1;
  currentCircuit.access_points.push(createDefaultAp(nextNo, currentCircuit.province, customRoom.trim()));
  renderAccessPointCards();
  renderModalCompletenessBar();
  scheduleAutoSaveDraft(`เพิ่มห้อง ${customRoom.trim()}`, true);
  showToast(`➕ เพิ่มห้อง "${customRoom.trim()}" (AP ตัวที่ ${nextNo}) เรียบร้อยแล้ว`);
}

function removeAccessPointSlot(idx) {
  syncApInputsFromDom();
  const targetAp = currentCircuit.access_points[idx];
  const roomName = targetAp?.room || `ตัวที่ ${idx + 1}`;
  const confirmed = confirm(
    `ยืนยันการ "ยุบห้อง / ลบอุปกรณ์ Access Point ตัวที่ ${idx + 1} (${roomName})" ออกจากวงจรนี้หรือไม่?\n` +
    `(ระบบจะปรับลดจำนวนรูปถ่ายและปรับตารางในรายงาน PDF/Word ตามจำนวนห้องจริงทันที)`
  );
  if (!confirmed) return;

  currentCircuit.access_points.splice(idx, 1);
  currentCircuit.access_points.forEach((ap, i) => { ap.ap_no = i + 1; });
  renderAccessPointCards();
  renderModalCompletenessBar();
  scheduleAutoSaveDraft(`ยุบห้อง ${roomName}`, true);
  showToast(`🗑️ ยุบห้อง / ลบ AP (${roomName}) เรียบร้อยแล้ว — ปัจจุบันเหลือ AP ${currentCircuit.access_points.length} จุด`);
}

function resetApForNewDevice(idx) {
  syncApInputsFromDom();
  const targetAp = currentCircuit.access_points[idx];
  if (!targetAp) return;
  if (!confirm(`ยืนยันการล้างรหัส S/N เดิมของ AP ตัวที่ ${idx + 1} (${targetAp.room || ''}) เพื่อกรอกเครื่องใหม่ที่เปลี่ยนระหว่างปีหรือไม่?`)) return;
  targetAp.serial_no = '';
  targetAp.ocr_serial_no = '';
  renderAccessPointCards();
  scheduleAutoSaveDraft(`ล้าง S/N AP ตัวที่ ${idx + 1}`, true);
  const snEl = document.getElementById(`apSn_${idx}`);
  if (snEl) snEl.focus();
  showToast(`🔄 ล้างรหัส S/N เดิมของ AP ตัวที่ ${idx + 1} แล้ว กรุณาเลือกยี่ห้อ/รุ่นและสแกน S/N เครื่องใหม่`);
}

function moveAccessPointSlot(idx, delta) {
  syncApInputsFromDom();
  const newIdx = idx + delta;
  if (newIdx < 0 || newIdx >= currentCircuit.access_points.length) return;
  const temp = currentCircuit.access_points[idx];
  currentCircuit.access_points[idx] = currentCircuit.access_points[newIdx];
  currentCircuit.access_points[newIdx] = temp;
  currentCircuit.access_points.forEach((ap, i) => { ap.ap_no = i + 1; });
  renderAccessPointCards();
  renderModalCompletenessBar();
  scheduleAutoSaveDraft('จัดลำดับห้อง AP', true);
}

function setApBrand(idx, brand) {
  syncApInputsFromDom();
  currentCircuit.access_points[idx].brand = brand;
  const presets = AP_MODEL_PRESETS[brand] || [];
  if (presets.length > 0) {
    currentCircuit.access_points[idx].model = presets[0];
  }
  renderAccessPointCards();
  scheduleAutoSaveDraft(`เปลี่ยนยี่ห้อ AP ตัวที่ ${idx + 1}`, false);
}

function setApRoomQuick(idx, roomCode) {
  syncApInputsFromDom();
  const spec = ROOM_SPECS[roomCode] || ROOM_SPECS.GPS;
  currentCircuit.access_points[idx].room = spec.shortRoom;
  currentCircuit.access_points[idx].room_type = spec.code;
  if (currentCircuit) {
    currentCircuit.access_points[idx].asset_no = '-';
  }
  renderAccessPointCards();
  renderModalCompletenessBar();
  scheduleAutoSaveDraft(`เปลี่ยนประเภทห้องเป็น ${spec.shortRoom}`, true);
}

function setApSpeedNoteQuick(idx, noteText) {
  const el = document.getElementById(`apSpeedNote_${idx}`);
  if (el) {
    el.value = noteText;
    syncApInputsFromDom();
  }
}

function validateApSpeedBadge(dlStr, ulStr, minDl, minUl) {
  const dl = parseFloat(dlStr);
  const ul = parseFloat(ulStr);
  if (isNaN(dl) && isNaN(ul)) {
    return `<span class="text-[11px] font-bold px-2 py-0.5 rounded bg-slate-200 text-slate-600">เกณฑ์ ≥ ${minDl}/${minUl}M</span>`;
  }
  if (dl >= minDl && ul >= minUl) {
    return `<span class="text-[11px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300">✅ ผ่านเกณฑ์ (${dl}/${ul}M)</span>`;
  }
  return `<span class="text-[11px] font-bold px-2 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-300">⚠️ ต่ำกว่าเกณฑ์ ${minDl}/${minUl}M</span>`;
}

function onApSpeedOrStickerInput(idx) {
  syncApInputsFromDom();
  const ap = currentCircuit.access_points[idx];
  const spec = detectRoomSpec(ap.room);
  const so = document.getElementById('fSoNumber')?.value || currentCircuit.so_number;

  const stickerEl = document.getElementById(`apStickerPreview_${idx}`);
  if (stickerEl) {
    stickerEl.innerHTML = `เลขที่วงจร: <strong>${so}</strong> | เลขครุภัณฑ์: <strong>${displayApAssetNo(ap.asset_no)}</strong> | ยี่ห้อ/รุ่น: <strong>${ap.brand || ''} ${ap.model || ''}</strong> | SN: <strong>${ap.serial_no || '-'}</strong>`;
  }

  const snBadgeEl = document.getElementById(`apSnRecheckBadge_${idx}`);
  if (snBadgeEl) {
    const cmp = compareSnStringsClient(ap.serial_no, ap.ocr_serial_no);
    snBadgeEl.className = `px-2.5 py-0.5 rounded-full text-[11px] font-bold ${cmp.cls}`;
    snBadgeEl.textContent = cmp.label;
  }

  const wifiBadgeEl = document.getElementById(`apWifiBadge_${idx}`);
  if (wifiBadgeEl) {
    wifiBadgeEl.innerHTML = validateApSpeedBadge(ap.speed_wifi_dl, ap.speed_wifi_ul, spec.wifiMinDl, spec.wifiMinUl);
  }

  const lanBadgeEl = document.getElementById(`apLanBadge_${idx}`);
  if (lanBadgeEl) {
    lanBadgeEl.innerHTML = validateApSpeedBadge(ap.speed_lan_dl, ap.speed_lan_ul, spec.lanMinDl, spec.lanMinUl);
  }

  updateHandoverPaperCheatSheet();
}

function updateHandoverPaperCheatSheet() {
  const box = document.getElementById('handoverPaperCheatSheetBox');
  if (!box || !currentCircuit) return;

  const siteList = Array.isArray(currentSiteCircuits) && currentSiteCircuits.length > 0 ? currentSiteCircuits : [currentCircuit];
  const siteName = extractSiteNameClient(currentCircuit);
  const address = document.getElementById('fAddress')?.value.trim() || currentCircuit.address || '-';
  const latLong = document.getElementById('fLatLong')?.value.trim() || currentCircuit.lat_long || '-';

  const circuitsHtml = siteList.map((sc, idx) => {
    const isPrimary = idx === 0;
    const so = isPrimary ? (document.getElementById('fSoNumber')?.value.trim() || sc.so_number || '-') : (sc.so_number || '-');
    const svc = isPrimary ? (document.getElementById('fServiceNo')?.value.trim() || sc.service_no || '-') : (sc.service_no || '-');
    const pkg = isPrimary ? (document.getElementById('fSpeedPkg')?.value.trim() || sc.speed_pkg || '1000Mbps/500Mbps') : (sc.speed_pkg || '1000Mbps/500Mbps');
    const rt = sc.router_info || {};
    const rModel = isPrimary
      ? (document.getElementById('rCustomModel')?.value.trim() || document.querySelector('input[name="routerModel"]:checked')?.value || rt.model || 'RB3011')
      : (rt.model || 'RB3011');
    const rSn = isPrimary
      ? (document.getElementById('rSerialNo')?.value.trim().toUpperCase() || rt.serial_no || '-')
      : (rt.serial_no || '-');
    const rAsset = isPrimary
      ? (document.getElementById('rAssetNo')?.value.trim() || displayRouterAssetNo(rt.asset_no))
      : displayRouterAssetNo(rt.asset_no);
    const rRoom = isPrimary
      ? (document.getElementById('rRoom')?.value.trim() || rt.room || '-')
      : (rt.room || '-');
    const rFloor = isPrimary
      ? (document.getElementById('rFloor')?.value.trim() || rt.floor || '1')
      : (rt.floor || '1');
    const rBldg = isPrimary
      ? (document.getElementById('rBuilding')?.value.trim() || rt.building || '1')
      : (rt.building || '1');

    const aps = Array.isArray(sc.access_points) ? sc.access_points : [];
    const apLines = aps.length > 0
      ? aps.map((ap, i) => `
          <div class="pl-3 border-l-2 border-slate-300 text-slate-700">
            • <strong>AP ${i + 1} (${ap.room || '-'} ชั้น ${ap.floor || '1'} อาคาร ${ap.building || '1'}):</strong> ${ap.brand || '-'} ${ap.model || '-'} | S/N: <strong class="font-mono">${ap.serial_no || '-'}</strong> | ครุภัณฑ์: ${displayApAssetNo(ap.asset_no)}
          </div>
        `).join('')
      : `<div class="pl-3 text-slate-400">ไม่มี Access Point</div>`;

    const multiSite = siteList.length > 1;
    const ccol = circuitColorOf(idx);
    return `
      <div class="p-2.5 rounded-lg space-y-1 ${multiSite ? '' : 'bg-slate-50 border border-slate-200'}" style="${multiSite ? `border:2px solid ${ccol.line};background:${ccol.soft};` : ''}">
        <div class="flex items-center justify-between flex-wrap gap-1">
          <div class="flex items-center gap-1.5 flex-wrap">
            ${multiSite ? `<span class="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0" style="background:${ccol.solid}">${idx + 1}</span>` : ''}
            <strong ${multiSite ? `style="color:${ccol.ink}"` : ''}>วงจรที่ ${idx + 1}:</strong> <span class="font-mono font-bold text-slate-900">${so}</span> (Service: ${svc}) • ${pkg}
          </div>
          <span class="px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-600 text-[10px] font-semibold">${idx < 3 ? 'หน้า 1/2' : 'หน้า 2/2'}</span>
        </div>
        <div class="pl-3 border-l-2 border-slate-400 text-slate-700">
          • <strong>Router (ห้อง${rRoom} ชั้น ${rFloor} อาคาร ${rBldg}):</strong> MikroTik ${rModel} | S/N: <strong class="font-mono">${rSn}</strong> | ครุภัณฑ์: ${rAsset}
        </div>
        ${apLines}
      </div>
    `;
  }).join('');

  box.innerHTML = `
    <div class="p-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-700">
      <strong>สาขา:</strong> ${siteName} (จ.${currentCircuit.province || '-'}) | <strong>ที่อยู่:</strong> ${address} | <strong>พิกัด:</strong> ${latLong}
    </div>
    <div class="space-y-2 mt-1.5">
      ${circuitsHtml}
    </div>
  `;
}

function renderAccessPointCards() {
  const container = document.getElementById('accessPointsContainer');
  const aps = currentCircuit.access_points || [];
  const so = document.getElementById('fSoNumber')?.value || currentCircuit.so_number;

  const countBadge = document.getElementById('apRoomCountSummaryBadge');
  if (countBadge) {
    countBadge.textContent = `จำนวนห้อง AP: ${aps.length} จุด`;
  }

  if (aps.length === 0) {
    container.innerHTML = `
      <div class="border border-dashed border-slate-300 rounded-xl p-6 text-center bg-white space-y-1">
        <div class="text-sm font-bold text-slate-700">ไม่มีอุปกรณ์ Access Point ในวงจรนี้</div>
        <div class="text-xs text-slate-500">กดปุ่ม "+ ห้อง..." ด้านบนเพื่อเพิ่มห้องตามหน้างานจริง</div>
      </div>
    `;
    updateHandoverPaperCheatSheet();
    return;
  }

  container.innerHTML = aps.map((ap, idx) => {
    const models = AP_MODEL_PRESETS[ap.brand] || ['A3002RU', 'Archer C6', 'DIR-825'];
    const spec = detectRoomSpec(ap.room);
    const snCmp = compareSnStringsClient(ap.serial_no, ap.ocr_serial_no);
    const roomPhotoCount = (ap.photo_device ? 1 : 0) + (ap.photo_wifi ? 1 : 0) + (ap.photo_lan ? 1 : 0);

    return `
      <div id="c1_apCard_${idx}" class="${apCardClass(idx)} rounded-xl p-4 space-y-3 transition overflow-hidden" style="${apCardStyle(0, idx)}">
        ${apTopBarHtml(0, idx, 16)}
        <!-- AP Header -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-2.5 gap-2">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="px-2.5 py-1 rounded-md text-xs font-bold" style="${apPillStyle(0, idx)}">
              AP #${idx + 1}: ${ap.room || spec.fullLabel}
            </span>
            <span class="text-xs text-slate-500">
              SSID: <strong class="text-slate-700">${spec.ssid}</strong> • LAN ≥ ${spec.lanMinDl}/${spec.lanMinUl}M • WiFi ≥ ${spec.wifiMinDl}/${spec.wifiMinUl}M
            </span>
            <span class="text-[11px] font-semibold px-2 py-0.5 rounded ${roomPhotoCount >= 3 && ap.serial_no ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-600'}">
              รูป ${roomPhotoCount}/3
            </span>
          </div>
          <div class="flex items-center gap-1.5 flex-wrap">
            <div class="flex items-center gap-1 mr-1">
              ${['DLS', 'GPS', 'VICC', 'GECC'].map(code => `
                <button type="button" onclick="setApRoomQuick(${idx}, '${code}')" class="px-2 py-0.5 rounded border text-[11px] font-semibold ${spec.code === code ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}">${code}</button>
              `).join('')}
            </div>
            <button type="button" onclick="resetApForNewDevice(${idx})" class="px-2 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-[11px] font-medium">
              ล้าง S/N
            </button>
            <button type="button" onclick="removeAccessPointSlot(${idx})" class="px-2 py-1 rounded border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-[11px] font-medium">
              ลบห้อง
            </button>
          </div>
        </div>

        <!-- Checklist (1 line + GECC Authen note if GECC) -->
        <div class="flex flex-wrap items-center gap-4 text-xs text-slate-700 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200/80">
          <label class="flex items-center gap-1.5 cursor-pointer">
            <input id="apChkSticker_${idx}" type="checkbox" ${ap.sticker_done ? 'checked' : ''} onchange="syncApInputsFromDom()" class="rounded border-slate-300" />
            <span>ติด Sticker ใหม่และถ่ายรูปเห็นชัดเจน</span>
          </label>
          ${spec.isGecc ? `
            <label class="flex items-center gap-1.5 cursor-pointer text-amber-900 font-semibold">
              <input id="apGeccAuthen_${idx}" type="checkbox" ${ap.gecc_authen_wifi ? 'checked' : ''} onchange="syncApInputsFromDom()" class="rounded border-amber-400" />
              <span>ห้อง GECC: ลงทะเบียนใช้งานระบบ Authen ก่อนต่อ LAN / WiFi แล้ว</span>
            </label>
          ` : ''}
        </div>

        <!-- Brand & Model & Room & Floor -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
          <div>
            <label class="block text-[11px] font-semibold text-slate-600 mb-1">ยี่ห้อ AP</label>
            <select id="apBrand_${idx}" onchange="setApBrand(${idx}, this.value)" class="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold bg-white">
              <option value="TOTOLINK" ${ap.brand === 'TOTOLINK' ? 'selected' : ''}>TOTOLINK</option>
              <option value="D-LINK" ${ap.brand === 'D-LINK' ? 'selected' : ''}>D-LINK</option>
              <option value="TP-LINK" ${ap.brand === 'TP-LINK' ? 'selected' : ''}>TP-LINK</option>
              <option value="อื่นๆ" ${!['TOTOLINK', 'D-LINK', 'TP-LINK'].includes(ap.brand) ? 'selected' : ''}>อื่นๆ</option>
            </select>
          </div>
          <div>
            <label class="block text-[11px] font-semibold text-slate-600 mb-1">รุ่น (Model)</label>
            <input id="apModel_${idx}" list="apModelsList_${idx}" oninput="onApSpeedOrStickerInput(${idx})" type="text" value="${ap.model || ''}" placeholder="เช่น A3002RU" class="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white" />
            <datalist id="apModelsList_${idx}">
              ${models.map(m => `<option value="${m}">`).join('')}
            </datalist>
          </div>
          <div>
            <label class="block text-[11px] font-semibold text-slate-600 mb-1">เลขครุภัณฑ์</label>
            <input id="apAsset_${idx}" oninput="onApSpeedOrStickerInput(${idx})" type="text" value="${displayApAssetNo(ap.asset_no)}" placeholder="-" class="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white" />
          </div>
          <div>
            <label class="block text-[11px] font-semibold text-slate-600 mb-1">ชื่อห้อง</label>
            <input id="apRoom_${idx}" oninput="onApSpeedOrStickerInput(${idx})" type="text" value="${ap.room || ''}" placeholder="เช่น ห้อง GPS" class="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white font-semibold" />
          </div>
          <div class="grid grid-cols-2 gap-1.5">
            <div>
              <label class="block text-[11px] font-semibold text-slate-600 mb-1">ชั้น</label>
              <input id="apFloor_${idx}" oninput="onApSpeedOrStickerInput(${idx})" type="text" value="${ap.floor || '1'}" class="w-full px-2 py-1.5 rounded-lg border border-slate-300 text-xs text-center bg-white" />
            </div>
            <div>
              <label class="block text-[11px] font-semibold text-slate-600 mb-1">อาคาร</label>
              <input id="apBuilding_${idx}" oninput="onApSpeedOrStickerInput(${idx})" type="text" value="${ap.building || '1'}" class="w-full px-2 py-1.5 rounded-lg border border-slate-300 text-xs text-center bg-white" />
            </div>
          </div>
        </div>

        <!-- AP S/N Row -->
        <div class="bg-slate-50 rounded-lg p-3 border border-slate-200 space-y-2">
          <div class="flex items-center justify-between flex-wrap gap-2">
            <span class="text-xs font-bold text-slate-700">Serial No. (S/N)</span>
            <span id="apSnRecheckBadge_${idx}" class="px-2 py-0.5 rounded text-[11px] font-semibold ${snCmp.cls}">${snCmp.label}</span>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input id="apSn_${idx}" oninput="onApSpeedOrStickerInput(${idx})" type="text" value="${ap.serial_no || ''}" placeholder="รหัส S/N อุปกรณ์ AP" class="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-mono uppercase bg-white font-bold" />
            <div class="flex gap-1.5">
              <input id="apOcrSn_${idx}" oninput="onApSpeedOrStickerInput(${idx})" type="text" value="${ap.ocr_serial_no || ''}" placeholder="ค่า S/N จาก OCR" class="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-mono uppercase text-slate-600" />
              <button type="button" onclick="openSnScanner('ap_${idx}')" class="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold shrink-0">
                สแกน S/N
              </button>
              <button type="button" onclick="copyApOcrToManual(${idx})" class="px-2 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold shrink-0">
                ใช้ค่านี้
              </button>
            </div>
          </div>
          <div id="apSnCandidates_${idx}" class="flex items-center gap-1 flex-wrap text-[11px]"></div>
          <div id="apStickerPreview_${idx}" class="text-[11px] text-slate-500 font-mono pt-1 border-t border-slate-200/70">
            ข้อความ Sticker: <strong>${so}</strong> | <strong>${displayApAssetNo(ap.asset_no)}</strong> | <strong>${ap.brand || ''} ${ap.model || ''}</strong> | SN: <strong>${ap.serial_no || '-'}</strong>
          </div>
        </div>

        <!-- AP Speed Tests (WiFi & LAN) -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <div class="p-2.5 rounded-lg border border-slate-200 bg-slate-50/50">
            <div class="flex items-center justify-between gap-1 flex-wrap mb-1.5">
              <span class="text-xs font-semibold text-slate-700">ผลทดสอบ WiFi (≥ ${spec.wifiMinDl}/${spec.wifiMinUl}M)</span>
              <div class="flex items-center gap-1">
                <button type="button" onclick="openSpeedtestGenerator(0, 'ap${idx + 1}_wifi', 'wifi')" class="px-2 py-0.5 rounded bg-cyan-50 hover:bg-cyan-100 text-cyan-800 border border-cyan-300 text-[11px] font-semibold">⚡ สร้างภาพ</button>
                <span id="apWifiBadge_${idx}">${validateApSpeedBadge(ap.speed_wifi_dl, ap.speed_wifi_ul, spec.wifiMinDl, spec.wifiMinUl)}</span>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <input id="apWifiDl_${idx}" oninput="onApSpeedOrStickerInput(${idx})" type="text" value="${ap.speed_wifi_dl || ''}" placeholder="Download (Mbps)" class="px-2.5 py-1.5 rounded border border-slate-300 text-xs bg-white" />
              <input id="apWifiUl_${idx}" oninput="onApSpeedOrStickerInput(${idx})" type="text" value="${ap.speed_wifi_ul || ''}" placeholder="Upload (Mbps)" class="px-2.5 py-1.5 rounded border border-slate-300 text-xs bg-white" />
            </div>
          </div>
          <div class="p-2.5 rounded-lg border border-slate-200 bg-slate-50/50">
            <div class="flex items-center justify-between gap-1 flex-wrap mb-1.5">
              <span class="text-xs font-semibold text-slate-700">ผลทดสอบ Port LAN (≥ ${spec.lanMinDl}/${spec.lanMinUl}M)</span>
              <div class="flex items-center gap-1">
                <button type="button" onclick="openSpeedtestGenerator(0, 'ap${idx + 1}_lan', '${spec.lanMinDl >= 350 ? 'gps_lan' : 'dls_lan'}')" class="px-2 py-0.5 rounded bg-cyan-50 hover:bg-cyan-100 text-cyan-800 border border-cyan-300 text-[11px] font-semibold">⚡ สร้างภาพ</button>
                <span id="apLanBadge_${idx}">${validateApSpeedBadge(ap.speed_lan_dl, ap.speed_lan_ul, spec.lanMinDl, spec.lanMinUl)}</span>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <input id="apLanDl_${idx}" oninput="onApSpeedOrStickerInput(${idx})" type="text" value="${ap.speed_lan_dl || ''}" placeholder="Download (Mbps)" class="px-2.5 py-1.5 rounded border border-slate-300 text-xs bg-white" />
              <input id="apLanUl_${idx}" oninput="onApSpeedOrStickerInput(${idx})" type="text" value="${ap.speed_lan_ul || ''}" placeholder="Upload (Mbps)" class="px-2.5 py-1.5 rounded border border-slate-300 text-xs bg-white" />
            </div>
          </div>
        </div>
        <div>
          <input id="apSpeedNote_${idx}" type="text" value="${ap.speed_note || ''}" oninput="syncApInputsFromDom()" placeholder="หมายเหตุความเร็ว (ถ้ามี เช่น ห้อง DLS ติดสอบ)..." class="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs bg-slate-50" />
        </div>

        <!-- AP 3 Photo Upload Slots -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div id="slotApDevice_${idx}" class="border border-dashed border-slate-300 rounded-lg p-2.5 text-center bg-slate-50/50"></div>
          <div id="slotApWifi_${idx}" class="border border-dashed border-slate-300 rounded-lg p-2.5 text-center bg-slate-50/50"></div>
          <div id="slotApLan_${idx}" class="border border-dashed border-slate-300 rounded-lg p-2.5 text-center bg-slate-50/50"></div>
        </div>
      </div>
    `;
  }).join('');

  // Render photo uploaders for each AP
  aps.forEach((ap, idx) => {
    const spec = detectRoomSpec(ap.room);
    renderPhotoSlot(`slotApDevice_${idx}`, `ap${idx + 1}_device`, `1) รูปอุปกรณ์ AP + Sticker (${ap.room || spec.code})`, ap.photo_device, url => {
      currentCircuit.access_points[idx].photo_device = url;
      renderModalCompletenessBar();
    });
    renderPhotoSlot(`slotApWifi_${idx}`, `ap${idx + 1}_wifi`, `2) รูปผลทดสอบ WiFi (${spec.ssid})`, ap.photo_wifi, url => {
      currentCircuit.access_points[idx].photo_wifi = url;
      renderModalCompletenessBar();
    });
    renderPhotoSlot(`slotApLan_${idx}`, `ap${idx + 1}_lan`, `3) รูปผลทดสอบ Port LAN (${spec.code})`, ap.photo_lan, url => {
      currentCircuit.access_points[idx].photo_lan = url;
      renderModalCompletenessBar();
    });
  });

  updateHandoverPaperCheatSheet();
}

// ============================================================================
// Photo Upload Helper (with Auto S/N OCR on Device Sticker Photos!)
// Supports both Primary Circuit (cIdx=0) and Additional Site Circuits (cIdx>=1)
// ============================================================================
function renderPhotoSlot(containerId, slotKey, label, currentUrl, onUploaded, customSoNumber = null, customSnTarget = null) {
  const el = document.getElementById(containerId);
  if (!el) return;

  const isDeviceStickerSlot = slotKey === 'router_device' || /^ap\d+_device$/.test(slotKey);
  const isHandoverSlot = slotKey === 'handover_page1' || slotKey === 'handover_page2';
  const snTarget = customSnTarget || (
    slotKey === 'router_device'
      ? 'router'
      : /^ap(\d+)_device$/.test(slotKey)
        ? `ap_${Number(slotKey.match(/^ap(\d+)_device$/)[1]) - 1}`
        : null
  );

  const inputId = `fileInput_${containerId}`;
  const acceptTypes = isHandoverSlot ? 'image/*,application/pdf' : 'image/*';
  el.innerHTML = `
    <div class="text-xs font-semibold text-slate-700 mb-1.5">${label}</div>
    ${currentUrl ? `
      <div class="relative group mb-2">
        <img src="${currentUrl}" class="w-full h-32 object-cover rounded-lg border border-slate-200 mx-auto" />
        <div class="flex items-center justify-center gap-3 mt-1.5">
          ${isDeviceStickerSlot ? `
            <button type="button" onclick="readSnFromExistingPhoto('${currentUrl}', '${snTarget}')" class="text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold px-2 py-0.5 rounded border border-slate-300">
              อ่าน S/N
            </button>
          ` : ''}
          <button type="button" id="removeBtn_${containerId}" class="text-[11px] text-rose-600 hover:underline font-medium">ลบรูป</button>
        </div>
      </div>
    ` : `
      <div class="h-24 flex flex-col items-center justify-center text-slate-400 text-[11px] bg-white rounded-lg mb-2 border border-slate-200 px-2">
        <span>ยังไม่มีรูปภาพ</span>
      </div>
    `}
    <label for="${inputId}" class="cursor-pointer inline-block w-full py-1.5 px-2.5 rounded-lg bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs border border-slate-300 transition">
      ${currentUrl ? 'เปลี่ยนรูป / อัปโหลดใหม่' : (isHandoverSlot ? 'เลือกไฟล์สแกน / รูปภาพ' : 'ถ่ายรูป / เลือกรูปภาพ')}
    </label>
    <input id="${inputId}" type="file" accept="${acceptTypes}" class="hidden" />
  `;

  const fileInput = document.getElementById(inputId);
  fileInput.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file || !currentCircuit) return;
    const targetSo = customSoNumber || currentCircuit.so_number;
    try {
      showToast(`กำลังอัปโหลด (${targetSo})...`);
      let compressedDataUrl = '';
      if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')) {
        const preferredPage = slotKey === 'handover_page2' ? 2 : 1;
        compressedDataUrl = await renderPdfPageToDataUrl(file, preferredPage);
      } else {
        compressedDataUrl = await compressImageFile(file, 1400, 0.85);
      }
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          circuitId: targetSo,
          so_number: targetSo,
          slot: slotKey,
          category: slotKey,
          dataUrl: compressedDataUrl,
          data_url: compressedDataUrl
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      onUploaded(data.url);
      renderPhotoSlot(containerId, slotKey, label, data.url, onUploaded, customSoNumber, customSnTarget);
      renderModalCompletenessBar();

      if (isDeviceStickerSlot && snTarget) {
        showToast('กำลังอ่านรหัส S/N จากรูปถ่าย...');
        await autoExtractSnToField(compressedDataUrl, snTarget);
      } else {
        showToast('อัปโหลดเรียบร้อยแล้ว');
      }
      scheduleAutoSaveDraft('อัปโหลดรูปภาพ', true);
    } catch (err) {
      showToast('อัปโหลดไม่สำเร็จ: ' + err.message, true);
    }
  });

  const removeBtn = document.getElementById(`removeBtn_${containerId}`);
  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      onUploaded('');
      renderPhotoSlot(containerId, slotKey, label, '', onUploaded, customSoNumber, customSnTarget);
      renderModalCompletenessBar();
      scheduleAutoSaveDraft('ลบรูปภาพ', true);
    });
  }
}

function compressImageFile(file, maxWidth = 1280, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        if (w > maxWidth) {
          h = Math.round((h * maxWidth) / w);
          w = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = ev.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ============================================================================
// Multi-Circuit Site & Same Rack Cabinet Workspace Functions (วงจรที่ 2, 3...)
// ============================================================================
function scrollToSiteCircuitCard(cIdx) {
  if (cIdx === 0) {
    const el = document.getElementById('modalSectionStep1');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const targetId = currentModalStep === 'step23'
    ? `siteCircuitApsCard_${cIdx}`
    : currentModalStep === 'step4'
      ? `siteCircuitHandoverCard_${cIdx}`
      : `siteCircuitRouterCard_${cIdx}`;
  const el = document.getElementById(targetId) || document.getElementById(`siteCircuitRouterCard_${cIdx}`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.add('ring-4', 'ring-amber-400');
    setTimeout(() => el.classList.remove('ring-4', 'ring-amber-400'), 1800);
  }
}

function syncRackLocationAcrossSite() {
  syncApInputsFromDom();
  syncAdditionalSiteCircuitsFromDom();
  const room = document.getElementById('rRoom')?.value.trim() || 'วิชาการ';
  const floor = document.getElementById('rFloor')?.value.trim() || '1';
  const building = document.getElementById('rBuilding')?.value.trim() || '1';

  if (!Array.isArray(currentSiteCircuits) || currentSiteCircuits.length <= 1) {
    showToast(`บันทึกตำแหน่งตู้ Rack: ห้อง${room} ชั้น ${floor} อาคาร ${building} แล้ว`);
    return;
  }

  for (let i = 1; i < currentSiteCircuits.length; i++) {
    const sc = currentSiteCircuits[i];
    if (!sc.router_info) sc.router_info = {};
    sc.router_info.room = room;
    sc.router_info.floor = floor;
    sc.router_info.building = building;
  }
  renderAdditionalSiteCircuitsInModal();
  showToast(`📌 ซิงค์ตำแหน่งตู้ Rack (ห้อง${room} ชั้น ${floor} อาคาร ${building}) ให้ครบทั้ง ${currentSiteCircuits.length} วงจรใน Site นี้แล้ว!`);
}

function syncAdditionalSiteCircuitsFromDom() {
  if (!Array.isArray(currentSiteCircuits) || currentSiteCircuits.length <= 1) return;
  for (let cIdx = 1; cIdx < currentSiteCircuits.length; cIdx++) {
    const sc = currentSiteCircuits[cIdx];
    if (!sc) continue;
    if (!sc.router_info) sc.router_info = {};
    const rt = sc.router_info;

    const svcEl = document.getElementById(`sc_${cIdx}_serviceNo`);
    if (svcEl) sc.service_no = svcEl.value.trim();
    const pkgEl = document.getElementById(`sc_${cIdx}_speedPkg`);
    if (pkgEl) sc.speed_pkg = pkgEl.value.trim();

    const chkSticker = document.getElementById(`sc_${cIdx}_chkSticker`);
    if (chkSticker) rt.sticker_done = chkSticker.checked;
    const chkSpeed = document.getElementById(`sc_${cIdx}_chkSpeed`);
    if (chkSpeed) rt.speed_tested = chkSpeed.checked;

    const modelEl = document.getElementById(`sc_${cIdx}_rModel`);
    if (modelEl) rt.model = modelEl.value.trim() || 'RB3011';
    const snEl = document.getElementById(`sc_${cIdx}_rSn`);
    if (snEl) rt.serial_no = snEl.value.trim().toUpperCase();
    const ocrEl = document.getElementById(`sc_${cIdx}_rOcrSn`);
    if (ocrEl) rt.ocr_serial_no = ocrEl.value.trim().toUpperCase();
    const assetEl = document.getElementById(`sc_${cIdx}_rAsset`);
    if (assetEl) rt.asset_no = assetEl.value.trim();
    const roomEl = document.getElementById(`sc_${cIdx}_rRoom`);
    if (roomEl) rt.room = roomEl.value.trim();
    const floorEl = document.getElementById(`sc_${cIdx}_rFloor`);
    if (floorEl) rt.floor = floorEl.value.trim();
    const bldEl = document.getElementById(`sc_${cIdx}_rBuilding`);
    if (bldEl) rt.building = bldEl.value.trim();

    const l2d = document.getElementById(`sc_${cIdx}_lan2Dl`);
    if (l2d) rt.speed_lan2_dl = l2d.value.trim();
    const l2u = document.getElementById(`sc_${cIdx}_lan2Ul`);
    if (l2u) rt.speed_lan2_ul = l2u.value.trim();
    const l3d = document.getElementById(`sc_${cIdx}_lan3Dl`);
    if (l3d) rt.speed_lan3_dl = l3d.value.trim();
    const l3u = document.getElementById(`sc_${cIdx}_lan3Ul`);
    if (l3u) rt.speed_lan3_ul = l3u.value.trim();

    const chkDoc1 = document.getElementById(`sc_${cIdx}_chkDocFilled`);
    if (chkDoc1) rt.doc_filled = chkDoc1.checked;
    const chkDoc2 = document.getElementById(`sc_${cIdx}_chkDocStamped`);
    if (chkDoc2) rt.doc_stamped = chkDoc2.checked;

    const remEl = document.getElementById(`sc_${cIdx}_remarks`);
    if (remEl) sc.remarks = remEl.value.trim();

    // Sync APs of this additional circuit
    if (Array.isArray(sc.access_points)) {
      sc.access_points.forEach((ap, apIdx) => {
        const bEl = document.getElementById(`sc_${cIdx}_apBrand_${apIdx}`);
        if (!bEl) return;
        ap.brand = bEl.value;
        ap.model = (document.getElementById(`sc_${cIdx}_apModel_${apIdx}`)?.value || '').trim();
        ap.serial_no = (document.getElementById(`sc_${cIdx}_apSn_${apIdx}`)?.value || '').trim().toUpperCase();
        ap.ocr_serial_no = (document.getElementById(`sc_${cIdx}_apOcrSn_${apIdx}`)?.value || '').trim().toUpperCase();
        ap.asset_no = (document.getElementById(`sc_${cIdx}_apAsset_${apIdx}`)?.value || '').trim();
        ap.room = (document.getElementById(`sc_${cIdx}_apRoom_${apIdx}`)?.value || '').trim();
        ap.floor = (document.getElementById(`sc_${cIdx}_apFloor_${apIdx}`)?.value || '').trim();
        ap.building = (document.getElementById(`sc_${cIdx}_apBuilding_${apIdx}`)?.value || '').trim();
        ap.speed_wifi_dl = (document.getElementById(`sc_${cIdx}_apWifiDl_${apIdx}`)?.value || '').trim();
        ap.speed_wifi_ul = (document.getElementById(`sc_${cIdx}_apWifiUl_${apIdx}`)?.value || '').trim();
        ap.speed_lan_dl = (document.getElementById(`sc_${cIdx}_apLanDl_${apIdx}`)?.value || '').trim();
        ap.speed_lan_ul = (document.getElementById(`sc_${cIdx}_apLanUl_${apIdx}`)?.value || '').trim();
        ap.speed_note = (document.getElementById(`sc_${cIdx}_apNote_${apIdx}`)?.value || '').trim();

        const cSt = document.getElementById(`sc_${cIdx}_apChkSticker_${apIdx}`);
        if (cSt) ap.sticker_done = cSt.checked;
        const cWl = document.getElementById(`sc_${cIdx}_apGeccWanToLan_${apIdx}`);
        if (cWl) ap.gecc_wan_to_lan = cWl.checked;
        const cRm = document.getElementById(`sc_${cIdx}_apGeccRemoteDone_${apIdx}`);
        if (cRm) ap.gecc_remote_done = cRm.checked;
        const cAd = document.getElementById(`sc_${cIdx}_apGeccAnydesk_${apIdx}`);
        if (cAd) ap.gecc_anydesk_id = cAd.value.trim();
        const cAu = document.getElementById(`sc_${cIdx}_apGeccAuthen_${apIdx}`);
        if (cAu) ap.gecc_authen_wifi = cAu.checked;
      });
    }
  }
}

function onAdditionalCircuitInput(cIdx) {
  syncAdditionalSiteCircuitsFromDom();
  const sc = currentSiteCircuits[cIdx];
  if (!sc) return;
  const rt = sc.router_info || {};

  // Update Router Sticker Preview
  const stEl = document.getElementById(`sc_${cIdx}_routerStickerPreview`);
  if (stEl) {
    stEl.innerHTML = `เลขที่วงจร: <strong>${sc.so_number}</strong> | เลขครุภัณฑ์: <strong>${rt.asset_no || '-'}</strong> | ยี่ห้อ/รุ่น: <strong>MikroTik ${rt.model || 'RB3011'}</strong> | SN: <strong>${rt.serial_no || '-'}</strong>`;
  }

  // Update Router S/N Recheck Badge
  const snBadge = document.getElementById(`sc_${cIdx}_rSnBadge`);
  if (snBadge) {
    const cmp = compareSnStringsClient(rt.serial_no, rt.ocr_serial_no);
    snBadge.className = `px-2.5 py-0.5 rounded-full text-[11px] font-bold ${cmp.cls}`;
    snBadge.textContent = cmp.label;
  }

  // Update Router Port 2 & Port 3 speed badges
  const p2Badge = document.getElementById(`sc_${cIdx}_lan2Badge`);
  if (p2Badge) p2Badge.innerHTML = validateApSpeedBadge(rt.speed_lan2_dl, rt.speed_lan2_ul, 650, 350);
  const p3Badge = document.getElementById(`sc_${cIdx}_lan3Badge`);
  if (p3Badge) p3Badge.innerHTML = validateApSpeedBadge(rt.speed_lan3_dl, rt.speed_lan3_ul, 650, 350);

  // Update AP badges & sticker previews
  (sc.access_points || []).forEach((ap, apIdx) => {
    const spec = detectRoomSpec(ap.room);
    const apSt = document.getElementById(`sc_${cIdx}_apSticker_${apIdx}`);
    if (apSt) {
      apSt.innerHTML = `เลขที่วงจร: <strong>${sc.so_number}</strong> | เลขครุภัณฑ์: <strong>${displayApAssetNo(ap.asset_no)}</strong> | ยี่ห้อ/รุ่น: <strong>${ap.brand || ''} ${ap.model || ''}</strong> | SN: <strong>${ap.serial_no || '-'}</strong>`;
    }
    const apSnB = document.getElementById(`sc_${cIdx}_apSnBadge_${apIdx}`);
    if (apSnB) {
      const cmp = compareSnStringsClient(ap.serial_no, ap.ocr_serial_no);
      apSnB.className = `px-2.5 py-0.5 rounded-full text-[11px] font-bold ${cmp.cls}`;
      apSnB.textContent = cmp.label;
    }
    const wB = document.getElementById(`sc_${cIdx}_apWifiBadge_${apIdx}`);
    if (wB) wB.innerHTML = validateApSpeedBadge(ap.speed_wifi_dl, ap.speed_wifi_ul, spec.wifiMinDl, spec.wifiMinUl);
    const lB = document.getElementById(`sc_${cIdx}_apLanBadge_${apIdx}`);
    if (lB) lB.innerHTML = validateApSpeedBadge(ap.speed_lan_dl, ap.speed_lan_ul, spec.lanMinDl, spec.lanMinUl);
  });

  // Update unified Site Handover Cheat Sheet (รวมทุกวงจรในใบเดียว)
  updateHandoverPaperCheatSheet();
  renderModalCompletenessBar();
}

function buildCircuitCheatSheetHtml(sc) {
  const rt = sc.router_info || {};
  const aps = Array.isArray(sc.access_points) ? sc.access_points : [];
  const apLines = aps.length > 0
    ? aps.map((ap, i) => `
        <div class="pl-2 border-l-2 border-emerald-400">
          • <strong>Access Point ตัวที่ ${i + 1}:</strong> ยี่ห้อ <strong>${ap.brand || '-'}</strong> รุ่น <strong>${ap.model || '-'}</strong> | ครุภัณฑ์: <strong>${displayApAssetNo(ap.asset_no)}</strong> | S/N: <strong class="text-indigo-700">${ap.serial_no || '(ยังไม่ระบุ)'}</strong> | ห้อง <strong>${ap.room || '-'}</strong> ชั้น <strong>${ap.floor || '1'}</strong> อาคาร <strong>${ap.building || '1'}</strong>
        </div>
      `).join('')
    : `<div class="pl-2 text-rose-600 font-bold">• ไม่มีอุปกรณ์ Access Point ในวงจรนี้ (ยุบห้องแล้ว)</div>`;

  return `
    <div>📍 <strong>สถานที่ติดตั้ง:</strong> ${sc.branch_name || '-'} | <strong>พิกัด:</strong> ${sc.lat_long || currentCircuit?.lat_long || '-'}</div>
    <div>🔌 <strong>หมายเลข S/O:</strong> <span class="text-rose-700 font-bold">${sc.so_number}</span> | <strong>Service No:</strong> ${sc.service_no || '-'} | <strong>ความเร็ว:</strong> ${sc.speed_pkg || '1000Mbps/500Mbps'}</div>
    <div class="pl-2 border-l-2 border-indigo-400">
      • <strong>Router (MikroTik):</strong> รุ่น <strong>${rt.model || 'RB3011'}</strong> | ครุภัณฑ์: <strong>${displayRouterAssetNo(rt.asset_no)}</strong> | S/N: <strong class="text-indigo-700">${rt.serial_no || '-'}</strong> | ห้อง <strong>${rt.room || '-'}</strong> ชั้น <strong>${rt.floor || '1'}</strong> อาคาร <strong>${rt.building || '1'}</strong>
    </div>
    ${apLines}
  `;
}

function setSiteCircuitRouterModel(cIdx, modelVal) {
  syncAdditionalSiteCircuitsFromDom();
  const el = document.getElementById(`sc_${cIdx}_rModel`);
  if (el) el.value = modelVal;
  onAdditionalCircuitInput(cIdx);
}

function copySiteCircuitRouterOcr(cIdx) {
  const ocrVal = (document.getElementById(`sc_${cIdx}_rOcrSn`)?.value || '').trim().toUpperCase();
  if (!ocrVal) {
    showToast('ยังไม่มีค่า S/N จาก OCR กรุณาถ่ายรูปหรือกดสแกน OCR ก่อน', true);
    return;
  }
  const mEl = document.getElementById(`sc_${cIdx}_rSn`);
  if (mEl) {
    mEl.value = ocrVal;
    onAdditionalCircuitInput(cIdx);
    showToast(`คัดลอกค่า OCR (${ocrVal}) ไปยังช่อง S/N ช่างกรอกของวงจรที่ ${cIdx + 1} แล้ว ✅`);
  }
}

function copySiteCircuitApOcr(cIdx, apIdx) {
  const ocrVal = (document.getElementById(`sc_${cIdx}_apOcrSn_${apIdx}`)?.value || '').trim().toUpperCase();
  if (!ocrVal) {
    showToast('ยังไม่มีค่า S/N จาก OCR สำหรับ AP จุดนี้', true);
    return;
  }
  const mEl = document.getElementById(`sc_${cIdx}_apSn_${apIdx}`);
  if (mEl) {
    mEl.value = ocrVal;
    onAdditionalCircuitInput(cIdx);
    showToast(`ยืนยัน S/N ของ AP ตัวที่ ${apIdx + 1} (วงจรที่ ${cIdx + 1}) ตรงกับ OCR แล้ว ✅`);
  }
}

function addSiteCircuitApByRoom(cIdx, roomTypeCode) {
  syncAdditionalSiteCircuitsFromDom();
  const sc = currentSiteCircuits[cIdx];
  if (!sc) return;
  if (!Array.isArray(sc.access_points)) sc.access_points = [];
  const nextNo = sc.access_points.length + 1;
  const spec = ROOM_SPECS[roomTypeCode] || ROOM_SPECS.GPS;
  sc.access_points.push(createDefaultAp(nextNo, sc.province, spec.shortRoom));
  renderAdditionalSiteCircuitsInModal();
  renderModalCompletenessBar();
  showToast(`➕ เพิ่ม ${spec.fullLabel} ในวงจรที่ ${cIdx + 1} (${sc.so_number}) เรียบร้อยแล้ว`);
}

function addSiteCircuitCustomAp(cIdx) {
  syncAdditionalSiteCircuitsFromDom();
  const sc = currentSiteCircuits[cIdx];
  if (!sc) return;
  const customRoom = prompt(`ระบุชื่อห้องที่เพิ่มใหม่ในวงจรที่ ${cIdx + 1} (${sc.so_number}):`, 'ห้องอบรม DLS 2');
  if (!customRoom || !customRoom.trim()) return;
  if (!Array.isArray(sc.access_points)) sc.access_points = [];
  const nextNo = sc.access_points.length + 1;
  sc.access_points.push(createDefaultAp(nextNo, sc.province, customRoom.trim()));
  renderAdditionalSiteCircuitsInModal();
  renderModalCompletenessBar();
  showToast(`➕ เพิ่มห้อง "${customRoom.trim()}" ในวงจรที่ ${cIdx + 1} (${sc.so_number}) เรียบร้อยแล้ว`);
}

function removeSiteCircuitAp(cIdx, apIdx) {
  syncAdditionalSiteCircuitsFromDom();
  const sc = currentSiteCircuits[cIdx];
  if (!sc || !Array.isArray(sc.access_points)) return;
  const targetAp = sc.access_points[apIdx];
  if (!confirm(`ยืนยันการยุบห้อง / ลบ AP ตัวที่ ${apIdx + 1} (${targetAp?.room || ''}) ออกจากวงจรที่ ${cIdx + 1} (${sc.so_number}) หรือไม่?`)) return;
  sc.access_points.splice(apIdx, 1);
  sc.access_points.forEach((a, i) => { a.ap_no = i + 1; });
  renderAdditionalSiteCircuitsInModal();
  renderModalCompletenessBar();
  showToast(`🗑️ ยุบห้อง / ลบ AP ออกจากวงจรที่ ${cIdx + 1} (${sc.so_number}) เรียบร้อยแล้ว`);
}

function setSiteCircuitApRoomQuick(cIdx, apIdx, roomCode) {
  syncAdditionalSiteCircuitsFromDom();
  const sc = currentSiteCircuits[cIdx];
  if (!sc || !sc.access_points?.[apIdx]) return;
  const spec = ROOM_SPECS[roomCode] || ROOM_SPECS.GPS;
  sc.access_points[apIdx].room = spec.shortRoom;
  sc.access_points[apIdx].room_type = spec.code;
  sc.access_points[apIdx].asset_no = '-';
  renderAdditionalSiteCircuitsInModal();
}

async function handleSiteCircuitScannerUpload(cIdx, inputEl) {
  const files = Array.from(inputEl?.files || []);
  if (!files.length) return;
  const sc = currentSiteCircuits[cIdx];
  if (!sc) return;
  if (!sc.router_info) sc.router_info = {};

  try {
    showToast(`🖨️ กำลังแยกหน้าไฟล์สแกนใบส่งมอบงานของวงจรที่ ${cIdx + 1} (${sc.so_number})...`);
    let page1DataUrl = '';
    let page2DataUrl = '';

    const firstFile = files[0];
    const isPdf = firstFile.type === 'application/pdf' || /\.pdf$/i.test(firstFile.name || '');

    if (isPdf) {
      page1DataUrl = await renderPdfPageToDataUrl(firstFile, 1);
      const ab = await firstFile.arrayBuffer();
      const pdfDoc = await window.pdfjsLib.getDocument({ data: ab }).promise;
      if (pdfDoc.numPages >= 2) {
        page2DataUrl = await renderPdfPageToDataUrl(firstFile, 2);
      } else if (files.length >= 2) {
        const secondFile = files[1];
        const isSecondPdf = secondFile.type === 'application/pdf' || /\.pdf$/i.test(secondFile.name || '');
        page2DataUrl = isSecondPdf
          ? await renderPdfPageToDataUrl(secondFile, 1)
          : await compressImageFile(secondFile, 1400, 0.85);
      }
    } else {
      page1DataUrl = await compressImageFile(firstFile, 1400, 0.85);
      if (files.length >= 2) {
        const secondFile = files[1];
        const isSecondPdf = secondFile.type === 'application/pdf' || /\.pdf$/i.test(secondFile.name || '');
        page2DataUrl = isSecondPdf
          ? await renderPdfPageToDataUrl(secondFile, 1)
          : await compressImageFile(secondFile, 1400, 0.85);
      }
    }

    if (page1DataUrl) {
      const res1 = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          circuitId: sc.so_number,
          so_number: sc.so_number,
          slot: 'handover_page1',
          category: 'handover_page1',
          dataUrl: page1DataUrl,
          data_url: page1DataUrl
        })
      });
      const d1 = await res1.json();
      if (!res1.ok) throw new Error(d1.error || 'อัปโหลดหน้าที่ 1 ไม่สำเร็จ');
      sc.router_info.photo_handover_p1 = d1.url;
      sc.router_info.photo_signed_doc = d1.url;
      sc.router_info.doc_filled = true;
    }

    if (page2DataUrl) {
      const res2 = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          circuitId: sc.so_number,
          so_number: sc.so_number,
          slot: 'handover_page2',
          category: 'handover_page2',
          dataUrl: page2DataUrl,
          data_url: page2DataUrl
        })
      });
      const d2 = await res2.json();
      if (!res2.ok) throw new Error(d2.error || 'อัปโหลดหน้าที่ 2 ไม่สำเร็จ');
      sc.router_info.photo_handover_p2 = d2.url;
      sc.router_info.doc_stamped = true;
    }

    renderAdditionalSiteCircuitsInModal();
    renderModalCompletenessBar();
    await saveCurrentInspection(true);
    showToast(`✅ อัปโหลดไฟล์สแกนใบส่งมอบงานของวงจรที่ ${cIdx + 1} (${sc.so_number}) สำเร็จ!`);
  } catch (err) {
    showToast('อัปโหลดไฟล์สแกนไม่สำเร็จ: ' + err.message, true);
  } finally {
    inputEl.value = '';
  }
}

function renderAdditionalSiteCircuitsInModal() {
  const routersBox = document.getElementById('additionalSiteRoutersContainer');
  const apsBox = document.getElementById('additionalSiteApsContainer');
  const handoversBox = document.getElementById('additionalSiteHandoversContainer');
  if (!routersBox || !apsBox || !handoversBox) return;

  if (!Array.isArray(currentSiteCircuits) || currentSiteCircuits.length <= 1) {
    routersBox.innerHTML = '';
    apsBox.innerHTML = '';
    handoversBox.innerHTML = '';
    return;
  }

  let routersHtml = '';
  let apsHtml = '';
  let handoversHtml = '';

  for (let cIdx = 1; cIdx < currentSiteCircuits.length; cIdx++) {
    const sc = currentSiteCircuits[cIdx];
    const rt = sc.router_info || {};
    const aps = Array.isArray(sc.access_points) ? sc.access_points : [];
    const snCmp = compareSnStringsClient(rt.serial_no, rt.ocr_serial_no);
    const h1 = Boolean(rt.photo_handover_p1 || rt.photo_signed_doc);
    const h2 = Boolean(rt.photo_handover_p2);

    // 1. Router Card in Step 1 (Same Rack Cabinet)
    routersHtml += `
      <div id="siteCircuitRouterCard_${cIdx}" class="circuit-tint rounded-xl p-4 sm:p-5 space-y-4 shadow-sm transition" style="${circuitFrameStyle(cIdx)}">
        ${circuitLabelHtml(cIdx, `วงจรที่ ${cIdx + 1} · Router (ตู้ Rack) · ${sc.so_number}`)}
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="px-2.5 py-1 rounded-md text-xs font-bold" style="${circuitBadgeStyle(cIdx)}">
              วงจรที่ ${cIdx + 1}: ${sc.so_number}
            </span>
            <span class="text-xs font-medium text-slate-600 font-mono">
              Service No: ${sc.service_no || '-'}
            </span>
          </div>
          <div class="flex items-center gap-1.5 flex-wrap">
            ${sc.legacy_pdf_path ? `<a href="/${encodeURI(sc.legacy_pdf_path)}" target="_blank" class="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 text-xs font-semibold">PDF ปีที่แล้ว (${sc.so_number})</a>` : ''}
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">หมายเลข S/O</label>
            <input type="text" value="${sc.so_number}" readonly class="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-mono font-bold bg-slate-50" />
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">Service No.</label>
            <input id="sc_${cIdx}_serviceNo" type="text" value="${sc.service_no || ''}" oninput="onAdditionalCircuitInput(${cIdx})" class="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-mono font-semibold bg-white" />
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">ความเร็วตามสัญญา</label>
            <input id="sc_${cIdx}_speedPkg" type="text" value="${sc.speed_pkg || '1000Mbps/500Mbps'}" oninput="onAdditionalCircuitInput(${cIdx})" class="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white" />
          </div>
        </div>

        <div class="flex flex-wrap gap-4 text-xs text-slate-700 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200/80">
          <label class="flex items-center gap-1.5 cursor-pointer">
            <input id="sc_${cIdx}_chkSticker" type="checkbox" ${rt.sticker_done ? 'checked' : ''} onchange="onAdditionalCircuitInput(${cIdx})" class="rounded border-slate-300" />
            <span>ติด Sticker ใหม่และถ่ายรูปเห็นชัดเจน</span>
          </label>
          <label class="flex items-center gap-1.5 cursor-pointer">
            <input id="sc_${cIdx}_chkSpeed" type="checkbox" ${rt.speed_tested ? 'checked' : ''} onchange="onAdditionalCircuitInput(${cIdx})" class="rounded border-slate-300" />
            <span>ทดสอบความเร็ว Port 2 และ Port 3 (≥ 650/350 Mbps)</span>
          </label>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">รุ่น Router MikroTik</label>
            <input id="sc_${cIdx}_rModel" type="text" value="${rt.model || 'RB3011'}" oninput="onAdditionalCircuitInput(${cIdx})" placeholder="เช่น RB3011" class="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold bg-white" />
            <div class="flex items-center gap-1 flex-wrap mt-1">
              ${['RB3011', 'RB4011', 'RBD52G (hAP ac2)'].map(m => `
                <button type="button" onclick="setSiteCircuitRouterModel(${cIdx}, '${m}')" class="px-1.5 py-0.5 rounded border text-[10px] font-medium ${rt.model === m ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200'}">${m}</button>
              `).join('')}
            </div>
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">เลขครุภัณฑ์</label>
            <input id="sc_${cIdx}_rAsset" type="text" value="${displayRouterAssetNo(rt.asset_no)}" oninput="onAdditionalCircuitInput(${cIdx})" class="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white" />
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">ห้องที่ติดตั้งอุปกรณ์</label>
            <input id="sc_${cIdx}_rRoom" type="text" value="${rt.room || 'วิชาการ'}" oninput="onAdditionalCircuitInput(${cIdx})" class="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white" />
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block text-xs font-semibold text-slate-600 mb-1">ชั้น</label>
              <input id="sc_${cIdx}_rFloor" type="text" value="${rt.floor || '1'}" oninput="onAdditionalCircuitInput(${cIdx})" class="w-full px-2 py-1.5 rounded-lg border border-slate-300 text-xs text-center bg-white" />
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-600 mb-1">อาคาร</label>
              <input id="sc_${cIdx}_rBuilding" type="text" value="${rt.building || '1'}" oninput="onAdditionalCircuitInput(${cIdx})" class="w-full px-2 py-1.5 rounded-lg border border-slate-300 text-xs text-center bg-white" />
            </div>
          </div>
        </div>

        <div class="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
          <div class="flex items-center justify-between flex-wrap gap-1">
            <span class="text-xs font-bold text-slate-700">Serial No. (S/N) ของ MikroTik</span>
            <span id="sc_${cIdx}_rSnBadge" class="px-2 py-0.5 rounded text-[11px] font-semibold ${snCmp.cls}">${snCmp.label}</span>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div class="flex gap-1.5">
              <input id="sc_${cIdx}_rSn" type="text" value="${rt.serial_no || ''}" oninput="onAdditionalCircuitInput(${cIdx})" placeholder="รหัส S/N อุปกรณ์ MikroTik" class="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-mono uppercase font-bold bg-white" />
              <button type="button" onclick="openSnScanner('site_${cIdx}_router')" class="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold shrink-0">
                สแกน S/N
              </button>
            </div>
            <div class="flex gap-1.5">
              <input id="sc_${cIdx}_rOcrSn" type="text" value="${rt.ocr_serial_no || ''}" oninput="onAdditionalCircuitInput(${cIdx})" placeholder="ค่า S/N จาก OCR" class="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-mono uppercase bg-white text-slate-600" />
              <button type="button" onclick="copySiteCircuitRouterOcr(${cIdx})" class="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold shrink-0">
                ใช้ค่านี้
              </button>
            </div>
          </div>
          <div id="sc_${cIdx}_routerStickerPreview" class="text-[11px] text-slate-500 font-mono pt-1 border-t border-slate-200/70">
            ข้อความ Sticker: <strong>${sc.so_number}</strong> | <strong>${displayRouterAssetNo(rt.asset_no)}</strong> | <strong>MikroTik ${rt.model || 'RB3011'}</strong> | SN: <strong>${rt.serial_no || '-'}</strong>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div class="p-2.5 rounded-lg border border-slate-200 bg-slate-50/50">
            <div class="flex items-center justify-between gap-1 flex-wrap mb-1.5">
              <span class="text-xs font-semibold text-slate-700">ผลทดสอบ Port 2 (≥ 650/350M)</span>
              <div class="flex items-center gap-1">
                <button type="button" onclick="openSpeedtestGenerator(${cIdx}, 'router_lan2', 'router')" class="px-2 py-0.5 rounded bg-cyan-50 hover:bg-cyan-100 text-cyan-800 border border-cyan-300 text-[11px] font-semibold">⚡ สร้างภาพ</button>
                <span id="sc_${cIdx}_lan2Badge">${validateApSpeedBadge(rt.speed_lan2_dl, rt.speed_lan2_ul, 650, 350)}</span>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <input id="sc_${cIdx}_lan2Dl" type="text" value="${rt.speed_lan2_dl || ''}" oninput="onAdditionalCircuitInput(${cIdx})" placeholder="Download (Mbps)" class="px-2.5 py-1.5 rounded border border-slate-300 text-xs bg-white" />
              <input id="sc_${cIdx}_lan2Ul" type="text" value="${rt.speed_lan2_ul || ''}" oninput="onAdditionalCircuitInput(${cIdx})" placeholder="Upload (Mbps)" class="px-2.5 py-1.5 rounded border border-slate-300 text-xs bg-white" />
            </div>
          </div>
          <div class="p-2.5 rounded-lg border border-slate-200 bg-slate-50/50">
            <div class="flex items-center justify-between gap-1 flex-wrap mb-1.5">
              <span class="text-xs font-semibold text-slate-700">ผลทดสอบ Port 3 (≥ 650/350M)</span>
              <div class="flex items-center gap-1">
                <button type="button" onclick="openSpeedtestGenerator(${cIdx}, 'router_lan3', 'router')" class="px-2 py-0.5 rounded bg-cyan-50 hover:bg-cyan-100 text-cyan-800 border border-cyan-300 text-[11px] font-semibold">⚡ สร้างภาพ</button>
                <span id="sc_${cIdx}_lan3Badge">${validateApSpeedBadge(rt.speed_lan3_dl, rt.speed_lan3_ul, 650, 350)}</span>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <input id="sc_${cIdx}_lan3Dl" type="text" value="${rt.speed_lan3_dl || ''}" oninput="onAdditionalCircuitInput(${cIdx})" placeholder="Download (Mbps)" class="px-2.5 py-1.5 rounded border border-slate-300 text-xs bg-white" />
              <input id="sc_${cIdx}_lan3Ul" type="text" value="${rt.speed_lan3_ul || ''}" oninput="onAdditionalCircuitInput(${cIdx})" placeholder="Upload (Mbps)" class="px-2.5 py-1.5 rounded border border-slate-300 text-xs bg-white" />
            </div>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div id="sc_${cIdx}_slotRouterDevice" class="border border-dashed border-slate-300 rounded-lg p-2.5 text-center bg-slate-50/50"></div>
          <div id="sc_${cIdx}_slotRouterLan2" class="border border-dashed border-slate-300 rounded-lg p-2.5 text-center bg-slate-50/50"></div>
          <div id="sc_${cIdx}_slotRouterLan3" class="border border-dashed border-slate-300 rounded-lg p-2.5 text-center bg-slate-50/50"></div>
        </div>
      </div>
    `;

    // 2. Access Points Section in Step 2-3 for Circuit #2, #3...
    const apCardsInnerHtml = aps.length === 0
      ? `<div class="border border-dashed border-slate-300 rounded-xl p-5 text-center bg-white text-xs text-slate-500">ไม่มีอุปกรณ์ Access Point ในวงจรที่ ${cIdx + 1} (${sc.so_number})</div>`
      : aps.map((ap, apIdx) => {
          const spec = detectRoomSpec(ap.room);
          const apSnCmp = compareSnStringsClient(ap.serial_no, ap.ocr_serial_no);
          const roomPhotoCount = (ap.photo_device ? 1 : 0) + (ap.photo_wifi ? 1 : 0) + (ap.photo_lan ? 1 : 0);
          return `
            <div id="sc_${cIdx}_apCard_${apIdx}" class="${apCardClass(apIdx)} rounded-xl p-3.5 space-y-3 transition overflow-hidden" style="${apCardStyle(cIdx, apIdx)}">
              ${apTopBarHtml(cIdx, apIdx, 14)}
              <div class="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-2 gap-2">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="px-2.5 py-1 rounded-md text-xs font-bold" style="${apPillStyle(cIdx, apIdx)}">
                    [วงจร ${cIdx + 1}] AP #${apIdx + 1}: ${ap.room || spec.fullLabel}
                  </span>
                  <span class="text-xs text-slate-500">
                    SSID: <strong class="text-slate-700">${spec.ssid}</strong> • LAN ≥ ${spec.lanMinDl}/${spec.lanMinUl}M • WiFi ≥ ${spec.wifiMinDl}/${spec.wifiMinUl}M
                  </span>
                  <span class="text-[11px] font-semibold px-2 py-0.5 rounded ${roomPhotoCount >= 3 && ap.serial_no ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-600'}">
                    รูป ${roomPhotoCount}/3
                  </span>
                </div>
                <div class="flex items-center gap-1.5 flex-wrap">
                  <div class="flex items-center gap-1 mr-1">
                    ${['DLS', 'GPS', 'VICC', 'GECC'].map(code => `
                      <button type="button" onclick="setSiteCircuitApRoomQuick(${cIdx}, ${apIdx}, '${code}')" class="px-2 py-0.5 rounded border text-[11px] font-semibold ${spec.code === code ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200'}">${code}</button>
                    `).join('')}
                  </div>
                  <button type="button" onclick="removeSiteCircuitAp(${cIdx}, ${apIdx})" class="px-2 py-1 rounded border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-[11px] font-medium">
                    ลบห้อง
                  </button>
                </div>
              </div>

              <div class="flex flex-wrap items-center gap-4 text-xs text-slate-700 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200/80">
                <label class="flex items-center gap-1.5 cursor-pointer">
                  <input id="sc_${cIdx}_apChkSticker_${apIdx}" type="checkbox" ${ap.sticker_done ? 'checked' : ''} onchange="onAdditionalCircuitInput(${cIdx})" class="rounded border-slate-300" />
                  <span>ติด Sticker ใหม่และถ่ายรูปเห็นชัดเจน</span>
                </label>
                ${spec.isGecc ? `
                  <label class="flex items-center gap-1.5 cursor-pointer text-amber-900 font-semibold">
                    <input id="sc_${cIdx}_apGeccAuthen_${apIdx}" type="checkbox" ${ap.gecc_authen_wifi ? 'checked' : ''} onchange="onAdditionalCircuitInput(${cIdx})" class="rounded border-amber-400" />
                    <span>ห้อง GECC: ลงทะเบียนใช้งานระบบ Authen ก่อนต่อ LAN / WiFi แล้ว</span>
                  </label>
                ` : ''}
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
                <div>
                  <label class="block text-[11px] font-semibold text-slate-600 mb-0.5">ยี่ห้อ AP</label>
                  <select id="sc_${cIdx}_apBrand_${apIdx}" onchange="onAdditionalCircuitInput(${cIdx})" class="w-full px-2 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold bg-white">
                    <option value="TOTOLINK" ${ap.brand === 'TOTOLINK' ? 'selected' : ''}>TOTOLINK</option>
                    <option value="D-LINK" ${ap.brand === 'D-LINK' ? 'selected' : ''}>D-LINK</option>
                    <option value="TP-LINK" ${ap.brand === 'TP-LINK' ? 'selected' : ''}>TP-LINK</option>
                    <option value="อื่นๆ" ${!['TOTOLINK', 'D-LINK', 'TP-LINK'].includes(ap.brand) ? 'selected' : ''}>อื่นๆ</option>
                  </select>
                </div>
                <div>
                  <label class="block text-[11px] font-semibold text-slate-600 mb-0.5">รุ่น (Model)</label>
                  <input id="sc_${cIdx}_apModel_${apIdx}" type="text" value="${ap.model || ''}" oninput="onAdditionalCircuitInput(${cIdx})" class="w-full px-2 py-1.5 rounded-lg border border-slate-300 text-xs bg-white" />
                </div>
                <div>
                  <label class="block text-[11px] font-semibold text-slate-600 mb-0.5">เลขครุภัณฑ์</label>
                  <input id="sc_${cIdx}_apAsset_${apIdx}" type="text" value="${displayApAssetNo(ap.asset_no)}" oninput="onAdditionalCircuitInput(${cIdx})" class="w-full px-2 py-1.5 rounded-lg border border-slate-300 text-xs bg-white" />
                </div>
                <div>
                  <label class="block text-[11px] font-semibold text-slate-600 mb-0.5">ชื่อห้อง</label>
                  <input id="sc_${cIdx}_apRoom_${apIdx}" type="text" value="${ap.room || ''}" oninput="onAdditionalCircuitInput(${cIdx})" class="w-full px-2 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold bg-white" />
                </div>
                <div class="grid grid-cols-2 gap-1.5">
                  <div>
                    <label class="block text-[11px] font-semibold text-slate-600 mb-0.5">ชั้น</label>
                    <input id="sc_${cIdx}_apFloor_${apIdx}" type="text" value="${ap.floor || '1'}" oninput="onAdditionalCircuitInput(${cIdx})" class="w-full px-2 py-1.5 rounded-lg border border-slate-300 text-xs text-center bg-white" />
                  </div>
                  <div>
                    <label class="block text-[11px] font-semibold text-slate-600 mb-0.5">อาคาร</label>
                    <input id="sc_${cIdx}_apBuilding_${apIdx}" type="text" value="${ap.building || '1'}" oninput="onAdditionalCircuitInput(${cIdx})" class="w-full px-2 py-1.5 rounded-lg border border-slate-300 text-xs text-center bg-white" />
                  </div>
                </div>
              </div>

              <div class="bg-slate-50 rounded-lg p-2.5 border border-slate-200 space-y-2">
                <div class="flex items-center justify-between flex-wrap gap-1">
                  <span class="text-xs font-bold text-slate-700">Serial No. (S/N)</span>
                  <span id="sc_${cIdx}_apSnBadge_${apIdx}" class="px-2 py-0.5 rounded text-[11px] font-semibold ${apSnCmp.cls}">${apSnCmp.label}</span>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input id="sc_${cIdx}_apSn_${apIdx}" type="text" value="${ap.serial_no || ''}" oninput="onAdditionalCircuitInput(${cIdx})" placeholder="รหัส S/N อุปกรณ์ AP" class="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-mono uppercase font-bold bg-white" />
                  <div class="flex gap-1">
                    <input id="sc_${cIdx}_apOcrSn_${apIdx}" type="text" value="${ap.ocr_serial_no || ''}" oninput="onAdditionalCircuitInput(${cIdx})" placeholder="ค่า S/N จาก OCR" class="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-mono uppercase text-slate-600" />
                    <button type="button" onclick="openSnScanner('site_${cIdx}_ap_${apIdx}')" class="px-2.5 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-semibold shrink-0">สแกน S/N</button>
                    <button type="button" onclick="copySiteCircuitApOcr(${cIdx}, ${apIdx})" class="px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 text-xs font-semibold shrink-0">ใช้ค่านี้</button>
                  </div>
                </div>
                <div id="sc_${cIdx}_apSticker_${apIdx}" class="text-[11px] text-slate-500 font-mono pt-1 border-t border-slate-200/70">
                  ข้อความ Sticker: <strong>${sc.so_number}</strong> | <strong>${displayApAssetNo(ap.asset_no)}</strong> | <strong>${ap.brand || ''} ${ap.model || ''}</strong> | SN: <strong>${ap.serial_no || '-'}</strong>
                </div>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div class="p-2.5 rounded-lg border border-slate-200 bg-slate-50/50">
                  <div class="flex items-center justify-between gap-1 flex-wrap mb-1">
                    <span class="text-xs font-semibold text-slate-700">ผลทดสอบ WiFi (≥ ${spec.wifiMinDl}/${spec.wifiMinUl}M)</span>
                    <div class="flex items-center gap-1">
                      <button type="button" onclick="openSpeedtestGenerator(${cIdx}, 'ap${apIdx + 1}_wifi', 'wifi')" class="px-2 py-0.5 rounded bg-cyan-50 hover:bg-cyan-100 text-cyan-800 border border-cyan-300 text-[11px] font-semibold">⚡ สร้างภาพ</button>
                      <span id="sc_${cIdx}_apWifiBadge_${apIdx}">${validateApSpeedBadge(ap.speed_wifi_dl, ap.speed_wifi_ul, spec.wifiMinDl, spec.wifiMinUl)}</span>
                    </div>
                  </div>
                  <div class="grid grid-cols-2 gap-1.5">
                    <input id="sc_${cIdx}_apWifiDl_${apIdx}" type="text" value="${ap.speed_wifi_dl || ''}" oninput="onAdditionalCircuitInput(${cIdx})" placeholder="Download (Mbps)" class="px-2 py-1 rounded border border-slate-300 text-xs bg-white" />
                    <input id="sc_${cIdx}_apWifiUl_${apIdx}" type="text" value="${ap.speed_wifi_ul || ''}" oninput="onAdditionalCircuitInput(${cIdx})" placeholder="Upload (Mbps)" class="px-2 py-1 rounded border border-slate-300 text-xs bg-white" />
                  </div>
                </div>
                <div class="p-2.5 rounded-lg border border-slate-200 bg-slate-50/50">
                  <div class="flex items-center justify-between gap-1 flex-wrap mb-1">
                    <span class="text-xs font-semibold text-slate-700">ผลทดสอบ Port LAN (≥ ${spec.lanMinDl}/${spec.lanMinUl}M)</span>
                    <div class="flex items-center gap-1">
                      <button type="button" onclick="openSpeedtestGenerator(${cIdx}, 'ap${apIdx + 1}_lan', '${spec.lanMinDl >= 350 ? 'gps_lan' : 'dls_lan'}')" class="px-2 py-0.5 rounded bg-cyan-50 hover:bg-cyan-100 text-cyan-800 border border-cyan-300 text-[11px] font-semibold">⚡ สร้างภาพ</button>
                      <span id="sc_${cIdx}_apLanBadge_${apIdx}">${validateApSpeedBadge(ap.speed_lan_dl, ap.speed_lan_ul, spec.lanMinDl, spec.lanMinUl)}</span>
                    </div>
                  </div>
                  <div class="grid grid-cols-2 gap-1.5">
                    <input id="sc_${cIdx}_apLanDl_${apIdx}" type="text" value="${ap.speed_lan_dl || ''}" oninput="onAdditionalCircuitInput(${cIdx})" placeholder="Download (Mbps)" class="px-2 py-1 rounded border border-slate-300 text-xs bg-white" />
                    <input id="sc_${cIdx}_apLanUl_${apIdx}" type="text" value="${ap.speed_lan_ul || ''}" oninput="onAdditionalCircuitInput(${cIdx})" placeholder="Upload (Mbps)" class="px-2 py-1 rounded border border-slate-300 text-xs bg-white" />
                  </div>
                </div>
              </div>
              <div>
                <input id="sc_${cIdx}_apNote_${apIdx}" type="text" value="${ap.speed_note || ''}" oninput="onAdditionalCircuitInput(${cIdx})" placeholder="หมายเหตุความเร็ว (ถ้ามี)..." class="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs bg-slate-50" />
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div id="sc_${cIdx}_slotApDevice_${apIdx}" class="border border-dashed border-slate-300 rounded-lg p-2.5 text-center bg-slate-50/50"></div>
                <div id="sc_${cIdx}_slotApWifi_${apIdx}" class="border border-dashed border-slate-300 rounded-lg p-2.5 text-center bg-slate-50/50"></div>
                <div id="sc_${cIdx}_slotApLan_${apIdx}" class="border border-dashed border-slate-300 rounded-lg p-2.5 text-center bg-slate-50/50"></div>
              </div>
            </div>
          `;
        }).join('');

    apsHtml += `
      <div id="siteCircuitApsCard_${cIdx}" class="circuit-tint rounded-xl p-4 sm:p-5 space-y-3.5 shadow-sm transition" style="${circuitFrameStyle(cIdx)}">
        ${circuitLabelHtml(cIdx, `วงจรที่ ${cIdx + 1} · Access Point · ${sc.so_number}`)}
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="px-2.5 py-1 rounded-md text-xs font-bold" style="${circuitBadgeStyle(cIdx)}">
              ห้อง Access Point วงจรที่ ${cIdx + 1}: ${sc.so_number}
            </span>
            <span class="text-xs text-slate-500">จำนวนห้อง AP: ${aps.length} จุด</span>
          </div>
          <div class="flex items-center gap-1.5 flex-wrap">
            <button type="button" onclick="addSiteCircuitApByRoom(${cIdx}, 'DLS')" class="px-2.5 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold">+ ห้อง DLS</button>
            <button type="button" onclick="addSiteCircuitApByRoom(${cIdx}, 'GPS')" class="px-2.5 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold">+ ห้อง GPS</button>
            <button type="button" onclick="addSiteCircuitApByRoom(${cIdx}, 'VICC')" class="px-2.5 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold">+ ห้อง VICC</button>
            <button type="button" onclick="addSiteCircuitApByRoom(${cIdx}, 'GECC')" class="px-2.5 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold">+ ห้อง GECC</button>
            <button type="button" onclick="addSiteCircuitCustomAp(${cIdx})" class="px-2.5 py-1 rounded-lg bg-slate-800 text-white text-xs font-semibold">+ ห้องอื่นๆ</button>
          </div>
        </div>
        <div class="space-y-3">
          ${apCardsInnerHtml}
        </div>
      </div>
    `;

    // 3. Compact Remarks for Circuit #2, #3... (since 1 Site shares 1 Handover Form & 1 Report)
    handoversHtml += `
      <div id="siteCircuitHandoverCard_${cIdx}" class="rounded-lg p-3 space-y-1.5" style="${circuitFrameStyle(cIdx)} background:${circuitColorOf(cIdx).soft};">
        <div class="flex items-center justify-between flex-wrap gap-2">
          <span class="text-xs font-bold" style="color:${circuitColorOf(cIdx).ink}">
            หมายเหตุเพิ่มเติมของวงจรที่ ${cIdx + 1} (${sc.so_number})
          </span>
          <span class="text-[11px] text-slate-500">
            ใช้ใบส่งมอบงานร่วมกับทั้ง Site ด้านบน
          </span>
        </div>
        <input id="sc_${cIdx}_remarks" type="text" value="${sc.remarks || ''}" oninput="onAdditionalCircuitInput(${cIdx})" placeholder="ระบุหมายเหตุของวงจรที่ ${cIdx + 1} (ถ้ามี)..." class="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs bg-white" />
      </div>
    `;
  }

  routersBox.innerHTML = routersHtml;
  apsBox.innerHTML = apsHtml;
  handoversBox.innerHTML = handoversHtml;
  colorizeSiteCircuitFrames();

  // Bind photo upload slots for all additional circuits (Router + APs only; Handover is 1 shared per Site)
  for (let cIdx = 1; cIdx < currentSiteCircuits.length; cIdx++) {
    const sc = currentSiteCircuits[cIdx];
    const rt = sc.router_info || {};
    const aps = Array.isArray(sc.access_points) ? sc.access_points : [];

    renderPhotoSlot(
      `sc_${cIdx}_slotRouterDevice`,
      'router_device',
      `1) รูปอุปกรณ์ MikroTik + Sticker (${sc.so_number})`,
      rt.photo_device,
      url => { sc.router_info.photo_device = url; renderModalCompletenessBar(); },
      sc.so_number,
      `site_${cIdx}_router`
    );
    renderPhotoSlot(
      `sc_${cIdx}_slotRouterLan2`,
      'router_lan2',
      `2) รูปผลทดสอบ Port 2 (${sc.so_number})`,
      rt.photo_lan2,
      url => { sc.router_info.photo_lan2 = url; renderModalCompletenessBar(); },
      sc.so_number
    );
    renderPhotoSlot(
      `sc_${cIdx}_slotRouterLan3`,
      'router_lan3',
      `3) รูปผลทดสอบ Port 3 (${sc.so_number})`,
      rt.photo_lan3,
      url => { sc.router_info.photo_lan3 = url; renderModalCompletenessBar(); },
      sc.so_number
    );

    aps.forEach((ap, apIdx) => {
      const spec = detectRoomSpec(ap.room);
      renderPhotoSlot(
        `sc_${cIdx}_slotApDevice_${apIdx}`,
        `ap${apIdx + 1}_device`,
        `1) รูปอุปกรณ์ AP + Sticker (${ap.room || spec.code})`,
        ap.photo_device,
        url => { sc.access_points[apIdx].photo_device = url; renderModalCompletenessBar(); },
        sc.so_number,
        `site_${cIdx}_ap_${apIdx}`
      );
      renderPhotoSlot(
        `sc_${cIdx}_slotApWifi_${apIdx}`,
        `ap${apIdx + 1}_wifi`,
        `2) รูปผลทดสอบ WiFi (${spec.ssid})`,
        ap.photo_wifi,
        url => { sc.access_points[apIdx].photo_wifi = url; renderModalCompletenessBar(); },
        sc.so_number
      );
      renderPhotoSlot(
        `sc_${cIdx}_slotApLan_${apIdx}`,
        `ap${apIdx + 1}_lan`,
        `3) รูปผลทดสอบ Port LAN (${spec.code})`,
        ap.photo_lan,
        url => { sc.access_points[apIdx].photo_lan = url; renderModalCompletenessBar(); },
        sc.so_number
      );
    });
  }
}

async function quickAddCircuitToSiteFromCard(baseSo) {
  await openInspectionModal(baseSo);
  setTimeout(() => {
    promptAddCircuitToCurrentSite();
  }, 250);
}

async function promptAddCircuitToCurrentSite() {
  if (!currentCircuit) return;
  syncApInputsFromDom();
  syncAdditionalSiteCircuitsFromDom();

  const siteName = extractSiteNameClient(currentCircuit);
  const existingSos = (currentSiteCircuits || [currentCircuit]).map(x => x.so_number).join(', ');
  const otherInProv = allCircuits
    .filter(x => x.province === currentCircuit.province && !(currentSiteCircuits || []).some(sc => sc.so_number === x.so_number))
    .map(x => `${x.so_number} (${extractSiteNameClient(x)})`);

  const hintText = otherInProv.length > 0
    ? `\nวงจรอื่นใน จ.${currentCircuit.province} ที่สามารถดึงเข้ามารวมในตู้ Rack นี้ได้:\n- ${otherInProv.slice(0, 6).join('\n- ')}`
    : '';

  const rawSo = prompt(
    `➕ เพิ่มวงจรเข้าใน Site "${siteName}" (ตู้ Rack เดียวกัน)\n` +
    `ปัจจุบันใน Site นี้มี: ${existingSos}${hintText}\n\n` +
    `กรุณาระบุหมายเลข S/O ของวงจรที่ต้องการเพิ่มเข้าในตู้ Rack นี้ (เช่น BINF3480xxx):`
  );
  if (!rawSo || !rawSo.trim()) return;
  const targetSo = rawSo.trim().toUpperCase();

  if ((currentSiteCircuits || []).some(x => x.so_number === targetSo)) {
    showToast(`วงจร ${targetSo} อยู่ใน Site / ตู้ Rack นี้แล้ว`);
    return;
  }

  try {
    const existingCircuit = allCircuits.find(x => x.so_number === targetSo);
    if (existingCircuit) {
      // Link existing circuit into the current Site & Rack
      const fullRes = await fetch(`/api/circuits/${encodeURIComponent(targetSo)}`);
      const fullData = await fullRes.json();
      const cObj = fullData.circuit || existingCircuit;
      const rt = cObj.router_info || {};
      rt.room = document.getElementById('rRoom')?.value.trim() || currentCircuit.router_info?.room || rt.room || 'วิชาการ';
      rt.floor = document.getElementById('rFloor')?.value.trim() || currentCircuit.router_info?.floor || rt.floor || '1';
      rt.building = document.getElementById('rBuilding')?.value.trim() || currentCircuit.router_info?.building || rt.building || '1';

      const putRes = await fetch(`/api/circuits/${encodeURIComponent(targetSo)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...cObj,
          site_name: siteName,
          site_key: getSiteKeyClient(currentCircuit),
          customer_site_name: `${siteName} วงจรที่ ${(currentSiteCircuits?.length || 1) + 1}`,
          branch_name: currentCircuit.branch_name,
          address: document.getElementById('fAddress')?.value.trim() || currentCircuit.address,
          lat_long: document.getElementById('fLatLong')?.value.trim() || currentCircuit.lat_long,
          router_info: rt
        })
      });
      if (!putRes.ok) throw new Error('เชื่อมวงจรเข้ากับ Site ไม่สำเร็จ');
      showToast(`🔗 รวมวงจร ${targetSo} เข้ามาใน Site "${siteName}" (ตู้ Rack เดียวกัน) เรียบร้อยแล้ว!`);
    } else {
      // Create a brand new circuit inside this Site & Rack
      const svcNo = prompt(`ระบุ Service No. ของวงจรใหม่ ${targetSo} (เว้นว่างได้):`, '') || '';
      const postRes = await fetch('/api/circuits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          so_number: targetSo,
          service_no: svcNo.trim().toUpperCase(),
          region: currentCircuit.region,
          province: currentCircuit.province,
          branch_name: currentCircuit.branch_name,
          site_name: siteName,
          site_key: getSiteKeyClient(currentCircuit),
          customer_site_name: `${siteName} วงจรที่ ${(currentSiteCircuits?.length || 1) + 1}`,
          address: document.getElementById('fAddress')?.value.trim() || currentCircuit.address,
          lat_long: document.getElementById('fLatLong')?.value.trim() || currentCircuit.lat_long,
          router_room: document.getElementById('rRoom')?.value.trim() || currentCircuit.router_info?.room || 'วิชาการ',
          router_floor: document.getElementById('rFloor')?.value.trim() || currentCircuit.router_info?.floor || '1',
          router_building: document.getElementById('rBuilding')?.value.trim() || currentCircuit.router_info?.building || '1'
        })
      });
      const postData = await postRes.json();
      if (!postRes.ok) throw new Error(postData.error || 'สร้างวงจรใหม่ใน Site ไม่สำเร็จ');
      showToast(`➕ เพิ่มวงจรใหม่ ${targetSo} เข้าใน Site "${siteName}" (ตู้ Rack เดียวกัน) เรียบร้อยแล้ว!`);
    }

    await refreshAllData();
    await openInspectionModal(currentCircuit.so_number);
  } catch (err) {
    showToast(err.message, true);
  }
}

// ============================================================================
// Digital Signature Pad
// ============================================================================
function initSignaturePad(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  let drawing = false;
  let hasStroke = false;

  const getPos = e => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  };

  const start = e => {
    e.preventDefault();
    drawing = true;
    hasStroke = true;
    const p = getPos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };

  const move = e => {
    if (!drawing) return;
    e.preventDefault();
    const p = getPos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };

  const end = () => { drawing = false; };

  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', end);

  sigPads[canvasId] = {
    canvas,
    ctx,
    isEmpty: () => !hasStroke,
    setHasStroke: val => { hasStroke = val; }
  };
}

function clearSignature(canvasId) {
  const pad = sigPads[canvasId];
  if (!pad) return;
  pad.ctx.clearRect(0, 0, pad.canvas.width, pad.canvas.height);
  pad.setHasStroke(false);
}

function loadSignatureToCanvas(canvasId, dataUrl) {
  clearSignature(canvasId);
  const pad = sigPads[canvasId];
  if (!pad || !dataUrl) return;
  const img = new Image();
  img.onload = () => {
    pad.ctx.drawImage(img, 0, 0, pad.canvas.width, pad.canvas.height);
    pad.setHasStroke(true);
  };
  img.src = dataUrl;
}

function getSignatureDataUrl(canvasId) {
  const pad = sigPads[canvasId];
  if (!pad || pad.isEmpty()) return '';
  return pad.canvas.toDataURL('image/png');
}

// ============================================================================
// Save Current Site Inspection (Saves Circuit #1 AND Circuit #2, #3... in Site)
// ============================================================================
function collectFormPayload() {
  syncApInputsFromDom();
  const statusEl = document.querySelector('input[name="circuitStatus"]:checked');
  const routerModelEl = document.querySelector('input[name="routerModel"]:checked');
  const handoverP1 = currentCircuit.router_info?.photo_handover_p1 || currentCircuit.router_info?.photo_signed_doc || '';
  const handoverP2 = currentCircuit.router_info?.photo_handover_p2 || '';

  return {
    so_number: document.getElementById('fSoNumber').value.trim(),
    service_no: document.getElementById('fServiceNo').value.trim(),
    speed_pkg: document.getElementById('fSpeedPkg').value.trim(),
    branch_name: document.getElementById('fBranchName').value.trim(),
    lat_long: document.getElementById('fLatLong').value.trim(),
    address: document.getElementById('fAddress').value.trim(),
    status: statusEl ? statusEl.value : 'pending',
    router_info: {
      checked: true,
      model: (document.getElementById('rCustomModel')?.value || '').trim() || (routerModelEl ? routerModelEl.value : 'RB3011'),
      serial_no: document.getElementById('rSerialNo').value.trim().toUpperCase(),
      ocr_serial_no: (document.getElementById('rOcrSerialNo')?.value || '').trim().toUpperCase(),
      asset_no: document.getElementById('rAssetNo').value.trim(),
      room: document.getElementById('rRoom').value.trim(),
      floor: document.getElementById('rFloor').value.trim(),
      building: document.getElementById('rBuilding').value.trim(),
      sticker_done: document.getElementById('chkMktSticker').checked,
      speed_tested: document.getElementById('chkMktSpeed').checked,
      doc_filled: document.getElementById('chkDocFilled').checked,
      doc_stamped: document.getElementById('chkDocStamped').checked,
      speed_lan2_dl: document.getElementById('rLan2Dl').value.trim(),
      speed_lan2_ul: document.getElementById('rLan2Ul').value.trim(),
      speed_lan3_dl: document.getElementById('rLan3Dl').value.trim(),
      speed_lan3_ul: document.getElementById('rLan3Ul').value.trim(),
      photo_device: currentCircuit.router_info?.photo_device || '',
      photo_lan2: currentCircuit.router_info?.photo_lan2 || '',
      photo_lan3: currentCircuit.router_info?.photo_lan3 || '',
      photo_handover_p1: handoverP1,
      photo_handover_p2: handoverP2,
      photo_signed_doc: handoverP1
    },
    access_points: currentCircuit.access_points,
    remarks: (document.getElementById('fRemarks')?.value || '').trim(),
    inspector_name: (document.getElementById('fInspectorName')?.value || '').trim(),
    inspector_phone: (document.getElementById('fInspectorPhone')?.value || '').trim(),
    inspection_date: (document.getElementById('fInspectionDate')?.value || '').trim(),
    inspector_signature: getSignatureDataUrl('sigInspector') || currentCircuit.inspector_signature || '',
    receiver_name: (document.getElementById('fReceiverName')?.value || currentCircuit.receiver_name || '').trim(),
    receiver_position: (document.getElementById('fReceiverPosition')?.value || currentCircuit.receiver_position || '').trim(),
    receiver_phone: (document.getElementById('fReceiverPhone')?.value || currentCircuit.receiver_phone || '').trim(),
    received_date: (document.getElementById('fReceivedDate')?.value || currentCircuit.received_date || '').trim(),
    receiver_signature: getSignatureDataUrl('sigReceiver') || currentCircuit.receiver_signature || ''
  };
}

async function saveCurrentInspection(silent = false, options = {}) {
  if (!currentCircuit) return false;
  const { isDraft = false, isAuto = false, roomLabel = '' } = options;
  try {
    syncAdditionalSiteCircuitsFromDom();
    const payload = collectFormPayload();
    const draftIso = new Date().toISOString();

    if (payload.status === 'pending' && (isDraft || payload.router_info.serial_no || payload.inspector_name)) {
      payload.status = 'in_progress';
      const radioInProg = document.querySelector('input[name="circuitStatus"][value="in_progress"]');
      if (radioInProg) radioInProg.checked = true;
    }

    if (isDraft) {
      payload.is_draft = true;
      payload.draft_saved_at = draftIso;
      if (roomLabel) payload.last_active_room = roomLabel;
    }

    const res = await fetch(`/api/circuits/${encodeURIComponent(currentCircuit.id || currentCircuit.so_number)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'บันทึกไม่สำเร็จ');
    currentCircuit = data.circuit;
    if (Array.isArray(currentSiteCircuits) && currentSiteCircuits.length > 0) {
      currentSiteCircuits[0] = currentCircuit;
    }

    // Also save Circuit #2, #3... in the same Site / Rack simultaneously!
    // (1 Site shares 1 Handover Form — sync photo_handover_p1 & photo_handover_p2 to all circuits in the Site)
    if (Array.isArray(currentSiteCircuits) && currentSiteCircuits.length > 1) {
      const siteHandoverP1 = payload.router_info?.photo_handover_p1 || payload.router_info?.photo_signed_doc || '';
      const siteHandoverP2 = payload.router_info?.photo_handover_p2 || '';
      for (let cIdx = 1; cIdx < currentSiteCircuits.length; cIdx++) {
        const sc = currentSiteCircuits[cIdx];
        if (!sc) continue;
        const rt = sc.router_info || {};
        const p1 = siteHandoverP1 || rt.photo_handover_p1 || rt.photo_signed_doc || '';
        const p2 = siteHandoverP2 || rt.photo_handover_p2 || '';
        const scStatus = (sc.status === 'pending' && (isDraft || rt.serial_no || payload.inspector_name))
          ? 'in_progress'
          : (sc.status || payload.status);

        const scPayload = {
          ...sc,
          branch_name: payload.branch_name || sc.branch_name,
          lat_long: payload.lat_long || sc.lat_long,
          address: payload.address || sc.address,
          status: scStatus,
          inspector_name: payload.inspector_name || sc.inspector_name,
          inspector_phone: payload.inspector_phone || sc.inspector_phone,
          inspection_date: payload.inspection_date || sc.inspection_date,
          is_draft: isDraft ? true : Boolean(sc.is_draft),
          draft_saved_at: isDraft ? draftIso : (sc.draft_saved_at || ''),
          last_active_room: roomLabel || sc.last_active_room || '',
          router_info: {
            ...rt,
            checked: true,
            doc_filled: Boolean(payload.router_info?.doc_filled || p1),
            doc_stamped: Boolean(payload.router_info?.doc_stamped || p2),
            photo_handover_p1: p1,
            photo_handover_p2: p2,
            photo_signed_doc: p1
          },
          access_points: sc.access_points || []
        };

        const r2 = await fetch(`/api/circuits/${encodeURIComponent(sc.id || sc.so_number)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(scPayload)
        });
        if (r2.ok) {
          const d2 = await r2.json();
          if (d2.circuit) currentSiteCircuits[cIdx] = d2.circuit;
        }
      }
    }

    saveSiteDraftToLocal(roomLabel || (isDraft ? 'บันทึกร่าง' : 'บันทึกข้อมูล'));
    const allSos = (currentSiteCircuits || [currentCircuit]).map(x => x.so_number).join(', ');
    const timeStr = new Date().toLocaleTimeString('th-TH');
    document.getElementById('modalSaveStatus').textContent = isDraft
      ? `📝 บันทึกร่างทั้ง Site (${allSos}) สำเร็จเมื่อ ${timeStr}`
      : `💾 บันทึกทั้ง Site (${allSos}) สำเร็จเมื่อ ${timeStr}`;
    updateDraftStatusUi('saved', `บันทึกครบทั้ง Site (${allSos}) เมื่อ ${timeStr}`);
    renderSiteRoomsQuickJumpBar();

    if (!silent) {
      showToast(`💾 บันทึกข้อมูลทั้ง Site (${allSos}) เรียบร้อยแล้ว!`);
    }
    if (!isAuto) {
      await refreshAllData();
    }
    return true;
  } catch (err) {
    if (!isAuto) {
      showToast('เกิดข้อผิดพลาด: ' + err.message, true);
    }
    return false;
  }
}

async function openPrintReportFromModal(mode = '', targetSo = '') {
  if (!currentCircuit) return;
  await saveCurrentInspection(true);
  const so = targetSo || currentCircuit.so_number;
  const modeParam = mode ? `&mode=${encodeURIComponent(mode)}` : '';
  window.open(`/report.html?id=${encodeURIComponent(so)}${modeParam}`, '_blank');
}

async function downloadWordReportFromModal(targetSo = '') {
  if (!currentCircuit) return;
  await saveCurrentInspection(true);
  const so = targetSo || currentCircuit.so_number;
  window.open(`/api/circuits/${encodeURIComponent(so)}/report.docx`, '_blank');
}

// ============================================================================
// GPS & Utilities
// ============================================================================
function getCurrentGpsLocation() {
  if (!navigator.geolocation) {
    showToast('เบราว์เซอร์นี้ไม่รองรับการดึงพิกัด GPS', true);
    return;
  }
  showToast('กำลังดึงพิกัด GPS ปัจจุบัน...');
  navigator.geolocation.getCurrentPosition(
    pos => {
      const lat = pos.coords.latitude.toFixed(7);
      const lng = pos.coords.longitude.toFixed(7);
      document.getElementById('fLatLong').value = `${lat},${lng}`;
      showToast(`ดึงพิกัดสำเร็จ: ${lat},${lng}`);
    },
    err => {
      showToast('ไม่สามารถดึงพิกัด GPS ได้: ' + err.message, true);
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function openGoogleMaps() {
  const val = document.getElementById('fLatLong').value.trim();
  const branch = document.getElementById('fBranchName').value.trim();
  const q = val || branch || 'กรมการขนส่งทางบก';
  window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`, '_blank');
}

function formatThaiDateToday() {
  const d = new Date();
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const buddhistYear = d.getFullYear() + 543;
  return `${day}/${month}/${buddhistYear}`;
}

// ============================================================================
// Add New Circuit Modal
// ============================================================================
function openAddCircuitModal() {
  const modal = document.getElementById('addCircuitModal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeAddCircuitModal() {
  const modal = document.getElementById('addCircuitModal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

async function submitNewCircuit() {
  const so_number = document.getElementById('newSoNumber').value.trim().toUpperCase();
  const service_no = document.getElementById('newServiceNo').value.trim().toUpperCase();
  const region = document.getElementById('newRegion').value;
  const province = document.getElementById('newProvince').value.trim();
  const branch_name = document.getElementById('newBranchName').value.trim();

  if (!so_number || !province) {
    showToast('กรุณากรอกหมายเลข S/O และชื่อจังหวัด', true);
    return;
  }

  try {
    const res = await fetch('/api/circuits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ so_number, service_no, region, province, branch_name })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'เพิ่มวงจรไม่สำเร็จ');
    closeAddCircuitModal();
    showToast(`เพิ่มวงจร ${so_number} เรียบร้อยแล้ว`);
    await refreshAllData();
  } catch (err) {
    showToast(err.message, true);
  }
}

// ============================================================================
// Smart S/N Scanner & Photo OCR Engine (ถ่ายรูปอ่าน S/N + Barcode/QR อัตโนมัติ)
// ============================================================================
let activeSnTarget = 'router'; // 'router' | 'ap_0' | 'site_1_router' | 'site_1_ap_0' ...
let liveHtml5QrCode = null;
let liveCameraRunning = false;

function openSnScanner(target) {
  activeSnTarget = target || 'router';
  const titleEl = document.getElementById('snModalTitle');
  if (titleEl) {
    if (activeSnTarget === 'router') {
      titleEl.textContent = `📷 ถ่ายรูปสติ๊กเกอร์ / สแกนอ่าน S/N — MikroTik (วงจรที่ 1)`;
    } else if (activeSnTarget.startsWith('site_')) {
      const m = activeSnTarget.match(/^site_(\d+)_(router|ap_(\d+))$/);
      if (m) {
        const cNum = Number(m[1]) + 1;
        const devLabel = m[2] === 'router' ? 'MikroTik Router' : `Access Point ตัวที่ ${Number(m[3]) + 1}`;
        titleEl.textContent = `📷 ถ่ายรูปสติ๊กเกอร์ / สแกนอ่าน S/N — ${devLabel} (วงจรที่ ${cNum})`;
      }
    } else {
      const idx = Number(activeSnTarget.replace('ap_', '')) + 1;
      titleEl.textContent = `📷 ถ่ายรูปสติ๊กเกอร์ / สแกนอ่าน S/N — Access Point ตัวที่ ${idx} (วงจรที่ 1)`;
    }
  }
  document.getElementById('snOcrStatusBox').classList.add('hidden');
  document.getElementById('snOcrFileInput').value = '';
  const modal = document.getElementById('snScannerModal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

async function closeSnScanner() {
  await stopLiveBarcodeCamera();
  const modal = document.getElementById('snScannerModal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

async function toggleLiveBarcodeCamera() {
  if (liveCameraRunning) {
    await stopLiveBarcodeCamera();
    return;
  }
  const readerEl = document.getElementById('liveBarcodeReader');
  const btn = document.getElementById('btnStartLiveBarcode');
  readerEl.classList.remove('hidden');
  btn.textContent = '⏹️ ปิดกล้องสแกน';

  try {
    if (!window.Html5Qrcode) {
      throw new Error('ไม่พบไลบรารีสแกนบาร์โค้ด กรุณาใช้วิธีถ่ายรูปสติ๊กเกอร์ด้านบน');
    }
    liveHtml5QrCode = new Html5Qrcode('liveBarcodeReader');
    liveCameraRunning = true;
    await liveHtml5QrCode.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 260, height: 120 } },
      async decodedText => {
        const cleaned = (decodedText || '').trim().toUpperCase();
        if (cleaned) {
          applyDetectedSnToTarget(cleaned, activeSnTarget, [cleaned]);
          showToast(`สแกนบาร์โค้ด S/N สำเร็จ: ${cleaned}`);
          await closeSnScanner();
        }
      },
      () => {}
    );
  } catch (err) {
    liveCameraRunning = false;
    readerEl.classList.add('hidden');
    btn.textContent = '🎥 เปิดกล้องสแกนสด';
    showToast('ไม่สามารถเปิดกล้องสดได้ กรุณากดปุ่ม "ถ่ายรูป / เลือกรูปสติ๊กเกอร์" ด้านบนแทน', true);
  }
}

async function stopLiveBarcodeCamera() {
  const readerEl = document.getElementById('liveBarcodeReader');
  const btn = document.getElementById('btnStartLiveBarcode');
  if (liveHtml5QrCode && liveCameraRunning) {
    try {
      await liveHtml5QrCode.stop();
      await liveHtml5QrCode.clear();
    } catch (_) {}
  }
  liveHtml5QrCode = null;
  liveCameraRunning = false;
  if (readerEl) readerEl.classList.add('hidden');
  if (btn) btn.textContent = '🎥 เปิดกล้องสแกนสด';
}

async function handleSnPhotoSelected(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const statusBox = document.getElementById('snOcrStatusBox');
  const statusText = document.getElementById('snOcrStatusText');
  const pctEl = document.getElementById('snOcrPct');
  const previewImg = document.getElementById('snPreviewImg');
  const candBox = document.getElementById('snModalCandidates');
  const manualInput = document.getElementById('snManualEditInput');

  statusBox.classList.remove('hidden');
  statusText.textContent = '⏳ กำลังเตรียมภาพและอ่านรหัส S/N (Barcode + OCR)...';
  pctEl.textContent = '10%';
  candBox.innerHTML = '';

  try {
    const compressedDataUrl = await compressImageFile(file, 1500, 0.88);
    previewImg.src = compressedDataUrl;

    // Also save this photo into the corresponding device photo slot if currentCircuit is open
    if (currentCircuit) {
      let targetCircuitObj = currentCircuit;
      let slotKey = 'router_device';
      let cIdxForSite = 0;

      if (activeSnTarget.startsWith('site_')) {
        const m = activeSnTarget.match(/^site_(\d+)_(router|ap_(\d+))$/);
        if (m) {
          cIdxForSite = Number(m[1]);
          targetCircuitObj = currentSiteCircuits[cIdxForSite] || currentCircuit;
          slotKey = m[2] === 'router' ? 'router_device' : `ap${Number(m[3]) + 1}_device`;
        }
      } else {
        slotKey = activeSnTarget === 'router'
          ? 'router_device'
          : `ap${Number(activeSnTarget.replace('ap_', '')) + 1}_device`;
      }

      fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          circuitId: targetCircuitObj.so_number,
          so_number: targetCircuitObj.so_number,
          slot: slotKey,
          dataUrl: compressedDataUrl
        })
      }).then(r => r.json()).then(upData => {
        if (upData.ok && upData.url) {
          if (cIdxForSite > 0 && currentSiteCircuits[cIdxForSite]) {
            if (slotKey === 'router_device') {
              currentSiteCircuits[cIdxForSite].router_info.photo_device = upData.url;
            } else {
              const apIdx = Number(slotKey.match(/^ap(\d+)_device$/)[1]) - 1;
              if (currentSiteCircuits[cIdxForSite].access_points?.[apIdx]) {
                currentSiteCircuits[cIdxForSite].access_points[apIdx].photo_device = upData.url;
              }
            }
            renderAdditionalSiteCircuitsInModal();
            renderModalCompletenessBar();
          } else if (activeSnTarget === 'router') {
            currentCircuit.router_info.photo_device = upData.url;
            renderPhotoSlot('slotRouterDevice', 'router_device', `1.1 รูปถ่ายอุปกรณ์ MikroTik วงจรที่ 1 (${currentCircuit.so_number}) เห็น Sticker ชัดเจน`, upData.url, u => {
              currentCircuit.router_info.photo_device = u;
            });
          } else {
            const apIdx = Number(activeSnTarget.replace('ap_', ''));
            if (currentCircuit.access_points[apIdx]) {
              currentCircuit.access_points[apIdx].photo_device = upData.url;
              renderAccessPointCards();
            }
          }
        }
      }).catch(() => {});
    }

    const candidates = await runBarcodeAndOcrOnDataUrl(compressedDataUrl, file, pct => {
      pctEl.textContent = `${pct}%`;
    });

    if (candidates.length > 0) {
      const best = candidates[0];
      statusText.textContent = `✅ อ่านรหัส S/N สำเร็จ! พบ ${candidates.length} รายการ`;
      pctEl.textContent = '100%';
      manualInput.value = best;
      applyDetectedSnToTarget(best, activeSnTarget, candidates);

      candBox.innerHTML = candidates.map(c => `
        <button type="button" onclick="selectSnCandidateFromModal('${c}')" class="px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-400 font-mono text-xs font-bold shadow-sm transition">
          ✓ ${c}
        </button>
      `).join('');
    } else {
      statusText.textContent = '⚠️ ไม่พบรูปแบบ S/N ที่ชัดเจน กรุณาตรวจสอบหรือพิมพ์แก้ไขด้านล่าง';
      pctEl.textContent = '';
    }
  } catch (err) {
    statusText.textContent = '❌ เกิดข้อผิดพลาดในการอ่านภาพ: ' + err.message;
  }
}

function selectSnCandidateFromModal(sn) {
  document.getElementById('snManualEditInput').value = sn;
  applyDetectedSnToTarget(sn, activeSnTarget);
  showToast(`เลือกใช้ S/N: ${sn} เรียบร้อยแล้ว`);
  closeSnScanner();
}

function applyManualSnFromModal() {
  const val = document.getElementById('snManualEditInput').value.trim().toUpperCase();
  if (!val) {
    showToast('กรุณาระบุรหัส S/N', true);
    return;
  }
  applyDetectedSnToTarget(val, activeSnTarget, [val]);
  showToast(`บันทึกรหัส S/N: ${val} ลงในฟอร์มแล้ว`);
  closeSnScanner();
}

async function readSnFromExistingPhoto(photoUrl, target) {
  showToast('🔍 กำลังสแกนอ่านรหัส S/N จากรูปถ่าย...');
  await autoExtractSnToField(photoUrl, target || 'router');
}

async function autoExtractSnToField(imageSource, target) {
  try {
    const candidates = await runBarcodeAndOcrOnDataUrl(imageSource, null, () => {});
    if (candidates.length > 0) {
      const best = candidates[0];
      applyDetectedSnToTarget(best, target, candidates);
      showToast(`✅ อ่านค่า S/N จากรูปสำเร็จ: ${best}`);
    } else {
      showToast('ไม่พบรหัส S/N อัตโนมัติในภาพ สามารถกดปุ่ม "📷 สแกน S/N" เพื่อถ่ายใกล้ขึ้นได้', true);
    }
  } catch (err) {
    console.warn('Auto OCR error:', err);
  }
}

function applyDetectedSnToTarget(snValue, target, allCandidates = []) {
  const cleanSn = (snValue || '').trim().toUpperCase();
  if (target && target.startsWith('site_')) {
    const m = target.match(/^site_(\d+)_(router|ap_(\d+))$/);
    if (m) {
      const cIdx = Number(m[1]);
      if (m[2] === 'router') {
        const ocrInput = document.getElementById(`sc_${cIdx}_rOcrSn`);
        const manualInput = document.getElementById(`sc_${cIdx}_rSn`);
        if (ocrInput) ocrInput.value = cleanSn;
        if (manualInput && !manualInput.value.trim()) manualInput.value = cleanSn;
      } else {
        const apIdx = Number(m[3]);
        const ocrInput = document.getElementById(`sc_${cIdx}_apOcrSn_${apIdx}`);
        const manualInput = document.getElementById(`sc_${cIdx}_apSn_${apIdx}`);
        if (ocrInput) ocrInput.value = cleanSn;
        if (manualInput && !manualInput.value.trim()) manualInput.value = cleanSn;
      }
      onAdditionalCircuitInput(cIdx);
      return;
    }
  }

  if (target === 'router') {
    const ocrInput = document.getElementById('rOcrSerialNo');
    const manualInput = document.getElementById('rSerialNo');
    if (ocrInput) {
      ocrInput.value = cleanSn;
      ocrInput.classList.add('ring-2', 'ring-indigo-500', 'bg-indigo-100');
      setTimeout(() => ocrInput.classList.remove('ring-2', 'ring-indigo-500', 'bg-indigo-100'), 2200);
    }
    // If manual technician input is still empty, prefill or let technician recheck
    if (manualInput && !manualInput.value.trim()) {
      manualInput.value = cleanSn;
    }
    updateRouterStickerPreview();
    validateRouterSnRecheck();
    const candContainer = document.getElementById('rSnCandidates');
    if (candContainer && allCandidates.length > 0) {
      candContainer.innerHTML = `<span class="text-slate-500">S/N ที่อ่านได้จากรูป (คลิกเพื่อใส่ช่องช่างกรอก):</span>` +
        allCandidates.map(c => `
          <button type="button" onclick="document.getElementById('rOcrSerialNo').value='${c}';document.getElementById('rSerialNo').value='${c}';updateRouterStickerPreview();validateRouterSnRecheck();" class="px-2 py-0.5 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 font-mono font-bold">
            ${c}
          </button>
        `).join('');
    }
  } else if (target && target.startsWith('ap_')) {
    const idx = Number(target.replace('ap_', ''));
    const ocrInput = document.getElementById(`apOcrSn_${idx}`);
    const manualInput = document.getElementById(`apSn_${idx}`);
    if (ocrInput) {
      ocrInput.value = cleanSn;
      ocrInput.classList.add('ring-2', 'ring-indigo-500', 'bg-indigo-100');
      setTimeout(() => ocrInput.classList.remove('ring-2', 'ring-indigo-500', 'bg-indigo-100'), 2200);
    }
    if (manualInput && !manualInput.value.trim()) {
      manualInput.value = cleanSn;
    }
    if (currentCircuit && currentCircuit.access_points[idx]) {
      currentCircuit.access_points[idx].ocr_serial_no = cleanSn;
      if (manualInput) currentCircuit.access_points[idx].serial_no = manualInput.value.trim().toUpperCase();
    }
    onApSpeedOrStickerInput(idx);
    const candContainer = document.getElementById(`apSnCandidates_${idx}`);
    if (candContainer && allCandidates.length > 0) {
      candContainer.innerHTML = `<span class="text-slate-500">S/N ที่อ่านได้จากรูป (คลิกเพื่อยืนยัน):</span>` +
        allCandidates.map(c => `
          <button type="button" onclick="document.getElementById('apOcrSn_${idx}').value='${c}';document.getElementById('apSn_${idx}').value='${c}';onApSpeedOrStickerInput(${idx});" class="px-2 py-0.5 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 font-mono font-bold">
            ${c}
          </button>
        `).join('');
    }
  }
}

async function runBarcodeAndOcrOnDataUrl(imageUrlOrDataUrl, rawFile, onProgress) {
  const results = [];

  // 1. Try native BarcodeDetector first if available in browser
  if ('BarcodeDetector' in window) {
    try {
      const img = await loadImageElement(imageUrlOrDataUrl);
      const detector = new BarcodeDetector();
      const barcodes = await detector.detect(img);
      for (const b of barcodes) {
        const val = (b.rawValue || '').trim().toUpperCase();
        if (val && val.length >= 6 && !results.includes(val)) {
          results.push(val);
        }
      }
    } catch (_) {}
  }

  // 2. Try Html5Qrcode file scan if rawFile is provided
  if (rawFile && window.Html5Qrcode) {
    try {
      const tempDivId = 'tempQrFileScanner';
      let tempDiv = document.getElementById(tempDivId);
      if (!tempDiv) {
        tempDiv = document.createElement('div');
        tempDiv.id = tempDivId;
        tempDiv.style.display = 'none';
        document.body.appendChild(tempDiv);
      }
      const qr = new Html5Qrcode(tempDivId);
      const decoded = await qr.scanFile(rawFile, false);
      if (decoded) {
        const val = decoded.trim().toUpperCase();
        if (val && !results.includes(val)) results.push(val);
      }
    } catch (_) {}
  }

  // 3. Run Tesseract.js OCR with contrast preprocessing
  if (window.Tesseract) {
    const enhancedDataUrl = await preprocessImageForOcr(imageUrlOrDataUrl);
    const ocrResult = await Tesseract.recognize(enhancedDataUrl, 'eng', {
      logger: m => {
        if (m.status === 'recognizing text' && typeof m.progress === 'number' && onProgress) {
          onProgress(Math.round(m.progress * 100));
        }
      }
    });
    const rawText = ocrResult?.data?.text || '';
    const extracted = extractSerialCandidatesFromText(rawText);
    for (const item of extracted) {
      if (!results.includes(item)) results.push(item);
    }
  }

  return results;
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function preprocessImageForOcr(src) {
  try {
    const img = await loadImageElement(src);
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imgData.data;
    // Enhance contrast in grayscale so handwritten & printed S/N characters stand out
    for (let i = 0; i < d.length; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const contrasted = gray < 135 ? Math.max(0, gray * 0.7) : Math.min(255, gray * 1.18 + 20);
      d[i] = d[i + 1] = d[i + 2] = contrasted;
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.92);
  } catch (_) {
    return src;
  }
}

function extractSerialCandidatesFromText(rawText) {
  if (!rawText) return [];
  const IGNORE_WORDS = new Set([
    'MIKROTIK', 'ROUTERBOARD', 'TOTOLINK', 'TPLINK', 'TP-LINK', 'DLINK', 'D-LINK',
    'SERIAL', 'NUMBER', 'SERVICE', 'ROUTER', 'ACCESS', 'POINT', '1TOALL', '1TOALL.',
    'RB3011', 'RB4011', 'RBD52G', 'A3002RU', 'ARCHER', 'USERNAME', 'PASSWORD',
    'ADMIN', 'DEFAULT', 'MACADDRESS', 'INTERNET', '5500MBPS', '1000MBPS'
  ]);

  const scored = new Map();

  const addCandidate = (token, score) => {
    const clean = token.replace(/[^A-Z0-9]/g, '').toUpperCase();
    if (clean.length < 8 || clean.length > 20) return;
    if (IGNORE_WORDS.has(clean)) return;
    // Ignore BINF348xxxx circuit IDs so we don't confuse circuit ID with S/N
    if (clean.startsWith('BINF') || clean.startsWith('BINL') || /^3480\d{3}$/.test(clean)) return;
    // Must contain at least one digit and one letter (or be a valid 11-16 digit serial)
    const hasLetter = /[A-Z]/.test(clean);
    const hasDigit = /\d/.test(clean);
    if (!hasDigit) return;
    if (!hasLetter && clean.length < 10) return;

    let bonus = score;
    // TOTOLINK A3002RU full serial e.g. A3002RU191B05936
    if (/^A3002RU[A-Z0-9]{6,12}$/.test(clean)) bonus += 50;
    // MikroTik serial patterns e.g. BEEE0AE53C0C, 8EEE0ABB3F62, HH90A4P0GZY, HF20956RTRC
    if (/^(8EEE|BEEE|9EEE|HH9|HF2|HE[0-9A-Z]|HD[0-9A-Z])[A-Z0-9]{7,9}$/.test(clean)) bonus += 45;
    if (clean.length >= 11 && clean.length <= 17 && hasLetter && hasDigit) bonus += 20;

    const prev = scored.get(clean) || 0;
    if (bonus > prev) scored.set(clean, bonus);
  };

  const lines = rawText.split(/\r?\n/);
  for (const line of lines) {
    const upperLine = line.toUpperCase();
    const isSnLine = /SERIAL|S\/N|\bSN\b|NUMBER/.test(upperLine);
    // Check explicit "S/N: XXXX" or "Serial Number ... XXXX"
    const snMatch = upperLine.match(/(?:SERIAL\s*(?:NUMBER|NO\.?)?|S\/N|\bSN\b)[^A-Z0-9]*([A-Z0-9-]{8,20})/);
    if (snMatch && snMatch[1]) {
      addCandidate(snMatch[1], 60);
    }

    const tokens = upperLine.split(/[\s,:;|/\\()[\]]+/);
    for (const tk of tokens) {
      if (tk.length >= 8) {
        addCandidate(tk, isSnLine ? 35 : 10);
      }
    }
  }

  return Array.from(scored.entries())
    .sort((a, b) => b[1] - a[1])
    .map(entry => entry[0])
    .slice(0, 6);
}

// ============================================================================
// LINE Bot Onsite Simulator & Webhook Integration (Steps 1 - 6)
// ============================================================================
const SIM_LINE_USER_ID = 'sim_tech_01';
let lineSimState = null;

async function loadLineBotTab() {
  try {
    // Populate Province & Circuit dropdowns for LINE Check-in
    const provSel = document.getElementById('lineSelectProvince');
    if (provSel && provSel.options.length <= 1 && Array.isArray(allCircuits) && allCircuits.length > 0) {
      const provinces = Array.from(new Set(allCircuits.map(c => c.province)))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, 'th'));
      provSel.innerHTML = `<option value="">-- เลือกจังหวัด (${provinces.length} จังหวัด) --</option>` +
        provinces.map(p => `<option value="${p}">${p}</option>`).join('');
      onLineProvinceSelectChange();
    }

    // Load Webhook config
    const cfgRes = await fetch('/api/line/config').then(r => r.json());
    updateLineConfigUi(cfgRes);

    // Load simulator state & chat history
    const res = await fetch(`/api/line/state?userId=${encodeURIComponent(SIM_LINE_USER_ID)}`);
    const data = await res.json();
    applyLineBotStateToUi(data);
  } catch (err) {
    console.error('loadLineBotTab error:', err);
  }
}

function updateLineConfigUi(cfgRes) {
  if (!cfgRes) return;
  const pubInput = document.getElementById('cfgLinePublicUrl');
  if (pubInput && cfgRes.publicBaseUrl && !pubInput.value.trim()) {
    pubInput.value = cfgRes.publicBaseUrl;
  }
  const baseUrl = (cfgRes.publicBaseUrl || pubInput?.value.trim() || location.origin).replace(/\/$/, '');
  const whInput = document.getElementById('cfgLineWebhookUrl');
  if (whInput) {
    whInput.value = `${baseUrl}${cfgRes.webhookPath || '/api/line/webhook'}`;
  }

  const badge = document.getElementById('lineConfigStatusBadge');
  if (badge) {
    if (cfgRes.configured) {
      badge.textContent = '✅ เชื่อมต่อ LINE Messaging API แล้ว (พร้อมรับ Webhook จริง + โหมดจำลอง)';
      badge.className = 'text-xs font-extrabold px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300';
    } else {
      badge.textContent = '🟢 โหมดจำลองพร้อมใช้งาน (คลิกปุ่มตั้งค่าขวาบนเพื่อผูก LINE OA จริง)';
      badge.className = 'text-xs font-bold px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200';
    }
  }
}

function toggleLineSettingsBox() {
  const box = document.getElementById('lineSettingsBox');
  if (!box) return;
  const willShow = box.classList.contains('hidden');
  box.classList.toggle('hidden');
  if (willShow) {
    const whInput = document.getElementById('cfgLineWebhookUrl');
    const pubInput = document.getElementById('cfgLinePublicUrl');
    if (whInput && !whInput.value.trim()) {
      const base = (pubInput?.value.trim() || location.origin).replace(/\/$/, '');
      whInput.value = `${base}/api/line/webhook`;
    }
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

async function saveLineBotConfig() {
  try {
    const public_base_url = document.getElementById('cfgLinePublicUrl')?.value.trim() || '';
    const channel_secret = document.getElementById('cfgLineSecret')?.value.trim() || '';
    const channel_access_token = document.getElementById('cfgLineToken')?.value.trim() || '';

    const res = await fetch('/api/line/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        public_base_url,
        channel_secret,
        channel_access_token
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'บันทึกตั้งค่า LINE OA ไม่สำเร็จ');

    const cfgRes = await fetch('/api/line/config').then(r => r.json());
    updateLineConfigUi(cfgRes);
    showToast('✅ บันทึกการตั้งค่า LINE Messaging API Webhook เรียบร้อยแล้ว');
  } catch (err) {
    showToast(err.message, true);
  }
}

function onLineProvinceSelectChange() {
  const prov = document.getElementById('lineSelectProvince')?.value || '';
  const cirSel = document.getElementById('lineSelectCircuit');
  if (!cirSel) return;
  const list = prov ? allCircuits.filter(c => c.province === prov) : allCircuits.slice(0, 60);
  cirSel.innerHTML = `<option value="">-- เลือกวงจร (${list.length} วงจร) --</option>` +
    list.map((c, idx) => `<option value="${c.so_number}">#${idx + 1} ${c.so_number} — ${extractShortSubBranchLabel(c)}</option>`).join('');
}

function onLineCircuitSelectChange() {
  const so = document.getElementById('lineSelectCircuit')?.value || '';
  if (!so) return;
  const c = allCircuits.find(item => item.so_number === so);
  if (c) {
    const nameInput = document.getElementById('lineTechName');
    const phoneInput = document.getElementById('lineTechPhone');
    if (nameInput && !nameInput.value.trim() && c.inspector_name) nameInput.value = c.inspector_name;
    if (phoneInput && !phoneInput.value.trim() && c.inspector_phone) phoneInput.value = c.inspector_phone;
  }
}

function applyLineBotStateToUi(data) {
  if (!data) return;
  lineSimState = data;

  const c = data.activeCircuit || data.circuit || null;
  const headerEl = document.getElementById('lineActiveCircuitHeader');
  const badge = document.getElementById('lineCheckinBadge');
  const sideSub = document.getElementById('lineSideCircuitSubtitle');
  const wordBtn = document.getElementById('btnLineDownloadDocx');

  if (c) {
    if (headerEl) {
      headerEl.textContent = `📍 ${c.so_number} • ${c.province} (${extractShortSubBranchLabel(c)})`;
    }
    if (badge) {
      if (c.checkin_status === 'checked_out') {
        badge.textContent = `🏁 Checked-out แล้ว`;
        badge.className = 'px-2.5 py-1 rounded-full bg-indigo-300 text-slate-950 text-[11px] font-extrabold shadow-sm';
      } else {
        badge.textContent = `📍 Checked-in (${c.inspector_name || 'ช่าง'})`;
        badge.className = 'px-2.5 py-1 rounded-full bg-emerald-400 text-slate-950 text-[11px] font-extrabold shadow-sm';
      }
    }
    if (sideSub) {
      sideSub.textContent = `วงจร ${c.so_number} • ${c.branch_name || c.province} (ผู้ตรวจ: ${c.inspector_name || '-'})`;
    }
    if (wordBtn) {
      wordBtn.classList.remove('hidden');
    }

    const provSel = document.getElementById('lineSelectProvince');
    if (provSel && provSel.value !== c.province) {
      provSel.value = c.province;
      onLineProvinceSelectChange();
    }
    const cirSel = document.getElementById('lineSelectCircuit');
    if (cirSel) cirSel.value = c.so_number;

    if (data.userState?.pending_slot) {
      const slotSel = document.getElementById('lineActiveSlotSelect');
      if (slotSel && slotSel.value !== data.userState.pending_slot) {
        slotSel.value = data.userState.pending_slot;
      }
    }

    syncLineSnFieldsFromCircuit(c);
  } else {
    if (headerEl) {
      headerEl.textContent = 'ยังไม่ได้ Check-in วงจร';
    }
    if (badge) {
      badge.textContent = 'ยังไม่ Check-in';
      badge.className = 'px-2.5 py-1 rounded-full bg-emerald-800 text-emerald-100 text-[11px] font-bold';
    }
    if (sideSub) {
      sideSub.textContent = 'กรุณา Check-in วงจรในแชทด้านซ้ายเพื่อเริ่มตรวจความครบถ้วน';
    }
    if (wordBtn) wordBtn.classList.add('hidden');
  }

  // Render Completeness summary in Right Column
  const comp = data.completeness;
  const pctText = document.getElementById('linePhotoProgressText');
  const bar = document.getElementById('linePhotoProgressBar');
  const checklistEl = document.getElementById('linePhotoSlotsChecklist');
  const snListEl = document.getElementById('lineSnRecheckList');

  if (comp) {
    if (pctText) {
      pctText.textContent = `${comp.uploadedRequiredCount} / ${comp.totalRequiredCount} รูป (${comp.photoProgressPct}%)`;
      pctText.className = comp.allRequiredPhotosComplete
        ? 'text-xs font-extrabold text-emerald-700'
        : 'text-xs font-extrabold text-amber-700';
    }
    if (bar) {
      bar.style.width = `${comp.photoProgressPct}%`;
      bar.className = comp.allRequiredPhotosComplete
        ? 'h-full bg-emerald-500 transition-all duration-300'
        : 'h-full bg-amber-500 transition-all duration-300';
    }
    if (checklistEl) {
      const currentSlot = document.getElementById('lineActiveSlotSelect')?.value || 'router_device';
      checklistEl.innerHTML = (comp.requiredPhotos || []).map(p => {
        const isCurrent = p.key === currentSlot;
        return `
          <div onclick="selectLinePhotoSlotFromChecklist('${p.key}')"
               class="cursor-pointer px-2.5 py-2 rounded-xl border text-xs flex items-center justify-between gap-2 transition ${
                 p.uploaded
                   ? 'bg-emerald-50/90 border-emerald-300 text-emerald-950 font-bold'
                   : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
               } ${isCurrent ? 'ring-2 ring-emerald-500 shadow-sm' : ''}">
            <div class="flex items-center gap-2 min-w-0">
              <span>${p.uploaded ? '✅' : '⬜'}</span>
              <span class="truncate">${p.label}</span>
              ${p.requiresSn ? `<span class="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-extrabold shrink-0">S/N+OCR</span>` : ''}
            </div>
            <span class="text-[10px] font-bold shrink-0 ${p.uploaded ? 'text-emerald-700' : 'text-slate-400'}">
              ${p.uploaded ? 'มีรูปแล้ว' : 'คลิกเพื่อส่งรูป'}
            </span>
          </div>
        `;
      }).join('');
    }
    if (snListEl) {
      snListEl.innerHTML = (comp.snComparisons || []).map(s => {
        const slotKey = s.key === 'router' ? 'router_device' : s.key === 'ap_0' ? 'ap_0_device' : 'ap_1_device';
        let badgeHtml = `<span class="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold">⬜ ยังไม่ระบุ</span>`;
        let boxCls = 'bg-slate-50 border-slate-200';
        if (s.status === 'matched') {
          badgeHtml = `<span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 text-[10px] font-extrabold">✅ ตรงกัน 100%</span>`;
          boxCls = 'bg-emerald-50/60 border-emerald-300';
        } else if (s.status === 'mismatch') {
          badgeHtml = `<span class="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-300 text-[10px] font-extrabold">❌ ไม่ตรงกัน!</span>`;
          boxCls = 'bg-rose-50/70 border-rose-300';
        } else if (s.status === 'manual_only' || s.status === 'ocr_only') {
          badgeHtml = `<span class="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300 text-[10px] font-bold">⚠️ มีค่าฝั่งเดียว</span>`;
          boxCls = 'bg-amber-50/60 border-amber-200';
        }
        return `
          <div onclick="selectLinePhotoSlotFromChecklist('${slotKey}')"
               class="cursor-pointer p-2.5 rounded-xl border ${boxCls} transition hover:shadow-sm">
            <div class="flex items-center justify-between gap-2 mb-1">
              <span class="text-xs font-extrabold text-slate-800">${s.deviceLabel}</span>
              ${badgeHtml}
            </div>
            <div class="grid grid-cols-2 gap-1.5 text-[11px] font-mono">
              <div class="bg-white/90 px-2 py-1 rounded border border-slate-200 truncate">
                <span class="text-[10px] font-sans text-slate-400 block">🤖 OCR แปลงจากรูป:</span>
                <strong class="text-emerald-800">${s.ocrSn || '-'}</strong>
              </div>
              <div class="bg-white/90 px-2 py-1 rounded border border-slate-200 truncate">
                <span class="text-[10px] font-sans text-slate-400 block">✍️ ช่างกรอกยืนยัน:</span>
                <strong class="text-indigo-800">${s.manualSn || '-'}</strong>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }
  } else {
    if (pctText) pctText.textContent = '0 / 11 รูป (0%)';
    if (bar) bar.style.width = '0%';
    if (checklistEl) {
      checklistEl.innerHTML = `<div class="text-xs text-slate-400 text-center py-6">กรุณา Check-in วงจรเพื่อดูรายการรูปถ่ายบังคับ 11 จุด (9 รูปอุปกรณ์ + 2 หน้าใบส่งมอบ)</div>`;
    }
    if (snListEl) {
      snListEl.innerHTML = `<div class="text-xs text-slate-400 text-center py-4">กรุณา Check-in วงจรเพื่อตรวจสอบ S/N (OCR vs ช่างกรอก)</div>`;
    }
  }

  renderLineChatMessages(data.messages || []);
}

function selectLinePhotoSlotFromChecklist(slotKey) {
  const sel = document.getElementById('lineActiveSlotSelect');
  if (!sel) return;
  sel.value = slotKey;
  onLineSlotSelectChange();
}

function syncLineSnFieldsFromCircuit(c) {
  if (!c) return;
  const slot = document.getElementById('lineActiveSlotSelect')?.value || 'router_device';
  const manualEl = document.getElementById('lineManualSnInput');
  const ocrEl = document.getElementById('lineOcrSnInput');
  const recheckPanel = document.getElementById('lineSnRecheckPanel');

  const isSnSlot = slot === 'router_device' || slot === 'ap1_device' || slot === 'ap_0_device' || slot === 'ap2_device' || slot === 'ap_1_device';
  if (recheckPanel) {
    if (isSnSlot) recheckPanel.classList.remove('hidden');
    else recheckPanel.classList.add('hidden');
  }

  if (!manualEl || !ocrEl) return;
  if (slot === 'router_device') {
    manualEl.value = c.router_info?.serial_no || '';
    ocrEl.value = c.router_info?.ocr_serial_no || '';
  } else if (slot === 'ap1_device' || slot === 'ap_0_device') {
    manualEl.value = c.access_points?.[0]?.serial_no || '';
    ocrEl.value = c.access_points?.[0]?.ocr_serial_no || '';
  } else if (slot === 'ap2_device' || slot === 'ap_1_device') {
    manualEl.value = c.access_points?.[1]?.serial_no || '';
    ocrEl.value = c.access_points?.[1]?.ocr_serial_no || '';
  }
  updateLineLiveSnComparison();
}

function renderLineChatMessages(messages) {
  const container = document.getElementById('lineChatMessagesBox');
  if (!container) return;

  if (!messages || messages.length === 0) {
    container.innerHTML = `
      <div class="text-center my-4">
        <span class="px-3 py-1.5 rounded-full bg-slate-900/30 text-white text-[11px] font-semibold shadow-sm inline-block">
          👋 ยินดีต้อนรับสู่ DLT Onsite LINE Bot! เลือกจังหวัด + วงจรด้านบนแล้วกด "📍 Check-in เข้า Site" ได้เลย
        </span>
      </div>
    `;
    return;
  }

  container.innerHTML = messages.map(m => {
    const isBot = m.sender_role === 'bot' || m.direction === 'outgoing';
    const timeStr = m.created_at ? new Date(m.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '';
    const escapedText = (m.message_text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
    const imgUrl = m.media_url || m.image_url || '';

    if (isBot) {
      return `
        <div class="flex items-start gap-2 max-w-[92%]">
          <div class="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center font-extrabold text-xs shrink-0 shadow">
            DLT
          </div>
          <div>
            <div class="text-[10px] font-bold text-slate-900 mb-0.5">DLT Onsite Bot ${m.so_number ? `• ${m.so_number}` : ''}</div>
            <div class="bg-white text-slate-800 rounded-2xl rounded-tl-none px-3.5 py-2.5 text-xs shadow-sm border border-slate-200 leading-relaxed">
              ${escapedText}
            </div>
            <div class="text-[10px] text-slate-800/80 mt-0.5 font-medium">${timeStr}</div>
          </div>
        </div>
      `;
    } else {
      return `
        <div class="flex flex-col items-end ml-auto max-w-[88%]">
          <div class="bg-[#a6e379] text-slate-900 rounded-2xl rounded-tr-none px-3.5 py-2.5 text-xs shadow-sm font-medium leading-relaxed">
            ${imgUrl ? `<img src="${imgUrl}" class="w-44 h-32 object-cover rounded-lg mb-1.5 border border-emerald-600/30 bg-white" />` : ''}
            <div>${escapedText}</div>
          </div>
          <div class="text-[10px] text-slate-800/80 mt-0.5 font-medium">อ่านแล้ว • ${timeStr}</div>
        </div>
      `;
    }
  }).join('');

  container.scrollTop = container.scrollHeight;
}

async function triggerLineCheckin() {
  const soNumber = document.getElementById('lineSelectCircuit')?.value.trim() || '';
  if (!soNumber) {
    showToast('กรุณาเลือกจังหวัดและหมายเลขวงจร (BINF...) ที่ต้องการ Check-in', true);
    return;
  }
  const techName = document.getElementById('lineTechName')?.value.trim() || 'ช่างหน้างาน';
  const techPhone = document.getElementById('lineTechPhone')?.value.trim() || '';

  try {
    const res = await fetch('/api/line/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        line_user_id: SIM_LINE_USER_ID,
        action: 'checkin',
        so_number: soNumber,
        tech_name: techName,
        tech_phone: techPhone
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'LINE Check-in ไม่สำเร็จ');
    applyLineBotStateToUi(data);
    showToast(`📍 LINE Bot Check-in วงจร ${soNumber} สำเร็จ!`);
    await refreshAllData();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function onLineSlotSelectChange() {
  const slot = document.getElementById('lineActiveSlotSelect')?.value || 'router_device';
  const activeCircuit = lineSimState?.activeCircuit || lineSimState?.circuit;
  if (activeCircuit) {
    syncLineSnFieldsFromCircuit(activeCircuit);
  } else {
    const recheckPanel = document.getElementById('lineSnRecheckPanel');
    const isSnSlot = slot === 'router_device' || slot === 'ap1_device' || slot === 'ap_0_device' || slot === 'ap2_device' || slot === 'ap_1_device';
    if (recheckPanel) {
      if (isSnSlot) recheckPanel.classList.remove('hidden');
      else recheckPanel.classList.add('hidden');
    }
  }
  try {
    const res = await fetch('/api/line/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        line_user_id: SIM_LINE_USER_ID,
        action: 'select_slot',
        slot_key: slot
      })
    });
    const data = await res.json();
    if (res.ok) applyLineBotStateToUi(data);
  } catch (_) {}
}

async function onLinePhotoFileSelected(inputOrEvent) {
  const inputEl = inputOrEvent?.target ? inputOrEvent.target : inputOrEvent;
  const file = inputEl?.files?.[0];
  if (!file) return;

  const activeSo = (lineSimState?.activeCircuit || lineSimState?.circuit)?.so_number ||
    document.getElementById('lineSelectCircuit')?.value || '';
  if (!activeSo) {
    showToast('กรุณากด "📍 Check-in เข้า Site" ก่อนส่งรูปถ่ายเข้า LINE Bot', true);
    if (inputEl) inputEl.value = '';
    return;
  }

  const slot = document.getElementById('lineActiveSlotSelect')?.value || 'router_device';
  const isSnSlot = slot === 'router_device' || slot === 'ap1_device' || slot === 'ap_0_device' || slot === 'ap2_device' || slot === 'ap_1_device';

  try {
    showToast('📸 กำลังบีบอัดรูปและส่งเข้า LINE Bot...');
    const compressedDataUrl = await compressImageFile(file, 1400, 0.85);
    let detectedOcrSn = (document.getElementById('lineOcrSnInput')?.value || '').trim().toUpperCase();

    if (isSnSlot) {
      showToast('🤖 ระบบ OCR กำลังสแกนหา S/N จากรูปสติ๊กเกอร์...');
      const candidates = await runBarcodeAndOcrOnDataUrl(compressedDataUrl, file, () => {});
      if (candidates && candidates.length > 0) {
        detectedOcrSn = candidates[0];
        const ocrInput = document.getElementById('lineOcrSnInput');
        if (ocrInput) ocrInput.value = detectedOcrSn;
      }
    }

    const manualSn = (document.getElementById('lineManualSnInput')?.value || '').trim().toUpperCase();

    const res = await fetch('/api/line/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        line_user_id: SIM_LINE_USER_ID,
        action: 'upload_photo',
        so_number: activeSo,
        slot_key: slot,
        data_url: compressedDataUrl,
        ocr_sn: detectedOcrSn,
        manual_sn: manualSn
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'อัปโหลดรูปผ่าน LINE Bot ไม่สำเร็จ');
    applyLineBotStateToUi(data);
    updateLineLiveSnComparison();
    showToast(detectedOcrSn ? `✅ ส่งรูปและแปลง OCR สำเร็จ: ${detectedOcrSn}` : '✅ ส่งรูปเข้า LINE Bot สำเร็จ');
    await refreshAllData();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    if (inputEl) inputEl.value = '';
  }
}

function updateLineLiveSnComparison() {
  const manualVal = document.getElementById('lineManualSnInput')?.value || '';
  const ocrVal = document.getElementById('lineOcrSnInput')?.value || '';
  const badge = document.getElementById('lineSnMatchLiveBadge');
  if (!badge) return;
  const cmp = compareSnStringsClient(manualVal, ocrVal);
  badge.className = `px-2.5 py-0.5 rounded-full text-[11px] font-bold ${cmp.cls}`;
  badge.textContent = cmp.label;
}

function copyLineOcrToManual() {
  const ocrVal = (document.getElementById('lineOcrSnInput')?.value || '').trim().toUpperCase();
  if (!ocrVal) {
    showToast('ยังไม่มีค่า S/N จาก OCR กรุณาถ่ายรูปสติ๊กเกอร์หรือพิมพ์ค่า OCR ก่อน', true);
    return;
  }
  const manualEl = document.getElementById('lineManualSnInput');
  if (manualEl) {
    manualEl.value = ocrVal;
    updateLineLiveSnComparison();
    submitLineSnRecheckOnly();
  }
}

async function submitLineSnRecheckOnly() {
  const activeSo = (lineSimState?.activeCircuit || lineSimState?.circuit)?.so_number ||
    document.getElementById('lineSelectCircuit')?.value || '';
  if (!activeSo) {
    showToast('กรุณา Check-in วงจรที่จะบันทึก S/N ก่อน', true);
    return;
  }

  const slot = document.getElementById('lineActiveSlotSelect')?.value || 'router_device';
  const target = (slot === 'ap1_device' || slot === 'ap_0_device') ? 'ap_0' : (slot === 'ap2_device' || slot === 'ap_1_device') ? 'ap_1' : 'router';
  const manualSn = (document.getElementById('lineManualSnInput')?.value || '').trim().toUpperCase();
  const ocrSn = (document.getElementById('lineOcrSnInput')?.value || '').trim().toUpperCase();

  if (!manualSn && !ocrSn) {
    showToast('กรุณากรอก S/N หรือถ่ายรูปเพื่อให้ OCR อ่านค่าก่อน', true);
    return;
  }
  try {
    const res = await fetch('/api/line/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        line_user_id: SIM_LINE_USER_ID,
        action: 'recheck_sn',
        so_number: activeSo,
        target,
        manual_sn: manualSn,
        ocr_sn: ocrSn
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'บันทึก S/N ไม่สำเร็จ');
    applyLineBotStateToUi(data);
    showToast('✅ บันทึกและตรวจสอบ S/N (ช่างกรอก vs OCR) เรียบร้อยแล้ว');
    await refreshAllData();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function triggerLineCheckCompleteness() {
  const activeSo = (lineSimState?.activeCircuit || lineSimState?.circuit)?.so_number ||
    document.getElementById('lineSelectCircuit')?.value || '';
  try {
    const res = await fetch('/api/line/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        line_user_id: SIM_LINE_USER_ID,
        action: 'check_completeness',
        so_number: activeSo
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'ตรวจสอบไม่สำเร็จ');
    applyLineBotStateToUi(data);
  } catch (err) {
    showToast(err.message, true);
  }
}

async function triggerLineCheckout(forceFlag = false) {
  const activeSo = (lineSimState?.activeCircuit || lineSimState?.circuit)?.so_number ||
    document.getElementById('lineSelectCircuit')?.value || '';
  if (!activeSo) {
    showToast('ยังไม่ได้ Check-in วงจร กรุณา Check-in ก่อน', true);
    return;
  }
  try {
    const res = await fetch('/api/line/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        line_user_id: SIM_LINE_USER_ID,
        action: 'checkout',
        so_number: activeSo,
        force: Boolean(forceFlag)
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Check-out ไม่สำเร็จ');
    applyLineBotStateToUi(data);

    // If incomplete and not yet forced, ask whether technician wants to force checkout to Admin
    const updatedCircuit = data.activeCircuit || data.circuit;
    if (!forceFlag && data.completeness && !data.completeness.readyForCheckout && updatedCircuit?.checkin_status !== 'checked_out') {
      const c = data.completeness;
      const askForce = confirm(
        `⚠️ ระบบแจ้งเตือนก่อน Check-out:\n` +
        `- รูปถ่าย: ${c.uploadedRequiredCount}/${c.totalRequiredCount} รูป\n` +
        `- S/N ไม่ตรงกัน/ยังไม่ครบ: ${c.snMismatchCount + c.snMissingCount} จุด\n\n` +
        `ต้องการยืนยันบังคับ Check-out เพื่อส่งให้ Admin ตรวจสอบหรือไม่?`
      );
      if (askForce) {
        await triggerLineCheckout(true);
        return;
      }
    } else {
      showToast('🏁 Check-out สำเร็จ! ส่งงานเข้าคิว Admin ตรวจสอบเรียบร้อยแล้ว');
    }
    await refreshAllData();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function sendLineFreeText() {
  const input = document.getElementById('lineFreeTextInput');
  const text = (input?.value || '').trim();
  if (!text) return;
  input.value = '';
  await sendQuickLineCommand(text);
}

async function sendQuickLineCommand(cmdText) {
  const text = (cmdText || '').trim();
  if (!text) return;
  try {
    const res = await fetch('/api/line/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        line_user_id: SIM_LINE_USER_ID,
        action: 'text',
        text
      })
    });
    const data = await res.json();
    if (res.ok) applyLineBotStateToUi(data);
    await refreshAllData();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function clearLineSimulatorChat() {
  try {
    const res = await fetch('/api/line/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        line_user_id: SIM_LINE_USER_ID,
        action: 'clear_chat'
      })
    });
    const data = await res.json();
    if (res.ok) applyLineBotStateToUi(data);
    showToast('ล้างประวัติแชทจำลองเรียบร้อยแล้ว');
  } catch (_) {}
}

function openActiveLineCircuitInModal() {
  const so = (lineSimState?.activeCircuit || lineSimState?.circuit)?.so_number ||
    document.getElementById('lineSelectCircuit')?.value;
  if (!so) {
    showToast('กรุณาเลือกวงจรหรือกด Check-in ก่อน', true);
    return;
  }
  openInspectionModal(so);
}

function downloadLineActiveCircuitDocx() {
  const so = (lineSimState?.activeCircuit || lineSimState?.circuit)?.so_number ||
    document.getElementById('lineSelectCircuit')?.value;
  if (!so) {
    showToast('กรุณาเลือกวงจรหรือกด Check-in ก่อนดาวน์โหลด Word', true);
    return;
  }
  window.open(`/api/circuits/${encodeURIComponent(so)}/report.docx`, '_blank');
}

// ============================================================================
// Admin QA & Coordinator Center (2. เจ้าหน้าที่ตรวจรับงานฝั่งบริษัท ประสานช่าง & ตรวจก่อนให้ช่างออก)
// ============================================================================
let adminOverviewData = null;
let currentAdminFilter = 'active_all';

async function loadAdminOverview() {
  try {
    const res = await fetch('/api/admin/overview');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'โหลดข้อมูลผู้ตรวจรับงานไม่สำเร็จ');
    adminOverviewData = data;

    const items = data.items || [];
    const activeAll = items.length;
    const pendingReview = items.filter(i => i.admin_status === 'pending_review').length;
    const working = items.filter(i => i.checkin_status === 'checked_in').length;
    const geccRemote = allCircuits.filter(c => {
      const aps = c.ap_summary || c.access_points || [];
      return aps.some(a => detectRoomSpec(a.room).isGecc);
    }).length;
    const snMismatch = items.filter(i => (i.completeness?.snMismatchCount || 0) > 0).length;
    const incompletePhotos = items.filter(i => !i.completeness?.allRequiredPhotosComplete).length;
    const approved = items.filter(i => i.admin_status === 'approved').length;

    const setEl = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val ?? 0;
    };
    setEl('admCountActiveAll', activeAll);
    setEl('admCountPendingReview', pendingReview);
    setEl('admCountWorking', working);
    setEl('admCountGeccRemote', geccRemote);
    setEl('admCountSnMismatch', snMismatch);
    setEl('admCountIncompletePhotos', incompletePhotos);
    setEl('admCountApproved', approved);

    renderAdminQueueTable();
  } catch (err) {
    showToast(err.message, true);
  }
}

function setAdminFilter(mode) {
  currentAdminFilter = mode || 'active_all';
  const cardMap = {
    active_all: 'admCardActiveAll',
    pending_review: 'admCardPendingReview',
    working: 'admCardWorking',
    gecc_remote: 'admCardGeccRemote',
    sn_mismatch: 'admCardSnMismatch',
    incomplete_photos: 'admCardIncompletePhotos',
    approved: 'admCardApproved'
  };
  Object.entries(cardMap).forEach(([key, cardId]) => {
    const el = document.getElementById(cardId);
    if (!el) return;
    if (key === currentAdminFilter) {
      el.classList.add('border-indigo-600', 'ring-2', 'ring-indigo-500/30');
      el.classList.remove('border-transparent');
    } else {
      el.classList.remove('border-indigo-600', 'ring-2', 'ring-indigo-500/30');
      el.classList.add('border-transparent');
    }
  });
  renderAdminQueueTable();
}

function filterAdminList(mode) {
  setAdminFilter(mode === 'all' ? 'active_all' : mode);
}

function renderAdminQueueTable() {
  const container = document.getElementById('adminQueueContainer');
  if (!container) return;

  const q = (document.getElementById('adminSearchInput')?.value || '').trim().toLowerCase();
  const activeItems = adminOverviewData?.items || [];
  const activeMap = new Map(activeItems.map(i => [i.so_number, i]));

  // When viewing 'all_334' or 'gecc_remote' or searching, merge with allCircuits so coordinator can inspect any of the 334 circuits
  let rows = (currentAdminFilter === 'all_334' || currentAdminFilter === 'gecc_remote' || q)
    ? allCircuits.map(c => activeMap.get(c.so_number) || c)
    : (activeItems.length > 0 ? activeItems : allCircuits.slice(0, 30));

  if (currentAdminFilter === 'pending_review') {
    rows = rows.filter(r => r.admin_status === 'pending_review');
  } else if (currentAdminFilter === 'working') {
    rows = rows.filter(r => r.checkin_status === 'checked_in');
  } else if (currentAdminFilter === 'gecc_remote') {
    rows = rows.filter(r => {
      const aps = r.access_points || r.ap_summary || [];
      return aps.some(a => detectRoomSpec(a.room).isGecc);
    });
  } else if (currentAdminFilter === 'sn_mismatch') {
    rows = rows.filter(r => (r.completeness?.snMismatchCount || 0) > 0);
  } else if (currentAdminFilter === 'incomplete_photos') {
    rows = rows.filter(r => !r.completeness?.allRequiredPhotosComplete);
  } else if (currentAdminFilter === 'approved') {
    rows = rows.filter(r => r.admin_status === 'approved');
  }

  if (q) {
    rows = rows.filter(r => {
      const aps = r.access_points || r.ap_summary || [];
      const anydeskStr = aps.map(a => a.gecc_anydesk_id || '').join(' ');
      const snStr = `${r.router_summary?.serial_no || ''} ` + aps.map(a => a.serial_no || '').join(' ');
      return (
        (r.so_number || '').toLowerCase().includes(q) ||
        (r.service_no || '').toLowerCase().includes(q) ||
        (r.province || '').toLowerCase().includes(q) ||
        (r.branch_name || '').toLowerCase().includes(q) ||
        (r.inspector_name || '').toLowerCase().includes(q) ||
        anydeskStr.toLowerCase().includes(q) ||
        snStr.toLowerCase().includes(q)
      );
    });
  }

  if (rows.length === 0) {
    container.innerHTML = `
      <div class="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-500 text-xs shadow-sm space-y-2">
        <p class="font-bold text-slate-700">ยังไม่มีรายการวงจรในตัวกรองหมวดนี้</p>
        <p>เมื่อช่างกด Check-in, บันทึกร่าง หรือส่งตรวจงานก่อนออกจากหน้างาน รายการจะแสดงที่นี่ทันที</p>
        <button type="button" onclick="setAdminFilter('all_334')" class="px-3.5 py-1.5 rounded-xl bg-indigo-600 text-white font-bold">
          ดูรายชื่อครบทั้ง 334 วงจร
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = rows.slice(0, 100).map(r => {
    const comp = r.completeness || {
      uploadedRequiredCount: r.photo_count || 0,
      totalRequiredCount: r.expected_photo_count || 8,
      missingPhotoLabels: [],
      snComparisons: []
    };
    const checkinStr = r.checkin_time ? new Date(r.checkin_time).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : 'ยังไม่ Check-in';
    const checkoutStr = r.checkout_time ? new Date(r.checkout_time).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : 'อยู่ในพื้นที่ / รอส่งตรวจ';

    const aps = r.access_points || r.ap_summary || [];
    const geccAp = aps.find(a => detectRoomSpec(a.room).isGecc);

    const snHtml = (comp.snComparisons && comp.snComparisons.length > 0)
      ? comp.snComparisons.map(s => {
          const icon = s.status === 'matched' ? '✅' : s.status === 'mismatch' ? '❌' : s.status === 'missing' ? '⬜' : '🔹';
          const cls = s.status === 'matched'
            ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
            : s.status === 'mismatch'
              ? 'bg-rose-50 text-rose-900 border-rose-300 font-bold'
              : 'bg-white text-slate-700 border-slate-200';
          return `
            <div class="px-2.5 py-1 rounded-lg border text-xs ${cls}">
              <div>${icon} <strong>${s.deviceLabel}</strong></div>
              <div class="font-mono text-[11px] mt-0.5">S/N: <code>${s.manualSn || '-'}</code> ${s.ocrSn ? `| OCR: <code>${s.ocrSn}</code>` : ''}</div>
            </div>
          `;
        }).join('')
      : `
        <div class="px-2.5 py-1 rounded-lg border bg-white text-slate-700 border-slate-200 text-xs">
          🖧 MikroTik (${r.router_summary?.model || 'RB3011'}): <code class="font-mono font-bold">${r.router_summary?.serial_no || '-'}</code>
        </div>
        ${aps.map((a, idx) => `
          <div class="px-2.5 py-1 rounded-lg border bg-white text-slate-700 border-slate-200 text-xs">
            📡 AP#${idx + 1} (${a.room || ''}): <code class="font-mono font-bold">${a.serial_no || '-'}</code>
          </div>
        `).join('')}
      `;

    let admBadge = `<span class="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-bold">⏳ รอช่างดำเนินการ</span>`;
    if (r.admin_status === 'pending_review') {
      admBadge = `<span class="px-3 py-1 rounded-full bg-amber-100 text-amber-800 border border-amber-300 text-xs font-extrabold animate-pulse">⏳ รอผู้ตรวจรับอนุมัติก่อนช่างออกจาก Site</span>`;
    } else if (r.admin_status === 'approved') {
      admBadge = `<span class="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 text-xs font-extrabold">✅ ตรวจผ่านแล้ว — ช่างออกจาก Site ได้ (${r.admin_reviewer || r.admin_name || '1-TO-ALL'})</span>`;
    } else if (r.admin_status === 'rejected') {
      admBadge = `<span class="px-3 py-1 rounded-full bg-rose-100 text-rose-800 border border-rose-300 text-xs font-extrabold">❌ ให้ช่างแก้ไขก่อนออก (${r.admin_review_note || r.admin_comment || '-'})</span>`;
    } else if (r.checkin_status === 'checked_in') {
      admBadge = `<span class="px-3 py-1 rounded-full bg-blue-100 text-blue-800 border border-blue-300 text-xs font-extrabold">🟢 ช่างกำลังอยู่ใน Site</span>`;
    }

    return `
      <div class="bg-white rounded-2xl border-2 ${r.admin_status === 'pending_review' ? 'border-amber-400' : 'border-slate-200'} p-4 shadow-sm hover:shadow-md transition">
        <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div class="flex flex-wrap items-center gap-2">
            <span class="px-2.5 py-1 rounded-lg bg-slate-900 text-white font-mono text-xs font-extrabold">${r.so_number}</span>
            <span class="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-xs font-bold">${r.service_no || '-'}</span>
            <span class="px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-800 text-xs font-extrabold">${r.province}</span>
            <span class="text-xs font-bold text-slate-800">${r.branch_name || ''}</span>
            ${admBadge}
          </div>
          <div class="flex items-center gap-1.5 flex-wrap">
            <button onclick="openInspectionModal('${r.so_number}')" class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold transition">
              🔍 ตรวจรูป/ข้อมูล
            </button>
            <a href="/report.html?id=${encodeURIComponent(r.so_number)}" target="_blank" class="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-extrabold transition">
              🖨️ รายงาน PDF (5.1 & 5.2)
            </a>
            <a href="/api/circuits/${encodeURIComponent(r.so_number)}/report.docx" target="_blank" class="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-extrabold transition">
              📝 Word
            </a>
            <button onclick="promptAdminReview('${r.so_number}', 'approved')" class="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold shadow-sm transition">
              ✅ อนุมัติให้ช่างออก
            </button>
            <button onclick="promptAdminReview('${r.so_number}', 'rejected')" class="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-extrabold shadow-sm transition">
              ❌ สั่งแก้ก่อนออก
            </button>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-3 pt-3">
          <div class="bg-slate-50 rounded-xl p-3 border border-slate-200/80 text-xs space-y-1">
            <div class="font-extrabold text-slate-700">1. ประสานช่างหน้างาน & ข้อมูลห้อง</div>
            <div>👷 ช่าง: <strong>${r.inspector_name || '-'}</strong> ${r.inspector_phone ? `(<a href="tel:${r.inspector_phone}" class="text-indigo-600 underline">${r.inspector_phone}</a>)` : ''}</div>
            <div class="text-emerald-700 font-semibold">📍 Check-in: ${checkinStr}</div>
            <div class="text-indigo-700 font-semibold">🏁 ส่งตรวจ: ${checkoutStr}</div>
            ${geccAp ? `
              <div class="mt-1.5 pt-1.5 border-t border-amber-200 bg-amber-50/80 rounded p-2 space-y-1 text-[11px]">
                <div class="font-extrabold text-amber-950">🔐 มีห้อง GECC (ต่อ LAN/WiFi ต้องลงทะเบียน Authen ก่อนเทส):</div>
                <div class="flex flex-wrap gap-1">
                  <span class="px-1.5 py-0.5 rounded ${geccAp.gecc_authen_wifi ? 'bg-emerald-100 text-emerald-800' : 'bg-white text-slate-600'} border">${geccAp.gecc_authen_wifi ? '✅ ลงทะเบียน Authen & เทสความเร็วแล้ว' : 'ℹ️ ทำเหมือนห้องปกติ (ลงทะเบียน Authen ก่อนเทส)'}</span>
                </div>
              </div>
            ` : `<div class="text-[11px] text-slate-500 pt-1">ℹ️ ห้องในวงจรนี้: ${aps.map(a => a.room).join(', ') || '-'}</div>`}
          </div>

          <div class="bg-slate-50 rounded-xl p-3 border border-slate-200/80 text-xs space-y-1.5">
            <div class="flex items-center justify-between gap-1 flex-wrap">
              <span class="font-extrabold text-slate-700">2. รูปอุปกรณ์หน้างาน & สแกนใบส่งมอบ</span>
              <div class="flex items-center gap-1 flex-wrap">
                <span class="px-2 py-0.5 rounded-full text-[11px] font-extrabold ${
                  comp.isOnsitePhotoComplete ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                }">📷 หน้างาน ${comp.onsiteUploadedCount ?? comp.uploadedRequiredCount}/${comp.onsiteRequiredCount ?? comp.totalRequiredCount}</span>
                <span class="px-2 py-0.5 rounded-full text-[11px] font-extrabold ${
                  comp.isHandoverComplete ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-200 text-slate-700'
                }">🖨️ ใบส่งมอบ ${comp.handoverUploadedCount ?? 0}/2 หน้า</span>
              </div>
            </div>
            ${(comp.missingOnsitePhotoLabels || []).length > 0 ? `
              <div class="text-[11px] text-rose-600 leading-relaxed">
                <strong>รูปหน้างานที่ยังขาด:</strong> ${comp.missingOnsitePhotoLabels.join(', ')}
              </div>
            ` : ((comp.onsiteUploadedCount ?? 0) > 0 ? `<div class="text-emerald-700 font-bold">✅ รูปอุปกรณ์และผลเทสความเร็วหน้างานครบถ้วนแล้ว</div>` : `<div class="text-slate-500 text-[11px]">รอช่างอัปโหลดรูปภาพอุปกรณ์และผลเทสความเร็ว</div>`)}
            <div class="text-[11px] ${comp.isHandoverComplete ? 'text-indigo-700 font-bold' : 'text-amber-800'}">
              ${comp.isHandoverComplete ? '✅ สแกนใบแบบส่งมอบงานครบทั้ง 2 หน้าแล้ว (พร้อมพิมพ์ PDF ส่งลูกค้า)' : '⏳ ใบแบบส่งมอบงาน (หน้า 1–2): สามารถใช้ Scanner สแกนตามหลังเข้าหน้างานได้'}
            </div>
          </div>

          <div class="bg-slate-50 rounded-xl p-3 border border-slate-200/80 text-xs space-y-1.5">
            <div class="font-extrabold text-slate-700">3. อุปกรณ์ & รหัส S/N ประจำวงจร</div>
            <div class="grid grid-cols-1 gap-1">
              ${snHtml}
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function promptAdminReview(soNumber, decision) {
  const adminName = document.getElementById('adminNameInput')?.value.trim() || 'เจ้าหน้าที่ตรวจรับ (1-TO-ALL)';
  let adminComment = '';
  if (decision === 'rejected') {
    adminComment = prompt(`ระบุสิ่งที่ต้องให้ช่างแก้ไขก่อนออกจากหน้างาน สำหรับวงจร ${soNumber}:`, 'กรุณาตรวจสอบรูปถ่าย Sticker S/N และผลเทสความเร็วให้ครบถ้วน');
    if (adminComment === null) return;
  } else {
    adminComment = prompt(`หมายเหตุการอนุมัติให้ช่างออกจาก Site สำหรับวงจร ${soNumber} (เว้นว่างได้):`, 'ตรวจสอบข้อมูล รูปถ่าย และผลทดสอบความเร็วครบถ้วน อนุมัติให้ช่างออกจากหน้างานได้');
    if (adminComment === null) return;
  }

  try {
    const res = await fetch(`/api/circuits/${encodeURIComponent(soNumber)}/admin-review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        decision,
        admin_name: adminName,
        admin_comment: adminComment
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'บันทึกผลตรวจรับงานไม่สำเร็จ');
    showToast(decision === 'approved'
      ? `✅ อนุมัติให้ช่างออกจาก Site วงจร ${soNumber} เรียบร้อยแล้ว!`
      : `⚠️ แจ้งให้ช่างแก้ไขวงจร ${soNumber} ก่อนออกจาก Site เรียบร้อยแล้ว`);
    await loadAdminOverview();
    await refreshAllData();
  } catch (err) {
    showToast(err.message, true);
  }
}

// ============================================================================
// Step 5: Scanner Handover PDF / Multi-Page Image Upload Helper
// (รองรับการสแกนใบแบบส่งมอบงาน หน้าที่ 1 และ 2 ด้วยเครื่อง Scanner ตามหลังเข้าหน้างาน)
// ============================================================================
async function renderPdfPageToDataUrl(pdfFile, preferredPage = 1) {
  if (typeof window.pdfjsLib === 'undefined') {
    throw new Error('ไม่พบไลบรารีแปลงไฟล์ PDF กรุณาเลือกไฟล์รูปภาพ (.jpg / .png) แทน');
  }
  if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
  const arrayBuf = await pdfFile.arrayBuffer();
  const pdfDoc = await window.pdfjsLib.getDocument({ data: arrayBuf }).promise;
  const pageNum = Math.min(Math.max(1, preferredPage), pdfDoc.numPages);
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: 2.0 });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL('image/jpeg', 0.88);
}

async function uploadHandoverPageDataUrl(slotKey, dataUrl) {
  if (!currentCircuit) return '';
  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      circuitId: currentCircuit.so_number,
      so_number: currentCircuit.so_number,
      slot: slotKey,
      category: slotKey,
      dataUrl,
      data_url: dataUrl
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'อัปโหลดไฟล์สแกนไม่สำเร็จ');
  return data.url;
}

async function handleScannerHandoverUpload(fileInput) {
  const files = Array.from(fileInput?.files || []);
  if (!files.length || !currentCircuit) return;
  if (!currentCircuit.router_info) currentCircuit.router_info = {};

  try {
    const firstFile = files[0];
    const isPdf = firstFile.type === 'application/pdf' || /\.pdf$/i.test(firstFile.name || '');

    if (isPdf) {
      showToast('🖨️ กำลังแยกหน้าไฟล์ PDF จากเครื่อง Scanner (หน้าที่ 1/2 และ 2/2)...');
      if (typeof window.pdfjsLib !== 'undefined' && !window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      }
      const arrayBuf = await firstFile.arrayBuffer();
      const pdfDoc = await window.pdfjsLib.getDocument({ data: arrayBuf }).promise;

      // Render Page 1
      const p1DataUrl = await renderPdfPageToDataUrl(firstFile, 1);
      const p1Url = await uploadHandoverPageDataUrl('handover_page1', p1DataUrl);
      currentCircuit.router_info.photo_handover_p1 = p1Url;
      currentCircuit.router_info.photo_signed_doc = p1Url;
      const chk1 = document.getElementById('chkDocFilled');
      if (chk1) chk1.checked = true;

      // If PDF has >= 2 pages, also render Page 2 automatically!
      if (pdfDoc.numPages >= 2) {
        const p2DataUrl = await renderPdfPageToDataUrl(firstFile, 2);
        const p2Url = await uploadHandoverPageDataUrl('handover_page2', p2DataUrl);
        currentCircuit.router_info.photo_handover_p2 = p2Url;
        const chk2 = document.getElementById('chkDocStamped');
        if (chk2) chk2.checked = true;
      }
    } else {
      showToast('🖨️ กำลังอัปโหลดไฟล์ภาพสแกนใบส่งมอบงาน...');
      const p1DataUrl = await compressImageFile(files[0], 1500, 0.88);
      const p1Url = await uploadHandoverPageDataUrl('handover_page1', p1DataUrl);
      currentCircuit.router_info.photo_handover_p1 = p1Url;
      currentCircuit.router_info.photo_signed_doc = p1Url;
      const chk1 = document.getElementById('chkDocFilled');
      if (chk1) chk1.checked = true;

      if (files.length >= 2) {
        const p2DataUrl = await compressImageFile(files[1], 1500, 0.88);
        const p2Url = await uploadHandoverPageDataUrl('handover_page2', p2DataUrl);
        currentCircuit.router_info.photo_handover_p2 = p2Url;
        const chk2 = document.getElementById('chkDocStamped');
        if (chk2) chk2.checked = true;
      }
    }

    // Sync the 1 Site Handover Form across all circuits in currentSiteCircuits
    const p1Synced = currentCircuit.router_info.photo_handover_p1 || '';
    const p2Synced = currentCircuit.router_info.photo_handover_p2 || '';
    (currentSiteCircuits || []).forEach(sc => {
      if (!sc.router_info) sc.router_info = {};
      if (p1Synced) {
        sc.router_info.photo_handover_p1 = p1Synced;
        sc.router_info.photo_signed_doc = p1Synced;
        sc.router_info.doc_filled = true;
      }
      if (p2Synced) {
        sc.router_info.photo_handover_p2 = p2Synced;
        sc.router_info.doc_stamped = true;
      }
    });

    // Re-render both handover upload slots & completeness bar
    renderPhotoSlot('slotSignedDocPhoto', 'handover_page1', '5.1 สำเนา "แบบส่งมอบงาน" ประจำ Site หน้าที่ 1/2 (วงจรที่ 1–3)', currentCircuit.router_info.photo_handover_p1, url => {
      currentCircuit.router_info.photo_handover_p1 = url;
      currentCircuit.router_info.photo_signed_doc = url;
      (currentSiteCircuits || []).forEach(sc => {
        if (!sc.router_info) sc.router_info = {};
        sc.router_info.photo_handover_p1 = url;
        sc.router_info.photo_signed_doc = url;
      });
      renderModalCompletenessBar();
    });
    renderPhotoSlot('slotSignedDocPage2Photo', 'handover_page2', '5.2 สำเนา "แบบส่งมอบงาน" ประจำ Site หน้าที่ 2/2 (วงจรที่ 4 + ลงนาม & ประทับตรา)', currentCircuit.router_info.photo_handover_p2, url => {
      currentCircuit.router_info.photo_handover_p2 = url;
      (currentSiteCircuits || []).forEach(sc => {
        if (!sc.router_info) sc.router_info = {};
        sc.router_info.photo_handover_p2 = url;
      });
      renderModalCompletenessBar();
    });
    renderModalCompletenessBar();
    await saveCurrentInspection(true);
    showToast('✅ อัปโหลดและบันทึกไฟล์สแกนใบแบบส่งมอบงานประจำ Site เรียบร้อยแล้ว!');
  } catch (err) {
    showToast('เกิดข้อผิดพลาดในการอัปโหลดไฟล์สแกน: ' + err.message, true);
  } finally {
    fileInput.value = '';
  }
}

// ============================================================================
// Step 6: Generate New Updated Summary Excel (.xlsx) for All 334 Circuits
// (ทำสรุป Excel ใหม่ตามข้อมูลห้อง อุปกรณ์ รหัส S/N และผลเทสความเร็วที่อัปเดตจริงในปีนี้)
// ============================================================================
async function exportUpdatedExcelSummary() {
  try {
    showToast('📊 กำลังสร้างไฟล์สรุป Excel ใหม่ (.xlsx) สำหรับทั้ง 334 วงจร...');
    if (!Array.isArray(allCircuits) || allCircuits.length === 0) {
      await refreshAllData();
    }
    if (typeof window.XLSX === 'undefined') {
      window.location.href = '/api/export/csv';
      return;
    }

    const circuitRows = [];
    const deviceRows = [];

    allCircuits.forEach((c, idx) => {
      const rt = c.router_info || {};
      const aps = Array.isArray(c.access_points) ? c.access_points.filter(a => a && a.checked !== false) : [];
      const comp = c.completeness || {};

      const roomListStr = aps.map(a => a.room || a.room_type || 'AP').join(' + ') || 'ไม่มี AP';
      const rtModel = rt.model || 'RB3011';
      const rtP2 = (rt.speed_lan2_dl || rt.speed_lan2_ul)
        ? `${rt.speed_lan2_dl || '-'}/${rt.speed_lan2_ul || '-'} Mbps`
        : (rt.photo_lan2 ? 'มีรูปผลเทส (≥650/350M)' : '-');
      const rtP3 = (rt.speed_lan3_dl || rt.speed_lan3_ul)
        ? `${rt.speed_lan3_dl || '-'}/${rt.speed_lan3_ul || '-'} Mbps`
        : (rt.photo_lan3 ? 'มีรูปผลเทส (≥650/350M)' : '-');

      const apSummaryText = aps.map((ap, i) => {
        const lanSpd = (ap.speed_lan_dl || ap.speed_lan_ul) ? `${ap.speed_lan_dl || '-'}/${ap.speed_lan_ul || '-'}M` : (ap.photo_lan ? 'มีรูปเทส' : '-');
        const wifiSpd = (ap.speed_wifi_dl || ap.speed_wifi_ul) ? `${ap.speed_wifi_dl || '-'}/${ap.speed_wifi_ul || '-'}M` : (ap.photo_wifi ? 'มีรูปเทส' : '-');
        return `[AP#${i + 1} ${ap.room || 'AP'}: ${ap.brand || 'TOTOLINK'} ${ap.model || ''} | ครุภัณฑ์:${displayApAssetNo(ap.asset_no)} | S/N:${ap.serial_no || '-'} | LAN:${lanSpd} | WiFi:${wifiSpd}]`;
      }).join(' ; ');

      const qaLabel = c.admin_status === 'approved'
        ? 'อนุมัติแล้ว'
        : c.admin_status === 'rejected'
          ? 'แจ้งแก้ไข'
          : c.admin_status === 'pending_review'
            ? 'รอตรวจรับ'
            : 'ยังไม่ส่งตรวจ';

      const statusLabel = c.status === 'completed'
        ? 'ส่งมอบแล้ว'
        : c.status === 'in_progress'
          ? 'กำลังดำเนินการ'
          : c.status === 'issue'
            ? 'ติดปัญหาหน้างาน'
            : 'รอดำเนินการ';

      circuitRows.push({
        'ลำดับ': c.seq || idx + 1,
        'เลขที่วงจร (S/O)': c.so_number || '',
        'Service No.': c.service_no || c.so_number || '',
        'ภูมิภาค': c.region || '',
        'จังหวัด': c.province || '',
        'ชื่อหน่วยงาน / สาขา': c.branch_name || '',
        'ความเร็ววงจร': c.speed_pkg || '650M/350M',
        'จำนวนห้อง/AP (ปีนี้)': aps.length,
        'รายชื่อห้องที่ใช้งานจริง (ปีนี้)': roomListStr,
        'Router ยี่ห้อ/รุ่น': `MikroTik ${rtModel}`,
        'Router เลขครุภัณฑ์': displayRouterAssetNo(rt.asset_no),
        'Router S/N (ใหม่/ยืนยัน)': rt.serial_no || '',
        'Router S/N (จาก OCR)': rt.ocr_serial_no || '',
        'ผลเทส Speed Port 2': rtP2,
        'ผลเทส Speed Port 3': rtP3,
        'รายละเอียดอุปกรณ์ Access Point ทุกห้อง': apSummaryText,
        'รูปอุปกรณ์+เทสหน้างาน': `${comp.onsiteUploadedCount ?? 0}/${comp.onsiteRequiredCount ?? (3 + aps.length * 3)}`,
        'สแกนใบส่งมอบงาน (หน้า 1-2)': `${comp.handoverUploadedCount ?? 0}/2 หน้า`,
        'สถานะตรวจรับ (บริษัท QA)': qaLabel,
        'ผู้ตรวจรับงาน (QA)': c.admin_name || c.admin_reviewer || '',
        'ช่างผู้เข้าดำเนินการ': c.inspector_name || '',
        'เบอร์โทรช่าง': c.inspector_phone || '',
        'วันที่เข้าดำเนินการ': c.inspection_date || '',
        'สถานะงาน': statusLabel,
        'หมายเหตุหน้างาน': c.remarks || ''
      });

      // Add Router row to Sheet 2
      deviceRows.push({
        'ลำดับวงจร': c.seq || idx + 1,
        'เลขที่วงจร (S/O)': c.so_number || '',
        'จังหวัด': c.province || '',
        'ชื่อหน่วยงาน / สาขา': c.branch_name || '',
        'ประเภทอุปกรณ์': '1. Router (MikroTik)',
        'ลำดับอุปกรณ์ในวงจร': 'Router ตัวที่ 1',
        'ห้องที่ติดตั้ง': rt.room || 'ห้อง Server / Rack',
        'ชั้น / อาคาร': `ชั้น ${rt.floor || '1'} อาคาร ${rt.building || '1'}`,
        'ยี่ห้อ': 'MikroTik',
        'รุ่นอุปกรณ์': rtModel,
        'หมายเลขครุภัณฑ์': displayRouterAssetNo(rt.asset_no),
        'S/N ใหม่ (ช่างยืนยัน)': rt.serial_no || '',
        'S/N ที่อ่านได้จากรูป (OCR)': rt.ocr_serial_no || '',
        'เกณฑ์ความเร็ว': 'Port 2 & Port 3 ≥ 650/350 Mbps',
        'ผลเทส LAN / Port 2 (DL/UL)': rtP2,
        'ผลเทส WiFi / Port 3 (DL/UL)': rtP3,
        'หมายเหตุห้อง GECC (ลงทะเบียน Authen)': '-',
        'มีรูปอุปกรณ์+Sticker': rt.photo_device ? 'มีรูปแล้ว' : 'ยังไม่มี',
        'มีรูปผลเทสความเร็วครบ': (rt.photo_lan2 && rt.photo_lan3) ? 'ครบ 2 พอร์ต' : 'ยังไม่ครบ'
      });

      // Add each AP room row to Sheet 2
      aps.forEach((ap, apIdx) => {
        const spec = detectRoomSpec(ap.room);
        const lanSpd = (ap.speed_lan_dl || ap.speed_lan_ul)
          ? `${ap.speed_lan_dl || '-'}/${ap.speed_lan_ul || '-'} Mbps`
          : (ap.photo_lan ? 'มีรูปผลเทส' : '-');
        const wifiSpd = (ap.speed_wifi_dl || ap.speed_wifi_ul)
          ? `${ap.speed_wifi_dl || '-'}/${ap.speed_wifi_ul || '-'} Mbps`
          : (ap.photo_wifi ? 'มีรูปผลเทส' : '-');
        const geccInfo = spec.isGecc
          ? (ap.gecc_authen_wifi ? 'ลงทะเบียน Authen แล้ว' : 'ห้อง GECC (ลงทะเบียน Authen ก่อนเทส)')
          : '-';

        deviceRows.push({
          'ลำดับวงจร': c.seq || idx + 1,
          'เลขที่วงจร (S/O)': c.so_number || '',
          'จังหวัด': c.province || '',
          'ชื่อหน่วยงาน / สาขา': c.branch_name || '',
          'ประเภทอุปกรณ์': `2. Access Point (${spec.code})`,
          'ลำดับอุปกรณ์ในวงจร': `AP ตัวที่ ${apIdx + 1}`,
          'ห้องที่ติดตั้ง': ap.room || spec.shortRoom,
          'ชั้น / อาคาร': `ชั้น ${ap.floor || '1'} อาคาร ${ap.building || '1'}`,
          'ยี่ห้อ': ap.brand || 'TOTOLINK',
          'รุ่นอุปกรณ์': ap.model || 'A3002RU',
          'หมายเลขครุภัณฑ์': displayApAssetNo(ap.asset_no),
          'S/N ใหม่ (ช่างยืนยัน)': ap.serial_no || '',
          'S/N ที่อ่านได้จากรูป (OCR)': ap.ocr_serial_no || '',
          'เกณฑ์ความเร็ว': `LAN ≥ ${spec.lanMinDl}/${spec.lanMinUl}M | WiFi ≥ ${spec.wifiMinDl}/${spec.wifiMinUl}M`,
          'ผลเทส LAN / Port 2 (DL/UL)': lanSpd,
          'ผลเทส WiFi / Port 3 (DL/UL)': wifiSpd,
          'หมายเหตุห้อง GECC (ลงทะเบียน Authen)': geccInfo,
          'มีรูปอุปกรณ์+Sticker': ap.photo_device ? 'มีรูปแล้ว' : 'ยังไม่มี',
          'มีรูปผลเทสความเร็วครบ': (ap.photo_lan && ap.photo_wifi) ? 'ครบ (LAN+WiFi)' : 'ยังไม่ครบ'
        });
      });
    });

    const wb = window.XLSX.utils.book_new();
    const wsCircuits = window.XLSX.utils.json_to_sheet(circuitRows);
    const wsDevices = window.XLSX.utils.json_to_sheet(deviceRows);

    window.XLSX.utils.book_append_sheet(wb, wsCircuits, '1_สรุปวงจรสาขา_334วงจร');
    window.XLSX.utils.book_append_sheet(wb, wsDevices, '2_อุปกรณ์_Router_AP_ทุกห้อง');

    const dateTag = new Date().toISOString().slice(0, 10);
    window.XLSX.writeFile(wb, `สรุปวงจรสาขา_กรมการขนส่งทางบก_2569_อัปเดตใหม่_${dateTag}.xlsx`);
    showToast('✅ ดาวน์โหลดไฟล์สรุป Excel ใหม่ (.xlsx) เรียบร้อยแล้ว!');
  } catch (err) {
    showToast('ส่งออก Excel ไม่สำเร็จ: ' + err.message, true);
  }
}





// Theme toggle (auto → dark → light) — see theme.js
(function dltThemeToggle() {
  const btn = document.getElementById('themeBtn');
  if (!btn || !window.dltTheme) return;
  const paint = () => { btn.textContent = 'ธีม: ' + window.dltTheme.label(); btn.setAttribute('aria-label', 'เปลี่ยนธีมหน้าจอ ตอนนี้: ' + window.dltTheme.label()); };
  btn.addEventListener('click', () => { window.dltTheme.cycle(); paint(); });
  paint();
})();

// ============================================================================
// Speedtest Generator Integration (/speedtest.html)
// ============================================================================
function openSpeedtestGenerator(cIdx = 0, slotKey = 'router_lan2', preset = 'router') {
  syncApInputsFromDom();
  syncAdditionalSiteCircuitsFromDom();
  const siteList = Array.isArray(currentSiteCircuits) && currentSiteCircuits.length > 0 ? currentSiteCircuits : (currentCircuit ? [currentCircuit] : []);
  const targetCircuit = siteList[cIdx] || currentCircuit;
  const so = targetCircuit?.so_number || '';
  const rt = targetCircuit?.router_info || {};
  const aps = Array.isArray(targetCircuit?.access_points) ? targetCircuit.access_points : [];

  let dl = '';
  let ul = '';
  if (slotKey === 'router_lan2') {
    dl = cIdx === 0 ? (document.getElementById('rLan2Dl')?.value.trim() || rt.speed_lan2_dl || '') : (rt.speed_lan2_dl || '');
    ul = cIdx === 0 ? (document.getElementById('rLan2Ul')?.value.trim() || rt.speed_lan2_ul || '') : (rt.speed_lan2_ul || '');
  } else if (slotKey === 'router_lan3') {
    dl = cIdx === 0 ? (document.getElementById('rLan3Dl')?.value.trim() || rt.speed_lan3_dl || '') : (rt.speed_lan3_dl || '');
    ul = cIdx === 0 ? (document.getElementById('rLan3Ul')?.value.trim() || rt.speed_lan3_ul || '') : (rt.speed_lan3_ul || '');
  } else {
    const m = slotKey.match(/^ap(\d+)_(wifi|lan)$/);
    if (m) {
      const apIdx = Number(m[1]) - 1;
      const kind = m[2];
      const ap = aps[apIdx] || {};
      dl = kind === 'wifi' ? (ap.speed_wifi_dl || '') : (ap.speed_lan_dl || '');
      ul = kind === 'wifi' ? (ap.speed_wifi_ul || '') : (ap.speed_lan_ul || '');
    }
  }

  const params = new URLSearchParams();
  if (so) params.set('so', so);
  if (slotKey) params.set('slot', slotKey);
  if (preset) params.set('preset', preset);
  if (dl) params.set('dl', dl);
  if (ul) params.set('ul', ul);

  window.open(`/speedtest.html?${params.toString()}`, '_blank');
}

window.addEventListener('message', async e => {
  const msg = e?.data;
  if (!msg || msg.type !== 'dlt_speedtest_generated') return;
  const { so_number, slot, url, dl, ul } = msg;
  if (!currentCircuit || !so_number) return;

  const siteList = Array.isArray(currentSiteCircuits) && currentSiteCircuits.length > 0 ? currentSiteCircuits : [currentCircuit];
  const cIdx = siteList.findIndex(c => c.so_number === so_number);
  if (cIdx === -1) return;

  const target = siteList[cIdx];
  if (!target.router_info) target.router_info = {};

  if (slot === 'router_lan2') {
    target.router_info.photo_lan2 = url;
    target.router_info.speed_lan2_dl = dl;
    target.router_info.speed_lan2_ul = ul;
    target.router_info.speed_tested = true;
    if (cIdx === 0) {
      if (document.getElementById('rLan2Dl')) document.getElementById('rLan2Dl').value = dl;
      if (document.getElementById('rLan2Ul')) document.getElementById('rLan2Ul').value = ul;
      if (document.getElementById('chkMktSpeed')) document.getElementById('chkMktSpeed').checked = true;
      validateRouterSpeeds();
    }
  } else if (slot === 'router_lan3') {
    target.router_info.photo_lan3 = url;
    target.router_info.speed_lan3_dl = dl;
    target.router_info.speed_lan3_ul = ul;
    target.router_info.speed_tested = true;
    if (cIdx === 0) {
      if (document.getElementById('rLan3Dl')) document.getElementById('rLan3Dl').value = dl;
      if (document.getElementById('rLan3Ul')) document.getElementById('rLan3Ul').value = ul;
      if (document.getElementById('chkMktSpeed')) document.getElementById('chkMktSpeed').checked = true;
      validateRouterSpeeds();
    }
  } else {
    const m = String(slot || '').match(/^ap(\d+)_(wifi|lan)$/);
    if (m && Array.isArray(target.access_points)) {
      const apIdx = Number(m[1]) - 1;
      const kind = m[2];
      if (target.access_points[apIdx]) {
        if (kind === 'wifi') {
          target.access_points[apIdx].photo_wifi = url;
          target.access_points[apIdx].speed_wifi_dl = dl;
          target.access_points[apIdx].speed_wifi_ul = ul;
        } else {
          target.access_points[apIdx].photo_lan = url;
          target.access_points[apIdx].speed_lan_dl = dl;
          target.access_points[apIdx].speed_lan_ul = ul;
        }
      }
    }
  }

  populateInspectionModal();
  showToast(`✅ รับภาพผลทดสอบความเร็ว (${dl}/${ul} Mbps) เข้าช่อง ${slot} ของวงจร ${so_number} แล้ว!`);
});

