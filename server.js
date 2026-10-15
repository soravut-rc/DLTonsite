const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { generateCircuitDocx } = require('./lib/docx_generator');
const {
  normalizeSn,
  compareSnValues,
  evaluateCircuitCompleteness,
  applySlotPhotoAndSnToCircuit,
  verifyLineSignature,
  sendLineReply,
  sendLinePush,
  downloadLineMessageImage
} = require('./lib/completeness_and_line');

// Load .env if exists
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const k = trimmed.slice(0, eqIdx).trim();
      const v = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[k]) process.env[k] = v;
    }
  }
}

const PORT = Number(process.env.PORT || 3480);
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const ONSITE_DIR = path.join(__dirname, 'Onsite');
const PUBLIC_DIR = path.join(__dirname, 'public');
const DB_PATH = path.join(DATA_DIR, 'dlt_onsite.sqlite');
const SEED_PATH = path.join(DATA_DIR, 'seed_circuits.json');
const CLOUD_CONFIG_PATH = path.join(DATA_DIR, 'cloud_config.json');
const LINE_CONFIG_PATH = path.join(DATA_DIR, 'line_config.json');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(PUBLIC_DIR, { recursive: true });

// ============================================================================
// LINE Bot Configuration
// ============================================================================
let lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
  channelSecret: process.env.LINE_CHANNEL_SECRET || '',
  botBasicId: process.env.LINE_BOT_BASIC_ID || '@dlt-onsite',
  publicBaseUrl: process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`
};

if (fs.existsSync(LINE_CONFIG_PATH)) {
  try {
    const savedLine = JSON.parse(fs.readFileSync(LINE_CONFIG_PATH, 'utf8'));
    if (savedLine.channelAccessToken) lineConfig.channelAccessToken = savedLine.channelAccessToken;
    if (savedLine.channelSecret) lineConfig.channelSecret = savedLine.channelSecret;
    if (savedLine.botBasicId) lineConfig.botBasicId = savedLine.botBasicId;
    if (savedLine.publicBaseUrl) lineConfig.publicBaseUrl = savedLine.publicBaseUrl;
  } catch (err) {
    console.error('Failed to read line_config.json:', err.message);
  }
}

function isLineConfigured() {
  return Boolean(lineConfig.channelAccessToken && lineConfig.channelSecret);
}

// ============================================================================
// Cloud Configuration (Supabase PostgreSQL + Storage)
// ============================================================================
let cloudConfig = {
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseKey: process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '',
  supabaseBucket: process.env.SUPABASE_BUCKET || 'dlt-onsite-uploads',
  autoSync: true
};

if (fs.existsSync(CLOUD_CONFIG_PATH)) {
  try {
    const saved = JSON.parse(fs.readFileSync(CLOUD_CONFIG_PATH, 'utf8'));
    if (saved.supabaseUrl) cloudConfig.supabaseUrl = saved.supabaseUrl;
    if (saved.supabaseKey) cloudConfig.supabaseKey = saved.supabaseKey;
    if (saved.supabaseBucket) cloudConfig.supabaseBucket = saved.supabaseBucket;
    if (typeof saved.autoSync === 'boolean') cloudConfig.autoSync = saved.autoSync;
  } catch (err) {
    console.error('Failed to read cloud_config.json:', err.message);
  }
}

function isCloudConfigured() {
  return Boolean(cloudConfig.supabaseUrl && cloudConfig.supabaseKey);
}

async function supabaseRequest(endpoint, options = {}) {
  if (!isCloudConfigured()) {
    throw new Error('ยังไม่ได้ตั้งค่า SUPABASE_URL และ SUPABASE_KEY');
  }
  const baseUrl = cloudConfig.supabaseUrl.replace(/\/+$/, '');
  const url = `${baseUrl}${endpoint}`;
  const headers = {
    apikey: cloudConfig.supabaseKey,
    Authorization: `Bearer ${cloudConfig.supabaseKey}`,
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  const res = await fetch(url, {
    ...options,
    headers
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase Error (${res.status}): ${text}`);
  }
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json();
  }
  return res.text();
}

// ============================================================================
// SQLite Local Database Initialization & Seed (334 Circuits)
// ============================================================================
const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS dlt_circuits (
    id TEXT PRIMARY KEY,
    seq INTEGER NOT NULL DEFAULT 0,
    so_number TEXT NOT NULL UNIQUE,
    service_no TEXT,
    region TEXT NOT NULL,
    province TEXT NOT NULL,
    raw_province_folder TEXT,
    branch_name TEXT,
    address TEXT DEFAULT '',
    lat_long TEXT DEFAULT '',
    speed_pkg TEXT DEFAULT '1000Mbps/500Mbps',
    legacy_pdf_path TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    router_info TEXT NOT NULL DEFAULT '{}',
    access_points TEXT NOT NULL DEFAULT '[]',
    remarks TEXT DEFAULT '',
    inspector_name TEXT DEFAULT '',
    inspector_phone TEXT DEFAULT '',
    inspection_date TEXT DEFAULT '',
    inspector_signature TEXT DEFAULT '',
    receiver_name TEXT DEFAULT '',
    receiver_position TEXT DEFAULT '',
    receiver_phone TEXT DEFAULT '',
    received_date TEXT DEFAULT '',
    receiver_signature TEXT DEFAULT '',
    checkin_time TEXT DEFAULT '',
    checkout_time TEXT DEFAULT '',
    admin_status TEXT DEFAULT '',
    admin_name TEXT DEFAULT '',
    admin_comment TEXT DEFAULT '',
    admin_reviewed_at TEXT DEFAULT '',
    line_user_id TEXT DEFAULT '',
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS dlt_inspection_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    circuit_id TEXT NOT NULL,
    action TEXT NOT NULL,
    actor_name TEXT DEFAULT '',
    status_after TEXT DEFAULT '',
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS dlt_onsite_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    circuit_id TEXT NOT NULL,
    so_number TEXT NOT NULL,
    line_user_id TEXT DEFAULT '',
    line_display_name TEXT DEFAULT '',
    tech_name TEXT NOT NULL,
    tech_phone TEXT DEFAULT '',
    checkin_time TEXT NOT NULL,
    checkin_lat_long TEXT DEFAULT '',
    checkout_time TEXT DEFAULT '',
    checkout_lat_long TEXT DEFAULT '',
    checkout_note TEXT DEFAULT '',
    uploaded_photos INTEGER DEFAULT 0,
    required_photos INTEGER DEFAULT 11,
    is_complete_photos INTEGER DEFAULT 0,
    sn_recheck_json TEXT DEFAULT '[]',
    admin_status TEXT DEFAULT 'working',
    admin_name TEXT DEFAULT '',
    admin_comment TEXT DEFAULT '',
    admin_reviewed_at TEXT DEFAULT '',
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS dlt_line_user_states (
    line_user_id TEXT PRIMARY KEY,
    display_name TEXT DEFAULT '',
    tech_name TEXT DEFAULT '',
    tech_phone TEXT DEFAULT '',
    active_so_number TEXT DEFAULT '',
    active_slot_key TEXT DEFAULT 'router_device',
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS dlt_line_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    line_user_id TEXT NOT NULL,
    sender_role TEXT NOT NULL,
    so_number TEXT DEFAULT '',
    message_type TEXT NOT NULL DEFAULT 'text',
    message_text TEXT DEFAULT '',
    media_url TEXT DEFAULT '',
    extra_json TEXT DEFAULT '{}',
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_circuits_region ON dlt_circuits(region);
  CREATE INDEX IF NOT EXISTS idx_circuits_province ON dlt_circuits(province);
  CREATE INDEX IF NOT EXISTS idx_circuits_status ON dlt_circuits(status);
`);

// Safe migration for existing dlt_circuits table
const extraCircuitColumns = [
  ['checkin_time', "TEXT DEFAULT ''"],
  ['checkout_time', "TEXT DEFAULT ''"],
  ['admin_status', "TEXT DEFAULT ''"],
  ['admin_name', "TEXT DEFAULT ''"],
  ['admin_comment', "TEXT DEFAULT ''"],
  ['admin_reviewed_at', "TEXT DEFAULT ''"],
  ['line_user_id', "TEXT DEFAULT ''"]
];
for (const [col, def] of extraCircuitColumns) {
  try {
    db.exec(`ALTER TABLE dlt_circuits ADD COLUMN ${col} ${def}`);
  } catch (_) {}
}

function seedDatabaseIfNeeded() {
  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM dlt_circuits').get();
  if (countRow.cnt === 0 && fs.existsSync(SEED_PATH)) {
    const seeds = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO dlt_circuits (
        id, seq, so_number, service_no, region, province, raw_province_folder,
        branch_name, address, lat_long, speed_pkg, legacy_pdf_path, status,
        router_info, access_points, remarks,
        inspector_name, inspector_phone, inspection_date, inspector_signature,
        receiver_name, receiver_position, receiver_phone, received_date, receiver_signature,
        updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?
      )
    `);
    db.exec('BEGIN TRANSACTION');
    try {
      for (const s of seeds) {
        insertStmt.run(
          s.id,
          s.seq || 0,
          s.so_number,
          s.service_no || '',
          s.region || 'ภาคกลาง',
          s.province || '',
          s.raw_province_folder || '',
          s.branch_name || '',
          s.address || '',
          s.lat_long || '',
          s.speed_pkg || '1000Mbps/500Mbps',
          s.legacy_pdf_path || null,
          s.status || 'pending',
          JSON.stringify(s.router_info || {}),
          JSON.stringify(s.access_points || []),
          s.remarks || '',
          s.inspector_name || '',
          s.inspector_phone || '',
          s.inspection_date || '',
          s.inspector_signature || '',
          s.receiver_name || '',
          s.receiver_position || '',
          s.receiver_phone || '',
          s.received_date || '',
          s.receiver_signature || '',
          s.updated_at || null
        );
      }
      db.exec('COMMIT');
      console.log(`Seeded ${seeds.length} circuits into SQLite database.`);
    } catch (err) {
      db.exec('ROLLBACK');
      console.error('Seed error:', err);
    }
  }
}

seedDatabaseIfNeeded();

function deserializeCircuit(row) {
  if (!row) return null;
  let router_info = {};
  let access_points = [];
  try {
    router_info = typeof row.router_info === 'string' ? JSON.parse(row.router_info) : (row.router_info || {});
  } catch (_) {}
  try {
    access_points = typeof row.access_points === 'string' ? JSON.parse(row.access_points) : (row.access_points || []);
  } catch (_) {}
  return {
    ...row,
    router_info,
    access_points
  };
}

function saveBase64PhotoToDisk(circuitId, slot, dataUrl) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error('รูปแบบไฟล์รูปภาพไม่ถูกต้อง');
  const mimeType = match[1];
  const base64Data = match[2];
  const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
  const safeCircuit = circuitId.replace(/[^a-zA-Z0-9_-]/g, '');
  const safeSlot = slot.replace(/[^a-zA-Z0-9_-]/g, '');
  const fileName = `${safeSlot}_${Date.now()}.${ext}`;
  const circuitDir = path.join(UPLOADS_DIR, safeCircuit);
  fs.mkdirSync(circuitDir, { recursive: true });
  const filePath = path.join(circuitDir, fileName);
  const buffer = Buffer.from(base64Data, 'base64');
  fs.writeFileSync(filePath, buffer);
  return {
    url: `/uploads/${safeCircuit}/${fileName}`,
    buffer,
    mimeType,
    safeCircuit,
    fileName
  };
}

