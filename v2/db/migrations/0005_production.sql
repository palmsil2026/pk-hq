-- ═══════════════════════════════════════════════════════════════════════════
--  0005_production — เครื่องจักร (ทะเบียน + ตำแหน่งในผัง) · งานผลิต · รอบเครื่อง · เหตุการณ์เครื่อง
--  ที่มา: docs/factory/README.md (ผังโรง 1/โรง 2 · 15 พ.ย. 69) + แท็บ ProductionLog ของ "Stock Management" (3,555 รอบ)
--  งานผลิตของเดิม = "รอบเครื่อง" ผลิตเข้าสต๊อก ไม่ผูกออเดอร์ → machine_runs.job_id เป็น NULL ได้
--  รอบข้ามเที่ยงคืนได้: เก็บเวลาจริงเป็น ISO UTC + วันไทยของตอนเริ่ม/ตอนปิด แยกกัน
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE machines (
  id          TEXT PRIMARY KEY,              -- 'PET1' 'K1' 'S1' 'AIR1' … (ไม่ขึ้นจอ)
  name        TEXT NOT NULL UNIQUE,          -- ชื่อบนจอ/ในผัง 'PET 1'
  kind        TEXT NOT NULL,                 -- vocab machines.kind: เป่า · ฉีด · สกรีน · ลม · น้ำเย็น · ไฟฟ้า · อื่น
  plant       TEXT NOT NULL DEFAULT '',      -- 'โรง 1' / 'โรง 2'
  -- ตำแหน่งในแผนผัง (ตาราง 1 ช่อง = 1 หน่วย · ร่างจากรูปผัง รอผังจริง) — หน้าแผนผังวาดจากค่าเหล่านี้
  pos_x       INTEGER NOT NULL DEFAULT 0 CHECK (pos_x >= 0),
  pos_y       INTEGER NOT NULL DEFAULT 0 CHECK (pos_y >= 0),
  w           INTEGER NOT NULL DEFAULT 1 CHECK (w >= 1),
  h           INTEGER NOT NULL DEFAULT 1 CHECK (h >= 1),
  makes       TEXT NOT NULL DEFAULT '',      -- ที่จดไว้ว่าทำอะไรได้ (ลายมือ) เช่น 'เป่า 600 ml ทรง MK · คอยาว/คอสั้น'
  rating      TEXT NOT NULL DEFAULT '',      -- ขนาดไฟ/กำลัง เช่น '50A' (ระบบลม/ไฟฟ้า)
  legacy_name TEXT NOT NULL DEFAULT '',      -- ชื่อในแอปเดิม ('SHE230G PET')
  status      TEXT NOT NULL DEFAULT 'ใช้งาน',
  note        TEXT NOT NULL DEFAULT '',
  src         TEXT NOT NULL DEFAULT 'v2',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
);
CREATE INDEX machines_plant ON machines(plant, kind);
CREATE INDEX machines_legacy ON machines(legacy_name);

-- งานผลิต (เกิดจากออเดอร์ หรือผลิตเข้าสต๊อก) — 1 งาน = 1 สเปก
CREATE TABLE production_jobs (
  id             TEXT PRIMARY KEY,
  order_id       TEXT REFERENCES orders(id),
  order_item_id  TEXT REFERENCES order_items(id),
  type           TEXT NOT NULL,
  size           TEXT NOT NULL DEFAULT '',
  neck           TEXT NOT NULL DEFAULT '',
  shape          TEXT NOT NULL DEFAULT '',
  color          TEXT NOT NULL DEFAULT '',
  spec_key       TEXT NOT NULL,
  target_pcs     INTEGER NOT NULL DEFAULT 0 CHECK (typeof(target_pcs) = 'integer' AND target_pcs >= 0),
  good_pcs       INTEGER NOT NULL DEFAULT 0 CHECK (typeof(good_pcs) = 'integer' AND good_pcs >= 0),   -- สะสมจากรอบที่ปิดแล้ว
  status         TEXT NOT NULL DEFAULT 'รอผลิต',
  due_day        TEXT NOT NULL DEFAULT '',
  urgent         INTEGER NOT NULL DEFAULT 0 CHECK (urgent IN (0, 1)),
  pending_reason TEXT NOT NULL DEFAULT '',
  note           TEXT NOT NULL DEFAULT '',
  src            TEXT NOT NULL DEFAULT 'v2',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  version        INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
);
CREATE INDEX production_jobs_status ON production_jobs(status, due_day);
CREATE INDEX production_jobs_order ON production_jobs(order_id);

