-- ═══════════════════════════════════════════════════════════════════════════
--  0100_production — โมดูลทีมผลิต (แผนผังโรงงาน · รอบเครื่อง · จอดเครื่อง · เปลี่ยนโมลด์ · งานรอผลิต · สต๊อก)
--  ช่วงเลขของทีมผลิต 0100–0199 · ไม่แก้ไฟล์ของ Foundation — เพิ่มคอลัมน์ (มี DEFAULT ทุกตัว) · ตารางใหม่มี trigger กันลบ
--  ดูเหตุผลทุกช่องใน v2/db/SCHEMA.md › "0100_production"
-- ═══════════════════════════════════════════════════════════════════════════

-- ── เครื่อง: ป้ายในผัง · นับในตัวเลข "เครื่องเดิน X/12" · ทะเบียนที่ยังไม่มีข้อมูล (โชว์ "ยังไม่มีในระบบ") ──
ALTER TABLE machines ADD COLUMN map_label TEXT NOT NULL DEFAULT '';      -- ชื่อสั้นบนผัง ('' = ใช้ name) เช่น 'แท้งลม'
ALTER TABLE machines ADD COLUMN sub TEXT NOT NULL DEFAULT '';            -- ป้ายรองบนผัง เช่น 'Low 300L' 'สีขวด'
ALTER TABLE machines ADD COLUMN tracked INTEGER NOT NULL DEFAULT 0 CHECK (tracked IN (0, 1));   -- 1 = เครื่องผลิตที่นับในตัวเลขบนสุด
ALTER TABLE machines ADD COLUMN model TEXT NOT NULL DEFAULT '';          -- รุ่น/ยี่ห้อ
ALTER TABLE machines ADD COLUMN bought TEXT NOT NULL DEFAULT '';         -- ปีที่ซื้อ
ALTER TABLE machines ADD COLUMN molds TEXT NOT NULL DEFAULT '';          -- แม่พิมพ์ที่ใช้ได้
ALTER TABLE machines ADD COLUMN capacity TEXT NOT NULL DEFAULT '';       -- กำลังผลิตตามสเปก
ALTER TABLE machines ADD COLUMN mold TEXT NOT NULL DEFAULT '';           -- โมลด์ที่ติดอยู่ตอนนี้ (ขยับเมื่อ "เปลี่ยนโมลด์ เสร็จ")

-- ── รอบเครื่อง ──
ALTER TABLE machine_runs ADD COLUMN chain_id TEXT NOT NULL DEFAULT '';   -- รอบที่ต่อกันด้วย "เปลี่ยนสี" ใช้รหัสเดียวกัน (แอปเดิม = SessionID)
ALTER TABLE machine_runs ADD COLUMN prev_run_id TEXT NOT NULL DEFAULT '';-- เปลี่ยนสีมาจากรอบไหน
ALTER TABLE machine_runs ADD COLUMN time_issue TEXT NOT NULL DEFAULT ''; -- ปัญหาเวลา (นำเข้า: 'เวลาปิดก่อนเวลาเริ่ม' · 'ไม่มีเวลาเริ่ม' · 'ไม่มีเวลาปิด') — ไม่นับชั่วโมง/ใบต่อชม.
ALTER TABLE machine_runs ADD COLUMN late_close INTEGER NOT NULL DEFAULT 0 CHECK (late_close IN (0, 1));   -- ปิดย้อนหลัง (รอบค้าง) + เหตุผล + ธง
ALTER TABLE machine_runs ADD COLUMN stocked INTEGER NOT NULL DEFAULT 0 CHECK (stocked IN (0, 1));        -- 1 = ยอดรอบนี้ลงสมุดสต๊อกแล้ว (รอบนำเข้า = 0 เสมอ)
ALTER TABLE machine_runs ADD COLUMN sync_version INTEGER NOT NULL DEFAULT 0;   -- รุ่นของแถวหลังนำเข้าครั้งล่าสุด — version ≠ sync_version = มีคนแก้ใน v2 แล้ว ตัวนำเข้าไม่ทับ

