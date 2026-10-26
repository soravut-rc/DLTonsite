const seedCircuits = require('./data/seed_circuits.json');
const { generateCircuitDocx } = require('./lib/docx_generator');
const admin = require('./lib/admin');
const lineReport = require('./lib/line_report');
const {
  evaluateCircuitCompleteness,
  verifyLineSignature,
  sendLineReply
} = require('./lib/completeness_and_line');

// ============================================================================
// In-Memory State (Pre-seeded with all 334 DLT Circuits + Optional Supabase Sync)
// ============================================================================
const circuitsMap = new Map();
const uploadsMap = new Map(); // '/uploads/...' -> 'data:image/...'
const lineUserSessions = new Map();
const lineMessages = [];
const modifiedSoNumbers = new Set();
let r2StateHydrated = false;
const R2_STATE_KEY = 'state/modified_circuits_v1.json';

async function hydrateStateFromR2(env) {
  initSeedData();
  if (r2StateHydrated || !env || !env.PHOTOS_BUCKET) return;
  try {
    const obj = await env.PHOTOS_BUCKET.get(R2_STATE_KEY);
    if (obj) {
      const saved = await obj.json();
      if (saved && typeof saved === 'object' && Array.isArray(saved.circuits)) {
        for (const item of saved.circuits) {
          if (item && item.so_number) {
            const existing = circuitsMap.get(item.so_number) || {};
            circuitsMap.set(item.so_number, { ...existing, ...item });
            modifiedSoNumbers.add(item.so_number);
          }
        }
      }
    }
    r2StateHydrated = true;
  } catch (err) {
    console.warn('R2 hydrate warning:', err.message);
  }
}

async function persistModifiedStateToR2(env, soList = []) {
  for (const so of soList) {
    if (so) modifiedSoNumbers.add(so);
  }
  if (!env || !env.PHOTOS_BUCKET) return;
  try {
    const listToSave = [];
    for (const so of modifiedSoNumbers) {
      const c = circuitsMap.get(so);
      if (c) listToSave.push(c);
    }
    await env.PHOTOS_BUCKET.put(
      R2_STATE_KEY,
      JSON.stringify({ updated_at: new Date().toISOString(), circuits: listToSave }),
      { httpMetadata: { contentType: 'application/json' } }
    );
  } catch (err) {
    console.warn('R2 persist warning:', err.message);
  }
}

function initSeedData() {
  if (circuitsMap.size > 0) return;
  seedCircuits.forEach((item, idx) => seedOneCircuit(item, idx));
}

// Puts one circuit back to its seed state (UAT reset); circuits that were created in the app have no seed and are removed.
function reseedCircuit(so) {
  const idx = seedCircuits.findIndex(item => item.so_number === so);
  if (idx < 0) circuitsMap.delete(so);
  else seedOneCircuit(seedCircuits[idx], idx);
}

function seedOneCircuit(item, idx) {
  {
    const so = item.so_number;
    const defaultRouter = {
      brand: 'MikroTik',
      model: 'RB4011iGS+RM',
      serial_no: '',
      ocr_serial_no: '',
      ip_lan: '',
      ip_wan: '',
      subnet: '',
      gateway: '',
      mac_address: '',
      firmware: '',
      rack_cabinet: 'Rack 6U Wall Mount',
      ups_brand_model: 'APC / Syndome 1000VA',
      ups_serial: '',
      photos: {
        site_sign: '',
        rack_closed: '',
        rack_open: '',
        router_device: '',
        ups_device: '',
        lan_speedtest: '',
        old_equipment: ''
      },
      ...(item.router_info || {})
    };
    const defaultAps = Array.isArray(item.access_points) && item.access_points.length > 0
      ? item.access_points
      : [
          {
            ap_id: 1,
            name: 'AP จุดที่ 1 (โถงบริการประชาชนชั้น 1)',
            brand: 'Ruijie / Aruba / Cisco',
            model: 'Wi-Fi 6 Dual-Band Ceiling AP',
            serial_no: '',
            ocr_serial_no: '',
            ssid: 'DLT-FreeWiFi',
            security_mode: 'WPA2/WPA3-Enterprise',
            ip_address: '',
            mac_address: '',
            install_location: 'โถงบริการชั้น 1',
            signal_dbm: '-52 dBm',
            download_mbps: '',
            upload_mbps: '',
            ping_ms: '',
            photos: {
              ap_device: '',
              ap_install: '',
              wifi_connect: '',
              wlan_speedtest: ''
            }
          },
          {
            ap_id: 2,
            name: 'AP จุดที่ 2 (ห้องอบรม/สอบใบขับขี่)',
            brand: 'Ruijie / Aruba / Cisco',
            model: 'Wi-Fi 6 Dual-Band Ceiling AP',
            serial_no: '',
            ocr_serial_no: '',
            ssid: 'DLT-Office',
            security_mode: 'WPA2-PSK',
            ip_address: '',
            mac_address: '',
            install_location: 'ห้องอบรม/สอบใบขับขี่',
            signal_dbm: '-55 dBm',
            download_mbps: '',
            upload_mbps: '',
            ping_ms: '',
            photos: {
              ap_device: '',
              ap_install: '',
              wifi_connect: '',
              wlan_speedtest: ''
            }
          }
        ];

    circuitsMap.set(so, {
      id: item.id || `dlt-${so}`,
      seq: item.seq || idx + 1,
      so_number: so,
      service_no: item.service_no || so,
      region: item.region || 'ส่วนภูมิภาค',
      province: item.province || 'ไม่ระบุจังหวัด',
      raw_province_folder: item.raw_province_folder || '',
      branch_name: item.branch_name || '',
      short_branch_name: item.short_branch_name || '',
      customer_site_name: item.customer_site_name || '',
      pppoe_username: item.pppoe_username || '',
      pppoe_password: item.pppoe_password || '',
      rooms_summary_code: item.rooms_summary_code || '',
      address: item.address || '',
      lat_long: item.lat_long || '',
      speed_pkg: item.speed_pkg || '650M/350M',
      legacy_pdf_path: item.legacy_pdf_path || '',
      status: item.status || 'pending',
      router_info: defaultRouter,
      access_points: defaultAps,
      remarks: item.remarks || '',
      inspector_name: item.inspector_name || '',
      inspector_phone: item.inspector_phone || '',
      inspection_date: item.inspection_date || '',
      inspector_signature: item.inspector_signature || '',
      receiver_name: item.receiver_name || '',
      receiver_position: item.receiver_position || '',
      receiver_phone: item.receiver_phone || '',
      received_date: item.received_date || '',
      receiver_signature: item.receiver_signature || '',
      checkin_status: item.checkin_status || 'none',
      checkin_time: item.checkin_time || '',
      checkout_time: item.checkout_time || '',
      line_user_id: item.line_user_id || '',
      admin_status: item.admin_status || 'none',
      admin_name: item.admin_name || item.admin_reviewer || '',
      admin_comment: item.admin_comment || item.admin_review_note || '',
      admin_reviewed_at: item.admin_reviewed_at || item.admin_review_time || '',
      admin_reviewer: item.admin_reviewer || '',
      admin_review_time: item.admin_review_time || '',
      admin_review_note: item.admin_review_note || '',
      cloud_synced: 0,
      updated_at: item.updated_at || new Date().toISOString()
    });
  }
}

