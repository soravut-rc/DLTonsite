const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function normalizeSn(str) {
  return String(str || '').trim().toUpperCase().replace(/\s+/g, '');
}

function compareSnValues(manualSnRaw, ocrSnRaw) {
  const manualSn = normalizeSn(manualSnRaw);
  const ocrSn = normalizeSn(ocrSnRaw);

  if (manualSn && ocrSn) {
    if (manualSn === ocrSn) {
      return {
        manualSn,
        ocrSn,
        status: 'matched',
        statusLabel: '✅ ตรงกัน (ช่างกรอก = OCR)'
      };
    }
    return {
      manualSn,
      ocrSn,
      status: 'mismatch',
      statusLabel: `⚠️ ไม่ตรงกัน (ช่าง: ${manualSn} ≠ OCR: ${ocrSn})`
    };
  }
  if (manualSn && !ocrSn) {
    return {
      manualSn,
      ocrSn: '',
      status: 'manual_only',
      statusLabel: '✍️ ช่างกรอกแล้ว (ยังไม่มีค่า OCR จากรูป)'
    };
  }
  if (!manualSn && ocrSn) {
    return {
      manualSn: '',
      ocrSn,
      status: 'ocr_only',
      statusLabel: '🤖 OCR อ่านได้แล้ว (รอช่างกรอกยืนยัน)'
    };
  }
  return {
    manualSn: '',
    ocrSn: '',
    status: 'missing',
    statusLabel: '❌ ยังไม่ระบุ S/N'
  };
}

const REQUIRED_PHOTO_SLOTS = [
  { key: 'router_device', label: '1.1 รูปถ่ายจุดติดตั้ง MikroTik ตัวที่ 1 (เห็นสติ๊กเกอร์ S/N)', requiresSn: true },
  { key: 'router_lan2', label: '1.2 รูปภาพ Test speed port LAN 2 (MikroTik)', requiresSn: false },
  { key: 'router_lan3', label: '1.3 รูปภาพ Test speed port LAN 3 (MikroTik)', requiresSn: false },
  { key: 'ap_0_device', label: '2.1.1 รูปถ่ายจุดติดตั้ง Access Point ตัวที่ 1 (เห็นสติ๊กเกอร์ S/N)', requiresSn: true },
  { key: 'ap_0_wifi', label: '2.1.2 รูปภาพ Test speed ผ่าน WiFi (AP ตัวที่ 1)', requiresSn: false },
  { key: 'ap_0_lan', label: '2.1.3 รูปภาพ Test speed ผ่านสาย LAN (AP ตัวที่ 1)', requiresSn: false },
  { key: 'ap_1_device', label: '2.2.1 รูปถ่ายจุดติดตั้ง Access Point ตัวที่ 2 (เห็นสติ๊กเกอร์ S/N)', requiresSn: true },
  { key: 'ap_1_wifi', label: '2.2.2 รูปภาพ Test speed ผ่าน WiFi (AP ตัวที่ 2)', requiresSn: false },
  { key: 'ap_1_lan', label: '2.2.3 รูปภาพ Test speed ผ่านสาย LAN (AP ตัวที่ 2)', requiresSn: false },
  { key: 'handover_page1', label: '4.1 สำเนาเอกสาร "แบบส่งมอบงาน" หน้าที่ 1/2 (รายละเอียดอุปกรณ์)', requiresSn: false },
  { key: 'handover_page2', label: '4.2 สำเนาเอกสาร "แบบส่งมอบงาน" หน้าที่ 2/2 (ลงนาม + ประทับตรา)', requiresSn: false }
];

/**
 * Evaluates photo completeness (Requirement 3) and S/N OCR vs Manual Recheck (Requirement 2)
 */
