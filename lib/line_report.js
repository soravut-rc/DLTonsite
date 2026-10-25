'use strict';
/**
 * LINE bot — report only.
 * The bot never changes data: all work (check-in, photos, S/N, submit) is done on the web (/tech),
 * review and locking in /admin. The bot answers status questions and points everything else to the web.
 */
const admin = require('./admin');

const STATE_TH = {
  approved: 'อนุมัติแล้ว (ล็อก)',
  pending_review: 'รอผู้ตรวจรับตรวจ',
  rejected: 'ส่งกลับให้ช่างแก้ไข',
  working: 'ช่างกำลังทำงาน',
  todo: 'ยังไม่เริ่ม'
};

const SO_RE = /BINF\d{7}/i;
// Not \b: it does not treat Thai letters as word characters.
const STATUS_RE = /^(?:เช็ครูป|สถานะ|status)(?=\s|$)/i;
const SUMMARY_RE = /^(?:สรุป|ภาพรวม|summary)(?=\s|$)/i;
// Commands the bot used to accept — now answered with a pointer to the web.
const EDIT_RE = /^(?:เช็คอิน|checkin|เช็คเอาท์|เช็คเอาต์|checkout|ส่งงาน|sn\s)/i;

const webLink = (origin, so) => `${origin}/tech${so ? `#/so/${so}` : ''}`;

function helpText(origin) {
  return `🤖 DLT Onsite Bot — รายงานผลอย่างเดียว\n\n• สถานะ BINF3480006 — ดูความคืบหน้าและผลตรวจของ Site นั้น\n• สรุป — ภาพรวมทั้งโครงการ\n\nการทำงานทั้งหมด (เช็คอิน ถ่ายรูป กรอก S/N ส่งงาน) ทำผ่านเว็บ:\n👉 ${webLink(origin)}`;
}

function welcomeText(origin) {
  return `👋 สวัสดีครับ! DLT Onsite Bot\n\nบอทนี้ใช้ดูผลอย่างเดียว ไม่รับงานผ่านแชต:\n• พิมพ์ "สถานะ BINF3480006" ดูความคืบหน้าและผลตรวจ\n• พิมพ์ "สรุป" ดูภาพรวมทั้งโครงการ\n\n📱 ช่างเช็คอิน ถ่ายรูป กรอก S/N และส่งงานผ่านเว็บ:\n👉 ${webLink(origin)}`;
}

function webOnlyText(origin, so) {
  return `ℹ️ บอทรายงานผลอย่างเดียว ไม่รับข้อมูลหน้างานผ่านแชต\nกรุณาเช็คอิน ถ่ายรูป กรอก S/N และส่งงานผ่านเว็บ:\n👉 ${webLink(origin, so)}\n\nพิมพ์ "สถานะ ${so || 'BINF…'}" เพื่อดูความคืบหน้า`;
}

const fmtTime = iso => {
  const t = new Date(iso);
  return iso && !isNaN(t) ? t.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' น.' : '-';
};

function statusText(circuit, h, origin) {
  const list = h.getSiteCircuitsServer(circuit);
  const key = h.getSiteGroupKeyServer(circuit);
  const site = admin.buildSites(h).find(s => s.key === key);
  const lines = [`📋 ${h.extractSiteNameServer(circuit)} (${circuit.province})`];
  if (site) lines.push(`สถานะ: ${STATE_TH[site.state]}${site.locked ? ' 🔒' : ''}`);
  if (circuit.inspector_name) lines.push(`ช่าง: ${circuit.inspector_name}${circuit.inspector_phone ? ` (${circuit.inspector_phone})` : ''}`);
  if (site && site.checkin_at) lines.push(`เข้า Site: ${fmtTime(site.checkin_at)}`);
  if (site && site.submitted_at) lines.push(`ส่งตรวจ: ${fmtTime(site.submitted_at)}`);
  if (site && site.state === 'approved') lines.push(`ผู้ตรวจ: ${site.reviewer || '-'} · ${fmtTime(site.reviewed_at)}`);
  if (site && (site.state === 'rejected' || (site.state === 'approved' && site.review_note))) {
    lines.push(`${site.state === 'rejected' ? '⚠️ สิ่งที่ต้องแก้ไข' : 'หมายเหตุผู้ตรวจ'}: ${site.review_note || '-'}`);
  }
  lines.push('');
  for (const c of list) {
    const comp = h.evaluateCircuitCompleteness(c);
    const chk = admin.circuitChecks(c, comp);
    lines.push(`${list.length > 1 ? `• ${c.so_number}: ` : '• '}รูปหน้างาน ${comp.onsiteUploadedCount}/${comp.onsiteRequiredCount} · ใบส่งมอบ ${comp.handoverUploadedCount}/2${chk.problems.length ? `\n   ข้อสังเกต: ${chk.problems.join(' · ')}` : ' · ✅ ระบบตรวจผ่านครบ'}`);
  }
  lines.push('', `👉 ดูรายละเอียดบนเว็บ: ${webLink(origin, circuit.so_number)}`);
  return lines.join('\n');
}

function summaryText(h, origin) {
  const sites = admin.buildSites(h);
  const count = s => sites.filter(x => x.state === s).length;
  const total = sites.length;
  const approved = count('approved');
  const waiting = sites.filter(x => x.state === 'pending_review');
  const oldest = waiting.map(x => x.submitted_at).filter(Boolean).sort()[0];
  return [
    '📊 ภาพรวมโครงการ DLT Onsite',
    `อนุมัติแล้ว ${approved}/${total} Site (${total ? Math.round((approved / total) * 100) : 0}%)`,
    `• รอตรวจ ${waiting.length}${oldest ? ` (เก่าสุดส่งเมื่อ ${fmtTime(oldest)})` : ''}`,
    `• ส่งกลับรอช่างแก้ไข ${count('rejected')}`,
    `• ช่างกำลังทำ ${count('working')}`,
    `• ยังไม่เริ่ม ${count('todo')}`,
    '',
    `👉 ${origin}/admin`
  ].join('\n');
}

/**
 * @returns {{ text: string, recognized: boolean }} recognized=false means "not addressed to the bot"
 *          (group chats stay quiet in that case).
 */
function replyFor(rawText, h, origin) {
  const txt = String(rawText || '').trim();
  const so = (SO_RE.exec(txt) || [''])[0].toUpperCase();

  if (SUMMARY_RE.test(txt)) return { text: summaryText(h, origin), recognized: true };

  if (STATUS_RE.test(txt)) {
    if (!so) return { text: 'กรุณาระบุรหัสวงจร เช่น "สถานะ BINF3480006"', recognized: true };
    const c = h.circuitsMap.get(so);
    return { text: c ? statusText(c, h, origin) : `❌ ไม่พบรหัสวงจร ${so} ในระบบ`, recognized: true };
  }

  if (EDIT_RE.test(txt)) return { text: webOnlyText(origin, so), recognized: true };

  return { text: helpText(origin), recognized: /^(?:bot|บอท|help|เมนู|\?|คำสั่ง)/i.test(txt) };
}

module.exports = { replyFor, helpText, welcomeText, webOnlyText };
