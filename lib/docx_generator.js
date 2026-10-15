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
    : [
        { ap_no: 1, room: 'ห้อง GPS' },
        { ap_no: 2, room: 'ห้อง GECC' }
      ];

  const mediaFiles = []; // { name, data }
  const relsEntries = [];
  let imgCounter = 1;

  const registerImage = (src, widthPx, heightPx, label, customPlaceholderLines = null) => {
    const resolved = resolveImageBuffer(src, uploadsDir);
    if (!resolved) {
      if (Array.isArray(customPlaceholderLines) && customPlaceholderLines.length > 0) {
        return customPlaceholderLines
          .map((line, i) =>
            makeParagraph(makeRun(line, { bold: true, sizePt: 13, color: 'DC2626' }), {
              align: 'center',
              spacingBefore: i === 0 ? 180 : 20,
              spacingAfter: i === customPlaceholderLines.length - 1 ? 180 : 20
            })
          )
          .join('\n');
      }
      return makeParagraph(
        makeRun(`( นำภาพวางตรงจุดนี้: ${label} )`, { bold: true, sizePt: 13, color: 'DC2626' }),
        { align: 'center', spacingBefore: 160, spacingAfter: 160 }
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
      { align: 'center', spacingBefore: 40, spacingAfter: 40 }
    );
  };

  const bodyParts = [];

  // ==========================================================================
  // PAGE 1: สำเนาเอกสาร "แบบส่งมอบงาน" หน้าที่ 1/2 (ที่ช่างเขียนรายละเอียดหน้างาน)
  // ==========================================================================
  const handoverP1Src = rt.photo_handover_p1 || rt.photo_signed_doc || '';
  if (handoverP1Src) {
    bodyParts.push(
      registerImage(handoverP1Src, 595, 815, 'สำเนาเอกสาร แบบส่งมอบงาน หน้าที่ 1/2')
    );
  } else {
    bodyParts.push(
      makeParagraph(makeRun('สำเนาเอกสาร "แบบส่งมอบงาน" (หน้าที่ 1/2)', { bold: true, sizePt: 18 }), { align: 'center', spacingBefore: 200, spacingAfter: 60 }),
      makeParagraph(makeRun(`วงจร ${c.so_number || '-'} (${c.service_no || '-'}) — ${c.branch_name || c.province || ''}`, { bold: true, sizePt: 15, color: '334155' }), { align: 'center', spacingAfter: 160 }),
      registerImage('', 560, 720, 'สำเนาแบบส่งมอบงาน หน้า 1/2', [
        '( นำภาพสำเนาเอกสาร "แบบส่งมอบงาน" หน้าที่ 1/2 วางตรงจุดนี้ )',
        '( ภาพถ่ายเอกสารตัวจริงที่ช่างเขียนรายละเอียดอุปกรณ์ Router และ Access Point หน้างาน )'
      ])
    );
  }

  // ==========================================================================
  // PAGE 2: สำเนาเอกสาร "แบบส่งมอบงาน" หน้าที่ 2/2 (ลงนาม + ประทับตราเจ้าหน้าที่)
  // ==========================================================================
  bodyParts.push(makePageBreak());
  const handoverP2Src = rt.photo_handover_p2 || '';
  if (handoverP2Src) {
    bodyParts.push(
      registerImage(handoverP2Src, 595, 815, 'สำเนาเอกสาร แบบส่งมอบงาน หน้าที่ 2/2 (ลงนามและประทับตรา)')
    );
  } else {
    bodyParts.push(
      makeParagraph(makeRun('สำเนาเอกสาร "แบบส่งมอบงาน" (หน้าที่ 2/2 — ลงนามพร้อมประทับตรา)', { bold: true, sizePt: 18 }), { align: 'center', spacingBefore: 200, spacingAfter: 60 }),
      makeParagraph(makeRun(`วงจร ${c.so_number || '-'} (${c.service_no || '-'}) — ${c.branch_name || c.province || ''}`, { bold: true, sizePt: 15, color: '334155' }), { align: 'center', spacingAfter: 160 }),
      registerImage('', 560, 720, 'สำเนาแบบส่งมอบงาน หน้า 2/2', [
        '( นำภาพสำเนาเอกสาร "แบบส่งมอบงาน" หน้าที่ 2/2 วางตรงจุดนี้ )',
        '( ภาพถ่ายเอกสารตัวจริงที่มีลายเซ็นผู้ส่งมอบ และ ลายเซ็นเจ้าหน้าที่กรมการขนส่งทางบกพร้อมประทับตรา )'
      ])
    );
  }

  // ==========================================================================
  // PAGE 3: เอกสารรายงานการติดตั้ง — วงจรสื่อสัญญาณความเร็วสูงแบบ INF (MikroTik)
  // (ตรงตามรูปแบบรายงานของปีที่แล้วทุกประการ)
  // ==========================================================================
  bodyParts.push(makePageBreak());
  bodyParts.push(
    makeParagraph(makeRun('1toAll', { bold: true, sizePt: 20, color: 'BE123C' }), { align: 'right', spacingAfter: 10 }),
    makeParagraph(makeRun('เอกสารรายงานการติดตั้ง', { bold: true, sizePt: 20 }), { align: 'center', spacingAfter: 20 }),
    makeParagraph(makeRun('วงจรสื่อสัญญาณความเร็วสูงแบบ INF (Internet FTTx)', { bold: true, sizePt: 16 }), { align: 'center', spacingAfter: 20 }),
    makeParagraph(
      makeRun('สำหรับ กรมการขนส่งทางบก สาขา ', { bold: true, sizePt: 15 }) +
      makeRun(`  ${c.branch_name || c.province || '........................'}  `, { bold: true, underline: true, sizePt: 15 }) +
      makeRun(' จังหวัด ', { bold: true, sizePt: 15 }) +
      makeRun(`  ${c.province || '........................'}  `, { bold: true, underline: true, sizePt: 15 }),
      { align: 'center', spacingAfter: 100 }
    )
  );

  const mkt1DeviceImgXml = registerImage(rt.photo_device, 270, 250, 'รูปถ่ายจุดติดตั้ง Mikrotik ตัวที่ 1', [
    '( นำภาพวางตรงจุดนี้ )',
    '(ภาพ อุปกรณ์ Mikrotik ที่เปลี่ยนสติ๊กเกอร์ใหม่',
    'และเขียนรายละเอียดครบถ้วน แล้ว)'
  ]);
  const mkt1Lan2ImgXml = registerImage(rt.photo_lan2, 270, 120, 'รูปภาพ Test speed port lan 2', [
    '( นำภาพวางตรงจุดนี้ )',
    '(ผลทดสอบความเร็ว ความเร็วประมาณ 650 Mbps/350 Mbps)'
  ]);
  const mkt1Lan3ImgXml = registerImage(rt.photo_lan3, 270, 120, 'รูปภาพ Test speed port lan 3', [
    '( นำภาพวางตรงจุดนี้ )',
    '(ผลทดสอบความเร็ว ความเร็วประมาณ 650 Mbps/350 Mbps)'
  ]);

  const mkt2DeviceImgXml = registerImage(rt.photo_device_2 || '', 270, 220, 'รูปถ่ายจุดติดตั้ง Mikrotik ตัวที่ 2', [
    '( นำภาพวางตรงจุดนี้ )',
    '(ภาพ อุปกรณ์ Mikrotik ที่เปลี่ยนสติ๊กเกอร์ใหม่',
    'และเขียนรายละเอียดครบถ้วน ใหม่แล้ว )',
    'หากขนส่งที่นี่มี Mikrotik มากกว่า 2 ตัวให้เพิ่มช่องใส่นี้'
  ]);
  const mkt2Lan2ImgXml = registerImage(rt.photo_lan2_2 || '', 270, 110, 'รูปภาพ Test speed port lan 2 (ตัวที่ 2)', [
    '( นำภาพวางตรงจุดนี้ )',
    '(ผลทดสอบความเร็ว ความเร็วประมาณ 650 Mbps/350 Mbps)'
  ]);
  const mkt2Lan3ImgXml = registerImage(rt.photo_lan3_2 || '', 270, 110, 'รูปภาพ Test speed port lan 3 (ตัวที่ 2)', [
    '( นำภาพวางตรงจุดนี้ )',
    '(ผลทดสอบความเร็ว ความเร็วประมาณ 650 Mbps/350 Mbps)'
  ]);

  bodyParts.push(`
    <w:tbl>
      <w:tblPr>
        <w:tblW w:w="9800" w:type="dxa"/>
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
          <w:tcPr><w:tcW w:w="4900" w:type="dxa"/></w:tcPr>
          ${makeParagraph(makeRun('รูปถ่ายจุดติดตั้ง Mikrotik ตัวที่ 1', { bold: true, sizePt: 15 }), { align: 'center', spacingAfter: 20 })}
          ${makeParagraph(
            makeRun('เลขวงจร BINF ', { bold: true, sizePt: 15 }) +
            makeRun(String(c.so_number || '').replace(/^BINF/i, ''), { bold: true, underline: true, sizePt: 15 }),
            { align: 'center', spacingAfter: 40 }
          )}
          ${mkt1DeviceImgXml}
        </w:tc>
        <w:tc>
          <w:tcPr><w:tcW w:w="4900" w:type="dxa"/></w:tcPr>
          ${makeParagraph(makeRun('รูปภาพ Test speed port lan 2', { bold: true, sizePt: 15 }), { align: 'center', spacingAfter: 20 })}
          ${mkt1Lan2ImgXml}
          ${makeParagraph(makeRun('รูปภาพ Test speed port lan 3', { bold: true, sizePt: 15 }), { align: 'center', spacingBefore: 60, spacingAfter: 20 })}
          ${mkt1Lan3ImgXml}
        </w:tc>
      </w:tr>
      <w:tr>
        <w:tc>
          <w:tcPr><w:tcW w:w="4900" w:type="dxa"/></w:tcPr>
          ${makeParagraph(makeRun('รูปถ่ายจุดติดตั้ง Mikrotik ตัวที่ 2', { bold: true, sizePt: 15 }), { align: 'center', spacingAfter: 20 })}
          ${makeParagraph(makeRun('เลขวงจร BINF.........................', { bold: true, sizePt: 15 }), { align: 'center', spacingAfter: 40 })}
          ${mkt2DeviceImgXml}
        </w:tc>
        <w:tc>
          <w:tcPr><w:tcW w:w="4900" w:type="dxa"/></w:tcPr>
          ${makeParagraph(makeRun('รูปภาพ Test speed port lan 2', { bold: true, sizePt: 15 }), { align: 'center', spacingAfter: 20 })}
          ${mkt2Lan2ImgXml}
          ${makeParagraph(makeRun('รูปภาพ Test speed port lan 3', { bold: true, sizePt: 15 }), { align: 'center', spacingBefore: 60, spacingAfter: 20 })}
          ${mkt2Lan3ImgXml}
        </w:tc>
      </w:tr>
    </w:tbl>
  `);

  // ==========================================================================
  // PAGE 4+: เอกสารรายงานการติดตั้ง (Access Point — หน้าละ 2 จุดตามฟอร์มปีที่แล้ว)
  // ==========================================================================
  for (let i = 0; i < aps.length; i += 2) {
    const pair = aps.slice(i, i + 2);
    bodyParts.push(makePageBreak());
    bodyParts.push(
      makeParagraph(makeRun('1toAll', { bold: true, sizePt: 20, color: 'BE123C' }), { align: 'right', spacingAfter: 10 }),
      makeParagraph(makeRun('เอกสารรายงานการติดตั้ง', { bold: true, sizePt: 20 }), { align: 'center', spacingAfter: 20 }),
      makeParagraph(
        makeRun('สำหรับ กรมการขนส่งทางบก สาขา ', { bold: true, sizePt: 15 }) +
        makeRun(`  ${c.branch_name || c.province || '........................'}  `, { bold: true, underline: true, sizePt: 15 }) +
        makeRun(' จังหวัด ', { bold: true, sizePt: 15 }) +
        makeRun(`  ${c.province || '........................'}  `, { bold: true, underline: true, sizePt: 15 }),
        { align: 'center', spacingAfter: 80 }
      )
    );

    const apRowsXml = pair.map((ap, idxInPage) => {
      const apNum = i + idxInPage + 1;
      const roomLabel = ap.room ? (ap.room.startsWith('ห้อง') ? ap.room : `ห้อง ${ap.room}`) : `จุดที่ ${apNum}`;
      const devXml = registerImage(ap.photo_device, 270, 240, `รูปถ่าย Access Point ตัวที่ ${apNum}`, [
        '( นำภาพวางตรงจุดนี้ )',
        '(ภาพ อุปกรณ์ AP ที่เปลี่ยนสติ๊กเกอร์ใหม่',
        'และเขียนรายละเอียดครบถ้วน ใหม่แล้ว )'
      ]);
      const wifiXml = registerImage(ap.photo_wifi, 270, 120, `รูปภาพ Test speed ผ่าน WiFi (AP ตัวที่ ${apNum})`, [
        '( นำภาพวางตรงจุดนี้ )',
        '(ผลทดสอบความเร็ว ความเร็วประมาณ 50 Mbps/ 20 Mbps)'
      ]);
      const lanXml = registerImage(ap.photo_lan, 270, 120, `รูปภาพ Test speed ผ่านสาย Lan (AP ตัวที่ ${apNum})`, [
        '( นำภาพวางตรงจุดนี้ )',
        '(ผลทดสอบความเร็ว ความเร็วประมาณ 350 Mbps/ 200 Mbps)'
      ]);

      return `
        <w:tr>
          <w:tc>
            <w:tcPr><w:tcW w:w="4900" w:type="dxa"/></w:tcPr>
            ${makeParagraph(makeRun(`รูปถ่าย Access Point(AP) ณ จุดติดตั้ง ตัวที่ ${apNum} (${roomLabel})`, { bold: true, sizePt: 15 }), { align: 'center', spacingAfter: 40 })}
            ${devXml}
          </w:tc>
          <w:tc>
            <w:tcPr><w:tcW w:w="4900" w:type="dxa"/></w:tcPr>
            ${makeParagraph(makeRun('รูปภาพ Test speed ผ่าน WiFi', { bold: true, sizePt: 15 }), { align: 'center', spacingAfter: 20 })}
            ${wifiXml}
            ${makeParagraph(makeRun('รูปภาพ Test speed ผ่านสาย Lan', { bold: true, sizePt: 15 }), { align: 'center', spacingBefore: 60, spacingAfter: 20 })}
            ${lanXml}
          </w:tc>
        </w:tr>
      `;
    }).join('');

    bodyParts.push(`
      <w:tbl>
        <w:tblPr>
          <w:tblW w:w="9800" w:type="dxa"/>
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
      <w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/>
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
