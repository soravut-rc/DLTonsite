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

/**
 * Evaluates photo completeness (Requirement 3) and S/N OCR vs Manual Recheck (Requirement 2)
 */
function evaluateCircuitCompleteness(circuit) {
  const c = circuit || {};
  const rt = c.router_info || {};
  const aps = Array.isArray(c.access_points) && c.access_points.length > 0
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
    target: 'router',
    label: `1. MikroTik Router (${rt.model || 'RB3011'})`,
    room: rt.room || 'วิชาการ',
    photoUrl: rt.photo_device || '',
    ...routerSnCheck
  });

  slots.push({
    slotKey: 'router_device',
    stepGroup: 'step1',
    shortName: '1.1 รูป MikroTik (S/N)',
    label: '1.1 รูปถ่ายอุปกรณ์ MikroTik (เห็น Sticker & S/N)',
    hasPhoto: Boolean(rt.photo_device),
    photoUrl: rt.photo_device || '',
    isDeviceWithSn: true,
    snTarget: 'router',
    manualSn: routerSnCheck.manualSn,
    ocrSn: routerSnCheck.ocrSn,
    snStatus: routerSnCheck.status,
    snStatusLabel: routerSnCheck.statusLabel
  });

  slots.push({
    slotKey: 'router_lan2',
    stepGroup: 'step1',
    shortName: '1.2 เทส LAN 2',
    label: '1.2 รูปผลทดสอบความเร็ว Port LAN 2 (≥ 650/350M)',
    hasPhoto: Boolean(rt.photo_lan2),
    photoUrl: rt.photo_lan2 || '',
    isDeviceWithSn: false
  });

  slots.push({
    slotKey: 'router_lan3',
    stepGroup: 'step1',
    shortName: '1.3 เทส LAN 3',
    label: '1.3 รูปผลทดสอบความเร็ว Port LAN 3 (≥ 650/350M)',
    hasPhoto: Boolean(rt.photo_lan3),
    photoUrl: rt.photo_lan3 || '',
    isDeviceWithSn: false
  });

  // 2. Access Point slots (3 required photos per active AP)
  aps.forEach((ap, idx) => {
    if (ap && ap.checked === false) return;
    const apNum = idx + 1;
    const roomName = ap.room || `ห้อง AP ${apNum}`;
    const apSnCheck = compareSnValues(ap.serial_no, ap.ocr_serial_no);

    snRecheckItems.push({
      target: `ap_${idx}`,
      label: `2.${apNum} AP ตัวที่ ${apNum} (${roomName})`,
      room: roomName,
      photoUrl: ap.photo_device || '',
      ...apSnCheck
    });

    slots.push({
      slotKey: `ap_${idx}_device`,
      stepGroup: 'step23',
      apIndex: idx,
      shortName: `2.${apNum}.1 รูป AP#${apNum} (${roomName})`,
      label: `2.${apNum}.1 รูปถ่ายอุปกรณ์ AP ตัวที่ ${apNum} (${roomName} - เห็น S/N)`,
      hasPhoto: Boolean(ap.photo_device),
      photoUrl: ap.photo_device || '',
      isDeviceWithSn: true,
      snTarget: `ap_${idx}`,
      manualSn: apSnCheck.manualSn,
      ocrSn: apSnCheck.ocrSn,
      snStatus: apSnCheck.status,
      snStatusLabel: apSnCheck.statusLabel
    });

    slots.push({
      slotKey: `ap_${idx}_wifi`,
      stepGroup: 'step23',
      apIndex: idx,
      shortName: `2.${apNum}.2 เทส WiFi AP#${apNum}`,
      label: `2.${apNum}.2 รูปผลทดสอบความเร็ว WiFi ของ AP ตัวที่ ${apNum} (${roomName})`,
      hasPhoto: Boolean(ap.photo_wifi),
      photoUrl: ap.photo_wifi || '',
      isDeviceWithSn: false
    });

    slots.push({
      slotKey: `ap_${idx}_lan`,
      stepGroup: 'step23',
      apIndex: idx,
      shortName: `2.${apNum}.3 เทสสาย LAN AP#${apNum}`,
      label: `2.${apNum}.3 รูปผลทดสอบความเร็วสาย LAN ของ AP ตัวที่ ${apNum} (${roomName})`,
      hasPhoto: Boolean(ap.photo_lan),
      photoUrl: ap.photo_lan || '',
      isDeviceWithSn: false
    });
  });

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
    photoProgressPct,
    allRequiredPhotosComplete: isPhotoComplete,
    requiredPhotos: slots.map(s => ({
      slotKey: s.slotKey,
      label: s.label,
      shortLabel: s.shortName,
      uploaded: s.hasPhoto,
      photoUrl: s.photoUrl
    })),
    uploadedPhotos: uploadedRequiredCount,
    missingPhotoCount: missingSlots.length,
    missingPhotoLabels: missingSlots.map(s => s.label),
    missingSlotKeys: missingSlots.map(s => s.slotKey),
    isPhotoComplete,
    slots,
    snRecheckItems,
    snComparisons: snRecheckItems.map(i => ({
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
    readyForCheckout: isPhotoComplete && !hasSnMismatch && !hasMissingSn
  };
}

/**
 * Applies a photo URL (and optional OCR S/N + manual S/N) to a circuit's router_info or access_points
 */
function applySlotPhotoAndSnToCircuit(circuit, slotKey, photoUrl, ocrSn, manualSn) {
  if (!circuit.router_info) circuit.router_info = {};
  if (!Array.isArray(circuit.access_points) || circuit.access_points.length === 0) {
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
  } else if (slotKey === 'router_lan2') {
    if (photoUrl) circuit.router_info.photo_lan2 = photoUrl;
  } else if (slotKey === 'router_lan3') {
    if (photoUrl) circuit.router_info.photo_lan3 = photoUrl;
  } else if (slotKey === 'signed_handover_doc') {
    if (photoUrl) circuit.router_info.photo_signed_doc = photoUrl;
  } else if (slotKey && (slotKey.startsWith('ap_') || /^ap\d+_/.test(slotKey))) {
    let idx = 0;
    let kind = 'device';
    const mZero = /^ap_(\d+)_(device|wifi|lan)$/.exec(slotKey);
    const mOne = /^ap(\d+)_(device|wifi|lan)$/.exec(slotKey);
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
    if (kind === 'device') {
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

async function sendLineReply(replyToken, messages, channelAccessToken) {
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
    return { sent: res.ok, status: res.status };
  } catch (err) {
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
  normalizeSn,
  compareSnValues,
  evaluateCircuitCompleteness,
  applySlotPhotoAndSnToCircuit,
  verifyLineSignature,
  sendLineReply,
  sendLinePush,
  downloadLineMessageImage
};