-- ── เหตุการณ์เครื่อง: เปลี่ยนโมลด์เป็นขั้น (จะเปลี่ยน → กำลังเปลี่ยน → เสร็จ) ──
ALTER TABLE machine_events ADD COLUMN stage TEXT NOT NULL DEFAULT '';
ALTER TABLE machine_events ADD COLUMN work_at TEXT NOT NULL DEFAULT '';  -- เริ่มลงมือเปลี่ยนจริงเมื่อไร (ช่วงที่เครื่องหยุดเพราะเปลี่ยนโมลด์)
ALTER TABLE machine_events ADD COLUMN mold_from TEXT NOT NULL DEFAULT '';
ALTER TABLE machine_events ADD COLUMN mold_to TEXT NOT NULL DEFAULT '';
-- จอดค้างได้ทีละเรื่องต่อเครื่อง · เปลี่ยนโมลด์ค้างได้ทีละเรื่องต่อเครื่อง (สองคนกดพร้อมกัน = ตัวหลังล้ม)
CREATE UNIQUE INDEX machine_events_one_stop ON machine_events(machine_id) WHERE kind = 'จอดเครื่อง' AND ended_at = '' AND status = 'ใช้งาน';
CREATE UNIQUE INDEX machine_events_one_mold ON machine_events(machine_id) WHERE kind = 'เปลี่ยนโมลด์' AND ended_at = '' AND status = 'ใช้งาน';
INSERT INTO vocab(kind, value, pos, label, tone) VALUES ('machine_events.stage', '', 0, '', ''), ('machine_events.stage', 'จะเปลี่ยน', 1, '', 'warn'), ('machine_events.stage', 'กำลังเปลี่ยน', 2, '', 'brand'), ('machine_events.stage', 'เสร็จ', 3, '', 'ok');
CREATE TRIGGER vocab_machine_events_stage_ins BEFORE INSERT ON machine_events WHEN NOT EXISTS (SELECT 1 FROM vocab WHERE kind = 'machine_events.stage' AND value = NEW.stage) BEGIN SELECT RAISE(ABORT, 'ค่า stage ของ machine_events ไม่อยู่ในรายการที่อนุญาต'); END;
CREATE TRIGGER vocab_machine_events_stage_upd BEFORE UPDATE OF stage ON machine_events WHEN NOT EXISTS (SELECT 1 FROM vocab WHERE kind = 'machine_events.stage' AND value = NEW.stage) BEGIN SELECT RAISE(ABORT, 'ค่า stage ของ machine_events ไม่อยู่ในรายการที่อนุญาต'); END;

-- ── ผู้ปฏิบัติงานของรอบ (แทน run_operators ซึ่งย้อนผ่านท่อกลางไม่ได้เพราะไม่มี id/version) ──
CREATE TABLE run_crew (
  id         TEXT PRIMARY KEY,                          -- run_id || '|' || name_text
  run_id     TEXT NOT NULL REFERENCES machine_runs(id),
  name_text  TEXT NOT NULL,                             -- ชื่อตามที่ลง (ชื่อเล่น)
  staff_id   TEXT REFERENCES staff(id),                 -- ถ้าจับคู่ทะเบียนได้
  status     TEXT NOT NULL DEFAULT 'ใช้งาน' CHECK (status IN ('ใช้งาน', 'ยกเลิก')),
  src        TEXT NOT NULL DEFAULT 'v2',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
);
CREATE UNIQUE INDEX run_crew_one ON run_crew(run_id, name_text);
CREATE INDEX run_crew_staff ON run_crew(staff_id);
CREATE INDEX run_crew_name ON run_crew(name_text);
CREATE TRIGGER no_delete_run_crew BEFORE DELETE ON run_crew BEGIN SELECT RAISE(ABORT, 'ห้ามลบข้อมูล (run_crew) — ใช้การเปลี่ยนสถานะแทน'); END;
INSERT INTO run_crew(id, run_id, name_text, staff_id, status, src, created_at, updated_at)
  SELECT o.run_id || '|' || o.name_text, o.run_id, o.name_text, o.staff_id, CASE WHEN o.active = 1 THEN 'ใช้งาน' ELSE 'ยกเลิก' END, 'run_operators', r.created_at, r.updated_at
  FROM run_operators o JOIN machine_runs r ON r.id = o.run_id;

