-- ═══════════════════════════════════════════════════════════════════════════
--  0001_core — ของกลางทั้งระบบ (Foundation) · โรงขวด P&K v2 · D1 `pk-v2`
--  ข้อตกลงทุกตาราง (ดู v2/db/SCHEMA.md):
--    · เวลา  *_at  = ISO UTC แบบ toISOString() ยาว 24 ตัว ("2026-11-16T03:04:05.678Z")
--    · วันที่ *_day = วันที่ไทย (UTC+7 คงที่) "YYYY-MM-DD"
--    · เงิน  *_satang = จำนวนเต็มสตางค์ · จำนวนของ *_pcs = จำนวนเต็ม "ใบ/ชิ้น"
--    · ไม่มี DELETE (trigger กันใน 0011) · ย้อน/ยกเลิก = พลิกสถานะ
--    · version = optimistic lock (UPDATE … WHERE version = ? แล้ว version + 1)
--    · src = ที่มาของแถว ('v2' = ลงจากแอปนี้ · 'legacy:…' / 'pk:…' / 'acct:…' = นำเข้า · 'ref:…' = ทะเบียนใน repo · 'demo' = ข้อมูลสมมติ)
--    · ค่าสถานะ/ประเภท ตรวจกับตาราง vocab ด้วย trigger (โมดูลเพิ่มค่าใหม่ = INSERT vocab ใน migration ของตัวเอง ไม่ต้องรื้อตาราง)
-- ═══════════════════════════════════════════════════════════════════════════

-- กันชน: INSERT แถวที่ code ≠ '' = ล้มทั้ง batch (ใช้ทำ "ด่าน" optimistic version / เงื่อนไขในชุดคำสั่งเดียว — SQLite นอก trigger ใช้ RAISE ไม่ได้)
CREATE TABLE _guard (
  code TEXT NOT NULL CHECK (code = '')
);

-- คลังค่าที่อนุญาต (สถานะ · ประเภท · เหตุผล) — kind = "<ตาราง>.<คอลัมน์>" หรือชื่อรายการเหตุผล
CREATE TABLE vocab (
  kind  TEXT NOT NULL,
  value TEXT NOT NULL,
  pos   INTEGER NOT NULL DEFAULT 0,
  label TEXT NOT NULL DEFAULT '',          -- คำบนจอ (ว่าง = ใช้ value)
  tone  TEXT NOT NULL DEFAULT '' CHECK (tone IN ('', 'ok', 'warn', 'bad', 'mute', 'brand')),  -- สีของป้ายสถานะ
  note  TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (kind, value)
);

-- ค่าตั้งของระบบ (แก้จากหน้าประธาน — ไม่ใช่ความลับ · ความลับอยู่ใน Cloudflare secret)
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT '',
  version    INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
);

-- บทบาท = แอปที่เปิดได้ (office · prod · screen · deliver · account · exec)
CREATE TABLE roles (
  code    TEXT PRIMARY KEY CHECK (code IN ('office', 'prod', 'screen', 'deliver', 'account', 'exec')),
  name_th TEXT NOT NULL,
  dept_th TEXT NOT NULL UNIQUE,            -- ค่าในคอลัมน์ "แผนก" ของชีต Staff
  pos     INTEGER NOT NULL DEFAULT 0
);

-- พนักงาน — ⚠️ ไม่มี PIN (PIN อยู่ในชีต Staff ที่ Google เท่านั้น)
--   pin_fp = ลายนิ้วมือ PIN (HMAC ด้วยกุญแจที่อยู่ใน GAS เท่านั้น — ถอดกลับเป็น PIN ไม่ได้ · เดาไม่ได้แม้มีฐานนี้ทั้งก้อน)
--   pf_at  = เวลา (ms) ของลายนิ้วมือนี้ — ตั๋วที่ใหม่กว่า + ลายนิ้วมือต่าง = PIN ถูกเปลี่ยน → รับของใหม่ ตั๋วเก่าตาย
CREATE TABLE staff (
  id         TEXT PRIMARY KEY,                       -- Staff_ID ของชีต (S001…)
  name       TEXT NOT NULL DEFAULT '',
  nick       TEXT NOT NULL,
  dept_th    TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'ทำงาน',
  pin_fp     TEXT NOT NULL DEFAULT '',
  pf_at      INTEGER NOT NULL DEFAULT 0,
  src        TEXT NOT NULL DEFAULT 'v2',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  CHECK (length(trim(nick)) > 0),
  CHECK (length(pin_fp) IN (0, 22))
);
CREATE INDEX staff_status ON staff(status);