// Push a single circuit to Supabase Cloud in background if configured
async function syncCircuitToCloud(circuitObj) {
  if (!isCloudConfigured() || !cloudConfig.autoSync) return { synced: false };
  try {
    await supabaseRequest('/rest/v1/dlt_circuits?on_conflict=id', {
      method: 'POST',
      headers: {
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify([circuitObj])
    });
    return { synced: true };
  } catch (firstErr) {
    try {
      // Fallback for Supabase tables created before check-in/admin columns were added
      const cleanPayload = { ...circuitObj };
      delete cleanPayload.checkin_time;
      delete cleanPayload.checkout_time;
      delete cleanPayload.admin_status;
      delete cleanPayload.admin_name;
      delete cleanPayload.admin_comment;
      delete cleanPayload.admin_reviewed_at;
      delete cleanPayload.line_user_id;
      await supabaseRequest('/rest/v1/dlt_circuits?on_conflict=id', {
        method: 'POST',
        headers: {
          Prefer: 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify([cleanPayload])
      });
      return { synced: true, fallbackLegacySchema: true };
    } catch (err) {
      console.warn('Cloud auto-sync warning:', err.message);
      return { synced: false, error: err.message };
    }
  }
}

// ============================================================================
// HTTP Helpers
// ============================================================================
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Line-Signature'
  });
  res.end(JSON.stringify(data));
}

function readRawBuffer(req, maxBytes = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req, maxBytes = 25 * 1024 * 1024) {
  const buf = await readRawBuffer(req, maxBytes);
  const raw = buf.toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function serveStaticFile(res, filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendJson(res, 404, { error: 'File not found' });
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': stat.size,
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': ext === '.pdf' ? 'public, max-age=3600' : 'no-cache'
  });
  fs.createReadStream(filePath).pipe(res);
}