-- ── วัตถุดิบที่รับเข้าคลัง (item_key = 'mat:<id>') — พรีฟอร์มรับเข้าใช้กุญแจสเปก 'spec:พรีฟอร์ม|…' ร่วมกับที่ฉีดเอง ──
CREATE TABLE materials (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  unit       TEXT NOT NULL,                             -- หน่วยนับในสมุด (จำนวนเต็ม) เช่น 'กก.' 'ชิ้น'
  pack_unit  TEXT NOT NULL DEFAULT '',                  -- หน่วยที่นับหน้างาน เช่น 'กระสอบ' ('' = นับหน่วยหลักตรง ๆ)
  per_pack   INTEGER NOT NULL DEFAULT 0 CHECK (typeof(per_pack) = 'integer' AND per_pack >= 0),
  pos        INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'ใช้งาน' CHECK (status IN ('ใช้งาน', 'เลิกใช้')),
  note       TEXT NOT NULL DEFAULT '',
  src        TEXT NOT NULL DEFAULT 'v2',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
);
CREATE TRIGGER no_delete_materials BEFORE DELETE ON materials BEGIN SELECT RAISE(ABORT, 'ห้ามลบข้อมูล (materials) — ใช้การเปลี่ยนสถานะแทน'); END;
INSERT INTO materials(id, name, unit, pos, note, src, created_at, updated_at) VALUES
  ('RESIN-PET', 'เม็ดพลาสติก PET', 'กก.', 1, 'รายการตั้งต้น — กระสอบละกี่กิโลยังไม่รู้ (แก้ได้)', 'ref:0100', '2026-11-16T00:00:00.000Z', '2026-11-16T00:00:00.000Z'),
  ('COLOR-MB', 'สีผสมเม็ด', 'กก.', 2, 'รายการตั้งต้น (แก้ได้)', 'ref:0100', '2026-11-16T00:00:00.000Z', '2026-11-16T00:00:00.000Z');

-- ── งานผลิต: 1 รายการออเดอร์ มีงานที่ยังไม่จบได้งานเดียว (สองเครื่องกดผูกพร้อมกัน = ไม่เกิดงานซ้ำ · งานเพิ่มหลังงานแรกเสร็จ = ได้ ตามแบบออฟฟิศ) ──
CREATE UNIQUE INDEX production_jobs_one_item ON production_jobs(order_item_id) WHERE order_item_id IS NOT NULL AND status IN ('รอผลิต', 'กำลังผลิต');
-- ยอดทำแล้วของงาน = คิดจากรอบที่ผูกไว้เสมอ (ไม่เก็บตัวนับซ้ำ — สองเครื่องปิดรอบพร้อมกันไม่ชนกัน) · production_jobs.good_pcs ไม่ใช้
CREATE VIEW job_made AS
  SELECT job_id,
    coalesce(sum(CASE WHEN status = 'ปิดแล้ว' THEN good_pcs END), 0) AS good_pcs,
    coalesce(sum(CASE WHEN status = 'ปิดแล้ว' THEN grade_b_pcs END), 0) AS grade_b_pcs,
    sum(CASE WHEN status = 'กำลังผลิต' THEN 1 ELSE 0 END) AS open_runs,
    count(*) AS runs
  FROM machine_runs WHERE job_id IS NOT NULL AND status IN ('กำลังผลิต', 'ปิดแล้ว') GROUP BY job_id;

-- ── ขนาดพรีฟอร์มที่เจอในแอปเดิม ──
INSERT OR IGNORE INTO type_sizes(type, size, per_bag, min_order_pcs, pos) VALUES ('พรีฟอร์ม', '12.5 กรัม', 0, 0, 23);