CREATE TABLE staff_roles (
  staff_id TEXT NOT NULL REFERENCES staff(id),
  role     TEXT NOT NULL REFERENCES roles(code),
  active   INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),   -- ถอดบทบาท = 0 (ไม่ลบแถว)
  PRIMARY KEY (staff_id, role)
);
CREATE INDEX staff_roles_role ON staff_roles(role, active);

-- สมุดประวัติ — ทุก action ที่เขียนข้อมูลมีแถวที่นี่ใน batch เดียวกัน · เขียนเพิ่มได้อย่างเดียว (trigger กันแก้/ลบใน 0011)
CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  day        TEXT NOT NULL,
  staff_id   TEXT NOT NULL,                  -- จากตั๋ว (ไม่เชื่อหน้าเว็บ) · 'system' = งานระบบ (นำเข้า/ตั้งค่า)
  staff_name TEXT NOT NULL DEFAULT '',       -- ชื่อเล่น ณ ตอนนั้น (จากตาราง staff)
  role       TEXT NOT NULL DEFAULT '',       -- บทบาทที่ใช้ทำ
  action     TEXT NOT NULL,                  -- ชื่อ action เช่น 'order.create'
  entity     TEXT NOT NULL DEFAULT '',       -- ตาราง
  entity_id  TEXT NOT NULL DEFAULT '',
  before_json TEXT NOT NULL DEFAULT '',      -- ค่าก่อน (เฉพาะช่องที่เปลี่ยน) · ว่าง = แถวใหม่
  after_json  TEXT NOT NULL DEFAULT '',      -- ค่าหลัง
  reason     TEXT NOT NULL DEFAULT '',       -- เหตุผลที่คนใส่ (ชิป/พิมพ์เอง)
  req_key    TEXT NOT NULL DEFAULT '',       -- idempotency key ของคำขอ
  undo_of    INTEGER REFERENCES audit_log(id),  -- แถวนี้คือการย้อนของแถวไหน
  CHECK (length(at) = 24 AND substr(at, 11, 1) = 'T' AND substr(at, 24, 1) = 'Z'),
  CHECK (length(day) = 10 AND substr(day, 5, 1) = '-' AND substr(day, 8, 1) = '-')
);
CREATE INDEX audit_entity ON audit_log(entity, entity_id, id);
CREATE INDEX audit_day ON audit_log(day, staff_id);
CREATE INDEX audit_action ON audit_log(action, id);
CREATE INDEX audit_req ON audit_log(req_key);

-- กันกดซ้ำ: คำขอเดิม (กุญแจเดิม) = คืนผลเดิม ไม่ทำซ้ำ · กุญแจเดิมแต่เนื้อคำขอต่าง = ปฏิเสธ
CREATE TABLE idempotency (
  key         TEXT PRIMARY KEY CHECK (length(key) BETWEEN 8 AND 80),
  staff_id    TEXT NOT NULL,
  action      TEXT NOT NULL,
  req_hash    TEXT NOT NULL,
  result_json TEXT NOT NULL,
  at          TEXT NOT NULL
);
CREATE INDEX idempotency_at ON idempotency(at);

-- "ย้อน" ของกลาง: 1 แถวต่อการบันทึกที่ย้อนได้ · ops_json = คำสั่งพลิกกลับที่ระบบคิดไว้ตอนบันทึก
--   ย้อนได้เมื่อ: status = 'พร้อมย้อน' · ยังไม่เลย until_at · ทุกแถวที่ถูกแตะยังเป็น version เดิม (ขั้นถัดไปยังไม่แตะ) · ด่านเฉพาะ action ผ่าน
CREATE TABLE undo_log (
  id         TEXT PRIMARY KEY,
  audit_id   INTEGER NOT NULL REFERENCES audit_log(id),
  staff_id   TEXT NOT NULL,
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL DEFAULT '',
  entity_id  TEXT NOT NULL DEFAULT '',
  label      TEXT NOT NULL DEFAULT '',       -- ข้อความบนแถบ "ย้อน" เช่น "ลงออเดอร์ ร้านตัวอย่าง A"
  ops_json   TEXT NOT NULL,
  until_at   TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'พร้อมย้อน',
  undone_at  TEXT NOT NULL DEFAULT '',
  undone_by  TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
);
CREATE INDEX undo_entity ON undo_log(entity, entity_id, status);
CREATE INDEX undo_staff ON undo_log(staff_id, created_at);

