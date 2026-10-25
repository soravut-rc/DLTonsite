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
 * Generates a native Microsoft Word (.docx) Buffer for a DLT Site inspection report
 * (1 Site = 1 Handover Form for up to 4 circuits + all circuits' equipment & speedtest pages in 1 file).
 */
function generateCircuitDocx(circuitOrList, uploadsDir, completeness = null) {
  const siteList = Array.isArray(circuitOrList) && circuitOrList.length > 0
    ? circuitOrList
    : [circuitOrList || {}];
  const primary = siteList[0] || {};
  const siteName = primary.site_name || primary.branch_name || primary.province || '';
  const allSoText = siteList.map((sc, i) => `วงจรที่ ${i + 1}: ${sc.so_number || '-'}`).join(' | ');

  const detectRoomCriteria = (roomStr = '') => {
    const u = String(roomStr || '').toUpperCase();
    if (u.includes('GECC') || u.includes('ประชาสัมพันธ์') || u.includes('ราชการสะดวก')) {
      return { code: 'GECC', docTitle: 'ศูนย์ราชการสะดวก (GECC)', lan: '300/150 Mbps', wifi: '50/20 Mbps' };
    }
    if (u.includes('DLS') || u.includes('DSL') || u.includes('อบรม') || u.includes('ใบอนุญาต')) {
      return { code: 'DLS', docTitle: 'งานใบอนุญาตขับรถ (DLS)', lan: '300/150 Mbps', wifi: '50/20 Mbps' };
    }
    if (u.includes('VICC') || u.includes('ตรวจสภาพ')) {
      return { code: 'VICC', docTitle: 'งานตรวจสภาพรถ (VICC)', lan: '350/200 Mbps', wifi: '50/20 Mbps' };
    }
    return { code: 'GPS', docTitle: 'ศูนย์บริหารจัดการเดินรถด้วยระบบ(GPS)', lan: '350/200 Mbps', wifi: '50/20 Mbps' };
  };

  const getCleanBranch = (c) => {
    const raw = String(c?.site_name || c?.short_branch_name || c?.branch_name || '').trim();
    const stripped = raw
      .replace(/^สำนักงานขนส่งจังหวัด[^ ]*\s*/i, '')
      .replace(/^สขจ\.[^ ]*\s*/i, '')
      .replace(/^สาขา\s*/i, '')
      .trim();
    return (!stripped || stripped === c?.province) ? 'อำเภอเมือง' : stripped;
  };

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
  // PART 1 (Pages 1..N): เอกสารรายงานการติดตั้ง (Router + Access Points ทุกห้องของทุกวงจรใน Site)
  // ตรงตามโครงสร้างตัวอย่าง BINF3480314,BINF3480315,BINF3480316 สาขา อำเภอเมือง จังหวัด สุราษฎร์ธานี.docx
  // ==========================================================================
  let globalApCounter = 0;

  siteList.forEach((c, cIdx) => {
    const rt = c.router_info || {};
    const aps = Array.isArray(c.access_points)
      ? c.access_points.filter(ap => ap && ap.checked !== false)
      : [];
    const mikrotikNum = cIdx + 1;
    const cleanBranch = getCleanBranch(c);

    if (cIdx > 0) {
      bodyParts.push(makePageBreak());
    }

    bodyParts.push(
      makeParagraph(makeRun('Classification: Internal', { bold: false, sizePt: 11, color: '475569' }), { align: 'center', spacingAfter: 0 }),
      makeParagraph(makeRun('1toAll', { bold: true, sizePt: 20, color: 'BE123C' }), { align: 'right', spacingAfter: 10 }),
      makeParagraph(makeRun('เอกสารรายงานการติดตั้ง', { bold: true, sizePt: 20 }), { align: 'center', spacingAfter: 20 }),
      makeParagraph(makeRun('วงจรสื่อสัญญาณความเร็วสูงแบบ INF (Internet FTTx)', { bold: true, sizePt: 16 }), { align: 'center', spacingAfter: 20 }),
      makeParagraph(
        makeRun('สำหรับ กรมการขนส่งทางบก สาขา ', { bold: true, sizePt: 16 }) +
        makeRun(`  ${cleanBranch}  `, { bold: true, underline: true, sizePt: 16, color: 'B91C1C' }) +
        makeRun(' จังหวัด ', { bold: true, sizePt: 16 }) +
        makeRun(`  ${c.province || '........................'}  `, { bold: true, underline: true, sizePt: 16, color: 'B91C1C' }),
        { align: 'center', spacingAfter: 60 }
      )
    );

    const mkt1DeviceImgXml = registerImage(rt.photo_device, 270, 290, `รูปถ่ายจุดติดตั้ง Mikrotik ตัวที่ ${mikrotikNum} (${c.so_number})`, [
      '( นำภาพวางตรงจุดนี้ )',
      `(รูปถ่ายจุดติดตั้ง Mikrotik ตัวที่ ${mikrotikNum} รุ่น ${rt.model || 'RB3011'} วงจร ${c.so_number}`,
      `และเขียนรายละเอียด เลขวงจร/ครุภัณฑ์/รุ่น/SN: ${rt.serial_no || '-'} ชัดเจน)`
    ]);
    const mkt1Lan2ImgXml = registerImage(rt.photo_lan2, 270, 140, `รูปภาพ Test speed Lan Port 2 (${c.so_number})`, [
      '( นำภาพวางตรงจุดนี้ )',
      '(รูปภาพ Test speed Lan Port 2 ไม่ต่ำกว่า 650 Mbps/350 Mbps)'
    ]);
    const mkt1Lan3ImgXml = registerImage(rt.photo_lan3, 270, 140, `รูปภาพ Test speed Lan Port 3 (${c.so_number})`, [
      '( นำภาพวางตรงจุดนี้ )',
      '(รูปภาพ Test speed Lan Port 3 ไม่ต่ำกว่า 650 Mbps/350 Mbps)'
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
            ${makeParagraph(makeRun(`รูปถ่ายจุดติดตั้ง Mikrotik ตัวที่ ${mikrotikNum}`, { bold: true, sizePt: 15.5 }), { align: 'center', spacingAfter: 10 })}
            ${makeParagraph(
              makeRun('เลขวงจร BINF ', { bold: true, sizePt: 15.5 }) +
              makeRun(String(c.so_number || '').replace(/^BINF/i, ''), { bold: true, underline: true, sizePt: 15.5 }),
              { align: 'center', spacingAfter: 10 }
            )}
            ${makeParagraph(makeRun(`รุ่น: MikroTik ${rt.model || 'RB3011'} | S/N: ${rt.serial_no || '-'} | ห้อง${rt.room || '-'} ชั้น ${rt.floor || '1'} อาคาร ${rt.building || '1'}`, { bold: false, sizePt: 12, color: '334155' }), { align: 'center', spacingAfter: 30 })}
            ${mkt1DeviceImgXml}
          </w:tc>
          <w:tc>
            <w:tcPr><w:tcW w:w="4900" w:type="dxa"/></w:tcPr>
            ${makeParagraph(makeRun('รูปภาพ Test speed Lan Port 2', { bold: true, sizePt: 15 }), { align: 'center', spacingAfter: 20 })}
            ${mkt1Lan2ImgXml}
            ${makeParagraph(makeRun('รูปภาพ Test speed Lan Port 3', { bold: true, sizePt: 15 }), { align: 'center', spacingBefore: 60, spacingAfter: 20 })}
            ${mkt1Lan3ImgXml}
          </w:tc>
        </w:tr>
      </w:tbl>
    `);

    for (let i = 0; i < aps.length; i += 2) {
      const pair = aps.slice(i, i + 2);
      bodyParts.push(makePageBreak());
      bodyParts.push(
        makeParagraph(makeRun('Classification: Internal', { bold: false, sizePt: 11, color: '475569' }), { align: 'center', spacingAfter: 0 }),
        makeParagraph(makeRun('1toAll', { bold: true, sizePt: 20, color: 'BE123C' }), { align: 'right', spacingAfter: 20 })
      );

      const apRowsXml = pair.map((ap) => {
        globalApCounter++;
        const apNum = globalApCounter;
        const crit = detectRoomCriteria(ap.room);
        const roomDocTitle = ap.room || crit.docTitle;
        const devXml = registerImage(ap.photo_device, 270, 240, `รูปถ่าย Access Point(AP) ณ จุดติดตั้ง ตัวที่ ${apNum} (${c.so_number})`, [
          '( นำภาพวางตรงจุดนี้ )',
          `(รูปถ่าย Access Point(AP) ณ จุดติดตั้ง ตัวที่ ${apNum} ${roomDocTitle}`,
          `วงจร ${c.so_number} | ยี่ห้อ ${ap.brand || ''} ${ap.model || ''} | S/N: ${ap.serial_no || '-'})`
        ]);
        const lanXml = registerImage(ap.photo_lan, 270, 120, `รูปภาพ Lan Test speed (AP ตัวที่ ${apNum})`, [
          '( นำภาพวางตรงจุดนี้ )',
          `(รูปภาพ Lan Test speed ห้อง ${crit.code} ไม่ต่ำกว่า ${crit.lan})`
        ]);
        const wifiXml = registerImage(ap.photo_wifi, 270, 120, `รูปภาพ Test speed ผ่าน WiFi (AP ตัวที่ ${apNum})`, [
          '( นำภาพวางตรงจุดนี้ )',
          `(รูปภาพ Test speed ผ่าน WiFi ห้อง ${crit.code} ไม่ต่ำกว่า ${crit.wifi})`
        ]);

        return `
          <w:tr>
            <w:tc>
              <w:tcPr><w:tcW w:w="4900" w:type="dxa"/></w:tcPr>
              ${makeParagraph(makeRun(`รูปถ่าย Access Point(AP) ณ จุดติดตั้ง ตัวที่ ${apNum}`, { bold: true, sizePt: 15 }), { align: 'center', spacingAfter: 10 })}
              ${makeParagraph(makeRun(roomDocTitle, { bold: true, sizePt: 14.5 }), { align: 'center', spacingAfter: 10 })}
              ${makeParagraph(makeRun(`วงจร: ${c.so_number} | รุ่น: ${ap.brand || 'TOTOLINK'} ${ap.model || ''} | S/N: ${ap.serial_no || '-'}`, { bold: false, sizePt: 12, color: '334155' }), { align: 'center', spacingAfter: 30 })}
              ${devXml}
            </w:tc>
            <w:tc>
              <w:tcPr><w:tcW w:w="4900" w:type="dxa"/></w:tcPr>
              ${makeParagraph(makeRun('รูปภาพ Lan Test speed', { bold: true, sizePt: 14.5 }), { align: 'center', spacingAfter: 20 })}
              ${lanXml}
              ${makeParagraph(makeRun('รูปภาพ Test speed ผ่าน WiFi', { bold: true, sizePt: 14.5 }), { align: 'center', spacingBefore: 60, spacingAfter: 20 })}
              ${wifiXml}
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
  });

  // ==========================================================================
  // PART 2 (Last 2 Pages): สำเนาเอกสาร "แบบส่งมอบงาน" ประจำ Site (1 ใบใส่ข้อมูลได้ถึง 4 วงจร)
  // - หน้า 1/2: หมายเลข S/O วงจรที่ 1, 2, 3
  // - หน้า 2/2: หมายเลข S/O วงจรที่ 4 + หมายเหตุ + ลงนามรับรองและประทับตรา
  // ==========================================================================
  let handoverP1Src = '';
  let handoverP2Src = '';
  for (const sc of siteList) {
    const rInfo = sc.router_info || {};
    if (!handoverP1Src && (rInfo.photo_handover_p1 || rInfo.photo_signed_doc)) {
      handoverP1Src = rInfo.photo_handover_p1 || rInfo.photo_signed_doc;
    }
    if (!handoverP2Src && rInfo.photo_handover_p2) {
      handoverP2Src = rInfo.photo_handover_p2;
    }
  }

  const buildHandoverCircuitSlotWordXml = (slotNum, sc) => {
    const hasCircuit = Boolean(sc);
    const rt = (hasCircuit && sc.router_info) ? sc.router_info : {};
    const aps = (hasCircuit && Array.isArray(sc.access_points))
      ? sc.access_points.filter(ap => ap && ap.checked !== false)
      : [];
    const soVal = hasCircuit ? (sc.so_number || '........................') : '........................';
    const svcVal = hasCircuit ? (sc.service_no || '........................') : '........................';
    const spdVal = hasCircuit ? (sc.speed_pkg || '1000Mbps/500Mbps') : '........................';
    const hasRouter = hasCircuit && Boolean(rt.serial_no || rt.model);

    const lines = [
      makeParagraph(
        makeRun(`หมายเลข S/O วงจรที่ ${slotNum} `, { bold: true, sizePt: 14 }) +
        makeRun(`  ${soVal}  `, { bold: true, underline: true, sizePt: 14, color: 'B91C1C' }) +
        makeRun(' Service No. ', { bold: true, sizePt: 14 }) +
        makeRun(`  ${svcVal}  `, { bold: true, underline: true, sizePt: 14 }) +
        makeRun(' FTTx ความเร็ว ', { bold: true, sizePt: 14 }) +
        makeRun(`  ${spdVal}  `, { bold: true, underline: true, sizePt: 14 }),
        { spacingBefore: 80, spacingAfter: 20 }
      ),
      makeParagraph(makeRun('อุปกรณ์ที่ติดตั้งประกอบด้วย', { bold: true, sizePt: 13.5 }), { spacingAfter: 20 }),
      makeParagraph(
        makeRun(`[${hasRouter ? '✓' : ' '}] Router `, { bold: true, sizePt: 13.5 }) +
        makeRun(`ยี่ห้อ ${hasRouter ? 'MikroTik' : '............'} รุ่น ${hasRouter ? (rt.model || 'RB3011') : '............'} เลขครุภัณฑ์ ${hasRouter ? (rt.asset_no || '-') : '............'} Serial No. ${hasRouter ? (rt.serial_no || '-') : '..................'}`, { sizePt: 13.5 }),
        { spacingAfter: 10 }
      ),
      makeParagraph(
        makeRun(`     สถานที่ติดตั้ง ห้อง ${hasRouter ? (rt.room || '-') : '........................'} ชั้น ${hasRouter ? (rt.floor || '1') : '......'} อาคาร ${hasRouter ? (rt.building || '1') : '......'}`, { sizePt: 13.5 }),
        { spacingAfter: 20 }
      )
    ];

    const apSlotCount = Math.max(2, aps.length);
    for (let i = 0; i < apSlotCount; i++) {
      const ap = aps[i] || null;
      const hasAp = hasCircuit && Boolean(ap);
      lines.push(
        makeParagraph(
          makeRun(`[${hasAp ? '✓' : ' '}] Access Point ${i + 1} `, { bold: true, sizePt: 13.5 }) +
          makeRun(`ยี่ห้อ ${hasAp ? (ap.brand || 'TOTOLINK') : '............'} รุ่น ${hasAp ? (ap.model || '-') : '............'} เลขครุภัณฑ์ ${hasAp ? (ap.asset_no || '-') : '............'} Serial No. ${hasAp ? (ap.serial_no || '-') : '..................'}`, { sizePt: 13.5 }),
          { spacingAfter: 10 }
        ),
        makeParagraph(
          makeRun(`     สถานที่ติดตั้ง ห้อง ${hasAp ? (ap.room || '-') : '........................'} ชั้น ${hasAp ? (ap.floor || '1') : '......'} อาคาร ${hasAp ? (ap.building || '1') : '......'}`, { sizePt: 13.5 }),
          { spacingAfter: 20 }
        )
      );
    }
    return lines.join('\n');
  };

  // Handover Form Page 1/2
  bodyParts.push(makePageBreak());
  if (handoverP1Src) {
    bodyParts.push(
      registerImage(handoverP1Src, 595, 815, 'สำเนาเอกสาร แบบส่งมอบงานประจำ Site หน้าที่ 1/2')
    );
  } else {
    bodyParts.push(
      makeParagraph(makeRun('บริษัท วัน-ทู-ออล จำกัด', { bold: true, sizePt: 18 }), { align: 'center', spacingAfter: 10 }),
      makeParagraph(makeRun('แบบส่งมอบงาน', { bold: true, sizePt: 16 }), { align: 'center', spacingAfter: 40 }),
      makeParagraph(makeRun('โครงการเช่าใช้บริการวงจรสื่อสัญญาณความเร็วสูง (Internet FTTx) ประจำปีงบประมาณ พ.ศ. 2569', { bold: true, sizePt: 14 }), { spacingAfter: 20 }),
      makeParagraph(makeRun(`สถานที่ติดตั้ง: ${siteName} | ที่อยู่: ${primary.address || `สำนักงานขนส่งจังหวัด${primary.province || ''}`} | พิกัด: ${primary.lat_long || '-'}`, { bold: true, sizePt: 13.5 }), { spacingAfter: 40 }),
      buildHandoverCircuitSlotWordXml(1, siteList[0] || null),
      buildHandoverCircuitSlotWordXml(2, siteList[1] || null),
      buildHandoverCircuitSlotWordXml(3, siteList[2] || null),
      makeParagraph(makeRun('หน้า 1/2', { bold: true, sizePt: 13 }), { align: 'right', spacingBefore: 60, spacingAfter: 0 })
    );
  }

  // Handover Form Page 2/2
  bodyParts.push(makePageBreak());
  if (handoverP2Src) {
    bodyParts.push(
      registerImage(handoverP2Src, 595, 815, 'สำเนาเอกสาร แบบส่งมอบงานประจำ Site หน้าที่ 2/2 (ลงนามและประทับตรา)')
    );
  } else {
    const combinedRemarks = siteList
      .map((sc, idx) => sc.remarks ? `[วงจรที่ ${idx + 1} ${sc.so_number}] ${sc.remarks}` : '')
      .filter(Boolean)
      .join(' / ');
    bodyParts.push(
      makeParagraph(makeRun('1toAll', { bold: true, sizePt: 18, color: 'BE123C' }), { align: 'right', spacingAfter: 20 }),
      buildHandoverCircuitSlotWordXml(4, siteList[3] || null),
      makeParagraph(makeRun(`หมายเหตุ: ${combinedRemarks || '........................................................................................................................'}`, { bold: true, sizePt: 14 }), { spacingBefore: 80, spacingAfter: 60 }),
      makeParagraph(makeRun('จึงเรียนมาเพื่อโปรดตรวจรับมอบงานติดตั้งอุปกรณ์ดังกล่าวข้างต้น', { sizePt: 14 }), { spacingAfter: 60 }),
      makeParagraph(
        makeRun(`ผู้เข้าดำเนินการติดตั้ง: ${primary.inspector_name || '..............................'} (โทร: ${primary.inspector_phone || '....................'} / วันที่: ${primary.inspection_date || '....................'})`, { bold: true, sizePt: 14 }),
        { spacingAfter: 40 }
      ),
      makeParagraph(
        makeRun(`ผู้รับมอบงาน (กรมการขนส่งทางบก): ${primary.receiver_name || '..............................'} (ตำแหน่ง: ${primary.receiver_position || '....................'} / วันที่: ${primary.received_date || '....................'})`, { bold: true, sizePt: 14 }),
        { spacingAfter: 60 }
      ),
      makeParagraph(makeRun('หน้า 2/2', { bold: true, sizePt: 13 }), { align: 'right', spacingBefore: 60, spacingAfter: 0 })
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