let runtimeLineConfig = {
  channelAccessToken: '',
  channelSecret: '',
  publicBaseUrl: ''
};

function extractSiteNameServer(c) {
  if (!c) return '';
  if (c.site_name && String(c.site_name).trim()) return String(c.site_name).trim();
  const custRaw = String(c.customer_site_name || '').trim();
  const branchRaw = String(c.short_branch_name || c.branch_name || '').trim();
  // Prefer customer_site_name when it specifies the actual office/district/section (e.g. สำนักงานขนส่งกรุงเทพมหานครพื้นที่ 1..5, ส่วนตรวจสภาพรถ)
  const useCust = custRaw && !/^สขจ\./.test(custRaw);
  const src = useCust ? custRaw : (branchRaw || custRaw);
  const cleaned = String(src)
    .replace(/\s*วงจรที่\s*\d+.*$/i, '')
    .replace(/\s*\(วงจรที่\s*\d+.*$/i, '')
    .replace(/\s*\((?:BINF|2272|3480)[^)]*\)\s*$/i, '')
    .trim();
  return cleaned || `สขจ.${c.province || ''}`;
}

function getSiteGroupKeyServer(c) {
  if (!c) return '';
  if (c.site_key && String(c.site_key).trim()) return String(c.site_key).trim();
  return `${c.province || ''}::${extractSiteNameServer(c)}`;
}

function getSiteCircuitsServer(targetCircuit) {
  if (!targetCircuit) return [];
  const key = getSiteGroupKeyServer(targetCircuit);
  const all = Array.from(circuitsMap.values());
  return all
    .filter(item => getSiteGroupKeyServer(item) === key)
    .sort((a, b) => String(a.so_number || '').localeCompare(String(b.so_number || '')));
}

function findCircuitByIdOrSo(idOrSo) {
  if (!idOrSo) return null;
  const raw = String(idOrSo).trim();
  if (circuitsMap.has(raw)) return circuitsMap.get(raw);
  const stripped = raw.replace(/^dlt-/i, '');
  if (circuitsMap.has(stripped)) return circuitsMap.get(stripped);
  for (const c of circuitsMap.values()) {
    if (c.id === raw || c.so_number === raw) return c;
  }
  return null;
}

function enrichCircuit(c) {
  if (!c) return null;
  const completeness = evaluateCircuitCompleteness(c);
  const rt = c.router_info || {};
  const aps = Array.isArray(c.access_points) ? c.access_points : [];
  const siteName = extractSiteNameServer(c);
  const siteKey = getSiteGroupKeyServer(c);
  return {
    ...c,
    site_name: siteName,
    site_key: siteKey,
    router_summary: {
      model: rt.model || 'RB3011',
      serial_no: rt.serial_no || '',
      expected_serial_no: rt.expected_serial_no || '',
      ocr_serial_no: rt.ocr_serial_no || '',
      room: rt.room || '',
      floor: rt.floor || '',
      building: rt.building || '',
      location_detail: rt.location_detail || '',
      speed_lan2_dl: rt.speed_lan2_dl || '',
      speed_lan2_ul: rt.speed_lan2_ul || '',
      speed_lan3_dl: rt.speed_lan3_dl || '',
      speed_lan3_ul: rt.speed_lan3_ul || ''
    },
    ap_summary: aps.filter(ap => ap && ap.checked !== false).map(ap => ({
      ap_no: ap.ap_no,
      brand: ap.brand || 'TOTOLINK',
      model: ap.model || 'A3002RU',
      serial_no: ap.serial_no || '',
      expected_serial_no: ap.expected_serial_no || '',
      ocr_serial_no: ap.ocr_serial_no || '',
      room_type: ap.room_type || '',
      room: ap.room || '',
      ssid: ap.ssid || '',
      lan_target: ap.lan_target || '',
      wifi_target: ap.wifi_target || '',
      gecc_anydesk_id: ap.gecc_anydesk_id || '',
      gecc_wan_to_lan: Boolean(ap.gecc_wan_to_lan || ap.gecc_wan_to_lan_moved),
      gecc_remote_config_done: Boolean(ap.gecc_remote_config_done),
      gecc_authen_wifi: Boolean(ap.gecc_authen_wifi || ap.gecc_authen_tested)
    })),
    photo_count: completeness.uploadedRequiredCount ?? completeness.uploadedPhotos ?? 0,
    expected_photo_count: completeness.totalRequiredCount ?? completeness.requiredPhotosCount ?? 8,
    required_photo_count: completeness.totalRequiredCount ?? completeness.requiredPhotosCount ?? 8,
    is_photo_complete: Boolean(completeness.isPhotoComplete ?? completeness.allRequiredPhotosComplete),
    onsite_photo_count: completeness.onsiteUploadedCount ?? 0,
    onsite_required_count: completeness.onsiteRequiredCount ?? 3,
    is_onsite_complete: Boolean(completeness.isOnsitePhotoComplete),
    handover_scan_count: completeness.handoverUploadedCount ?? 0,
    is_handover_scanned: Boolean(completeness.isHandoverComplete),
    is_report_ready: Boolean(completeness.isReportReady),
    has_sn_mismatch: Boolean(completeness.hasSnMismatch || (completeness.snMismatchCount > 0)),
    has_missing_sn: Boolean(completeness.hasMissingSn || (completeness.missingSnCount > 0)),
    completeness
  };
}

