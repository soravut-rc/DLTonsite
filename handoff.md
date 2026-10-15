# DLT Onsite Inspection System — Project Handoff (`handoff.md`)

เอกสารส่งมอบงานและสรุปสถาปัตยกรรมระบบ **ระบบตรวจรับและบำรุงรักษาอุปกรณ์เครือข่าย (Onsite) กรมการขนส่งทางบก (DLT)** ครอบคลุม **334 วงจร / 77 จังหวัด / 6 ภูมิภาค** (MikroTik Router 334 ตัว และ Access Point 668 ตัว)

---

## 1. ภาพรวมขั้นตอนการปฏิบัติงานจริง (Real-World Onsite Workflow)

จากการปรับจูนให้ตรงกับการเข้าหน้างานจริงของช่าง มีลำดับขั้นตอนหลัก 6 ขั้นตอนดังนี้:

1. **📍 ขั้นตอนที่ 1: Check-in เข้า Site**
   - ช่างค้นหาวงจรด้วย **Quick Jump (เลือกจังหวัด $\rightarrow$ เลือกวงจร `BINF...`)** หรือพิมพ์รหัสวงจรผ่าน **LINE Bot**
   - บันทึกชื่อช่าง เบอร์โทร และเวลาเข้าดำเนินการ (`checkin_time`) สถานะวงจรเปลี่ยนเป็น `in_progress`

2. **📷 ขั้นตอนที่ 2: ดำเนินการเก็บรูปภาพอุปกรณ์ + ระบบแปลง S/N (OCR) & Recheck**
   - ช่างถ่ายรูปอุปกรณ์และผลทดสอบความเร็วตามหัวข้อที่กำหนด
   - **สำหรับรูปอุปกรณ์ที่มี S/N** (`MikroTik ตัวที่ 1`, `Access Point ตัวที่ 1`, `Access Point ตัวที่ 2`):
     - ระบบใช้ **BarcodeDetector + Tesseract OCR** สแกนหาหมายเลข Serial Number อัตโนมัติ (`ocr_serial_no`)
     - มีช่องให้ **ช่างกรอก S/N ด้วยตัวเอง (`serial_no`)** เพื่อนำมา **Recheck เปรียบเทียบความถูกต้อง** ระหว่างค่าที่ช่างกรอกกับค่าที่ OCR แปลงได้ (`ตรงกัน 100%` / `ไม่ตรงกัน` / `มีค่าฝั่งเดียว`)

3. **📄 ขั้นตอนที่ 3: แนบสำเนาเอกสารกระดาษจริง "แบบส่งมอบงาน" (หน้า 1/2 และ หน้า 2/2)**
   - ช่างถือเอกสารกระดาษ **"แบบส่งมอบงาน"** ไปเขียนรายละเอียดอุปกรณ์และสถานที่หน้างาน และให้นายช่าง/เจ้าหน้าที่ขนส่งปลายทาง **ลงนามพร้อมประทับตราจริง**
   - ช่างถ่ายรูป/สแกน **สำเนาเอกสาร "แบบส่งมอบงาน"** เก็บเข้าสู่ระบบเพื่อเป็นหลักฐาน จำนวน 2 หน้า:
     - **`handover_page1` (`photo_handover_p1`)**: สำเนา "แบบส่งมอบงาน" หน้าที่ 1/2 (รายละเอียดสถานที่และอุปกรณ์)
     - **`handover_page2` (`photo_handover_p2`)**: สำเนา "แบบส่งมอบงาน" หน้าที่ 2/2 (ส่วนลงนามและตราประทับเจ้าหน้าที่ปลายทาง)
   - *หมายเหตุ*: ระบบไม่ต้องสร้างฟอร์มเปล่าของใบส่งมอบงานซ้ำ แต่จะนำไฟล์ภาพสำเนาทั้ง 2 หน้านี้ไปวางเป็น **หน้าที่ 1 และหน้าที่ 2 ของไฟล์รายงาน** โดยตรง