function evaluateCircuitCompleteness(circuit) {
  const c = circuit || {};
  const rt = c.router_info || {};
  const aps = Array.isArray(c.access_points)
    ? c.access_points
    : [
        { ap_no: 1, checked: true, brand: 'TOTOLINK', model: 'A3002RU', room: 'ห้อง GPS' },
        { ap_no: 2, checked: true, brand: 'TOTOLINK', model: 'A3002RU', room: 'ห้อง GECC' }
      ];

  const slots = [];
  const snRecheckItems = [];

  // 1. Router slots (3 required photos)
  const routerSnCheck = compareSnValues(rt.serial_no, rt.ocr_serial_no);
  snRecheckItems.push({
    key: 'router',
    target: 'router',
    label: `1. MikroTik Router (${rt.model || 'RB3011'})`,
    room: rt.room || 'วิชาการ',
    photoUrl: rt.photo_device || '',
    ...routerSnCheck
  });

  slots.push({
    key: 'router_device',
    slotKey: 'router_device',
    stepGroup: 'step1',
    shortName: '1.1 รูป MikroTik (S/N)',
    label: '1.1 รูปถ่ายจุดติดตั้ง MikroTik ตัวที่ 1 (เห็น Sticker & S/N)',
    hasPhoto: Boolean(rt.photo_device),
    photoUrl: rt.photo_device || '',
    isDeviceWithSn: true,
    requiresSn: true,
    snTarget: 'router',
    manualSn: routerSnCheck.manualSn,
    ocrSn: routerSnCheck.ocrSn,
    snStatus: routerSnCheck.status,
    snStatusLabel: routerSnCheck.statusLabel
  });

  slots.push({
    key: 'router_lan2',
    slotKey: 'router_lan2',
    stepGroup: 'step1',
    shortName: '1.2 เทส LAN 2',
    label: '1.2 รูปภาพ Test speed port LAN 2 (≥ 650/350M)',
    hasPhoto: Boolean(rt.photo_lan2),
    photoUrl: rt.photo_lan2 || '',
    isDeviceWithSn: false,
    requiresSn: false
  });

  slots.push({
    key: 'router_lan3',
    slotKey: 'router_lan3',
    stepGroup: 'step1',
    shortName: '1.3 เทส LAN 3',
    label: '1.3 รูปภาพ Test speed port LAN 3 (≥ 650/350M)',
    hasPhoto: Boolean(rt.photo_lan3),
    photoUrl: rt.photo_lan3 || '',
    isDeviceWithSn: false,
    requiresSn: false
  });

  // 2. Access Point slots (3 required photos per active AP)
  aps.forEach((ap, idx) => {
    if (ap && ap.checked === false) return;
    const apNum = idx + 1;
    const roomName = ap.room || `ห้อง AP ${apNum}`;
    const apSnCheck = compareSnValues(ap.serial_no, ap.ocr_serial_no);

    snRecheckItems.push({
      key: `ap_${idx}`,
      target: `ap_${idx}`,
      label: `2.${apNum} AP ตัวที่ ${apNum} (${roomName})`,
      room: roomName,
      photoUrl: ap.photo_device || '',
      ...apSnCheck
    });

    slots.push({
      key: `ap_${idx}_device`,
      slotKey: `ap_${idx}_device`,
      stepGroup: 'step23',
      apIndex: idx,
      shortName: `2.${apNum}.1 รูป AP#${apNum} (${roomName})`,
      label: `2.${apNum}.1 รูปถ่ายจุดติดตั้ง AP ตัวที่ ${apNum} (${roomName} - เห็น S/N)`,
      hasPhoto: Boolean(ap.photo_device),
      photoUrl: ap.photo_device || '',
      isDeviceWithSn: true,
      requiresSn: true,
      snTarget: `ap_${idx}`,
      manualSn: apSnCheck.manualSn,
      ocrSn: apSnCheck.ocrSn,
      snStatus: apSnCheck.status,
      snStatusLabel: apSnCheck.statusLabel
    });

    slots.push({
      key: `ap_${idx}_wifi`,
      slotKey: `ap_${idx}_wifi`,
      stepGroup: 'step23',
      apIndex: idx,
      shortName: `2.${apNum}.2 เทส WiFi AP#${apNum}`,
      label: `2.${apNum}.2 รูปภาพ Test speed ผ่าน WiFi ของ AP ตัวที่ ${apNum} (${roomName})`,
      hasPhoto: Boolean(ap.photo_wifi),
      photoUrl: ap.photo_wifi || '',
      isDeviceWithSn: false,
      requiresSn: false
    });

    slots.push({
      key: `ap_${idx}_lan`,
      slotKey: `ap_${idx}_lan`,
      stepGroup: 'step23',
      apIndex: idx,
      shortName: `2.${apNum}.3 เทสสาย LAN AP#${apNum}`,
      label: `2.${apNum}.3 รูปภาพ Test speed ผ่านสาย LAN ของ AP ตัวที่ ${apNum} (${roomName})`,
      hasPhoto: Boolean(ap.photo_lan),
      photoUrl: ap.photo_lan || '',
      isDeviceWithSn: false,
      requiresSn: false
    });
  });

  // 3. Signed & Stamped Paper Handover Form Copies (สำเนาเอกสาร "แบบส่งมอบงาน" หน้าที่ 1/2 และ หน้าที่ 2/2)
  const handoverP1Url = rt.photo_handover_p1 || rt.photo_signed_doc || '';
  const handoverP2Url = rt.photo_handover_p2 || '';

  slots.push({
    key: 'handover_page1',
    slotKey: 'handover_page1',
    stepGroup: 'step4',
    shortName: '4.1 สำเนาใบส่งมอบ (หน้า 1/2)',
    label: '4.1 สำเนาเอกสาร "แบบส่งมอบงาน" หน้าที่ 1/2 (รายละเอียดสถานที่และอุปกรณ์ที่ช่างเขียน)',
    hasPhoto: Boolean(handoverP1Url),
    photoUrl: handoverP1Url,
    isDeviceWithSn: false,
    requiresSn: false
  });

  slots.push({
    key: 'handover_page2',
    slotKey: 'handover_page2',
    stepGroup: 'step4',
    shortName: '4.2 สำเนาใบส่งมอบ (หน้า 2/2 ประทับตรา)',
    label: '4.2 สำเนาเอกสาร "แบบส่งมอบงาน" หน้าที่ 2/2 (ลงนามผู้ส่งมอบ & ผู้รับมอบพร้อมประทับตรา)',
    hasPhoto: Boolean(handoverP2Url),
    photoUrl: handoverP2Url,
    isDeviceWithSn: false,
    requiresSn: false
  });

  const onsiteSlots = slots.filter(s => s.stepGroup !== 'step4');
  const handoverSlots = slots.filter(s => s.stepGroup === 'step4');

  const onsiteRequiredCount = onsiteSlots.length;
  const onsiteUploadedCount = onsiteSlots.filter(s => s.hasPhoto).length;
  const missingOnsiteSlots = onsiteSlots.filter(s => !s.hasPhoto);
  const isOnsitePhotoComplete = onsiteUploadedCount >= onsiteRequiredCount && onsiteRequiredCount > 0;
  const onsiteProgressPct = onsiteRequiredCount > 0 ? Math.round((onsiteUploadedCount / onsiteRequiredCount) * 100) : 0;

  const handoverRequiredCount = handoverSlots.length;
  const handoverUploadedCount = handoverSlots.filter(s => s.hasPhoto).length;
  const isHandoverComplete = handoverUploadedCount >= handoverRequiredCount && handoverRequiredCount > 0;

  const totalRequiredCount = slots.length;
  const uploadedRequiredCount = slots.filter(s => s.hasPhoto).length;
  const missingSlots = slots.filter(s => !s.hasPhoto);
  const isPhotoComplete = uploadedRequiredCount >= totalRequiredCount && totalRequiredCount > 0;
  const photoProgressPct = totalRequiredCount > 0 ? Math.round((uploadedRequiredCount / totalRequiredCount) * 100) : 0;

  const snMismatchCount = snRecheckItems.filter(i => i.status === 'mismatch').length;
  const snMissingCount = snRecheckItems.filter(i => i.status === 'missing' || i.status === 'ocr_only').length;
  const snMatchedCount = snRecheckItems.filter(i => i.status === 'matched').length;

  const hasSnMismatch = snMismatchCount > 0;
  const hasMissingSn = snMissingCount > 0;
  const allSnMatched = snRecheckItems.every(i => i.status === 'matched');

  const hasCheckin = Boolean(c.checkin_time);
  const hasCheckout = Boolean(c.checkout_time);

  // Calculate duration in minutes if checked in
  let durationMinutes = null;
  let durationText = '';
  if (c.checkin_time) {
    const startMs = new Date(c.checkin_time).getTime();
    const endMs = c.checkout_time ? new Date(c.checkout_time).getTime() : Date.now();
    if (!isNaN(startMs) && !isNaN(endMs) && endMs >= startMs) {
      durationMinutes = Math.round((endMs - startMs) / 60000);
      const hrs = Math.floor(durationMinutes / 60);
      const mins = durationMinutes % 60;
      durationText = hrs > 0 ? `${hrs} ชม. ${mins} นาที` : `${mins} นาที`;
    }
  }

  return {
    totalRequiredCount,
    uploadedRequiredCount,
    requiredPhotosCount: totalRequiredCount,
    uploadedPhotos: uploadedRequiredCount,
    photoProgressPct,
    allRequiredPhotosComplete: isPhotoComplete,
    onsiteRequiredCount,
    onsiteUploadedCount,
    isOnsitePhotoComplete,
    onsiteProgressPct,
    missingOnsitePhotoLabels: missingOnsiteSlots.map(s => s.label),
    handoverRequiredCount,
    handoverUploadedCount,
    isHandoverComplete,
    isReportReady: isOnsitePhotoComplete && isHandoverComplete,
    requiredPhotos: slots.map(s => ({
      key: s.slotKey,
      slotKey: s.slotKey,
      label: s.label,
      shortLabel: s.shortName,
      uploaded: s.hasPhoto,
      photoUrl: s.photoUrl,
      requiresSn: s.isDeviceWithSn
    })),
    missingPhotoCount: missingSlots.length,
    missingPhotoLabels: missingSlots.map(s => s.label),
    missingSlotKeys: missingSlots.map(s => s.slotKey),
    isPhotoComplete,
    slots,
    onsiteSlots,
    handoverSlots,
    snRecheckItems,
    snComparisons: snRecheckItems.map(i => ({
      key: i.target,
      target: i.target,
      deviceLabel: i.label,
      room: i.room,
      manualSn: i.manualSn,
      ocrSn: i.ocrSn,
      status: i.status,
      statusLabel: i.statusLabel
    })),
    snMismatchCount,
    snMissingCount,
    snMatchedCount,
    hasSnMismatch,
    hasMissingSn,
    allSnMatched,
    hasCheckin,
    hasCheckout,
    durationMinutes,
    durationText,
    // ช่างสามารถ Check-out ออกจากหน้างานได้เมื่อถ่ายรูปอุปกรณ์+ผลเทสหน้างานครบและ S/N ตรงกัน (ใบส่งมอบงานสแกนตามหลังได้ด้วย Scanner)
    readyForCheckout: isOnsitePhotoComplete && !hasSnMismatch && !hasMissingSn
  };
}

