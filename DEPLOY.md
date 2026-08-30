# วิธี deploy โค้ดโรงขวด P&K 🚀

repo นี้มี **2 ท่อ** ที่แยกกันเด็ดขาด — รู้ว่าแก้อะไรไป จะได้รู้ว่าต้องทำอะไรต่อ

| แก้ไฟล์ไหน | ขึ้นของจริงยังไง |
|---|---|
| `index.html` · `exec/index.html` · `finance/index.html` (หน้าเว็บ) | **push `main` = ขึ้นเอง** ผ่าน GitHub Pages ใน ~1 นาที ไม่ต้องทำอะไร |
| `gas/Code.gs` · `finance/gas/Code.gs` (หลังบ้าน) | ต้องขึ้น Google Apps Script — ดูข้างล่าง |

---

## 🤖 deploy หลังบ้านอัตโนมัติ (ชุดเดียวกับ repo โรงน้ำ `origin-hq`)

**แก้ `.gs` เสร็จ → push `main` → GitHub ส่งขึ้น Google ให้เอง** ไม่ต้องเปิดคอม ไม่ต้องก๊อปวาง

- ทำงานเฉพาะตอนไฟล์ `.gs` เปลี่ยนจริง — แก้แค่ `STATUS.md`/เอกสาร ไม่ deploy (ไม่เปลืองเลขเวอร์ชัน)
- ใช้ `clasp redeploy` = **URL เดิม** ลิงก์ที่แจกทีมไม่พัง (ไม่ใช่ `deploy` ที่สร้าง URL ใหม่)
- **มี smoke test**: หลัง redeploy ระบบยิง `?action=pkHealth` จริง แล้วต้องได้ `CODE_VERSION` ตัวที่เพิ่งวาง
  ถ้าไม่ตรง = workflow แดง รู้ทันทีว่าไม่ได้ขึ้นจริง (ไม่ใช่คิดไปเองว่าขึ้นแล้ว)
- **ดูผล / สั่งรันเอง**: https://github.com/palmsil2026/pk-hq/actions → workflow **Deploy to Apps Script** → ปุ่ม **Run workflow**

### ✅ ตั้งค่าครบแล้ว 30 ส.ค. 2026 — ใช้งานได้จริง (บันทึกไว้เผื่อต้องตั้งใหม่)

**1. ใส่ token ลง GitHub Secret** — ✅ **ใส่แล้ว**

1. เปิด cmd พิมพ์ `notepad %USERPROFILE%\.clasprc.json` → **คัดลอกทั้งไฟล์** (Ctrl+A, Ctrl+C)
   (ถ้าไม่มีไฟล์ ให้พิมพ์ `clasp login` ก่อน — เคยทำตอนตั้ง `origin-hq` แล้ว น่าจะมีอยู่)
2. เปิด https://github.com/palmsil2026/pk-hq/settings/secrets/actions → **New repository secret**
3. Name: `CLASPRC_JSON` · Secret: วางข้อความที่ก๊อปมา → **Add secret**