4. **📋 ขั้นตอนที่ 4: ระบบตรวจสอบความครบถ้วนของรูปถ่าย (Completeness Check — 11 รายการบังคับ)**
   - ระบบตรวจสอบว่ารูปถ่ายครบทั้ง **11 จุด** หรือไม่ (`REQUIRED_PHOTO_SLOTS` ใน `lib/completeness_and_line.js`):
     1. `router_device` — 1.1 รูปถ่ายจุดติดตั้ง MikroTik ตัวที่ 1 (พร้อม S/N + OCR)
     2. `router_lan2` — 1.2 รูปภาพ Test speed port LAN 2
     3. `router_lan3` — 1.3 รูปภาพ Test speed port LAN 3
     4. `ap_0_device` — 2.1.1 รูปถ่าย Access Point ณ จุดติดตั้ง ตัวที่ 1 (พร้อม S/N + OCR)
     5. `ap_0_wifi` — 2.1.2 รูปภาพ Test speed ผ่าน WiFi (AP ตัวที่ 1)
     6. `ap_0_lan` — 2.1.3 รูปภาพ Test speed ผ่านสาย LAN (AP ตัวที่ 1)
     7. `ap_1_device` — 2.2.1 รูปถ่าย Access Point ณ จุดติดตั้ง ตัวที่ 2 (พร้อม S/N + OCR)
     8. `ap_1_wifi` — 2.2.2 รูปภาพ Test speed ผ่าน WiFi (AP ตัวที่ 2)
     9. `ap_1_lan` — 2.2.3 รูปภาพ Test speed ผ่านสาย LAN (AP ตัวที่ 2)
     10. `handover_page1` — 4.1 สำเนาเอกสาร "แบบส่งมอบงาน" หน้าที่ 1/2
     11. `handover_page2` — 4.2 สำเนาเอกสาร "แบบส่งมอบงาน" หน้าที่ 2/2 (ลงนาม + ประทับตรา)
   - *(หมายเหตุ: `applySlotPhotoAndSnToCircuit` รองรับทั้งคีย์ `ap_0_device` / `ap_1_device` และ alias `ap1_device` / `ap2_device`)*

5. **🏁 ขั้นตอนที่ 5: Check-out ออกจาก Site**
   - เมื่อช่างอัปโหลดรูปครบและตรวจสอบ S/N แล้ว กด **Check-out**
   - ระบบบันทึกเวลาออก (`checkout_time`) และส่งงานเข้าคิวรอ Admin ตรวจสอบ (`admin_status = 'pending_review'`)

6. **🛡️ ขั้นตอนที่ 6: Admin QA ตรวจสอบความถูกต้อง & ออกรายงาน MS Word (`.docx`) / PDF**
   - ในหน้า **Admin QA & Word** แอดมินสามารถดูเวลา Check-in/Check-out, ตรวจจำนวนรูปภาพ 11 จุด, ตรวจตารางเปรียบเทียบ S/N (ช่างกรอก vs OCR) และกด **อนุมัติ (`approved`)** หรือ **ตีกลับให้แก้ไข (`rejected`)**
   - ระบบสร้างไฟล์รายงาน **MS Word (`.docx`)** และหน้าพิมพ์ **PDF (`report.html`)** ตามโครงสร้างรายงานของปีที่แล้วทุกประการ:
     - **หน้าที่ 1**: สำเนาเอกสาร **"แบบส่งมอบงาน" หน้าที่ 1/2** (เต็มหน้า A4)
     - **หน้าที่ 2**: สำเนาเอกสาร **"แบบส่งมอบงาน" หน้าที่ 2/2 พร้อมลายเซ็นและตราประทับ** (เต็มหน้า A4)
     - **หน้าที่ 3**: **เอกสารรายงานการติดตั้ง — วงจรสื่อสัญญาณความเร็วสูงแบบ INF (Internet FTTx)** (ตาราง 2 คอลัมน์ แสดง `รูปถ่ายจุดติดตั้ง Mikrotik ตัวที่ 1` คู่กับ `รูปภาพ Test speed port lan 2` และ `port lan 3`)
     - **หน้าที่ 4 (และ 5)**: **เอกสารรายงานการติดตั้ง (Access Point)** (ตาราง 2 คอลัมน์ แสดง `รูปถ่าย Access Point(AP) ณ จุดติดตั้ง ตัวที่ 1 และ 2 (ห้อง...)` คู่กับ `รูปภาพ Test speed ผ่าน WiFi` และ `ผ่านสาย Lan`)

---

## 2. โครงสร้างไฟล์สำคัญของโปรเจกต์ (Project Structure)

