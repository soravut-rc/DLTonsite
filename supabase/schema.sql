-- =============================================================================
-- ระบบตรวจรับและส่งมอบงาน กรมการขนส่งทางบก (DLT Onsite Inspection System)
-- Supabase / PostgreSQL Database Schema (รองรับทั้ง 334 วงจร)
-- =============================================================================

-- 1. ตารางข้อมูลวงจรและผลการตรวจรับงาน (dlt_circuits)
CREATE TABLE IF NOT EXISTS public.dlt_circuits (
    id TEXT PRIMARY KEY,                          -- รหัสวงจรหลัก เช่น BINF3480006
    seq INTEGER NOT NULL DEFAULT 0,               -- ลำดับที่ (1 - 334)
    so_number TEXT NOT NULL UNIQUE,               -- หมายเลข S/O (เช่น BINF3480006)
    service_no TEXT,                              -- หมายเลขวงจร Service No. (เช่น 2272J2672)
    region TEXT NOT NULL,                         -- ภูมิภาค (ภาคกลาง, ภาคเหนือ, ภาคใต้, ฯลฯ)
    province TEXT NOT NULL,                       -- จังหวัด (77 จังหวัด)
    raw_province_folder TEXT,                     -- ชื่อโฟลเดอร์จังหวัดเดิม
    branch_name TEXT,                             -- ชื่อสำนักงานขนส่ง / สาขา
    address TEXT DEFAULT '',                      -- ที่อยู่สถานที่ติดตั้ง
    lat_long TEXT DEFAULT '',                     -- พิกัดที่ตั้ง (Lat, Long)
    speed_pkg TEXT DEFAULT '1000Mbps/500Mbps',    -- ความเร็ววงจร FTTx
    legacy_pdf_path TEXT,                         -- พาธไฟล์ PDF ส่งมอบของปีที่แล้วในโฟลเดอร์ Onsite
    status TEXT NOT NULL DEFAULT 'pending',       -- สถานะ: pending | in_progress | completed | issue
    router_info JSONB NOT NULL DEFAULT '{}'::jsonb,       -- ข้อมูล Router (MikroTik RB3011 / RB4011 / hAP ac2, S/N, ห้อง, ผลเทส, รูปถ่าย)
    access_points JSONB NOT NULL DEFAULT '[]'::jsonb,     -- รายการ Access Point ตามจำนวนห้อง (TOTOLINK / TP-LINK / D-LINK, S/N, ห้อง, ผลเทส, รูปถ่าย)
    remarks TEXT DEFAULT '',                      -- หมายเหตุการติดตั้ง/ตรวจสอบ
    inspector_name TEXT DEFAULT '',               -- ชื่อผู้เข้าดำเนินการติดตั้ง (ช่างผู้ส่งมอบ)
    inspector_phone TEXT DEFAULT '',              -- เบอร์โทรศัพท์ช่างผู้ส่งมอบ
    inspection_date TEXT DEFAULT '',              -- วันที่เข้าดำเนินการ
    inspector_signature TEXT DEFAULT '',          -- ลายมือชื่อผู้ส่งมอบ (Data URL / Storage URL)
    receiver_name TEXT DEFAULT '',                -- ชื่อเจ้าหน้าที่ผู้รับมอบ (กรมการขนส่งทางบก)
    receiver_position TEXT DEFAULT '',            -- ตำแหน่งผู้รับมอบ
    receiver_phone TEXT DEFAULT '',               -- เบอร์โทรศัพท์ผู้รับมอบ
    received_date TEXT DEFAULT '',                -- วันที่รับมอบ
    receiver_signature TEXT DEFAULT '',           -- ลายมือชื่อผู้รับมอบ (Data URL / Storage URL)
    checkin_time TEXT DEFAULT '',                 -- เวลา Check-in เข้า Site
    checkout_time TEXT DEFAULT '',                -- เวลา Check-out ออกจาก Site
    admin_status TEXT DEFAULT '',                 -- สถานะ Admin QA: pending_review | approved | rejected
    admin_name TEXT DEFAULT '',                   -- ชื่อ Admin ผู้ตรวจรับ
    admin_comment TEXT DEFAULT '',                -- ความเห็น/หมายเหตุจาก Admin
    admin_reviewed_at TEXT DEFAULT '',            -- เวลาที่ Admin ตรวจสอบ
    line_user_id TEXT DEFAULT '',                 -- LINE User ID ของช่างที่เข้าหน้างาน
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- รองรับการอัปเกรดตารางเดิมที่มีอยู่แล้วบน Supabase
ALTER TABLE public.dlt_circuits ADD COLUMN IF NOT EXISTS checkin_time TEXT DEFAULT '';
ALTER TABLE public.dlt_circuits ADD COLUMN IF NOT EXISTS checkout_time TEXT DEFAULT '';
ALTER TABLE public.dlt_circuits ADD COLUMN IF NOT EXISTS admin_status TEXT DEFAULT '';
ALTER TABLE public.dlt_circuits ADD COLUMN IF NOT EXISTS admin_name TEXT DEFAULT '';
ALTER TABLE public.dlt_circuits ADD COLUMN IF NOT EXISTS admin_comment TEXT DEFAULT '';
ALTER TABLE public.dlt_circuits ADD COLUMN IF NOT EXISTS admin_reviewed_at TEXT DEFAULT '';
ALTER TABLE public.dlt_circuits ADD COLUMN IF NOT EXISTS line_user_id TEXT DEFAULT '';

-- Indexes สำหรับการค้นหาและกรองข้อมูลอย่างรวดเร็ว
CREATE INDEX IF NOT EXISTS idx_dlt_circuits_region ON public.dlt_circuits (region);
CREATE INDEX IF NOT EXISTS idx_dlt_circuits_province ON public.dlt_circuits (province);
CREATE INDEX IF NOT EXISTS idx_dlt_circuits_status ON public.dlt_circuits (status);
CREATE INDEX IF NOT EXISTS idx_dlt_circuits_so_number ON public.dlt_circuits (so_number);

-- 2. ตารางประวัติการบันทึกและแก้ไขงานของช่าง (dlt_inspection_logs)
CREATE TABLE IF NOT EXISTS public.dlt_inspection_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    circuit_id TEXT NOT NULL REFERENCES public.dlt_circuits(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    actor_name TEXT DEFAULT '',
    status_after TEXT DEFAULT '',
    note TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dlt_logs_circuit_id ON public.dlt_inspection_logs (circuit_id);

-- 3. เปิดใช้งาน Row Level Security (RLS) และ Policy สำหรับทีมช่างและแอดมิน
ALTER TABLE public.dlt_circuits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dlt_inspection_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read/write for dlt_circuits" ON public.dlt_circuits;
CREATE POLICY "Allow public read/write for dlt_circuits"
    ON public.dlt_circuits
    FOR ALL
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public read/write for dlt_inspection_logs" ON public.dlt_inspection_logs;
CREATE POLICY "Allow public read/write for dlt_inspection_logs"
    ON public.dlt_inspection_logs
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- 4. สร้าง Storage Bucket สำหรับเก็บรูปถ่ายอุปกรณ์และผล Speed Test (ถ้าใช้ Supabase Storage)
INSERT INTO storage.buckets (id, name, public)
VALUES ('dlt-onsite-uploads', 'dlt-onsite-uploads', true)
ON CONFLICT (id) DO NOTHING;
