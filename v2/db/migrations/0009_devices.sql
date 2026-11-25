-- ═══════════════════════════════════════════════════════════════════════════
--  0009_devices — ที่เก็บข้อมูลมิเตอร์/อุปกรณ์ในอนาคต (โครงเบา ๆ · ยังไม่มีอุปกรณ์จริง)
--  หลัก: "ของที่เครื่องวัดได้ห้ามให้คนกรอก" — ไฟสถานะในแผนผัง · ค่าไฟต่อ 1,000 ใบ · ตัวนับเทียบกับที่คนลง
--  อุปกรณ์ส่งค่าเข้ามาเองผ่าน action ของโมดูลผลิต (ภายหลัง) · ค่าดิบเขียนเพิ่มอย่างเดียว
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE devices (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,                  -- vocab devices.kind: มิเตอร์ไฟ · ตัวนับ · อุณหภูมิ · แรงดันลม · มิเตอร์น้ำ
  machine_id TEXT REFERENCES machines(id),   -- NULL = มิเตอร์รวม (หม้อแปลง/ตู้ MDB/โซลาร์)
  name       TEXT NOT NULL DEFAULT '',
  unit       TEXT NOT NULL DEFAULT '',       -- 'kWh' 'ใบ' '°C' 'bar' 'm³'
  status     TEXT NOT NULL DEFAULT 'ใช้งาน',
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
);
CREATE INDEX devices_machine ON devices(machine_id);

CREATE TABLE device_readings (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL REFERENCES devices(id),
  at        TEXT NOT NULL,
  value     REAL NOT NULL,                   -- ค่าดิบตามหน่วยของอุปกรณ์ (ค่าวัด ไม่ใช่เงิน/จำนวนสินค้า — REAL ได้)
  kind      TEXT NOT NULL DEFAULT 'ค่าสะสม' CHECK (kind IN ('ค่าสะสม', 'ค่าขณะนั้น', 'สถานะ')),
  src       TEXT NOT NULL DEFAULT 'อุปกรณ์'
);
CREATE INDEX device_readings_dev ON device_readings(device_id, at);