| ไฟล์ / โฟลเดอร์ | หน้าที่การทำงาน |
| :--- | :--- |
| `server.js` | Local Node.js Server รันที่พอร์ต **`3480`** (ใช้ SQLite `data/dlt_onsite.sqlite` และบันทึกรูปลง `data/uploads/`) |
| `start.bat` | สคริปต์รันระบบบน Windows และเปิดเบราว์เซอร์ที่ `http://localhost:3480` อัตโนมัติ |
| `worker.js` | Cloudflare Workers Entrypoint (โหลดข้อมูลตั้งต้นจาก `./data/seed_circuits.json` และให้บริการ API + Static Assets) |
| `wrangler.jsonc` | ไฟล์ตั้งค่า Cloudflare Workers (`compatibility_flags: ["nodejs_compat"]`) + Static Assets (`./public`) |
| `lib/completeness_and_line.js` | โมดูลกลางสำหรับตรวจความครบถ้วนรูปถ่าย 11 จุด, เปรียบเทียบ S/N (ช่างกรอก vs OCR), และจัดการสถานะของ LINE Bot |
| `lib/docx_generator.js` | โมดูลสร้างไฟล์รายงาน **MS Word (`.docx`)** แท้แบบ OpenXML (ZIP buffer) พร้อมฝังรูปสำเนาใบส่งมอบงานและรูปถ่ายอุปกรณ์ตามแบบฟอร์มปีที่แล้ว |
| `data/seed_circuits.json` | ข้อมูล Seed 334 วงจรครบทั้ง 77 จังหวัด ที่สกัดจากไฟล์โครงการ |
| `supabase/schema.sql` | สคริปต์สร้างตาราง PostgreSQL (`dlt_circuits`, `dlt_inspection_logs`) และ Storage Bucket บน Supabase |
| `public/index.html` | หน้าเว็บหลัก รองรับทั้งโหมดช่างมือถือ (Quick Jump), LINE Bot Simulator, Dashboard 77 จังหวัด, และ Admin QA Center |
| `public/app.js` | Frontend Logic ทั้งหมด (การค้นหาวงจร, กล้องถ่ายรูป, OCR สแกน S/N, LINE Bot Simulator, Admin QA, ตั้งค่า LINE Token) |
| `public/report.html` | หน้าแสดงและสั่งพิมพ์รายงาน (Print / Save as PDF) ขนาด A4 ตรงตามเล่มรายงานปีที่แล้ว |

---

## 3. การรันระบบในเครื่อง (Local Development)

```bash
# 1. ติดตั้ง Dependencies (หากยังไม่ได้ติดตั้ง)
npm install

# 2. รันโหมดพัฒนา (Auto-reload เมื่อแก้ไขไฟล์) หรือคลิกดับเบิลที่ start.bat
npm run dev
```

- เปิดเบราว์เซอร์ไปที่: **`http://localhost:3480`** (ค่าเริ่มต้นตั้งตามรหัสโครงการ `BINF3480xxx` หรือเปลี่ยนผ่านตัวแปร `PORT`)
- ข้อมูลที่บันทึกบนเครื่องจะถูกเก็บถาวรไว้ในฐานข้อมูล SQLite ที่ `data/dlt_onsite.sqlite` และไฟล์รูปภาพอยู่ที่ `data/uploads/<SO_NUMBER>/`

---

## 4. การเชื่อมต่อ LINE Official Account (LINE Bot Webhook)

