const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

// ============================================================================
// Minimal Pure-Node ZIP Builder for OpenXML (.docx)
// ============================================================================
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32Buffer(buf) {
  if (typeof zlib.crc32 === 'function') {
    return zlib.crc32(buf) >>> 0;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function buildZipBuffer(files) {
  // files: Array of { name: string, data: Buffer }
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name.replace(/\\/g, '/'), 'utf8');
    const uncompressed = Buffer.isBuffer(file.data) ? file.data : Buffer.from(String(file.data), 'utf8');
    const crc = crc32Buffer(uncompressed);
    const compressed = zlib.deflateRawSync(uncompressed);

    // Local file header (30 bytes + name)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4);         // version needed
    localHeader.writeUInt16LE(0x0800, 6);     // UTF-8 flag
    localHeader.writeUInt16LE(8, 8);          // method: deflate
    localHeader.writeUInt16LE(0, 10);         // mod time
    localHeader.writeUInt16LE(0x21, 12);      // mod date
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(uncompressed.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, compressed);

    // Central directory header (46 bytes + name)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x21, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(uncompressed.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + compressed.length;
  }

  const centralDirBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirBuf, eocd]);
}

function xmlEscape(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Resolve image source (either '/uploads/...' or 'data:image/...;base64,...') into { buffer, ext, mime }
function resolveImageBuffer(src, uploadsDir) {
  if (!src || typeof src !== 'string') return null;
  try {
    // Support in-memory Map lookup (e.g. Cloudflare Workers) where /uploads/... maps to a data:image/... URL
    if (uploadsDir && typeof uploadsDir.get === 'function' && uploadsDir.has(src)) {
      src = uploadsDir.get(src);
    }
    if (src.startsWith('data:image/')) {
      const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(src);
      if (!m) return null;
      const mime = m[1].toLowerCase();
      const ext = mime.includes('png') ? 'png' : 'jpeg';
      return {
        buffer: Buffer.from(m[2], 'base64'),
        ext,
        mime: ext === 'png' ? 'image/png' : 'image/jpeg'
      };
    }
    if (src.startsWith('/uploads/') && typeof uploadsDir === 'string') {
      const rel = decodeURIComponent(src.replace(/^\/uploads\//, ''));
      const fullPath = path.normalize(path.join(uploadsDir, rel));
      if (fullPath.startsWith(uploadsDir) && fs.existsSync(fullPath)) {
        const extRaw = path.extname(fullPath).toLowerCase().replace('.', '');
        const ext = extRaw === 'png' ? 'png' : 'jpeg';
        return {
          buffer: fs.readFileSync(fullPath),
          ext,
          mime: ext === 'png' ? 'image/png' : 'image/jpeg'
        };
      }
    }
  } catch (_) {}
  return null;
}

// Create OpenXML <w:drawing> inline image element (widthPx, heightPx -> EMUs: 1 px = 9525 EMUs)
function makeWordImageXml(rId, docPrId, widthPx, heightPx, title = 'Photo') {
  const cx = Math.round(widthPx * 9525);
  const cy = Math.round(heightPx * 9525);
  return `
    <w:r>
      <w:drawing>
        <wp:inline distT="0" distB="0" distL="0" distR="0">
          <wp:extent cx="${cx}" cy="${cy}"/>
          <wp:docPr id="${docPrId}" name="${xmlEscape(title)}"/>
          <wp:cNvGraphicFramePr>
            <a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/>
          </wp:cNvGraphicFramePr>
          <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
            <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
              <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
                <pic:nvPicPr>
                  <pic:cNvPr id="${docPrId}" name="${xmlEscape(title)}"/>
                  <pic:cNvPicPr/>
                </pic:nvPicPr>
                <pic:blipFill>
                  <a:blip r:embed="${rId}"/>
                  <a:stretch><a:fillRect/></a:stretch>
                </pic:blipFill>
                <pic:spPr>
                  <a:xfrm>
                    <a:off x="0" y="0"/>
                    <a:ext cx="${cx}" cy="${cy}"/>
                  </a:xfrm>
                  <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                </pic:spPr>
              </pic:pic>
            </a:graphicData>
          </a:graphic>
        </wp:inline>
      </w:drawing>
    </w:r>
  `;
}

function makeParagraph(runsXml, { align = 'left', spacingAfter = 80, spacingBefore = 0 } = {}) {
  return `
    <w:p>
      <w:pPr>
        <w:jc w:val="${align}"/>
        <w:spacing w:before="${spacingBefore}" w:after="${spacingAfter}" w:line="260" w:lineRule="auto"/>
      </w:pPr>
      ${runsXml}
    </w:p>
  `;
}

function makeRun(text, { bold = false, underline = false, sizePt = 14, color = '000000' } = {}) {
  const halfPt = Math.round(sizePt * 2);
  return `
    <w:r>
      <w:rPr>
        <w:rFonts w:ascii="TH SarabunPSK" w:hAnsi="TH SarabunPSK" w:cs="TH SarabunPSK" w:eastAsia="TH SarabunPSK"/>
        ${bold ? '<w:b/><w:bCs/>' : ''}
        ${underline ? '<w:u w:val="single"/>' : ''}
        <w:color w:val="${color}"/>
        <w:sz w:val="${halfPt}"/>
        <w:szCs w:val="${halfPt}"/>
      </w:rPr>
      <w:t xml:space="preserve">${xmlEscape(text)}</w:t>
    </w:r>
  `;
}

function makePageBreak() {
  return `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
}

/**
 * Generates a native Microsoft Word (.docx) Buffer for a DLT Circuit inspection report.
 */
function generateCircuitDocx(circuit, uploadsDir, completeness = null) {
  const c = circuit || {};
  const rt = c.router_info || {};
  const aps = Array.isArray(c.access_points) && c.access_points.length > 0
    ? c.access_points
    : [{ ap_no: 1, room: 'ห้อง GPS' }, { ap_no: 2, room: 'ห้อง GECC' }];

  const mediaFiles = []; // { fileName, buffer, rId }
  const relsEntries = [];
  let imgCounter = 1;

  const registerImage = (src, widthPx, heightPx, label) => {
    const resolved = resolveImageBuffer(src, uploadsDir);
    if (!resolved) {
      return makeParagraph(
        makeRun(`[ยังไม่มีรูปภาพ: ${label}]`, { bold: true, sizePt: 13, color: 'DC2626' }),
        { align: 'center', spacingBefore: 120, spacingAfter: 120 }
      );
    }
    const idNum = imgCounter++;
    const rId = `rIdImg${idNum}`;
    const fileName = `image${idNum}.${resolved.ext}`;
    mediaFiles.push({
      name: `word/media/${fileName}`,
      data: resolved.buffer
    });
    relsEntries.push(
      `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${fileName}"/>`
    );
    return makeParagraph(
      makeWordImageXml(rId, idNum + 100, widthPx, heightPx, label),
      { align: 'center', spacingBefore: 60, spacingAfter: 60 }
    );
  };

  // ==========================================================================
  // PAGE 1: แบบส่งมอบงาน (Handover Form & Equipment Details + S/N Recheck)
  // ==========================================================================
  const bodyParts = [];

  bodyParts.push(
    makeParagraph(makeRun('1toAll — บริษัท วัน-ทู-ออล จำกัด', { bold: true, sizePt: 18, color: 'BE123C' }), { align: 'left', spacingAfter: 40 }),
    makeParagraph(makeRun('แบบส่งมอบงาน', { bold: true, sizePt: 18 }), { align: 'center', spacingAfter: 20 }),
    makeParagraph(
      makeRun('โครงการจ้างเหมาบริการวงจรสื่อสารข้อมูลสนับสนุนการบริหารความปลอดภัยด้วยระบบอินเตอร์เน็ตของทั้งส่วนกลางและส่วนภูมิภาค', { bold: true, sizePt: 14 }),
      { align: 'center', spacingAfter: 20 }
    ),
    makeParagraph(makeRun('กรมการขนส่งทางบก', { bold: true, sizePt: 16 }), { align: 'center', spacingAfter: 140 })
  );

  // Site Info
  bodyParts.push(
    makeParagraph(
      makeRun('สถานที่ติดตั้ง สำนักงานขนส่ง: ', { bold: true, sizePt: 14 }) +
      makeRun(c.branch_name || `สำนักงานขนส่งจังหวัด${c.province || ''}`, { underline: true, sizePt: 14 }) +
      makeRun(`   จังหวัด: `, { bold: true, sizePt: 14 }) +
      makeRun(c.province || '-', { underline: true, sizePt: 14 })
    ),
    makeParagraph(
      makeRun('ที่อยู่เลขที่: ', { bold: true, sizePt: 14 }) +
      makeRun(c.address || '-', { underline: true, sizePt: 14 })
    ),
    makeParagraph(
      makeRun('พิกัดที่ตั้ง (Lat/Long): ', { bold: true, sizePt: 14 }) +
      makeRun(c.lat_long || '-', { underline: true, sizePt: 14 })
    )
  );

  // Check-in / Check-out / Admin Verification Summary Box
  const checkinStr = c.checkin_time ? new Date(c.checkin_time).toLocaleString('th-TH') : (c.inspection_date || 'ยังไม่ระบุ');
  const checkoutStr = c.checkout_time ? new Date(c.checkout_time).toLocaleString('th-TH') : 'ยังไม่ระบุ';
  const adminStatusMap = {
    approved: 'อนุมัติแล้ว (Approved)',
    rejected: 'ตีกลับให้แก้ไข (Rejected)',
    pending_review: 'รอ Admin ตรวจสอบ (Pending Review)',
    working: 'กำลังปฏิบัติงานหน้างาน (Working)'
  };
  const adminText = adminStatusMap[c.admin_status] || 'รอดำเนินการ';

  bodyParts.push(
    makeParagraph(
      makeRun('ข้อมูลการเข้าหน้างาน (Onsite Check-in / Check-out): ', { bold: true, sizePt: 13, color: '1E3A8A' }) +
      makeRun(`เข้า Site: ${checkinStr}  |  ออก Site: ${checkoutStr}  |  ช่างผู้ดำเนินการ: ${c.inspector_name || '-'} (${c.inspector_phone || '-'})`, { sizePt: 13 })
    ),
    makeParagraph(
      makeRun('สถานะการตรวจสอบโดย Admin: ', { bold: true, sizePt: 13, color: '047857' }) +
      makeRun(`${adminText}${c.admin_name ? ` (โดย ${c.admin_name})` : ''}${completeness ? `  |  รูปภาพ: ${completeness.uploadedPhotos}/${completeness.requiredPhotos} รูป` : ''}`, { sizePt: 13 }),
      { spacingAfter: 140 }
    )
  );

  // Circuit 1 Details
  const rOcrNote = rt.ocr_serial_no
    ? (rt.ocr_serial_no === rt.serial_no ? ` [OCR ตรงกัน: ${rt.ocr_serial_no}]` : ` [ค่า OCR: ${rt.ocr_serial_no}]`)
    : '';

  bodyParts.push(
    makeParagraph(
      makeRun('หมายเลข S/O วงจรที่ 1: ', { bold: true, underline: true, sizePt: 15 }) +
      makeRun(` ${c.so_number || '-'} (Service No: ${c.service_no || '-'}) `, { bold: true, sizePt: 15 }) +
      makeRun('   FTTx ความเร็ว: ', { bold: true, sizePt: 14 }) +
      makeRun(c.speed_pkg || '1000Mbps/500Mbps', { underline: true, sizePt: 14 })
    ),
    makeParagraph(
      makeRun('☑ 1. Router MikroTik สถานที่ติดตั้ง ห้อง: ', { bold: true, sizePt: 14 }) +
      makeRun(rt.room || 'วิชาการ', { underline: true, sizePt: 14 }) +
      makeRun('   ชั้น: ', { bold: true, sizePt: 14 }) +
      makeRun(rt.floor || '1', { underline: true, sizePt: 14 }) +
      makeRun('   อาคาร: ', { bold: true, sizePt: 14 }) +
      makeRun(rt.building || '1', { underline: true, sizePt: 14 })
    ),
    makeParagraph(
      makeRun('     อุปกรณ์ MikroTik รุ่น: ', { bold: true, sizePt: 14 }) +
      makeRun(rt.model || 'RB3011', { underline: true, sizePt: 14 }) +
      makeRun('   Serial No. (ช่างยืนยัน): ', { bold: true, sizePt: 14 }) +
      makeRun((rt.serial_no || '-') + rOcrNote, { bold: true, underline: true, sizePt: 14 }) +
      makeRun('   เลขครุภัณฑ์: ', { bold: true, sizePt: 14 }) +
      makeRun(rt.asset_no || `สขจ.${c.province || ''}`, { underline: true, sizePt: 14 })
    ),
    makeParagraph(
      makeRun(`     ผลทดสอบความเร็ว Port LAN 2: ${rt.speed_lan2_dl || '-'} / ${rt.speed_lan2_ul || '-'} Mbps   |   Port LAN 3: ${rt.speed_lan3_dl || '-'} / ${rt.speed_lan3_ul || '-'} Mbps (เกณฑ์ ≥ 650/350 Mbps)`, { sizePt: 13, color: '334155' }),
      { spacingAfter: 100 }
    )
  );

  // Access Points list
  aps.forEach((ap, idx) => {
    const apNum = idx + 1;
    const apOcrNote = ap.ocr_serial_no
      ? (ap.ocr_serial_no === ap.serial_no ? ` [OCR ตรงกัน: ${ap.ocr_serial_no}]` : ` [ค่า OCR: ${ap.ocr_serial_no}]`)
      : '';
    bodyParts.push(
      makeParagraph(
        makeRun(`☑ Access Point ตัวที่ ${apNum} สถานที่ติดตั้ง ห้อง: `, { bold: true, sizePt: 14 }) +
        makeRun(ap.room || '-', { underline: true, sizePt: 14 }) +
        makeRun('   ชั้น: ', { bold: true, sizePt: 14 }) +
        makeRun(ap.floor || '1', { underline: true, sizePt: 14 }) +
        makeRun('   อาคาร: ', { bold: true, sizePt: 14 }) +
        makeRun(ap.building || '1', { underline: true, sizePt: 14 })
      ),
      makeParagraph(
        makeRun('     ยี่ห้อ: ', { bold: true, sizePt: 14 }) +
        makeRun(ap.brand || 'TOTOLINK', { underline: true, sizePt: 14 }) +
        makeRun('   รุ่น: ', { bold: true, sizePt: 14 }) +
        makeRun(ap.model || 'A3002RU', { underline: true, sizePt: 14 }) +
        makeRun('   Serial No. (ช่างยืนยัน): ', { bold: true, sizePt: 14 }) +
        makeRun((ap.serial_no || '-') + apOcrNote, { bold: true, underline: true, sizePt: 14 }) +
        makeRun('   เลขครุภัณฑ์: ', { bold: true, sizePt: 14 }) +
        makeRun(ap.asset_no || '-', { underline: true, sizePt: 14 })
      ),
      makeParagraph(
        makeRun(`     ผลทดสอบความเร็ว WiFi: ${ap.speed_wifi_dl || '-'} / ${ap.speed_wifi_ul || '-'} Mbps   |   สาย LAN: ${ap.speed_lan_dl || '-'} / ${ap.speed_lan_ul || '-'} Mbps`, { sizePt: 13, color: '334155' }),
        { spacingAfter: 100 }
      )
    );
  });

  // Remarks
  bodyParts.push(
    makeParagraph(makeRun('หมายเหตุ:', { bold: true, underline: true, sizePt: 14 }), { spacingBefore: 80, spacingAfter: 40 }),
    makeParagraph(makeRun(c.remarks || '-', { sizePt: 14 }), { spacingAfter: 120 }),
    makeParagraph(makeRun('หลังจากลงนามในเอกสารตรวจรับบริการแล้ว (ทางกรมฯ และ 1-to-All เก็บเอกสารไว้ฝ่ายละ 1 ฉบับ)', { sizePt: 13 }), { spacingAfter: 100 })
  );

  // Signatures Table (2 columns: ผู้เข้าดำเนินการติดตั้ง | กรมการขนส่งทางบก)
  const sigInspectorXml = c.inspector_signature
    ? registerImage(c.inspector_signature, 160, 55, 'ลายเซ็นผู้ส่งมอบ')
    : makeParagraph(makeRun('.......................................................', { sizePt: 13 }), { align: 'center' });
  const sigReceiverXml = c.receiver_signature
    ? registerImage(c.receiver_signature, 160, 55, 'ลายเซ็นผู้รับมอบ')
    : makeParagraph(makeRun('.......................................................', { sizePt: 13 }), { align: 'center' });

  bodyParts.push(`
    <w:tbl>
      <w:tblPr>
        <w:tblW w:w="9500" w:type="dxa"/>
        <w:tblBorders>
          <w:top w:val="single" w:sz="6" w:space="0" w:color="000000"/>
          <w:left w:val="single" w:sz="6" w:space="0" w:color="000000"/>
          <w:bottom w:val="single" w:sz="6" w:space="0" w:color="000000"/>
          <w:right w:val="single" w:sz="6" w:space="0" w:color="000000"/>
          <w:insideH w:val="single" w:sz="6" w:space="0" w:color="000000"/>
          <w:insideV w:val="single" w:sz="6" w:space="0" w:color="000000"/>
        </w:tblBorders>
      </w:tblPr>
      <w:tr>
        <w:tc>
          <w:tcPr><w:tcW w:w="4750" w:type="dxa"/></w:tcPr>
          ${makeParagraph(makeRun('ผู้เข้าดำเนินการติดตั้ง (1-to-All)', { bold: true, sizePt: 14 }), { align: 'center' })}
        </w:tc>
        <w:tc>
          <w:tcPr><w:tcW w:w="4750" w:type="dxa"/></w:tcPr>
          ${makeParagraph(makeRun('กรมการขนส่งทางบก (ผู้รับมอบ)', { bold: true, sizePt: 14 }), { align: 'center' })}
        </w:tc>
      </w:tr>
      <w:tr>
        <w:tc>
          <w:tcPr><w:tcW w:w="4750" w:type="dxa"/></w:tcPr>
          ${sigInspectorXml}
          ${makeParagraph(makeRun(`ลงชื่อ ผู้ส่งมอบ`, { sizePt: 13 }), { align: 'center' })}
          ${makeParagraph(makeRun(`ตัวบรรจง ( ${c.inspector_name || '..........................................'} )`, { bold: true, sizePt: 14 }), { align: 'center' })}
          ${makeParagraph(makeRun(`วันที่: ${c.inspection_date || '-'}   โทรศัพท์: ${c.inspector_phone || '-'}`, { sizePt: 13 }), { align: 'center' })}
        </w:tc>
        <w:tc>
          <w:tcPr><w:tcW w:w="4750" w:type="dxa"/></w:tcPr>
          ${sigReceiverXml}
          ${makeParagraph(makeRun(`ลงชื่อพร้อมประทับตรา ผู้รับมอบ`, { sizePt: 13 }), { align: 'center' })}
          ${makeParagraph(makeRun(`ตัวบรรจง ( ${c.receiver_name || '..........................................'} )`, { bold: true, sizePt: 14 }), { align: 'center' })}
          ${makeParagraph(makeRun(`ตำแหน่ง: ${c.receiver_position || '-'}`, { sizePt: 13 }), { align: 'center' })}
          ${makeParagraph(makeRun(`วันที่: ${c.received_date || '-'}   โทรศัพท์: ${c.receiver_phone || '-'}`, { sizePt: 13 }), { align: 'center' })}
        </w:tc>
      </w:tr>
    </w:tbl>
  `);

  // ==========================================================================
  // PAGE 2: เอกสารรายงานการติดตั้ง MikroTik & ผลทดสอบความเร็ว LAN 2 / LAN 3
  // ==========================================================================
  bodyParts.push(makePageBreak());
  bodyParts.push(
    makeParagraph(makeRun('เอกสารรายงานการติดตั้ง', { bold: true, sizePt: 18 }), { align: 'center', spacingAfter: 20 }),
    makeParagraph(makeRun('วงจรสื่อสัญญาณความเร็วสูงแบบ INF (Internet FTTx)', { bold: true, sizePt: 15 }), { align: 'center', spacingAfter: 20 }),
    makeParagraph(
      makeRun(`สำหรับ กรมการขนส่งทางบก สาขา ${c.branch_name || c.province || ''} จังหวัด ${c.province || ''}`, { bold: true, sizePt: 14 }),
      { align: 'center', spacingAfter: 120 }
    )
  );

  const mktDeviceImgXml = registerImage(rt.photo_device, 275, 290, 'รูปถ่ายอุปกรณ์ MikroTik');
  const mktLan2ImgXml = registerImage(rt.photo_lan2, 275, 145, 'ผลทดสอบความเร็ว Port LAN 2');
  const mktLan3ImgXml = registerImage(rt.photo_lan3, 275, 145, 'ผลทดสอบความเร็ว Port LAN 3');

  bodyParts.push(`
    <w:tbl>
      <w:tblPr>
        <w:tblW w:w="9500" w:type="dxa"/>
        <w:tblBorders>
          <w:top w:val="single" w:sz="6" w:space="0" w:color="000000"/>
          <w:left w:val="single" w:sz="6" w:space="0" w:color="000000"/>
          <w:bottom w:val="single" w:sz="6" w:space="0" w:color="000000"/>
          <w:right w:val="single" w:sz="6" w:space="0" w:color="000000"/>
          <w:insideH w:val="single" w:sz="6" w:space="0" w:color="000000"/>
          <w:insideV w:val="single" w:sz="6" w:space="0" w:color="000000"/>
        </w:tblBorders>
      </w:tblPr>
      <w:tr>
        <w:tc>
          <w:tcPr><w:tcW w:w="4750" w:type="dxa"/></w:tcPr>
          ${makeParagraph(makeRun(`รูปถ่ายจุดติดตั้ง MikroTik ตัวที่ 1 (${c.so_number})`, { bold: true, sizePt: 14 }), { align: 'center' })}
          ${makeParagraph(makeRun(`รุ่น: MikroTik ${rt.model || 'RB3011'} | S/N: ${rt.serial_no || '-'} | ห้อง: ${rt.room || '-'}`, { sizePt: 12 }), { align: 'center' })}
          ${mktDeviceImgXml}
        </w:tc>
        <w:tc>
          <w:tcPr><w:tcW w:w="4750" w:type="dxa"/></w:tcPr>
          ${makeParagraph(makeRun(`รูปภาพ Test speed port LAN 2 (${rt.speed_lan2_dl || '-'}/${rt.speed_lan2_ul || '-'} Mbps)`, { bold: true, sizePt: 14 }), { align: 'center' })}
          ${mktLan2ImgXml}
          ${makeParagraph(makeRun(`รูปภาพ Test speed port LAN 3 (${rt.speed_lan3_dl || '-'}/${rt.speed_lan3_ul || '-'} Mbps)`, { bold: true, sizePt: 14 }), { align: 'center', spacingBefore: 80 })}
          ${mktLan3ImgXml}
        </w:tc>
      </w:tr>
    </w:tbl>
  `);

  // ==========================================================================
  // PAGE 3+: เอกสารรายงานการติดตั้ง Access Points (AP)
  // ==========================================================================
  for (let i = 0; i < aps.length; i += 2) {
    const pair = aps.slice(i, i + 2);
    bodyParts.push(makePageBreak());
    bodyParts.push(
      makeParagraph(makeRun('เอกสารรายงานการติดตั้ง Access Point (AP)', { bold: true, sizePt: 18 }), { align: 'center', spacingAfter: 20 }),
      makeParagraph(
        makeRun(`สำหรับ กรมการขนส่งทางบก สาขา ${c.branch_name || c.province || ''} จังหวัด ${c.province || ''} (${c.so_number})`, { bold: true, sizePt: 14 }),
        { align: 'center', spacingAfter: 100 }
      )
    );

    const apRowsXml = pair.map((ap, idxInPage) => {
      const apNum = i + idxInPage + 1;
      const devXml = registerImage(ap.photo_device, 265, 220, `รูปถ่าย AP ตัวที่ ${apNum}`);
      const wifiXml = registerImage(ap.photo_wifi, 265, 115, `ผลเทส WiFi AP ตัวที่ ${apNum}`);
      const lanXml = registerImage(ap.photo_lan, 265, 115, `ผลเทสสาย LAN AP ตัวที่ ${apNum}`);

      return `
        <w:tr>
          <w:tc>
            <w:tcPr><w:tcW w:w="4750" w:type="dxa"/></w:tcPr>
            ${makeParagraph(makeRun(`รูปถ่าย Access Point (AP) ตัวที่ ${apNum} (${ap.room || 'ห้องติดตั้ง'})`, { bold: true, sizePt: 14 }), { align: 'center' })}
            ${makeParagraph(makeRun(`ยี่ห้อ: ${ap.brand || '-'} ${ap.model || ''} | S/N: ${ap.serial_no || '-'} | ครุภัณฑ์: ${ap.asset_no || '-'}`, { sizePt: 12 }), { align: 'center' })}
            ${devXml}
          </w:tc>
          <w:tc>
            <w:tcPr><w:tcW w:w="4750" w:type="dxa"/></w:tcPr>
            ${makeParagraph(makeRun(`รูปภาพ Test speed ผ่าน WiFi (${ap.speed_wifi_dl || '-'}/${ap.speed_wifi_ul || '-'} Mbps)`, { bold: true, sizePt: 13 }), { align: 'center' })}
            ${wifiXml}
            ${makeParagraph(makeRun(`รูปภาพ Test speed ผ่านสาย LAN (${ap.speed_lan_dl || '-'}/${ap.speed_lan_ul || '-'} Mbps)`, { bold: true, sizePt: 13 }), { align: 'center', spacingBefore: 40 })}
            ${lanXml}
          </w:tc>
        </w:tr>
      `;
    }).join('');

    bodyParts.push(`
      <w:tbl>
        <w:tblPr>
          <w:tblW w:w="9500" w:type="dxa"/>
          <w:tblBorders>
            <w:top w:val="single" w:sz="6" w:space="0" w:color="000000"/>
            <w:left w:val="single" w:sz="6" w:space="0" w:color="000000"/>
            <w:bottom w:val="single" w:sz="6" w:space="0" w:color="000000"/>
            <w:right w:val="single" w:sz="6" w:space="0" w:color="000000"/>
            <w:insideH w:val="single" w:sz="6" w:space="0" w:color="000000"/>
            <w:insideV w:val="single" w:sz="6" w:space="0" w:color="000000"/>
          </w:tblBorders>
        </w:tblPr>
        ${apRowsXml}
      </w:tbl>
    `);
  }

  // Signed handover document photo if attached
  if (rt.photo_signed_doc) {
    bodyParts.push(makePageBreak());
    bodyParts.push(
      makeParagraph(makeRun('รูปถ่ายใบส่งมอบงานฉบับจริงที่ลงนามและประทับตราแล้ว', { bold: true, sizePt: 18 }), { align: 'center', spacingAfter: 100 }),
      registerImage(rt.photo_signed_doc, 520, 680, 'ใบส่งมอบงานที่ลงนามแล้ว')
    );
  }

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    ${bodyParts.join('\n')}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="850" w:right="850" w:bottom="850" w:left="850" w:header="450" w:footer="450" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Default Extension="jpg" ContentType="image/jpeg"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const docRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${relsEntries.join('\n  ')}
</Relationships>`;

  const zipEntries = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypesXml, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rootRelsXml, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(documentXml, 'utf8') },
    { name: 'word/_rels/document.xml.rels', data: Buffer.from(docRelsXml, 'utf8') },
    ...mediaFiles
  ];

  return buildZipBuffer(zipEntries);
}

module.exports = {
  generateCircuitDocx
};