// ============================================================================
// Core Business Logic: Check-in / Check-out / Admin Review / LINE Bot Handler
// ============================================================================
function performCheckin(circuit, { techName, techPhone, latLong, lineUserId, lineDisplayName }) {
  const now = new Date().toISOString();
  const cleanTech = (techName || circuit.inspector_name || 'ช่างหน้างาน').trim();
  const cleanPhone = (techPhone || circuit.inspector_phone || '').trim();
  const cleanLatLong = (latLong || circuit.lat_long || '').trim();
  const todayThai = (() => {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear() + 543}`;
  })();

  db.prepare(`
    UPDATE dlt_circuits SET
      status = 'in_progress',
      inspector_name = ?,
      inspector_phone = ?,
      inspection_date = ?,
      lat_long = ?,
      checkin_time = ?,
      checkout_time = '',
      admin_status = 'working',
      line_user_id = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    cleanTech,
    cleanPhone,
    circuit.inspection_date || todayThai,
    cleanLatLong,
    now,
    lineUserId || circuit.line_user_id || '',
    now,
    circuit.id
  );

  const comp = evaluateCircuitCompleteness(circuit);

  db.prepare(`
    INSERT INTO dlt_onsite_sessions (
      circuit_id, so_number, line_user_id, line_display_name,
      tech_name, tech_phone, checkin_time, checkin_lat_long,
      uploaded_photos, required_photos, is_complete_photos, sn_recheck_json,
      admin_status, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'working', ?)
  `).run(
    circuit.id,
    circuit.so_number,
    lineUserId || '',
    lineDisplayName || cleanTech,
    cleanTech,
    cleanPhone,
    now,
    cleanLatLong,
    comp.uploadedPhotos,
    comp.requiredPhotos,
    comp.isPhotoComplete ? 1 : 0,
    JSON.stringify(comp.snRecheckItems),
    now
  );

  db.prepare(`
    INSERT INTO dlt_inspection_logs (circuit_id, action, actor_name, status_after, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    circuit.id,
    '📍 Check-in เข้าหน้างาน (Onsite)',
    cleanTech,
    'in_progress',
    `เข้า Site เวลา ${new Date(now).toLocaleString('th-TH')} ${cleanPhone ? `โทร ${cleanPhone}` : ''}`,
    now
  );

  const updatedRow = db.prepare('SELECT * FROM dlt_circuits WHERE id = ?').get(circuit.id);
  return deserializeCircuit(updatedRow);
}

function performCheckout(circuit, { note, latLong, force = false }) {
  const comp = evaluateCircuitCompleteness(circuit);
  if (!force && (!comp.isPhotoComplete || comp.hasMissingSn)) {
    return {
      ok: false,
      completeness: comp,
      error: `ยังไม่สามารถ Check-out ได้: รูปภาพ ${comp.uploadedPhotos}/${comp.requiredPhotos} รูป${comp.hasMissingSn ? ' และยังระบุ S/N อุปกรณ์ไม่ครบ' : ''}`
    };
  }

  const now = new Date().toISOString();
  const checkinTime = circuit.checkin_time || now;
  const remarksMerged = note
    ? (circuit.remarks ? `${circuit.remarks} | ${note}` : note)
    : (circuit.remarks || '');

  db.prepare(`
    UPDATE dlt_circuits SET
      status = 'completed',
      checkin_time = ?,
      checkout_time = ?,
      admin_status = 'pending_review',
      remarks = ?,
      updated_at = ?
    WHERE id = ?
  `).run(checkinTime, now, remarksMerged, now, circuit.id);

  // Update latest session for this circuit
  const latestSess = db.prepare(`
    SELECT id FROM dlt_onsite_sessions WHERE circuit_id = ? ORDER BY id DESC LIMIT 1
  `).get(circuit.id);

  if (latestSess) {
    db.prepare(`
      UPDATE dlt_onsite_sessions SET
        checkout_time = ?,
        checkout_lat_long = ?,
        checkout_note = ?,
        uploaded_photos = ?,
        required_photos = ?,
        is_complete_photos = ?,
        sn_recheck_json = ?,
        admin_status = 'pending_review',
        updated_at = ?
      WHERE id = ?
    `).run(
      now,
      latLong || circuit.lat_long || '',
      note || '',
      comp.uploadedPhotos,
      comp.requiredPhotos,
      comp.isPhotoComplete ? 1 : 0,
      JSON.stringify(comp.snRecheckItems),
      now,
      latestSess.id
    );
  }

  db.prepare(`
    INSERT INTO dlt_inspection_logs (circuit_id, action, actor_name, status_after, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    circuit.id,
    '🏁 Check-out ส่งงาน (รอ Admin ตรวจสอบ)',
    circuit.inspector_name || 'ช่างหน้างาน',
    'completed',
    `รูปภาพ: ${comp.uploadedPhotos}/${comp.requiredPhotos} รูป | S/N ตรงกับ OCR: ${comp.allSnMatched ? 'ครบทุกตัว' : 'รอ Admin ตรวจซ้ำ'}`,
    now
  );

  const updatedRow = db.prepare('SELECT * FROM dlt_circuits WHERE id = ?').get(circuit.id);
  const updatedCircuit = deserializeCircuit(updatedRow);
  return {
    ok: true,
    circuit: updatedCircuit,
    completeness: evaluateCircuitCompleteness(updatedCircuit)
  };
}

// ============================================================================
// Main HTTP Server & API Routes
// ============================================================================
const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Line-Signature'
      });
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(parsedUrl.pathname);

    // ------------------------------------------------------------------------
    // 1. GET /api/stats — Overall & Regional/Provincial + Admin QA Statistics
    // ------------------------------------------------------------------------
    if (req.method === 'GET' && pathname === '/api/stats') {
      const rows = db.prepare('SELECT * FROM dlt_circuits ORDER BY seq ASC').all().map(deserializeCircuit);
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
        if (comp.hasSnMismatch) adminCounts.sn_mismatch++;
        if ((r.status === 'in_progress' || r.status === 'completed' || r.checkin_time) && !comp.isPhotoComplete) {
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

      const recentLogs = db.prepare(`
        SELECT * FROM dlt_inspection_logs ORDER BY id DESC LIMIT 20
      `).all();

      sendJson(res, 200, {
        total,
        withLegacyPdf,
        statusCounts,
        adminCounts,
        byRegion,
        provinces: Object.values(byProvince).sort((a, b) => a.province.localeCompare(b.province, 'th')),
        routerModels,
        apBrands,
        totalApCount,
        cloudConfigured: isCloudConfigured(),
        lineConfigured: isLineConfigured(),
        supabaseUrl: cloudConfig.supabaseUrl ? cloudConfig.supabaseUrl.replace(/\/+$/, '') : '',
        recentLogs
      });
      return;
    }

    // ------------------------------------------------------------------------
    // 2. GET /api/circuits — List & Filter Circuits (with Photo/S/N Completeness)
    // ------------------------------------------------------------------------
    if (req.method === 'GET' && pathname === '/api/circuits') {
      const region = parsedUrl.searchParams.get('region') || '';
      const province = parsedUrl.searchParams.get('province') || '';
      const status = parsedUrl.searchParams.get('status') || '';
      const search = (parsedUrl.searchParams.get('search') || '').trim().toLowerCase();

      let rows = db.prepare(`
        SELECT
          id, seq, so_number, service_no, region, province, raw_province_folder,
          branch_name, address, lat_long, speed_pkg, legacy_pdf_path, status,
          router_info, access_points, remarks,
          inspector_name, inspector_phone, inspection_date,
          receiver_name, receiver_position, receiver_phone, received_date,
          checkin_time, checkout_time, admin_status, admin_name, admin_comment, admin_reviewed_at, line_user_id,
          updated_at
        FROM dlt_circuits
        ORDER BY seq ASC
      `).all().map(deserializeCircuit);

      if (region) rows = rows.filter(r => r.region === region);
      if (province) rows = rows.filter(r => r.province === province);
      if (status) rows = rows.filter(r => r.status === status);
      if (search) {
        rows = rows.filter(r => {
          const routerSn = `${r.router_info?.serial_no || ''} ${r.router_info?.ocr_serial_no || ''}`;
          const apSns = (r.access_points || []).map(a => `${a.serial_no || ''} ${a.ocr_serial_no || ''} ${a.room || ''}`).join(' ');
          const hay = `${r.so_number} ${r.service_no} ${r.region} ${r.province} ${r.branch_name} ${r.address} ${r.inspector_name} ${routerSn} ${apSns}`.toLowerCase();
          return hay.includes(search);
        });
      }

      const compact = rows.map(r => {
        const comp = evaluateCircuitCompleteness(r);
        return {
          id: r.id,
          seq: r.seq,
          so_number: r.so_number,
          service_no: r.service_no,
          region: r.region,
          province: r.province,
          branch_name: r.branch_name,
          address: r.address,
          lat_long: r.lat_long,
          speed_pkg: r.speed_pkg,
          legacy_pdf_path: r.legacy_pdf_path,
          status: r.status,
          checkin_time: r.checkin_time || '',
          checkout_time: r.checkout_time || '',
          admin_status: r.admin_status || '',
          admin_name: r.admin_name || '',
          admin_comment: r.admin_comment || '',
          admin_reviewed_at: r.admin_reviewed_at || '',
          router_summary: {
            model: r.router_info?.model || 'RB3011',
            serial_no: r.router_info?.serial_no || '',
            ocr_serial_no: r.router_info?.ocr_serial_no || '',
            room: r.router_info?.room || '',
            floor: r.router_info?.floor || '',
            building: r.router_info?.building || '',
            speed_lan2_dl: r.router_info?.speed_lan2_dl || '',
            speed_lan2_ul: r.router_info?.speed_lan2_ul || ''
          },
          ap_summary: (r.access_points || []).map(ap => ({
            ap_no: ap.ap_no,
            brand: ap.brand,
            model: ap.model,
            serial_no: ap.serial_no,
            ocr_serial_no: ap.ocr_serial_no || '',
            room: ap.room
          })),
          photo_count: comp.uploadedPhotos,
          required_photo_count: comp.requiredPhotos,
          is_photo_complete: comp.isPhotoComplete,
          has_sn_mismatch: comp.hasSnMismatch,
          has_missing_sn: comp.hasMissingSn,
          sn_recheck_items: comp.snRecheckItems,
          missing_photo_labels: comp.missingPhotoLabels,
          duration_text: comp.durationText,
          inspector_name: r.inspector_name,
          inspector_phone: r.inspector_phone,
          inspection_date: r.inspection_date,
          receiver_name: r.receiver_name,
          updated_at: r.updated_at
        };
      });

      sendJson(res, 200, { circuits: compact });
      return;
    }

    // ------------------------------------------------------------------------
    // 2.5 GET /api/circuits/:id/report.docx — Native MS Word (.docx) Report (Req 6)
    // ------------------------------------------------------------------------
    if (req.method === 'GET' && /^\/api\/circuits\/[^/]+\/report\.docx$/i.test(pathname)) {
      const parts = pathname.split('/');
      const id = parts[3];
      const row = db.prepare('SELECT * FROM dlt_circuits WHERE id = ? OR so_number = ?').get(id, id);
      if (!row) {
        sendJson(res, 404, { error: 'ไม่พบข้อมูลวงจร ' + id });
        return;
      }
      const circuit = deserializeCircuit(row);
      const comp = evaluateCircuitCompleteness(circuit);
      const docxBuffer = generateCircuitDocx(circuit, UPLOADS_DIR, comp);
      const safeFileName = `DLT_Handover_Report_${circuit.so_number}.docx`;

      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Length': docxBuffer.length,
        'Content-Disposition': `attachment; filename="${safeFileName}"; filename*=UTF-8''${encodeURIComponent(`รายงานส่งมอบงาน_${circuit.so_number}_${circuit.province}.docx`)}`
      });
      res.end(docxBuffer);
      return;
    }

    // ------------------------------------------------------------------------
    // 2.6 POST /api/circuits/:id/checkin — Onsite Check-in (Req 1)
    // ------------------------------------------------------------------------
    if (req.method === 'POST' && /^\/api\/circuits\/[^/]+\/checkin$/i.test(pathname)) {
      const id = pathname.split('/')[3];
      const row = db.prepare('SELECT * FROM dlt_circuits WHERE id = ? OR so_number = ?').get(id, id);
      if (!row) {
        sendJson(res, 404, { error: 'ไม่พบข้อมูลวงจร ' + id });
        return;
      }
      const body = await readJsonBody(req);
      if (!(body.tech_name || '').trim() && !row.inspector_name) {
        sendJson(res, 400, { error: 'กรุณาระบุชื่อช่างผู้เข้าดำเนินการก่อน Check-in' });
        return;
      }
      const updated = performCheckin(deserializeCircuit(row), {
        techName: body.tech_name,
        techPhone: body.tech_phone,
        latLong: body.lat_long,
        lineUserId: body.line_user_id,
        lineDisplayName: body.line_display_name
      });
      sendJson(res, 200, {
        ok: true,
        circuit: updated,
        completeness: evaluateCircuitCompleteness(updated)
      });
      return;
    }

    // ------------------------------------------------------------------------
    // 2.7 POST /api/circuits/:id/checkout — Onsite Check-out (Req 3 & 4)
    // ------------------------------------------------------------------------
    if (req.method === 'POST' && /^\/api\/circuits\/[^/]+\/checkout$/i.test(pathname)) {
      const id = pathname.split('/')[3];
      const row = db.prepare('SELECT * FROM dlt_circuits WHERE id = ? OR so_number = ?').get(id, id);
      if (!row) {
        sendJson(res, 404, { error: 'ไม่พบข้อมูลวงจร ' + id });
        return;
      }
      const body = await readJsonBody(req);
      const result = performCheckout(deserializeCircuit(row), {
        note: body.note,
        latLong: body.lat_long,
        force: Boolean(body.force)
      });
      if (!result.ok) {
        sendJson(res, 400, result);
        return;
      }
      sendJson(res, 200, result);
      return;
    }

    // ------------------------------------------------------------------------
    // 2.8 POST /api/circuits/:id/admin-review — Admin Verification (Req 5)
    // ------------------------------------------------------------------------
    if (req.method === 'POST' && /^\/api\/circuits\/[^/]+\/admin-review$/i.test(pathname)) {
      const id = pathname.split('/')[3];
      const row = db.prepare('SELECT * FROM dlt_circuits WHERE id = ? OR so_number = ?').get(id, id);
      if (!row) {
        sendJson(res, 404, { error: 'ไม่พบข้อมูลวงจร ' + id });
        return;
      }
      const body = await readJsonBody(req);
      const decision = body.decision === 'rejected' ? 'rejected' : 'approved';
      const adminName = (body.admin_name || 'Admin ผู้ตรวจงาน').trim();
      const adminComment = (body.admin_comment || '').trim();
      const now = new Date().toISOString();
      const nextStatus = decision === 'approved' ? 'completed' : 'issue';

      db.prepare(`
        UPDATE dlt_circuits SET
          status = ?,
          admin_status = ?,
          admin_name = ?,
          admin_comment = ?,
          admin_reviewed_at = ?,
          updated_at = ?
        WHERE id = ?
      `).run(nextStatus, decision, adminName, adminComment, now, now, row.id);

      db.prepare(`
        UPDATE dlt_onsite_sessions SET
          admin_status = ?,
          admin_name = ?,
          admin_comment = ?,
          admin_reviewed_at = ?,
          updated_at = ?
        WHERE circuit_id = ?
      `).run(decision, adminName, adminComment, now, now, row.id);

      const actionTitle = decision === 'approved'
        ? '✅ Admin ตรวจสอบและอนุมัติงานครบถ้วน'
        : '❌ Admin ตีกลับให้ช่างแก้ไขเพิ่มเติม';

      db.prepare(`
        INSERT INTO dlt_inspection_logs (circuit_id, action, actor_name, status_after, note, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        row.id,
        actionTitle,
        adminName,
        nextStatus,
        adminComment || (decision === 'approved' ? 'ข้อมูลรูปภาพและ S/N ครบถ้วนถูกต้อง' : 'กรุณาตรวจสอบและแก้ไขตามหมายเหตุ'),
        now
      );

      // Push notification to technician's LINE chat & Simulator log
      const notifyMsg = decision === 'approved'
        ? `✅ [Admin อนุมัติงานแล้ว]\nวงจร: ${row.so_number} (${row.branch_name || row.province})\nผู้ตรวจ: ${adminName}\nหมายเหตุ: ${adminComment || 'ข้อมูลรูปภาพและ S/N ครบถ้วนสมบูรณ์'}\n📄 ดาวน์โหลดรายงาน Word: /api/circuits/${row.so_number}/report.docx`
        : `⚠️ [Admin แจ้งให้แก้ไขงาน]\nวงจร: ${row.so_number} (${row.branch_name || row.province})\nผู้ตรวจ: ${adminName}\nสิ่งที่ต้องแก้ไข: ${adminComment || 'กรุณาตรวจสอบรูปภาพและรหัส S/N อีกครั้ง'}`;

      const targetLineUser = row.line_user_id || 'sim_tech_01';
      db.prepare(`
        INSERT INTO dlt_line_messages (line_user_id, sender_role, so_number, message_type, message_text, created_at)
        VALUES (?, 'bot', ?, 'text', ?, ?)
      `).run(targetLineUser, row.so_number, notifyMsg, now);

      if (row.line_user_id && isLineConfigured()) {
        await sendLinePush(row.line_user_id, [{ type: 'text', text: notifyMsg }], lineConfig.channelAccessToken);
      }

      const updatedRow = db.prepare('SELECT * FROM dlt_circuits WHERE id = ?').get(row.id);
      const updatedCircuit = deserializeCircuit(updatedRow);
      sendJson(res, 200, {
        ok: true,
        circuit: updatedCircuit,
        completeness: evaluateCircuitCompleteness(updatedCircuit)
      });
      return;
    }

    // ------------------------------------------------------------------------
    // 3. GET /api/circuits/:id — Get Single Circuit Full Details + Completeness
    // ------------------------------------------------------------------------
    if (req.method === 'GET' && pathname.startsWith('/api/circuits/')) {
      const id = pathname.replace('/api/circuits/', '').trim();
      const row = db.prepare('SELECT * FROM dlt_circuits WHERE id = ? OR so_number = ?').get(id, id);
      if (!row) {
        sendJson(res, 404, { error: 'ไม่พบข้อมูลวงจร ' + id });
        return;
      }
      const circuit = deserializeCircuit(row);
      const completeness = evaluateCircuitCompleteness(circuit);
      const logs = db.prepare('SELECT * FROM dlt_inspection_logs WHERE circuit_id = ? ORDER BY id DESC LIMIT 25').all(row.id);
      const sessions = db.prepare('SELECT * FROM dlt_onsite_sessions WHERE circuit_id = ? ORDER BY id DESC LIMIT 10').all(row.id);
      sendJson(res, 200, { circuit, completeness, logs, sessions });
      return;
    }

    // ------------------------------------------------------------------------
    // 4. PUT /api/circuits/:id — Update Circuit Inspection Data
    // ------------------------------------------------------------------------
    if (req.method === 'PUT' && pathname.startsWith('/api/circuits/')) {
      const id = pathname.replace('/api/circuits/', '').trim();
      const existing = db.prepare('SELECT * FROM dlt_circuits WHERE id = ? OR so_number = ?').get(id, id);
      if (!existing) {
        sendJson(res, 404, { error: 'ไม่พบข้อมูลวงจร ' + id });
        return;
      }

      const body = await readJsonBody(req);
      const now = new Date().toISOString();
      const updated = {
        id: existing.id,
        seq: body.seq ?? existing.seq,
        so_number: body.so_number || existing.so_number,
        service_no: body.service_no ?? existing.service_no,
        region: body.region || existing.region,
        province: body.province || existing.province,
        raw_province_folder: body.raw_province_folder ?? existing.raw_province_folder,
        branch_name: body.branch_name ?? existing.branch_name,
        address: body.address ?? existing.address,
        lat_long: body.lat_long ?? existing.lat_long,
        speed_pkg: body.speed_pkg ?? existing.speed_pkg,
        legacy_pdf_path: body.legacy_pdf_path !== undefined ? body.legacy_pdf_path : existing.legacy_pdf_path,
        status: body.status || existing.status,
        router_info: body.router_info !== undefined ? body.router_info : JSON.parse(existing.router_info || '{}'),
        access_points: body.access_points !== undefined ? body.access_points : JSON.parse(existing.access_points || '[]'),
        remarks: body.remarks ?? existing.remarks,
        inspector_name: body.inspector_name ?? existing.inspector_name,
        inspector_phone: body.inspector_phone ?? existing.inspector_phone,
        inspection_date: body.inspection_date ?? existing.inspection_date,
        inspector_signature: body.inspector_signature !== undefined ? body.inspector_signature : existing.inspector_signature,
        receiver_name: body.receiver_name ?? existing.receiver_name,
        receiver_position: body.receiver_position ?? existing.receiver_position,
        receiver_phone: body.receiver_phone ?? existing.receiver_phone,
        received_date: body.received_date ?? existing.received_date,
        receiver_signature: body.receiver_signature !== undefined ? body.receiver_signature : existing.receiver_signature,
        checkin_time: body.checkin_time !== undefined ? body.checkin_time : (existing.checkin_time || ''),
        checkout_time: body.checkout_time !== undefined ? body.checkout_time : (existing.checkout_time || ''),
        admin_status: body.admin_status !== undefined ? body.admin_status : (existing.admin_status || ''),
        admin_name: body.admin_name !== undefined ? body.admin_name : (existing.admin_name || ''),
        admin_comment: body.admin_comment !== undefined ? body.admin_comment : (existing.admin_comment || ''),
        admin_reviewed_at: body.admin_reviewed_at !== undefined ? body.admin_reviewed_at : (existing.admin_reviewed_at || ''),
        line_user_id: body.line_user_id !== undefined ? body.line_user_id : (existing.line_user_id || ''),
        updated_at: now
      };

      db.prepare(`
        UPDATE dlt_circuits SET
          so_number = ?, service_no = ?, region = ?, province = ?,
          branch_name = ?, address = ?, lat_long = ?, speed_pkg = ?,
          legacy_pdf_path = ?, status = ?, router_info = ?, access_points = ?,
          remarks = ?, inspector_name = ?, inspector_phone = ?, inspection_date = ?,
          inspector_signature = ?, receiver_name = ?, receiver_position = ?,
          receiver_phone = ?, received_date = ?, receiver_signature = ?,
          checkin_time = ?, checkout_time = ?, admin_status = ?, admin_name = ?,
          admin_comment = ?, admin_reviewed_at = ?, line_user_id = ?, updated_at = ?
        WHERE id = ?
      `).run(
        updated.so_number,
        updated.service_no,
        updated.region,
        updated.province,
        updated.branch_name,
        updated.address,
        updated.lat_long,
        updated.speed_pkg,
        updated.legacy_pdf_path,
        updated.status,
        JSON.stringify(updated.router_info),
        JSON.stringify(updated.access_points),
        updated.remarks,
        updated.inspector_name,
        updated.inspector_phone,
        updated.inspection_date,
        updated.inspector_signature,
        updated.receiver_name,
        updated.receiver_position,
        updated.receiver_phone,
        updated.received_date,
        updated.receiver_signature,
        updated.checkin_time,
        updated.checkout_time,
        updated.admin_status,
        updated.admin_name,
        updated.admin_comment,
        updated.admin_reviewed_at,
        updated.line_user_id,
        updated.updated_at,
        updated.id
      );

      const comp = evaluateCircuitCompleteness(updated);
      db.prepare(`
        INSERT INTO dlt_inspection_logs (circuit_id, action, actor_name, status_after, note, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        updated.id,
        'บันทึกผลการตรวจรับงาน',
        updated.inspector_name || 'ช่างหน้างาน',
        updated.status,
        `Router: ${updated.router_info?.model || '-'} (ช่างกรอก: ${updated.router_info?.serial_no || '-'} / OCR: ${updated.router_info?.ocr_serial_no || '-'}) | รูปภาพ: ${comp.uploadedPhotos}/${comp.requiredPhotos} รูป`,
        now
      );

      const cloudSync = await syncCircuitToCloud(updated);
      sendJson(res, 200, { ok: true, circuit: updated, completeness: comp, cloudSync });
      return;
    }

    // ------------------------------------------------------------------------
    // 5. POST /api/circuits — Add New Circuit
    // ------------------------------------------------------------------------
    if (req.method === 'POST' && pathname === '/api/circuits') {
      const body = await readJsonBody(req);
      const so = (body.so_number || '').trim().toUpperCase();
      if (!so) {
        sendJson(res, 400, { error: 'กรุณาระบุหมายเลขวงจร S/O (เช่น BINF348xxxx)' });
        return;
      }
      const maxSeqRow = db.prepare('SELECT MAX(seq) as maxSeq FROM dlt_circuits').get();
      const nextSeq = (maxSeqRow?.maxSeq || 334) + 1;
      const province = (body.province || 'กรุงเทพมหานคร').trim();
      const now = new Date().toISOString();

      const newCircuit = {
        id: so,
        seq: body.seq || nextSeq,
        so_number: so,
        service_no: (body.service_no || '').trim().toUpperCase(),
        region: body.region || 'ภาคกลาง',
        province,
        raw_province_folder: body.raw_province_folder || province,
        branch_name: body.branch_name || `สำนักงานขนส่งจังหวัด${province}`,
        address: body.address || '',
        lat_long: body.lat_long || '',
        speed_pkg: body.speed_pkg || '1000Mbps/500Mbps',
        legacy_pdf_path: body.legacy_pdf_path || null,
        status: body.status || 'pending',
        router_info: body.router_info || {
          checked: true,
          model: 'RB3011',
          serial_no: '',
          asset_no: `สขจ.${province}`,
          room: 'วิชาการ',
          floor: '1',
          building: '1',
          speed_lan2_dl: '',
          speed_lan2_ul: '',
          speed_lan3_dl: '',
          speed_lan3_ul: '',
          photo_device: '',
          photo_lan2: '',
          photo_lan3: ''
        },
        access_points: body.access_points || [
          {
            ap_no: 1,
            checked: true,
            brand: 'TOTOLINK',
            model: 'A3002RU',
            serial_no: '',
            asset_no: `สขจ.${province}/GPS`,
            room: 'ห้อง GPS',
            floor: '1',
            building: '1',
            speed_wifi_dl: '',
            speed_wifi_ul: '',
            speed_lan_dl: '',
            speed_lan_ul: '',
            photo_device: '',
            photo_wifi: '',
            photo_lan: ''
          },
          {
            ap_no: 2,
            checked: true,
            brand: 'TOTOLINK',
            model: 'A3002RU',
            serial_no: '',
            asset_no: `สขจ.${province}/GECC`,
            room: 'ห้อง GECC',
            floor: '1',
            building: '1',
            speed_wifi_dl: '',
            speed_wifi_ul: '',
            speed_lan_dl: '',
            speed_lan_ul: '',
            photo_device: '',
            photo_wifi: '',
            photo_lan: ''
          }
        ],
        remarks: body.remarks || '',
        inspector_name: '',
        inspector_phone: '',
        inspection_date: '',
        inspector_signature: '',
        receiver_name: '',
        receiver_position: '',
        receiver_phone: '',
        received_date: '',
        receiver_signature: '',
        updated_at: now
      };

      db.prepare(`
        INSERT OR REPLACE INTO dlt_circuits (
          id, seq, so_number, service_no, region, province, raw_province_folder,
          branch_name, address, lat_long, speed_pkg, legacy_pdf_path, status,
          router_info, access_points, remarks,
          inspector_name, inspector_phone, inspection_date, inspector_signature,
          receiver_name, receiver_position, receiver_phone, received_date, receiver_signature,
          updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?
        )
      `).run(
        newCircuit.id,
        newCircuit.seq,
        newCircuit.so_number,
        newCircuit.service_no,
        newCircuit.region,
        newCircuit.province,
        newCircuit.raw_province_folder,
        newCircuit.branch_name,
        newCircuit.address,
        newCircuit.lat_long,
        newCircuit.speed_pkg,
        newCircuit.legacy_pdf_path,
        newCircuit.status,
        JSON.stringify(newCircuit.router_info),
        JSON.stringify(newCircuit.access_points),
        newCircuit.remarks,
        newCircuit.inspector_name,
        newCircuit.inspector_phone,
        newCircuit.inspection_date,
        newCircuit.inspector_signature,
        newCircuit.receiver_name,
        newCircuit.receiver_position,
        newCircuit.receiver_phone,
        newCircuit.received_date,
        newCircuit.receiver_signature,
        newCircuit.updated_at
      );

      await syncCircuitToCloud(newCircuit);
      sendJson(res, 201, { ok: true, circuit: newCircuit });
      return;
    }

    // ------------------------------------------------------------------------
    // 6. POST /api/upload — Save Photo Locally + Optional Supabase Storage
    // ------------------------------------------------------------------------
    if (req.method === 'POST' && pathname === '/api/upload') {
      const body = await readJsonBody(req);
      const { circuitId, slot, dataUrl } = body;
      if (!circuitId || !slot || !dataUrl) {
        sendJson(res, 400, { error: 'ข้อมูลรูปภาพไม่ครบถ้วน' });
        return;
      }

      const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
      if (!match) {
        sendJson(res, 400, { error: 'รูปแบบไฟล์รูปภาพไม่ถูกต้อง' });
        return;
      }
      const mimeType = match[1];
      const base64Data = match[2];
      const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
      const safeCircuit = circuitId.replace(/[^a-zA-Z0-9_-]/g, '');
      const safeSlot = slot.replace(/[^a-zA-Z0-9_-]/g, '');
      const fileName = `${safeSlot}_${Date.now()}.${ext}`;
      const circuitDir = path.join(UPLOADS_DIR, safeCircuit);
      fs.mkdirSync(circuitDir, { recursive: true });
      const filePath = path.join(circuitDir, fileName);
      const buffer = Buffer.from(base64Data, 'base64');
      fs.writeFileSync(filePath, buffer);

      let publicUrl = `/uploads/${safeCircuit}/${fileName}`;

      // Also upload to Supabase Storage if configured
      if (isCloudConfigured()) {
        try {
          const baseUrl = cloudConfig.supabaseUrl.replace(/\/+$/, '');
          const objectPath = `${safeCircuit}/${fileName}`;
          const uploadRes = await fetch(`${baseUrl}/storage/v1/object/${cloudConfig.supabaseBucket}/${objectPath}`, {
            method: 'POST',
            headers: {
              apikey: cloudConfig.supabaseKey,
              Authorization: `Bearer ${cloudConfig.supabaseKey}`,
              'Content-Type': mimeType,
              'x-upsert': 'true'
            },
            body: buffer
          });
          if (uploadRes.ok) {
            publicUrl = `${baseUrl}/storage/v1/object/public/${cloudConfig.supabaseBucket}/${objectPath}`;
          }
        } catch (err) {
          console.warn('Supabase storage upload fallback to local:', err.message);
        }
      }

      sendJson(res, 200, { ok: true, url: publicUrl });
      return;
    }

    // ------------------------------------------------------------------------
    // 7. GET /api/export/csv — Export All 334 Circuits to Excel CSV (UTF-8 BOM)
    // ------------------------------------------------------------------------
    if (req.method === 'GET' && pathname === '/api/export/csv') {
      const rows = db.prepare('SELECT * FROM dlt_circuits ORDER BY seq ASC').all().map(deserializeCircuit);
      const headers = [
        'ลำดับ', 'หมายเลข S/O', 'Service No.', 'ภูมิภาค', 'จังหวัด', 'สถานที่ติดตั้ง (สาขา)',
        'ที่อยู่', 'พิกัด (Lat,Long)', 'ความเร็ววงจร', 'สถานะ',
        'Router รุ่น', 'Router Serial No.', 'Router เลขครุภัณฑ์', 'Router ห้อง/ชั้น/อาคาร',
        'Speed LAN2 (DL/UL)', 'Speed LAN3 (DL/UL)',
        'จำนวน AP', 'AP1 ยี่ห้อ/รุ่น', 'AP1 Serial No.', 'AP1 ห้อง', 'AP1 WiFi (DL/UL)', 'AP1 LAN (DL/UL)',
        'AP2 ยี่ห้อ/รุ่น', 'AP2 Serial No.', 'AP2 ห้อง', 'AP2 WiFi (DL/UL)', 'AP2 LAN (DL/UL)',
        'AP3+ เพิ่มเติม', 'ผู้ส่งมอบ (ช่าง)', 'เบอร์โทรช่าง', 'วันที่ดำเนินการ',
        'ผู้รับมอบ (ขนส่ง)', 'ตำแหน่งผู้รับมอบ', 'เบอร์โทรผู้รับมอบ', 'วันที่รับมอบ', 'หมายเหตุ'
      ];

      const esc = val => {
        const str = String(val ?? '').replace(/\r?\n/g, ' ');
        if (str.includes(',') || str.includes('"')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const statusLabel = {
        pending: 'รอดำเนินการ',
        in_progress: 'กำลังดำเนินการ',
        completed: 'ส่งมอบครบถ้วน',
        issue: 'ติดปัญหา/รอแก้ไข'
      };

      const csvLines = [headers.map(esc).join(',')];
      for (const r of rows) {
        const rt = r.router_info || {};
        const aps = r.access_points || [];
        const ap1 = aps[0] || {};
        const ap2 = aps[1] || {};
        const extraAps = aps.slice(2).map(a => `${a.room || 'AP' + a.ap_no}: ${a.brand || ''} ${a.model || ''} (${a.serial_no || '-'})`).join(' | ');

        csvLines.push([
          r.seq,
          r.so_number,
          r.service_no,
          r.region,
          r.province,
          r.branch_name,
          r.address,
          r.lat_long,
          r.speed_pkg,
          statusLabel[r.status] || r.status,
          rt.model === 'OTHER' ? rt.custom_model : (rt.model || ''),
          rt.serial_no || '',
          rt.asset_no || '',
          `${rt.room || ''} ชั้น ${rt.floor || '-'} อาคาร ${rt.building || '-'}`.trim(),
          rt.speed_lan2_dl ? `${rt.speed_lan2_dl}/${rt.speed_lan2_ul}` : '',
          rt.speed_lan3_dl ? `${rt.speed_lan3_dl}/${rt.speed_lan3_ul}` : '',
          aps.length,
          ap1.brand ? `${ap1.brand} ${ap1.model || ''}` : '',
          ap1.serial_no || '',
          ap1.room || '',
          ap1.speed_wifi_dl ? `${ap1.speed_wifi_dl}/${ap1.speed_wifi_ul}` : '',
          ap1.speed_lan_dl ? `${ap1.speed_lan_dl}/${ap1.speed_lan_ul}` : '',
          ap2.brand ? `${ap2.brand} ${ap2.model || ''}` : '',
          ap2.serial_no || '',
          ap2.room || '',
          ap2.speed_wifi_dl ? `${ap2.speed_wifi_dl}/${ap2.speed_wifi_ul}` : '',
          ap2.speed_lan_dl ? `${ap2.speed_lan_dl}/${ap2.speed_lan_ul}` : '',
          extraAps,
          r.inspector_name,
          r.inspector_phone,
          r.inspection_date,
          r.receiver_name,
          r.receiver_position,
          r.receiver_phone,
          r.received_date,
          r.remarks
        ].map(esc).join(','));
      }

      const bomCsv = '\uFEFF' + csvLines.join('\r\n');
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="DLT_Onsite_334_Circuits_Report.csv"'
      });
      res.end(bomCsv);
      return;
    }

    // ------------------------------------------------------------------------
    // 8. Cloud Database Settings & Sync Endpoints (Supabase / PostgreSQL)
    // ------------------------------------------------------------------------
    if (req.method === 'GET' && pathname === '/api/cloud/status') {
      const schemaSql = fs.existsSync(path.join(__dirname, 'supabase', 'schema.sql'))
        ? fs.readFileSync(path.join(__dirname, 'supabase', 'schema.sql'), 'utf8')
        : '';
      sendJson(res, 200, {
        configured: isCloudConfigured(),
        supabaseUrl: cloudConfig.supabaseUrl,
        hasKey: Boolean(cloudConfig.supabaseKey),
        supabaseBucket: cloudConfig.supabaseBucket,
        autoSync: cloudConfig.autoSync,
        schemaSql
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/cloud/config') {
      const body = await readJsonBody(req);
      cloudConfig.supabaseUrl = (body.supabaseUrl || '').trim().replace(/\/+$/, '');
      if (body.supabaseKey !== undefined && body.supabaseKey.trim() !== '') {
        cloudConfig.supabaseKey = body.supabaseKey.trim();
      }
      if (body.supabaseBucket) {
        cloudConfig.supabaseBucket = body.supabaseBucket.trim();
      }
      if (typeof body.autoSync === 'boolean') {
        cloudConfig.autoSync = body.autoSync;
      }
      fs.writeFileSync(CLOUD_CONFIG_PATH, JSON.stringify(cloudConfig, null, 2), 'utf8');

      sendJson(res, 200, {
        ok: true,
        configured: isCloudConfigured(),
        supabaseUrl: cloudConfig.supabaseUrl
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/cloud/sync') {
      if (!isCloudConfigured()) {
        sendJson(res, 400, { error: 'กรุณาตั้งค่า SUPABASE_URL และ SUPABASE_KEY ก่อนทำการซิงค์ข้อมูลขึ้น Cloud' });
        return;
      }
      const body = await readJsonBody(req);
      const direction = body.direction || 'push'; // 'push' | 'pull'

      if (direction === 'pull') {
        const remoteRows = await supabaseRequest('/rest/v1/dlt_circuits?select=*&order=seq.asc', { method: 'GET' });
        if (Array.isArray(remoteRows) && remoteRows.length > 0) {
          const upsertStmt = db.prepare(`
            INSERT OR REPLACE INTO dlt_circuits (
              id, seq, so_number, service_no, region, province, raw_province_folder,
              branch_name, address, lat_long, speed_pkg, legacy_pdf_path, status,
              router_info, access_points, remarks,
              inspector_name, inspector_phone, inspection_date, inspector_signature,
              receiver_name, receiver_position, receiver_phone, received_date, receiver_signature,
              checkin_time, checkout_time, admin_status, admin_name, admin_comment, admin_reviewed_at, line_user_id,
              updated_at
            ) VALUES (
              ?, ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?,
              ?, ?, ?,
              ?, ?, ?, ?,
              ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?, ?,
              ?
            )
          `);
          db.exec('BEGIN TRANSACTION');
          try {
            for (const r of remoteRows) {
              upsertStmt.run(
                r.id, r.seq || 0, r.so_number, r.service_no || '', r.region, r.province, r.raw_province_folder || '',
                r.branch_name || '', r.address || '', r.lat_long || '', r.speed_pkg || '1000Mbps/500Mbps',
                r.legacy_pdf_path || null, r.status || 'pending',
                JSON.stringify(r.router_info || {}), JSON.stringify(r.access_points || []),
                r.remarks || '', r.inspector_name || '', r.inspector_phone || '', r.inspection_date || '',
                r.inspector_signature || '', r.receiver_name || '', r.receiver_position || '',
                r.receiver_phone || '', r.received_date || '', r.receiver_signature || '',
                r.checkin_time || '', r.checkout_time || '', r.admin_status || '',
                r.admin_name || '', r.admin_comment || '', r.admin_reviewed_at || '', r.line_user_id || '',
                r.updated_at || null
              );
            }
            db.exec('COMMIT');
          } catch (err) {
            db.exec('ROLLBACK');
            throw err;
          }
        }
        sendJson(res, 200, { ok: true, direction: 'pull', count: Array.isArray(remoteRows) ? remoteRows.length : 0 });
        return;
      }

      // Default: Push all 334 local circuits to Supabase Cloud in chunks of 50
      const allRows = db.prepare('SELECT * FROM dlt_circuits ORDER BY seq ASC').all().map(deserializeCircuit);
      const chunkSize = 50;
      let pushed = 0;
      for (let i = 0; i < allRows.length; i += chunkSize) {
        const chunk = allRows.slice(i, i + chunkSize);
        await supabaseRequest('/rest/v1/dlt_circuits?on_conflict=id', {
          method: 'POST',
          headers: {
            Prefer: 'resolution=merge-duplicates,return=minimal'
          },
          body: JSON.stringify(chunk)
        });
        pushed += chunk.length;
      }
      sendJson(res, 200, { ok: true, direction: 'push', count: pushed });
      return;
    }

    // ------------------------------------------------------------------------
    // 8.5 GET /api/admin/overview — Admin Verification & QA Queue (Req 5)
    // ------------------------------------------------------------------------
    if (req.method === 'GET' && pathname === '/api/admin/overview') {
      const allRows = db.prepare('SELECT * FROM dlt_circuits ORDER BY updated_at DESC, seq ASC').all().map(deserializeCircuit);
      const items = allRows.map(c => {
        const comp = evaluateCircuitCompleteness(c);
        return {
          id: c.id,
          seq: c.seq,
          so_number: c.so_number,
          service_no: c.service_no,
          region: c.region,
          province: c.province,
          branch_name: c.branch_name,
          status: c.status,
          checkin_time: c.checkin_time || '',
          checkout_time: c.checkout_time || '',
          admin_status: c.admin_status || '',
          admin_name: c.admin_name || '',
          admin_comment: c.admin_comment || '',
          admin_reviewed_at: c.admin_reviewed_at || '',
          inspector_name: c.inspector_name || '',
          inspector_phone: c.inspector_phone || '',
          inspection_date: c.inspection_date || '',
          receiver_name: c.receiver_name || '',
          updated_at: c.updated_at || '',
          completeness: comp
        };
      });

      const sessions = db.prepare('SELECT * FROM dlt_onsite_sessions ORDER BY id DESC LIMIT 50').all();
      const recentMessages = db.prepare('SELECT * FROM dlt_line_messages ORDER BY id DESC LIMIT 40').all();

      sendJson(res, 200, {
        items,
        sessions,
        recentMessages
      });
      return;
    }

    // ------------------------------------------------------------------------
    // 8.6 LINE Bot Configuration, State, Simulator & Webhook (Req 1 - 6)
    // ------------------------------------------------------------------------
    if (req.method === 'GET' && pathname === '/api/line/config') {
      sendJson(res, 200, {
        configured: isLineConfigured(),
        botBasicId: lineConfig.botBasicId,
        publicBaseUrl: lineConfig.publicBaseUrl,
        hasAccessToken: Boolean(lineConfig.channelAccessToken),
        hasChannelSecret: Boolean(lineConfig.channelSecret),
        webhookUrl: `${lineConfig.publicBaseUrl.replace(/\/+$/, '')}/api/line/webhook`
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/line/config') {
      const body = await readJsonBody(req);
      const token = body.channel_access_token !== undefined ? body.channel_access_token : body.channelAccessToken;
      const secret = body.channel_secret !== undefined ? body.channel_secret : body.channelSecret;
      const pubUrl = body.public_base_url !== undefined ? body.public_base_url : body.publicBaseUrl;
      const botId = body.bot_basic_id !== undefined ? body.bot_basic_id : body.botBasicId;

      if (token !== undefined && String(token).trim() !== '') {
        lineConfig.channelAccessToken = String(token).trim();
      }
      if (secret !== undefined && String(secret).trim() !== '') {
        lineConfig.channelSecret = String(secret).trim();
      }
      if (botId !== undefined) {
        lineConfig.botBasicId = String(botId).trim() || '@dlt-onsite';
      }
      if (pubUrl !== undefined && String(pubUrl).trim() !== '') {
        lineConfig.publicBaseUrl = String(pubUrl).trim().replace(/\/+$/, '');
      }
      fs.writeFileSync(LINE_CONFIG_PATH, JSON.stringify(lineConfig, null, 2), 'utf8');
      sendJson(res, 200, {
        ok: true,
        configured: isLineConfigured(),
        botBasicId: lineConfig.botBasicId,
        publicBaseUrl: lineConfig.publicBaseUrl,
        webhookUrl: `${lineConfig.publicBaseUrl.replace(/\/+$/, '')}/api/line/webhook`
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/line/state') {
      const lineUserId = parsedUrl.searchParams.get('userId') || 'sim_tech_01';
      let userState = db.prepare('SELECT * FROM dlt_line_user_states WHERE line_user_id = ?').get(lineUserId);
      if (!userState) {
        const now = new Date().toISOString();
        db.prepare(`
          INSERT INTO dlt_line_user_states (line_user_id, display_name, tech_name, tech_phone, active_so_number, active_slot_key, updated_at)
          VALUES (?, 'ช่างหน้างาน (LINE)', '', '', '', 'router_device', ?)
        `).run(lineUserId, now);
        userState = db.prepare('SELECT * FROM dlt_line_user_states WHERE line_user_id = ?').get(lineUserId);
      }

      let activeCircuit = null;
      let completeness = null;
      if (userState.active_so_number) {
        const cRow = db.prepare('SELECT * FROM dlt_circuits WHERE so_number = ? OR id = ?').get(userState.active_so_number, userState.active_so_number);
        if (cRow) {
          activeCircuit = deserializeCircuit(cRow);
          completeness = evaluateCircuitCompleteness(activeCircuit);
        }
      }

      const messages = db.prepare(`
        SELECT * FROM dlt_line_messages WHERE line_user_id = ? ORDER BY id ASC LIMIT 80
      `).all(lineUserId);

      sendJson(res, 200, {
        userState,
        activeCircuit,
        completeness,
        messages
      });
      return;
    }

    // Interactive LINE Bot Simulator & Direct Action Endpoint
    if (req.method === 'POST' && pathname === '/api/line/simulate') {
      const body = await readJsonBody(req);
      const lineUserId = body.line_user_id || 'sim_tech_01';
      const action = body.action || 'text';
      const now = new Date().toISOString();

      let userState = db.prepare('SELECT * FROM dlt_line_user_states WHERE line_user_id = ?').get(lineUserId);
      if (!userState) {
        db.prepare(`
          INSERT INTO dlt_line_user_states (line_user_id, display_name, tech_name, tech_phone, active_so_number, active_slot_key, updated_at)
          VALUES (?, 'ช่างหน้างาน (LINE)', '', '', '', 'router_device', ?)
        `).run(lineUserId, now);
        userState = db.prepare('SELECT * FROM dlt_line_user_states WHERE line_user_id = ?').get(lineUserId);
      }

      const recordChat = (role, type, text, soNumber = '', mediaUrl = '', extra = {}) => {
        db.prepare(`
          INSERT INTO dlt_line_messages (line_user_id, sender_role, so_number, message_type, message_text, media_url, extra_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(lineUserId, role, soNumber || userState.active_so_number || '', type, text, mediaUrl, JSON.stringify(extra), new Date().toISOString());
      };

      if (action === 'clear_chat') {
        db.prepare('DELETE FROM dlt_line_messages WHERE line_user_id = ?').run(lineUserId);
        sendJson(res, 200, { ok: true });
        return;
      }

      // Action 1: Check-in เข้า Site
      if (action === 'checkin') {
        const soNumber = (body.so_number || userState.active_so_number || '').trim().toUpperCase();
        const techName = (body.tech_name || userState.tech_name || '').trim();
        const techPhone = (body.tech_phone || userState.tech_phone || '').trim();
        const latLong = (body.lat_long || '').trim();

        const cRow = db.prepare('SELECT * FROM dlt_circuits WHERE so_number = ? OR id = ?').get(soNumber, soNumber);
        if (!cRow) {
          sendJson(res, 404, { error: `ไม่พบรหัสวงจร ${soNumber}` });
          return;
        }
        if (!techName) {
          sendJson(res, 400, { error: 'กรุณาระบุชื่อช่างผู้เข้าดำเนินการก่อนกด Check-in' });
          return;
        }

        recordChat('user', 'text', `📍 แจ้ง Check-in เข้าหน้างาน\nวงจร: ${soNumber}\nชื่อช่าง: ${techName}${techPhone ? ` (${techPhone})` : ''}`, soNumber);

        const updatedCircuit = performCheckin(deserializeCircuit(cRow), {
          techName,
          techPhone,
          latLong,
          lineUserId,
          lineDisplayName: techName
        });
        const comp = evaluateCircuitCompleteness(updatedCircuit);
        const firstMissingSlot = comp.missingSlotKeys[0] || 'router_device';

        db.prepare(`
          UPDATE dlt_line_user_states SET
            tech_name = ?,
            tech_phone = ?,
            active_so_number = ?,
            active_slot_key = ?,
            updated_at = ?
          WHERE line_user_id = ?
        `).run(techName, techPhone, soNumber, firstMissingSlot, now, lineUserId);

        const firstSlotObj = comp.slots.find(s => s.slotKey === firstMissingSlot) || comp.slots[0];
        const replyText =
          `✅ [1. Check-in เข้า Site สำเร็จ!]\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `🏢 สาขา: ${updatedCircuit.branch_name || updatedCircuit.province}\n` +
          `🔢 วงจร: ${updatedCircuit.so_number} (Service: ${updatedCircuit.service_no || '-'})\n` +
          `👷 ช่างผู้ดำเนินการ: ${techName} ${techPhone ? `(${techPhone})` : ''}\n` +
          `🕒 เวลาเข้า Site: ${new Date(updatedCircuit.checkin_time).toLocaleString('th-TH')}\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `📷 สถานะรูปถ่ายปัจจุบัน: ${comp.uploadedPhotos}/${comp.requiredPhotos} รูป\n` +
          `👉 ขั้นตอนต่อไป: กรุณาส่งรูปสำหรับหัวข้อ\n` +
          `「 ${firstSlotObj ? firstSlotObj.label : '1.1 รูปถ่ายอุปกรณ์ MikroTik'} 」\n` +
          `(หากเป็นรูปตัวเครื่อง ระบบจะอ่านรหัส S/N ด้วย OCR ให้อัตโนมัติ พร้อมช่องให้ช่างกรอกยืนยันเพื่อ Recheck ความถูกต้อง)`;

        recordChat('bot', 'text', replyText, soNumber, '', { step: 'checkin_done', completeness: comp });

        sendJson(res, 200, { ok: true, circuit: updatedCircuit, completeness: comp });
        return;
      }

      // Action 1.5: Change active slot in LINE Bot
      if (action === 'select_slot') {
        const slotKey = body.slot_key || 'router_device';
        db.prepare('UPDATE dlt_line_user_states SET active_slot_key = ?, updated_at = ? WHERE line_user_id = ?')
          .run(slotKey, now, lineUserId);
        sendJson(res, 200, { ok: true, active_slot_key: slotKey });
        return;
      }

      // Action 2: Upload Photo + OCR S/N + Manual Recheck via LINE Bot
      if (action === 'upload_photo') {
        const soNumber = (body.so_number || userState.active_so_number || '').trim().toUpperCase();
        const slotKey = body.slot_key || userState.active_slot_key || 'router_device';
        const dataUrl = body.data_url;
        const ocrSn = normalizeSn(body.ocr_sn || '');
        const manualSn = normalizeSn(body.manual_sn || '');

        const cRow = db.prepare('SELECT * FROM dlt_circuits WHERE so_number = ? OR id = ?').get(soNumber, soNumber);
        if (!cRow) {
          sendJson(res, 400, { error: 'กรุณา Check-in เลือกวงจรที่จะปฏิบัติงานก่อนส่งรูป' });
          return;
        }
        if (!dataUrl) {
          sendJson(res, 400, { error: 'ไม่พบข้อมูลไฟล์รูปภาพ' });
          return;
        }

        const savedImg = saveBase64PhotoToDisk(soNumber, slotKey, dataUrl);
        let circuit = deserializeCircuit(cRow);
        const compBefore = evaluateCircuitCompleteness(circuit);
        const slotInfo = compBefore.slots.find(s => s.slotKey === slotKey);

        recordChat(
          'user',
          'image',
          `📷 ส่งรูป: ${slotInfo ? slotInfo.shortName : slotKey}` +
          (manualSn ? `\n✍️ ช่างกรอก S/N: ${manualSn}` : '') +
          (ocrSn ? `\n🤖 OCR อ่านได้: ${ocrSn}` : ''),
          soNumber,
          savedImg.url
        );

        circuit = applySlotPhotoAndSnToCircuit(circuit, slotKey, savedImg.url, ocrSn, manualSn);

        // Save updated router_info & access_points to DB
        db.prepare(`
          UPDATE dlt_circuits SET
            router_info = ?,
            access_points = ?,
            status = CASE WHEN status = 'pending' THEN 'in_progress' ELSE status END,
            updated_at = ?
          WHERE id = ?
        `).run(
          JSON.stringify(circuit.router_info),
          JSON.stringify(circuit.access_points),
          now,
          circuit.id
        );

        const compAfter = evaluateCircuitCompleteness(circuit);
        const updatedSlot = compAfter.slots.find(s => s.slotKey === slotKey);

        // Advance active_slot_key to next missing photo slot automatically
        const nextMissingSlotKey = compAfter.missingSlotKeys[0] || slotKey;
        db.prepare('UPDATE dlt_line_user_states SET active_slot_key = ?, updated_at = ? WHERE line_user_id = ?')
          .run(nextMissingSlotKey, now, lineUserId);

        let snFeedback = '';
        if (updatedSlot && updatedSlot.isDeviceWithSn) {
          snFeedback =
            `\n🔎 [ผลตรวจสอบ S/N อุปกรณ์ (Recheck ช่าง vs OCR)]\n` +
            `• ค่าที่ระบบแปลงจากรูป (OCR): ${updatedSlot.ocrSn || '(ไม่พบรหัสชัดเจนในภาพ)'}\n` +
            `• ค่าที่ช่างกรอกยืนยัน: ${updatedSlot.manualSn || '(รอช่างกรอกยืนยัน)'}\n` +
            `• สถานะ Recheck: ${updatedSlot.snStatusLabel}\n`;
        }

        const nextSlotObj = compAfter.slots.find(s => s.slotKey === nextMissingSlotKey);
        const nextPrompt = compAfter.isPhotoComplete
          ? `🎉 เก็บรูปครบถ้วนทั้ง ${compAfter.requiredPhotos}/${compAfter.requiredPhotos} รูปแล้ว! สามารถกดปุ่ม 「 🏁 4. Check-out ออกจาก Site 」 ได้เลยครับ`
          : `👉 รูปถัดไปที่ต้องถ่าย (${compAfter.uploadedPhotos}/${compAfter.requiredPhotos}):\n「 ${nextSlotObj ? nextSlotObj.label : nextMissingSlotKey} 」`;

        const botReply =
          `✅ บันทึกรูป 「 ${updatedSlot ? updatedSlot.shortName : slotKey} 」 เรียบร้อยแล้ว!\n` +
          `📊 ความครบถ้วนของรูปถ่าย: ${compAfter.uploadedPhotos} / ${compAfter.requiredPhotos} รูป` +
          snFeedback +
          `\n━━━━━━━━━━━━━━━━━━\n` +
          nextPrompt;

        recordChat('bot', 'text', botReply, soNumber, '', { completeness: compAfter });
        await syncCircuitToCloud(circuit);

        sendJson(res, 200, {
          ok: true,
          circuit,
          completeness: compAfter,
          next_slot_key: nextMissingSlotKey
        });
        return;
      }

      // Action 2.5: Technician submits / updates Manual S/N vs OCR S/N for Recheck
      if (action === 'recheck_sn') {
        const soNumber = (body.so_number || userState.active_so_number || '').trim().toUpperCase();
        const target = body.target || 'router'; // 'router' | 'ap_0' | 'ap_1' ...
        const manualSn = normalizeSn(body.manual_sn || '');
        const ocrSn = body.ocr_sn !== undefined ? normalizeSn(body.ocr_sn) : undefined;

        const cRow = db.prepare('SELECT * FROM dlt_circuits WHERE so_number = ? OR id = ?').get(soNumber, soNumber);
        if (!cRow) {
          sendJson(res, 400, { error: 'กรุณาเลือกวงจรที่ปฏิบัติงานก่อนยืนยัน S/N' });
          return;
        }
        const circuit = deserializeCircuit(cRow);
        if (target === 'router') {
          circuit.router_info = circuit.router_info || {};
          if (manualSn) circuit.router_info.serial_no = manualSn;
          if (ocrSn !== undefined && ocrSn !== '') circuit.router_info.ocr_serial_no = ocrSn;
        } else if (target.startsWith('ap_')) {
          const idx = Number(target.replace('ap_', ''));
          if (Array.isArray(circuit.access_points) && circuit.access_points[idx]) {
            if (manualSn) circuit.access_points[idx].serial_no = manualSn;
            if (ocrSn !== undefined && ocrSn !== '') circuit.access_points[idx].ocr_serial_no = ocrSn;
          }
        }

        db.prepare('UPDATE dlt_circuits SET router_info = ?, access_points = ?, updated_at = ? WHERE id = ?')
          .run(JSON.stringify(circuit.router_info), JSON.stringify(circuit.access_points), now, circuit.id);

        const comp = evaluateCircuitCompleteness(circuit);
        const item = comp.snRecheckItems.find(i => i.target === target);

        recordChat('user', 'text', `✍️ ยืนยันรหัส S/N (${item ? item.label : target}): ${manualSn}`, soNumber);
        recordChat(
          'bot',
          'text',
          `🔍 [อัปเดตผลการ Recheck S/N สำเร็จ]\n` +
          `อุปกรณ์: ${item ? item.label : target}\n` +
          `• ช่างกรอก: ${item?.manualSn || '-'}\n` +
          `• ค่าจาก OCR: ${item?.ocrSn || '-'}\n` +
          `• ผลตรวจสอบ: ${item?.statusLabel || '-'}`,
          soNumber
        );

        sendJson(res, 200, { ok: true, circuit, completeness: comp });
        return;
      }

      // Action 3: Check Photo & S/N Completeness via LINE Bot
      if (action === 'check_completeness') {
        const soNumber = (body.so_number || userState.active_so_number || '').trim().toUpperCase();
        const cRow = db.prepare('SELECT * FROM dlt_circuits WHERE so_number = ? OR id = ?').get(soNumber, soNumber);
        if (!cRow) {
          sendJson(res, 400, { error: 'กรุณาเลือกวงจรหรือ Check-in ก่อนตรวจสอบรูปภาพ' });
          return;
        }
        const circuit = deserializeCircuit(cRow);
        const comp = evaluateCircuitCompleteness(circuit);

        recordChat('user', 'text', `📋 ตรวจสอบความครบถ้วนของรูปภาพและ S/N (${soNumber})`, soNumber);

        const slotLines = comp.slots.map(s => `${s.hasPhoto ? '✅' : '❌'} ${s.shortName}`).join('\n');
        const snLines = comp.snRecheckItems.map(i => `• ${i.label}: ช่าง [${i.manualSn || '-'}] / OCR [${i.ocrSn || '-'}] ➔ ${i.statusLabel}`).join('\n');

        const reply =
          `📋 [3. ผลการตรวจสอบความครบถ้วน (${soNumber})]\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `📷 จำนวนรูปภาพ: ส่งแล้ว ${comp.uploadedPhotos} / ${comp.requiredPhotos} รูป ${comp.isPhotoComplete ? '(✅ ครบถ้วน)' : `(⚠️ ขาดอีก ${comp.missingPhotoCount} รูป)`}\n` +
          `${slotLines}\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `🔎 สถานะ Recheck รหัส S/N (ช่าง vs OCR):\n` +
          `${snLines}\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          (comp.isPhotoComplete && !comp.hasMissingSn
            ? `✅ ข้อมูลและรูปถ่ายครบถ้วนสมบูรณ์! กดปุ่ม 「 🏁 4. Check-out ส่งงาน 」 ได้ทันที`
            : `⚠️ กรุณาเก็บภาพหรือระบุ S/N ที่ยังมีเครื่องหมาย ❌ ให้ครบก่อน Check-out`);

        recordChat('bot', 'text', reply, soNumber, '', { completeness: comp });
        sendJson(res, 200, { ok: true, circuit, completeness: comp });
        return;
      }

      // Action 4: Check-out ออกจาก Site + สร้างรายงาน MS Word (.docx)
      if (action === 'checkout') {
        const soNumber = (body.so_number || userState.active_so_number || '').trim().toUpperCase();
        const cRow = db.prepare('SELECT * FROM dlt_circuits WHERE so_number = ? OR id = ?').get(soNumber, soNumber);
        if (!cRow) {
          sendJson(res, 400, { error: 'กรุณาเลือกวงจรหรือ Check-in ก่อนทำรายการ Check-out' });
          return;
        }
        const circuit = deserializeCircuit(cRow);
        recordChat('user', 'text', `🏁 แจ้ง Check-out ออกจาก Site (${soNumber})${body.note ? `\nหมายเหตุ: ${body.note}` : ''}`, soNumber);

        const result = performCheckout(circuit, {
          note: body.note || '',
          latLong: body.lat_long || '',
          force: Boolean(body.force)
        });

        if (!result.ok) {
          const missingText = result.completeness.missingPhotoLabels.map(l => `❌ ${l}`).join('\n');
          const warnReply =
            `⚠️ [ยังไม่สามารถ Check-out ได้เนื่องจากข้อมูลยังไม่ครบ]\n` +
            `📷 รูปภาพที่ส่งแล้ว: ${result.completeness.uploadedPhotos}/${result.completeness.requiredPhotos} รูป\n` +
            (missingText ? `รายการรูปที่ยังขาด:\n${missingText}\n` : '') +
            (result.completeness.hasMissingSn ? `❌ ยังมีอุปกรณ์ที่ช่างยังไม่ได้กรอกยืนยันรหัส S/N\n` : '') +
            `\n💡 กรุณาแนบรูป/กรอก S/N ให้ครบ หรือกดปุ่ม "ยืนยันส่งงานพร้อมหมายเหตุ" หากหน้างานมีข้อจำกัด`;

          recordChat('bot', 'text', warnReply, soNumber, '', { completeness: result.completeness });
          sendJson(res, 400, result);
          return;
        }

        const comp = result.completeness;
        const docxUrl = `/api/circuits/${encodeURIComponent(soNumber)}/report.docx`;
        const pdfReportUrl = `/report.html?id=${encodeURIComponent(soNumber)}`;

        const successReply =
          `🏁 [4. Check-out ออกจาก Site สำเร็จ!]\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `🏢 สาขา: ${result.circuit.branch_name || result.circuit.province}\n` +
          `🔢 วงจร: ${soNumber}\n` +
          `👷 ช่าง: ${result.circuit.inspector_name || '-'}\n` +
          `🕒 เวลาเข้า: ${new Date(result.circuit.checkin_time).toLocaleTimeString('th-TH')}\n` +
          `🕓 เวลาออก: ${new Date(result.circuit.checkout_time).toLocaleTimeString('th-TH')} (รวม ${comp.durationText || '1 นาที'})\n` +
          `📷 รูปภาพ: ${comp.uploadedPhotos}/${comp.requiredPhotos} รูป (${comp.isPhotoComplete ? 'ครบถ้วน' : 'บันทึกตามหมายเหตุ'})\n` +
          `🛡️ สถานะ: ส่งเข้าคิวให้ Admin ตรวจสอบความถูกต้องแล้ว\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `📝 สร้างรายงาน MS Word (.docx) อัตโนมัติเรียบร้อยแล้ว:\n` +
          `ดาวน์โหลดได้ที่ปุ่ม "📝 ดาวน์โหลด MS Word (.docx)" ด้านล่าง!`;

        recordChat('bot', 'text', successReply, soNumber, '', {
          checkout_done: true,
          docx_url: docxUrl,
          pdf_url: pdfReportUrl,
          completeness: comp
        });

        await syncCircuitToCloud(result.circuit);
        sendJson(res, 200, {
          ok: true,
          circuit: result.circuit,
          completeness: comp,
          docxUrl,
          pdfReportUrl
        });
        return;
      }

      // Free-text message in LINE Bot
      const text = (body.text || '').trim();
      if (text) {
        recordChat('user', 'text', text);
        // Check if text matches a circuit or province search
        const upper = text.toUpperCase();
        const soMatch = upper.match(/BINF\d{7}/);
        if (soMatch) {
          const foundSo = soMatch[0];
          const cRow = db.prepare('SELECT * FROM dlt_circuits WHERE so_number = ?').get(foundSo);
          if (cRow) {
            db.prepare('UPDATE dlt_line_user_states SET active_so_number = ?, updated_at = ? WHERE line_user_id = ?')
              .run(foundSo, now, lineUserId);
            const comp = evaluateCircuitCompleteness(deserializeCircuit(cRow));
            recordChat(
              'bot',
              'text',
              `🔎 พบวงจร ${cRow.so_number}\nสาขา: ${cRow.branch_name || cRow.province}\nสถานะรูป: ${comp.uploadedPhotos}/${comp.requiredPhotos} รูป\n👉 กดปุ่ม "📍 1. Check-in เข้า Site" ด้านล่างเพื่อเริ่มงานได้เลยครับ`,
              foundSo
            );
            sendJson(res, 200, { ok: true });
            return;
          }
        }

        // Otherwise search province/branch
        const matched = db.prepare(`
          SELECT so_number, province, branch_name FROM dlt_circuits
          WHERE province LIKE ? OR branch_name LIKE ? OR service_no LIKE ?
          LIMIT 6
        `).all(`%${text}%`, `%${text}%`, `%${text}%`);

        if (matched.length > 0) {
          const listStr = matched.map(m => `• ${m.so_number} — ${m.branch_name || m.province}`).join('\n');
          recordChat('bot', 'text', `🔎 พบวงจรที่ตรงกับ "${text}":\n${listStr}\n\n(เลือกวงจรจากแถบด้านบน หรือพิมพ์รหัส BINF... เพื่อเริ่ม Check-in)`);
        } else {
          recordChat('bot', 'text', `💡 คำสั่ง LINE Bot ช่างเข้าหน้างาน:\n1️⃣ เลือกวงจรแล้วกด "📍 Check-in เข้า Site"\n2️⃣ ส่งรูปอุปกรณ์ (ระบบแปลง S/N ด้วย OCR พร้อมช่องให้ช่างกรอก Recheck)\n3️⃣ กด "📋 ตรวจจำนวนรูปครบ/ไม่ครบ"\n4️⃣ กด "🏁 Check-out ส่งงาน + รับไฟล์ MS Word (.docx)"`);
        }
        sendJson(res, 200, { ok: true });
        return;
      }

      sendJson(res, 400, { error: 'ไม่ระบุคำสั่ง' });
      return;
    }

    // Real LINE Official Account Messaging API Webhook
    if (req.method === 'POST' && pathname === '/api/line/webhook') {
      const rawBuf = await readRawBuffer(req);
      const sig = req.headers['x-line-signature'] || '';
      if (lineConfig.channelSecret && sig) {
        const valid = verifyLineSignature(rawBuf, sig, lineConfig.channelSecret);
        if (!valid) {
          sendJson(res, 401, { error: 'Invalid LINE signature' });
          return;
        }
      }

      const payload = rawBuf.length ? JSON.parse(rawBuf.toString('utf8')) : {};
      const events = Array.isArray(payload.events) ? payload.events : [];
      const now = new Date().toISOString();

      for (const ev of events) {
        const userId = ev.source?.userId || 'line_webhook_user';
        const replyToken = ev.replyToken;

        let uState = db.prepare('SELECT * FROM dlt_line_user_states WHERE line_user_id = ?').get(userId);
        if (!uState) {
          db.prepare(`
            INSERT INTO dlt_line_user_states (line_user_id, display_name, tech_name, tech_phone, active_so_number, active_slot_key, updated_at)
            VALUES (?, 'LINE Technician', '', '', '', 'router_device', ?)
          `).run(userId, now);
          uState = db.prepare('SELECT * FROM dlt_line_user_states WHERE line_user_id = ?').get(userId);
        }

        if (ev.type === 'message' && ev.message?.type === 'text') {
          const text = (ev.message.text || '').trim();
          db.prepare(`
            INSERT INTO dlt_line_messages (line_user_id, sender_role, so_number, message_type, message_text, created_at)
            VALUES (?, 'user', ?, 'text', ?, ?)
          `).run(userId, uState.active_so_number || '', text, now);

          let replyMsg = '';
          const checkinMatch = text.match(/^(?:เช็คอิน|checkin)\s+(BINF\d{7})\s+([^\s]+)(?:\s+(\S+))?/i);
          const snMatch = text.match(/^sn\s+([A-Z0-9-]{6,20})/i);

          if (checkinMatch) {
            const [, so, tName, tPhone] = checkinMatch;
            const cRow = db.prepare('SELECT * FROM dlt_circuits WHERE so_number = ?').get(so.toUpperCase());
            if (!cRow) {
              replyMsg = `❌ ไม่พบรหัสวงจร ${so.toUpperCase()}`;
            } else {
              const updated = performCheckin(deserializeCircuit(cRow), {
                techName: tName,
                techPhone: tPhone || '',
                lineUserId: userId,
                lineDisplayName: tName
              });
              const comp = evaluateCircuitCompleteness(updated);
              const nextSlot = comp.missingSlotKeys[0] || 'router_device';
              db.prepare('UPDATE dlt_line_user_states SET tech_name=?, tech_phone=?, active_so_number=?, active_slot_key=?, updated_at=? WHERE line_user_id=?')
                .run(tName, tPhone || '', updated.so_number, nextSlot, now, userId);
              replyMsg = `✅ Check-in สำเร็จ!\nวงจร: ${updated.so_number} (${updated.branch_name})\nช่าง: ${tName}\nเวลา: ${new Date(updated.checkin_time).toLocaleString('th-TH')}\n📷 รูปภาพ: ${comp.uploadedPhotos}/${comp.requiredPhotos} รูป\n👉 กรุณาส่งรูปถัดไป หรือพิมพ์ "เช็ครูป"`;
            }
          } else if (snMatch && uState.active_so_number) {
            const manualSn = normalizeSn(snMatch[1]);
            const cRow = db.prepare('SELECT * FROM dlt_circuits WHERE so_number = ?').get(uState.active_so_number);
            if (cRow) {
              const c = deserializeCircuit(cRow);
              c.router_info = c.router_info || {};
              c.router_info.serial_no = manualSn;
              db.prepare('UPDATE dlt_circuits SET router_info=?, updated_at=? WHERE id=?').run(JSON.stringify(c.router_info), now, c.id);
              const comp = evaluateCircuitCompleteness(c);
              replyMsg = `✍️ บันทึก S/N ช่างกรอก: ${manualSn}\nผลเทียบ OCR (${c.router_info.ocr_serial_no || '-'}): ${comp.snRecheckItems[0]?.statusLabel}`;
            }
          } else if (/^(?:เช็ครูป|สถานะ|status)$/i.test(text) && uState.active_so_number) {
            const cRow = db.prepare('SELECT * FROM dlt_circuits WHERE so_number = ?').get(uState.active_so_number);
            if (cRow) {
              const comp = evaluateCircuitCompleteness(deserializeCircuit(cRow));
              replyMsg = `📋 วงจร ${uState.active_so_number}\n📷 รูปภาพ: ${comp.uploadedPhotos}/${comp.requiredPhotos} รูป\n` +
                comp.slots.map(s => `${s.hasPhoto ? '✅' : '❌'} ${s.shortName}`).join('\n');
            }
          } else if (/^(?:เช็คเอาท์|checkout|ส่งงาน)$/i.test(text) && uState.active_so_number) {
            const cRow = db.prepare('SELECT * FROM dlt_circuits WHERE so_number = ?').get(uState.active_so_number);
            if (cRow) {
              const resOut = performCheckout(deserializeCircuit(cRow), { force: true });
              replyMsg = `🏁 Check-out วงจร ${uState.active_so_number} สำเร็จ!\nส่งให้ Admin ตรวจสอบแล้ว\n📝 ดาวน์โหลดรายงาน Word: ${lineConfig.publicBaseUrl}/api/circuits/${uState.active_so_number}/report.docx`;
            }
          } else {
            replyMsg = `🤖 DLT Onsite LINE Bot:\n• พิมพ์: เช็คอิน BINF3480028 ชื่อช่าง เบอร์โทร\n• ส่งรูปถ่ายอุปกรณ์และผลเทสในแชท\n• พิมพ์: sn <รหัสS/N> เพื่อยืนยัน S/N ช่างเทียบ OCR\n• พิมพ์: เช็ครูป เพื่อตรวจจำนวนรูป\n• พิมพ์: เช็คเอาท์ เพื่อจบงานและรับไฟล์ Word`;
          }

          db.prepare(`
            INSERT INTO dlt_line_messages (line_user_id, sender_role, so_number, message_type, message_text, created_at)
            VALUES (?, 'bot', ?, 'text', ?, ?)
          `).run(userId, uState.active_so_number || '', replyMsg, now);

          await sendLineReply(replyToken, [{ type: 'text', text: replyMsg }], lineConfig.channelAccessToken);
        } else if (ev.type === 'message' && ev.message?.type === 'image' && uState.active_so_number) {
          const imgData = await downloadLineMessageImage(ev.message.id, lineConfig.channelAccessToken);
          if (imgData) {
            const dataUrl = `data:${imgData.mimeType};base64,${imgData.buffer.toString('base64')}`;
            const saved = saveBase64PhotoToDisk(uState.active_so_number, uState.active_slot_key || 'router_device', dataUrl);
            const cRow = db.prepare('SELECT * FROM dlt_circuits WHERE so_number = ?').get(uState.active_so_number);
            if (cRow) {
              let c = deserializeCircuit(cRow);
              c = applySlotPhotoAndSnToCircuit(c, uState.active_slot_key || 'router_device', saved.url, '', '');
              db.prepare('UPDATE dlt_circuits SET router_info=?, access_points=?, updated_at=? WHERE id=?')
                .run(JSON.stringify(c.router_info), JSON.stringify(c.access_points), now, c.id);
              const comp = evaluateCircuitCompleteness(c);
              const nextSlot = comp.missingSlotKeys[0] || 'router_device';
              db.prepare('UPDATE dlt_line_user_states SET active_slot_key=?, updated_at=? WHERE line_user_id=?')
                .run(nextSlot, now, userId);
              const replyMsg = `✅ บันทึกรูปแล้ว (${comp.uploadedPhotos}/${comp.requiredPhotos} รูป)\n${comp.isPhotoComplete ? '🎉 รูปครบแล้ว พิมพ์ "เช็คเอาท์" ได้เลย' : `👉 ส่งรูปถัดไปได้เลย (${nextSlot})`}`;
              await sendLineReply(replyToken, [{ type: 'text', text: replyMsg }], lineConfig.channelAccessToken);
            }
          }
        }
      }

      sendJson(res, 200, { ok: true });
      return;
    }

    // ------------------------------------------------------------------------
    // 9. Serve Legacy Handover PDFs from /Onsite/...
    // ------------------------------------------------------------------------
    if (req.method === 'GET' && (pathname.startsWith('/Onsite/') || pathname.startsWith('/onsite/'))) {
      const rel = pathname.replace(/^\/[Oo]nsite\//, '');
      const safePath = path.normalize(path.join(ONSITE_DIR, rel));
      if (!safePath.startsWith(ONSITE_DIR)) {
        sendJson(res, 403, { error: 'Forbidden' });
        return;
      }
      serveStaticFile(res, safePath);
      return;
    }

    // ------------------------------------------------------------------------
    // 10. Serve Uploaded Inspection Photos from /uploads/...
    // ------------------------------------------------------------------------
    if (req.method === 'GET' && pathname.startsWith('/uploads/')) {
      const rel = pathname.replace(/^\/uploads\//, '');
      const safePath = path.normalize(path.join(UPLOADS_DIR, rel));
      if (!safePath.startsWith(UPLOADS_DIR)) {
        sendJson(res, 403, { error: 'Forbidden' });
        return;
      }
      serveStaticFile(res, safePath);
      return;
    }

    // ------------------------------------------------------------------------
    // 11. Serve Static Frontend Files from /public
    // ------------------------------------------------------------------------
    let targetFile = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const fullPublicPath = path.normalize(path.join(PUBLIC_DIR, targetFile));
    if (fullPublicPath.startsWith(PUBLIC_DIR) && fs.existsSync(fullPublicPath) && fs.statSync(fullPublicPath).isFile()) {
      serveStaticFile(res, fullPublicPath);
      return;
    }

    sendJson(res, 404, { error: 'Not found: ' + pathname });
  } catch (err) {
    console.error('Server error:', err);
    sendJson(res, 500, { error: err.message || 'Internal Server Error' });
  }
});

server.listen(PORT, () => {
  console.log(`================================================================`);
  console.log(`DLT Onsite Inspection System running at http://localhost:${PORT}`);
  console.log(`Total Circuits Loaded: 334 | Cloud DB Ready: ${isCloudConfigured() ? 'CONNECTED' : 'LOCAL + CLOUD READY'}`);
  console.log(`================================================================`);
});