1. เปิดเว็บไปที่แท็บ **"💬 LINE Bot ช่าง"** $\rightarrow$ กดปุ่ม **"⚙️ ตั้งค่า LINE Webhook / Token"** มุมขวาบน
2. นำ **Channel Secret** และ **Channel Access Token (Long-lived)** จาก [LINE Developers Console](https://developers.line.biz/console/) มาวางและกดบันทึก (หรือตั้งผ่าน Environment Variables: `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, `PUBLIC_BASE_URL`)
3. ตั้งค่า **Webhook URL** ใน LINE Developers Console เป็น:
   ```text
   https://dlt-onsite-inspection.pm-compass.workers.dev/api/line/webhook
   ```
4. คำสั่งที่ช่างพิมพ์คุยกับ LINE Bot ได้ทันที:
   - `checkin BINF3480006 ชื่อช่าง 0812345678` — เช็คอินเข้าหน้างาน
   - ส่งรูปถ่ายเข้าแชท — บอทจะเก็บลงหัวข้อปัจจุบันและอ่าน S/N ให้อัตโนมัติ
   - `sn F9260F967580` — ช่างพิมพ์ยืนยันรหัส S/N เพื่อเทียบกับ OCR
   - `เช็ครูป` หรือ `status` — ตรวจสอบว่าส่งรูปครบ 11 จุดหรือยัง
   - `checkout` หรือ `เช็คเอาท์` — เช็คเอาท์ส่งงานให้ Admin ตรวจพร้อมรับลิงก์ดาวน์โหลดไฟล์ Word (`.docx`)

---

## 5. การ Deploy ขึ้น GitHub และ Cloudflare Workers

### GitHub Repository
- **URL**: `https://github.com/soravut-rc/DLTonsite`
- คำสั่งอัปเดตโค้ดขึ้น GitHub:
  ```bash
  git add .
  git commit -m "Update DLT onsite system"
  git push origin main
  ```

### Cloudflare Workers & R2 Object Storage (Production)
- **Production URL ประจำโครงการ**: **`https://dlt-onsite-inspection.pm-compass.workers.dev`**
- **Cloudflare Account**: `Soravut@gmail.com's Account`
- **R2 Bucket เก็บรูปภาพ**: **`dlt-onsite-photos`** (ผูกผ่าน Binding `env.PHOTOS_BUCKET` ใน `wrangler.jsonc`)
- **คำสั่ง Deploy ขึ้น Cloudflare Workers**:
  ```bash
  # ตรวจสอบว่าอยู่ในไดเรกทอรีโปรเจกต์ D:\AI-Projects\DLTonsite
  npx wrangler deploy
  ```

---

## 6. ข้อควรระวังและข้อจำกัดในสถานะปัจจุบัน (Known Limitations & Production Notes)

1. **การจัดเก็บรูปถ่ายบน Cloudflare R2 (Object Storage — ฟรี 10 GB, $0 Egress)**
   - ระบบได้ผูกการเชื่อมต่อ **Cloudflare R2** ผ่าน Binding `PHOTOS_BUCKET` (Bucket: `dlt-onsite-photos` ในบัญชี `Soravut@gmail.com`) ใน `wrangler.jsonc` และ `worker.js` เรียบร้อยแล้ว
   - เมื่อช่างอัปโหลดรูปภาพผ่านเว็บหรือ LINE Bot บน Cloudflare รูปจะถูกบันทึกเข้า R2 อัตโนมัติ (และมี In-memory cache เป็น fallback) โดยลิงก์รูปยังคงเป็น `/uploads/...` แบบเดิม ทำให้รูปไม่สูญหายแม้ Worker รีสตาร์ท และไม่มีค่าใช้จ่าย Bandwidth (Egress $0)
   - สำหรับฝั่ง Database: สามารถใช้ SQLite ในเครื่อง (`server.js`) หรือเชื่อมต่อ Supabase/Cloudflare D1 ตามต้องการ

2. **รูปแบบโมดูลใน `worker.js` (Mixed CJS `require` + ESM `export default`)**
   - `worker.js` ใช้ `export default` ของ ES Module คู่กับ `require()` เพื่อดึง `lib/completeness_and_line.js`, `lib/docx_generator.js`, และ `data/seed_circuits.json` ซึ่ง `wrangler deploy` (ผ่าน esbuild + `nodejs_compat`) แปลงและ bundle ให้ได้อัตโนมัติ แต่หากย้ายไปใช้รันไทม์อื่นที่ไม่ได้ผ่าน bundler ควรแปลงเป็น ESM หรือ CJS ให้เป็นรูปแบบเดียวกัน

3. **ระบบยืนยันตัวตน (Authentication), CORS และ Supabase RLS**
   - ปัจจุบัน API เปิด `Access-Control-Allow-Origin: *` และยังไม่มีระบบ Login/Token สำหรับแยกสิทธิ์ช่างกับ Admin รวมถึง `supabase/schema.sql` ตั้งค่า RLS Policy เป็น Public Read/Write เพื่อความสะดวกในการทดสอบต้นแบบ (Prototype)
   - **ก่อนใช้งานจริง (Production)**: ควรเพิ่มระบบยืนยันตัวตน (เช่นรหัสผ่าน/PIN สำหรับ Admin QA หรือ LIFF Authentication สำหรับช่าง) และจำกัดสิทธิ์ RLS บน Supabase ให้แก้ไขได้เฉพาะผู้มีสิทธิ์

4. **การซิงก์ข้อมูลกับ Supabase (`syncCircuitToCloud` & `/api/cloud/sync`)**
   - อัปเดต `supabase/schema.sql` และ `server.js` ให้รองรับการซิงก์ฟิลด์ `checkin_time`, `checkout_time`, `admin_status`, `admin_name`, `admin_comment`, `admin_reviewed_at`, และ `line_user_id` ของตาราง `dlt_circuits` แล้ว (พร้อม fallback อัตโนมัติหากตารางปลายทางยังไม่ได้รัน `ALTER TABLE`) ทั้งนี้ตารางประวัติแชท `dlt_line_messages` และ `dlt_onsite_sessions` ยังเก็บเฉพาะใน SQLite ท้องถิ่น

5. **โฟลเดอร์ `Onsite/` (ไฟล์ PDF รายงานต้นฉบับปีที่แล้ว ~758 MB)**
   - โฟลเดอร์ `Onsite/` ที่มีไฟล์ PDF ต้นฉบับของปีที่แล้วถูกใส่ไว้ใน `.gitignore` เพื่อไม่ให้ขนาดเกินลิมิตของ GitHub และ Cloudflare Workers หากต้องการเปิดดูไฟล์ PDF เก่าผ่านลิงก์ในระบบ Local (`server.js`) ต้องมีโฟลเดอร์ `Onsite/` วางอยู่ในเครื่องที่รัน `server.js`