-- รอบเครื่อง: เริ่มเครื่อง → (เปลี่ยนสี = ปิดรอบเดิม + เปิดรอบใหม่) → ปิดรอบ ลง ดี / เกรด B / เสีย
CREATE TABLE machine_runs (
  id           TEXT PRIMARY KEY,
  machine_id   TEXT NOT NULL REFERENCES machines(id),
  job_id       TEXT REFERENCES production_jobs(id),   -- NULL = ผลิตเข้าสต๊อก (แบบแอปเดิม)
  type         TEXT NOT NULL,
  size         TEXT NOT NULL DEFAULT '',
  neck         TEXT NOT NULL DEFAULT '',
  shape        TEXT NOT NULL DEFAULT '',
  color        TEXT NOT NULL DEFAULT '',
  spec_key     TEXT NOT NULL,
  started_at   TEXT NOT NULL,
  started_day  TEXT NOT NULL,
  ended_at     TEXT NOT NULL DEFAULT '',     -- '' = ยังเดินอยู่
  ended_day    TEXT NOT NULL DEFAULT '',
  end_kind     TEXT NOT NULL DEFAULT '',     -- 'ปิดรอบ' / 'เปลี่ยนสี' / 'ยกเลิก'
  good_pcs     INTEGER CHECK (good_pcs IS NULL OR (typeof(good_pcs) = 'integer' AND good_pcs >= 0)),        -- NULL = ยังไม่ลง
  grade_b_pcs  INTEGER CHECK (grade_b_pcs IS NULL OR (typeof(grade_b_pcs) = 'integer' AND grade_b_pcs >= 0)),
  waste_pcs    INTEGER CHECK (waste_pcs IS NULL OR (typeof(waste_pcs) = 'integer' AND waste_pcs >= 0)),
  counter_pcs  INTEGER CHECK (counter_pcs IS NULL OR (typeof(counter_pcs) = 'integer' AND counter_pcs >= 0)),  -- ตัวนับจากเครื่อง (อนาคต — คนไม่กรอก)
  waste_reason TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'กำลังผลิต',
  opened_by    TEXT NOT NULL DEFAULT '',     -- staff.id จากตั๋ว
  closed_by    TEXT NOT NULL DEFAULT '',
  note         TEXT NOT NULL DEFAULT '',
  src          TEXT NOT NULL DEFAULT 'v2',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  version      INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  CHECK (length(started_at) = 24 AND substr(started_at, 24, 1) = 'Z'),
  CHECK (ended_at = '' OR (length(ended_at) = 24 AND ended_at >= started_at)),
  CHECK ((ended_at = '') = (ended_day = ''))
);
CREATE INDEX machine_runs_machine ON machine_runs(machine_id, started_at);
CREATE INDEX machine_runs_open ON machine_runs(status, machine_id);
CREATE INDEX machine_runs_day ON machine_runs(started_day);
CREATE INDEX machine_runs_job ON machine_runs(job_id);
-- เครื่องหนึ่งมีรอบที่ "กำลังผลิต" ได้ทีละรอบ (กดเปิดซ้อน/สองคนกดพร้อมกัน = รอบที่สองล้ม)
CREATE UNIQUE INDEX machine_runs_one_open ON machine_runs(machine_id) WHERE status = 'กำลังผลิต';

-- ผู้ปฏิบัติงานของรอบ (หลายคน) — ของเดิมพิมพ์ชื่ออิสระ "ไก่ , กานต์" → name_text เก็บตามจริง · staff_id ถ้าจับคู่ได้
CREATE TABLE run_operators (
  run_id    TEXT NOT NULL REFERENCES machine_runs(id),
  name_text TEXT NOT NULL,
  staff_id  TEXT REFERENCES staff(id),
  active    INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  PRIMARY KEY (run_id, name_text)
);
CREATE INDEX run_operators_staff ON run_operators(staff_id);

-- เหตุการณ์เครื่อง: จอดเครื่อง (+สาเหตุ) · เดินต่อ · เปลี่ยนโมลด์ · ซ่อม — มีช่วงเวลา (ended_at '' = ยังไม่จบ)
CREATE TABLE machine_events (
  id          TEXT PRIMARY KEY,
  machine_id  TEXT NOT NULL REFERENCES machines(id),
  run_id      TEXT REFERENCES machine_runs(id),
  kind        TEXT NOT NULL,
  reason      TEXT NOT NULL DEFAULT '',
  started_at  TEXT NOT NULL,
  started_day TEXT NOT NULL,
  ended_at    TEXT NOT NULL DEFAULT '',
  detail      TEXT NOT NULL DEFAULT '',      -- เช่น โมลด์จาก → เป็น
  status      TEXT NOT NULL DEFAULT 'ใช้งาน', -- 'ใช้งาน' / 'ยกเลิก' (ย้อน)
  by          TEXT NOT NULL DEFAULT '',
  src         TEXT NOT NULL DEFAULT 'v2',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  CHECK (ended_at = '' OR ended_at >= started_at)
);
CREATE INDEX machine_events_machine ON machine_events(machine_id, started_at);
CREATE INDEX machine_events_open ON machine_events(machine_id, ended_at);