function buildSummary(list) {
  const summary = {
    total: list.length,
    pending: 0,
    in_progress: 0,
    completed: 0,
    issue: 0,
    cloud_synced: 0,
    checked_in: 0,
    checked_out: 0,
    admin_pending: 0,
    admin_approved: 0,
    admin_rejected: 0,
    regions: {},
    provinces: {}
  };

  for (const c of list) {
    if (summary[c.status] !== undefined) summary[c.status]++;
    if (c.cloud_synced) summary.cloud_synced++;
    if (c.checkin_status === 'checked_in') summary.checked_in++;
    if (c.checkin_status === 'checked_out') summary.checked_out++;
    if (c.admin_status === 'pending_review') summary.admin_pending++;
    if (c.admin_status === 'approved') summary.admin_approved++;
    if (c.admin_status === 'rejected') summary.admin_rejected++;

    if (!summary.regions[c.region]) {
      summary.regions[c.region] = { total: 0, completed: 0, in_progress: 0, pending: 0, issue: 0 };
    }
    summary.regions[c.region].total++;
    if (summary.regions[c.region][c.status] !== undefined) {
      summary.regions[c.region][c.status]++;
    }

    if (!summary.provinces[c.province]) {
      summary.provinces[c.province] = {
        region: c.region,
        total: 0,
        completed: 0,
        in_progress: 0,
        pending: 0,
        issue: 0
      };
    }
    summary.provinces[c.province].total++;
    if (summary.provinces[c.province][c.status] !== undefined) {
      summary.provinces[c.province][c.status]++;
    }
  }
  return summary;
}

function getLineSession(userId) {
  const id = userId || 'sim_tech_01';
  if (!lineUserSessions.has(id)) {
    lineUserSessions.set(id, {
      line_user_id: id,
      display_name: id === 'sim_tech_01' ? 'ช่างทดสอบ (Simulator)' : id,
      active_so: '',
      pending_slot: 'router_device',
      tech_name: '',
      tech_phone: '',
      updated_at: new Date().toISOString()
    });
  }
  return lineUserSessions.get(id);
}

function addLineMessage(userId, senderRole, messageText, mediaUrl = '', soNumber = '') {
  const msg = {
    id: lineMessages.length + 1,
    line_user_id: userId,
    so_number: soNumber,
    sender_role: senderRole,
    message_text: messageText,
    media_url: mediaUrl,
    created_at: new Date().toISOString()
  };
  lineMessages.push(msg);
  if (lineMessages.length > 300) lineMessages.shift();
  return msg;
}

