const seedCircuits = require('./data/seed_circuits.json');
const { generateCircuitDocx } = require('./lib/docx_generator');
const {
  REQUIRED_PHOTO_SLOTS,
  normalizeSn,
  compareSnValues,
  evaluateCircuitCompleteness,
  applySlotPhotoAndSnToCircuit,
  verifyLineSignature,
  sendLineReply,
  sendLinePush,
  downloadLineMessageImage
} = require('./lib/completeness_and_line');

// ============================================================================
// In-Memory State (Pre-seeded with all 334 DLT Circuits + Optional Supabase Sync)
// ============================================================================
const circuitsMap = new Map();
const uploadsMap = new Map(); // '/uploads/...' -> 'data:image/...'
const lineUserSessions = new Map();
const lineMessages = [];

function initSeedData() {
  if (circuitsMap.size > 0) return;
  seedCircuits.forEach((item, idx) => {
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
      address: item.address || '',
      lat_long: item.lat_long || '',
      speed_pkg: item.speed_pkg || '1000Mbps/500Mbps',
      legacy_pdf_path: item.legacy_pdf_path || '',
      status: item.status || 'pending',
      router_info: defaultRouter,
      access_points: defaultAps,
      remarks: item.remarks || '',
      inspector_name: item.inspector_name || '',
      inspector_phone: item.inspector_phone || '',
      inspection_date: item.inspection_date || '',
      checkin_status: item.checkin_status || 'none',
      checkin_time: item.checkin_time || '',
      checkout_time: item.checkout_time || '',
      line_user_id: item.line_user_id || '',
      admin_status: item.admin_status || 'none',
      admin_reviewer: item.admin_reviewer || '',
      admin_review_time: item.admin_review_time || '',
      admin_review_note: item.admin_review_note || '',
      cloud_synced: 0,
      updated_at: item.updated_at || new Date().toISOString()
    });
  });
}

let runtimeLineConfig = {
  channelAccessToken: '',
  channelSecret: '',
  publicBaseUrl: ''
};

let runtimeCloudConfig = {
  supabaseUrl: '',
  supabaseKey: '',
  supabaseBucket: 'dlt-onsite-uploads',
  autoSync: true
};

