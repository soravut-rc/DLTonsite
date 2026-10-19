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
// Initialization
// ============================================================================
window.addEventListener('DOMContentLoaded', async () => {
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
    provinces: Object.values(byProvince).sort((a, b) => (a.province || '').localeCompare(b.province || '', 'th')),
    cloudConfigured: true
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
  const cloudConfigured = Boolean(globalStats && globalStats.cloudConfigured);
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
      ? 'px-1.5 py-0.2 rounded-full bg-amber-400 text-slate-950 text-[10px] font-extrabold animate-pulse'
      : 'px-1.5 py-0.2 rounded-full bg-slate-600 text-slate-200 text-[10px] font-bold';
  }

  const cloudDot = document.getElementById('cloudDot');
  const cloudStatusText = document.getElementById('cloudStatusText');
  if (cloudConfigured) {
    cloudDot.className = 'w-2 h-2 rounded-full bg-emerald-400 animate-pulse';
    cloudStatusText.textContent = 'Supabase Connected';
  } else {
    cloudDot.className = 'w-2 h-2 rounded-full bg-amber-400';
    cloudStatusText.textContent = 'Local + Cloud Ready';
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
  const activeColors = {
    circuits: 'bg-rose-600 text-white shadow',
    linebot: 'bg-emerald-600 text-white shadow',
    admin: 'bg-amber-500 text-slate-950 shadow',
    dashboard: 'bg-indigo-600 text-white shadow'
  };

  Object.keys(views).forEach(k => {
    if (views[k]) {
      if (k === tab) views[k].classList.remove('hidden');
      else views[k].classList.add('hidden');
    }
    if (btns[k]) {
      const baseCls = 'px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition flex items-center gap-1';
      btns[k].className = k === tab
        ? `${baseCls} ${activeColors[k]}`
        : `${baseCls} text-slate-300 hover:bg-slate-700`;
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
      <button type="button" onclick="openInspectionModal('${c.so_number}')" class="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-300 text-xs flex items-center gap-1.5 transition">
        <span class="w-2 h-2 rounded-full ${dotCls}"></span>
        <span class="font-bold text-slate-900">${c.so_number}</span>
        <span class="text-slate-600 truncate max-w-[160px]">${c.province} • ${shortBranch}</span>
      </button>
    `;
  }).join('');
}

// ============================================================================
// Helper: Extract Sub-Branch / Building / Room Distinction inside a Province
// ============================================================================
function extractSubBranchGroup(c) {
  const b = (c.branch_name || '').trim();
  if (!b) return `สำนักงานขนส่งจังหวัด${c.province}`;
  if (b.includes('พื้นที่ 1') || b.includes('บางขุนเทียน')) return 'สขพ.1 (บางขุนเทียน)';
  if (b.includes('พื้นที่ 2') || b.includes('ตลิ่งชัน')) return 'สขพ.2 (ตลิ่งชัน)';
  if (b.includes('พื้นที่ 3') || b.includes('พระโขนง')) return 'สขพ.3 (พระโขนง)';
  if (b.includes('พื้นที่ 4') || b.includes('หนองจอก')) return 'สขพ.4 (หนองจอก)';
  if (b.includes('กรุงเทพมหานคร') || b.includes('หมอชิต') || b.includes('จตุจักร')) {
    const bld = c.router_summary?.building || '';
    return bld ? `สนง.ใหญ่ หมอชิต (อาคาร ${bld})` : 'สนง.ใหญ่ หมอชิต';
  }
  const parenMatch = b.match(/[\(（]([^\)）]+)[\)）]/);
  if (parenMatch && (parenMatch[1].includes('สข') || parenMatch[1].includes('สาขา') || parenMatch[1].includes('อำเภอ') || parenMatch[1].includes('เมือง'))) {
    return parenMatch[1].trim();
  }
  const branchMatch = b.match(/สาขา(?:อำเภอ)?([^\s(]+)/);
  if (branchMatch) return `สาขา${branchMatch[1]}`;
  return `สขจ.${c.province} (สำนักงานหลัก)`;
}

function extractShortSubBranchLabel(c) {
  const grp = extractSubBranchGroup(c);
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

  provSelect.innerHTML = `<option value="">📍 เลือกจังหวัด (${sortedProvs.length} จังหวัด)</option>` +
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
      btn.className = 'reg-pill active px-3 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 text-white whitespace-nowrap shadow-sm transition';
    } else {
      btn.className = 'reg-pill px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 whitespace-nowrap transition';
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
  // Ensure dropdown has this province
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
    btn.innerHTML = browseMode === 'province'
      ? `📋 ดูทั้งหมด ${allCircuits.length || 334} วงจร`
      : '🗺️ เลือกตามจังหวัด (77 จังหวัด)';
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
      el.classList.add('border-indigo-600');
      el.classList.remove('border-transparent');
    } else {
      el.classList.remove('border-indigo-600');
      el.classList.add('border-transparent');
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
  if (btn) btn.innerHTML = `📋 ดูทั้งหมด ${allCircuits.length || 334} วงจร`;
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
  showToast('📍 กำลังค้นหาสาขาขนส่งที่ใกล้พิกัดปัจจุบันของคุณ...');
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
      showToast('✅ เรียงลำดับวงจรจากสาขาที่อยู่ใกล้คุณที่สุดแล้ว');
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
    <button type="button" onclick="selectSubBranchChip('')" class="px-3 py-1.5 rounded-xl text-xs font-bold transition ${
      allActive ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
    }">
      ทั้งหมดในจังหวัดนี้ (${provinceCircuits.length})
    </button>
  `;
  html += groups.map(g => {
    const active = selectedSubBranch === g;
    return `
      <button type="button" onclick="selectSubBranchChip('${g.replace(/'/g, "\\'")}')" class="px-3 py-1.5 rounded-xl text-xs font-bold transition ${
        active ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200'
      }">
        🏢 ${g} (${groupCounts[g]})
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
    // Put Bangkok first if no filter or central, otherwise Thai alphabetical
    if (a.province === 'กรุงเทพมหานคร') return -1;
    if (b.province === 'กรุงเทพมหานคร') return 1;
    return a.province.localeCompare(b.province, 'th');
  });

  if (subtitle) {
    subtitle.textContent = regionFilter
      ? `แสดงเฉพาะ ${regionFilter} (${provList.length} จังหวัด) — แตะชื่อจังหวัดเพื่อดูรายชื่อวงจร`
      : `แสดงครบทั้ง ${provList.length} จังหวัด — แตะจังหวัดที่คุณเข้าหน้างานเพื่อดูวงจรเฉพาะในจังหวัดนั้น`;
  }

  container.innerHTML = provList.map(p => {
    const subArr = Array.from(p.subBranches);
    const subPreview = subArr.slice(0, 3).join(' • ') + (subArr.length > 3 ? ` +อีก ${subArr.length - 3}` : '');
    const pct = p.total > 0 ? Math.round((p.completed / p.total) * 100) : 0;
    const isMulti = p.total > 3;

    return `
      <button type="button" onclick="selectProvinceFromGrid('${p.province}')" class="text-left bg-white hover:bg-indigo-50/60 active:scale-[0.99] p-3.5 rounded-2xl border-2 ${
        isMulti ? 'border-indigo-200' : 'border-slate-200'
      } hover:border-indigo-500 shadow-sm transition flex flex-col justify-between gap-2">
        <div>
          <div class="flex items-start justify-between gap-1">
            <span class="font-extrabold text-slate-900 text-sm sm:text-base leading-tight">${p.province}</span>
            <span class="px-2 py-0.5 rounded-full text-[11px] font-extrabold shrink-0 ${
              isMulti ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700'
            }">
              ${p.total} วงจร
            </span>
          </div>
          <p class="text-[11px] text-slate-400 mt-0.5">${p.region}</p>
          <p class="text-[11px] text-indigo-700 font-medium mt-1.5 line-clamp-2">${subPreview}</p>
        </div>

        <div class="pt-1.5 border-t border-slate-100 flex items-center justify-between text-[11px]">
          <span class="${p.completed > 0 ? 'text-emerald-700 font-bold' : 'text-slate-400'}">
            ✅ ส่งมอบ ${p.completed}/${p.total}
          </span>
          <span class="text-indigo-600 font-bold">เลือก →</span>
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

  // Show Province Quick Grid when in 'province' mode and no specific province/search/status/GPS is active
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

  // If a province is selected, show the Selected Province Banner & Sub-Branch Chips
  if (province) {
    selProvBanner?.classList.remove('hidden');
    const provTitle = document.getElementById('selectedProvinceTitle');
    if (provTitle) provTitle.textContent = `จังหวัด${province}`;
    const provCircuits = allCircuits.filter(c => c.province === province);
    const doneCnt = provCircuits.filter(c => c.status === 'completed').length;
    const provMeta = document.getElementById('selectedProvinceMeta');
    if (provMeta) {
      provMeta.textContent = `มีทั้งหมด ${provCircuits.length} วงจร • ส่งมอบแล้ว ${doneCnt}/${provCircuits.length} วงจร`;
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
  if (gpsSortCenter) tags.push('📍 เรียงตามระยะทางใกล้ฉัน');
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
      <div class="col-span-full bg-white p-10 rounded-xl border border-slate-200 text-center space-y-3">
        <p class="text-slate-600 font-semibold">ไม่พบข้อมูลวงจรที่ตรงกับเงื่อนไขการค้นหา</p>
        <button onclick="resetFilters()" class="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold">
          🔄 ล้างตัวกรองทั้งหมด
        </button>
      </div>
    `;
    return;
  }

  // Compute per-province index (e.g., วงจรที่ 1/19 ของ จ.กรุงเทพมหานคร)
  const provOrderMap = {};
  const provTotals = {};
  for (const c of allCircuits) {
    provTotals[c.province] = (provTotals[c.province] || 0) + 1;
    provOrderMap[c.so_number] = provTotals[c.province];
  }

  container.innerHTML = list.map(c => {
    const badge = STATUS_BADGE[c.status] || STATUS_BADGE.pending;
    const rModel = c.router_summary?.model || 'RB3011';
    const rSn = c.router_summary?.serial_no ? `S/N: ${c.router_summary.serial_no}` : 'รอระบุ S/N';
    const rLocParts = [];
    if (c.router_summary?.building) rLocParts.push(`อาคาร ${c.router_summary.building}`);
    if (c.router_summary?.floor) rLocParts.push(`ชั้น ${c.router_summary.floor}`);
    if (c.router_summary?.room) rLocParts.push(`ห้อง${c.router_summary.room}`);
    const rLocText = rLocParts.length ? rLocParts.join(' • ') : 'ห้องวิชาการ';

    const apList = c.ap_summary || [];
    const apPillsHtml = apList.length > 0
      ? apList.map(a => `<span class="inline-flex items-center px-2 py-0.5 rounded bg-indigo-50 text-indigo-800 border border-indigo-200 text-[11px] font-semibold">📡 ${a.room || ('AP ' + a.ap_no)} (${a.brand || 'AP'})</span>`).join(' ')
      : '<span class="text-slate-400 text-[11px]">ยังไม่มีข้อมูล AP</span>';

    const pdfUrl = c.legacy_pdf_path ? `/${encodeURI(c.legacy_pdf_path)}` : null;
    const provCircuitCount = provTotals[c.province] || 1;
    const provIdx = provOrderMap[c.so_number] || 1;
    const subBranchGroup = extractSubBranchGroup(c);
    const distBadge = (typeof c._distKm === 'number' && c._distKm < 9000)
      ? `<span class="text-[11px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full border border-emerald-300">📍 ห่าง ~${c._distKm.toFixed(1)} กม.</span>`
      : '';

    return `
      <div class="bg-white rounded-2xl shadow-sm border-2 border-slate-200 hover:border-indigo-500 hover:shadow-md transition flex flex-col justify-between overflow-hidden">
        <div class="p-4 space-y-2.5">
          <!-- Card Top Row -->
          <div class="flex items-start justify-between gap-2">
            <div class="space-y-1">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="text-xs font-extrabold bg-slate-900 text-white px-2.5 py-0.5 rounded-md font-mono">${c.so_number}</span>
                <span class="text-xs font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-200 font-mono">Service: ${c.service_no || '-'}</span>
                <span class="text-[11px] font-bold bg-amber-50 text-amber-900 border border-amber-200 px-2 py-0.5 rounded-md">
                  วงจรที่ ${provIdx}/${provCircuitCount} (${c.province})
                </span>
                ${distBadge}
              </div>
              <h3 class="font-extrabold text-slate-900 text-sm sm:text-base leading-snug pt-0.5">
                ${c.branch_name || ('สำนักงานขนส่งจังหวัด' + c.province)}
              </h3>
              <p class="text-xs text-slate-500">
                🏢 <strong class="text-indigo-700">${subBranchGroup}</strong> • 📍 จุดวาง MikroTik: <strong class="text-slate-800">${rLocText}</strong>
              </p>
              ${c.address ? `<p class="text-[11px] text-slate-400 line-clamp-1">🗺️ ${c.address}</p>` : ''}
            </div>
            <span class="text-[11px] font-bold px-2.5 py-1 rounded-full border shrink-0 ${badge.cls}">
              ${badge.label}
            </span>
          </div>

          <!-- Equipment & Room Summary Box -->
          <div class="bg-slate-50 rounded-xl p-2.5 border border-slate-200/90 text-xs space-y-1.5">
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <span class="text-slate-700 font-semibold">🖧 1. MikroTik: <strong class="text-slate-900">${rModel}</strong> (${rLocText})</span>
              <span class="font-mono text-[11px] px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-700 font-bold">${rSn}</span>
            </div>
            <div class="flex items-center gap-1 flex-wrap pt-0.5">
              <span class="text-[11px] text-slate-500 font-medium mr-1">2–3. ห้อง AP (${apList.length}):</span>
              ${apPillsHtml}
            </div>
            <div class="flex items-center justify-between pt-1.5 border-t border-slate-200/60 text-[11px] text-slate-500 flex-wrap gap-1">
              <span>📷 รูปถ่าย: <strong class="${(c.photo_count || 0) >= (c.expected_photo_count || 9) ? 'text-emerald-700' : 'text-slate-800'}">${c.photo_count || 0}/${c.expected_photo_count || 9}</strong> รูป</span>
              <span>👷 ช่าง: <strong class="text-slate-800">${c.inspector_name || '-'}</strong></span>
              ${c.admin_status === 'approved' ? `<span class="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold border border-emerald-300">🛡️ Admin อนุมัติ</span>` :
                c.admin_status === 'pending_review' ? `<span class="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-bold border border-amber-300">⏳ รอ Admin ตรวจ</span>` :
                c.admin_status === 'rejected' ? `<span class="px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 font-bold border border-rose-300">⚠️ แก้ไขงาน</span>` : ''}
            </div>
          </div>
        </div>

        <!-- Card Actions Footer (Large Mobile Tap Button) -->
        <div class="bg-slate-50 px-4 py-2.5 border-t border-slate-200 flex items-center justify-between gap-2 flex-wrap">
          <div class="flex items-center gap-1.5 flex-wrap">
            ${pdfUrl ? `
              <a href="${pdfUrl}" target="_blank" class="px-2 py-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold transition flex items-center gap-1" title="เปิดดูไฟล์ส่งมอบปีที่แล้ว">
                📄 PDF ปี68
              </a>
            ` : `
              <span class="px-2 py-1 rounded text-[11px] text-rose-500 bg-rose-50">ไม่มี PDF เดิม</span>
            `}
            <a href="/report.html?id=${encodeURIComponent(c.so_number)}" target="_blank" class="px-2 py-1.5 rounded-xl border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold transition" title="เปิดหน้าใบส่งมอบและพิมพ์">
              🖨️ ใบส่งมอบ
            </a>
            <a href="/api/circuits/${encodeURIComponent(c.so_number)}/report.docx" class="px-2.5 py-1.5 rounded-xl border border-blue-300 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-sm transition flex items-center gap-1" title="ดาวน์โหลดรายงาน MS Word (.docx)">
              📝 Word
            </a>
          </div>

          <button onclick="openInspectionModal('${c.so_number}')" class="flex-1 sm:flex-initial px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-[0.99] text-white text-xs sm:text-sm font-extrabold shadow-sm transition text-center">
            🔧 เข้าดำเนินการ →
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
const MODAL_STEPS_ORDER = ['step1', 'step23', 'step4', 'info', 'all'];

function setModalStep(step) {
  currentModalStep = step || 'step1';
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
      btn.className = 'modal-step-btn px-3 py-1.5 rounded-lg text-xs font-extrabold whitespace-nowrap bg-indigo-600 text-white shadow-sm transition';
    } else {
      btn.className = 'modal-step-btn px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap bg-white text-slate-700 border border-slate-300 transition';
    }
  });

  const nextBtn = document.getElementById('btnModalNextStep');
  if (nextBtn) {
    if (currentModalStep === 'step1') nextBtn.textContent = 'ไปข้อ 2–3 (AP) ➡️';
    else if (currentModalStep === 'step23') nextBtn.textContent = 'ไปข้อ 4 (ลงนาม) ➡️';
    else if (currentModalStep === 'step4') nextBtn.textContent = 'ดูครบทุกข้อ 📋';
    else nextBtn.textContent = 'ไปข้อ 1 (MikroTik) ➡️';
  }

  const formPane = document.getElementById('modalFormPane');
  if (formPane) formPane.scrollTo({ top: 0, behavior: 'smooth' });
}

function goModalStepDelta(delta) {
  const mainOrder = ['step1', 'step23', 'step4', 'all'];
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
    currentCircuit = data.circuit || data;
    addRecentCircuit(soNumber);

    if (!currentCircuit.router_info) currentCircuit.router_info = {};
    if (!Array.isArray(currentCircuit.access_points) || currentCircuit.access_points.length === 0) {
      currentCircuit.access_points = [
        createDefaultAp(1, currentCircuit.province, 'ห้อง GPS'),
        createDefaultAp(2, currentCircuit.province, 'ห้อง GECC')
      ];
    }

    populateInspectionModal();
    // On mobile (< 768px), default to Step 1 wizard so it's super clean; on desktop default to 'all'
    setModalStep(window.innerWidth < 768 ? 'step1' : 'all');
    document.getElementById('inspectionModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  } catch (err) {
    showToast(err.message, true);
  }
}

function closeInspectionModal() {
  document.getElementById('inspectionModal').classList.add('hidden');
  document.getElementById('legacyPdfIframe').src = 'about:blank';
  splitPdfVisible = false;
  document.getElementById('modalPdfPane').classList.add('hidden');
  document.body.style.overflow = '';
}

function toggleSplitLegacyPdf() {
  if (!currentCircuit) return;
  const pane = document.getElementById('modalPdfPane');
  const iframe = document.getElementById('legacyPdfIframe');

  if (!currentCircuit.legacy_pdf_path) {
    showToast('วงจรนี้ไม่มีไฟล์ PDF ส่งมอบของปีที่แล้วในโฟลเดอร์ Onsite', true);
    return;
  }

  splitPdfVisible = !splitPdfVisible;
  if (splitPdfVisible) {
    pane.classList.remove('hidden');
    const pdfUrl = '/' + encodeURI(currentCircuit.legacy_pdf_path);
    if (iframe.src !== location.origin + pdfUrl) {
      iframe.src = pdfUrl;
    }
    document.getElementById('legacyPdfLabel').textContent = `📄 ไฟล์ปีที่แล้ว: ${currentCircuit.legacy_pdf_path}`;
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
    asset_no: `สขจ.${province || ''}/${spec.code}`,
    room: spec.shortRoom,
    room_type: spec.code,
    floor: '1',
    building: '1',
    sticker_done: false,
    gecc_lan_mkt_port4: false,
    gecc_wan_to_lan: false,
    gecc_authen_wifi: false,
    speed_wifi_dl: '',
    speed_wifi_ul: '',
    speed_lan_dl: '',
    speed_lan_ul: '',
    photo_device: '',
    photo_wifi: '',
    photo_lan: ''
  };
}

function compareSnStringsClient(manualSn, ocrSn) {
  const norm = v => String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = norm(manualSn);
  const o = norm(ocrSn);
  if (!m && !o) return { status: 'missing', label: '⚠️ ยังไม่ระบุ S/N', cls: 'bg-slate-200 text-slate-600' };
  if (m && o) {
    if (m === o) return { status: 'matched', label: '✅ S/N ตรงกัน (Recheck ผ่าน)', cls: 'bg-emerald-100 text-emerald-800 border border-emerald-300' };
    return { status: 'mismatch', label: `⚠️ ไม่ตรงกัน! (ช่าง: ${m} ≠ OCR: ${o})`, cls: 'bg-rose-100 text-rose-800 border border-rose-300 animate-pulse' };
  }
  if (m && !o) return { status: 'manual_only', label: '✍️ ช่างกรอกเอง (ยังไม่มีค่า OCR)', cls: 'bg-blue-100 text-blue-800 border border-blue-200' };
  return { status: 'ocr_only', label: '🤖 อ่านจาก OCR แล้ว (รอช่างกดยืนยัน)', cls: 'bg-amber-100 text-amber-800 border border-amber-300' };
}

function validateRouterSnRecheck() {
  const manualVal = document.getElementById('rSerialNo')?.value || '';
  const ocrVal = document.getElementById('rOcrSerialNo')?.value || '';
  const badge = document.getElementById('rSnRecheckBadge');
  if (badge) {
    const cmp = compareSnStringsClient(manualVal, ocrVal);
    badge.className = `px-2.5 py-0.5 rounded-full text-[11px] font-bold ${cmp.cls}`;
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
    showToast('ยังไม่มีค่า S/N จาก OCR กรุณาถ่ายรูปหรือกดปุ่มสแกน S/N ก่อน', true);
    return;
  }
  const manualEl = document.getElementById('rSerialNo');
  if (manualEl) {
    manualEl.value = ocrVal;
    updateRouterStickerPreview();
    validateRouterSnRecheck();
    showToast(`คัดลอกค่า OCR (${ocrVal}) ไปยังช่อง S/N ช่างกรอกแล้ว ✅`);
  }
}

function copyApOcrToManual(idx) {
  const ocrEl = document.getElementById(`apOcrSn_${idx}`);
  const manualEl = document.getElementById(`apSn_${idx}`);
  const ocrVal = (ocrEl?.value || '').trim().toUpperCase();
  if (!ocrVal) {
    showToast('ยังไม่มีค่า S/N จาก OCR สำหรับ AP จุดนี้', true);
    return;
  }
  if (manualEl) {
    manualEl.value = ocrVal;
    onApSpeedOrStickerInput(idx);
    showToast(`ยืนยัน S/N ของ AP ตัวที่ ${idx + 1} (${ocrVal}) ตรงกับ OCR แล้ว ✅`);
  }
}

function renderModalCompletenessBar() {
  if (!currentCircuit) return;
  const rt = currentCircuit.router_info || {};
  const aps = Array.isArray(currentCircuit.access_points) ? currentCircuit.access_points : [];
  const slots = [
    { label: '1.1 รูป MikroTik', ok: Boolean(rt.photo_device) },
    { label: '1.2 รูป LAN 2', ok: Boolean(rt.photo_lan2) },
    { label: '1.3 รูป LAN 3', ok: Boolean(rt.photo_lan3) }
  ];
  aps.forEach((ap, i) => {
    slots.push({ label: `2.${i + 1}.1 รูป AP#${i + 1}`, ok: Boolean(ap.photo_device) });
    slots.push({ label: `2.${i + 1}.2 WiFi AP#${i + 1}`, ok: Boolean(ap.photo_wifi) });
    slots.push({ label: `2.${i + 1}.3 LAN AP#${i + 1}`, ok: Boolean(ap.photo_lan) });
  });
  slots.push({ label: '4.1 สำเนาใบส่งมอบ (หน้า 1/2)', ok: Boolean(rt.photo_handover_p1 || rt.photo_signed_doc) });
  slots.push({ label: '4.2 สำเนาใบส่งมอบ (หน้า 2/2 ประทับตรา)', ok: Boolean(rt.photo_handover_p2) });

  const uploaded = slots.filter(s => s.ok).length;
  const total = slots.length;

  const photoBadge = document.getElementById('modalPhotoCompletenessBadge');
  if (photoBadge) {
    if (uploaded >= total) {
      photoBadge.className = 'text-xs font-extrabold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300';
      photoBadge.textContent = `📷 รูปถ่ายครบ ${uploaded}/${total} รูป ✅`;
    } else {
      photoBadge.className = 'text-xs font-extrabold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300';
      photoBadge.textContent = `📷 รูปถ่าย: ${uploaded} / ${total} รูป (ขาดอีก ${total - uploaded} รูป)`;
    }
  }

  const missingBar = document.getElementById('modalMissingPhotosBar');
  if (missingBar) {
    missingBar.innerHTML = slots.map(s => `
      <span class="px-2 py-0.5 rounded-md border text-[11px] font-semibold ${
        s.ok ? 'bg-emerald-50 border-emerald-300 text-emerald-800' : 'bg-white border-slate-300 text-slate-500'
      }">${s.ok ? '✅' : '⬜'} ${s.label}</span>
    `).join('');
  }

  const quickName = document.getElementById('modalQuickTechName');
  if (quickName && currentCircuit.inspector_name && !quickName.value) {
    quickName.value = currentCircuit.inspector_name;
  }
  const quickPhone = document.getElementById('modalQuickTechPhone');
  if (quickPhone && currentCircuit.inspector_phone && !quickPhone.value) {
    quickPhone.value = currentCircuit.inspector_phone;
  }

  const checkinText = document.getElementById('modalCheckinStatusText');
  if (checkinText) {
    if (currentCircuit.checkout_time) {
      checkinText.className = 'text-xs font-extrabold text-emerald-700';
      checkinText.textContent = `🏁 Check-out ส่งงานแล้วเมื่อ ${new Date(currentCircuit.checkout_time).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}`;
    } else if (currentCircuit.checkin_time) {
      checkinText.className = 'text-xs font-extrabold text-blue-700';
      checkinText.textContent = `📍 Check-in เข้าหน้างานแล้วเมื่อ ${new Date(currentCircuit.checkin_time).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}`;
    } else {
      checkinText.className = 'text-xs font-bold text-slate-600';
      checkinText.textContent = 'ยังไม่ได้กด Check-in เข้าหน้างาน';
    }
  }

  const adminBadge = document.getElementById('modalAdminVerifyBadge');
  if (adminBadge) {
    const st = currentCircuit.admin_status || '';
    if (st === 'approved') {
      adminBadge.className = 'px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-300';
      adminBadge.textContent = `🛡️ Admin อนุมัติแล้ว (${currentCircuit.admin_name || 'Admin'})`;
    } else if (st === 'pending_review') {
      adminBadge.className = 'px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-amber-100 text-amber-800 border border-amber-300';
      adminBadge.textContent = '⏳ รอ Admin ตรวจสอบความถูกต้อง';
    } else if (st === 'rejected') {
      adminBadge.className = 'px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-rose-100 text-rose-800 border border-rose-300';
      adminBadge.textContent = `⚠️ Admin ให้แก้ไข: ${currentCircuit.admin_comment || ''}`;
    } else {
      adminBadge.className = 'px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600';
      adminBadge.textContent = 'สถานะ Admin: รอส่งงาน';
    }
  }
}

async function checkInCurrentModalCircuit() {
  if (!currentCircuit) return;
  const quickName = document.getElementById('modalQuickTechName')?.value.trim();
  const formName = document.getElementById('fInspectorName')?.value.trim();
  const techName = quickName || formName || currentCircuit.inspector_name || prompt('กรุณาระบุชื่อช่างผู้เข้าหน้างาน (Check-in):', 'ช่างหน้างาน 1');
  if (!techName) return;

  if (document.getElementById('fInspectorName')) document.getElementById('fInspectorName').value = techName;
  if (document.getElementById('modalQuickTechName')) document.getElementById('modalQuickTechName').value = techName;

  const techPhone = document.getElementById('modalQuickTechPhone')?.value.trim() || document.getElementById('fInspectorPhone')?.value.trim() || currentCircuit.inspector_phone || '';
  if (document.getElementById('fInspectorPhone') && techPhone) document.getElementById('fInspectorPhone').value = techPhone;

  const latLong = document.getElementById('fLatLong')?.value.trim() || currentCircuit.lat_long || '';

  try {
    const res = await fetch(`/api/circuits/${encodeURIComponent(currentCircuit.so_number)}/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tech_name: techName, tech_phone: techPhone, lat_long: latLong })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Check-in ไม่สำเร็จ');
    currentCircuit = data.circuit;
    const radioInProg = document.querySelector('input[name="circuitStatus"][value="in_progress"]');
    if (radioInProg) radioInProg.checked = true;
    renderModalCompletenessBar();
    showToast(`📍 Check-in เข้าหน้างานวงจร ${currentCircuit.so_number} สำเร็จ!`);
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
        const missingText = (c.missingPhotoLabels || []).join('\n- ') || 'ไม่มี';
        const confirmForce = confirm(
          `⚠️ ระบบตรวจสอบพบว่าข้อมูลยังไม่ครบถ้วนก่อน Check-out:\n` +
          `📷 รูปถ่ายที่ส่งแล้ว: ${c.uploadedPhotos}/${c.requiredPhotos} รูป\n` +
          (c.missingPhotoLabels?.length ? `- ขาดรูป:\n- ${missingText}\n` : '') +
          (c.hasMissingSn ? `- ยังไม่ได้กรอกยืนยันรหัส S/N ให้ครบทุกอุปกรณ์\n` : '') +
          `\nต้องการยืนยัน Check-out ส่งให้ Admin ตรวจสอบทันทีหรือไม่?`
        );
        if (!confirmForce) return;

        const resForce = await fetch(`/api/circuits/${encodeURIComponent(currentCircuit.so_number)}/checkout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force: true })
        });
        const dataForce = await resForce.json();
        if (!resForce.ok) throw new Error(dataForce.error || 'Check-out ไม่สำเร็จ');
        currentCircuit = dataForce.circuit;
      } else {
        throw new Error(data.error || 'Check-out ไม่สำเร็จ');
      }
    } else {
      currentCircuit = data.circuit;
    }

    const radioComp = document.querySelector('input[name="circuitStatus"][value="completed"]');
    if (radioComp) radioComp.checked = true;
    renderModalCompletenessBar();
    showToast(`🏁 Check-out สำเร็จ! ส่งงานวงจร ${currentCircuit.so_number} เข้าคิวให้ Admin ตรวจสอบแล้ว`);
    await refreshAllData();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function downloadWordReportFromModal() {
  if (!currentCircuit) return;
  await saveCurrentInspection(true);
  window.location.href = `/api/circuits/${encodeURIComponent(currentCircuit.so_number)}/report.docx`;
}

function populateInspectionModal() {
  const c = currentCircuit;
  document.getElementById('modalSoBadge').textContent = c.so_number;
  document.getElementById('modalTitle').textContent = c.branch_name || `สำนักงานขนส่งจังหวัด${c.province}`;
  document.getElementById('modalSubtitle').textContent = `Service No: ${c.service_no || '-'} | ${c.region} • จังหวัด${c.province}`;

  // Render same-province multi-circuit bar with clear building/sub-branch labels
  const sameProv = allCircuits.filter(item => item.province === c.province);
  const sameBar = document.getElementById('sameProvinceCircuitsBar');
  sameBar.innerHTML = sameProv.map((item, idx) => {
    const active = item.so_number === c.so_number;
    const dotCls = item.status === 'completed' ? 'bg-emerald-400' : item.status === 'in_progress' ? 'bg-amber-400' : 'bg-slate-400';
    const shortLabel = extractShortSubBranchLabel(item);
    return `
      <button type="button" onclick="switchCircuitInModal('${item.so_number}')" class="px-2.5 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1.5 whitespace-nowrap transition ${
        active ? 'bg-rose-600 text-white shadow' : 'bg-indigo-900/80 hover:bg-indigo-800 text-slate-200 border border-indigo-700'
      }">
        <span class="w-2 h-2 rounded-full ${dotCls}"></span>
        <span>#${idx + 1} ${item.so_number}</span>
        <span class="opacity-85 font-normal">(${shortLabel})</span>
      </button>
    `;
  }).join('');

  const linkPdf = document.getElementById('linkOpenLegacyNewTab');
  if (c.legacy_pdf_path) {
    linkPdf.href = '/' + encodeURI(c.legacy_pdf_path);
    linkPdf.classList.remove('hidden');
  } else {
    linkPdf.classList.add('hidden');
  }

  if (splitPdfVisible && c.legacy_pdf_path) {
    document.getElementById('legacyPdfIframe').src = '/' + encodeURI(c.legacy_pdf_path);
    document.getElementById('legacyPdfLabel').textContent = `📄 ไฟล์ปีที่แล้ว: ${c.legacy_pdf_path}`;
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

  // Step 1: Router (MikroTik)
  const rt = c.router_info || {};
  document.getElementById('chkMktSticker').checked = Boolean(rt.sticker_done);
  document.getElementById('chkMktSpeed').checked = Boolean(rt.speed_tested);

  const rModelVal = rt.model || 'RB3011';
  const rRadios = document.querySelectorAll('input[name="routerModel"]');
  let matchedRadio = false;
  rRadios.forEach(r => {
    if (r.value === rModelVal) {
      r.checked = true;
      matchedRadio = true;
    }
  });
  if (!matchedRadio && rRadios[0]) rRadios[0].checked = true;

  document.getElementById('rSerialNo').value = rt.serial_no || '';
  const ocrEl = document.getElementById('rOcrSerialNo');
  if (ocrEl) ocrEl.value = rt.ocr_serial_no || '';
  document.getElementById('rAssetNo').value = rt.asset_no || `สขจ.${c.province}`;
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

  renderPhotoSlot('slotRouterDevice', 'router_device', '1.1 รูปถ่ายอุปกรณ์ MikroTik (เห็น Sticker ใหม่ชัดเจน)', rt.photo_device, url => {
    currentCircuit.router_info.photo_device = url;
    renderModalCompletenessBar();
  });
  renderPhotoSlot('slotRouterLan2', 'router_lan2', '1.2 รูปผลทดสอบความเร็ว Port LAN 2 (≥ 650/350M)', rt.photo_lan2, url => {
    currentCircuit.router_info.photo_lan2 = url;
    renderModalCompletenessBar();
  });
  renderPhotoSlot('slotRouterLan3', 'router_lan3', '1.2 รูปผลทดสอบความเร็ว Port LAN 3 (≥ 650/350M)', rt.photo_lan3, url => {
    currentCircuit.router_info.photo_lan3 = url;
    renderModalCompletenessBar();
  });

  // Steps 2 & 3: Access Points
  renderAccessPointCards();

  // Step 4: Scanned Paper Handover Form Copies (Page 1/2 & Page 2/2)
  document.getElementById('chkDocFilled').checked = Boolean(rt.doc_filled);
  document.getElementById('chkDocStamped').checked = Boolean(rt.doc_stamped);
  renderPhotoSlot(
    'slotSignedDocPhoto',
    'handover_page1',
    '📄 4.1 สำเนาเอกสาร "แบบส่งมอบงาน" หน้าที่ 1/2 (รายละเอียดสถานที่และอุปกรณ์ที่ช่างเขียน)',
    rt.photo_handover_p1 || rt.photo_signed_doc || '',
    url => {
      currentCircuit.router_info.photo_handover_p1 = url;
      currentCircuit.router_info.photo_signed_doc = url;
      renderModalCompletenessBar();
    }
  );
  renderPhotoSlot(
    'slotSignedDocPage2Photo',
    'handover_page2',
    '📄 4.2 สำเนาเอกสาร "แบบส่งมอบงาน" หน้าที่ 2/2 (หน้าที่มีลายเซ็นผู้ส่งมอบ & ผู้รับมอบพร้อมประทับตรา)',
    rt.photo_handover_p2 || '',
    url => {
      currentCircuit.router_info.photo_handover_p2 = url;
      renderModalCompletenessBar();
    }
  );

  const todayThai = formatThaiDateToday();
  document.getElementById('fRemarks').value = c.remarks || '';
  document.getElementById('fInspectorName').value = c.inspector_name || '';
  document.getElementById('fInspectorPhone').value = c.inspector_phone || '';
  document.getElementById('fInspectionDate').value = c.inspection_date || todayThai;
  document.getElementById('fReceiverName').value = c.receiver_name || '';
  document.getElementById('fReceiverPosition').value = c.receiver_position || '';
  document.getElementById('fReceiverPhone').value = c.receiver_phone || '';
  document.getElementById('fReceivedDate').value = c.received_date || todayThai;

  loadSignatureToCanvas('sigInspector', c.inspector_signature);
  loadSignatureToCanvas('sigReceiver', c.receiver_signature);
  document.getElementById('modalSaveStatus').textContent = c.updated_at ? `อัปเดตล่าสุด: ${new Date(c.updated_at).toLocaleString('th-TH')}` : 'ยังไม่มีประวัติการบันทึกในปีนี้';
  renderModalCompletenessBar();
}

async function switchCircuitInModal(soNumber) {
  if (currentCircuit && currentCircuit.so_number === soNumber) return;
  await openInspectionModal(soNumber);
}

function setRouterRoom(roomName) {
  document.getElementById('rRoom').value = roomName;
}

function updateRouterStickerPreview() {
  const so = document.getElementById('fSoNumber')?.value || '-';
  const asset = document.getElementById('rAssetNo')?.value || '-';
  const modelEl = document.querySelector('input[name="routerModel"]:checked');
  const model = modelEl ? modelEl.value : 'RB3011';
  const sn = document.getElementById('rSerialNo')?.value || '-';
  const preview = document.getElementById('routerStickerPreview');
  if (preview) {
    preview.innerHTML = `เลขที่วงจร: <strong>${so}</strong> | เลขครุภัณฑ์: <strong>${asset}</strong> | ยี่ห้อ/รุ่น: <strong>MikroTik ${model}</strong> | SN: <strong>${sn}</strong>`;
  }
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
// Dynamic Access Points (Steps 2 & 3: DLS / GPS / VICC & GECC)
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

    const chkSticker = document.getElementById(`apChkSticker_${idx}`);
    if (chkSticker) ap.sticker_done = chkSticker.checked;

    const chkMkt4 = document.getElementById(`apGeccMktPort4_${idx}`);
    if (chkMkt4) ap.gecc_lan_mkt_port4 = chkMkt4.checked;

    const chkWanLan = document.getElementById(`apGeccWanToLan_${idx}`);
    if (chkWanLan) ap.gecc_wan_to_lan = chkWanLan.checked;

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
}

function removeAccessPointSlot(idx) {
  if (currentCircuit.access_points.length <= 1) {
    showToast('ต้องมี Access Point อย่างน้อย 1 ตัวต่อวงจร', true);
    return;
  }
  syncApInputsFromDom();
  currentCircuit.access_points.splice(idx, 1);
  currentCircuit.access_points.forEach((ap, i) => { ap.ap_no = i + 1; });
  renderAccessPointCards();
  renderModalCompletenessBar();
}

function setApBrand(idx, brand) {
  syncApInputsFromDom();
  currentCircuit.access_points[idx].brand = brand;
  const presets = AP_MODEL_PRESETS[brand] || [];
  if (presets.length > 0) {
    currentCircuit.access_points[idx].model = presets[0];
  }
  renderAccessPointCards();
}

function setApRoomQuick(idx, roomCode) {
  syncApInputsFromDom();
  const spec = ROOM_SPECS[roomCode] || ROOM_SPECS.GPS;
  currentCircuit.access_points[idx].room = spec.shortRoom;
  currentCircuit.access_points[idx].room_type = spec.code;
  if (currentCircuit) {
    currentCircuit.access_points[idx].asset_no = `สขจ.${currentCircuit.province}/${spec.code}`;
  }
  renderAccessPointCards();
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
    stickerEl.innerHTML = `เลขที่วงจร: <strong>${so}</strong> | เลขครุภัณฑ์: <strong>${ap.asset_no || '-'}</strong> | ยี่ห้อ/รุ่น: <strong>${ap.brand || ''} ${ap.model || ''}</strong> | SN: <strong>${ap.serial_no || '-'}</strong>`;
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
}

function renderAccessPointCards() {
  const container = document.getElementById('accessPointsContainer');
  const aps = currentCircuit.access_points || [];
  const so = document.getElementById('fSoNumber')?.value || currentCircuit.so_number;

  container.innerHTML = aps.map((ap, idx) => {
    const models = AP_MODEL_PRESETS[ap.brand] || ['A3002RU', 'Archer C6', 'DIR-825'];
    const spec = detectRoomSpec(ap.room);
    const snCmp = compareSnStringsClient(ap.serial_no, ap.ocr_serial_no);

    return `
      <div class="border-2 ${spec.isGecc ? 'border-amber-400 bg-amber-50/20' : 'border-slate-200 bg-slate-50/40'} rounded-xl p-4 space-y-3.5">
        <!-- AP Header & Room Type Selector -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-200 pb-2.5 gap-2">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="px-2.5 py-1 rounded-lg ${spec.isGecc ? 'bg-amber-600' : 'bg-emerald-600'} text-white text-xs font-bold">
              Access Point ตัวที่ ${idx + 1}: ${spec.fullLabel}
            </span>
            <span class="text-xs font-bold px-2 py-0.5 rounded bg-white border border-slate-300 text-slate-700">
              SSID: ${spec.ssid} | LAN ≥ ${spec.lanMinDl}/${spec.lanMinUl}M | WiFi ≥ ${spec.wifiMinDl}/${spec.wifiMinUl}M
            </span>
          </div>
          <button type="button" onclick="removeAccessPointSlot(${idx})" class="text-xs text-rose-600 hover:underline font-semibold self-end sm:self-auto">
            🗑️ ลบจุดนี้
          </button>
        </div>

        <!-- Room Type Quick Selector (2.3.1 DLS, 2.3.2 GPS, 2.3.3 VICC, 3. GECC) -->
        <div class="flex items-center gap-1.5 flex-wrap text-xs">
          <span class="font-bold text-slate-600">เลือกประเภทห้องของ AP ตัวที่ ${idx + 1}:</span>
          <button type="button" onclick="setApRoomQuick(${idx}, 'GPS')" class="px-2.5 py-1 rounded-lg border font-semibold ${spec.code === 'GPS' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'}">
            2.3.2 ศูนย์เดินรถ GPS (LAN 350/200M)
          </button>
          <button type="button" onclick="setApRoomQuick(${idx}, 'GECC')" class="px-2.5 py-1 rounded-lg border font-semibold ${spec.code === 'GECC' ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'}">
            3. ห้องประชาสัมพันธ์ GECC (ย้ายสาย + Authen + LAN 300/150M)
          </button>
          <button type="button" onclick="setApRoomQuick(${idx}, 'DLS')" class="px-2.5 py-1 rounded-lg border font-semibold ${spec.code === 'DLS' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'}">
            2.3.1 ห้องอบรม DLS (LAN 300/150M)
          </button>
          <button type="button" onclick="setApRoomQuick(${idx}, 'VICC')" class="px-2.5 py-1 rounded-lg border font-semibold ${spec.code === 'VICC' ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'}">
            2.3.3 ตรวจสภาพ VICC (LAN 350/200M)
          </button>
        </div>

        <!-- Step 2.2 / 3.2 Checklist + Special Step 3.3 - 3.5 Checklist for GECC Room -->
        <div class="${spec.isGecc ? 'bg-amber-100/80 border-amber-400' : 'bg-emerald-50/70 border-emerald-200'} border rounded-xl p-3 space-y-2 text-xs">
          <div class="font-bold ${spec.isGecc ? 'text-amber-950' : 'text-emerald-950'}">
            ${spec.isGecc ? '⚠️ ขั้นตอนบังคับสำหรับ ห้อง GECC (ข้อ 3.1 – 3.6):' : `✅ ขั้นตอนปฏิบัติงานช่างสำหรับ ${spec.fullLabel} (ข้อ 2.1 – 2.3):`}
          </div>

          <label class="flex items-start gap-2 text-slate-800 cursor-pointer">
            <input id="apChkSticker_${idx}" type="checkbox" ${ap.sticker_done ? 'checked' : ''} onchange="syncApInputsFromDom()" class="mt-0.5 rounded border-slate-400" />
            <span><strong>${spec.isGecc ? '3.2' : '2.2'}</strong> ลอก Sticker เก่า และติด Sticker ใหม่ เขียนรายละเอียด <strong>(เลขที่วงจร / เลขครุภัณฑ์ / ยี่ห้อ,รุ่น / SN)</strong> พร้อมถ่ายรูปอุปกรณ์ให้เห็น Sticker ชัดเจน</span>
          </label>

          ${spec.isGecc ? `
            <label class="flex items-start gap-2 text-amber-950 font-semibold cursor-pointer">
              <input id="apGeccMktPort4_${idx}" type="checkbox" ${ap.gecc_lan_mkt_port4 ? 'checked' : ''} onchange="syncApInputsFromDom()" class="mt-0.5 rounded border-amber-500 text-amber-700" />
              <span><strong>3.3</strong> ย้ายสายแลน ที่ MikroTik จาก <strong>Port 5 หรือ 6 หลัง MikroTik ➔ ไปยัง Port 4</strong> เรียบร้อยแล้ว</span>
            </label>
            <label class="flex items-start gap-2 text-amber-950 font-semibold cursor-pointer">
              <input id="apGeccWanToLan_${idx}" type="checkbox" ${ap.gecc_wan_to_lan ? 'checked' : ''} onchange="syncApInputsFromDom()" class="mt-0.5 rounded border-amber-500 text-amber-700" />
              <span><strong>3.4</strong> ย้ายสายแลน ที่ AP ห้อง GECC จาก <strong>Port WAN (ที่มาจาก MikroTik) ➔ ไปยัง Port LAN ที่ว่างอยู่</strong> เรียบร้อยแล้ว</span>
            </label>
            <label class="flex items-start gap-2 text-amber-950 font-semibold cursor-pointer">
              <input id="apGeccAuthen_${idx}" type="checkbox" ${ap.gecc_authen_wifi ? 'checked' : ''} onchange="syncApInputsFromDom()" class="mt-0.5 rounded border-amber-500 text-amber-700" />
              <span><strong>3.5</strong> ทดสอบเข้าใช้งานระบบ <strong>Authen WiFi</strong> สำเร็จเรียบร้อยแล้ว</span>
            </label>
          ` : ''}
        </div>

        <!-- Brand & Model & Room & Floor -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">ยี่ห้อ Access Point</label>
            <select id="apBrand_${idx}" onchange="setApBrand(${idx}, this.value)" class="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-sm font-bold bg-white">
              <option value="TOTOLINK" ${ap.brand === 'TOTOLINK' ? 'selected' : ''}>TOTOLINK</option>
              <option value="D-LINK" ${ap.brand === 'D-LINK' ? 'selected' : ''}>D-LINK</option>
              <option value="TP-LINK" ${ap.brand === 'TP-LINK' ? 'selected' : ''}>TP-LINK</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">รุ่น (Model)</label>
            <input id="apModel_${idx}" list="apModelsList_${idx}" oninput="onApSpeedOrStickerInput(${idx})" type="text" value="${ap.model || ''}" placeholder="เช่น A3002RU" class="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-sm bg-white" />
            <datalist id="apModelsList_${idx}">
              ${models.map(m => `<option value="${m}">`).join('')}
            </datalist>
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">เลขครุภัณฑ์ AP ตัวที่ ${idx + 1}</label>
            <input id="apAsset_${idx}" oninput="onApSpeedOrStickerInput(${idx})" type="text" value="${ap.asset_no || ''}" placeholder="เช่น สขจ.จังหวัด/GPS" class="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-sm bg-white" />
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">สถานที่ติดตั้ง (ห้อง)</label>
            <input id="apRoom_${idx}" oninput="onApSpeedOrStickerInput(${idx})" type="text" value="${ap.room || ''}" placeholder="เช่น ห้อง GPS" class="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-sm bg-white" />
          </div>
          <div class="grid grid-cols-2 gap-1.5">
            <div>
              <label class="block text-xs font-semibold text-slate-600 mb-1">ชั้น</label>
              <input id="apFloor_${idx}" type="text" value="${ap.floor || '1'}" class="w-full px-2 py-2 rounded-lg border border-slate-300 text-sm text-center bg-white" />
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-600 mb-1">อาคาร</label>
              <input id="apBuilding_${idx}" type="text" value="${ap.building || '1'}" class="w-full px-2 py-2 rounded-lg border border-slate-300 text-sm text-center bg-white" />
            </div>
          </div>
        </div>

        <!-- AP S/N OCR vs Technician Manual Input Recheck Box -->
        <div class="bg-white rounded-xl p-3 border-2 border-slate-200 space-y-2">
          <div class="flex items-center justify-between flex-wrap gap-2">
            <span class="text-xs font-extrabold text-slate-800">🔍 ระบบตรวจสอบความถูกต้อง S/N (AP ตัวที่ ${idx + 1}: ช่างกรอก vs ระบบแปลง OCR)</span>
            <span id="apSnRecheckBadge_${idx}" class="px-2.5 py-0.5 rounded-full text-[11px] font-bold ${snCmp.cls}">${snCmp.label}</span>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label class="block text-[11px] font-bold text-slate-700 mb-1">1) S/N ที่ช่างกรอกยืนยัน (Manual Input)</label>
              <input id="apSn_${idx}" oninput="onApSpeedOrStickerInput(${idx})" type="text" value="${ap.serial_no || ''}" placeholder="เช่น A3002RU191B05936" class="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-sm font-mono uppercase bg-white" />
            </div>
            <div>
              <label class="block text-[11px] font-bold text-indigo-800 mb-1">2) S/N ที่ระบบแปลงจากรูป (OCR Auto-Extract)</label>
              <div class="flex gap-1.5">
                <input id="apOcrSn_${idx}" oninput="onApSpeedOrStickerInput(${idx})" type="text" value="${ap.ocr_serial_no || ''}" placeholder="รออัปโหลดรูปหรือกดสแกน S/N..." class="flex-1 px-2.5 py-2 rounded-lg border border-indigo-200 bg-indigo-50/50 text-sm font-mono uppercase text-indigo-900" />
                <button type="button" onclick="openSnScanner('ap_${idx}')" class="px-2.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shrink-0 shadow-sm flex items-center gap-1" title="ถ่ายรูปสติ๊กเกอร์เพื่อแปลงเป็น S/N อัตโนมัติ">
                  📷 สแกน OCR
                </button>
                <button type="button" onclick="copyApOcrToManual(${idx})" class="px-2 py-2 rounded-lg bg-indigo-100 hover:bg-indigo-200 text-indigo-800 text-xs font-bold shrink-0" title="คัดลอกค่า OCR ไปใส่ช่องช่างกรอก">
                  ⬅️ ใช้ค่านี้
                </button>
              </div>
            </div>
          </div>
          <div id="apSnCandidates_${idx}" class="flex items-center gap-1 flex-wrap text-[11px]"></div>
        </div>

        <!-- Sticker Text Helper for AP -->
        <div class="bg-white p-2.5 rounded-xl border border-slate-200 text-xs space-y-1">
          <div class="font-bold text-slate-600">🏷️ ข้อความสำหรับเขียนลงบน Sticker ใหม่ (AP ตัวที่ ${idx + 1}):</div>
          <div id="apStickerPreview_${idx}" class="font-mono text-xs text-slate-800 bg-amber-50 px-2.5 py-1.5 rounded border border-amber-200">
            เลขที่วงจร: <strong>${so}</strong> | เลขครุภัณฑ์: <strong>${ap.asset_no || '-'}</strong> | ยี่ห้อ/รุ่น: <strong>${ap.brand || ''} ${ap.model || ''}</strong> | SN: <strong>${ap.serial_no || '-'}</strong>
          </div>
        </div>

        <!-- AP Speed Tests (WiFi & LAN) with Room-Specific Threshold Validation -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-white p-3.5 rounded-xl border border-slate-200">
          <div>
            <div class="flex items-center justify-between mb-1.5">
              <span class="text-xs font-bold text-slate-700">📶 ทดสอบ WiFi (SSID: ${spec.ssid} | เกณฑ์ ≥ ${spec.wifiMinDl}/${spec.wifiMinUl}M)</span>
              <span id="apWifiBadge_${idx}">${validateApSpeedBadge(ap.speed_wifi_dl, ap.speed_wifi_ul, spec.wifiMinDl, spec.wifiMinUl)}</span>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <input id="apWifiDl_${idx}" oninput="onApSpeedOrStickerInput(${idx})" type="text" value="${ap.speed_wifi_dl || ''}" placeholder="Download (≥ ${spec.wifiMinDl}M)" class="px-2.5 py-1.5 rounded border border-slate-300 text-xs" />
              <input id="apWifiUl_${idx}" oninput="onApSpeedOrStickerInput(${idx})" type="text" value="${ap.speed_wifi_ul || ''}" placeholder="Upload (≥ ${spec.wifiMinUl}M)" class="px-2.5 py-1.5 rounded border border-slate-300 text-xs" />
            </div>
          </div>
          <div>
            <div class="flex items-center justify-between mb-1.5">
              <span class="text-xs font-bold text-slate-700">🔌 ทดสอบสาย LAN (Port ไหนก็ได้ | เกณฑ์ ≥ ${spec.lanMinDl}/${spec.lanMinUl}M)</span>
              <span id="apLanBadge_${idx}">${validateApSpeedBadge(ap.speed_lan_dl, ap.speed_lan_ul, spec.lanMinDl, spec.lanMinUl)}</span>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <input id="apLanDl_${idx}" oninput="onApSpeedOrStickerInput(${idx})" type="text" value="${ap.speed_lan_dl || ''}" placeholder="Download (≥ ${spec.lanMinDl}M)" class="px-2.5 py-1.5 rounded border border-slate-300 text-xs" />
              <input id="apLanUl_${idx}" oninput="onApSpeedOrStickerInput(${idx})" type="text" value="${ap.speed_lan_ul || ''}" placeholder="Upload (≥ ${spec.lanMinUl}M)" class="px-2.5 py-1.5 rounded border border-slate-300 text-xs" />
            </div>
          </div>
        </div>

        <!-- AP 3 Photo Upload Slots -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div id="slotApDevice_${idx}" class="border border-dashed border-slate-300 rounded-xl p-3 text-center bg-white"></div>
          <div id="slotApWifi_${idx}" class="border border-dashed border-slate-300 rounded-xl p-3 text-center bg-white"></div>
          <div id="slotApLan_${idx}" class="border border-dashed border-slate-300 rounded-xl p-3 text-center bg-white"></div>
        </div>
      </div>
    `;
  }).join('');

  // Render photo uploaders for each AP
  aps.forEach((ap, idx) => {
    const spec = detectRoomSpec(ap.room);
    renderPhotoSlot(`slotApDevice_${idx}`, `ap${idx + 1}_device`, `1. รูปถ่าย AP ตัวที่ ${idx + 1} (${ap.room || ''}) เห็น Sticker ชัดเจน`, ap.photo_device, url => {
      currentCircuit.access_points[idx].photo_device = url;
      renderModalCompletenessBar();
    });
    renderPhotoSlot(`slotApWifi_${idx}`, `ap${idx + 1}_wifi`, `2. รูปผลทดสอบ WiFi (${spec.ssid} ≥ ${spec.wifiMinDl}/${spec.wifiMinUl}M)`, ap.photo_wifi, url => {
      currentCircuit.access_points[idx].photo_wifi = url;
      renderModalCompletenessBar();
    });
    renderPhotoSlot(`slotApLan_${idx}`, `ap${idx + 1}_lan`, `3. รูปผลทดสอบสาย LAN (${spec.code} ≥ ${spec.lanMinDl}/${spec.lanMinUl}M)`, ap.photo_lan, url => {
      currentCircuit.access_points[idx].photo_lan = url;
      renderModalCompletenessBar();
    });
  });
}

// ============================================================================
// Photo Upload Helper (with Auto S/N OCR on Device Sticker Photos!)
// ============================================================================
function renderPhotoSlot(containerId, slotKey, label, currentUrl, onUploaded) {
  const el = document.getElementById(containerId);
  if (!el) return;

  const isDeviceStickerSlot = slotKey === 'router_device' || /^ap\d+_device$/.test(slotKey);
  const snTarget = slotKey === 'router_device'
    ? 'router'
    : /^ap(\d+)_device$/.test(slotKey)
      ? `ap_${ Number(slotKey.match(/^ap(\d+)_device$/)[1]) - 1 }`
      : null;

  const inputId = `fileInput_${containerId}`;
  el.innerHTML = `
    <div class="text-xs font-bold text-slate-700 mb-2">${label}</div>
    ${currentUrl ? `
      <div class="relative group mb-2">
        <img src="${currentUrl}" class="w-full h-36 object-cover rounded-lg border border-slate-200 mx-auto" />
        <div class="flex items-center justify-center gap-3 mt-1.5">
          ${isDeviceStickerSlot ? `
            <button type="button" onclick="readSnFromExistingPhoto('${currentUrl}', '${snTarget}')" class="text-[11px] bg-amber-100 hover:bg-amber-200 text-amber-900 font-bold px-2.5 py-0.5 rounded border border-amber-300">
              🔍 อ่านค่า S/N จากรูปนี้
            </button>
          ` : ''}
          <button type="button" id="removeBtn_${containerId}" class="text-[11px] text-rose-600 hover:underline font-semibold">ลบรูปนี้</button>
        </div>
      </div>
    ` : `
      <div class="h-28 flex flex-col items-center justify-center text-slate-400 text-xs bg-slate-100/70 rounded-lg mb-2 border border-slate-200/60">
        <span class="text-xl mb-1">📷</span>
        <span>${isDeviceStickerSlot ? 'ถ่ายรูปสติ๊กเกอร์ ระบบจะอ่าน S/N ให้อัตโนมัติ' : 'ยังไม่มีรูปภาพ'}</span>
      </div>
    `}
    <label for="${inputId}" class="cursor-pointer inline-block w-full py-1.5 px-3 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold text-xs border border-indigo-200 transition">
      ${currentUrl ? '🔄 เปลี่ยนรูปถ่าย / อัปโหลดใหม่' : (isDeviceStickerSlot ? '📸 ถ่ายรูปอุปกรณ์ (พร้อมอ่าน S/N อัตโนมัติ)' : '📸 ถ่ายรูป / เลือกไฟล์รูปภาพ')}
    </label>
    <input id="${inputId}" type="file" accept="image/*" class="hidden" />
  `;

  const fileInput = document.getElementById(inputId);
  fileInput.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file || !currentCircuit) return;
    try {
      showToast('กำลังอัปโหลดรูปภาพ...');
      const compressedDataUrl = await compressImageFile(file, 1400, 0.85);
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          circuitId: currentCircuit.so_number,
          so_number: currentCircuit.so_number,
          slot: slotKey,
          category: slotKey,
          dataUrl: compressedDataUrl,
          data_url: compressedDataUrl
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      onUploaded(data.url);
      renderPhotoSlot(containerId, slotKey, label, data.url, onUploaded);
      renderModalCompletenessBar(currentCircuit);

      // If this is a device sticker photo (MikroTik or AP), automatically extract S/N!
      if (isDeviceStickerSlot && snTarget) {
        showToast('อัปโหลดสำเร็จ — กำลังอ่านรหัส S/N จากรูปถ่ายอัตโนมัติ...');
        await autoExtractSnToField(compressedDataUrl, snTarget);
      } else {
        showToast('อัปโหลดรูปภาพเรียบร้อยแล้ว');
      }
    } catch (err) {
      showToast('อัปโหลดไม่สำเร็จ: ' + err.message, true);
    }
  });

  const removeBtn = document.getElementById(`removeBtn_${containerId}`);
  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      onUploaded('');
      renderPhotoSlot(containerId, slotKey, label, '', onUploaded);
      renderModalCompletenessBar(currentCircuit);
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
// Save Current Circuit Inspection
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
      model: routerModelEl ? routerModelEl.value : 'RB3011',
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
    remarks: document.getElementById('fRemarks').value.trim(),
    inspector_name: document.getElementById('fInspectorName').value.trim(),
    inspector_phone: document.getElementById('fInspectorPhone').value.trim(),
    inspection_date: document.getElementById('fInspectionDate').value.trim(),
    inspector_signature: getSignatureDataUrl('sigInspector') || currentCircuit.inspector_signature || '',
    receiver_name: document.getElementById('fReceiverName').value.trim(),
    receiver_position: document.getElementById('fReceiverPosition').value.trim(),
    receiver_phone: document.getElementById('fReceiverPhone').value.trim(),
    received_date: document.getElementById('fReceivedDate').value.trim(),
    receiver_signature: getSignatureDataUrl('sigReceiver') || currentCircuit.receiver_signature || ''
  };
}