-- ธง/ข้อยกเว้น: "ระบบหาข้อยกเว้น คนตัดสิน" — ทุกเคสแปลกที่ทำต่อได้ (มีเหตุผล) ขึ้นธงให้ประธาน/ทีมที่เกี่ยวดูย้อนหลังได้
CREATE TABLE flags (
  id          TEXT PRIMARY KEY,
  at          TEXT NOT NULL,
  day         TEXT NOT NULL,
  kind        TEXT NOT NULL,                 -- vocab flags.kind เช่น 'ราคาไม่ตรงทะเบียน' 'รอบค้าง' 'ยอดไม่ตรง'
  severity    TEXT NOT NULL DEFAULT 'ดู',
  team        TEXT NOT NULL DEFAULT '' CHECK (team IN ('', 'office', 'prod', 'screen', 'deliver', 'account', 'exec')),  -- ทีมต้นเรื่อง ('' = ระบบ)
  entity      TEXT NOT NULL DEFAULT '',
  entity_id   TEXT NOT NULL DEFAULT '',
  title       TEXT NOT NULL,
  detail      TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'เปิด',
  raised_by   TEXT NOT NULL DEFAULT '',
  resolved_by TEXT NOT NULL DEFAULT '',
  resolved_at TEXT NOT NULL DEFAULT '',
  resolution  TEXT NOT NULL DEFAULT '',
  dedupe_key  TEXT,                          -- ธงเดียวกันซ้ำ (เช่นรอบค้างเครื่องเดิม) ไม่ขึ้นสองใบ
  req_key     TEXT NOT NULL DEFAULT '',      -- คำขอที่ทำให้เกิดธง — ย้อนคำขอนั้น = ปิดธงนี้ให้เอง
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
);
CREATE INDEX flags_open ON flags(status, team, at);
CREATE INDEX flags_entity ON flags(entity, entity_id);
CREATE INDEX flags_req ON flags(req_key);
CREATE UNIQUE INDEX flags_dedupe ON flags(dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'เปิด';

-- รอบนำเข้า/ส่งออก (สะพาน Google) — ดูย้อนหลังได้ว่าดึงอะไร เมื่อไหร่ ได้กี่แถว
CREATE TABLE sync_runs (
  id          TEXT PRIMARY KEY,
  source      TEXT NOT NULL,                 -- 'staff' · 'pk:Customers' · 'legacy:order' · 'acct' · 'ref:products' …
  kind        TEXT NOT NULL DEFAULT 'import',
  status      TEXT NOT NULL DEFAULT 'กำลังทำ',
  started_at  TEXT NOT NULL,
  finished_at TEXT NOT NULL DEFAULT '',
  cursor      TEXT NOT NULL DEFAULT '',      -- ตำแหน่งหน้าถัดไป ('' = เริ่ม/จบ)
  pages       INTEGER NOT NULL DEFAULT 0 CHECK (pages >= 0),
  rows_in     INTEGER NOT NULL DEFAULT 0 CHECK (rows_in >= 0),
  inserted    INTEGER NOT NULL DEFAULT 0 CHECK (inserted >= 0),
  updated     INTEGER NOT NULL DEFAULT 0 CHECK (updated >= 0),
  skipped     INTEGER NOT NULL DEFAULT 0 CHECK (skipped >= 0),
  error       TEXT NOT NULL DEFAULT '',
  by          TEXT NOT NULL DEFAULT '',
  version     INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
);
CREATE INDEX sync_runs_source ON sync_runs(source, started_at);

-- แผนที่ "แถวต้นทาง → แถวในระบบ" — นำเข้าซ้ำกี่รอบก็ไม่เบิ้ล · hash = ลายนิ้วมือเนื้อแถวต้นทาง (ไม่เปลี่ยน = ข้าม)
CREATE TABLE import_map (
  source     TEXT NOT NULL,
  source_key TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  TEXT NOT NULL,
  hash       TEXT NOT NULL DEFAULT '',
  first_at   TEXT NOT NULL,
  last_at    TEXT NOT NULL,
  PRIMARY KEY (source, source_key)
);
CREATE INDEX import_map_entity ON import_map(entity, entity_id);

-- เลขรันของเอกสารที่ต้องเรียงต่อกัน (เช่นเลขบิล) — server/core.mjs › nextNumber() ขยับด้วย UPSERT … RETURNING
--   (รหัสแถวทั่วไปใช้ newId() แบบสุ่มเรียงตามเวลา ไม่ต้องใช้ตัวนับ · รหัสไม่ขึ้นจอผู้ใช้อยู่แล้ว)
CREATE TABLE counters (
  key   TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0 CHECK (value >= 0)
);