> ⚠️ ไฟล์นี้เท่ากับรหัสผ่าน Google **ห้ามวางในแชท ห้าม commit** ใส่ในช่อง Secret ของ GitHub เท่านั้น
> (workflow ลบไฟล์ token ทิ้งทุกครั้งหลังรันเสร็จ · ถอนสิทธิ์ได้ตลอดโดยลบ Secret ทิ้ง
> หรือถอนที่ต้นทาง https://myaccount.google.com/permissions → **clasp** → Remove access)

**2. เติม Script ID** — ✅ **ใส่แล้ว** (คุณปาล์มให้มา 30 ส.ค.)

| โปรเจกต์ GAS | โฟลเดอร์ | Script ID | deployment ที่ทีมใช้ |
|---|---|---|---|
| **P&K System** | `gas/` | `1ARJwDhIahovJ7rxCNyY93Ey7LH2LbQEXK5NZGLLARujLhkzup_ON61yr` | `AKfycbw8guY7h7Q_...meWH-` |
| **Bottle Finance** | `finance/gas/` | ⏳ ยังไม่ได้สร้างโปรเจกต์ | — |

> Script ID ไม่ใช่ความลับ (เก็บใน repo ได้) ต่างจาก token ข้อ 1 ที่ห้ามบอกใคร

> **P&K HR (เงินเดือน)** ไม่ได้อยู่ repo นี้ — โค้ดอยู่ `origin-hq` → `payroll-app/`
> และเข้าระบบ deploy อัตโนมัติของ repo นั้นแล้ว

---

## 🖐 วางมือ (ใช้ตอนระบบอัตโนมัติยังไม่พร้อม)

1. เปิด `gas/Code.gs` จาก branch **`main`** → ก๊อปทั้งไฟล์
2. เปิดโปรเจกต์ **P&K System** ใน script.google.com → เลือกทั้งหมดในไฟล์ `Code.gs` → วางทับ → 💾
3. **Deploy → Manage deployments → ✏️ (ดินสอ) → Version: New version → Deploy**

> 🚨 **ห้ามกด "New deployment"** — URL จะเปลี่ยน แล้วลิงก์ที่แจกทีมพังหมด ต้องแก้ในหน้าเว็บตามอีกที
> ปุ่มที่ถูกคือ **Manage deployments** แล้วกด**ดินสอ**ของอันเดิม

---

## 🔎 เช็คว่าขึ้นจริงรึยัง — ดูในแอปได้เลย

ท้ายหน้าแอปทีมงานและบอร์ดบริหารมีบรรทัด:

```
เวอร์ชัน · หน้าเว็บ 2026-08-30k · ระบบหลังบ้าน 2026-08-30k
```

- **สองเลขตรงกัน** = ขึ้นครบแล้ว
- **เลขหลังบ้านเป็นสีส้ม + มีแถบเตือนบนหัวแอป** = หน้าเว็บใหม่แล้ว แต่ `.gs` ยังไม่ได้วาง
- อยากเช็คจากข้างนอกโดยไม่ต้องล็อกอิน: เปิด `<exec URL>?action=pkHealth`
  ตอบ `version` · `sheet` · `schemaAt` (เวอร์ชันที่โครงชีตถูกปรับตามล่าสุด)

## 🧱 โครงชีตปรับตามให้เอง

โค้ดรุ่นใหม่มักเพิ่มแท็บ/คอลัมน์ที่ชีตเดิมยังไม่มี — **ตั้งแต่ `2026-08-30k` ไม่ต้องรัน `setupPkSystem()` เองแล้ว**
คำขอแรกหลังเวอร์ชันเปลี่ยน ระบบเรียกให้เองอัตโนมัติ (`autoMigrate_()` — เติมคอลัมน์ต่อท้ายอย่างเดียว
ไม่แทรกกลาง ไม่ลบ ไม่แตะข้อมูลเก่า) แล้วจำไว้ใน Script Property `SCHEMA_AT` ทำครั้งเดียวต่อเวอร์ชัน

ยกเว้น **ครั้งแรกสุดตอนยังไม่มีชีต** — ต้องรัน `setupPkSystem()` ใน editor เองหนึ่งครั้ง
ส่วน `seedProducts()` · `seedMachines()` · `importLegacy*()` เป็นการ**นำเข้าข้อมูล** ยังต้องสั่งเอง (รันซ้ำได้ ไม่เบิ้ล)

## ⚠️ ข้อควรระวัง

| เรื่อง | ทำไม |
|---|---|
| `redeploy` ไม่ใช่ `deploy` | `deploy` = สร้าง URL ใหม่ / `redeploy` = อัปเดตของเดิม URL เท่าเดิม |
| แก้ `.gs` แล้วต้อง bump `CODE_VERSION` | ไม่งั้น smoke test กับบรรทัดเวอร์ชันในแอปแยกไม่ออกว่ารุ่นไหน |
| แก้หน้าเว็บแล้วต้อง bump `WEB_VERSION` | ค่าคงที่หัวไฟล์ `index.html` / `exec/index.html` |
| อย่าแก้ `appsscript.json` เอง | คุมสิทธิ์ web app (Execute as / Who has access) แก้ผิด = ทีมเปิดแอปไม่ได้ทั้งทีม<br>(workflow ดึงตัวจริงจากโปรเจกต์มาทับก่อน push ทุกครั้ง ไฟล์ใน repo เป็นแค่ตัวสำรอง) |
| ห้ามส่ง `~/.clasprc.json` ให้ใคร | เท่ากับให้รหัสผ่าน Google |