function enrichCircuit(c) {
  if (!c) return null;
  const completeness = evaluateCircuitCompleteness(c);
  return {
    ...c,
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

function storeDataUrlAsUpload(soNumber, prefix, dataUrl) {
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return dataUrl || '';
  const m = /^data:image\/([a-zA-Z0-9.+-]+);base64,/.exec(dataUrl);
  const ext = m && m[1].toLowerCase().includes('png') ? 'png' : 'jpg';
  const pathKey = `/uploads/${encodeURIComponent(soNumber)}/${prefix}_${Date.now()}.${ext}`;
  uploadsMap.set(pathKey, dataUrl);
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
    initSeedData();

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

    // Serve uploaded images stored in memory
    if (pathname.startsWith('/uploads/')) {
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
        // 1. GET /api/circuits
        if (pathname === '/api/circuits' && request.method === 'GET') {
          const list = Array.from(circuitsMap.values()).map(enrichCircuit);
          return jsonResponse({
            summary: buildSummary(list),
            circuits: list
          });
        }

        // 2. GET /api/circuits/:id/report.docx
        const docxMatch = /^\/api\/circuits\/([^/]+)\/report\.docx$/.exec(pathname);
        if (docxMatch && request.method === 'GET') {
          const so = decodeURIComponent(docxMatch[1]);
          const circuit = circuitsMap.get(so);
          if (!circuit) return jsonResponse({ error: `ไม่พบวงจร ${so}` }, 404);
          const docxBuf = generateCircuitDocx(circuit, uploadsMap);
          return new Response(docxBuf, {
            status: 200,
            headers: {
              'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'Content-Disposition': `attachment; filename="DLT_Onsite_Report_${so}.docx"`
            }
          });
        }

        // 3. POST /api/circuits/:id/checkin
        const checkinMatch = /^\/api\/circuits\/([^/]+)\/checkin$/.exec(pathname);
        if (checkinMatch && request.method === 'POST') {
          const so = decodeURIComponent(checkinMatch[1]);
          const circuit = circuitsMap.get(so);
          if (!circuit) return jsonResponse({ error: `ไม่พบวงจร ${so}` }, 404);
          const body = await request.json().catch(() => ({}));
          const nowIso = new Date().toISOString();
          circuit.inspector_name = body.tech_name || body.inspector_name || circuit.inspector_name || 'ช่างหน้างาน';
          circuit.inspector_phone = body.tech_phone || body.inspector_phone || circuit.inspector_phone || '';
          circuit.inspection_date = circuit.inspection_date || nowIso.slice(0, 10);
          circuit.checkin_status = 'checked_in';
          circuit.checkin_time = nowIso;
          if (circuit.status === 'pending') circuit.status = 'in_progress';
          circuit.updated_at = nowIso;
          return jsonResponse({ ok: true, circuit: enrichCircuit(circuit), completeness: evaluateCircuitCompleteness(circuit) });
        }

        // 4. POST /api/circuits/:id/checkout
        const checkoutMatch = /^\/api\/circuits\/([^/]+)\/checkout$/.exec(pathname);
        if (checkoutMatch && request.method === 'POST') {
          const so = decodeURIComponent(checkoutMatch[1]);
          const circuit = circuitsMap.get(so);
          if (!circuit) return jsonResponse({ error: `ไม่พบวงจร ${so}` }, 404);
          const body = await request.json().catch(() => ({}));
          const comp = evaluateCircuitCompleteness(circuit);
          if (!comp.readyForCheckout && !body.force) {
            return jsonResponse({
              ok: false,
              incomplete: true,
              completeness: comp,
              circuit: enrichCircuit(circuit),
              message: 'รูปถ่ายหรือ S/N ยังไม่ครบถ้วนสมบูรณ์'
            });
          }
          const nowIso = new Date().toISOString();
          circuit.checkin_status = 'checked_out';
          circuit.checkout_time = nowIso;
          circuit.admin_status = 'pending_review';
          if (comp.allRequiredPhotosComplete && comp.snMismatchCount === 0) {
            circuit.status = 'completed';
          } else if (circuit.status === 'pending') {
            circuit.status = 'in_progress';
          }
          circuit.updated_at = nowIso;
          return jsonResponse({ ok: true, circuit: enrichCircuit(circuit), completeness: evaluateCircuitCompleteness(circuit) });
        }

        // 5. POST /api/circuits/:id/admin-review
        const adminRevMatch = /^\/api\/circuits\/([^/]+)\/admin-review$/.exec(pathname);
        if (adminRevMatch && request.method === 'POST') {
          const so = decodeURIComponent(adminRevMatch[1]);
          const circuit = circuitsMap.get(so);
          if (!circuit) return jsonResponse({ error: `ไม่พบวงจร ${so}` }, 404);
          const body = await request.json().catch(() => ({}));
          const decision = body.decision || body.adminStatus || 'approved';
          const adminName = body.admin_name || body.adminName || 'Admin QA';
          const adminComment = body.admin_comment || body.adminComment || '';
          const nowIso = new Date().toISOString();

          circuit.admin_status = decision === 'rejected' ? 'rejected' : 'approved';
          circuit.admin_reviewer = adminName;
          circuit.admin_review_time = nowIso;
          circuit.admin_review_note = adminComment;
          if (circuit.admin_status === 'approved') {
            circuit.status = 'completed';
          } else {
            circuit.status = 'issue';
          }
          circuit.updated_at = nowIso;

          const targetUser = circuit.line_user_id || 'sim_tech_01';
          const botNote = circuit.admin_status === 'approved'
            ? `🎉 [Admin QA อนุมัติผ่าน]\nวงจร: ${so} (${circuit.province})\nผู้ตรวจ: ${adminName}\nหมายเหตุ: ${adminComment || 'ข้อมูลและรูปภาพครบถ้วนสมบูรณ์'}\n📄 ดาวน์โหลดรายงาน Word: ${url.origin}/api/circuits/${encodeURIComponent(so)}/report.docx`
            : `⚠️ [Admin QA ส่งกลับให้แก้ไข]\nวงจร: ${so} (${circuit.province})\nผู้ตรวจ: ${adminName}\nสิ่งที่ต้องแก้ไข: ${adminComment || 'กรุณาตรวจสอบรูปถ่ายและ S/N อีกครั้ง'}`;
          addLineMessage(targetUser, 'bot', botNote, '', so);

          return jsonResponse({ ok: true, circuit: enrichCircuit(circuit), completeness: evaluateCircuitCompleteness(circuit) });
        }

        // 6. GET / PUT / POST /api/circuits/:id
        const singleMatch = /^\/api\/circuits\/([^/]+)$/.exec(pathname);
        if (singleMatch) {
          const so = decodeURIComponent(singleMatch[1]);
          const circuit = circuitsMap.get(so);
          if (!circuit) return jsonResponse({ error: `ไม่พบวงจร ${so}` }, 404);

          if (request.method === 'GET') {
            return jsonResponse(enrichCircuit(circuit));
          }
          if (request.method === 'PUT' || request.method === 'POST') {
            const body = await request.json().catch(() => ({}));
            const fields = [
              'service_no', 'branch_name', 'address', 'lat_long', 'speed_pkg',
              'status', 'router_info', 'access_points', 'remarks',
              'inspector_name', 'inspector_phone', 'inspection_date',
              'checkin_status', 'checkin_time', 'checkout_time',
              'admin_status', 'admin_reviewer', 'admin_review_time', 'admin_review_note'
            ];
            for (const f of fields) {
              if (body[f] !== undefined) circuit[f] = body[f];
            }
            circuit.updated_at = new Date().toISOString();
            return jsonResponse({ ok: true, circuit: enrichCircuit(circuit) });
          }
        }

        // 7. POST /api/upload
        if (pathname === '/api/upload' && request.method === 'POST') {
          const body = await request.json().catch(() => ({}));
          const soNumber = body.so_number || 'general';
          const category = body.category || 'photo';
          const dataUrl = body.data_url || '';
          if (!dataUrl.startsWith('data:image/')) {
            return jsonResponse({ error: 'รูปแบบข้อมูลรูปภาพไม่ถูกต้อง' }, 400);
          }
          const savedPath = storeDataUrlAsUpload(soNumber, category, dataUrl);
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

        // 10. POST /api/line/simulate
        if (pathname === '/api/line/simulate' && request.method === 'POST') {
          const body = await request.json().catch(() => ({}));
          const userId = body.line_user_id || body.userId || 'sim_tech_01';
          const session = getLineSession(userId);
          const action = body.action || '';

          if (action === 'clear_chat') {
            for (let i = lineMessages.length - 1; i >= 0; i--) {
              if (lineMessages[i].line_user_id === userId) lineMessages.splice(i, 1);
            }
          } else if (action === 'checkin') {
            const so = (body.so_number || body.soNumber || '').trim().toUpperCase();
            const circuit = circuitsMap.get(so);
            if (!circuit) return jsonResponse({ error: `ไม่พบหมายเลขวงจร ${so}` }, 404);
            const techName = body.tech_name || body.technicianName || 'ช่างหน้างาน';
            const techPhone = body.tech_phone || body.technicianPhone || '';
            const nowIso = new Date().toISOString();

            session.active_so = so;
            session.tech_name = techName;
            session.tech_phone = techPhone;
            session.updated_at = nowIso;

            circuit.inspector_name = techName;
            circuit.inspector_phone = techPhone;
            circuit.inspection_date = nowIso.slice(0, 10);
            circuit.checkin_status = 'checked_in';
            circuit.checkin_time = nowIso;
            circuit.line_user_id = userId;
            if (circuit.status === 'pending') circuit.status = 'in_progress';
            circuit.updated_at = nowIso;

            addLineMessage(userId, 'user', `checkin ${so} ${techName} ${techPhone}`.trim(), '', so);
            const comp = evaluateCircuitCompleteness(circuit);
            addLineMessage(
              userId,
              'bot',
              `📍 Check-in สำเร็จ!\n• วงจร: ${so} (${circuit.province})\n• สถานที่: ${circuit.branch_name}\n• ช่างผู้ปฏิบัติงาน: ${techName} ${techPhone ? `(${techPhone})` : ''}\n• เวลาเข้า Site: ${new Date(nowIso).toLocaleString('th-TH')}\n\n📸 สถานะรูปถ่ายปัจจุบัน: ${comp.uploadedRequiredCount}/${comp.totalRequiredCount} รูป\n👉 เลือกหัวข้อรูปถ่ายแล้วกดส่งรูปเข้าแชทได้เลยครับ (สำหรับรูปสติ๊กเกอร์ S/N ระบบจะแปลง OCR และเทียบกับค่าที่ช่างกรอกให้อัตโนมัติ)`,
              '',
              so
            );
          } else if (action === 'select_slot') {
            const slotKey = body.slot_key || body.slot || 'router_device';
            session.pending_slot = slotKey;
            session.updated_at = new Date().toISOString();
          } else if (action === 'upload_photo') {
            const so = body.so_number || session.active_so;
            const circuit = circuitsMap.get(so);
            if (!circuit) return jsonResponse({ error: 'กรุณา Check-in วงจรก่อนส่งรูปถ่าย' }, 400);
            const slotKey = body.slot_key || body.slot || session.pending_slot || 'router_device';
            const dataUrl = body.data_url || body.dataUrl || '';
            const ocrSn = normalizeSn(body.ocr_sn || body.ocrSn || '');
            const manualSn = normalizeSn(body.manual_sn || body.manualSn || '');
            const savedUrl = storeDataUrlAsUpload(so, slotKey, dataUrl);

            applySlotPhotoAndSnToCircuit(circuit, slotKey, savedUrl, ocrSn, manualSn);
            circuit.updated_at = new Date().toISOString();

            const slotMeta = REQUIRED_PHOTO_SLOTS.find(s => s.key === slotKey);
            const slotLabel = slotMeta ? slotMeta.label : slotKey;

            addLineMessage(
              userId,
              'user',
              `ส่งรูป [${slotLabel}]${manualSn ? `\n✍️ ช่างกรอก S/N: ${manualSn}` : ''}${ocrSn ? `\n🤖 OCR อ่านได้: ${ocrSn}` : ''}`,
              savedUrl,
              so
            );

            const comp = evaluateCircuitCompleteness(circuit);
            let snFeedback = '';
            if (slotMeta?.requiresSn) {
              const targetKey = slotKey === 'router_device' ? 'router' : (slotKey === 'ap_0_device' || slotKey === 'ap1_device') ? 'ap_0' : 'ap_1';
              const cmpItem = comp.snComparisons.find(x => x.key === targetKey);
              if (cmpItem) {
                snFeedback = `\n🔎 ผลเทียบ S/N (${cmpItem.deviceLabel}):\n• ช่างกรอก: ${cmpItem.manualSn || '-'}\n• OCR แปลงได้: ${cmpItem.ocrSn || '-'}\n• สถานะ: ${cmpItem.statusLabel}`;
              }
            }
            addLineMessage(
              userId,
              'bot',
              `✅ บันทึกรูป [${slotLabel}] เรียบร้อยแล้ว!${snFeedback}\n📊 ความครบถ้วนของรูปถ่าย: ${comp.uploadedRequiredCount}/${comp.totalRequiredCount} รูป (${comp.photoProgressPct}%)`,
              '',
              so
            );
          } else if (action === 'recheck_sn' || action === 'update_sn') {
            const so = body.so_number || session.active_so;
            const circuit = circuitsMap.get(so);
            if (!circuit) return jsonResponse({ error: 'กรุณา Check-in วงจรก่อนบันทึก S/N' }, 400);
            const target = body.target || ((body.slot === 'ap_0_device' || body.slot === 'ap1_device') ? 'ap_0' : (body.slot === 'ap_1_device' || body.slot === 'ap2_device') ? 'ap_1' : 'router');
            const slotKey = target === 'ap_0' ? 'ap_0_device' : target === 'ap_1' ? 'ap_1_device' : 'router_device';
            const manualSn = normalizeSn(body.manual_sn || body.manualSn || '');
            const ocrSn = normalizeSn(body.ocr_sn || body.ocrSn || '');

            applySlotPhotoAndSnToCircuit(circuit, slotKey, '', ocrSn, manualSn);
            circuit.updated_at = new Date().toISOString();

            const cmp = compareSnValues(manualSn, ocrSn);
            addLineMessage(userId, 'user', `ยืนยันผลเทียบ S/N (${target.toUpperCase()}): ช่างกรอก=${manualSn || '-'} | OCR=${ocrSn || '-'}`, '', so);
            addLineMessage(userId, 'bot', `🔍 บันทึกการ Recheck S/N เรียบร้อย:\n• ช่างกรอก: ${cmp.manualSn || '-'}\n• OCR: ${cmp.ocrSn || '-'}\n• ผลตรวจสอบ: ${cmp.statusLabel}`, '', so);
          } else if (action === 'check_completeness') {
            const so = body.so_number || session.active_so;
            const circuit = circuitsMap.get(so);
            if (!circuit) return jsonResponse({ error: 'ยังไม่ได้ Check-in วงจร' }, 400);
            const comp = evaluateCircuitCompleteness(circuit);
            addLineMessage(userId, 'user', 'ตรวจสอบความครบถ้วน (status)', '', so);
            const missingStr = comp.missingPhotoLabels.length > 0
              ? `\n❌ รูปที่ยังขาด (${comp.missingPhotoLabels.length} รูป):\n- ${comp.missingPhotoLabels.join('\n- ')}`
              : `\n✅ รูปถ่ายครบถ้วนทั้ง ${comp.totalRequiredCount} จุดแล้ว!`;
            const snLines = comp.snComparisons.map(s => `• ${s.deviceLabel}: ${s.statusLabel}`).join('\n');
            addLineMessage(
              userId,
              'bot',
              `📋 สรุปความครบถ้วนวงจร ${so}:\n📷 รูปถ่าย: ${comp.uploadedRequiredCount}/${comp.totalRequiredCount} รูป (${comp.photoProgressPct}%)${missingStr}\n\n🏷️ ตรวจสอบ S/N (ช่างกรอก vs OCR):\n${snLines}`,
              '',
              so
            );
          } else if (action === 'checkout') {
            const so = body.so_number || session.active_so;
            const circuit = circuitsMap.get(so);
            if (!circuit) return jsonResponse({ error: 'ยังไม่ได้ Check-in วงจร' }, 400);
            const force = Boolean(body.force || body.forceCheckout);
            const comp = evaluateCircuitCompleteness(circuit);
            addLineMessage(userId, 'user', force ? `ยืนยัน Check-out (${so})` : `ขอแจ้งจบงาน Check-out (${so})`, '', so);

            if (!comp.readyForCheckout && !force) {
              addLineMessage(
                userId,
                'bot',
                `⚠️ แจ้งเตือนก่อน Check-out!\n• รูปถ่ายปัจจุบัน: ${comp.uploadedRequiredCount}/${comp.totalRequiredCount} รูป\n• S/N ไม่ตรงกัน/ยังไม่ระบุ: ${comp.snMismatchCount + comp.snMissingCount} จุด\nหากต้องการส่งงานให้ Admin ตรวจสอบทันที กดยืนยัน Check-out อีกครั้งได้เลยครับ`,
                '',
                so
              );
            } else {
              const nowIso = new Date().toISOString();
              circuit.checkin_status = 'checked_out';
              circuit.checkout_time = nowIso;
              circuit.admin_status = 'pending_review';
              if (comp.allRequiredPhotosComplete && comp.snMismatchCount === 0) {
                circuit.status = 'completed';
              } else {
                circuit.status = 'in_progress';
              }
              circuit.updated_at = nowIso;
              addLineMessage(
                userId,
                'bot',
                `🏁 Check-out จบงานหน้า Site สำเร็จ!\n• วงจร: ${so} (${circuit.province})\n• เวลาออก Site: ${new Date(nowIso).toLocaleString('th-TH')}\n• สถานะ: ส่งเข้าคิว Admin QA ตรวจสอบความถูกต้อง\n📄 ดาวน์โหลดรายงาน MS Word (.docx): ${url.origin}/api/circuits/${encodeURIComponent(so)}/report.docx`,
                '',
                so
              );
            }
          } else if (action === 'text') {
            const text = String(body.text || '').trim();
            const so = session.active_so;
            addLineMessage(userId, 'user', text, '', so);
            const lower = text.toLowerCase();
            if (lower.startsWith('checkin ')) {
              const parts = text.split(/\s+/);
              const targetSo = (parts[1] || '').toUpperCase();
              const tName = parts.slice(2).join(' ') || 'ช่างหน้างาน';
              const c = circuitsMap.get(targetSo);
              if (c) {
                const nowIso = new Date().toISOString();
                session.active_so = targetSo;
                c.inspector_name = tName;
                c.checkin_status = 'checked_in';
                c.checkin_time = nowIso;
                if (c.status === 'pending') c.status = 'in_progress';
                addLineMessage(userId, 'bot', `📍 Check-in วงจร ${targetSo} (${c.province}) สำเร็จ! ช่าง: ${tName}`, '', targetSo);
              } else {
                addLineMessage(userId, 'bot', `❌ ไม่พบรหัสวงจร ${targetSo} ในระบบ 334 วงจร`, '', so);
              }
            } else if (lower === 'status' || text.includes('ตรวจ')) {
              const c = so ? circuitsMap.get(so) : null;
              if (c) {
                const comp = evaluateCircuitCompleteness(c);
                addLineMessage(userId, 'bot', `📊 วงจร ${so}: อัปโหลดรูปแล้ว ${comp.uploadedRequiredCount}/${comp.totalRequiredCount} รูป (${comp.photoProgressPct}%), S/N ตรงกัน ${comp.snMatchedCount}/3 อุปกรณ์`, '', so);
              } else {
                addLineMessage(userId, 'bot', 'กรุณา Check-in เลือกวงจรก่อนพิมพ์ status ครับ', '', '');
              }
            } else {
              addLineMessage(
                userId,
                'bot',
                `🤖 คำสั่งที่ใช้ได้:\n1. พิมพ์ "checkin BINF028479 ชื่อช่าง"\n2. ส่งรูปถ่ายตามหัวข้อ 9 จุด\n3. พิมพ์ "status" เพื่อเช็คความครบถ้วน\n4. กดปุ่ม Check-out เมื่อดำเนินการเสร็จ`,
                '',
                so
              );
            }
          }

          const activeCircuit = session.active_so ? circuitsMap.get(session.active_so) || null : null;
          const completeness = activeCircuit ? evaluateCircuitCompleteness(activeCircuit) : null;
          const msgs = lineMessages.filter(m => m.line_user_id === userId);
          return jsonResponse({
            ok: true,
            userState: session,
            activeCircuit: activeCircuit ? enrichCircuit(activeCircuit) : null,
            circuit: activeCircuit ? enrichCircuit(activeCircuit) : null,
            completeness,
            messages: msgs
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
              const userId = ev.source?.userId || 'line_user';
              const replyToken = ev.replyToken;
              const session = getLineSession(userId);

              if (ev.type === 'message' && ev.message?.type === 'text') {
                const txt = (ev.message.text || '').trim();
                addLineMessage(userId, 'user', txt, '', session.active_so);
                let replyText = `🤖 DLT Onsite Bot รับข้อความ: "${txt}"\nพิมพ์ "checkin <รหัสวงจร> <ชื่อช่าง>" เพื่อเข้าหน้างาน หรือเปิดเว็บ ${url.origin}`;
                if (txt.toLowerCase().startsWith('checkin ')) {
                  const parts = txt.split(/\s+/);
                  const so = (parts[1] || '').toUpperCase();
                  const techName = parts.slice(2).join(' ') || 'ช่าง LINE OA';
                  const c = circuitsMap.get(so);
                  if (c) {
                    const nowIso = new Date().toISOString();
                    session.active_so = so;
                    c.inspector_name = techName;
                    c.checkin_status = 'checked_in';
                    c.checkin_time = nowIso;
                    c.line_user_id = userId;
                    if (c.status === 'pending') c.status = 'in_progress';
                    replyText = `📍 Check-in สำเร็จ!\nวงจร: ${so} (${c.province})\nสถานที่: ${c.branch_name}\nช่าง: ${techName}\nส่งรูปอุปกรณ์เข้าแชทนี้ได้เลยครับ`;
                  } else {
                    replyText = `❌ ไม่พบรหัสวงจร ${so}`;
                  }
                }
                addLineMessage(userId, 'bot', replyText, '', session.active_so);
                if (token && replyToken) {
                  await sendLineReply(token, replyToken, [{ type: 'text', text: replyText }]).catch(() => {});
                }
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

        // 13. Cloud Status & Config
        if (pathname === '/api/cloud/status' && request.method === 'GET') {
          const supUrl = runtimeCloudConfig.supabaseUrl || env.SUPABASE_URL || '';
          const supKey = runtimeCloudConfig.supabaseKey || env.SUPABASE_KEY || '';
          return jsonResponse({
            configured: Boolean(supUrl && supKey),
            supabaseUrl: supUrl,
            bucket: runtimeCloudConfig.supabaseBucket,
            autoSync: runtimeCloudConfig.autoSync
          });
        }
        if (pathname === '/api/cloud/config' && request.method === 'POST') {
          const body = await request.json().catch(() => ({}));
          if (body.supabaseUrl !== undefined) runtimeCloudConfig.supabaseUrl = body.supabaseUrl;
          if (body.supabaseKey !== undefined) runtimeCloudConfig.supabaseKey = body.supabaseKey;
          if (body.supabaseBucket !== undefined) runtimeCloudConfig.supabaseBucket = body.supabaseBucket;
          return jsonResponse({ ok: true, configured: Boolean(runtimeCloudConfig.supabaseUrl && runtimeCloudConfig.supabaseKey) });
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
