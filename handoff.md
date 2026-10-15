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
   - ระบบตรวจสอบว่ารูปถ่ายครบทั้ง **11 จุด** หรือไม่:
     1. `router_device` — 1.1 รูปถ่ายจุดติดตั้ง MikroTik ตัวที่ 1 (พร้อม S/N + OCR)
     2. `router_lan2` — 1.2 รูปภาพ Test speed port LAN 2
     3. `router_lan3` — 1.3 รูปภาพ Test speed port LAN 3
     4. `ap1_device` — 2.1.1 รูปถ่าย Access Point ณ จุดติดตั้ง ตัวที่ 1 (พร้อม S/N + OCR)
     5. `ap1_wifi` — 2.1.2 รูปภาพ Test speed ผ่าน WiFi (AP ตัวที่ 1)
     6. `ap1_lan` — 2.1.3 รูปภาพ Test speed ผ่านสาย LAN (AP ตัวที่ 1)
     7. `ap2_device` — 2.2.1 รูปถ่าย Access Point ณ จุดติดตั้ง ตัวที่ 2 (พร้อม S/N + OCR)
     8. `ap2_wifi` — 2.2.2 รูปภาพ Test speed ผ่าน WiFi (AP ตัวที่ 2)
     9. `ap2_lan` — 2.2.3 รูปภาพ Test speed ผ่านสาย LAN (AP ตัวที่ 2)
     10. `handover_page1` — 4.1 สำเนาเอกสาร "แบบส่งมอบงาน" หน้าที่ 1/2
     11. `handover_page2` — 4.2 สำเนาเอกสาร "แบบส่งมอบงาน" หน้าที่ 2/2 (ลงนาม + ประทับตรา)

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
| `worker.js` | Cloudflare Workers Entrypoint สำหรับรันระบบแบบ Serverless บน Cloudflare |
| `wrangler.jsonc` | ไฟล์ตั้งค่า Cloudflare Workers + Static Assets (`./public`) |
| `lib/completeness_and_line.js` | โมดูลกลางสำหรับตรวจความครบถ้วนรูปถ่าย 11 จุด, เปรียบเทียบ S/N (ช่างกรอก vs OCR), และจัดการสถานะของ LINE Bot |
| `lib/docx_generator.js` | โมดูลสร้างไฟล์รายงาน **MS Word (`.docx`)** แท้แบบ OpenXML (ZIP buffer) พร้อมฝังรูปสำเนาใบส่งมอบงานและรูปถ่ายอุปกรณ์ตามแบบฟอร์มปีที่แล้ว |
| `lib/seed_data.js` | ข้อมูลตั้งต้น 334 วงจรครบทั้ง 77 จังหวัด สำหรับ Cloudflare Workers |
| `public/index.html` | หน้าเว็บหลัก รองรับทั้งโหมดช่างมือถือ (Quick Jump), LINE Bot Simulator, Dashboard 77 จังหวัด, และ Admin QA Center |
| `public/app.js` | Frontend Logic ทั้งหมด (การค้นหาวงจร, กล้องถ่ายรูป, OCR สแกน S/N, LINE Bot Simulator, Admin QA, ตั้งค่า LINE Token) |
| `public/report.html` | หน้าแสดงและสั่งพิมพ์รายงาน (Print / Save as PDF) ขนาด A4 ตรงตามเล่มรายงานปีที่แล้ว |
| `data/seed_circuits.json` | ข้อมูล Seed 334 วงจรที่สกัดจากไฟล์โครงการ |

---

## 3. การรันระบบในเครื่อง (Local Development)

```bash
# 1. ติดตั้ง Dependencies (หากยังไม่ได้ติดตั้ง)
npm install

# 2. รันโหมดพัฒนา (Auto-reload เมื่อแก้ไขไฟล์)
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
   https://<YOUR-DOMAIN>/api/line/webhook
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

### Cloudflare Workers
- **Preview URL ล่าสุด**: `https://dlt-onsite-inspection.mixed-foxtail.workers.dev`
- คำสั่ง Deploy ขึ้นบัญชี Cloudflare ของคุณ:
  ```bash
  # กรณีล็อกอินบัญชี Cloudflare ถาวร
  npx wrangler login
  npx wrangler deploy

  # หรือกรณี Deploy ทดสอบแบบไม่ต้องใช้ Token
  npx wrangler deploy --temporary
  ```
- **หมายเหตุสำหรับงาน Production ที่มีรูปถ่ายครบทั้ง 334 วงจร (~3,674 รูป)**:
  - โค้ดเว็บและข้อมูล Text ทั้ง 334 วงจรใช้พื้นที่เพียง **~1.1 MB (gzip 52 KB)** ซึ่งอยู่ในเกณฑ์ **Cloudflare Free Plan** สบายมาก
  - สำหรับการจัดเก็บรูปถ่ายถาวรบน Cloudflare แนะนำให้ผูก **Cloudflare D1** (เก็บสถานะตาราง) และ **Cloudflare R2** (เก็บรูปภาพ ฟรี 10 GB/เดือน) เข้ากับ `worker.js` ในเฟสถัดไป