/**
 * Applies a photo URL (and optional OCR S/N + manual S/N) to a circuit's router_info or access_points
 */
function applySlotPhotoAndSnToCircuit(circuit, slotKey, photoUrl, ocrSn, manualSn) {
  if (!circuit.router_info) circuit.router_info = {};
  if (!Array.isArray(circuit.access_points)) {
    circuit.access_points = [
      { ap_no: 1, checked: true, brand: 'TOTOLINK', model: 'A3002RU', room: 'ห้อง GPS', asset_no: `สขจ.${circuit.province || ''}/GPS`, floor: '1', building: '1' },
      { ap_no: 2, checked: true, brand: 'TOTOLINK', model: 'A3002RU', room: 'ห้อง GECC', asset_no: `สขจ.${circuit.province || ''}/GECC`, floor: '1', building: '1' }
    ];
  }

  if (slotKey === 'router_device') {
    if (photoUrl) circuit.router_info.photo_device = photoUrl;
    if (ocrSn !== undefined && ocrSn !== null && ocrSn !== '') {
      circuit.router_info.ocr_serial_no = normalizeSn(ocrSn);
    }
    if (manualSn !== undefined && manualSn !== null && manualSn !== '') {
      circuit.router_info.serial_no = normalizeSn(manualSn);
    }
  } else if (slotKey === 'router_lan2' || slotKey === 'lan_speedtest') {
    if (photoUrl) circuit.router_info.photo_lan2 = photoUrl;
  } else if (slotKey === 'router_lan3') {
    if (photoUrl) circuit.router_info.photo_lan3 = photoUrl;
  } else if (slotKey === 'handover_page1' || slotKey === 'signed_handover_doc') {
    if (photoUrl) {
      circuit.router_info.photo_handover_p1 = photoUrl;
      circuit.router_info.photo_signed_doc = photoUrl;
    }
  } else if (slotKey === 'handover_page2') {
    if (photoUrl) {
      circuit.router_info.photo_handover_p2 = photoUrl;
    }
  } else if (slotKey && (slotKey.startsWith('ap_') || /^ap\d+_/.test(slotKey))) {
    let idx = 0;
    let kind = 'device';
    const mZero = /^ap_(\d+)_(device|wifi|lan|install)$/.exec(slotKey);
    const mOne = /^ap(\d+)_(device|wifi|lan|install)$/.exec(slotKey);
    if (mZero) {
      idx = Number(mZero[1]);
      kind = mZero[2];
    } else if (mOne) {
      idx = Math.max(0, Number(mOne[1]) - 1);
      kind = mOne[2];
    }
    while (circuit.access_points.length <= idx) {
      const nextNo = circuit.access_points.length + 1;
      circuit.access_points.push({
        ap_no: nextNo,
        checked: true,
        brand: 'TOTOLINK',
        model: 'A3002RU',
        room: `ห้อง AP ${nextNo}`,
        asset_no: `สขจ.${circuit.province || ''}/AP${nextNo}`,
        floor: '1',
        building: '1'
      });
    }
    const ap = circuit.access_points[idx];
    if (kind === 'device' || kind === 'install') {
      if (photoUrl) ap.photo_device = photoUrl;
      if (ocrSn !== undefined && ocrSn !== null && ocrSn !== '') {
        ap.ocr_serial_no = normalizeSn(ocrSn);
      }
      if (manualSn !== undefined && manualSn !== null && manualSn !== '') {
        ap.serial_no = normalizeSn(manualSn);
      }
    } else if (kind === 'wifi') {
      if (photoUrl) ap.photo_wifi = photoUrl;
    } else if (kind === 'lan') {
      if (photoUrl) ap.photo_lan = photoUrl;
    }
  }

  return circuit;
}