async function storeDataUrlAsUpload(soNumber, prefix, dataUrl, env = null) {
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return dataUrl || '';
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return dataUrl;
  const mime = m[1].toLowerCase();
  const ext = mime.includes('png') ? 'png' : 'jpg';
  const pathKey = `/uploads/${encodeURIComponent(soNumber)}/${prefix}_${Date.now()}.${ext}`;
  uploadsMap.set(pathKey, dataUrl);

  // If Cloudflare R2 bucket is bound
  if (env && env.PHOTOS_BUCKET) {
    try {
      const r2Key = pathKey.replace(/^\//, ''); // e.g. uploads/BINF3480006/photo_123.jpg
      const bin = Buffer.from(m[2], 'base64');
      await env.PHOTOS_BUCKET.put(r2Key, bin, {
        httpMetadata: {
          contentType: mime,
          cacheControl: 'public, max-age=31536000'
        }
      });
    } catch (err) {
      console.warn('R2 upload warning:', err.message);
    }
  }

  return pathKey;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Line-Signature'
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    await hydrateStateFromR2(env);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Line-Signature'
        }
      });
    }

    const url = new URL(request.url);
    const pathname = url.pathname;

    // Serve uploaded images (R2 Bucket first, fallback to in-memory cache)
    if (pathname.startsWith('/uploads/')) {
      const r2Key = pathname.replace(/^\//, '');
      if (env && env.PHOTOS_BUCKET) {
        try {
          const r2Obj = await env.PHOTOS_BUCKET.get(r2Key);
          if (r2Obj) {
            const headers = new Headers();
            r2Obj.writeHttpMetadata(headers);
            headers.set('etag', r2Obj.httpEtag);
            headers.set('Cache-Control', 'public, max-age=31536000');
            return new Response(r2Obj.body, { headers });
          }
        } catch (_) {}
      }

      const dataUrl = uploadsMap.get(pathname);
      if (dataUrl) {
        const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
        if (m) {
          const bin = Buffer.from(m[2], 'base64');
          return new Response(bin, {
            status: 200,
            headers: {
              'Content-Type': m[1],
              'Cache-Control': 'public, max-age=3600'
            }
          });
        }
      }
      return new Response('Not Found', { status: 404 });
    }

    // ========================================================================
    // API Routes
    // ========================================================================
    if (pathname.startsWith('/api/')) {
      try {
        // 0. Admin back-office (login, review & lock, exports, UAT reset) + lock guard for technician writes
        const adminCtx = await admin.authenticate(request, env);
        const adminHelpers = {
          circuitsMap, uploadsMap, modifiedSoNumbers, jsonResponse, enrichCircuit, evaluateCircuitCompleteness,
          findCircuitByIdOrSo, getSiteCircuitsServer, getSiteGroupKeyServer, extractSiteNameServer, addLineMessage,
          persist: persistModifiedStateToR2, reseed: reseedCircuit
        };
        const adminRes = await admin.handle(request, env, url, adminHelpers, adminCtx);
        if (adminRes) return adminRes;
        const lockedRes = await admin.guardWrite(request, url, adminHelpers, adminCtx);
        if (lockedRes) return lockedRes;

        // 1. GET & POST /api/circuits
        if (pathname === '/api/circuits' && request.method === 'GET') {
          const list = Array.from(circuitsMap.values()).map(enrichCircuit);
          return jsonResponse({
            summary: buildSummary(list),
            circuits: list
          });
        }

        if (pathname === '/api/circuits' && request.method === 'POST') {
          const body = await request.json().catch(() => ({}));
          const so = String(body.so_number || '').trim().toUpperCase();
          if (!so) return jsonResponse({ error: 'กรุณาระบุเลขที่วงจร (S/O)' }, 400);
          if (circuitsMap.has(so)) {
            return jsonResponse({ error: `รหัสวงจร ${so} มีอยู่ในระบบแล้ว` }, 400);
          }
          const nowIso = new Date().toISOString();
          const province = body.province || 'กรุงเทพมหานคร';
          const siteName = body.site_name || extractSiteNameServer(body);
          const siteKey = body.site_key || `${province}::${siteName}`;
          const newCircuit = {
            id: body.id || so,
            seq: circuitsMap.size + 1,
            so_number: so,
            service_no: body.service_no || so,
            region: body.region || 'ภาคกลาง',
            province,
            raw_province_folder: body.raw_province_folder || province,
            branch_name: body.branch_name || `${siteName} (${so})`,
            short_branch_name: body.short_branch_name || siteName,
            customer_site_name: body.customer_site_name || siteName,
            site_name: siteName,
            site_key: siteKey,
            pppoe_username: body.pppoe_username || '',
            pppoe_password: body.pppoe_password || '',
            rooms_summary_code: body.rooms_summary_code || '',
            address: body.address || '',
            lat_long: body.lat_long || '',
            speed_pkg: body.speed_pkg || '650M/350M',
            legacy_pdf_path: body.legacy_pdf_path || '',
            status: body.status || 'pending',
            router_info: {
              checked: true,
              brand: 'MikroTik',
              model: body.router_info?.model || 'RB3011',
              serial_no: body.router_info?.serial_no || '',
              ocr_serial_no: body.router_info?.ocr_serial_no || '',
              asset_no: body.router_info?.asset_no || `สขจ.${province}`,
              room: body.router_info?.room || body.router_room || 'ห้อง Server / Rack',
              floor: body.router_info?.floor || body.router_floor || '1',
              building: body.router_info?.building || body.router_building || '1',
              ...(body.router_info || {})
            },
            access_points: Array.isArray(body.access_points)
              ? body.access_points
              : [
                  { ap_no: 1, checked: true, brand: 'TOTOLINK', model: 'A3002RU', room: 'ศูนย์เดินรถ GPS', room_type: 'GPS', asset_no: `สขจ.${province}/GPS`, floor: '1', building: '1' },
                  { ap_no: 2, checked: true, brand: 'TOTOLINK', model: 'A3002RU', room: 'ประชาสัมพันธ์ GECC', room_type: 'GECC', asset_no: `สขจ.${province}/GECC`, floor: '1', building: '1' }
                ],
            remarks: body.remarks || '',
            inspector_name: body.inspector_name || '',
            inspector_phone: body.inspector_phone || '',
            inspection_date: body.inspection_date || '',
            inspector_signature: '',
            receiver_name: '',
            receiver_position: '',
            receiver_phone: '',
            received_date: '',
            receiver_signature: '',
            checkin_status: body.checkin_status || 'none',
            checkin_time: body.checkin_time || '',
            checkout_time: '',
            line_user_id: '',
            admin_status: 'none',
            admin_name: '',
            admin_comment: '',
            admin_reviewed_at: '',
            admin_reviewer: '',
            admin_review_time: '',
            admin_review_note: '',
            is_draft: Boolean(body.is_draft),
            draft_saved_at: body.draft_saved_at || '',
            last_active_room: body.last_active_room || '',
            cloud_synced: 0,
            updated_at: nowIso
          };
          circuitsMap.set(so, newCircuit);
          await persistModifiedStateToR2(env, [so]);
          return jsonResponse({
            ok: true,
            circuit: enrichCircuit(newCircuit),
            site_circuits: getSiteCircuitsServer(newCircuit).map(enrichCircuit)
          });
        }

        // 1.1 GET /api/stats - KPI Statistics & Region/Province Breakdown
        if (pathname === '/api/stats' && request.method === 'GET') {
          const rows = Array.from(circuitsMap.values());
          const total = rows.length;
          const statusCounts = { pending: 0, in_progress: 0, completed: 0, issue: 0 };
          const adminCounts = { working: 0, pending_review: 0, approved: 0, rejected: 0, sn_mismatch: 0, incomplete_photos: 0 };
          const byRegion = {};
          const byProvince = {};
          const routerModels = { 'RB3011': 0, 'RB4011': 0, 'hAP ac2 (RBD52G)': 0, 'อื่นๆ': 0 };
          const apBrands = { 'TOTOLINK': 0, 'TP-LINK': 0, 'D-LINK': 0, 'อื่นๆ': 0 };
          let totalApCount = 0;
          let withLegacyPdf = 0;

          for (const r of rows) {
            const st = statusCounts[r.status] !== undefined ? r.status : 'pending';
            statusCounts[st]++;
            if (r.legacy_pdf_path) withLegacyPdf++;

            if (r.admin_status && adminCounts[r.admin_status] !== undefined) {
              adminCounts[r.admin_status]++;
            }
            const comp = evaluateCircuitCompleteness(r);
            if (comp.snMismatchCount > 0) adminCounts.sn_mismatch++;
            if ((r.status === 'in_progress' || r.status === 'completed' || r.checkin_time) && !comp.allRequiredPhotosComplete) {
              adminCounts.incomplete_photos++;
            }

            if (!byRegion[r.region]) {
              byRegion[r.region] = { total: 0, pending: 0, in_progress: 0, completed: 0, issue: 0 };
            }
            byRegion[r.region].total++;
            byRegion[r.region][st]++;

            const provKey = `${r.region}__${r.province}`;
            if (!byProvince[provKey]) {
              byProvince[provKey] = {
                region: r.region,
                province: r.province,
                total: 0,
                completed: 0,
                in_progress: 0,
                pending: 0,
                issue: 0
              };
            }
            byProvince[provKey].total++;
            byProvince[provKey][st]++;

            const rm = (r.router_info?.model || '').toUpperCase();
            if (rm.includes('3011')) routerModels['RB3011']++;
            else if (rm.includes('4011')) routerModels['RB4011']++;
            else if (rm.includes('HAP') || rm.includes('RBD52G') || rm.includes('AC2')) routerModels['hAP ac2 (RBD52G)']++;
            else routerModels['อื่นๆ']++;

            if (Array.isArray(r.access_points)) {
              for (const ap of r.access_points) {
                if (ap && ap.checked !== false) {
                  totalApCount++;
                  const br = (ap.brand || '').toUpperCase();
                  if (br.includes('TOTO')) apBrands['TOTOLINK']++;
                  else if (br.includes('TP')) apBrands['TP-LINK']++;
                  else if (br.includes('D-LINK') || br.includes('DLINK')) apBrands['D-LINK']++;
                  else apBrands['อื่นๆ']++;
                }
              }
            }
          }

          return jsonResponse({
            total,
            withLegacyPdf,
            statusCounts,
            adminCounts,
            byRegion,
            provinces: Object.values(byProvince).sort((a, b) => a.province.localeCompare(b.province, 'th')),
            routerModels,
            apBrands,
            totalApCount
          });
        }

        // 2. GET /api/circuits/:id/report.docx (1 Site = 1 ไฟล์ Report รวมทุกวงจรใน Site เดียวกัน)
        const docxMatch = /^\/api\/circuits\/([^/]+)\/report\.docx$/.exec(pathname);
        if (docxMatch && request.method === 'GET') {
          const so = decodeURIComponent(docxMatch[1]);
          const circuit = findCircuitByIdOrSo(so);
          if (!circuit) return jsonResponse({ error: `ไม่พบวงจร ${so}` }, 404);
          const siteCircuits = getSiteCircuitsServer(circuit);
          const listForDocx = siteCircuits.length > 0 ? siteCircuits : [circuit];
          // Photos live in R2 (not in this isolate's memory) and the seed holds placeholder asset numbers → show "-".
          const photoMap = await admin.loadPhotoMap(env, listForDocx, uploadsMap);
          const docxBuf = generateCircuitDocx(admin.forReport(listForDocx), photoMap);
          const soComma = listForDocx.map(c => c.so_number).join(',');
          const rawSiteName = extractSiteNameServer(listForDocx[0])
            .replace(/^สำนักงานขนส่งจังหวัด[^ ]*\s*/i, '')
            .replace(/^สขจ\.[^ ]*\s*/i, '')
            .replace(/^สาขา\s*/i, '')
            .trim() || 'อำเภอเมือง';
          const provName = listForDocx[0]?.province || '';
          const utf8Filename = `${soComma} สาขา ${rawSiteName} จังหวัด ${provName}.docx`;
          const asciiFallback = `${soComma}.docx`;
          return new Response(docxBuf, {
            status: 200,
            headers: {
              'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'Content-Disposition': `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(utf8Filename)}`
            }
          });
        }

        // 3. POST /api/circuits/:id/checkin (Check-in ทั้ง Site / ตู้ Rack เดียวกันทีเดียว)
        const checkinMatch = /^\/api\/circuits\/([^/]+)\/checkin$/.exec(pathname);
        if (checkinMatch && request.method === 'POST') {
          const so = decodeURIComponent(checkinMatch[1]);
          const circuit = findCircuitByIdOrSo(so);
          if (!circuit) return jsonResponse({ error: `ไม่พบวงจร ${so}` }, 404);
          const body = await request.json().catch(() => ({}));
          const nowIso = new Date().toISOString();
          const techName = body.tech_name || body.inspector_name || circuit.inspector_name || 'ช่างหน้างาน';
          const techPhone = body.tech_phone || body.inspector_phone || circuit.inspector_phone || '';
          const latLong = body.lat_long || circuit.lat_long || '';

          // If additional circuit S/O numbers are linked to this Site during Check-in
          const targetSiteName = extractSiteNameServer(circuit);
          const targetSiteKey = getSiteGroupKeyServer(circuit);
          if (Array.isArray(body.link_so_numbers)) {
            for (const extraSo of body.link_so_numbers) {
              const extraC = findCircuitByIdOrSo(extraSo);
              if (extraC) {
                extraC.site_name = targetSiteName;
                extraC.site_key = targetSiteKey;
              }
            }
          }

          const targets = body.single_only ? [circuit] : getSiteCircuitsServer(circuit);
          for (const item of targets) {
            item.inspector_name = techName;
            item.inspector_phone = techPhone;
            item.inspection_date = item.inspection_date || nowIso.slice(0, 10);
            if (latLong) item.lat_long = latLong;
            item.checkin_status = 'checked_in';
            item.checkin_time = nowIso;
            if (item.status === 'pending') item.status = 'in_progress';
            item.updated_at = nowIso;
          }
          await persistModifiedStateToR2(env, targets.map(t => t.so_number));

          return jsonResponse({
            ok: true,
            circuit: enrichCircuit(circuit),
            site_circuits: targets.map(enrichCircuit),
            completeness: evaluateCircuitCompleteness(circuit)
          });
        }

        // 4. POST /api/circuits/:id/checkout (Check-out ส่งตรวจทั้ง Site พร้อมกัน)
        const checkoutMatch = /^\/api\/circuits\/([^/]+)\/checkout$/.exec(pathname);
        if (checkoutMatch && request.method === 'POST') {
          const so = decodeURIComponent(checkoutMatch[1]);
          const circuit = findCircuitByIdOrSo(so);
          if (!circuit) return jsonResponse({ error: `ไม่พบวงจร ${so}` }, 404);
          const body = await request.json().catch(() => ({}));
          const targets = body.single_only ? [circuit] : getSiteCircuitsServer(circuit);

          if (!body.force) {
            for (const item of targets) {
              const itemComp = evaluateCircuitCompleteness(item);
              if (!itemComp.readyForCheckout) {
                return jsonResponse({
                  ok: false,
                  incomplete: true,
                  incomplete_so: item.so_number,
                  completeness: itemComp,
                  circuit: enrichCircuit(item),
                  site_circuits: targets.map(enrichCircuit),
                  message: `วงจร ${item.so_number}: รูปถ่ายหน้างานหรือ S/N ยังไม่ครบถ้วนสมบูรณ์`
                });
              }
            }
          }

          const nowIso = new Date().toISOString();
          for (const item of targets) {
            const itemComp = evaluateCircuitCompleteness(item);
            item.checkin_status = 'checked_out';
            item.checkout_time = nowIso;
            item.admin_status = 'pending_review';
            item.is_draft = false;
            if (itemComp.isOnsitePhotoComplete && itemComp.snMismatchCount === 0) {
              item.status = 'completed';
            } else if (item.status === 'pending') {
              item.status = 'in_progress';
            }
            item.updated_at = nowIso;
          }
          await persistModifiedStateToR2(env, targets.map(t => t.so_number));

          return jsonResponse({
            ok: true,
            circuit: enrichCircuit(circuit),
            site_circuits: targets.map(enrichCircuit),
            completeness: evaluateCircuitCompleteness(circuit)
          });
        }

        // 5. admin-review moved to lib/admin.js (login required, locks approved sites)

        // 6. GET / PUT / POST /api/circuits/:id
        const singleMatch = /^\/api\/circuits\/([^/]+)$/.exec(pathname);
        if (singleMatch) {
          const so = decodeURIComponent(singleMatch[1]);
          const circuit = findCircuitByIdOrSo(so);
          if (!circuit) return jsonResponse({ error: `ไม่พบวงจร ${so}` }, 404);

          if (request.method === 'GET') {
            const enriched = enrichCircuit(circuit);
            enriched.site_circuits = getSiteCircuitsServer(circuit).map(enrichCircuit);
            return jsonResponse(enriched);
          }
          if (request.method === 'PUT' || request.method === 'POST') {
            const body = await request.json().catch(() => ({}));
            // Review/lock fields change only through /api/admin/review (lib/admin.js), never through a plain save;
            // an admin editing a locked circuit leaves a trace in its history.
            admin.stripProtectedFields(body);
            admin.noteAdminEdit(circuit, adminCtx);
            const fields = [
              'service_no', 'branch_name', 'short_branch_name', 'customer_site_name',
              'site_name', 'site_key',
              'address', 'lat_long', 'speed_pkg',
              'status', 'router_info', 'access_points', 'remarks',
              'inspector_name', 'inspector_phone', 'inspection_date', 'inspector_signature',
              'receiver_name', 'receiver_position', 'receiver_phone', 'received_date', 'receiver_signature',
              'checkin_status', 'checkin_time', 'checkout_time',
              'admin_status', 'admin_name', 'admin_comment', 'admin_reviewed_at',
              'admin_reviewer', 'admin_review_time', 'admin_review_note',
              'is_draft', 'draft_saved_at', 'last_active_room'
            ];
            for (const f of fields) {
              if (body[f] !== undefined) circuit[f] = body[f];
            }
            const nowIso = new Date().toISOString();
            if (body.is_draft) {
              circuit.draft_saved_at = body.draft_saved_at || nowIso;
            }
            circuit.updated_at = nowIso;

            // 1 Site มีแบบส่งมอบงานเพียง 1 ใบ (ใส่ได้ถึง 4 วงจร) — ซิงค์ไฟล์สแกนใบส่งมอบงาน (หน้า 1/2 และ 2/2) ให้ทุกวงจรใน Site เดียวกันอัตโนมัติ
            const siteSiblings = getSiteCircuitsServer(circuit);
            const rtCur = circuit.router_info || {};
            const modifiedSos = [circuit.so_number];
            if (siteSiblings.length > 1 && body.router_info !== undefined) {
              const p1 = rtCur.photo_handover_p1 || rtCur.photo_signed_doc || '';
              const p2 = rtCur.photo_handover_p2 || '';
              for (const sib of siteSiblings) {
                if (sib.so_number === circuit.so_number) continue;
                if (!sib.router_info) sib.router_info = {};
                if (p1 || body.sync_site_handover) {
                  sib.router_info.photo_handover_p1 = p1;
                  sib.router_info.photo_signed_doc = p1;
                  sib.router_info.doc_filled = Boolean(rtCur.doc_filled || p1);
                }
                if (p2 || body.sync_site_handover) {
                  sib.router_info.photo_handover_p2 = p2;
                  sib.router_info.doc_stamped = Boolean(rtCur.doc_stamped || p2);
                }
                modifiedSos.push(sib.so_number);
              }
            }

            await persistModifiedStateToR2(env, modifiedSos);
            const enriched = enrichCircuit(circuit);
            enriched.site_circuits = getSiteCircuitsServer(circuit).map(enrichCircuit);
            return jsonResponse({ ok: true, circuit: enriched, site_circuits: enriched.site_circuits });
          }
        }

        // 7. POST /api/upload
        if (pathname === '/api/upload' && request.method === 'POST') {
          const body = await request.json().catch(() => ({}));
          const soNumber = body.so_number || body.circuitId || 'general';
          const category = body.category || body.slot || 'photo';
          const dataUrl = body.data_url || body.dataUrl || '';
          if (!dataUrl.startsWith('data:image/')) {
            return jsonResponse({ error: 'รูปแบบข้อมูลรูปภาพไม่ถูกต้อง' }, 400);
          }
          const savedPath = await storeDataUrlAsUpload(soNumber, category, dataUrl, env);
          return jsonResponse({ ok: true, url: savedPath });
        }

        // 8. GET & POST /api/line/config
        if (pathname === '/api/line/config') {
          const token = runtimeLineConfig.channelAccessToken || env.LINE_CHANNEL_ACCESS_TOKEN || '';
          const secret = runtimeLineConfig.channelSecret || env.LINE_CHANNEL_SECRET || '';
          const pubBase = runtimeLineConfig.publicBaseUrl || env.PUBLIC_BASE_URL || url.origin;

          if (request.method === 'GET') {
            return jsonResponse({
              configured: Boolean(token && secret),
              channelAccessTokenSet: Boolean(token),
              channelSecretSet: Boolean(secret),
              webhookPath: '/api/line/webhook',
              publicBaseUrl: pubBase
            });
          }
          if (request.method === 'POST') {
            const body = await request.json().catch(() => ({}));
            if (body.public_base_url !== undefined) runtimeLineConfig.publicBaseUrl = String(body.public_base_url).trim();
            if (body.channel_secret !== undefined && body.channel_secret !== '') runtimeLineConfig.channelSecret = String(body.channel_secret).trim();
            if (body.channel_access_token !== undefined && body.channel_access_token !== '') runtimeLineConfig.channelAccessToken = String(body.channel_access_token).trim();
            return jsonResponse({ ok: true });
          }
        }

        // 9. GET /api/line/state
        if (pathname === '/api/line/state' && request.method === 'GET') {
          const userId = url.searchParams.get('userId') || 'sim_tech_01';
          const userState = getLineSession(userId);
          const activeCircuit = userState.active_so ? circuitsMap.get(userState.active_so) || null : null;
          const completeness = activeCircuit ? evaluateCircuitCompleteness(activeCircuit) : null;
          const msgs = lineMessages.filter(m => m.line_user_id === userId);
          return jsonResponse({
            userState,
            activeCircuit: activeCircuit ? enrichCircuit(activeCircuit) : null,
            circuit: activeCircuit ? enrichCircuit(activeCircuit) : null,
            completeness,
            messages: msgs
          });
        }

        // 10. POST /api/line/simulate — the bot only reports (status / summary); everything else points to the web
        if (pathname === '/api/line/simulate' && request.method === 'POST') {
          const body = await request.json().catch(() => ({}));
          const userId = body.line_user_id || body.userId || 'sim_tech_01';
          const session = getLineSession(userId);
          const action = body.action || '';
          const so = String(body.so_number || body.soNumber || session.active_so || '').trim().toUpperCase();

          if (action === 'clear_chat') {
            for (let i = lineMessages.length - 1; i >= 0; i--) {
              if (lineMessages[i].line_user_id === userId) lineMessages.splice(i, 1);
            }
          } else if (action) {
            // text → as typed; check_completeness → status; every editing action (checkin, upload_photo, checkout, …) → "use the web"
            const asText = action === 'text' ? String(body.text || '') : action === 'check_completeness' ? `สถานะ ${so}` : `เช็คอิน ${so}`;
            addLineMessage(userId, 'user', asText, '', so);
            addLineMessage(userId, 'bot', lineReport.replyFor(asText, adminHelpers, url.origin).text, '', so);
          }

          const activeCircuit = session.active_so ? circuitsMap.get(session.active_so) || null : null;
          return jsonResponse({
            ok: true,
            userState: session,
            activeCircuit: activeCircuit ? enrichCircuit(activeCircuit) : null,
            circuit: activeCircuit ? enrichCircuit(activeCircuit) : null,
            completeness: activeCircuit ? evaluateCircuitCompleteness(activeCircuit) : null,
            messages: lineMessages.filter(m => m.line_user_id === userId)
          });
        }

        // 11. GET & POST /api/line/webhook (Real LINE Messaging API Webhook)
        if (pathname === '/api/line/webhook') {
          if (request.method === 'GET') {
            return jsonResponse({ ok: true, message: 'DLT Onsite LINE Webhook is active on Cloudflare Workers' });
          }
          if (request.method === 'POST') {
            const rawBody = await request.text();
            const signature = request.headers.get('x-line-signature') || '';
            const secret = runtimeLineConfig.channelSecret || env.LINE_CHANNEL_SECRET || '';
            const token = runtimeLineConfig.channelAccessToken || env.LINE_CHANNEL_ACCESS_TOKEN || '';

            if (secret && !verifyLineSignature(rawBody, signature, secret)) {
              return jsonResponse({ error: 'Invalid LINE signature' }, 401);
            }
            const payload = JSON.parse(rawBody || '{}');
            const events = payload.events || [];
            for (const ev of events) {
              const replyToken = ev.replyToken;
              const userId = ev.source?.userId || ev.source?.groupId || ev.source?.roomId || 'line_user';
              const session = getLineSession(userId);

              // 1. Handle bot join group or follow (friend add)
              if (ev.type === 'join' || ev.type === 'follow') {
                const welcomeText = lineReport.welcomeText(url.origin);
                addLineMessage(userId, 'bot', welcomeText, '', session.active_so);
                if (token && replyToken) {
                  await sendLineReply(replyToken, [{ type: 'text', text: welcomeText }], token).catch(err => {
                    console.error('LINE welcome reply error:', err);
                  });
                }
                continue;
              }

              // 2. Text → report only (status / summary); editing commands are answered with a link to the web
              const isGroup = ev.source?.type === 'group' || ev.source?.type === 'room';
              if (ev.type === 'message' && ev.message?.type === 'text') {
                const txt = (ev.message.text || '').trim();
                addLineMessage(userId, 'user', txt, '', session.active_so);
                const r = lineReport.replyFor(txt, adminHelpers, url.origin);
                if (isGroup && !r.recognized) continue; // stay quiet on ordinary group chatter
                addLineMessage(userId, 'bot', r.text, '', session.active_so);
                if (token && replyToken) {
                  await sendLineReply(replyToken, [{ type: 'text', text: r.text }], token).catch(err => {
                    console.error('sendLineReply error:', err);
                  });
                }
              } else if (ev.type === 'message' && ev.message?.type === 'image' && !isGroup) {
                // Photos are never stored from chat — they go through the web app.
                const t = lineReport.webOnlyText(url.origin, '');
                addLineMessage(userId, 'bot', t, '', session.active_so);
                if (token && replyToken) await sendLineReply(replyToken, [{ type: 'text', text: t }], token).catch(() => {});
              }
            }
            return jsonResponse({ ok: true });
          }
        }

        // 12. GET /api/admin/overview
        if (pathname === '/api/admin/overview' && request.method === 'GET') {
          const all = Array.from(circuitsMap.values());
          const activeItems = all
            .filter(c =>
              c.checkin_status !== 'none' ||
              c.admin_status !== 'none' ||
              c.status !== 'pending' ||
              Boolean(c.inspector_name)
            )
            .map(enrichCircuit)
            .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));

          return jsonResponse({
            items: activeItems,
            sessions: Array.from(lineUserSessions.values()),
            recentMessages: lineMessages.slice(-40)
          });
        }

        // 13. GET /api/export/csv — ส่งออกข้อมูลสรุปวงจรสาขาใหม่ (CSV UTF-8 with BOM สำหรับเปิดใน Excel)
        if (pathname === '/api/export/csv' && request.method === 'GET') {
          const all = Array.from(circuitsMap.values()).map(enrichCircuit);
          const escCsv = val => {
            const s = String(val ?? '').replace(/\r?\n/g, ' ');
            if (s.includes(',') || s.includes('"') || s.includes('\n')) {
              return `"${s.replace(/"/g, '""')}"`;
            }
            return s;
          };
          const headers = [
            'ลำดับ',
            'เลขที่วงจร (S/O)',
            'ภาค',
            'จังหวัด',
            'ชื่อหน่วยงาน/สาขา',
            'แพ็กเกจความเร็ว',
            'จำนวนห้อง/AP (ปีนี้)',
            'รายชื่อห้องที่ใช้งานจริง (ปีนี้)',
            'Router ยี่ห้อ/รุ่น',
            'Router เลขครุภัณฑ์',
            'Router S/N (ใหม่/ยืนยัน)',
            'Router S/N (OCR)',
            'Router Speed Port 2 (DL/UL Mbps)',
            'Router Speed Port 3 (DL/UL Mbps)',
            'รายละเอียดอุปกรณ์ AP ทุกห้อง (ห้อง | รุ่น | ครุภัณฑ์ | S/N | Speed LAN | Speed WiFi)',
            'รูปอุปกรณ์+เทสหน้างาน',
            'สแกนใบส่งมอบงาน (หน้า 1-2)',
            'สถานะตรวจรับ (บริษัท QA)',
            'ผู้ตรวจรับงาน (QA)',
            'ช่างผู้เข้าดำเนินการ',
            'เบอร์โทรช่าง',
            'วันที่ดำเนินการ',
            'สถานะงาน',
            'หมายเหตุหน้างาน'
          ];
          const rows = [headers.map(escCsv).join(',')];
          all.forEach((c, idx) => {
            const rt = c.router_info || {};
            const aps = Array.isArray(c.access_points) ? c.access_points.filter(a => a && a.checked !== false) : [];
            const roomsStr = aps.map(a => a.room || a.room_type || 'AP').join(' + ') || 'ไม่มี AP';
            const apDetailsStr = aps.map((a, i) => {
              const lanSpd = (a.speed_lan_dl || a.speed_lan_ul) ? `${a.speed_lan_dl || '-'}/${a.speed_lan_ul || '-'}M` : 'ตามภาพผลเทส';
              const wifiSpd = (a.speed_wifi_dl || a.speed_wifi_ul) ? `${a.speed_wifi_dl || '-'}/${a.speed_wifi_ul || '-'}M` : 'ตามภาพผลเทส';
              return `[#${i + 1} ${a.room || 'AP'}: ${a.brand || 'TOTOLINK'} ${a.model || ''} | ครุภัณฑ์:${a.asset_no || '-'} | S/N:${a.serial_no || '-'} | LAN:${lanSpd} | WiFi:${wifiSpd}]`;
            }).join(' ; ');
            const rtP2 = (rt.speed_lan2_dl || rt.speed_lan2_ul) ? `${rt.speed_lan2_dl || '-'}/${rt.speed_lan2_ul || '-'}M` : (rt.photo_lan2 ? 'มีรูปผลเทส' : '-');
            const rtP3 = (rt.speed_lan3_dl || rt.speed_lan3_ul) ? `${rt.speed_lan3_dl || '-'}/${rt.speed_lan3_ul || '-'}M` : (rt.photo_lan3 ? 'มีรูปผลเทส' : '-');
            const comp = c.completeness || {};
            const row = [
              c.seq || idx + 1,
              c.so_number || '',
              c.region || '',
              c.province || '',
              c.branch_name || '',
              c.speed_pkg || '650M/350M',
              aps.length,
              roomsStr,
              `MikroTik ${rt.model || 'RB3011'}`,
              rt.asset_no || '',
              rt.serial_no || '',
              rt.ocr_serial_no || '',
              rtP2,
              rtP3,
              apDetailsStr,
              `${comp.onsiteUploadedCount ?? 0}/${comp.onsiteRequiredCount ?? 3}`,
              `${comp.handoverUploadedCount ?? 0}/2`,
              c.admin_status === 'approved' ? 'อนุมัติแล้ว' : c.admin_status === 'rejected' ? 'แจ้งแก้ไข' : c.admin_status === 'pending_review' ? 'รอตรวจ' : 'ยังไม่ส่งตรวจ',
              c.admin_name || c.admin_reviewer || '',
              c.inspector_name || '',
              c.inspector_phone || '',
              c.inspection_date || '',
              c.status || 'pending',
              c.remarks || ''
            ];
            rows.push(row.map(escCsv).join(','));
          });
          const csvContent = '\uFEFF' + rows.join('\r\n');
          return new Response(csvContent, {
            status: 200,
            headers: {
              'Content-Type': 'text/csv; charset=utf-8',
              'Content-Disposition': 'attachment; filename="DLT_Circuits_Updated_Summary_2569.csv"'
            }
          });
        }

        return jsonResponse({ error: `API endpoint not found: ${pathname}` }, 404);
      } catch (err) {
        return jsonResponse({ error: err.message || 'Internal Worker Error' }, 500);
      }
    }

    // Serve static files from ./public via Cloudflare Assets binding
    if (env && env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response('DLT Onsite Worker is running.', { status: 200 });
  }
};