-- ── เครื่อง "ไม่ระบุเครื่อง" สำหรับรอบเก่าที่แอปเดิมไม่ได้ลงเครื่อง (ไม่อยู่ในผัง · เก็บประวัติไว้ครบ) ──
INSERT OR IGNORE INTO machines(id, name, kind, status, note, src, created_at, updated_at) VALUES
  ('NOMACHINE', 'ไม่ระบุเครื่อง', 'อื่น', 'เลิกใช้', 'รอบเก่าจากแอปเดิมที่ไม่ได้ลงเครื่อง — ไม่อยู่ในผัง', 'ref:0100', '2026-11-16T00:00:00.000Z', '2026-11-16T00:00:00.000Z');

-- ── คลังค่า: สาเหตุจอดเครื่อง (ตามที่คุณปาล์มให้ไว้ — เก็บของเดิมไว้ใต้ชื่อ .retired ไม่ลบ) ──
UPDATE vocab SET kind = 'reason.machine_stop.retired' WHERE kind = 'reason.machine_stop' AND value <> 'ไฟดับ';
INSERT INTO vocab(kind, value, pos, label, tone) VALUES
  ('reason.machine_stop', 'หลอด/ฮีตเตอร์', 2, '', ''), ('reason.machine_stop', 'ลม/ปั๊มลม', 3, '', ''), ('reason.machine_stop', 'น้ำเย็น/ชิลเลอร์', 4, '', ''),
  ('reason.machine_stop', 'โมล/แม่พิมพ์', 5, '', ''), ('reason.machine_stop', 'รอพรีฟอร์ม/วัตถุดิบ', 6, '', ''), ('reason.machine_stop', 'ซ่อมบำรุง', 7, '', ''), ('reason.machine_stop', 'พัก', 8, '', '');
INSERT INTO vocab(kind, value, pos, label, tone) VALUES
  ('reason.late_close', 'ลืมกดปิด', 1, '', ''), ('reason.late_close', 'ปิดแทนเพื่อน', 2, '', ''), ('reason.late_close', 'แอป/เน็ตใช้ไม่ได้ตอนนั้น', 3, '', ''), ('reason.late_close', 'ปิดในแอปเดิมแล้ว', 4, '', ''),
  ('reason.receive', 'ซื้อเข้า', 1, '', ''), ('reason.receive', 'รับคืน', 2, '', ''), ('reason.receive', 'ยอดยกมา', 3, '', ''),
  ('reason.count', 'นับจริงไม่ตรง', 1, '', ''), ('reason.count', 'ยอดยกมา (เริ่มใช้ระบบ)', 2, '', ''), ('reason.count', 'ของเสียหาย/ทิ้ง', 3, '', ''),
  ('reason.run_fix', 'ลงจำนวนผิด', 1, '', ''), ('reason.run_fix', 'นับใหม่แล้ว', 2, '', ''), ('reason.run_fix', 'ลงผิดเกรด', 3, '', ''),
  ('reason.job_done', 'ครบตามสั่ง', 1, '', ''), ('reason.job_done', 'ใช้ของในสต๊อก', 2, '', ''), ('reason.job_done', 'ลูกค้าลดจำนวน', 3, '', '');
INSERT INTO vocab(kind, value, pos, label, tone) VALUES ('stock_moves.move_type', 'แก้ยอดผลิต', 8, '', 'warn');

-- ── ค่าตั้ง ──
INSERT INTO settings(key, value, note, updated_at, updated_by) VALUES
  ('LATE_CLOSE_MIN', '60', 'ทีมผลิต: เวลาปิดรอบย้อนไปเกินกี่นาที = "ปิดย้อนหลัง" (ต้องมีเหตุผล + ขึ้นธง)', '2026-11-16T00:00:00.000Z', 'system'),
  ('RUN_MAX_HOURS', '20', 'นำเข้ารอบเก่า: เวลาปิดก่อนเวลาเริ่ม ถ้าบวก 1 วันแล้วรอบยาวไม่เกินกี่ชั่วโมง = กะดึกข้ามเที่ยงคืน (เกิน = พิมพ์ผิด ติดธง)', '2026-11-16T00:00:00.000Z', 'system');