// ============================================================================
// LINE Messaging API Signature Verification & Push / Reply Helpers
// ============================================================================
function verifyLineSignature(rawBodyBuffer, signature, channelSecret) {
  if (!channelSecret || !signature) return false;
  const hash = crypto
    .createHmac('SHA256', channelSecret)
    .update(rawBodyBuffer)
    .digest('base64');
  return hash === signature;
}

async function sendLineReply(arg1, arg2, arg3) {
  // Support both (replyToken, messages, token) AND (token, replyToken, messages)
  let replyToken, messages, channelAccessToken;
  if (Array.isArray(arg2) || (typeof arg2 === 'object' && arg2 !== null && !Array.isArray(arg3) && typeof arg3 === 'string')) {
    replyToken = arg1;
    messages = arg2;
    channelAccessToken = arg3;
  } else if (Array.isArray(arg3) || (typeof arg3 === 'object' && arg3 !== null)) {
    channelAccessToken = arg1;
    replyToken = arg2;
    messages = arg3;
  } else {
    replyToken = arg1;
    messages = arg2;
    channelAccessToken = arg3;
  }

  if (!channelAccessToken || !replyToken || replyToken === 'SIMULATOR_TOKEN') {
    return { sent: false, simulated: true };
  }
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${channelAccessToken}`
      },
      body: JSON.stringify({
        replyToken,
        messages: Array.isArray(messages) ? messages : [messages]
      })
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`LINE sendLineReply failed (${res.status}):`, errText);
      return { sent: false, status: res.status, error: errText };
    }
    return { sent: true, status: res.status };
  } catch (err) {
    console.error('LINE sendLineReply exception:', err);
    return { sent: false, error: err.message };
  }
}

async function sendLinePush(toUserId, messages, channelAccessToken) {
  if (!channelAccessToken || !toUserId || toUserId.startsWith('sim_')) {
    return { sent: false, simulated: true };
  }
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${channelAccessToken}`
      },
      body: JSON.stringify({
        to: toUserId,
        messages: Array.isArray(messages) ? messages : [messages]
      })
    });
    return { sent: res.ok, status: res.status };
  } catch (err) {
    return { sent: false, error: err.message };
  }
}

async function downloadLineMessageImage(messageId, channelAccessToken) {
  if (!channelAccessToken || !messageId) return null;
  try {
    const res = await fetch(`https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${channelAccessToken}`
      }
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const arrayBuffer = await res.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      mimeType: contentType
    };
  } catch (_) {
    return null;
  }
}

module.exports = {
  REQUIRED_PHOTO_SLOTS,
  normalizeSn,
  compareSnValues,
  evaluateCircuitCompleteness,
  applySlotPhotoAndSnToCircuit,
  verifyLineSignature,
  sendLineReply,
  sendLinePush,
  downloadLineMessageImage
};