async function saveCurrentInspection(silent = false) {
  if (!currentCircuit) return false;
  try {
    const payload = collectFormPayload();

    if (payload.status === 'pending' && (payload.router_info.serial_no || payload.inspector_name)) {
      payload.status = 'in_progress';
      const radioInProg = document.querySelector('input[name="circuitStatus"][value="in_progress"]');
      if (radioInProg) radioInProg.checked = true;
    }

    const res = await fetch(`/api/circuits/${encodeURIComponent(currentCircuit.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'บันทึกไม่สำเร็จ');

    currentCircuit = data.circuit;
    document.getElementById('modalSaveStatus').textContent = `บันทึกสำเร็จเมื่อ ${new Date().toLocaleTimeString('th-TH')}`;
    if (!silent) {
      showToast(`บันทึกข้อมูลวงจร ${currentCircuit.so_number} เรียบร้อยแล้ว`);
    }
    await refreshAllData();
    return true;
  } catch (err) {
    showToast('เกิดข้อผิดพลาด: ' + err.message, true);
    return false;
  }
}

async function openPrintReportFromModal() {
  if (!currentCircuit) return;
  await saveCurrentInspection(true);
  window.open(`/report.html?id=${encodeURIComponent(currentCircuit.so_number)}`, '_blank');
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
// Cloud Database Modal (Supabase / PostgreSQL)
// ============================================================================
async function openCloudModal() {
  try {
    const res = await fetch('/api/cloud/status');
    const data = await res.json();
    document.getElementById('cfgSupabaseUrl').value = data.supabaseUrl || '';
    document.getElementById('cfgSupabaseKey').placeholder = data.hasKey ? '•••••••• (บันทึก API Key ไว้แล้ว)' : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
    document.getElementById('cfgAutoSync').checked = data.autoSync !== false;
    document.getElementById('cfgSchemaSql').value = data.schemaSql || '';
    document.getElementById('cloudSyncMsg').textContent = '';
    const modal = document.getElementById('cloudModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  } catch (err) {
    showToast('โหลดการตั้งค่า Cloud ไม่สำเร็จ: ' + err.message, true);
  }
}

function closeCloudModal() {
  const modal = document.getElementById('cloudModal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

async function saveCloudSettings() {
  try {
    const supabaseUrl = document.getElementById('cfgSupabaseUrl').value.trim();
    const supabaseKey = document.getElementById('cfgSupabaseKey').value.trim();
    const autoSync = document.getElementById('cfgAutoSync').checked;

    const res = await fetch('/api/cloud/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ supabaseUrl, supabaseKey, autoSync })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'บันทึกไม่สำเร็จ');
    showToast('บันทึกการตั้งค่า Supabase Cloud เรียบร้อยแล้ว');
    await refreshAllData();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function triggerCloudSync(direction) {
  const msgEl = document.getElementById('cloudSyncMsg');
  msgEl.textContent = direction === 'push'
    ? '⏳ กำลังอัปโหลดข้อมูลทั้ง 334 วงจรขึ้น Supabase Cloud...'
    : '⏳ กำลังดึงข้อมูลล่าสุดจาก Supabase Cloud...';
  msgEl.className = 'text-xs font-semibold text-center text-indigo-600';

  try {
    await saveCloudSettings();
    const res = await fetch('/api/cloud/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'ซิงค์ข้อมูลไม่สำเร็จ');
    msgEl.textContent = direction === 'push'
      ? `✅ ซิงค์ข้อมูลขึ้น Supabase Cloud สำเร็จครบ ${data.count} วงจร!`
      : `✅ ดึงข้อมูลจาก Supabase Cloud สำเร็จ ${data.count} วงจร!`;
    msgEl.className = 'text-xs font-bold text-center text-emerald-600';
    await refreshAllData();
  } catch (err) {
    msgEl.textContent = '❌ ' + err.message;
    msgEl.className = 'text-xs font-bold text-center text-rose-600';
  }
}

function copySchemaSql() {
  const sql = document.getElementById('cfgSchemaSql').value;
  navigator.clipboard.writeText(sql);
  showToast('คัดลอกคำสั่ง SQL สำหรับ Supabase เรียบร้อยแล้ว');
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
let activeSnTarget = 'router'; // 'router' | 'ap_0' | 'ap_1' ...
let liveHtml5QrCode = null;
let liveCameraRunning = false;

function openSnScanner(target) {
  activeSnTarget = target || 'router';
  const titleEl = document.getElementById('snModalTitle');
  if (titleEl) {
    if (activeSnTarget === 'router') {
      titleEl.textContent = '📷 ถ่ายรูปสติ๊กเกอร์ / สแกนอ่าน S/N — อุปกรณ์ MikroTik Router';
    } else {
      const idx = Number(activeSnTarget.replace('ap_', '')) + 1;
      titleEl.textContent = `📷 ถ่ายรูปสติ๊กเกอร์ / สแกนอ่าน S/N — Access Point ตัวที่ ${idx}`;
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
      const slotKey = activeSnTarget === 'router'
        ? 'router_device'
        : `ap${Number(activeSnTarget.replace('ap_', '')) + 1}_device`;
      fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          circuitId: currentCircuit.so_number,
          slot: slotKey,
          dataUrl: compressedDataUrl
        })
      }).then(r => r.json()).then(upData => {
        if (upData.ok && upData.url) {
          if (activeSnTarget === 'router') {
            currentCircuit.router_info.photo_device = upData.url;
            renderPhotoSlot('slotRouterDevice', 'router_device', '1.1 รูปถ่ายอุปกรณ์ MikroTik (เห็น Sticker ใหม่ชัดเจน)', upData.url, u => {
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
// Admin QA Verification Center (Step 5: Admin ตรวจสอบความถูกต้องครบถ้วน & อนุมัติ)
// ============================================================================
let adminOverviewData = null;
let currentAdminFilter = 'all';

async function loadAdminOverview() {
  try {
    const res = await fetch('/api/admin/overview');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'โหลดข้อมูล Admin ไม่สำเร็จ');
    adminOverviewData = data;

    const items = data.items || [];
    const activeAll = items.length;
    const pendingReview = items.filter(i => i.admin_status === 'pending_review').length;
    const working = items.filter(i => i.checkin_status === 'checked_in').length;
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
    setEl('admCountSnMismatch', snMismatch);
    setEl('admCountIncompletePhotos', incompletePhotos);
    setEl('admCountApproved', approved);

    renderAdminQueueTable();
  } catch (err) {
    showToast(err.message, true);
  }
}

function filterAdminList(mode) {
  currentAdminFilter = mode || 'all';
  const cardMap = {
    all: 'admCardActiveAll',
    pending_review: 'admCardPendingReview',
    working: 'admCardWorking',
    sn_mismatch: 'admCardSnMismatch',
    incomplete_photos: 'admCardIncompletePhotos',
    approved: 'admCardApproved'
  };
  Object.entries(cardMap).forEach(([key, cardId]) => {
    const el = document.getElementById(cardId);
    if (!el) return;
    if (key === currentAdminFilter) {
      el.classList.add('ring-2', 'ring-slate-900');
    } else {
      el.classList.remove('ring-2', 'ring-slate-900');
    }
  });
  renderAdminQueueTable();
}

function renderAdminQueueTable() {
  const container = document.getElementById('adminQueueContainer');
  if (!container || !adminOverviewData) return;

  const q = (document.getElementById('adminSearchInput')?.value || '').trim().toLowerCase();
  let rows = adminOverviewData.items || [];

  if (currentAdminFilter === 'pending_review') {
    rows = rows.filter(r => r.admin_status === 'pending_review');
  } else if (currentAdminFilter === 'working') {
    rows = rows.filter(r => r.checkin_status === 'checked_in');
  } else if (currentAdminFilter === 'sn_mismatch') {
    rows = rows.filter(r => (r.completeness?.snMismatchCount || 0) > 0);
  } else if (currentAdminFilter === 'incomplete_photos') {
    rows = rows.filter(r => !r.completeness?.allRequiredPhotosComplete);
  } else if (currentAdminFilter === 'approved') {
    rows = rows.filter(r => r.admin_status === 'approved');
  }

  if (q) {
    rows = rows.filter(r =>
      (r.so_number || '').toLowerCase().includes(q) ||
      (r.province || '').toLowerCase().includes(q) ||
      (r.branch_name || '').toLowerCase().includes(q) ||
      (r.inspector_name || '').toLowerCase().includes(q)
    );
  }

  if (rows.length === 0) {
    container.innerHTML = `
      <div class="bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-500 text-xs shadow-sm">
        ไม่พบรายการวงจรในหมวดหมู่นี้ (เมื่อช่างกด Check-in หรืออัปโหลดรูปผ่านหน้าเว็บ / LINE Bot รายการจะแสดงที่นี่ทันที)
      </div>
    `;
    return;
  }

  container.innerHTML = rows.map(r => {
    const comp = r.completeness || { uploadedRequiredCount: 0, totalRequiredCount: 9, missingPhotoLabels: [], snComparisons: [] };
    const checkinStr = r.checkin_time ? new Date(r.checkin_time).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : 'ยังไม่ Check-in';
    const checkoutStr = r.checkout_time ? new Date(r.checkout_time).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : 'กำลังปฏิบัติงาน';

    const snHtml = (comp.snComparisons || []).map(s => {
      const icon = s.status === 'matched' ? '✅' : s.status === 'mismatch' ? '❌' : s.status === 'missing' ? '⬜' : '⚠️';
      const cls = s.status === 'matched'
        ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
        : s.status === 'mismatch'
          ? 'bg-rose-50 text-rose-900 border-rose-300 font-bold'
          : 'bg-slate-50 text-slate-700 border-slate-200';
      return `
        <div class="px-2.5 py-1.5 rounded-lg border text-xs ${cls}">
          <div>${icon} <strong>${s.deviceLabel}</strong></div>
          <div class="font-mono text-[11px] mt-0.5">✍️ ช่าง: <code>${s.manualSn || '-'}</code> | 🤖 OCR: <code>${s.ocrSn || '-'}</code></div>
        </div>
      `;
    }).join('');

    let admBadge = `<span class="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-bold">👷 กำลังปฏิบัติงาน</span>`;
    if (r.admin_status === 'pending_review') {
      admBadge = `<span class="px-3 py-1 rounded-full bg-amber-100 text-amber-800 border border-amber-300 text-xs font-extrabold">⏳ รอ Admin ตรวจสอบ</span>`;
    } else if (r.admin_status === 'approved') {
      admBadge = `<span class="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 text-xs font-extrabold">✅ อนุมัติแล้ว (${r.admin_reviewer || 'Admin'})</span>`;
    } else if (r.admin_status === 'rejected') {
      admBadge = `<span class="px-3 py-1 rounded-full bg-rose-100 text-rose-800 border border-rose-300 text-xs font-extrabold">❌ ส่งกลับให้แก้ไข (${r.admin_review_note || '-'})</span>`;
    }

    return `
      <div class="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm hover:shadow-md transition">
        <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div class="flex flex-wrap items-center gap-2">
            <span class="px-2.5 py-1 rounded-lg bg-slate-900 text-white font-mono text-xs font-extrabold">${r.so_number}</span>
            <span class="px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-800 text-xs font-extrabold">${r.province}</span>
            <span class="text-xs font-bold text-slate-800">${r.branch_name || ''}</span>
            ${admBadge}
          </div>
          <div class="flex items-center gap-1.5 flex-wrap">
            <button onclick="openInspectionModal('${r.so_number}')" class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold transition">
              🔍 เปิดดูรูป/แก้ไขข้อมูล
            </button>
            <a href="/api/circuits/${encodeURIComponent(r.so_number)}/report.docx" target="_blank" class="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-extrabold transition">
              📝 รายงาน Word (.docx)
            </a>
            <button onclick="promptAdminReview('${r.so_number}', 'approved')" class="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold shadow-sm transition">
              ✅ อนุมัติผ่าน (Approve)
            </button>
            <button onclick="promptAdminReview('${r.so_number}', 'rejected')" class="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-extrabold shadow-sm transition">
              ❌ ส่งกลับให้แก้ (Reject)
            </button>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-3 pt-3">
          <div class="bg-slate-50 rounded-xl p-3 border border-slate-200/80 text-xs space-y-1">
            <div class="font-extrabold text-slate-700">1. ข้อมูลช่าง & เวลาเข้า-ออก Site</div>
            <div>👷 ช่าง: <strong>${r.inspector_name || '-'}</strong> (${r.inspector_phone || '-'})</div>
            <div class="text-emerald-700 font-semibold">📍 Check-in: ${checkinStr}</div>
            <div class="text-indigo-700 font-semibold">🏁 Check-out: ${checkoutStr}</div>
          </div>

          <div class="bg-slate-50 rounded-xl p-3 border border-slate-200/80 text-xs space-y-1">
            <div class="flex items-center justify-between">
              <span class="font-extrabold text-slate-700">2. ความครบถ้วนของรูปถ่าย</span>
              <span class="px-2 py-0.5 rounded-full text-[11px] font-extrabold ${
                comp.allRequiredPhotosComplete ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
              }">📷 ${comp.uploadedRequiredCount}/${comp.totalRequiredCount} รูป (${comp.photoProgressPct || 0}%)</span>
            </div>
            ${(comp.missingPhotoLabels || []).length > 0 ? `
              <div class="text-[11px] text-rose-600 leading-relaxed">
                <strong>รูปที่ยังขาด:</strong> ${comp.missingPhotoLabels.join(', ')}
              </div>
            ` : `<div class="text-emerald-700 font-bold">✅ อัปโหลดรูปครบทุกจุดบังคับแล้ว</div>`}
          </div>

          <div class="bg-slate-50 rounded-xl p-3 border border-slate-200/80 text-xs space-y-1.5">
            <div class="font-extrabold text-slate-700">3. ตรวจสอบ S/N (ช่างกรอก vs OCR)</div>
            <div class="grid grid-cols-1 gap-1.5">
              ${snHtml}
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function promptAdminReview(soNumber, decision) {
  const adminName = document.getElementById('adminNameInput')?.value.trim() || 'Admin QA';
  let adminComment = '';
  if (decision === 'rejected') {
    adminComment = prompt(`ระบุสิ่งที่ต้องให้ช่างแก้ไขสำหรับวงจร ${soNumber} (ระบบจะแจ้งเตือนกลับไปที่ LINE ช่างทันที):`, 'กรุณาถ่ายรูป Sticker อุปกรณ์ให้เห็น S/N ชัดเจนอีกครั้ง');
    if (adminComment === null) return;
  } else {
    adminComment = prompt(`หมายเหตุการอนุมัติวงจร ${soNumber} (เว้นว่างได้):`, 'ข้อมูลและรูปถ่ายครบถ้วนสมบูรณ์ อนุมัติออกรายงาน MS Word');
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
    if (!res.ok) throw new Error(data.error || 'บันทึกผลตรวจ Admin ไม่สำเร็จ');
    showToast(decision === 'approved'
      ? `✅ Admin อนุมัติวงจร ${soNumber} เรียบร้อยแล้ว! (แจ้งเตือนเข้า LINE ช่างแล้ว)`
      : `⚠️ ส่งกลับวงจร ${soNumber} ให้ช่างแก้ไขเรียบร้อยแล้ว`);
    await loadAdminOverview();
    await refreshAllData();
  } catch (err) {
    showToast(err.message, true);
  }
}


